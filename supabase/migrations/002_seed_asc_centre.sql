-- =============================================================================
-- Golf OS — 002_seed_asc_centre.sql
-- Tenant #1: ASC Centre Golf Course, Bengaluru. Generated from ASC_COURSE_SEED.json.
-- Idempotent: safe to re-run; every row upserts on its natural key.
-- Units: JSON rupees are stored as paise (x100). Closed days use ISO weekday
-- (1 = Monday). Handicap formulas in handicap_engine_rules are implemented by
-- tee_rating_for_format(), hole_scores_before_write() and finalize_round().
--
-- HOLE LAYOUT SOURCE (user decision, 2026-11-22): the JSON hole table was
-- internally inconsistent (pars summed to 70 vs declared 71). Par, stroke index
-- and yardage below come from the 18 GPS-app screenshots supplied with the
-- project instead: par 72 (36 out / 36 in), 6,237 yds.
--   * GPS yardage is one tee's distance; it is seeded on the White tee only.
--     Blue and Red are seeded inactive (hidden from golfers) for the demo
--     (user decision 2026-11-22); activate them once per-hole yardages exist.
--     Blue and Red per-hole yardages are intentionally absent until the club
--     scorecard is supplied (course_integrity_issues reports missing_yardages).
--   * Tee pars are set to the GPS layout (72/36/36). Course rating and slope
--     remain the JSON values, which were published against the old par 71.
--   * JSON hole names described the old layout and are not carried over.
-- =============================================================================

begin;

insert into public.courses (
  slug, name, short_name, tagline, description, established_year, course_type,
  area, city, state, postal_code, country, latitude, longitude, timezone, currency, holes_count,
  first_tee_time, last_tee_time_18, last_tee_time_9, slot_interval_minutes,
  max_players_per_slot, min_players_per_booking, allow_join_open_batch, checkout_hold_minutes,
  round_duration_9_minutes, round_duration_18_minutes, closed_weekdays,
  pricing, caddy_commission_percent, facilities, media, is_active, is_published
) values (
  'asc-centre-bengaluru', 'ASC Centre Golf Course', 'ASC Golf Club',
  'Heritage Tree-Lined Fairways in the Heart of Agram',
  null, 1964, 'Military / Semi-Private Demo',
  'Agram, Victoria Layout / Domlur', 'Bengaluru', 'Karnataka', '560007', 'India',
  12.9615, 77.6268, 'Asia/Kolkata', 'INR', 18,
  '05:00', '13:30', '15:45', 15,
  4, 1, true, 7,
  135, 270, '{2}',
  '{"weekday": {"nine_holes": 120000, "eighteen_holes": 200000}, "weekend": {"nine_holes": 180000, "eighteen_holes": 300000}, "weekend_isodow": [6, 7], "tournament_entry_addon": 50000, "platform_convenience_fee_percent": 2.5}'::jsonb,
  0,
  array['Driving Range', 'Putting & Chipping Green', 'Caddy Master Desk', 'Clubhouse & Dining', 'Equipment Rental']::text[],
  '{"hero_banner": "/images/courses/asc-centre/hero-dawn-fairway.jpg", "clubhouse": "/images/courses/asc-centre/clubhouse.jpg", "signature_hole": "/images/courses/asc-centre/hole-10-par5.jpg", "gallery": ["/images/courses/asc-centre/gallery-1.jpg", "/images/courses/asc-centre/gallery-2.jpg", "/images/courses/asc-centre/gallery-3.jpg", "/images/courses/asc-centre/gallery-4.jpg"]}'::jsonb,
  true, true
)
on conflict (slug) do update set
  name = excluded.name, short_name = excluded.short_name, tagline = excluded.tagline,
  established_year = excluded.established_year, course_type = excluded.course_type,
  area = excluded.area, city = excluded.city, state = excluded.state, postal_code = excluded.postal_code,
  country = excluded.country, latitude = excluded.latitude, longitude = excluded.longitude,
  timezone = excluded.timezone, currency = excluded.currency, holes_count = excluded.holes_count,
  first_tee_time = excluded.first_tee_time, last_tee_time_18 = excluded.last_tee_time_18,
  last_tee_time_9 = excluded.last_tee_time_9, slot_interval_minutes = excluded.slot_interval_minutes,
  max_players_per_slot = excluded.max_players_per_slot, min_players_per_booking = excluded.min_players_per_booking,
  allow_join_open_batch = excluded.allow_join_open_batch, checkout_hold_minutes = excluded.checkout_hold_minutes,
  round_duration_9_minutes = excluded.round_duration_9_minutes,
  round_duration_18_minutes = excluded.round_duration_18_minutes,
  closed_weekdays = excluded.closed_weekdays, pricing = excluded.pricing,
  caddy_commission_percent = excluded.caddy_commission_percent, facilities = excluded.facilities,
  media = excluded.media, is_active = excluded.is_active, is_published = excluded.is_published;

