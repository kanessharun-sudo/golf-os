-- =============================================================================
-- Golf OS — 007_members_admin_caddy.sql  (Phase 4)
--
-- 1. Club member roll, read from the club's Google Sheet (rows with source
--    'sheet' are replaced on every sync; 'demo' rows belong to demo sign-ins).
-- 2. Member / guest pricing: members play free, guests pay a flat green fee
--    (courses.pricing.guest_green_fee). The booker pays for the whole group.
--    Caddy fees and the convenience fee still apply.
-- 3. A booker can block a whole slot as a 3-ball or a 4-ball.
-- 4. Bookings with nothing to pay are confirmed without a payment.
-- 5. Players named in someone else's booking are linked to their account
--    when they sign in with the same email or mobile.
-- 6. Caddie schedule and check-in; course admin member sync and demo seed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Member roll
-- -----------------------------------------------------------------------------
create type public.member_status as enum ('active', 'lapsed');

create table public.club_members (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  member_no   text not null check (char_length(member_no) between 1 and 40),
  full_name   text not null check (char_length(full_name) between 1 and 120),
  phone       text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  status      public.member_status not null default 'active',
  source      text not null default 'sheet' check (source in ('sheet', 'demo')),
  synced_at   timestamptz not null default now(),
  unique (course_id, member_no)
);
create index club_members_phone_idx on public.club_members (course_id, phone) where phone is not null;
create index club_members_email_idx on public.club_members (course_id, lower(email)) where email is not null;

alter table public.club_members enable row level security;
create policy club_members_admin_select on public.club_members for select to authenticated
  using (public.is_course_admin(course_id));

alter table public.courses
  add column member_sheet_url     text check (member_sheet_url ~ '^https://'),
  add column members_synced_at    timestamptz,
  add column members_sync_error   text;

create or replace function public.is_club_member(p_course_id uuid, p_phone text, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.club_members m
    where m.course_id = p_course_id
      and m.status = 'active'
      and ((p_phone is not null and m.phone = p_phone)
        or (p_email is not null and m.email is not null and lower(m.email) = lower(p_email)))
  );
$$;

