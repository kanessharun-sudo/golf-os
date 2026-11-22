-- Behavioural checks for Phase 2 checkout. Run after shim + 001 + 002 + 003.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-9000-000000000001', 'booker@example.com', null, now(), null, '{"full_name":"Kavya Booker"}'),
  ('00000000-0000-4000-9000-000000000002', 'guest@example.com', '919800000002', now(), now(), '{"full_name":"Guest Golfer"}'),
  ('00000000-0000-4000-9000-000000000003', 'rival@example.com', null, now(), null, '{"full_name":"Rival Golfer"}'),
  ('00000000-0000-4000-9000-000000000004', 'unverified@example.com', null, null, null, '{}');

create temp table t2 as
select (current_date + (((3 - extract(isodow from current_date)::int) + 7) % 7) + 7)::date as play_date,
       c.id as course_id,
       (select id from public.course_tees where course_id = c.id and name = 'White') as tee_id,
       (select id from public.caddies where course_id = c.id and caddy_code = 'ASC-C01') as c01,
       (select id from public.caddies where course_id = c.id and caddy_code = 'ASC-C02') as c02
from public.courses c where c.slug = 'asc-centre-bengaluru';
create temp table t2_state (k text primary key, v text);
grant select on t2 to anon, authenticated;
grant select, insert, update on t2_state to authenticated, service_role;

-- 1. Tee sheet ---------------------------------------------------------------
set local role anon;
do $$
declare ctx t2; n int; r record;
begin
  select * into ctx from t2;
  select count(*) into n from public.get_tee_sheet(ctx.course_id, ctx.play_date);
  -- 05:00..15:45 every 15 min = 44 times, front and back sheets.
  assert n = 88, format('tee sheet rows %s', n);
  select * into r from public.get_tee_sheet(ctx.course_id, ctx.play_date) where tee_time = '13:45' and start_hole = 1;
  assert not r.allows_full_18 and r.allows_front_9 and r.unavailable_reason is null, '13:45 is 9-hole only';
  assert r.price_9_paise = 120000 and r.price_18_paise = 200000, 'weekday rate card';
  select * into r from public.get_tee_sheet(ctx.course_id, ctx.play_date - 1) limit 1;
  assert r.unavailable_reason = 'course_closed_on_date', 'Tuesday closed';
end $$;
reset role;

-- 2. Hold, details, caddy, quote -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000001', true);
do $$
declare ctx t2; h public.slot_holds; q jsonb; a public.caddy_assignments;
begin
  select * into ctx from t2;
  h := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:00', 'full_18', 2::smallint);
  insert into t2_state values ('hold', h.id::text);

  begin
    perform public.save_hold_details(h.id, '[{"seat_number":1,"full_name":"Kavya"}]'::jsonb, ctx.tee_id);
    raise exception 'expected count mismatch';
  exception when others then assert sqlerrm = 'player_count_mismatch', sqlerrm; end;
  begin
    perform public.save_hold_details(h.id,
      '[{"seat_number":1,"full_name":"Kavya","is_booker":true},{"seat_number":3,"full_name":"Gap"}]'::jsonb, ctx.tee_id);
    raise exception 'expected contiguous seats';
  exception when others then assert sqlerrm = 'seat_numbers_not_contiguous', sqlerrm; end;

  perform public.save_hold_details(h.id,
    '[{"seat_number":1,"full_name":"Kavya","is_booker":true},
      {"seat_number":2,"full_name":"Guest","phone":"+919800000002"}]'::jsonb, ctx.tee_id, 'tournament');

  a := public.hold_caddy(h.id, ctx.c01, 1::smallint);
  assert a.status = 'held' and a.rate_paise > 0 and a.seat_number = 1, 'caddy held for seat 1';
  -- Re-picking the same seat swaps the caddy.
  a := public.hold_caddy(h.id, ctx.c02, 1::smallint);
  assert (select count(*) from public.caddy_assignments where slot_hold_id = h.id and status = 'held') = 1, 'one caddy per seat';
  a := public.hold_caddy(h.id, ctx.c01, 2::smallint);

  q := public.quote_slot_hold(h.id);
  -- 2 × 200000 green + tournament 2 × 50000 + two caddies, fee 2.5% rounded.
  assert (q ->> 'green_fee_paise')::int = 400000, q::text;
  assert (q ->> 'tournament_addon_paise')::int = 100000, q::text;
  assert (q ->> 'convenience_fee_paise')::int
         = round(((q ->> 'green_fee_paise')::int + (q ->> 'caddy_fee_paise')::int + 100000) * 0.025), q::text;
  assert jsonb_array_length(q -> 'caddy_assignment_ids') = 2, 'quote pins caddies';
  insert into t2_state values ('total', q ->> 'total_paise');
  assert (select count(*) from public.get_hold_caddies(h.id)) = 2, 'hold caddies visible to owner';