-- Tees ----------------------------------------------------------------------
insert into public.course_tees (course_id, name, color_hex, gender, sort_order, par_18, par_front_9, par_back_9,
  total_yards, course_rating_18, slope_rating_18, course_rating_front_9, slope_rating_front_9,
  course_rating_back_9, slope_rating_back_9, is_default, is_active)
select c.id, v.* from public.courses c, (values
  ('Blue', '#1F3A93', 'men'::public.tee_gender, 1::smallint, 72::smallint, 36::smallint, 36::smallint, null::integer, 68.8::numeric, 120::smallint, 34.4::numeric, 120::smallint, 34.4::numeric, 120::smallint, false, false),
  ('White', '#F2F0E9', 'men'::public.tee_gender, 2::smallint, 72::smallint, 36::smallint, 36::smallint, 6237::integer, 67.2::numeric, 116::smallint, 33.6::numeric, 116::smallint, 33.6::numeric, 116::smallint, true, true),
  ('Red', '#A3242A', 'ladies'::public.tee_gender, 3::smallint, 72::smallint, 36::smallint, 36::smallint, null::integer, 68.3::numeric, 118::smallint, 34.2::numeric, 118::smallint, 34.1::numeric, 118::smallint, false, false)
) as v(name, color_hex, gender, sort_order, par_18, par_front_9, par_back_9, total_yards,
         course_rating_18, slope_rating_18, course_rating_front_9, slope_rating_front_9,
         course_rating_back_9, slope_rating_back_9, is_default, is_active)
where c.slug = 'asc-centre-bengaluru'
on conflict (course_id, name) do update set
  color_hex = excluded.color_hex, gender = excluded.gender, sort_order = excluded.sort_order,
  par_18 = excluded.par_18, par_front_9 = excluded.par_front_9, par_back_9 = excluded.par_back_9,
  total_yards = excluded.total_yards, course_rating_18 = excluded.course_rating_18,
  slope_rating_18 = excluded.slope_rating_18, course_rating_front_9 = excluded.course_rating_front_9,
  slope_rating_front_9 = excluded.slope_rating_front_9, course_rating_back_9 = excluded.course_rating_back_9,
  slope_rating_back_9 = excluded.slope_rating_back_9, is_default = excluded.is_default,
  is_active = excluded.is_active;

-- Holes ---------------------------------------------------------------------
insert into public.course_holes (course_id, hole_number, par, stroke_index, name)
select c.id, v.hole_number, v.par, v.stroke_index, v.name from public.courses c, (values
  ( 1::smallint, 4::smallint,  5::smallint, null::text),
  ( 2::smallint, 4::smallint,  7::smallint, null::text),
  ( 3::smallint, 5::smallint, 17::smallint, null::text),
  ( 4::smallint, 4::smallint,  9::smallint, null::text),
  ( 5::smallint, 3::smallint,  3::smallint, null::text),
  ( 6::smallint, 5::smallint, 13::smallint, null::text),
  ( 7::smallint, 4::smallint,  1::smallint, null::text),
  ( 8::smallint, 3::smallint, 15::smallint, null::text),
  ( 9::smallint, 4::smallint, 11::smallint, null::text),
  (10::smallint, 5::smallint,  4::smallint, null::text),
  (11::smallint, 4::smallint,  8::smallint, null::text),
  (12::smallint, 4::smallint, 10::smallint, null::text),
  (13::smallint, 3::smallint, 14::smallint, null::text),
  (14::smallint, 4::smallint, 12::smallint, null::text),
  (15::smallint, 4::smallint,  2::smallint, null::text),
  (16::smallint, 4::smallint,  6::smallint, null::text),
  (17::smallint, 3::smallint, 18::smallint, null::text),
  (18::smallint, 5::smallint, 16::smallint, null::text)
) as v(hole_number, par, stroke_index, name)
where c.slug = 'asc-centre-bengaluru'
on conflict (course_id, hole_number) do update set
  par = excluded.par, stroke_index = excluded.stroke_index, name = excluded.name;

-- Yardages (White tee, from GPS) -------------------------------------------
insert into public.hole_yardages (course_id, hole_id, tee_id, yards)
select h.course_id, h.id, t.id, v.yards
from (values
  ( 1::smallint, 'White', 334::smallint),
  ( 2::smallint, 'White', 303::smallint),
  ( 3::smallint, 'White', 446::smallint),
  ( 4::smallint, 'White', 337::smallint),
  ( 5::smallint, 'White', 202::smallint),
  ( 6::smallint, 'White', 489::smallint),
  ( 7::smallint, 'White', 372::smallint),
  ( 8::smallint, 'White', 174::smallint),
  ( 9::smallint, 'White', 298::smallint),
  (10::smallint, 'White', 546::smallint),
  (11::smallint, 'White', 349::smallint),
  (12::smallint, 'White', 339::smallint),
  (13::smallint, 'White', 221::smallint),
  (14::smallint, 'White', 395::smallint),
  (15::smallint, 'White', 410::smallint),
  (16::smallint, 'White', 342::smallint),
  (17::smallint, 'White', 156::smallint),
  (18::smallint, 'White', 524::smallint)
) as v(hole_number, tee_name, yards)
join public.courses c on c.slug = 'asc-centre-bengaluru'
join public.course_holes h on h.course_id = c.id and h.hole_number = v.hole_number
join public.course_tees t on t.course_id = c.id and t.name = v.tee_name
on conflict (hole_id, tee_id) do update set yards = excluded.yards;

