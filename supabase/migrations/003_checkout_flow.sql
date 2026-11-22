-- =============================================================================
-- Golf OS — 003_checkout_flow.sql  (Phase 2)
-- Tee-sheet read model, checkout details on holds, caddy holds, server-side
-- pricing, Razorpay order/payment confirmation, cancellations and refunds,
-- payment and notification audit logs.
--
-- Payment model: a booking row exists only after Razorpay captures payment.
-- Until then everything lives on the slot hold (players, tee, mode, caddies,
-- quote, order id). confirm_hold_payment() turns a paid hold into a booking
-- or reports that the money must be refunded.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Course policy columns
-- -----------------------------------------------------------------------------
-- Cancellation policy contract:
-- { "tiers": [ { "min_hours_before": number,
--                "green_fee_refund_percent": 0-100,
--                "caddy_fee_refund_percent": 0-100 }, ... ],
--   "refund_convenience_fee": boolean }
-- The tier with the largest min_hours_before <= hours until tee time applies;
-- no matching tier = no refund.
create or replace function public.is_valid_cancellation_policy(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
           jsonb_typeof(p) = 'object'
       and jsonb_typeof(p -> 'tiers') = 'array'
       and jsonb_typeof(p -> 'refund_convenience_fee') = 'boolean'
       and not exists (
         select 1 from jsonb_array_elements(p -> 'tiers') t
         where coalesce(jsonb_typeof(t -> 'min_hours_before'), '') <> 'number'
            or coalesce(jsonb_typeof(t -> 'green_fee_refund_percent'), '') <> 'number'
            or coalesce(jsonb_typeof(t -> 'caddy_fee_refund_percent'), '') <> 'number'
            or (t ->> 'min_hours_before')::numeric < 0
            or (t ->> 'green_fee_refund_percent')::numeric not between 0 and 100
            or (t ->> 'caddy_fee_refund_percent')::numeric not between 0 and 100
       ),
         false);
$$;

alter table public.courses
  add column booking_cutoff_minutes smallint not null default 30
    check (booking_cutoff_minutes between 0 and 720),
  add column cancellation_policy jsonb not null default
    '{"tiers":[{"min_hours_before":24,"green_fee_refund_percent":100,"caddy_fee_refund_percent":100}],"refund_convenience_fee":false}'::jsonb
    check (public.is_valid_cancellation_policy(cancellation_policy));

-- -----------------------------------------------------------------------------
-- 2. Hold checkout state
-- -----------------------------------------------------------------------------
alter table public.slot_holds
  add column mode        public.round_mode not null default 'normal',
  add column tee_id      uuid,
  add column quote       jsonb,
  add column total_paise integer check (total_paise >= 0),
  add constraint slot_holds_tee_fk foreign key (course_id, tee_id)
    references public.course_tees (course_id, id);

create table public.slot_hold_players (
  hold_id      uuid not null references public.slot_holds (id) on delete cascade,
  seat_number  smallint not null check (seat_number between 1 and 4),
  full_name    text not null check (char_length(full_name) between 1 and 120),
  phone        text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email        text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_booker    boolean not null default false,
  primary key (hold_id, seat_number)
);
create unique index slot_hold_players_one_booker_idx on public.slot_hold_players (hold_id) where is_booker;

alter table public.caddy_assignments
  add column seat_number smallint check (seat_number between 1 and 4);
create unique index caddy_assignments_one_per_hold_seat_idx
  on public.caddy_assignments (slot_hold_id, seat_number) where status = 'held';
create unique index caddy_assignments_one_per_booking_seat_idx
  on public.caddy_assignments (booking_id, seat_number) where status in ('confirmed', 'completed');

alter table public.bookings
  add column refund_paise        integer not null default 0 check (refund_paise >= 0),
  add column razorpay_refund_id  text unique,
  add column refunded_at         timestamptz;

-- -----------------------------------------------------------------------------
-- 3. Audit logs
-- -----------------------------------------------------------------------------
create type public.notification_channel as enum ('email', 'whatsapp', 'sms');
create type public.notification_status  as enum ('queued', 'sent', 'failed', 'skipped');

