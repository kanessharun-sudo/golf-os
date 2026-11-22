-- Behavioural checks for Phase 1. Run after the shim + both migrations.
-- Each block raises on failure; the script stops at the first broken invariant.
\set ON_ERROR_STOP on
begin;

-- Users -----------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'arjun@example.com', '{"full_name":"Arjun Rao"}'),
  ('00000000-0000-4000-8000-000000000002', 'meera@example.com', '{"full_name":"Meera Iyer","username":"meera"}'),
  ('00000000-0000-4000-8000-000000000003', 'ramesh@example.com', '{"full_name":"Ramesh Gowda"}'),
  ('00000000-0000-4000-8000-000000000004', 'admin@example.com', '{}'),
  ('00000000-0000-4000-8000-000000000005', 'arjun@other.com', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 5, 'profiles auto-created';
  assert (select username from public.profiles where id = '00000000-0000-4000-8000-000000000005') like 'arjun\_%',
    'username collision gets suffix';
end $$;

update public.profiles set role = 'super_admin' where id = '00000000-0000-4000-8000-000000000004';
update public.caddies set profile_id = '00000000-0000-4000-8000-000000000003' where caddy_code = 'ASC-C01';
update public.profiles set role = 'caddy' where id = '00000000-0000-4000-8000-000000000003';

-- A future Wednesday inside the booking window (Tuesday is closed).
create temp table t_ctx as
select (current_date + (((3 - extract(isodow from current_date)::int) + 7) % 7) + 7)::date as play_date,
       (select id from public.courses where slug = 'asc-centre-bengaluru') as course_id;
grant select on t_ctx to authenticated;

-- 1. Tee-sheet rules ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $$
declare v public.slot_holds; ctx t_ctx;
begin
  select * into ctx from t_ctx;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date - 1, '06:00', 'full_18', 2::smallint);
    raise exception 'expected closed-day rejection';
  exception when others then assert sqlerrm = 'course_closed_on_date', sqlerrm; end;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:05', 'full_18', 2::smallint);
    raise exception 'expected off-grid rejection';
  exception when others then assert sqlerrm = 'tee_time_off_grid', sqlerrm; end;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '14:00', 'full_18', 2::smallint);
    raise exception 'expected window rejection';
  exception when others then assert sqlerrm = 'tee_time_outside_window', sqlerrm; end;
  -- 14:00 is legal for 9 holes (last 9-hole tee 15:45).
  v := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '14:00', 'front_9', 1::smallint);
  assert v.status = 'active' and v.expires_at between now() + interval '6 min 59 s' and now() + interval '7 min 1 s', '7-minute hold';
  -- Acquiring a new hold releases the old one.
  v := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '05:00', 'full_18', 3::smallint);
  assert (select count(*) from public.slot_holds where status = 'active') = 1, 'one active hold per golfer';
end $$;

-- Second golfer: only 1 seat left at 05:00.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$
declare ctx t_ctx;
begin
  select * into ctx from t_ctx;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '05:00', 'full_18', 2::smallint);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '05:00', 'full_18', 1::smallint, true);
    raise exception 'expected private rejection';
  exception when others then assert sqlerrm = 'slot_not_empty_for_private', sqlerrm; end;
  perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '05:00', 'full_18', 1::smallint);
  -- Back nine is an independent sheet starting on 10.
  perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '05:00', 'back_9', 4::smallint);
end $$;
reset role;