-- Caddy rate card ------------------------------------------------------------
insert into public.caddy_rate_tiers (course_id, grade, label, description, rate_9_paise, rate_18_paise)
select c.id, v.* from public.courses c, (values
  ('grade_a'::public.caddy_grade, 'Master Caddy (Grade A)', '10+ years at ASC Centre; expert green reading & yardage management', 50000, 90000),
  ('grade_b'::public.caddy_grade, 'Senior Caddy (Grade B)', '5+ years course experience; tournament certified', 40000, 70000),
  ('grade_c'::public.caddy_grade, 'Standard Caddy (Grade C)', 'Bag carry, forecaddying & pace-of-play support', 30000, 55000)
) as v(grade, label, description, rate_9_paise, rate_18_paise)
where c.slug = 'asc-centre-bengaluru'
on conflict (course_id, grade) do update set
  label = excluded.label, description = excluded.description,
  rate_9_paise = excluded.rate_9_paise, rate_18_paise = excluded.rate_18_paise;

-- Caddies ---------------------------------------------------------------------
-- Note: 'chethan M' in the source JSON is capitalised to 'Chethan M'.
insert into public.caddies (course_id, caddy_code, full_name, phone, grade, years_experience, rating,
  daily_rate_9_paise, daily_rate_18_paise, upi_id, is_active, is_available)
select c.id, v.* from public.courses c, (values
  ('ASC-C01', 'Ramesh Gowda', '+919845011101', 'grade_a'::public.caddy_grade, 14::smallint, 4.9::numeric, 50000, 90000, 'ramesh.c01@okaxis', true, true),
  ('ASC-C02', 'Manjunath K', '+919845011102', 'grade_a'::public.caddy_grade, 11::smallint, 4.8::numeric, 50000, 90000, 'manju.c02@okicici', true, true),
  ('ASC-C03', 'Suresh Babu', '+919845011103', 'grade_b'::public.caddy_grade, 8::smallint, 4.7::numeric, 40000, 70000, 'suresh.c03@oksbi', true, true),
  ('ASC-C04', 'Prakash Shetty', '+919845011104', 'grade_b'::public.caddy_grade, 6::smallint, 4.7::numeric, 40000, 70000, 'prakash.c04@ybl', true, true),
  ('ASC-C05', 'Naveen Kumar', '+919845011105', 'grade_b'::public.caddy_grade, 5::smallint, 4.6::numeric, 40000, 70000, 'naveen.c05@okhdfcbank', true, true),
  ('ASC-C06', 'Chethan M', '+919845011106', 'grade_c'::public.caddy_grade, 3::smallint, 4.5::numeric, 30000, 55000, 'chethan.c06@ybl', true, true),
  ('ASC-C07', 'Darshan R', '+919845011107', 'grade_c'::public.caddy_grade, 2::smallint, 4.4::numeric, 30000, 55000, 'darshan.c07@oksbi', true, true),
  ('ASC-C08', 'Venkatesh Murthy', '+919845011108', 'grade_a'::public.caddy_grade, 16::smallint, 4.9::numeric, 50000, 90000, 'venky.c08@okaxis', true, true)
) as v(caddy_code, full_name, phone, grade, years_experience, rating,
         daily_rate_9_paise, daily_rate_18_paise, upi_id, is_active, is_available)
where c.slug = 'asc-centre-bengaluru'
on conflict (course_id, caddy_code) do update set
  full_name = excluded.full_name, phone = excluded.phone, grade = excluded.grade,
  years_experience = excluded.years_experience, rating = excluded.rating,
  daily_rate_9_paise = excluded.daily_rate_9_paise, daily_rate_18_paise = excluded.daily_rate_18_paise,
  upi_id = excluded.upi_id, is_active = excluded.is_active;

-- Surface data problems at seed time without blocking it.
do $$
declare
  r record;
begin
  for r in
    select i.issue, i.detail from public.course_integrity_issues i
    join public.courses c on c.id = i.course_id where c.slug = 'asc-centre-bengaluru'
  loop
    raise warning 'ASC seed integrity: % — %', r.issue, r.detail;
  end loop;
end;
$$;

commit;