create table public.payment_events (
  id                   bigint generated always as identity primary key,
  source               text not null check (source in ('checkout_callback', 'webhook', 'refund')),
  event_type           text not null,
  razorpay_order_id    text,
  razorpay_payment_id  text,
  razorpay_event_id    text unique,
  signature_verified   boolean not null,
  amount_paise         integer,
  result               text,
  payload              jsonb not null,
  received_at          timestamptz not null default now()
);
create index payment_events_order_idx on public.payment_events (razorpay_order_id);

create table public.notification_log (
  id                    uuid primary key default gen_random_uuid(),
  booking_id            uuid not null references public.bookings (id) on delete cascade,
  course_id             uuid not null references public.courses (id) on delete cascade,
  channel               public.notification_channel not null,
  template              text not null,
  recipient             text not null,
  status                public.notification_status not null default 'queued',
  attempts              smallint not null default 0,
  last_error            text,
  provider_message_id   text,
  created_at            timestamptz not null default now(),
  sent_at               timestamptz,
  unique (booking_id, channel, template, recipient)
);
create index notification_log_retry_idx on public.notification_log (status, attempts) where status in ('queued', 'failed');

alter table public.slot_hold_players enable row level security;
alter table public.payment_events    enable row level security;
alter table public.notification_log  enable row level security;

create policy slot_hold_players_select on public.slot_hold_players for select to authenticated
  using (exists (select 1 from public.slot_holds h
                 where h.id = hold_id
                   and (h.profile_id = (select auth.uid()) or public.is_course_admin(h.course_id))));

create policy notification_log_admin_select on public.notification_log for select to authenticated
  using (public.is_course_admin(course_id));