-- 2. Caddy availability & hard overlap guarantee ---------------------------------
do $$
declare ctx t_ctx; v_hold uuid; v_c01 uuid; v_avail int; v_start timestamptz;
begin
  select * into ctx from t_ctx;
  select id into v_c01 from public.caddies where caddy_code = 'ASC-C01';
  select id into v_hold from public.slot_holds
   where profile_id = '00000000-0000-4000-8000-000000000001' and status = 'active';
  v_start := (ctx.play_date + time '05:00') at time zone 'Asia/Kolkata';

  insert into public.caddy_assignments (course_id, caddy_id, slot_hold_id, hole_format, starts_at, ends_at,
                                        status, hold_expires_at, rate_paise)
  values (ctx.course_id, v_c01, v_hold, 'full_18', v_start, v_start + interval '270 min',
          'held', now() + interval '7 min', 90000);

  -- 09:15 is inside 05:00 + 270 min (ends 09:30): C01 must be unavailable.
  select count(*) into v_avail from public.get_available_caddies(ctx.course_id, ctx.play_date, '09:15', 'front_9')
   where caddy_code = 'ASC-C01';
  assert v_avail = 0, 'C01 hidden during overlapping window';
  -- 09:30 starts exactly when the 18-hole window ends: available again.
  select count(*) into v_avail from public.get_available_caddies(ctx.course_id, ctx.play_date, '09:30', 'front_9')
   where caddy_code = 'ASC-C01';
  assert v_avail = 1, 'C01 available after window';
  -- 03:00 tee for 9 holes would end 05:15: but 03:00 is before first tee, so test 05:00 front 9 elsewhere.
  select count(*) into v_avail from public.get_available_caddies(ctx.course_id, ctx.play_date, '05:00', 'front_9');
  assert v_avail = 7, 'seven of eight caddies free at 05:00';

  begin
    insert into public.caddy_assignments (course_id, caddy_id, slot_hold_id, hole_format, starts_at, ends_at,
                                          status, hold_expires_at, rate_paise)
    values (ctx.course_id, v_c01, v_hold, 'front_9', v_start + interval '2 hours', v_start + interval '4 hours 15 min',
            'held', now() + interval '7 min', 50000);
    raise exception 'expected exclusion violation';
  exception when exclusion_violation then null; end;
end $$;

-- 3. Booking conversion + capacity trigger ---------------------------------------
do $$
declare ctx t_ctx; v_hold public.slot_holds; v_booking uuid;
begin
  select * into ctx from t_ctx;
  select * into v_hold from public.slot_holds
   where profile_id = '00000000-0000-4000-8000-000000000001' and status = 'active';

  insert into public.bookings (course_id, booked_by, slot_hold_id, play_date, tee_time, hole_format, player_count,
                               green_fee_paise, caddy_fee_paise, convenience_fee_paise, total_paise,
                               tee_id, razorpay_order_id, razorpay_payment_id, paid_at, start_hole, tee_starts_at)
  values (ctx.course_id, v_hold.profile_id, v_hold.id, v_hold.play_date, v_hold.tee_time, v_hold.hole_format, 3,
          600000, 90000, 17250, 707250,
          (select id from public.course_tees where course_id = ctx.course_id and name = 'White'),
          'order_TEST1', 'pay_TEST1', now(), 1, now())
  returning id into v_booking;

  assert (select status from public.slot_holds where id = v_hold.id) = 'converted', 'hold converted';
  assert (select status from public.caddy_assignments where slot_hold_id = v_hold.id) = 'confirmed', 'caddy confirmed';
  assert (select booking_ref from public.bookings where id = v_booking) ~ '^GOS-\d{6}-[0-9A-F]{6}$', 'booking ref format';
  assert (select tee_starts_at from public.bookings where id = v_booking)
         = (ctx.play_date + time '05:00') at time zone 'Asia/Kolkata', 'tee_starts_at derived, not trusted';

  insert into public.booking_players (booking_id, seat_number, full_name, profile_id, is_booker) values
    (v_booking, 1, 'Arjun Rao', '00000000-0000-4000-8000-000000000001', true),
    (v_booking, 2, 'Kiran Guest', null, false),
    (v_booking, 3, 'Meera Iyer', '00000000-0000-4000-8000-000000000002', false);
  begin
    insert into public.booking_players (booking_id, seat_number, full_name) values (v_booking, 4, 'Too Many');
    raise exception 'expected seat rejection';
  exception when others then assert sqlerrm = 'seat_exceeds_player_count', sqlerrm; end;

  -- Direct insert that would overfill the slot (3 booked + 2 more). Meera's 05:00 hold
  -- was released when she took the back-nine hold (one live checkout per golfer).
  begin
    insert into public.bookings (course_id, booked_by, play_date, tee_time, hole_format, player_count, total_paise,
                                 start_hole, tee_starts_at)
    values (ctx.course_id, '00000000-0000-4000-8000-000000000004', ctx.play_date, '05:00', 'full_18', 2, 0, 1, now());
    raise exception 'expected capacity rejection';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