-- Atomic replace of the sheet-sourced rows. p_rows: [{member_no, full_name, phone?, email?, status?}]
create or replace function public.replace_sheet_members(p_course_id uuid, p_rows jsonb, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_error is not null then
    update public.courses set members_sync_error = left(p_error, 500) where id = p_course_id;
    return 0;
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = 'P0001';
  end if;

  delete from public.club_members where course_id = p_course_id and source = 'sheet';
  insert into public.club_members (course_id, member_no, full_name, phone, email, status, source)
  select distinct on (btrim(r ->> 'member_no'))
         p_course_id,
         btrim(r ->> 'member_no'),
         btrim(r ->> 'full_name'),
         nullif(btrim(r ->> 'phone'), ''),
         nullif(lower(btrim(r ->> 'email')), ''),
         case when lower(coalesce(r ->> 'status', 'active')) in ('lapsed', 'inactive', 'suspended', 'no')
              then 'lapsed'::public.member_status else 'active'::public.member_status end,
         'sheet'
  from jsonb_array_elements(p_rows) r
  where nullif(btrim(r ->> 'member_no'), '') is not null
    and nullif(btrim(r ->> 'full_name'), '') is not null
  on conflict (course_id, member_no) do update
     set full_name = excluded.full_name, phone = excluded.phone, email = excluded.email,
         status = excluded.status, source = 'sheet', synced_at = now();
  get diagnostics v_count = row_count;

  update public.courses set members_synced_at = now(), members_sync_error = null where id = p_course_id;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Member flags on players
-- -----------------------------------------------------------------------------
alter table public.slot_hold_players add column is_member boolean not null default false;
alter table public.booking_players   add column is_member boolean not null default false;

create or replace function public.slot_hold_players_flag_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.is_member := public.is_club_member(
    (select h.course_id from public.slot_holds h where h.id = new.hold_id), new.phone, new.email);
  return new;
end;
$$;
create trigger slot_hold_players_flag_member
  before insert or update of phone, email on public.slot_hold_players
  for each row execute function public.slot_hold_players_flag_member();

-- Booking players keep the status they were priced at (copied from the hold seat).
create or replace function public.booking_players_flag_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold uuid;
begin
  select b.slot_hold_id into v_hold from public.bookings b where b.id = new.booking_id;
  if v_hold is not null then
    select p.is_member into new.is_member
    from public.slot_hold_players p where p.hold_id = v_hold and p.seat_number = new.seat_number;
    new.is_member := coalesce(new.is_member, false);
  end if;
  return new;
end;
$$;
create trigger booking_players_flag_member
  before insert on public.booking_players
  for each row execute function public.booking_players_flag_member();

-- -----------------------------------------------------------------------------
-- 3. Pricing: members free, guests flat fee
-- -----------------------------------------------------------------------------
update public.courses
   set pricing = pricing || jsonb_build_object('guest_green_fee', 100000, 'member_green_fee', 0)
 where slug = 'asc-centre-bengaluru';

create or replace function public.quote_slot_hold(p_hold_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold      public.slot_holds%rowtype;
  v_course    public.courses%rowtype;
  v_players   integer;
  v_members   integer;
  v_guests    integer;
  v_green     integer;
  v_caddy     integer;
  v_addon     integer;
  v_fee       integer;
  v_member_fee integer;
  v_guest_fee  integer;
  v_quote     jsonb;
begin
  v_hold := public.lock_own_active_hold(p_hold_id);
  select * into v_course from public.courses where id = v_hold.course_id;

  select count(*), count(*) filter (where is_member)
    into v_players, v_members
  from public.slot_hold_players where hold_id = p_hold_id;
  if v_players = 0 or v_hold.tee_id is null then
    raise exception 'hold_details_missing' using errcode = 'P0001';
  end if;
  v_guests := v_players - v_members;

  if v_course.pricing ? 'guest_green_fee' then
    v_guest_fee  := (v_course.pricing ->> 'guest_green_fee')::integer;
    v_member_fee := coalesce((v_course.pricing ->> 'member_green_fee')::integer, 0);
  else
    v_guest_fee  := public.green_fee_per_player(v_course.pricing, v_hold.play_date, v_hold.hole_format);
    v_member_fee := v_guest_fee;
  end if;
  v_green := v_guests * v_guest_fee + v_members * v_member_fee;

  select coalesce(sum(rate_paise), 0)::integer into v_caddy
  from public.caddy_assignments where slot_hold_id = p_hold_id and status = 'held';
  v_addon := case when v_hold.mode = 'tournament'
                  then v_players * (v_course.pricing ->> 'tournament_entry_addon')::integer else 0 end;
  v_fee := round((v_green + v_caddy + v_addon)
                 * (v_course.pricing ->> 'platform_convenience_fee_percent')::numeric / 100)::integer;

  v_quote := jsonb_build_object(
    'currency', v_course.currency,
    'players', v_players,
    'members', v_members,
    'guests', v_guests,
    'member_green_fee_paise', v_member_fee,
    'guest_green_fee_paise', v_guest_fee,
    'member_seats', coalesce((select jsonb_agg(p.seat_number order by p.seat_number)
                              from public.slot_hold_players p
                              where p.hold_id = p_hold_id and p.is_member), '[]'::jsonb),
    'is_weekend', extract(isodow from v_hold.play_date)::int in
                  (select jsonb_array_elements_text(v_course.pricing -> 'weekend_isodow')::int),
    'green_fee_paise', v_green,
    'caddy_fee_paise', v_caddy,
    'tournament_addon_paise', v_addon,
    'convenience_fee_paise', v_fee,
    'convenience_fee_percent', (v_course.pricing ->> 'platform_convenience_fee_percent')::numeric,
    'total_paise', v_green + v_caddy + v_addon + v_fee,
    'caddy_assignment_ids', coalesce((select jsonb_agg(a.id order by a.seat_number)
                                      from public.caddy_assignments a
                                      where a.slot_hold_id = p_hold_id and a.status = 'held'), '[]'::jsonb),
    'quoted_at', now()
  );

  update public.slot_holds set quote = v_quote, total_paise = v_green + v_caddy + v_addon + v_fee
   where id = p_hold_id;
  return v_quote;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 3-ball or 4-ball block: a private hold keeps the seats asked for (3 or 4)
--    and still closes the whole slot.
-- -----------------------------------------------------------------------------
create or replace function public.acquire_slot_hold(
  p_course_id    uuid,
  p_play_date    date,
  p_tee_time     time,
  p_hole_format  public.hole_format,
  p_seats        smallint,
  p_is_private   boolean default false
)
returns public.slot_holds
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_course      public.courses%rowtype;
  v_start_hole  smallint := case when p_hole_format = 'back_9' then 10 else 1 end;
  v_starts_at   timestamptz;
  v_taken       integer;
  v_has_private boolean;
  v_seats       smallint;
  v_hold        public.slot_holds%rowtype;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  select * into v_course from public.courses
  where id = p_course_id and is_active and is_published;
  if not found then
    raise exception 'course_not_bookable' using errcode = 'P0001';
  end if;

  v_seats := p_seats;
  if p_is_private and (v_seats is null or v_seats < 3) then
    raise exception 'invalid_seat_count' using errcode = 'P0001', detail = 'a blocked slot is a 3-ball or a 4-ball';
  end if;
  if v_seats is null
     or v_seats < v_course.min_players_per_booking
     or v_seats > v_course.max_players_per_slot then
    raise exception 'invalid_seat_count' using errcode = 'P0001',
      detail = format('between %s and %s', v_course.min_players_per_booking, v_course.max_players_per_slot);
  end if;

  v_starts_at := public.resolve_tee_slot(p_course_id, p_play_date, p_tee_time, p_hole_format);

  perform pg_advisory_xact_lock(public.slot_lock_key(p_course_id, p_play_date, p_tee_time, v_start_hole));

  update public.caddy_assignments ca
     set status = 'released', hold_expires_at = null
    from public.slot_holds h
   where ca.slot_hold_id = h.id and ca.status = 'held'
     and h.profile_id = v_uid and h.status = 'active';
  update public.slot_holds
     set status = 'released', released_at = now()
   where profile_id = v_uid and status = 'active';

  select o.seats_taken, o.has_private into v_taken, v_has_private
  from public.slot_occupancy(p_course_id, p_play_date, p_tee_time, v_start_hole) o;

  if v_has_private then
    raise exception 'slot_full' using errcode = 'P0001', detail = 'slot blocked by a group';
  end if;
  if p_is_private and v_taken > 0 then
    raise exception 'slot_not_empty_for_private' using errcode = 'P0001',
      detail = format('%s seat(s) already taken', v_taken);
  end if;
  if v_taken > 0 and not v_course.allow_join_open_batch then
    raise exception 'open_batch_join_disabled' using errcode = 'P0001';
  end if;
  if v_taken + v_seats > v_course.max_players_per_slot then
    raise exception 'slot_full' using errcode = 'P0001',
      detail = format('%s of %s seats available', v_course.max_players_per_slot - v_taken, v_course.max_players_per_slot);
  end if;

  insert into public.slot_holds (
    course_id, profile_id, play_date, tee_time, start_hole, hole_format,
    seats, is_private, tee_starts_at, status, expires_at
  ) values (
    p_course_id, v_uid, p_play_date, p_tee_time, v_start_hole, p_hole_format,
    v_seats, p_is_private, v_starts_at, 'active',
    now() + make_interval(mins => v_course.checkout_hold_minutes)
  )
  returning * into v_hold;

  return v_hold;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Nothing to pay: confirm without a payment
-- -----------------------------------------------------------------------------
create or replace function public.confirm_free_hold(p_hold_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote   jsonb;
  v_ref     text := 'free_' || replace(p_hold_id::text, '-', '');
  v_result  text;
  v_booking uuid;
begin
  v_quote := public.quote_slot_hold(p_hold_id);   -- also checks ownership and expiry
  if (v_quote ->> 'total_paise')::integer <> 0 then
    raise exception 'payment_required' using errcode = 'P0001';
  end if;

  update public.slot_holds set razorpay_order_id = v_ref where id = p_hold_id;
  select c.result, c.booking_id into v_result, v_booking
  from public.confirm_hold_payment(v_ref, v_ref, 0) c;
  if v_result not in ('confirmed', 'already_confirmed') then
    raise exception 'free_confirm_failed' using errcode = 'P0001', detail = v_result;
  end if;

  update public.bookings set payment_status = 'waived' where id = v_booking;
  return v_booking;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Link players named in other people's bookings to the signed-in account
-- -----------------------------------------------------------------------------
create or replace function public.claim_my_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_phone text;
  v_count integer := 0;
begin
  if v_uid is null then
    return 0;
  end if;
  select lower(u.email), case when u.phone is not null and u.phone <> '' then '+' || ltrim(u.phone, '+') end
    into v_email, v_phone
  from auth.users u where u.id = v_uid;

  update public.booking_players bp
     set profile_id = v_uid
   where bp.profile_id is null
     and ((v_email is not null and lower(bp.email) = v_email)
       or (v_phone is not null and bp.phone = v_phone))
     and not exists (select 1 from public.booking_players x
                     where x.booking_id = bp.booking_id and x.profile_id = v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Caddie side
-- -----------------------------------------------------------------------------
alter table public.caddy_assignments add column checked_in_at timestamptz;

create or replace function public.get_caddy_schedule(p_from date, p_to date)
returns table (
  assignment_id   uuid,
  status          public.caddy_assignment_status,
  checked_in_at   timestamptz,
  rate_paise      integer,
  seat_number     smallint,
  booking_id      uuid,
  booking_ref     text,
  booking_status  public.booking_status,
  play_date       date,
  tee_time        time,
  start_hole      smallint,
  hole_format     public.hole_format,
  player_name     text,
  group_names     text[],
  player_count    smallint,
  course_name     text
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
         b.player_count, c.name
  from public.caddy_assignments a
  join public.bookings b on b.id = a.booking_id
  join public.courses c on c.id = b.course_id
  left join public.booking_players bp on bp.id = a.booking_player_id
  where a.caddy_id = public.current_caddy_id()
    and a.status in ('confirmed', 'completed')
    and b.play_date between p_from and p_to
  order by b.play_date, b.tee_time;
$$;

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
  if v_b.status not in ('confirmed', 'checked_in') then
    raise exception 'booking_not_active' using errcode = 'P0001';
  end if;
  update public.caddy_assignments set checked_in_at = coalesce(checked_in_at, now())
   where id = p_assignment_id returning checked_in_at into v_a.checked_in_at;
  update public.bookings set status = 'checked_in' where id = v_b.id and status = 'confirmed';
  return v_a.checked_in_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Demo data for the admin and caddie demo accounts (service role only).
--    Fills the next p_days days with sample bookings unless already seeded.
-- -----------------------------------------------------------------------------
create or replace function public.seed_demo_tee_sheet(p_course_id uuid, p_booker uuid, p_days integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course   public.courses%rowtype;
  v_tee      uuid;
  v_day      date;
  v_today    date := (now() at time zone 'Asia/Kolkata')::date;
  v_times    time[] := array['06:00','06:15','06:30','06:45','07:00','07:15','07:45','08:15','08:30','09:00']::time[];
  v_names    text[] := array['Aditya Rao','Meera Iyer','Kabir Shah','Nisha Menon','Rohan Kulkarni','Ananya Bhat',
                             'Vikram Reddy','Sana Qureshi','Arjun Nair','Priya Hegde','Farhan Ali','Deepa Rao',
                             'Karthik Iyer','Lakshmi Prasad','Sameer Joshi','Tara Pillai'];
  v_i        integer;
  v_n        integer;
  v_seats    integer;
  v_members  integer;
  v_booking  uuid;
  v_caddy    public.caddies%rowtype;
  v_created  integer := 0;
  v_starts   timestamptz;
  v_name_idx integer;
begin
  select * into v_course from public.courses where id = p_course_id;
  select id into v_tee from public.course_tees where course_id = p_course_id and is_default limit 1;

  for d in 0 .. p_days - 1 loop
    v_day := v_today + d;
    continue when exists (select 1 from public.bookings
                          where course_id = p_course_id and play_date = v_day and notes = 'demo_seed');
    v_n := 6 + (d % 3);
    for v_i in 1 .. v_n loop
      v_seats := case when v_i % 3 = 0 then 3 else 4 end;
      v_members := case when v_i % 4 = 0 then v_seats else v_seats - 1 - (v_i % 2) end;
      begin
        perform public.resolve_tee_slot(p_course_id, v_day, v_times[v_i], 'full_18');  -- skips closed days
        insert into public.bookings (
          course_id, booked_by, play_date, tee_time, hole_format, tee_id, player_count, is_private,
          status, payment_status, green_fee_paise, caddy_fee_paise, convenience_fee_paise, total_paise,
          paid_at, notes
        ) values (
          p_course_id, p_booker, v_day, v_times[v_i], 'full_18', v_tee, v_seats, true,
          'confirmed', case when v_members = v_seats then 'waived' else 'paid' end::public.payment_status,
          (v_seats - v_members) * 100000, 0,
          round((v_seats - v_members) * 100000 * 0.025)::integer,
          (v_seats - v_members) * 100000 + round((v_seats - v_members) * 100000 * 0.025)::integer,
          now(), 'demo_seed'
        ) returning id, tee_starts_at into v_booking, v_starts;
      exception when others then
        continue;   -- slot already taken by a real booking
      end;

      for s in 1 .. v_seats loop
        v_name_idx := 1 + ((d * 7 + v_i * 4 + s) % array_length(v_names, 1));
        insert into public.booking_players (booking_id, seat_number, full_name, is_booker, is_member)
        values (v_booking, s, v_names[v_name_idx], s = 1, s <= v_members);
      end loop;

      -- One caddie on most groups.
      if v_i % 4 <> 3 then
        select * into v_caddy from public.caddies
        where course_id = p_course_id and is_active
        order by caddy_code offset ((v_i + d) % 8) limit 1;
        begin
          insert into public.caddy_assignments (course_id, caddy_id, booking_id, booking_player_id, seat_number,
                                                hole_format, starts_at, ends_at, status, rate_paise)
          select p_course_id, v_caddy.id, v_booking, bp.id, 1, 'full_18', v_starts,
                 v_starts + interval '4 hours 30 minutes', 'confirmed', v_caddy.daily_rate_18_paise
          from public.booking_players bp where bp.booking_id = v_booking and bp.seat_number = 1;
          update public.bookings
             set caddy_fee_paise = v_caddy.daily_rate_18_paise,
                 convenience_fee_paise = round((green_fee_paise + v_caddy.daily_rate_18_paise) * 0.025)::integer,
                 total_paise = green_fee_paise + v_caddy.daily_rate_18_paise
                               + round((green_fee_paise + v_caddy.daily_rate_18_paise) * 0.025)::integer,
                 payment_status = 'paid'
           where id = v_booking;
        exception when exclusion_violation then
          null;
        end;
      end if;
      v_created := v_created + 1;
    end loop;
  end loop;
  return v_created;
end;
$$;

-- booking_players_flag_member would overwrite seeded flags only when a hold exists; seeds have none.

-- -----------------------------------------------------------------------------
-- 9. Privileges
-- -----------------------------------------------------------------------------
revoke execute on function public.is_club_member(uuid, text, text)                from public, anon, authenticated;
revoke execute on function public.replace_sheet_members(uuid, jsonb, text)        from public, anon, authenticated;
revoke execute on function public.confirm_free_hold(uuid)                         from public, anon;
revoke execute on function public.claim_my_bookings()                             from public, anon;
revoke execute on function public.get_caddy_schedule(date, date)                  from public, anon;
revoke execute on function public.caddy_check_in(uuid)                            from public, anon;
revoke execute on function public.seed_demo_tee_sheet(uuid, uuid, integer)        from public, anon, authenticated;

grant execute on function public.confirm_free_hold(uuid)                          to authenticated;
grant execute on function public.claim_my_bookings()                              to authenticated;
grant execute on function public.get_caddy_schedule(date, date)                   to authenticated;
grant execute on function public.caddy_check_in(uuid)                             to authenticated;
grant execute on function public.replace_sheet_members(uuid, jsonb, text)         to service_role;
grant execute on function public.seed_demo_tee_sheet(uuid, uuid, integer)         to service_role;
grant execute on function public.is_club_member(uuid, text, text)                 to service_role;
grant execute on function public.quote_slot_hold(uuid)                            to authenticated;
grant execute on function public.acquire_slot_hold(uuid, date, time, public.hole_format, smallint, boolean) to authenticated;

-- Sample members so the demo shows member pricing before a sheet is connected.
insert into public.club_members (course_id, member_no, full_name, phone, email, source)
select c.id, m.no, m.name, m.phone, m.email, 'demo'
from public.courses c
cross join (values
  ('ASC-DEMO-001', 'Aditya Rao',     '+919800000001', 'aditya.rao@demo.golf-os.example'),
  ('ASC-DEMO-002', 'Meera Iyer',     '+919800000002', 'meera.iyer@demo.golf-os.example'),
  ('ASC-DEMO-003', 'Kabir Shah',     '+919800000003', 'kabir.shah@demo.golf-os.example'),
  ('ASC-DEMO-004', 'Nisha Menon',    '+919800000004', 'nisha.menon@demo.golf-os.example'),
  ('ASC-DEMO-005', 'Rohan Kulkarni', '+919800000005', 'rohan.kulkarni@demo.golf-os.example'),
  ('ASC-DEMO-006', 'Arjun Nair',     '+919800000006', 'arjun.nair@demo.golf-os.example')
) as m(no, name, phone, email)
where c.slug = 'asc-centre-bengaluru'
on conflict (course_id, member_no) do nothing;

-- Trigger functions need no EXECUTE grant (checked at CREATE TRIGGER time).
revoke execute on function public.slot_hold_players_flag_member() from public, anon, authenticated;
revoke execute on function public.booking_players_flag_member()   from public, anon, authenticated;

-- Demo member sheet (sample data only; replace with the club's sheet before real members go in).
update public.courses set member_sheet_url = 'https://docs.google.com/spreadsheets/d/1tK7JPET4PG1_W7cH9DfBZxeS-QRrfGlI8Hnfx9Vdle0/edit'
 where slug = 'asc-centre-bengaluru';
