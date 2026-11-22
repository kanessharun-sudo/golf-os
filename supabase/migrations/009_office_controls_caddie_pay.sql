-- =============================================================================
-- Golf OS — 009_office_controls_caddie_pay.sql  (Phase 5)
--
-- 1. Caddie check-in posts the caddie's earning to the ledger (net of the
--    club's commission) and closes the assignment, so pay does not depend on
--    the group scoring the round in the app. finalize_round only credits
--    assignments still 'confirmed', so nothing is paid twice.
-- 2. Club office: assign or remove a caddie on a booking (fee paid at the counter).
-- 3. Caddies set their own UPI ID for payouts.
-- Adds and replaces functions only; changes no rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Check-in pays the caddie
-- -----------------------------------------------------------------------------
create or replace function public.caddy_check_in(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a      public.caddy_assignments%rowtype;
  v_b      public.bookings%rowtype;
  v_course public.courses%rowtype;
  v_net    integer;
begin
  select * into v_a from public.caddy_assignments where id = p_assignment_id for update;
  if not found or v_a.caddy_id is distinct from public.current_caddy_id() then
    raise exception 'assignment_not_found' using errcode = 'P0001';
  end if;
  select * into v_b from public.bookings where id = v_a.booking_id;
  if v_b.play_date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'check_in_only_on_the_day' using errcode = 'P0001';
  end if;
  if v_b.status not in ('confirmed', 'checked_in', 'completed') or v_a.status not in ('confirmed', 'completed') then
    raise exception 'booking_not_active' using errcode = 'P0001';
  end if;
  if v_a.checked_in_at is not null then
    return v_a.checked_in_at;
  end if;

  update public.caddy_assignments
     set checked_in_at = now(), status = 'completed'
   where id = p_assignment_id
  returning checked_in_at into v_a.checked_in_at;
  update public.bookings set status = 'checked_in' where id = v_b.id and status = 'confirmed';

  select * into v_course from public.courses where id = v_a.course_id;
  v_net := v_a.rate_paise - round(v_a.rate_paise * v_course.caddy_commission_percent / 100.0)::integer;
  if v_net > 0 and not exists (select 1 from public.caddy_ledger where caddy_assignment_id = v_a.id) then
    insert into public.caddy_ledger (caddy_id, course_id, entry_type, direction, amount_paise,
                                     caddy_assignment_id, description)
    values (v_a.caddy_id, v_a.course_id, 'round_earning', 'credit', v_net, v_a.id,
            format('%s, %s %s', v_b.booking_ref, to_char(v_b.play_date, 'DD Mon'), to_char(v_b.tee_time, 'HH24:MI')));
  end if;
  return v_a.checked_in_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Club office: caddie on a booking
-- -----------------------------------------------------------------------------
create or replace function public.admin_assign_caddy(p_booking_id uuid, p_caddy_id uuid, p_seat_number smallint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     public.bookings%rowtype;
  v_c     public.caddies%rowtype;
  v_rate  integer;
  v_id    uuid;
  v_mins  integer;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or not public.is_course_admin(v_b.course_id) then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if v_b.status not in ('confirmed', 'checked_in') then
    raise exception 'booking_not_active' using errcode = 'P0001';
  end if;
  select * into v_c from public.caddies where id = p_caddy_id and course_id = v_b.course_id and is_active;
  if not found then
    raise exception 'caddy_unavailable' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.booking_players where booking_id = p_booking_id and seat_number = p_seat_number) then
    raise exception 'seat_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.caddy_assignments
             where booking_id = p_booking_id and seat_number = p_seat_number and status in ('confirmed', 'completed')) then
    raise exception 'seat_has_caddy' using errcode = 'P0001';
  end if;

  v_rate := case when v_b.hole_format = 'full_18' then v_c.daily_rate_18_paise else v_c.daily_rate_9_paise end;
  select case when v_b.hole_format = 'full_18' then round_duration_18_minutes else round_duration_9_minutes end
    into v_mins from public.courses where id = v_b.course_id;

  begin
    insert into public.caddy_assignments (course_id, caddy_id, booking_id, booking_player_id, seat_number,
                                          hole_format, starts_at, ends_at, status, rate_paise)
    select v_b.course_id, v_c.id, v_b.id, bp.id, p_seat_number, v_b.hole_format,
           v_b.tee_starts_at, v_b.tee_starts_at + make_interval(mins => v_mins), 'confirmed', v_rate
    from public.booking_players bp where bp.booking_id = v_b.id and bp.seat_number = p_seat_number
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'caddy_unavailable' using errcode = 'P0001';
  end;

  -- Paid at the counter: the booking total records it so reports add up.
  update public.bookings
     set caddy_fee_paise = caddy_fee_paise + v_rate,
         total_paise = total_paise + v_rate
   where id = v_b.id;
  return v_id;
end;
$$;

create or replace function public.admin_remove_caddy(p_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.caddy_assignments%rowtype;
begin
  select * into v_a from public.caddy_assignments where id = p_assignment_id for update;
  if not found or not public.is_course_admin(v_a.course_id) then
    raise exception 'assignment_not_found' using errcode = 'P0001';
  end if;
  if v_a.checked_in_at is not null or v_a.status <> 'confirmed' then
    raise exception 'caddy_already_checked_in' using errcode = 'P0001';
  end if;
  update public.caddy_assignments set status = 'cancelled' where id = p_assignment_id;
  update public.bookings
     set caddy_fee_paise = greatest(caddy_fee_paise - v_a.rate_paise, 0),
         total_paise = greatest(total_paise - v_a.rate_paise, 0)
   where id = v_a.booking_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Caddie's own UPI ID
-- -----------------------------------------------------------------------------
create or replace function public.caddy_set_upi(p_upi_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caddy uuid := public.current_caddy_id();
begin
  if v_caddy is null then
    raise exception 'assignment_not_found' using errcode = 'P0001';
  end if;
  if p_upi_id !~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9.-]{1,63}$' then
    raise exception 'invalid_upi_id' using errcode = 'P0001';
  end if;
  update public.caddies set upi_id = lower(p_upi_id) where id = v_caddy;
end;
$$;

revoke execute on function public.admin_assign_caddy(uuid, uuid, smallint) from public, anon;
revoke execute on function public.admin_remove_caddy(uuid)                 from public, anon;
revoke execute on function public.caddy_set_upi(text)                      from public, anon;
grant execute on function public.admin_assign_caddy(uuid, uuid, smallint)  to authenticated;
grant execute on function public.admin_remove_caddy(uuid)                  to authenticated;
grant execute on function public.caddy_set_upi(text)                       to authenticated;