end $$;

-- 4. Live scoring, Net Double Bogey, handicaps, caddy ledger ---------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$
declare v_booking uuid; v_round uuid; rp record; h record; v_strokes int;
begin
  select id into v_booking from public.bookings where booked_by = '00000000-0000-4000-8000-000000000001';
  insert into public.rounds (booking_id, course_id, hole_format, start_hole)
  values (v_booking, gen_random_uuid(), 'front_9', 10) returning id into v_round;
  assert (select hole_format from public.rounds where id = v_round) = 'full_18', 'round shape mirrors booking';
  assert (select count(*) from public.round_players where round_id = v_round) = 3, 'round players from booking';

  -- Any participant records every player's card; every hole par + 3 (triple bogey).
  for rp in select id from public.round_players where round_id = v_round loop
    for h in select hole_number, par from public.course_holes
             where course_id = (select course_id from public.rounds where id = v_round) loop
      insert into public.hole_scores (round_player_id, round_id, hole_number, strokes)
      values (rp.id, v_round, h.hole_number, h.par + 3);
    end loop;
  end loop;

  -- No handicap index yet -> cap is par + 5, so par + 3 stands.
  select sum(adjusted_strokes) into v_strokes from public.hole_scores
   where round_player_id = (select id from public.round_players where round_id = v_round limit 1);
  assert v_strokes = 72 + 54, 'AGS = par 72 + 54 with no index';
  assert (select status from public.rounds where id = v_round) = 'in_progress', 'first score starts round';

  update public.rounds set status = 'completed' where id = v_round;
end $$;
reset role;

do $$
declare v_round uuid; v_diff numeric;
begin
  select id into v_round from public.rounds limit 1;
  -- White tee: CR 67.2, slope 116. Differential = (126 - 67.2) * 113 / 116 = 57.3
  select score_differential into v_diff from public.round_players
   where round_id = v_round and profile_id = '00000000-0000-4000-8000-000000000001';
  assert v_diff = 57.3, format('differential %s', v_diff);
  assert (select counts_for_handicap from public.round_players where round_id = v_round and profile_id is null) = false,
    'guest round does not count';
  -- One round: no index yet (WHS needs 3), but average is tracked.
  assert (select handicap_18 is null and avg_score_18 = 126 and rounds_counted_18 = 1
          from public.profiles where id = '00000000-0000-4000-8000-000000000001'), 'profile 18-hole stats';
  assert (select count(*) from public.handicap_snapshots
          where profile_id = '00000000-0000-4000-8000-000000000001') = 2, 'both tracks snapshotted';
  -- Caddy credited once, net of 0% commission.
  assert (select balance_after_paise from public.caddy_ledger order by id desc limit 1) = 90000, 'caddy credited';
  assert (select status from public.bookings limit 1) = 'completed', 'booking completed';
end $$;

-- WHS table sanity.
do $$ begin
  assert public.handicap_index_from_differentials(array[20.0, 18.0, 22.0]) = 16.0, '3 rounds: lowest - 2';
  assert public.handicap_index_from_differentials(array[10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29]::numeric[]) = 13.5,
    '20 rounds: avg lowest 8';
  assert public.handicap_index_from_differentials(array[60,61,62]::numeric[]) = 54.0, 'cap 54';
  assert public.strokes_received(20, 1, 18) = 2 and public.strokes_received(20, 3, 18) = 1, 'stroke allocation';
  assert public.strokes_received(-2, 18, 18) = -1 and public.strokes_received(-2, 16, 18) = 0, 'plus handicap';
