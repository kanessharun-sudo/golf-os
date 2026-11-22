-- =============================================================================
-- Golf OS — 001_initial_schema.sql
-- Multi-tenant tee-time booking, live batch scoring, dual (9/18) handicaps,
-- caddy marketplace with immutable two-way ledger, social golfer profiles.
--
-- Conventions
--   * Every tenant-owned row carries course_id; composite FKs (course_id, id)
--     make cross-tenant references impossible at the database level.
--   * Money is stored as integer paise (INR x 100) in *_paise columns, which
--     matches Razorpay / RazorpayX amounts and avoids floating point.
--   * Tee times are wall-clock times in courses.timezone; tee_starts_at is the
--     resolved absolute instant used for overlap and "is it in the past" maths.
--   * Client writes for money/capacity paths go through SECURITY DEFINER RPCs.
--     RLS policies are written so that a compromised anon key cannot bypass them.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
create type public.app_role                as enum ('golfer', 'caddy', 'course_admin', 'super_admin');
create type public.hole_format             as enum ('front_9', 'back_9', 'full_18');
create type public.nine_side               as enum ('front', 'back');
create type public.tee_gender              as enum ('men', 'ladies', 'unisex');
create type public.slot_hold_status        as enum ('active', 'converted', 'released', 'expired');
create type public.booking_status          as enum ('confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'refunded');
create type public.payment_status          as enum ('paid', 'refund_pending', 'refunded', 'waived');
create type public.round_mode              as enum ('normal', 'tournament');
create type public.round_status            as enum ('scheduled', 'in_progress', 'completed', 'abandoned');
create type public.caddy_grade             as enum ('grade_a', 'grade_b', 'grade_c');
create type public.caddy_assignment_status as enum ('held', 'confirmed', 'completed', 'released', 'cancelled');
create type public.ledger_entry_type       as enum ('round_earning', 'tip', 'adjustment', 'payout', 'payout_reversal');
create type public.ledger_direction        as enum ('credit', 'debit');
create type public.payout_status           as enum ('requested', 'approved', 'processing', 'paid', 'rejected', 'failed', 'cancelled');
create type public.handicap_track          as enum ('nine_hole', 'eighteen_hole');
create type public.gallery_category        as enum ('tournament', 'course', 'round', 'social');

-- -----------------------------------------------------------------------------
-- 2. Generic helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the statement runs as an end user (PostgREST anon/authenticated)
-- rather than service_role, postgres, or inside a SECURITY DEFINER function.
-- Only meaningful inside SECURITY INVOKER code: a definer function always sees
-- its owner as current_user, so guard triggers below are declared invoker.
create or replace function public.is_end_user_context()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('anon', 'authenticated');
$$;

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Pricing JSON contract (all amounts in paise):
-- { "weekday": {"nine_holes": int, "eighteen_holes": int},
--   "weekend": {"nine_holes": int, "eighteen_holes": int},
--   "weekend_isodow": [6,7],
--   "tournament_entry_addon": int,
--   "platform_convenience_fee_percent": number }
create or replace function public.is_valid_course_pricing(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(p #> '{weekday,nine_holes}') = 'number'     and (p #>> '{weekday,nine_holes}')::numeric     >= 0
    and jsonb_typeof(p #> '{weekday,eighteen_holes}') = 'number' and (p #>> '{weekday,eighteen_holes}')::numeric >= 0
    and jsonb_typeof(p #> '{weekend,nine_holes}') = 'number'     and (p #>> '{weekend,nine_holes}')::numeric     >= 0
    and jsonb_typeof(p #> '{weekend,eighteen_holes}') = 'number' and (p #>> '{weekend,eighteen_holes}')::numeric >= 0
    and jsonb_typeof(p -> 'weekend_isodow') = 'array'
    and jsonb_typeof(p -> 'tournament_entry_addon') = 'number'   and (p ->> 'tournament_entry_addon')::numeric   >= 0
    and jsonb_typeof(p -> 'platform_convenience_fee_percent') = 'number'
    and (p ->> 'platform_convenience_fee_percent')::numeric between 0 and 100;
$$;

-- Media JSON contract: { "hero_banner"?: text, "clubhouse"?: text,
--   "signature_hole"?: text, "gallery"?: text[] }
create or replace function public.is_valid_course_media(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and (p -> 'gallery' is null or jsonb_typeof(p -> 'gallery') = 'array');
$$;

-- -----------------------------------------------------------------------------
-- 3. Profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  username             text not null unique
                         check (username ~ '^[a-z0-9][a-z0-9_.]{2,29}$'),
  full_name            text not null check (char_length(full_name) between 1 and 120),
  avatar_url           text,
  bio                  text check (char_length(bio) <= 500),
  golfing_since        smallint check (golfing_since between 1900 and 2100),
  home_course_id       uuid,
  role                 public.app_role not null default 'golfer',
  is_profile_public    boolean not null default true,
  handicap_18          numeric(3,1) check (handicap_18 between -10.0 and 54.0),
  avg_score_18         numeric(5,2),
  rounds_counted_18    smallint not null default 0,
  handicap_9           numeric(3,1) check (handicap_9 between -10.0 and 54.0),
  avg_score_9          numeric(5,2),
  rounds_counted_9     smallint not null default 0,
  handicap_updated_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Courses (tenants)
-- -----------------------------------------------------------------------------
create table public.courses (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                        text not null,
  short_name                  text,
  tagline                     text,
  description                 text,
  established_year            smallint check (established_year between 1700 and 2100),
  course_type                 text,
  area                        text,
  city                        text not null,
  state                       text,
  postal_code                 text,
  country                     text not null default 'India',
  latitude                    numeric(9,6) check (latitude between -90 and 90),
  longitude                   numeric(9,6) check (longitude between -180 and 180),
  timezone                    text not null default 'Asia/Kolkata',
  currency                    char(3) not null default 'INR',
  holes_count                 smallint not null default 18 check (holes_count in (9, 18)),
  -- Tee-sheet engine
  first_tee_time              time not null default '05:00',
  last_tee_time_18            time not null default '13:30',
  last_tee_time_9             time not null default '15:45',
  slot_interval_minutes       smallint not null default 15 check (slot_interval_minutes between 5 and 60),
  max_players_per_slot        smallint not null default 4 check (max_players_per_slot between 1 and 4),
  min_players_per_booking     smallint not null default 1 check (min_players_per_booking between 1 and 4),
  allow_join_open_batch       boolean not null default true,
  checkout_hold_minutes       smallint not null default 7 check (checkout_hold_minutes between 1 and 30),
  round_duration_9_minutes    smallint not null default 135 check (round_duration_9_minutes between 30 and 480),
  round_duration_18_minutes   smallint not null default 270 check (round_duration_18_minutes between 60 and 720),
  booking_window_days         smallint not null default 30 check (booking_window_days between 1 and 365),
  closed_weekdays             smallint[] not null default '{}'
                                check (closed_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  -- Commercials
  pricing                     jsonb not null check (public.is_valid_course_pricing(pricing)),
  caddy_commission_percent    numeric(5,2) not null default 0 check (caddy_commission_percent between 0 and 100),
  -- Showcase
  facilities                  text[] not null default '{}',
  media                       jsonb not null default '{}'::jsonb check (public.is_valid_course_media(media)),
  is_active                   boolean not null default true,
  is_published                boolean not null default false,
  created_by                  uuid references public.profiles (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint courses_last_tee_18_after_first check (last_tee_time_18 >= first_tee_time),
  constraint courses_last_tee_9_after_first  check (last_tee_time_9  >= first_tee_time),
  constraint courses_min_le_max_players      check (min_players_per_booking <= max_players_per_slot)
);

create or replace function public.courses_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Raises invalid_parameter_value for an unknown IANA zone.
  perform now() at time zone new.timezone;
  return new;
end;
$$;

create trigger courses_validate
  before insert or update of timezone on public.courses
  for each row execute function public.courses_validate();

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute function public.set_updated_at();

alter table public.profiles
  add constraint profiles_home_course_fk
  foreign key (home_course_id) references public.courses (id) on delete set null;

create table public.course_admins (
  course_id   uuid not null references public.courses (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (course_id, profile_id)
);
create index course_admins_profile_idx on public.course_admins (profile_id);

create table public.course_tees (
  id                     uuid primary key default gen_random_uuid(),
  course_id              uuid not null references public.courses (id) on delete cascade,
  name                   text not null,
  color_hex              text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  gender                 public.tee_gender not null default 'unisex',
  sort_order             smallint not null default 0,
  par_18                 smallint check (par_18 between 54 and 80),
  par_front_9            smallint check (par_front_9 between 27 and 40),
  par_back_9             smallint check (par_back_9 between 27 and 40),
  total_yards            integer check (total_yards between 1000 and 9000),
  -- NULL rating/slope = unrated; engine falls back to slope 113 and par.
  course_rating_18       numeric(4,1) check (course_rating_18 between 50 and 85),
  slope_rating_18        smallint check (slope_rating_18 between 55 and 155),
  course_rating_front_9  numeric(4,1) check (course_rating_front_9 between 25 and 45),
  slope_rating_front_9   smallint check (slope_rating_front_9 between 55 and 155),
  course_rating_back_9   numeric(4,1) check (course_rating_back_9 between 25 and 45),
  slope_rating_back_9    smallint check (slope_rating_back_9 between 55 and 155),
  is_default             boolean not null default false,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (course_id, name),
  unique (course_id, id)
);
create unique index course_tees_one_default_idx on public.course_tees (course_id) where is_default;
create trigger course_tees_set_updated_at
  before update on public.course_tees
  for each row execute function public.set_updated_at();

create table public.course_holes (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses (id) on delete cascade,
  hole_number   smallint not null check (hole_number between 1 and 18),
  nine          public.nine_side generated always as
                  (case when hole_number <= 9 then 'front'::public.nine_side else 'back'::public.nine_side end) stored,
  par           smallint not null check (par between 3 and 6),
  stroke_index  smallint not null check (stroke_index between 1 and 18),
  name          text,
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (course_id, hole_number),
  unique (course_id, id),
  -- Deferrable so admins can swap two stroke indexes in one transaction.
  constraint course_holes_unique_si unique (course_id, stroke_index) deferrable initially deferred
);
create trigger course_holes_set_updated_at
  before update on public.course_holes
  for each row execute function public.set_updated_at();

create table public.hole_yardages (
  course_id   uuid not null,
  hole_id     uuid not null,
  tee_id      uuid not null,
  yards       smallint not null check (yards between 40 and 800),
  primary key (hole_id, tee_id),
  foreign key (course_id, hole_id) references public.course_holes (course_id, id) on delete cascade,
  foreign key (course_id, tee_id)  references public.course_tees  (course_id, id) on delete cascade
);
create index hole_yardages_course_idx on public.hole_yardages (course_id);

-- -----------------------------------------------------------------------------
-- 5. Caddies
-- -----------------------------------------------------------------------------
create table public.caddy_rate_tiers (
  course_id      uuid not null references public.courses (id) on delete cascade,
  grade          public.caddy_grade not null,
  label          text not null,
  description    text,
  rate_9_paise   integer not null check (rate_9_paise >= 0),
  rate_18_paise  integer not null check (rate_18_paise >= 0),
  primary key (course_id, grade)
);

create table public.caddies (
  id                   uuid primary key default gen_random_uuid(),
  course_id            uuid not null references public.courses (id) on delete cascade,
  profile_id           uuid unique references public.profiles (id) on delete set null,
  caddy_code           text not null check (caddy_code ~ '^[A-Z0-9-]{2,20}$'),
  full_name            text not null,
  phone                text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  grade                public.caddy_grade not null,
  daily_rate_9_paise   integer not null check (daily_rate_9_paise >= 0),
  daily_rate_18_paise  integer not null check (daily_rate_18_paise >= 0),
  upi_id               text check (upi_id ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9.-]{1,63}$'),
  years_experience     smallint check (years_experience between 0 and 70),
  rating               numeric(2,1) check (rating between 0 and 5),
  photo_url            text,
  bio                  text check (char_length(bio) <= 500),
  is_available         boolean not null default true,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (course_id, caddy_code),
  unique (course_id, id)
);
create trigger caddies_set_updated_at
  before update on public.caddies
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Tee sheet: holds and bookings
-- -----------------------------------------------------------------------------
create table public.slot_holds (
  id                    uuid primary key default gen_random_uuid(),
  course_id             uuid not null references public.courses (id) on delete cascade,
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  play_date             date not null,
  tee_time              time not null,
  start_hole            smallint not null check (start_hole in (1, 10)),
  hole_format           public.hole_format not null,
  seats                 smallint not null check (seats between 1 and 4),
  is_private            boolean not null default false,
  tee_starts_at         timestamptz not null,
  status                public.slot_hold_status not null default 'active',
  expires_at            timestamptz not null,
  razorpay_order_id     text unique,
  converted_booking_id  uuid,
  released_at           timestamptz,
  created_at            timestamptz not null default now(),
  constraint slot_holds_back9_starts_10 check ((hole_format = 'back_9') = (start_hole = 10))
);
create unique index slot_holds_one_active_per_user_idx on public.slot_holds (profile_id) where status = 'active';
create index slot_holds_slot_active_idx on public.slot_holds (course_id, play_date, tee_time, start_hole) where status = 'active';

create table public.bookings (
  id                      uuid primary key default gen_random_uuid(),
  booking_ref             text not null unique,
  course_id               uuid not null references public.courses (id) on delete restrict,
  booked_by               uuid not null references public.profiles (id) on delete restrict,
  slot_hold_id            uuid unique references public.slot_holds (id) on delete set null,
  play_date               date not null,
  tee_time                time not null,
  start_hole              smallint not null check (start_hole in (1, 10)),
  tee_starts_at           timestamptz not null,
  hole_format             public.hole_format not null,
  tee_id                  uuid,
  player_count            smallint not null check (player_count between 1 and 4),
  is_private              boolean not null default false,
  mode                    public.round_mode not null default 'normal',
  status                  public.booking_status not null default 'confirmed',
  payment_status          public.payment_status not null default 'paid',
  currency                char(3) not null default 'INR',
  green_fee_paise         integer not null default 0 check (green_fee_paise >= 0),
  caddy_fee_paise         integer not null default 0 check (caddy_fee_paise >= 0),
  tournament_addon_paise  integer not null default 0 check (tournament_addon_paise >= 0),
  convenience_fee_paise   integer not null default 0 check (convenience_fee_paise >= 0),
  total_paise             integer not null check (total_paise >= 0),
  razorpay_order_id       text unique,
  razorpay_payment_id     text unique,
  paid_at                 timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (course_id, id),
  foreign key (course_id, tee_id) references public.course_tees (course_id, id),
  constraint bookings_back9_starts_10 check ((hole_format = 'back_9') = (start_hole = 10)),
  constraint bookings_total_matches check (
    total_paise = green_fee_paise + caddy_fee_paise + tournament_addon_paise + convenience_fee_paise
  )
);
create index bookings_slot_idx on public.bookings (course_id, play_date, tee_time, start_hole);
create index bookings_booked_by_idx on public.bookings (booked_by, play_date desc);

alter table public.slot_holds
  add constraint slot_holds_converted_booking_fk
  foreign key (converted_booking_id) references public.bookings (id) on delete set null;

create table public.booking_players (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  seat_number  smallint not null check (seat_number between 1 and 4),
  full_name    text not null check (char_length(full_name) between 1 and 120),
  phone        text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email        text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  profile_id   uuid references public.profiles (id) on delete set null,
  is_booker    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (booking_id, seat_number),
  unique (booking_id, profile_id)
);
create index booking_players_profile_idx on public.booking_players (profile_id) where profile_id is not null;

create table public.caddy_assignments (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null,
  caddy_id           uuid not null,
  booking_id         uuid references public.bookings (id) on delete cascade,
  slot_hold_id       uuid references public.slot_holds (id) on delete cascade,
  booking_player_id  uuid references public.booking_players (id) on delete set null,
  hole_format        public.hole_format not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  status             public.caddy_assignment_status not null default 'held',
  hold_expires_at    timestamptz,
  rate_paise         integer not null check (rate_paise >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (course_id, caddy_id) references public.caddies (course_id, id) on delete restrict,
  constraint caddy_assignments_has_parent check (num_nonnulls(booking_id, slot_hold_id) >= 1),
  constraint caddy_assignments_window check (ends_at > starts_at),
  constraint caddy_assignments_held_expiry check ((status = 'held') = (hold_expires_at is not null)),
  -- Hard guarantee: one caddy cannot be in two overlapping tee windows.
  constraint caddy_assignments_no_overlap exclude using gist (
    caddy_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('held', 'confirmed', 'completed'))
);
create index caddy_assignments_booking_idx on public.caddy_assignments (booking_id);
create index caddy_assignments_hold_idx on public.caddy_assignments (slot_hold_id);
create trigger caddy_assignments_set_updated_at
  before update on public.caddy_assignments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Rounds and scoring
-- -----------------------------------------------------------------------------
create table public.rounds (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null unique references public.bookings (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete restrict,
  hole_format      public.hole_format not null,
  start_hole       smallint not null check (start_hole in (1, 10)),
  mode             public.round_mode not null default 'normal',
  status           public.round_status not null default 'scheduled',
  tournament_name  text,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (course_id, id)
);
create index rounds_course_status_idx on public.rounds (course_id, status);

create table public.round_players (
  id                       uuid primary key default gen_random_uuid(),
  round_id                 uuid not null references public.rounds (id) on delete cascade,
  course_id                uuid not null,
  booking_player_id        uuid not null unique references public.booking_players (id) on delete cascade,
  profile_id               uuid references public.profiles (id) on delete set null,
  tee_id                   uuid not null,
  display_name             text not null,
  handicap_index_at_start  numeric(3,1),
  course_handicap          smallint,
  holes_played             smallint not null default 0,
  gross_score              smallint,
  adjusted_gross_score     smallint,
  net_score                smallint,
  score_differential       numeric(4,1),
  is_complete              boolean not null default false,
  counts_for_handicap      boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (round_id, profile_id),
  foreign key (course_id, tee_id) references public.course_tees (course_id, id)
);
create index round_players_profile_idx on public.round_players (profile_id) where profile_id is not null;

create table public.hole_scores (
  id                   uuid primary key default gen_random_uuid(),
  round_id             uuid not null references public.rounds (id) on delete cascade,
  round_player_id      uuid not null references public.round_players (id) on delete cascade,
  hole_number          smallint not null check (hole_number between 1 and 18),
  strokes              smallint not null check (strokes between 1 and 20),
  putts                smallint check (putts between 0 and 10),
  penalties            smallint not null default 0 check (penalties between 0 and 10),
  fairway_hit          boolean,
  green_in_regulation  boolean,
  -- Snapshots so later course edits never rewrite history.
  par                  smallint not null,
  stroke_index         smallint not null,
  strokes_received     smallint not null default 0,
  adjusted_strokes     smallint not null,
  recorded_by          uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (round_player_id, hole_number)
);
create index hole_scores_round_idx on public.hole_scores (round_id);

create table public.handicap_snapshots (
  id               bigint generated always as identity primary key,
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  track            public.handicap_track not null,
  handicap_index   numeric(3,1),
  avg_score        numeric(5,2),
  rounds_counted   smallint not null,
  trigger_round_id uuid references public.rounds (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index handicap_snapshots_profile_idx on public.handicap_snapshots (profile_id, track, created_at);

-- -----------------------------------------------------------------------------
-- 8. Caddy ledger and payouts
-- -----------------------------------------------------------------------------
create table public.caddy_payout_requests (
  id                   uuid primary key default gen_random_uuid(),
  caddy_id             uuid not null references public.caddies (id) on delete restrict,
  course_id            uuid not null references public.courses (id) on delete restrict,
  amount_paise         integer not null check (amount_paise > 0),
  upi_id               text not null,
  status               public.payout_status not null default 'requested',
  note                 text,
  requested_by         uuid references public.profiles (id) on delete set null,
  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  rejection_reason     text,
  razorpayx_payout_id  text unique,
  utr                  text,
  failure_reason       text,
  paid_at              timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index caddy_payout_one_open_idx on public.caddy_payout_requests (caddy_id)
  where status in ('requested', 'approved', 'processing');
create trigger caddy_payout_requests_set_updated_at
  before update on public.caddy_payout_requests
  for each row execute function public.set_updated_at();

create table public.caddy_ledger (
  id                   bigint generated always as identity primary key,
  caddy_id             uuid not null references public.caddies (id) on delete restrict,
  course_id            uuid not null references public.courses (id) on delete restrict,
  entry_type           public.ledger_entry_type not null,
  direction            public.ledger_direction not null,
  amount_paise         integer not null check (amount_paise > 0),
  balance_after_paise  bigint not null check (balance_after_paise >= 0),
  caddy_assignment_id  uuid unique references public.caddy_assignments (id) on delete restrict,
  payout_request_id    uuid references public.caddy_payout_requests (id) on delete restrict,
  description          text,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint caddy_ledger_direction_matches_type check (
    (entry_type in ('round_earning', 'tip', 'payout_reversal') and direction = 'credit')
    or (entry_type = 'payout' and direction = 'debit')
    or entry_type = 'adjustment'
  ),
  constraint caddy_ledger_earning_has_assignment check (
    (entry_type = 'round_earning') = (caddy_assignment_id is not null)
  ),
  constraint caddy_ledger_payout_has_request check (
    entry_type not in ('payout', 'payout_reversal') or payout_request_id is not null
  )
);
create unique index caddy_ledger_one_entry_per_payout_idx
  on public.caddy_ledger (payout_request_id, entry_type) where payout_request_id is not null;
create index caddy_ledger_caddy_idx on public.caddy_ledger (caddy_id, id desc);

-- -----------------------------------------------------------------------------
-- 9. Social gallery
-- -----------------------------------------------------------------------------
create table public.gallery_photos (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  course_id     uuid references public.courses (id) on delete set null,
  round_id      uuid references public.rounds (id) on delete set null,
  storage_path  text not null unique,
  caption       text check (char_length(caption) <= 280),
  category      public.gallery_category not null default 'course',
  width         integer check (width > 0),
  height        integer check (height > 0),
  taken_at      timestamptz,
  is_public     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint gallery_photos_path_owned check (split_part(storage_path, '/', 1) = profile_id::text)
);
create index gallery_photos_profile_idx on public.gallery_photos (profile_id, created_at desc);

-- =============================================================================
-- 10. Authorization helpers (SECURITY DEFINER to avoid RLS recursion)
-- =============================================================================
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin'
  );
$$;

create or replace function public.is_course_admin(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or exists (
        select 1 from public.course_admins ca
        where ca.course_id = p_course_id and ca.profile_id = auth.uid()
      );
$$;

create or replace function public.is_course_visible(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.is_active and c.is_published
  ) or public.is_course_admin(p_course_id);
$$;

create or replace function public.current_caddy_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.caddies c where c.profile_id = auth.uid() and c.is_active;
$$;

create or replace function public.is_booking_participant(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.booked_by = auth.uid()
  ) or exists (
    select 1 from public.booking_players bp
    where bp.booking_id = p_booking_id and bp.profile_id = auth.uid()
  );
$$;

create or replace function public.is_round_participant(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rounds r
    where r.id = p_round_id and public.is_booking_participant(r.booking_id)
  );
$$;

create or replace function public.is_public_round_player(p_round_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.round_players rp
    join public.rounds r on r.id = rp.round_id
    join public.profiles p on p.id = rp.profile_id
    where rp.id = p_round_player_id
      and r.status = 'completed'
      and p.is_profile_public
  );
$$;

-- =============================================================================
-- 11. Profile lifecycle
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_base      text;
  v_username  text;
  v_full_name text;
begin
  v_base := lower(coalesce(v_meta ->> 'username', split_part(new.email, '@', 1), 'golfer'));
  v_base := regexp_replace(v_base, '[^a-z0-9_.]', '', 'g');
  v_base := regexp_replace(v_base, '^[^a-z0-9]+', '');
  if char_length(v_base) < 3 then
    v_base := 'golfer' || v_base;
  end if;
  v_base := left(v_base, 24);
  v_username := v_base;

  while exists (select 1 from public.profiles where username = v_username) loop
    v_username := v_base || '_' || substr(md5(gen_random_uuid()::text), 1, 4);
  end loop;

  v_full_name := coalesce(nullif(trim(v_meta ->> 'full_name'), ''),
                          nullif(trim(v_meta ->> 'name'), ''),
                          v_username);

  insert into public.profiles (id, username, full_name, avatar_url)
  values (new.id, v_username, left(v_full_name, 120), v_meta ->> 'avatar_url');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- End users may edit their own profile but never role or computed handicap data.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_end_user_context() and not public.is_super_admin() then
    if new.role                is distinct from old.role
    or new.handicap_18         is distinct from old.handicap_18
    or new.avg_score_18        is distinct from old.avg_score_18
    or new.rounds_counted_18   is distinct from old.rounds_counted_18
    or new.handicap_9          is distinct from old.handicap_9
    or new.avg_score_9         is distinct from old.avg_score_9
    or new.rounds_counted_9    is distinct from old.rounds_counted_9
    or new.handicap_updated_at is distinct from old.handicap_updated_at then
      raise exception 'profile_privileged_column'
        using errcode = '42501', hint = 'role and handicap fields are system-managed';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

-- Caddies may toggle availability and edit bio/photo; everything else is admin-only.
create or replace function public.caddies_guard_self_service()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if public.is_end_user_context() and not public.is_course_admin(old.course_id) then
    if (to_jsonb(new) - array['is_available', 'bio', 'photo_url', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['is_available', 'bio', 'photo_url', 'updated_at']) then
      raise exception 'caddy_self_service_column'
        using errcode = '42501', hint = 'caddies may only change is_available, bio and photo_url';
    end if;
  end if;
  return new;
end;
$$;

create trigger caddies_guard_self_service
  before update on public.caddies
  for each row execute function public.caddies_guard_self_service();

-- =============================================================================
-- 12. Tee-sheet engine
-- =============================================================================
create or replace function public.slot_lock_key(
  p_course_id uuid, p_play_date date, p_tee_time time, p_start_hole smallint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select hashtextextended(concat_ws('|', p_course_id, p_play_date, p_tee_time, p_start_hole), 0);
$$;

-- Seats consumed in one tee slot. A private 4-ball consumes the whole slot.
create or replace function public.slot_occupancy(
  p_course_id        uuid,
  p_play_date        date,
  p_tee_time         time,
  p_start_hole       smallint,
  p_exclude_booking  uuid default null,
  p_exclude_hold     uuid default null
)
returns table (seats_taken integer, has_private boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select max_players_per_slot as cap from public.courses where id = p_course_id
  ),
  occupants as (
    select b.player_count as seats, b.is_private
    from public.bookings b
    where b.course_id = p_course_id
      and b.play_date = p_play_date
      and b.tee_time = p_tee_time
      and b.start_hole = p_start_hole
      and b.status in ('confirmed', 'checked_in', 'completed', 'no_show')
      and b.id is distinct from p_exclude_booking
      and (p_exclude_hold is null or b.slot_hold_id is distinct from p_exclude_hold)
    union all
    select h.seats, h.is_private
    from public.slot_holds h
    where h.course_id = p_course_id
      and h.play_date = p_play_date
      and h.tee_time = p_tee_time
      and h.start_hole = p_start_hole
      and h.status = 'active'
      and h.expires_at > now()
      and h.id is distinct from p_exclude_hold
  )
  select
    coalesce(sum(case when o.is_private then c.cap else o.seats end), 0)::integer,
    coalesce(bool_or(o.is_private), false)
  from c left join occupants o on true
  group by c.cap;
$$;

-- Validates a tee slot against course rules and returns its absolute start.
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

  v_local_today := (now() at time zone v_course.timezone)::date;
  if p_play_date > v_local_today + v_course.booking_window_days then
    raise exception 'beyond_booking_window' using errcode = 'P0001',
      detail = format('bookings open %s days ahead', v_course.booking_window_days);
  end if;

  return v_starts_at;
end;
$$;

-- RPC (a): atomically reserve seats in a 4-ball for the checkout window.
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

  v_seats := case when p_is_private then v_course.max_players_per_slot else p_seats end;
  if v_seats is null
     or v_seats < v_course.min_players_per_booking
     or v_seats > v_course.max_players_per_slot then
    raise exception 'invalid_seat_count' using errcode = 'P0001',
      detail = format('between %s and %s', v_course.min_players_per_booking, v_course.max_players_per_slot);
  end if;

  v_starts_at := public.resolve_tee_slot(p_course_id, p_play_date, p_tee_time, p_hole_format);

  -- Serialize every writer for this slot until commit.
  perform pg_advisory_xact_lock(public.slot_lock_key(p_course_id, p_play_date, p_tee_time, v_start_hole));

  -- One live checkout per golfer: abandon any previous hold and its caddies.
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
    raise exception 'slot_full' using errcode = 'P0001', detail = 'private four-ball';
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

create or replace function public.release_slot_hold(p_hold_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.caddy_assignments
     set status = 'released', hold_expires_at = null
   where slot_hold_id = p_hold_id and status = 'held'
     and exists (select 1 from public.slot_holds h where h.id = p_hold_id and h.profile_id = auth.uid());

  update public.slot_holds
     set status = 'released', released_at = now()
   where id = p_hold_id and profile_id = auth.uid() and status = 'active';
end;
$$;

-- Housekeeping for pg_cron / scheduled edge function. Holds are already ignored
-- once expired; this only tidies statuses and frees caddy exclusion ranges.
create or replace function public.expire_stale_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.caddy_assignments
     set status = 'released', hold_expires_at = null
   where status = 'held' and hold_expires_at <= now();

  update public.slot_holds
     set status = 'expired', released_at = now()
   where status = 'active' and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Bookings: derive slot fields, enforce capacity (defense in depth beside holds).
create or replace function public.bookings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course      public.courses%rowtype;
  v_taken       integer;
  v_has_private boolean;
  v_needed      integer;
begin
  select * into v_course from public.courses where id = new.course_id;

  new.start_hole    := case when new.hole_format = 'back_9' then 10 else 1 end;
  new.tee_starts_at := (new.play_date + new.tee_time) at time zone v_course.timezone;

  if tg_op = 'INSERT' and new.booking_ref is null then
    new.booking_ref := 'GOS-' || to_char(new.play_date, 'YYMMDD') || '-'
                       || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  end if;

  if new.status in ('confirmed', 'checked_in')
     and (tg_op = 'INSERT'
          or old.status not in ('confirmed', 'checked_in')
          or new.player_count is distinct from old.player_count
          or new.is_private   is distinct from old.is_private
          or new.play_date    is distinct from old.play_date
          or new.tee_time     is distinct from old.tee_time
          or new.start_hole   is distinct from old.start_hole) then

    perform pg_advisory_xact_lock(public.slot_lock_key(new.course_id, new.play_date, new.tee_time, new.start_hole));

    select o.seats_taken, o.has_private into v_taken, v_has_private
    from public.slot_occupancy(new.course_id, new.play_date, new.tee_time, new.start_hole,
                               new.id, new.slot_hold_id) o;

    v_needed := case when new.is_private then v_course.max_players_per_slot else new.player_count end;
    if v_has_private or (new.is_private and v_taken > 0)
       or v_taken + v_needed > v_course.max_players_per_slot then
      raise exception 'slot_full' using errcode = 'P0001',
        detail = format('%s seat(s) taken in slot', v_taken);
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status in ('cancelled', 'refunded') and old.status not in ('cancelled', 'refunded') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  return new;
end;
$$;

create trigger bookings_before_write
  before insert or update on public.bookings
  for each row execute function public.bookings_before_write();

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

create or replace function public.bookings_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.slot_hold_id is not null then
    update public.slot_holds
       set status = 'converted', converted_booking_id = new.id
     where id = new.slot_hold_id;

    update public.caddy_assignments
       set status = 'confirmed', hold_expires_at = null, booking_id = new.id
     where slot_hold_id = new.slot_hold_id and status = 'held';
  end if;

  if tg_op = 'UPDATE' and new.status in ('cancelled', 'refunded')
     and old.status not in ('cancelled', 'refunded') then
    update public.caddy_assignments
       set status = 'cancelled', hold_expires_at = null
     where booking_id = new.id and status in ('held', 'confirmed');
  end if;

  return null;
end;
$$;

create trigger bookings_after_write
  after insert or update of status on public.bookings
  for each row execute function public.bookings_after_write();

create or replace function public.booking_players_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count smallint;
begin
  select player_count into v_count from public.bookings where id = new.booking_id;
  if new.seat_number > v_count then
    raise exception 'seat_exceeds_player_count' using errcode = 'P0001',
      detail = format('booking has %s player(s)', v_count);
  end if;
  return new;
end;
$$;

create trigger booking_players_validate
  before insert or update of seat_number, booking_id on public.booking_players
  for each row execute function public.booking_players_validate();

-- RPC (b): caddies free for the full play window of the requested tee time.
create or replace function public.get_available_caddies(
  p_course_id    uuid,
  p_play_date    date,
  p_tee_time     time,
  p_hole_format  public.hole_format
)
returns table (
  caddy_id          uuid,
  caddy_code        text,
  full_name         text,
  grade             public.caddy_grade,
  grade_label       text,
  years_experience  smallint,
  rating            numeric,
  photo_url         text,
  bio               text,
  rate_paise        integer,
  window_starts_at  timestamptz,
  window_ends_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_course     public.courses%rowtype;
  v_starts_at  timestamptz;
  v_ends_at    timestamptz;
begin
  select * into v_course from public.courses
  where id = p_course_id and is_active and (is_published or public.is_course_admin(p_course_id));
  if not found then
    raise exception 'course_not_bookable' using errcode = 'P0001';
  end if;

  v_starts_at := public.resolve_tee_slot(p_course_id, p_play_date, p_tee_time, p_hole_format);
  v_ends_at := v_starts_at + make_interval(mins =>
    case when p_hole_format = 'full_18' then v_course.round_duration_18_minutes
         else v_course.round_duration_9_minutes end);

  return query
  select
    c.id, c.caddy_code, c.full_name, c.grade, t.label, c.years_experience, c.rating,
    c.photo_url, c.bio,
    case when p_hole_format = 'full_18' then c.daily_rate_18_paise else c.daily_rate_9_paise end,
    v_starts_at, v_ends_at
  from public.caddies c
  left join public.caddy_rate_tiers t on t.course_id = c.course_id and t.grade = c.grade
  where c.course_id = p_course_id
    and c.is_active
    and c.is_available
    and not exists (
      select 1 from public.caddy_assignments a
      where a.caddy_id = c.id
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(v_starts_at, v_ends_at, '[)')
        and (a.status in ('confirmed', 'completed')
             or (a.status = 'held' and a.hold_expires_at > now()))
    )
  order by c.grade, c.rating desc nulls last, c.caddy_code;
end;
$$;

-- Public, PII-free caddy roster for the course showcase.
create or replace function public.get_course_caddies(p_course_id uuid)
returns table (
  caddy_id uuid, caddy_code text, full_name text, grade public.caddy_grade, grade_label text,
  years_experience smallint, rating numeric, photo_url text, bio text,
  daily_rate_9_paise integer, daily_rate_18_paise integer, is_available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.caddy_code, c.full_name, c.grade, t.label, c.years_experience, c.rating,
         c.photo_url, c.bio, c.daily_rate_9_paise, c.daily_rate_18_paise, c.is_available
  from public.caddies c
  left join public.caddy_rate_tiers t on t.course_id = c.course_id and t.grade = c.grade
  where c.course_id = p_course_id and c.is_active and public.is_course_visible(p_course_id)
  order by c.grade, c.rating desc nulls last, c.caddy_code;
$$;

-- =============================================================================
-- 13. Scoring and handicap engine
-- =============================================================================

-- Rank of a hole's difficulty within the holes being played (1 = hardest).
create or replace function public.hole_difficulty_rank(
  p_course_id uuid, p_hole_number smallint, p_hole_format public.hole_format
)
returns smallint
language sql
stable
set search_path = ''
as $$
  select ranked.rnk::smallint
  from (
    select h.hole_number, rank() over (order by h.stroke_index) as rnk
    from public.course_holes h
    where h.course_id = p_course_id
      and (p_hole_format = 'full_18'
           or (p_hole_format = 'front_9' and h.nine = 'front')
           or (p_hole_format = 'back_9'  and h.nine = 'back'))
  ) ranked
  where ranked.hole_number = p_hole_number;
$$;

-- WHS stroke allocation; negative course handicaps (plus players) give strokes
-- back starting from the easiest hole.
create or replace function public.strokes_received(
  p_course_handicap integer, p_rank integer, p_holes integer
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_course_handicap is null then 0
    when p_course_handicap >= 0 then
      (p_course_handicap / p_holes + case when p_rank <= p_course_handicap % p_holes then 1 else 0 end)
    else
      -((-p_course_handicap) / p_holes
        + case when p_rank > p_holes - ((-p_course_handicap) % p_holes) then 1 else 0 end)
  end::smallint;
$$;

-- Course rating, slope and par for the span played on a tee, with the
-- unrated fallback (slope 113, rating = par).
create or replace function public.tee_rating_for_format(p_tee_id uuid, p_hole_format public.hole_format)
returns table (course_rating numeric, slope_rating smallint, par smallint, is_rated boolean)
language sql
stable
set search_path = ''
as $$
  with t as (select * from public.course_tees where id = p_tee_id),
  hole_par as (
    select coalesce(sum(h.par), 0)::smallint as par
    from public.course_holes h, t
    where h.course_id = t.course_id
      and (p_hole_format = 'full_18'
           or (p_hole_format = 'front_9' and h.nine = 'front')
           or (p_hole_format = 'back_9'  and h.nine = 'back'))
  ),
  picked as (
    select
      case p_hole_format when 'full_18' then t.course_rating_18
                         when 'front_9' then t.course_rating_front_9
                         else t.course_rating_back_9 end as cr,
      case p_hole_format when 'full_18' then t.slope_rating_18
                         when 'front_9' then t.slope_rating_front_9
                         else t.slope_rating_back_9 end as slope,
      coalesce(case p_hole_format when 'full_18' then t.par_18
                                  when 'front_9' then t.par_front_9
                                  else t.par_back_9 end,
               (select par from hole_par)) as par
    from t
  )
  select coalesce(cr, par::numeric), coalesce(slope, 113)::smallint, par::smallint,
         (cr is not null and slope is not null)
  from picked;
$$;

create or replace function public.rounds_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_booking from public.bookings where id = new.booking_id;
    if not found or v_booking.status not in ('confirmed', 'checked_in') then
      raise exception 'booking_not_playable' using errcode = 'P0001';
    end if;
    -- Round shape always mirrors the booking; clients cannot spoof it.
    new.course_id   := v_booking.course_id;
    new.hole_format := v_booking.hole_format;
    new.start_hole  := v_booking.start_hole;
    new.mode        := v_booking.mode;
    new.created_by  := coalesce(new.created_by, auth.uid());
    if new.status not in ('scheduled', 'in_progress') then
      raise exception 'invalid_initial_round_status' using errcode = 'P0001';
    end if;
  else
    if old.status in ('completed', 'abandoned') and new.status is distinct from old.status then
      raise exception 'round_already_final' using errcode = 'P0001';
    end if;
    if new.booking_id <> old.booking_id or new.course_id <> old.course_id
       or new.hole_format <> old.hole_format or new.start_hole <> old.start_hole then
      raise exception 'round_shape_immutable' using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger rounds_before_write
  before insert or update on public.rounds
  for each row execute function public.rounds_before_write();

create trigger rounds_set_updated_at
  before update on public.rounds
  for each row execute function public.set_updated_at();

-- Course handicap for a player on a tee. Uses the matching track's index;
-- a 9-hole round falls back to half the 18-hole index when no 9-hole index exists.
create or replace function public.compute_course_handicap(
  p_handicap_9 numeric, p_handicap_18 numeric, p_tee_id uuid, p_hole_format public.hole_format
)
returns table (handicap_index numeric, course_handicap smallint)
language sql
stable
set search_path = ''
as $$
  with idx as (
    select case when p_hole_format = 'full_18' then p_handicap_18
                else coalesce(p_handicap_9, round(p_handicap_18 / 2, 1)) end as hi
  )
  select idx.hi,
         case when idx.hi is null then null
              else round(idx.hi * r.slope_rating / 113.0 + (r.course_rating - r.par))::smallint end
  from idx, public.tee_rating_for_format(p_tee_id, p_hole_format) r;
$$;

create or replace function public.rounds_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tee_id uuid;
begin
  select coalesce(b.tee_id,
                  (select t.id from public.course_tees t
                    where t.course_id = new.course_id and t.is_active
                    order by t.is_default desc, t.sort_order limit 1))
    into v_tee_id
  from public.bookings b where b.id = new.booking_id;

  if v_tee_id is null then
    raise exception 'course_has_no_tees' using errcode = 'P0001';
  end if;

  insert into public.round_players (
    round_id, course_id, booking_player_id, profile_id, tee_id, display_name,
    handicap_index_at_start, course_handicap
  )
  select new.id, new.course_id, bp.id, bp.profile_id, v_tee_id, bp.full_name,
         ch.handicap_index, ch.course_handicap
  from public.booking_players bp
  left join public.profiles p on p.id = bp.profile_id
  left join lateral public.compute_course_handicap(p.handicap_9, p.handicap_18, v_tee_id, new.hole_format) ch on true
  where bp.booking_id = new.booking_id
  order by bp.seat_number;

  return null;
end;
$$;

create trigger rounds_after_insert
  after insert on public.rounds
  for each row execute function public.rounds_after_insert();

create or replace function public.hole_scores_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round  public.rounds%rowtype;
  v_player public.round_players%rowtype;
  v_hole   public.course_holes%rowtype;
  v_holes  integer;
  v_rank   smallint;
begin
  select * into v_player from public.round_players where id = new.round_player_id;
  if not found then
    raise exception 'round_player_not_found' using errcode = 'P0001';
  end if;
  new.round_id := v_player.round_id;

  select * into v_round from public.rounds where id = v_player.round_id for update;
  if v_round.status not in ('scheduled', 'in_progress') then
    raise exception 'round_not_editable' using errcode = 'P0001';
  end if;

  if (v_round.hole_format = 'front_9' and new.hole_number > 9)
  or (v_round.hole_format = 'back_9'  and new.hole_number < 10) then
    raise exception 'hole_outside_round' using errcode = 'P0001';
  end if;

  select * into v_hole from public.course_holes
  where course_id = v_round.course_id and hole_number = new.hole_number;
  if not found then
    raise exception 'hole_not_configured' using errcode = 'P0001';
  end if;

  v_holes := case when v_round.hole_format = 'full_18' then 18 else 9 end;
  v_rank  := public.hole_difficulty_rank(v_round.course_id, new.hole_number, v_round.hole_format);

  new.par              := v_hole.par;
  new.stroke_index     := v_hole.stroke_index;
  new.strokes_received := public.strokes_received(v_player.course_handicap, v_rank, v_holes);
  -- Net Double Bogey cap; players without an index are capped at par + 5 (WHS 3.1).
  new.adjusted_strokes := least(
    new.strokes,
    case when v_player.course_handicap is null then v_hole.par + 5
         else v_hole.par + 2 + new.strokes_received end
  );
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  return new;
end;
$$;

create trigger hole_scores_before_write
  before insert or update on public.hole_scores
  for each row execute function public.hole_scores_before_write();

create trigger hole_scores_set_updated_at
  before update on public.hole_scores
  for each row execute function public.set_updated_at();

create or replace function public.refresh_round_player_totals(p_round_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected integer;
begin
  select case when r.hole_format = 'full_18' then 18 else 9 end into v_expected
  from public.round_players rp join public.rounds r on r.id = rp.round_id
  where rp.id = p_round_player_id;

  update public.round_players rp
     set holes_played         = s.n,
         gross_score          = s.gross,
         adjusted_gross_score = s.adjusted,
         net_score            = case when rp.course_handicap is null then null
                                     else s.gross - rp.course_handicap end,
         is_complete          = (s.n = v_expected)
    from (
      select count(*)::smallint as n,
             sum(strokes)::smallint as gross,
             sum(adjusted_strokes)::smallint as adjusted
      from public.hole_scores where round_player_id = p_round_player_id
    ) s
   where rp.id = p_round_player_id;
end;
$$;

create or replace function public.hole_scores_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_round_player_totals(old.round_player_id);
  else
    perform public.refresh_round_player_totals(new.round_player_id);
    update public.rounds set status = 'in_progress'
     where id = new.round_id and status = 'scheduled';
  end if;
  return null;
end;
$$;

create trigger hole_scores_after_write
  after insert or update or delete on public.hole_scores
  for each row execute function public.hole_scores_after_write();

create or replace function public.hole_scores_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.rounds where id = old.round_id and status in ('completed', 'abandoned')) then
    raise exception 'round_not_editable' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger hole_scores_before_delete
  before delete on public.hole_scores
  for each row execute function public.hole_scores_before_delete();

-- WHS Rule 5.2 lookup: index from the most recent (up to 20) differentials.
create or replace function public.handicap_index_from_differentials(p_diffs numeric[])
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n       integer := coalesce(array_length(p_diffs, 1), 0);
  v_take    integer;
  v_adjust  numeric := 0;
  v_avg     numeric;
begin
  if v_n < 3 then
    return null;
  end if;

  select take, adj into v_take, v_adjust
  from (values
    (3, 1, -2.0), (4, 1, -1.0), (5, 1, 0.0), (6, 2, -1.0),
    (7, 2, 0.0), (8, 2, 0.0), (9, 3, 0.0), (10, 3, 0.0), (11, 3, 0.0),
    (12, 4, 0.0), (13, 4, 0.0), (14, 4, 0.0), (15, 5, 0.0), (16, 5, 0.0),
    (17, 6, 0.0), (18, 6, 0.0), (19, 7, 0.0), (20, 8, 0.0)
  ) as t(n, take, adj)
  where t.n = least(v_n, 20);

  select avg(d) into v_avg
  from (select d from unnest(p_diffs) d order by d asc limit v_take) lowest;

  return least(54.0, round(v_avg + v_adjust, 1));
end;
$$;

-- RPC (c): recompute both tracks for one golfer and snapshot the result.
create or replace function public.recalculate_player_handicaps(
  p_profile_id uuid,
  p_trigger_round_id uuid default null
)
returns table (
  handicap_18 numeric, avg_score_18 numeric, rounds_counted_18 smallint,
  handicap_9  numeric, avg_score_9  numeric, rounds_counted_9  smallint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_diffs_18 numeric[];
  v_diffs_9  numeric[];
  v_avg_18   numeric;
  v_avg_9    numeric;
  v_hi_18    numeric;
  v_hi_9     numeric;
begin
  select array_agg(d.score_differential), round(avg(d.gross_score), 2)
    into v_diffs_18, v_avg_18
  from (
    select rp.score_differential, rp.gross_score
    from public.round_players rp join public.rounds r on r.id = rp.round_id
    where rp.profile_id = p_profile_id and rp.counts_for_handicap
      and r.status = 'completed' and r.hole_format = 'full_18'
    order by r.completed_at desc
    limit 20
  ) d;

  select array_agg(d.score_differential), round(avg(d.gross_score), 2)
    into v_diffs_9, v_avg_9
  from (
    select rp.score_differential, rp.gross_score
    from public.round_players rp join public.rounds r on r.id = rp.round_id
    where rp.profile_id = p_profile_id and rp.counts_for_handicap
      and r.status = 'completed' and r.hole_format in ('front_9', 'back_9')
    order by r.completed_at desc
    limit 20
  ) d;

  v_hi_18 := public.handicap_index_from_differentials(v_diffs_18);
  v_hi_9  := public.handicap_index_from_differentials(v_diffs_9);

  update public.profiles p
     set handicap_18         = v_hi_18,
         avg_score_18        = v_avg_18,
         rounds_counted_18   = coalesce(array_length(v_diffs_18, 1), 0),
         handicap_9          = v_hi_9,
         avg_score_9         = v_avg_9,
         rounds_counted_9    = coalesce(array_length(v_diffs_9, 1), 0),
         handicap_updated_at = now()
   where p.id = p_profile_id;

  insert into public.handicap_snapshots (profile_id, track, handicap_index, avg_score, rounds_counted, trigger_round_id)
  values
    (p_profile_id, 'eighteen_hole', v_hi_18, v_avg_18, coalesce(array_length(v_diffs_18, 1), 0), p_trigger_round_id),
    (p_profile_id, 'nine_hole',     v_hi_9,  v_avg_9,  coalesce(array_length(v_diffs_9, 1), 0),  p_trigger_round_id);

  return query
  select v_hi_18, v_avg_18, coalesce(array_length(v_diffs_18, 1), 0)::smallint,
         v_hi_9,  v_avg_9,  coalesce(array_length(v_diffs_9, 1), 0)::smallint;
end;
$$;

-- Round completion: differentials -> handicaps -> caddy earnings -> booking.
create or replace function public.finalize_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round   public.rounds%rowtype;
  v_course  public.courses%rowtype;
  v_profile uuid;
  v_assign  record;
  v_net     integer;
begin
  select * into v_round from public.rounds where id = p_round_id;
  select * into v_course from public.courses where id = v_round.course_id;

  -- Score Differential = (AGS - Course Rating) x 113 / Slope, per span played.
  update public.round_players rp
     set score_differential = (
           select round((rp.adjusted_gross_score - r.course_rating) * 113.0 / r.slope_rating, 1)
           from public.tee_rating_for_format(rp.tee_id, v_round.hole_format) r),
         counts_for_handicap = (rp.profile_id is not null)
   where rp.round_id = p_round_id and rp.is_complete;

  for v_profile in
    select rp.profile_id from public.round_players rp
    where rp.round_id = p_round_id and rp.profile_id is not null and rp.counts_for_handicap
  loop
    perform public.recalculate_player_handicaps(v_profile, p_round_id);
  end loop;

  for v_assign in
    select a.* from public.caddy_assignments a
    where a.booking_id = v_round.booking_id and a.status = 'confirmed'
    for update
  loop
    update public.caddy_assignments set status = 'completed' where id = v_assign.id;
    v_net := v_assign.rate_paise - round(v_assign.rate_paise * v_course.caddy_commission_percent / 100.0)::integer;
    if v_net > 0 then
      insert into public.caddy_ledger (caddy_id, course_id, entry_type, direction, amount_paise,
                                       caddy_assignment_id, description)
      values (v_assign.caddy_id, v_assign.course_id, 'round_earning', 'credit', v_net, v_assign.id,
              format('%s round on %s', v_assign.hole_format,
                     to_char(v_assign.starts_at at time zone v_course.timezone, 'DD Mon YYYY HH24:MI')));
    end if;
  end loop;

  update public.bookings set status = 'completed'
   where id = v_round.booking_id and status in ('confirmed', 'checked_in');
end;
$$;

create or replace function public.rounds_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    perform public.finalize_round(new.id);
  end if;
  return null;
end;
$$;

create trigger rounds_after_update
  after update of status on public.rounds
  for each row execute function public.rounds_after_update();

-- =============================================================================
-- 14. Ledger and payouts
-- =============================================================================
create or replace function public.caddy_ledger_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev bigint;
begin
  -- Row lock on the caddy serializes all ledger writes for that caddy.
  perform 1 from public.caddies where id = new.caddy_id and course_id = new.course_id for update;
  if not found then
    raise exception 'caddy_course_mismatch' using errcode = 'P0001';
  end if;

  select l.balance_after_paise into v_prev
  from public.caddy_ledger l where l.caddy_id = new.caddy_id
  order by l.id desc limit 1;

  new.balance_after_paise := coalesce(v_prev, 0)
    + case when new.direction = 'credit' then new.amount_paise else -new.amount_paise end;
  if new.balance_after_paise < 0 then
    raise exception 'insufficient_caddy_balance' using errcode = 'P0001';
  end if;

  new.created_by := coalesce(new.created_by, auth.uid());
  new.created_at := now();
  return new;
end;
$$;

create trigger caddy_ledger_before_insert
  before insert on public.caddy_ledger
  for each row execute function public.caddy_ledger_before_insert();

create or replace function public.caddy_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'caddy_ledger_is_append_only' using errcode = '42501',
    hint = 'post a correcting adjustment entry instead';
end;
$$;

create trigger caddy_ledger_no_update
  before update or delete on public.caddy_ledger
  for each row execute function public.caddy_ledger_immutable();

create trigger caddy_ledger_no_truncate
  before truncate on public.caddy_ledger
  for each statement execute function public.caddy_ledger_immutable();

create or replace view public.caddy_balances
with (security_invoker = true) as
select c.id as caddy_id,
       c.course_id,
       coalesce((select l.balance_after_paise from public.caddy_ledger l
                 where l.caddy_id = c.id order by l.id desc limit 1), 0)::bigint as balance_paise,
       coalesce((select sum(p.amount_paise) from public.caddy_payout_requests p
                 where p.caddy_id = c.id and p.status in ('requested', 'approved', 'processing')), 0)::bigint
         as pending_payout_paise
from public.caddies c;

create or replace function public.caddy_payout_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caddy   public.caddies%rowtype;
  v_balance bigint;
begin
  select * into v_caddy from public.caddies where id = new.caddy_id for update;
  if not found or not v_caddy.is_active then
    raise exception 'caddy_not_active' using errcode = 'P0001';
  end if;
  if v_caddy.upi_id is null then
    raise exception 'caddy_upi_missing' using errcode = 'P0001';
  end if;

  select coalesce((select l.balance_after_paise from public.caddy_ledger l
                   where l.caddy_id = new.caddy_id order by l.id desc limit 1), 0)
    into v_balance;

  if new.amount_paise > v_balance then
    raise exception 'payout_exceeds_balance' using errcode = 'P0001',
      detail = format('available %s paise', v_balance);
  end if;

  new.course_id    := v_caddy.course_id;
  new.upi_id       := v_caddy.upi_id;
  new.status       := 'requested';
  new.requested_by := coalesce(auth.uid(), new.requested_by);
  new.reviewed_by := null; new.reviewed_at := null; new.paid_at := null;
  new.razorpayx_payout_id := null; new.utr := null;
  return new;
end;
$$;

create trigger caddy_payout_before_insert
  before insert on public.caddy_payout_requests
  for each row execute function public.caddy_payout_before_insert();

create or replace function public.caddy_payout_before_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_admin boolean := not public.is_end_user_context() or public.is_course_admin(old.course_id);
  v_allowed  boolean;
begin
  if new.caddy_id <> old.caddy_id or new.course_id <> old.course_id
     or new.amount_paise <> old.amount_paise or new.upi_id <> old.upi_id then
    raise exception 'payout_fields_immutable' using errcode = '42501';
  end if;

  if new.status = old.status then
    if not v_is_admin then
      raise exception 'payout_update_forbidden' using errcode = '42501';
    end if;
    return new;
  end if;

  v_allowed := case
    when old.status = 'requested'  and new.status = 'cancelled' then true
    when old.status = 'requested'  and new.status in ('approved', 'rejected') then v_is_admin
    when old.status = 'approved'   and new.status in ('processing', 'paid', 'rejected', 'cancelled') then v_is_admin
    when old.status = 'processing' and new.status in ('paid', 'failed') then v_is_admin
    else false
  end;
  if not v_allowed then
    raise exception 'invalid_payout_transition' using errcode = 'P0001',
      detail = format('%s -> %s', old.status, new.status);
  end if;

  if new.status in ('approved', 'rejected') then
    new.reviewed_by := coalesce(auth.uid(), new.reviewed_by);
    new.reviewed_at := now();
  end if;
  if new.status = 'rejected' and coalesce(new.rejection_reason, '') = '' then
    raise exception 'rejection_reason_required' using errcode = 'P0001';
  end if;
  if new.status = 'paid' then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

create trigger caddy_payout_before_update
  before update on public.caddy_payout_requests
  for each row execute function public.caddy_payout_before_update();

create or replace function public.caddy_payout_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status <> 'paid' then
    insert into public.caddy_ledger (caddy_id, course_id, entry_type, direction, amount_paise,
                                     payout_request_id, description)
    values (new.caddy_id, new.course_id, 'payout', 'debit', new.amount_paise, new.id,
            format('UPI payout to %s%s', new.upi_id, coalesce(' · UTR ' || new.utr, '')));
  end if;
  return null;
end;
$$;

create trigger caddy_payout_after_update
  after update of status on public.caddy_payout_requests
  for each row execute function public.caddy_payout_after_update();

-- =============================================================================
-- 15. Integrity view (Super Admin course builder uses this as a checklist)
-- =============================================================================
create or replace view public.course_integrity_issues
with (security_invoker = true) as
with hole_totals as (
  select course_id,
         count(*) as holes,
         sum(par) filter (where nine = 'front') as par_front,
         sum(par) filter (where nine = 'back')  as par_back,
         sum(par) as par_total
  from public.course_holes group by course_id
),
yard_totals as (
  select y.tee_id, sum(y.yards) as yards from public.hole_yardages y group by y.tee_id
)
select c.id as course_id, null::uuid as tee_id, 'hole_count'::text as issue,
       format('%s holes configured, expected %s', coalesce(h.holes, 0), c.holes_count) as detail
from public.courses c left join hole_totals h on h.course_id = c.id
where coalesce(h.holes, 0) <> c.holes_count
union all
select t.course_id, t.id, 'par_18_mismatch',
       format('tee %s declares par %s, holes sum to %s', t.name, t.par_18, h.par_total)
from public.course_tees t join hole_totals h on h.course_id = t.course_id
where t.par_18 is not null and t.par_18 <> h.par_total
union all
select t.course_id, t.id, 'par_front_9_mismatch',
       format('tee %s declares front par %s, holes sum to %s', t.name, t.par_front_9, h.par_front)
from public.course_tees t join hole_totals h on h.course_id = t.course_id
where t.par_front_9 is not null and t.par_front_9 <> h.par_front
union all
select t.course_id, t.id, 'par_back_9_mismatch',
       format('tee %s declares back par %s, holes sum to %s', t.name, t.par_back_9, h.par_back)
from public.course_tees t join hole_totals h on h.course_id = t.course_id
where t.par_back_9 is not null and t.par_back_9 <> h.par_back
union all
select t.course_id, t.id, 'yardage_mismatch',
       format('tee %s declares %s yds, holes sum to %s', t.name, t.total_yards, y.yards)
from public.course_tees t join yard_totals y on y.tee_id = t.id
where t.total_yards is not null and t.total_yards <> y.yards
union all
select t.course_id, t.id, 'missing_yardages',
       format('tee %s has yardage for %s of %s holes', t.name, coalesce(y.n, 0), c.holes_count)
from public.course_tees t
join public.courses c on c.id = t.course_id
left join (select tee_id, count(*) as n from public.hole_yardages group by tee_id) y on y.tee_id = t.id
where t.is_active and coalesce(y.n, 0) <> c.holes_count
union all
select t.course_id, t.id, 'tee_unrated',
       format('tee %s has no 18-hole rating/slope; handicap engine will use slope 113 and par', t.name)
from public.course_tees t
where t.course_rating_18 is null or t.slope_rating_18 is null;

-- =============================================================================
-- 16. Row Level Security
-- =============================================================================
alter table public.profiles              enable row level security;
alter table public.courses               enable row level security;
alter table public.course_admins         enable row level security;
alter table public.course_tees           enable row level security;
alter table public.course_holes          enable row level security;
alter table public.hole_yardages         enable row level security;
alter table public.caddy_rate_tiers      enable row level security;
alter table public.caddies               enable row level security;
alter table public.slot_holds            enable row level security;
alter table public.bookings              enable row level security;
alter table public.booking_players       enable row level security;
alter table public.caddy_assignments     enable row level security;
alter table public.rounds                enable row level security;
alter table public.round_players         enable row level security;
alter table public.hole_scores           enable row level security;
alter table public.handicap_snapshots    enable row level security;
alter table public.caddy_ledger          enable row level security;
alter table public.caddy_payout_requests enable row level security;
alter table public.gallery_photos        enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to anon, authenticated
  using (is_profile_public or id = (select auth.uid()) or (select public.is_super_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select public.is_super_admin()))
  with check (id = (select auth.uid()) or (select public.is_super_admin()));

-- courses -------------------------------------------------------------------
create policy courses_select on public.courses for select to anon, authenticated
  using ((is_active and is_published) or public.is_course_admin(id));
create policy courses_insert on public.courses for insert to authenticated
  with check ((select public.is_super_admin()));
create policy courses_update on public.courses for update to authenticated
  using (public.is_course_admin(id)) with check (public.is_course_admin(id));
create policy courses_delete on public.courses for delete to authenticated
  using ((select public.is_super_admin()));

create policy course_admins_select on public.course_admins for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_super_admin()));
create policy course_admins_write on public.course_admins for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- course configuration (tees, holes, yardages, rate tiers) -------------------
create policy course_tees_select on public.course_tees for select to anon, authenticated
  using (public.is_course_visible(course_id));
create policy course_tees_write on public.course_tees for all to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

create policy course_holes_select on public.course_holes for select to anon, authenticated
  using (public.is_course_visible(course_id));
create policy course_holes_write on public.course_holes for all to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

create policy hole_yardages_select on public.hole_yardages for select to anon, authenticated
  using (public.is_course_visible(course_id));
create policy hole_yardages_write on public.hole_yardages for all to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

create policy caddy_rate_tiers_select on public.caddy_rate_tiers for select to anon, authenticated
  using (public.is_course_visible(course_id));
create policy caddy_rate_tiers_write on public.caddy_rate_tiers for all to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

-- caddies (PII: phone, UPI). Public reads go through get_course_caddies(). ----
create policy caddies_select on public.caddies for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_course_admin(course_id));
create policy caddies_insert on public.caddies for insert to authenticated
  with check (public.is_course_admin(course_id));
create policy caddies_update on public.caddies for update to authenticated
  using (profile_id = (select auth.uid()) or public.is_course_admin(course_id))
  with check (profile_id = (select auth.uid()) or public.is_course_admin(course_id));
create policy caddies_delete on public.caddies for delete to authenticated
  using (public.is_course_admin(course_id));

-- slot holds: read-only to owner/admin; writes only through RPCs --------------
create policy slot_holds_select on public.slot_holds for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_course_admin(course_id));

-- bookings --------------------------------------------------------------------
create policy bookings_select on public.bookings for select to authenticated
  using (public.is_booking_participant(id) or public.is_course_admin(course_id));
create policy bookings_admin_insert on public.bookings for insert to authenticated
  with check (public.is_course_admin(course_id));
create policy bookings_admin_update on public.bookings for update to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

create policy booking_players_select on public.booking_players for select to authenticated
  using (public.is_booking_participant(booking_id)
         or exists (select 1 from public.bookings b
                    where b.id = booking_id and public.is_course_admin(b.course_id)));
create policy booking_players_write on public.booking_players for all to authenticated
  using (exists (select 1 from public.bookings b
                 where b.id = booking_id
                   and (b.booked_by = (select auth.uid()) or public.is_course_admin(b.course_id))
                   and b.status in ('confirmed', 'checked_in')))
  with check (exists (select 1 from public.bookings b
                      where b.id = booking_id
                        and (b.booked_by = (select auth.uid()) or public.is_course_admin(b.course_id))
                        and b.status in ('confirmed', 'checked_in')));

-- caddy assignments -------------------------------------------------------------
create policy caddy_assignments_select on public.caddy_assignments for select to authenticated
  using (caddy_id = (select public.current_caddy_id())
         or (booking_id is not null and public.is_booking_participant(booking_id))
         or exists (select 1 from public.slot_holds h
                    where h.id = slot_hold_id and h.profile_id = (select auth.uid()))
         or public.is_course_admin(course_id));
create policy caddy_assignments_admin_write on public.caddy_assignments for all to authenticated
  using (public.is_course_admin(course_id)) with check (public.is_course_admin(course_id));

-- rounds / scoring ----------------------------------------------------------------
create policy rounds_select on public.rounds for select to anon, authenticated
  using (status = 'completed'
         or public.is_booking_participant(booking_id)
         or public.is_course_admin(course_id));
create policy rounds_insert on public.rounds for insert to authenticated
  with check (public.is_booking_participant(booking_id)
              or exists (select 1 from public.bookings b
                         where b.id = booking_id and public.is_course_admin(b.course_id)));
create policy rounds_update on public.rounds for update to authenticated
  using (public.is_booking_participant(booking_id) or public.is_course_admin(course_id))
  with check (public.is_booking_participant(booking_id) or public.is_course_admin(course_id));

create policy round_players_select on public.round_players for select to anon, authenticated
  using (public.is_round_participant(round_id)
         or public.is_course_admin(course_id)
         or public.is_public_round_player(id));

create policy hole_scores_select on public.hole_scores for select to anon, authenticated
  using (public.is_round_participant(round_id)
         or public.is_public_round_player(round_player_id)
         or exists (select 1 from public.rounds r
                    where r.id = round_id and public.is_course_admin(r.course_id)));
create policy hole_scores_insert on public.hole_scores for insert to authenticated
  with check (public.is_round_participant(round_id)
              and exists (select 1 from public.round_players rp
                          where rp.id = round_player_id and rp.round_id = hole_scores.round_id));
create policy hole_scores_update on public.hole_scores for update to authenticated
  using (public.is_round_participant(round_id))
  with check (public.is_round_participant(round_id));
create policy hole_scores_delete on public.hole_scores for delete to authenticated
  using (public.is_round_participant(round_id));

create policy handicap_snapshots_select on public.handicap_snapshots for select to anon, authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = profile_id
                   and (p.is_profile_public or p.id = (select auth.uid()))));

-- ledger & payouts -----------------------------------------------------------------
create policy caddy_ledger_select on public.caddy_ledger for select to authenticated
  using (caddy_id = (select public.current_caddy_id()) or public.is_course_admin(course_id));
create policy caddy_ledger_admin_insert on public.caddy_ledger for insert to authenticated
  with check (public.is_course_admin(course_id) and entry_type in ('tip', 'adjustment'));

create policy caddy_payouts_select on public.caddy_payout_requests for select to authenticated
  using (caddy_id = (select public.current_caddy_id()) or public.is_course_admin(course_id));
create policy caddy_payouts_insert on public.caddy_payout_requests for insert to authenticated
  with check (caddy_id = (select public.current_caddy_id()));
create policy caddy_payouts_update on public.caddy_payout_requests for update to authenticated
  using (caddy_id = (select public.current_caddy_id()) or public.is_course_admin(course_id))
  with check (caddy_id = (select public.current_caddy_id()) or public.is_course_admin(course_id));

-- gallery ------------------------------------------------------------------------------
create policy gallery_select on public.gallery_photos for select to anon, authenticated
  using (profile_id = (select auth.uid())
         or (is_public and exists (select 1 from public.profiles p
                                   where p.id = profile_id and p.is_profile_public)));
create policy gallery_insert on public.gallery_photos for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy gallery_update on public.gallery_photos for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy gallery_delete on public.gallery_photos for delete to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_super_admin()));

-- =============================================================================
-- 17. Privileges
-- =============================================================================
-- Append-only ledger: no client can rewrite history even with a policy slip.
revoke update, delete, truncate on public.caddy_ledger from anon, authenticated;
-- Snapshots and holds are system-written.
revoke insert, update, delete on public.handicap_snapshots from anon, authenticated;
revoke insert, update, delete on public.slot_holds from anon, authenticated;

-- Internal functions must not be callable through PostgREST.
revoke execute on function public.finalize_round(uuid)                          from public, anon, authenticated;
revoke execute on function public.recalculate_player_handicaps(uuid, uuid)      from public, anon, authenticated;
revoke execute on function public.refresh_round_player_totals(uuid)             from public, anon, authenticated;
revoke execute on function public.expire_stale_holds()                          from public, anon, authenticated;
revoke execute on function public.slot_occupancy(uuid, date, time, smallint, uuid, uuid) from public, anon, authenticated;

-- Public RPC surface.
grant execute on function public.acquire_slot_hold(uuid, date, time, public.hole_format, smallint, boolean) to authenticated;
grant execute on function public.release_slot_hold(uuid)                                                   to authenticated;
grant execute on function public.get_available_caddies(uuid, date, time, public.hole_format)               to anon, authenticated;
grant execute on function public.get_course_caddies(uuid)                                                  to anon, authenticated;
revoke execute on function public.acquire_slot_hold(uuid, date, time, public.hole_format, smallint, boolean) from anon;
revoke execute on function public.release_slot_hold(uuid) from anon;

-- =============================================================================
-- 18. Realtime (live batch scoring)
-- =============================================================================
alter table public.hole_scores   replica identity full;
alter table public.round_players replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rounds, public.round_players, public.hole_scores;
  end if;
end;
$$;

-- =============================================================================
-- 19. Storage buckets and object policies
--     Path conventions:
--       avatars/{user_id}/{file}
--       golfer-gallery/{user_id}/{file}      (row in gallery_photos governs visibility)
--       course-media/{course_id}/{file}
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',        'avatars',        true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('golfer-gallery', 'golfer-gallery', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('course-media',   'course-media',   true,  15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy gallery_object_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'golfer-gallery' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.gallery_photos g
               join public.profiles p on p.id = g.profile_id
               where g.storage_path = name and g.is_public and p.is_profile_public)));
create policy gallery_object_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'golfer-gallery' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy gallery_object_update on storage.objects for update to authenticated
  using (bucket_id = 'golfer-gallery' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'golfer-gallery' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy gallery_object_delete on storage.objects for delete to authenticated
  using (bucket_id = 'golfer-gallery' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy course_media_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'course-media');
create policy course_media_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'course-media'
              and public.is_course_admin(public.try_uuid((storage.foldername(name))[1])));
create policy course_media_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'course-media'
         and public.is_course_admin(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'course-media'
              and public.is_course_admin(public.try_uuid((storage.foldername(name))[1])));
create policy course_media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'course-media'
         and public.is_course_admin(public.try_uuid((storage.foldername(name))[1])));

commit;