end $$;

-- A rival cannot take caddy C01 for an overlapping window.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000003', true);
do $$
declare ctx t2; h public.slot_holds;
begin
  select * into ctx from t2;
  h := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '07:00', 'full_18', 1::smallint);
  perform public.save_hold_details(h.id, '[{"seat_number":1,"full_name":"Rival","is_booker":true}]'::jsonb, ctx.tee_id);
  begin
    perform public.hold_caddy(h.id, ctx.c01, 1::smallint);
    raise exception 'expected overlap rejection';
  exception when others then assert sqlerrm = 'caddy_unavailable', sqlerrm; end;
  assert (select count(*) from public.get_hold_caddies((select v::uuid from t2_state where k = 'hold'))) = 0,
    'hold caddies hidden from others';
  -- Another golfer cannot touch someone else's hold.
  begin
    perform public.quote_slot_hold((select v::uuid from t2_state where k = 'hold'));
    raise exception 'expected hold_not_found';
  exception when others then assert sqlerrm = 'hold_not_found', sqlerrm; end;
end $$;
reset role;

-- 3. Payment confirmation (service role) --------------------------------------
set local role service_role;
do $$
declare v_hold uuid; v_total int; r record; b public.bookings;
begin
  select v::uuid into v_hold from t2_state where k = 'hold';
  select v::int into v_total from t2_state where k = 'total';
  begin
    perform public.attach_razorpay_order(v_hold, 'order_T1', v_total + 1);
    raise exception 'expected quote mismatch';
  exception when others then assert sqlerrm = 'quote_mismatch', sqlerrm; end;
  perform public.attach_razorpay_order(v_hold, 'order_T1', v_total);

  select * into r from public.confirm_hold_payment('order_T1', 'pay_T1', v_total - 100);
  assert r.result = 'refund_amount_mismatch', r.result;

  -- Simulate the 7-minute hold lapsing while the golfer was in Razorpay.
  update public.slot_holds set expires_at = now() - interval '1 second' where id = v_hold;
  update public.caddy_assignments set hold_expires_at = now() - interval '1 second' where slot_hold_id = v_hold and status = 'held';
  perform public.expire_stale_holds();

  select * into r from public.confirm_hold_payment('order_T1', 'pay_T1', v_total);
  assert r.result = 'confirmed', r.result;
  select * into b from public.bookings where id = r.booking_id;
  assert b.total_paise = v_total and b.player_count = 2 and b.mode = 'tournament' and b.status = 'confirmed', 'booking row';
  assert (select count(*) from public.caddy_assignments where booking_id = b.id and status = 'confirmed') = 2, 'caddies re-armed and confirmed';
  assert (select status from public.slot_holds where id = v_hold) = 'converted', 'hold converted';
  assert (select profile_id from public.booking_players where booking_id = b.id and seat_number = 2)
         = '00000000-0000-4000-9000-000000000002', 'verified guest linked by phone';
  assert (select count(*) from public.caddy_assignments where booking_id = b.id and booking_player_id is not null) = 2, 'caddy mapped to player';

  -- Webhook replay is idempotent.
  select * into r from public.confirm_hold_payment('order_T1', 'pay_T1', v_total);
  assert r.result = 'already_confirmed' and r.booking_id = b.id, 'idempotent';
  insert into t2_state values ('booking', b.id::text);
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000002', true);
do $$
begin
  -- The linked guest sees the booking and its caddies; a stranger does not.
  assert (select count(*) from public.get_booking_caddies((select v::uuid from t2_state where k = 'booking'))) = 2, 'guest sees caddies';
  assert (select count(*) from public.bookings) = 1, 'guest sees booking via RLS';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000003', true);