end $$;

-- Rounds are final.
do $$ begin
  update public.rounds set status = 'in_progress';
  raise exception 'expected final';
exception when others then assert sqlerrm = 'round_already_final', sqlerrm; end $$;

-- 5. Ledger immutability and payouts --------------------------------------------
do $$ begin
  update public.caddy_ledger set amount_paise = 1;
  raise exception 'expected immutability';
exception when others then assert sqlerrm = 'caddy_ledger_is_append_only', sqlerrm; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
do $$
declare v_req uuid;
begin
  assert (select count(*) from public.caddy_ledger) = 1, 'caddy sees own ledger';
  begin
    insert into public.caddy_payout_requests (caddy_id, amount_paise, upi_id, course_id)
    values (public.current_caddy_id(), 95000, 'x@y', gen_random_uuid());
    raise exception 'expected balance rejection';
  exception when others then assert sqlerrm = 'payout_exceeds_balance', sqlerrm; end;
  insert into public.caddy_payout_requests (caddy_id, amount_paise, upi_id, course_id)
  values (public.current_caddy_id(), 50000, 'attacker@ybl', gen_random_uuid()) returning id into v_req;
  assert (select upi_id from public.caddy_payout_requests where id = v_req) = 'ramesh.c01@okaxis', 'UPI snapshot from caddy';
  begin
    update public.caddy_payout_requests set status = 'approved' where id = v_req;
    raise exception 'expected caddy cannot approve';
  exception when others then assert sqlerrm = 'invalid_payout_transition', sqlerrm; end;
  begin
    update public.caddies set daily_rate_18_paise = 999999 where id = public.current_caddy_id();
    raise exception 'expected caddy cannot change rate';
  exception when others then assert sqlerrm = 'caddy_self_service_column', sqlerrm; end;
  update public.caddies set is_available = false where id = public.current_caddy_id();
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', true);
do $$ begin
  update public.caddy_payout_requests set status = 'approved';
  update public.caddy_payout_requests set status = 'paid', utr = 'UTR123';
  assert (select balance_after_paise from public.caddy_ledger order by id desc limit 1) = 40000, 'payout debited';
end $$;

-- 6. RLS boundaries ---------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', true);
do $$ begin
  assert (select count(*) from public.bookings) = 0, 'outsider sees no bookings';
  assert (select count(*) from public.caddies) = 0, 'outsider cannot read caddy PII';
  assert (select count(*) from public.get_course_caddies((select course_id from t_ctx))) = 8, 'public caddy roster';
  assert (select count(*) from public.caddy_ledger) = 0, 'outsider sees no ledger';
  assert (select count(*) from public.round_players) = 2, 'only public linked players of completed rounds';
  begin
    update public.profiles set role = 'super_admin' where id = '00000000-0000-4000-8000-000000000005';
    raise exception 'expected escalation block';
  exception when others then assert sqlerrm = 'profile_privileged_column', sqlerrm; end;
  update public.profiles set bio = 'Weekend golfer' where id = '00000000-0000-4000-8000-000000000005';
  begin
    perform public.recalculate_player_handicaps('00000000-0000-4000-8000-000000000005');
    raise exception 'expected no execute';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ begin
  assert (select count(*) from public.courses) = 1, 'anon sees published course';
  assert (select count(*) from public.course_holes) = 18, 'anon sees holes';
  assert (select count(*) from public.hole_yardages) = 18, 'anon sees yardages';
  begin
    perform public.acquire_slot_hold((select course_id from t_ctx), current_date + 3, '06:00', 'full_18', 1::smallint);
    raise exception 'expected anon blocked';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL PHASE 1 CHECKS PASSED' as result;
rollback;
