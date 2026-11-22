-- =============================================================================
-- Golf OS — 008_demo_seed_today.sql  (Phase 4)
-- The demo tee sheet now includes today's groups (so the caddie demo can check
-- a group in at any hour) and leaves all-member groups without a caddie free.
-- Replaces one function; changes no data.
-- =============================================================================

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
    continue when extract(isodow from v_day)::int = any (v_course.closed_weekdays::int[]);
    continue when exists (select 1 from public.bookings
                          where course_id = p_course_id and play_date = v_day and notes = 'demo_seed');
    v_n := 6 + (d % 3);
    for v_i in 1 .. v_n loop
      v_seats := case when v_i % 3 = 0 then 3 else 4 end;
      v_members := case when v_i % 4 = 0 then v_seats else v_seats - 1 - (v_i % 2) end;
      begin
        -- Today keeps its early groups even once their tee time has passed, so the
        -- caddie and club office demos always have a live day to show.
        if d > 0 then
          perform public.resolve_tee_slot(p_course_id, v_day, v_times[v_i], 'full_18');
        end if;
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

      -- A caddie on most groups; all-member groups without one play free.
      if v_i % 4 not in (0, 3) then
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