do $$
begin
  assert (select count(*) from public.get_booking_caddies((select v::uuid from t2_state where k = 'booking'))) = 0, 'stranger blocked';
end $$;
reset role;

-- 4. Late payment against a slot that filled up -----------------------------------
do $$
declare ctx t2; v_hold uuid; r record; q jsonb;
begin
  select * into ctx from t2;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000004', true);
  set local role authenticated;
  v_hold := (public.acquire_slot_hold(ctx.course_id, ctx.play_date, '08:00', 'full_18', 4::smallint)).id;
  perform public.save_hold_details(v_hold,
    '[{"seat_number":1,"full_name":"A","is_booker":true},{"seat_number":2,"full_name":"B"},
      {"seat_number":3,"full_name":"C"},{"seat_number":4,"full_name":"D"}]'::jsonb, ctx.tee_id);
  q := public.quote_slot_hold(v_hold);
  reset role;
  perform public.attach_razorpay_order(v_hold, 'order_T2', (q ->> 'total_paise')::int);
  update public.slot_holds set expires_at = now() - interval '1 second' where id = v_hold;
  perform public.expire_stale_holds();

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000003', true);
  set local role authenticated;
  perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '08:00', 'full_18', 1::smallint);
  reset role;

  select * into r from public.confirm_hold_payment('order_T2', 'pay_T2', (q ->> 'total_paise')::int);
  assert r.result = 'refund_slot_taken', r.result;
  assert not exists (select 1 from public.bookings where razorpay_order_id = 'order_T2'), 'no oversell';
end $$;

-- 5. Cancellation policy (24h full refund, convenience fee kept) ----------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000003', true);
do $$
begin
  begin
    perform public.cancel_booking((select v::uuid from t2_state where k = 'booking'));
    raise exception 'expected booking_not_found';
  exception when others then assert sqlerrm = 'booking_not_found', sqlerrm; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-9000-000000000001', true);
do $$
declare r record; b public.bookings;
begin
  select * into r from public.cancel_booking((select v::uuid from t2_state where k = 'booking'), 'plans changed');
  select * into b from public.bookings where id = (select v::uuid from t2_state where k = 'booking');
  assert r.refund_paise = b.total_paise - b.convenience_fee_paise, format('refund %s', r.refund_paise);
  assert b.status = 'cancelled' and b.payment_status = 'refund_pending', 'cancelled, refund pending';
  assert (select count(*) from public.caddy_assignments where booking_id = b.id and status = 'cancelled') = 2, 'caddies freed';
end $$;
reset role;

do $$
declare b public.bookings;
begin
  perform public.mark_booking_refunded((select v::uuid from t2_state where k = 'booking'), 'rfnd_T1');
  select * into b from public.bookings where id = (select v::uuid from t2_state where k = 'booking');
  assert b.status = 'refunded' and b.payment_status = 'refunded' and b.refunded_at is not null, 'refund recorded';
end $$;

-- Inside 24h: no refund. Shift a fresh booking to tomorrow-ish by policy check.
do $$
declare v_pol jsonb;
begin
  select cancellation_policy into v_pol from public.courses where slug = 'asc-centre-bengaluru';
  assert v_pol = '{"tiers":[{"min_hours_before":24,"green_fee_refund_percent":100,"caddy_fee_refund_percent":100}],"refund_convenience_fee":false}'::jsonb,
    'ASC uses the chosen policy';
  begin
    update public.courses set cancellation_policy = '{"tiers":[{"min_hours_before":24}]}' where slug = 'asc-centre-bengaluru';
    raise exception 'expected policy check';
  exception when check_violation then null; end;
end $$;

-- 6. Privileges -----------------------------------------------------------------
set local role authenticated;
do $$
begin
  begin
    perform public.confirm_hold_payment('x', 'y', 1);
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.payment_events;
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'ALL PHASE 2 CHECKS PASSED' as result;
rollback;