-- payment_events: no policies → invisible to anon/authenticated; service role only.
revoke insert, update, delete on public.slot_hold_players from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
revoke insert, update, delete on public.notification_log from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Tee-slot validation now honours the booking cut-off
-- -----------------------------------------------------------------------------
create or replace function public.resolve_tee_slot(
  p_course_id    uuid,
  p_play_date    date,
  p_tee_time     time,
  p_hole_format  public.hole_format
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course      public.courses%rowtype;
  v_last        time;
  v_starts_at   timestamptz;
  v_offset_min  integer;
  v_local_today date;
begin
  select * into v_course from public.courses where id = p_course_id;
  if not found or not v_course.is_active then
    raise exception 'course_not_bookable' using errcode = 'P0001';
  end if;

  if p_hole_format = 'back_9' and v_course.holes_count = 9 then
    raise exception 'back_nine_unavailable' using errcode = 'P0001';
  end if;

  if extract(isodow from p_play_date)::smallint = any (v_course.closed_weekdays) then
    raise exception 'course_closed_on_date' using errcode = 'P0001',
      detail = format('isodow %s is a closed day', extract(isodow from p_play_date));
  end if;

  v_last := case when p_hole_format = 'full_18' then v_course.last_tee_time_18 else v_course.last_tee_time_9 end;
  if p_tee_time < v_course.first_tee_time or p_tee_time > v_last then
    raise exception 'tee_time_outside_window' using errcode = 'P0001',
      detail = format('allowed %s to %s for %s', v_course.first_tee_time, v_last, p_hole_format);
  end if;

  v_offset_min := (extract(epoch from (p_tee_time - v_course.first_tee_time)) / 60)::integer;
  if v_offset_min % v_course.slot_interval_minutes <> 0
     or extract(second from p_tee_time) <> 0 then
    raise exception 'tee_time_off_grid' using errcode = 'P0001',
      detail = format('slots every %s minutes from %s', v_course.slot_interval_minutes, v_course.first_tee_time);
  end if;

  v_starts_at := (p_play_date + p_tee_time) at time zone v_course.timezone;
  if v_starts_at <= now() then
    raise exception 'tee_time_in_past' using errcode = 'P0001';
  end if;
  if v_starts_at <= now() + make_interval(mins => v_course.booking_cutoff_minutes) then
    raise exception 'inside_booking_cutoff' using errcode = 'P0001',
      detail = format('bookings close %s minutes before tee time', v_course.booking_cutoff_minutes);
  end if;

  v_local_today := (now() at time zone v_course.timezone)::date;
  if p_play_date > v_local_today + v_course.booking_window_days then
    raise exception 'beyond_booking_window' using errcode = 'P0001',
      detail = format('bookings open %s days ahead', v_course.booking_window_days);
  end if;

  return v_starts_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Pricing helpers
-- -----------------------------------------------------------------------------
create or replace function public.green_fee_per_player(
  p_pricing jsonb, p_play_date date, p_hole_format public.hole_format
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (p_pricing
          #>> array[
            case when extract(isodow from p_play_date)::int in
                      (select jsonb_array_elements_text(p_pricing -> 'weekend_isodow')::int)
                 then 'weekend' else 'weekday' end,
            case when p_hole_format = 'full_18' then 'eighteen_holes' else 'nine_holes' end
          ])::integer;
$$;

-- -----------------------------------------------------------------------------
-- 6. Tee sheet read model (public)
-- -----------------------------------------------------------------------------
create or replace function public.get_tee_sheet(p_course_id uuid, p_play_date date)
returns table (
  tee_time               time,
  start_hole             smallint,
  tee_starts_at          timestamptz,
  seats_taken            integer,
  seats_left             integer,
  is_private_locked      boolean,
  allows_front_9         boolean,
  allows_back_9          boolean,
  allows_full_18         boolean,
  unavailable_reason     text,
  price_9_paise          integer,
  price_18_paise         integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course  public.courses%rowtype;
  v_today   date;
  v_closed  boolean;
begin
  select * into v_course from public.courses
  where id = p_course_id and is_active and (is_published or public.is_course_admin(p_course_id));
  if not found then
    raise exception 'course_not_bookable' using errcode = 'P0001';
  end if;

  v_today  := (now() at time zone v_course.timezone)::date;
  v_closed := extract(isodow from p_play_date)::smallint = any (v_course.closed_weekdays);

  return query
  with slots as (
    select s::time as t, sh.h::smallint as hole
    from generate_series(
           p_play_date + v_course.first_tee_time,
           p_play_date + greatest(v_course.last_tee_time_18, v_course.last_tee_time_9),
           make_interval(mins => v_course.slot_interval_minutes)) s
    cross join (values (1), (10)) as sh(h)
    where sh.h = 1 or v_course.holes_count = 18
  ),
  occupants as (
    select b.tee_time as t, b.start_hole as hole,
           case when b.is_private then v_course.max_players_per_slot else b.player_count end as seats,
           b.is_private
    from public.bookings b
    where b.course_id = p_course_id and b.play_date = p_play_date
      and b.status in ('confirmed', 'checked_in', 'completed', 'no_show')
    union all
    select h.tee_time, h.start_hole,
           case when h.is_private then v_course.max_players_per_slot else h.seats end,
           h.is_private
    from public.slot_holds h
    where h.course_id = p_course_id and h.play_date = p_play_date
      and h.status = 'active' and h.expires_at > now()
  ),
  agg as (
    select o.t, o.hole, sum(o.seats)::integer as taken, bool_or(o.is_private) as priv
    from occupants o group by o.t, o.hole
  ),
  shaped as (
    select s.t, s.hole,
           (p_play_date + s.t) at time zone v_course.timezone as starts_at,
           coalesce(a.taken, 0) as taken,
           coalesce(a.priv, false) as priv
    from slots s left join agg a on a.t = s.t and a.hole = s.hole
  )
  select
    sh.t,
    sh.hole,
    sh.starts_at,
    least(sh.taken, v_course.max_players_per_slot::integer),
    greatest(v_course.max_players_per_slot - sh.taken, 0)::integer,
    sh.priv,
    sh.hole = 1  and sh.t <= v_course.last_tee_time_9,
    sh.hole = 10 and sh.t <= v_course.last_tee_time_9,
    sh.hole = 1  and sh.t <= v_course.last_tee_time_18,
    case
      when v_closed then 'course_closed_on_date'
      when p_play_date > v_today + v_course.booking_window_days then 'beyond_booking_window'
      when sh.starts_at <= now() then 'tee_time_in_past'
      when sh.starts_at <= now() + make_interval(mins => v_course.booking_cutoff_minutes) then 'inside_booking_cutoff'
      when sh.priv then 'private_four_ball'
      when sh.taken >= v_course.max_players_per_slot then 'slot_full'
      when sh.taken > 0 and not v_course.allow_join_open_batch then 'open_batch_join_disabled'
      else null
    end,
    public.green_fee_per_player(v_course.pricing, p_play_date, 'front_9'),
    public.green_fee_per_player(v_course.pricing, p_play_date, 'full_18')
  from shaped sh
  order by sh.t, sh.hole;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Checkout steps on a hold (hold owner only)
-- -----------------------------------------------------------------------------
create or replace function public.lock_own_active_hold(p_hold_id uuid)
returns public.slot_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.slot_holds%rowtype;
begin
  select * into v_hold from public.slot_holds where id = p_hold_id for update;
  if not found or v_hold.profile_id is distinct from auth.uid() then
    raise exception 'hold_not_found' using errcode = 'P0001';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if v_hold.razorpay_order_id is not null then
    raise exception 'hold_locked_for_payment' using errcode = 'P0001';
  end if;
  return v_hold;
end;
$$;

-- p_players: [{ "seat_number": 1, "full_name": "…", "phone": "+91…"?, "email": "…"?, "is_booker": true? }, …]
create or replace function public.save_hold_details(
  p_hold_id  uuid,
  p_players  jsonb,
  p_tee_id   uuid,
  p_mode     public.round_mode default 'normal'
)
returns setof public.slot_hold_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold   public.slot_holds%rowtype;
  v_count  integer;
begin
  v_hold := public.lock_own_active_hold(p_hold_id);

  if jsonb_typeof(p_players) <> 'array' then
    raise exception 'invalid_players' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_players);
  if (not v_hold.is_private and v_count <> v_hold.seats)
     or (v_hold.is_private and v_count not between 1 and v_hold.seats) then
    raise exception 'player_count_mismatch' using errcode = 'P0001',
      detail = format('hold has %s seat(s), %s player(s) given', v_hold.seats, v_count);
  end if;

  if not exists (select 1 from public.course_tees t
                 where t.id = p_tee_id and t.course_id = v_hold.course_id and t.is_active) then
    raise exception 'tee_not_available' using errcode = 'P0001';
  end if;

  delete from public.slot_hold_players where hold_id = p_hold_id;
  insert into public.slot_hold_players (hold_id, seat_number, full_name, phone, email, is_booker)
  select p_hold_id,
         (p ->> 'seat_number')::smallint,
         btrim(p ->> 'full_name'),
         nullif(btrim(p ->> 'phone'), ''),
         nullif(lower(btrim(p ->> 'email')), ''),
         coalesce((p ->> 'is_booker')::boolean, false)
  from jsonb_array_elements(p_players) p;

  if exists (select 1 from public.slot_hold_players where hold_id = p_hold_id and seat_number > v_count) then
    raise exception 'seat_numbers_not_contiguous' using errcode = 'P0001';
  end if;

  -- Caddies booked for seats that no longer exist are released.
  update public.caddy_assignments
     set status = 'released', hold_expires_at = null
   where slot_hold_id = p_hold_id and status = 'held' and seat_number > v_count;

  update public.slot_holds
     set tee_id = p_tee_id, mode = p_mode, quote = null, total_paise = null
   where id = p_hold_id;

  return query select * from public.slot_hold_players where hold_id = p_hold_id order by seat_number;
end;
$$;

create or replace function public.hold_caddy(p_hold_id uuid, p_caddy_id uuid, p_seat_number smallint)
returns public.caddy_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold    public.slot_holds%rowtype;
  v_course  public.courses%rowtype;
  v_caddy   public.caddies%rowtype;
  v_ends_at timestamptz;
  v_row     public.caddy_assignments%rowtype;
begin
  v_hold := public.lock_own_active_hold(p_hold_id);
  select * into v_course from public.courses where id = v_hold.course_id;

  if not exists (select 1 from public.slot_hold_players
                 where hold_id = p_hold_id and seat_number = p_seat_number) then
    raise exception 'seat_not_found' using errcode = 'P0001';
  end if;

  select * into v_caddy from public.caddies
  where id = p_caddy_id and course_id = v_hold.course_id and is_active and is_available;
  if not found then
    raise exception 'caddy_unavailable' using errcode = 'P0001';
  end if;

  v_ends_at := v_hold.tee_starts_at + make_interval(mins =>
    case when v_hold.hole_format = 'full_18' then v_course.round_duration_18_minutes
         else v_course.round_duration_9_minutes end);

  -- Free this seat's previous pick and any lapsed holds on the requested caddy.
  update public.caddy_assignments
     set status = 'released', hold_expires_at = null
   where (slot_hold_id = p_hold_id and seat_number = p_seat_number and status = 'held')
      or (caddy_id = p_caddy_id and status = 'held' and hold_expires_at <= now());

  begin
    insert into public.caddy_assignments (
      course_id, caddy_id, slot_hold_id, seat_number, hole_format,
      starts_at, ends_at, status, hold_expires_at, rate_paise
    ) values (
      v_hold.course_id, p_caddy_id, p_hold_id, p_seat_number, v_hold.hole_format,
      v_hold.tee_starts_at, v_ends_at, 'held', v_hold.expires_at,
      case when v_hold.hole_format = 'full_18' then v_caddy.daily_rate_18_paise else v_caddy.daily_rate_9_paise end
    ) returning * into v_row;
  exception when exclusion_violation then
    raise exception 'caddy_unavailable' using errcode = 'P0001',
      detail = 'caddy is booked for an overlapping tee window';
  end;

  update public.slot_holds set quote = null, total_paise = null where id = p_hold_id;
  return v_row;
end;
$$;

create or replace function public.release_hold_caddy(p_hold_id uuid, p_seat_number smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_own_active_hold(p_hold_id);
  update public.caddy_assignments
     set status = 'released', hold_expires_at = null
   where slot_hold_id = p_hold_id and seat_number = p_seat_number and status = 'held';
  update public.slot_holds set quote = null, total_paise = null where id = p_hold_id;
end;
$$;

-- Prices the hold from course data only and stores the result on it.
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
  v_green     integer;
  v_caddy     integer;
  v_addon     integer;
  v_fee       integer;
  v_quote     jsonb;
begin
  v_hold := public.lock_own_active_hold(p_hold_id);
  select * into v_course from public.courses where id = v_hold.course_id;

  select count(*) into v_players from public.slot_hold_players where hold_id = p_hold_id;
  if v_players = 0 or v_hold.tee_id is null then
    raise exception 'hold_details_missing' using errcode = 'P0001';
  end if;

  v_green := v_players * public.green_fee_per_player(v_course.pricing, v_hold.play_date, v_hold.hole_format);
  select coalesce(sum(rate_paise), 0)::integer into v_caddy
  from public.caddy_assignments where slot_hold_id = p_hold_id and status = 'held';
  v_addon := case when v_hold.mode = 'tournament'
                  then v_players * (v_course.pricing ->> 'tournament_entry_addon')::integer else 0 end;
  v_fee := round((v_green + v_caddy + v_addon)
                 * (v_course.pricing ->> 'platform_convenience_fee_percent')::numeric / 100)::integer;

  v_quote := jsonb_build_object(
    'currency', v_course.currency,
    'players', v_players,
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
-- 8. Payment (service role only)
-- -----------------------------------------------------------------------------
create or replace function public.attach_razorpay_order(p_hold_id uuid, p_order_id text, p_amount_paise integer)
returns public.slot_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold public.slot_holds%rowtype;
begin
  select * into v_hold from public.slot_holds where id = p_hold_id for update;
  if not found or v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_expired' using errcode = 'P0001';
  end if;
  if v_hold.total_paise is null or v_hold.total_paise <> p_amount_paise then
    raise exception 'quote_mismatch' using errcode = 'P0001';
  end if;
  if v_hold.razorpay_order_id is not null and v_hold.razorpay_order_id <> p_order_id then
    raise exception 'order_already_attached' using errcode = 'P0001';
  end if;

  update public.slot_holds set razorpay_order_id = p_order_id where id = p_hold_id returning * into v_hold;
  return v_hold;
end;
$$;

-- Links a guest to an existing verified account without telling the caller.
create or replace function public.match_profile_for_contact(p_phone text, p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where (p_email is not null and lower(u.email) = lower(p_email) and u.email_confirmed_at is not null)
     or (p_phone is not null and u.phone = ltrim(p_phone, '+') and u.phone_confirmed_at is not null)
  order by u.created_at
  limit 1;
$$;

-- Result: 'confirmed' | 'already_confirmed' | 'refund_amount_mismatch'
--       | 'refund_slot_taken' | 'refund_caddy_taken'
create or replace function public.confirm_hold_payment(
  p_order_id      text,
  p_payment_id    text,
  p_amount_paise  integer
)
returns table (result text, booking_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold        public.slot_holds%rowtype;
  v_course      public.courses%rowtype;
  v_existing    uuid;
  v_taken       integer;
  v_private     boolean;
  v_needed      integer;
  v_players     integer;
  v_booking     uuid;
  v_seat        record;
  v_profile     uuid;
begin
  select b.id into v_existing from public.bookings b where b.razorpay_payment_id = p_payment_id;
  if found then
    return query select 'already_confirmed'::text, v_existing;
    return;
  end if;

  select * into v_hold from public.slot_holds where razorpay_order_id = p_order_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_hold.status = 'converted' then
    return query select 'already_confirmed'::text, v_hold.converted_booking_id;
    return;
  end if;
  if p_amount_paise is distinct from v_hold.total_paise then
    return query select 'refund_amount_mismatch'::text, null::uuid;
    return;
  end if;

  select * into v_course from public.courses where id = v_hold.course_id;
  select count(*) into v_players from public.slot_hold_players where hold_id = v_hold.id;

  perform pg_advisory_xact_lock(public.slot_lock_key(v_hold.course_id, v_hold.play_date, v_hold.tee_time, v_hold.start_hole));
  select o.seats_taken, o.has_private into v_taken, v_private
  from public.slot_occupancy(v_hold.course_id, v_hold.play_date, v_hold.tee_time, v_hold.start_hole,
                             null, v_hold.id) o;
  v_needed := case when v_hold.is_private then v_course.max_players_per_slot else v_players end;

  if v_private or (v_hold.is_private and v_taken > 0)
     or v_taken + v_needed > v_course.max_players_per_slot then
    update public.slot_holds set status = 'expired', released_at = coalesce(released_at, now())
     where id = v_hold.id and status = 'active';
    update public.caddy_assignments set status = 'released', hold_expires_at = null
     where slot_hold_id = v_hold.id and status = 'held';
    return query select 'refund_slot_taken'::text, null::uuid;
    return;
  end if;

  -- Re-arm exactly the caddies that were priced into the order. They may have
  -- lapsed while the golfer was paying; if one was taken meanwhile, refund.
  begin
    update public.caddy_assignments a
       set status = 'held', hold_expires_at = now() + interval '1 minute'
     where a.slot_hold_id = v_hold.id
       and a.id in (select (jsonb_array_elements_text(v_hold.quote -> 'caddy_assignment_ids'))::uuid)
       and a.status in ('held', 'released');
  exception when exclusion_violation then
    update public.slot_holds set status = 'expired', released_at = coalesce(released_at, now())
     where id = v_hold.id and status = 'active';
    return query select 'refund_caddy_taken'::text, null::uuid;
    return;
  end;

  -- Anything still held on this hold but not priced in is dropped.
  update public.caddy_assignments a
     set status = 'released', hold_expires_at = null
   where a.slot_hold_id = v_hold.id and a.status = 'held'
     and a.id not in (select (jsonb_array_elements_text(v_hold.quote -> 'caddy_assignment_ids'))::uuid);

  insert into public.bookings (
    course_id, booked_by, slot_hold_id, play_date, tee_time, start_hole, tee_starts_at,
    hole_format, tee_id, player_count, is_private, mode, status, payment_status, currency,
    green_fee_paise, caddy_fee_paise, tournament_addon_paise, convenience_fee_paise, total_paise,
    razorpay_order_id, razorpay_payment_id, paid_at
  ) values (
    v_hold.course_id, v_hold.profile_id, v_hold.id, v_hold.play_date, v_hold.tee_time,
    v_hold.start_hole, v_hold.tee_starts_at, v_hold.hole_format, v_hold.tee_id, v_players,
    v_hold.is_private, v_hold.mode, 'confirmed', 'paid', v_course.currency,
    (v_hold.quote ->> 'green_fee_paise')::integer,
    (v_hold.quote ->> 'caddy_fee_paise')::integer,
    (v_hold.quote ->> 'tournament_addon_paise')::integer,
    (v_hold.quote ->> 'convenience_fee_paise')::integer,
    v_hold.total_paise, p_order_id, p_payment_id, now()
  ) returning id into v_booking;

  for v_seat in
    select * from public.slot_hold_players where hold_id = v_hold.id order by seat_number
  loop
    v_profile := case when v_seat.is_booker then v_hold.profile_id
                      else public.match_profile_for_contact(v_seat.phone, v_seat.email) end;
    if v_profile is not null and exists (select 1 from public.booking_players bp
                                         where bp.booking_id = v_booking and bp.profile_id = v_profile) then
      v_profile := null;
    end if;
    insert into public.booking_players (booking_id, seat_number, full_name, phone, email, profile_id, is_booker)
    values (v_booking, v_seat.seat_number, v_seat.full_name, v_seat.phone, v_seat.email, v_profile, v_seat.is_booker);
  end loop;

  update public.caddy_assignments a
     set booking_player_id = bp.id
    from public.booking_players bp
   where a.booking_id = v_booking and bp.booking_id = v_booking and bp.seat_number = a.seat_number;

  return query select 'confirmed'::text, v_booking;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Cancellation and refunds
-- -----------------------------------------------------------------------------
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns table (refund_paise integer, booking_status public.booking_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_course  public.courses%rowtype;
  v_hours   numeric;
  v_tier    jsonb;
  v_refund  integer := 0;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  -- current_user is the function owner here, so the caller is identified by
  -- JWT subject: present for golfers and admins, absent for the service role.
  if not found
     or (auth.uid() is not null
         and v_booking.booked_by is distinct from auth.uid()
         and not public.is_course_admin(v_booking.course_id)) then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'booking_not_cancellable' using errcode = 'P0001';
  end if;
  if v_booking.tee_starts_at <= now() then
    raise exception 'tee_time_in_past' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.rounds r where r.booking_id = p_booking_id) then
    raise exception 'round_already_started' using errcode = 'P0001';
  end if;

  select * into v_course from public.courses where id = v_booking.course_id;
  v_hours := extract(epoch from (v_booking.tee_starts_at - now())) / 3600;

  select t into v_tier
  from jsonb_array_elements(v_course.cancellation_policy -> 'tiers') t
  where (t ->> 'min_hours_before')::numeric <= v_hours
  order by (t ->> 'min_hours_before')::numeric desc
  limit 1;

  if v_tier is not null and v_booking.payment_status = 'paid' then
    v_refund := floor((v_booking.green_fee_paise + v_booking.tournament_addon_paise)
                      * (v_tier ->> 'green_fee_refund_percent')::numeric / 100)::integer
              + floor(v_booking.caddy_fee_paise * (v_tier ->> 'caddy_fee_refund_percent')::numeric / 100)::integer
              + case when (v_course.cancellation_policy ->> 'refund_convenience_fee')::boolean
                     then v_booking.convenience_fee_paise else 0 end;
  end if;

  update public.bookings
     set status = 'cancelled',
         cancellation_reason = p_reason,
         refund_paise = v_refund,
         payment_status = case when v_refund > 0 then 'refund_pending'::public.payment_status else payment_status end
   where id = p_booking_id;

  return query select v_refund, 'cancelled'::public.booking_status;
end;
$$;

create or replace function public.mark_booking_refunded(p_booking_id uuid, p_refund_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
     set payment_status = 'refunded',
         status = case when status = 'cancelled' then 'refunded'::public.booking_status else status end,
         razorpay_refund_id = p_refund_id,
         refunded_at = now()
   where id = p_booking_id and payment_status = 'refund_pending';
end;
$$;

-- Caddy names for a golfer's own hold or booking (caddies table itself is PII).
create or replace function public.get_hold_caddies(p_hold_id uuid)
returns table (
  assignment_id uuid, seat_number smallint, caddy_id uuid, caddy_code text,
  full_name text, grade public.caddy_grade, rating numeric, rate_paise integer, hold_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.seat_number, c.id, c.caddy_code, c.full_name, c.grade, c.rating, a.rate_paise, a.hold_expires_at
  from public.caddy_assignments a
  join public.slot_holds h on h.id = a.slot_hold_id
  join public.caddies c on c.id = a.caddy_id
  where a.slot_hold_id = p_hold_id
    and a.status = 'held'
    and h.profile_id = auth.uid()
  order by a.seat_number;
$$;

create or replace function public.get_booking_caddies(p_booking_id uuid)
returns table (
  seat_number smallint, caddy_code text, full_name text, grade public.caddy_grade,
  rating numeric, photo_url text, rate_paise integer, status public.caddy_assignment_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.seat_number, c.caddy_code, c.full_name, c.grade, c.rating, c.photo_url, a.rate_paise, a.status
  from public.caddy_assignments a
  join public.caddies c on c.id = a.caddy_id
  join public.bookings b on b.id = a.booking_id
  where a.booking_id = p_booking_id
    and a.status in ('confirmed', 'completed', 'cancelled')
    and (public.is_booking_participant(p_booking_id) or public.is_course_admin(b.course_id))
  order by a.seat_number;
$$;

-- A refund claim per payment makes refunds idempotent across the checkout
-- callback and webhook racing on the same payment.
create unique index payment_events_one_refund_per_payment_idx
  on public.payment_events (razorpay_payment_id) where source = 'refund';

-- -----------------------------------------------------------------------------
-- 10. Privileges
-- -----------------------------------------------------------------------------
revoke execute on function public.lock_own_active_hold(uuid)                         from public, anon, authenticated;
revoke execute on function public.attach_razorpay_order(uuid, text, integer)         from public, anon, authenticated;
revoke execute on function public.confirm_hold_payment(text, text, integer)          from public, anon, authenticated;
revoke execute on function public.mark_booking_refunded(uuid, text)                  from public, anon, authenticated;
revoke execute on function public.match_profile_for_contact(text, text)              from public, anon, authenticated;

revoke execute on function public.save_hold_details(uuid, jsonb, uuid, public.round_mode) from anon;
revoke execute on function public.hold_caddy(uuid, uuid, smallint)                        from anon;
revoke execute on function public.release_hold_caddy(uuid, smallint)                      from anon;
revoke execute on function public.quote_slot_hold(uuid)                                   from anon;
revoke execute on function public.cancel_booking(uuid, text)                              from anon;

grant execute on function public.attach_razorpay_order(uuid, text, integer)          to service_role;
grant execute on function public.confirm_hold_payment(text, text, integer)           to service_role;
grant execute on function public.mark_booking_refunded(uuid, text)                   to service_role;
grant execute on function public.cancel_booking(uuid, text)                          to service_role;
grant select, insert, update, delete on public.payment_events                        to service_role;
grant usage on sequence public.payment_events_id_seq                                 to service_role;
grant select, insert, update on public.notification_log                              to service_role;

grant execute on function public.get_tee_sheet(uuid, date)                                to anon, authenticated;
grant execute on function public.save_hold_details(uuid, jsonb, uuid, public.round_mode)  to authenticated;
grant execute on function public.hold_caddy(uuid, uuid, smallint)                         to authenticated;
grant execute on function public.release_hold_caddy(uuid, smallint)                       to authenticated;
grant execute on function public.quote_slot_hold(uuid)                                    to authenticated;
grant execute on function public.cancel_booking(uuid, text)                               to authenticated;
grant execute on function public.get_hold_caddies(uuid)                                   to authenticated;
grant execute on function public.get_booking_caddies(uuid)                                to authenticated;
revoke execute on function public.get_hold_caddies(uuid)                                  from anon;
revoke execute on function public.get_booking_caddies(uuid)                               from anon;

commit;
