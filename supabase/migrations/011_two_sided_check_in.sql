-- =============================================================================
-- Golf OS — 011_two_sided_check_in.sql
--
-- Check-in now happens on both sides:
--   * the golfer checks the group in (bookings.golfer_checked_in_at)
--   * each caddie checks in on their own assignment (caddy_assignments.checked_in_at)
-- Each side sees the other's check-in. Caddie payouts are no longer part of
-- the product, so caddie check-in no longer writes to the caddie ledger.
-- Safe to run more than once.
-- =============================================================================
begin;

alter table public.bookings add column if not exists golfer_checked_in_at timestamptz;

-- Caddie check-in: marks the caddie's own assignment only.
create or replace function public.caddy_check_in(p_assignment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.caddy_assignments%rowtype;
  v_b public.bookings%rowtype;
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
  update public.caddy_assignments set checked_in_at = coalesce(checked_in_at, now())
   where id = p_assignment_id
  returning checked_in_at into v_a.checked_in_at;
  return v_a.checked_in_at;
end;
$$;

-- Golfer check-in: any player on the booking, on the day (demo accounts any day).
create or replace function public.golfer_check_in(p_booking_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   public.bookings%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found or v_uid is null or not public.is_booking_participant(p_booking_id) then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if v_b.status not in ('confirmed', 'checked_in') then
    raise exception 'booking_not_active' using errcode = 'P0001';
  end if;
  if v_b.play_date <> (now() at time zone 'Asia/Kolkata')::date and not public.is_demo_account(v_uid) then
    raise exception 'check_in_only_on_the_day' using errcode = 'P0001';
  end if;
  update public.bookings
     set golfer_checked_in_at = coalesce(golfer_checked_in_at, now()),
         status = 'checked_in'
   where id = p_booking_id
  returning golfer_checked_in_at into v_b.golfer_checked_in_at;
  return v_b.golfer_checked_in_at;
end;
$$;

-- Caddie schedule gains the golfer's check-in time.
drop function if exists public.get_caddy_schedule(date, date);
create function public.get_caddy_schedule(p_from date, p_to date)
returns table (
  assignment_id        uuid,
  status               public.caddy_assignment_status,
  checked_in_at        timestamptz,
  rate_paise           integer,
  seat_number          smallint,
  booking_id           uuid,
  booking_ref          text,
  booking_status       public.booking_status,
  play_date            date,
  tee_time             time,
  start_hole           smallint,
  hole_format          public.hole_format,
  player_name          text,
  group_names          text[],
  player_count         smallint,
  course_name          text,
  golfer_checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.status, a.checked_in_at, a.rate_paise, a.seat_number,
         b.id, b.booking_ref, b.status, b.play_date, b.tee_time, b.start_hole, b.hole_format,
         bp.full_name,
         (select array_agg(x.full_name order by x.seat_number) from public.booking_players x where x.booking_id = b.id),
         b.player_count, c.name, b.golfer_checked_in_at
  from public.caddy_assignments a
  join public.bookings b on b.id = a.booking_id
  join public.courses c on c.id = b.course_id
  left join public.booking_players bp on bp.id = a.booking_player_id
  where a.caddy_id = public.current_caddy_id()
    and a.status in ('confirmed', 'completed')
    and b.play_date between p_from and p_to
  order by b.play_date, b.tee_time;
$$;

-- Golfer's view of their caddies gains the caddie's check-in time.
drop function if exists public.get_booking_caddies(uuid);
create function public.get_booking_caddies(p_booking_id uuid)
returns table (
  seat_number smallint, caddy_code text, full_name text, grade public.caddy_grade,
  rating numeric, photo_url text, rate_paise integer, status public.caddy_assignment_status,
  checked_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.seat_number, c.caddy_code, c.full_name, c.grade, c.rating, c.photo_url, a.rate_paise, a.status, a.checked_in_at
  from public.caddy_assignments a
  join public.caddies c on c.id = a.caddy_id
  join public.bookings b on b.id = a.booking_id
  where a.booking_id = p_booking_id
    and a.status in ('confirmed', 'completed', 'cancelled')
    and (public.is_booking_participant(p_booking_id) or public.is_course_admin(b.course_id))
  order by a.seat_number;
$$;

revoke execute on function public.get_caddy_schedule(date, date) from public, anon;
revoke execute on function public.get_booking_caddies(uuid)      from public, anon;
revoke execute on function public.golfer_check_in(uuid)          from public, anon;
grant  execute on function public.get_caddy_schedule(date, date) to authenticated;
grant  execute on function public.get_booking_caddies(uuid)      to authenticated;
grant  execute on function public.golfer_check_in(uuid)          to authenticated;

commit;

-- Check: should return golfer_check_in and the new column.
select 'golfer_check_in' as item, count(*) from pg_proc where proname = 'golfer_check_in'
union all
select 'bookings.golfer_checked_in_at', count(*) from information_schema.columns
 where table_name = 'bookings' and column_name = 'golfer_checked_in_at';
