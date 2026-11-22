-- Behavioural checks for Phase 4: member pricing, 3/4-ball blocks, free
-- bookings, player linking, caddie schedule and check-in, demo seed.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, phone, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-a000-000000000001', 'member.booker@example.com', null, now(), '{"full_name":"Member Booker"}'),
  ('00000000-0000-4000-a000-000000000002', 'later.player@example.com', null, now(), '{"full_name":"Later Player"}'),
  ('00000000-0000-4000-a000-000000000003', 'caddie@example.com', null, now(), '{"full_name":"Caddie One"}'),
  ('00000000-0000-4000-a000-000000000004', 'seed@example.com', null, now(), '{"full_name":"Seed"}');

create temp table t5 as
select (current_date + (((3 - extract(isodow from current_date)::int) + 7) % 7) + 14)::date as play_date,
       c.id as course_id,
       (select id from public.course_tees where course_id = c.id and name = 'White') as tee_id
from public.courses c where c.slug = 'asc-centre-bengaluru';
create temp table t5_state (k text primary key, v text);
grant select on t5 to authenticated;
grant select, insert on t5_state to authenticated;

-- Member roll from a sheet sync (service role path).
select public.replace_sheet_members((select course_id from t5),
  '[{"member_no":"M1","full_name":"Member Booker","email":"Member.Booker@example.com"},
    {"member_no":"M2","full_name":"Lapsed","phone":"+919811111111","status":"lapsed"},
    {"member_no":"","full_name":"No number"}]'::jsonb);
do $$ begin
  assert (select count(*) from public.club_members where source = 'sheet') = 2, 'blank member_no skipped';
  assert public.is_club_member((select course_id from t5), null, 'member.booker@example.com'), 'email match ignores case';
  assert not public.is_club_member((select course_id from t5), '+919811111111', null), 'lapsed is not a member';
  assert (select count(*) from public.club_members where source = 'demo') >= 6, 'demo rows survive a sync';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
do $$
declare ctx t5; h public.slot_holds; q jsonb; b uuid;
begin
  select * into ctx from t5;
  -- A blocked slot must be a 3-ball or a 4-ball.
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:00', 'full_18', 2::smallint, true);
    raise exception 'expected invalid_seat_count';
  exception when others then assert sqlerrm = 'invalid_seat_count', sqlerrm; end;

  -- All-member 3-ball: nothing to pay, confirmed without payment.
  h := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:00', 'full_18', 3::smallint, true);
  assert h.seats = 3 and h.is_private, 'blocked 3-ball keeps 3 seats';
  perform public.save_hold_details(h.id,
    '[{"seat_number":1,"full_name":"Member Booker","email":"member.booker@example.com","is_booker":true},
      {"seat_number":2,"full_name":"Aditya Rao","phone":"+919800000001"},
      {"seat_number":3,"full_name":"Meera Iyer","email":"meera.iyer@demo.golf-os.example"}]'::jsonb, ctx.tee_id);
  q := public.quote_slot_hold(h.id);
  assert (q ->> 'members')::int = 3 and (q ->> 'total_paise')::int = 0, q::text;
  b := public.confirm_free_hold(h.id);
  assert (select status from public.bookings where id = b) = 'confirmed', 'free booking confirmed';
  assert (select payment_status from public.bookings where id = b) = 'waived', 'free booking waived';
  assert (select count(*) from public.booking_players where booking_id = b and is_member) = 3, 'member flags copied';

  -- Mixed 4-ball: one guest pays 100000 plus 2.5%.
  h := public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:15', 'full_18', 4::smallint, true);
  perform public.save_hold_details(h.id,
    '[{"seat_number":1,"full_name":"Member Booker","email":"member.booker@example.com","is_booker":true},
      {"seat_number":2,"full_name":"Aditya Rao","phone":"+919800000001"},
      {"seat_number":3,"full_name":"Kabir Shah","phone":"+919800000003"},
      {"seat_number":4,"full_name":"Later Player","email":"later.player@example.com"}]'::jsonb, ctx.tee_id);
  q := public.quote_slot_hold(h.id);
  assert (q ->> 'guests')::int = 1 and (q ->> 'green_fee_paise')::int = 100000, q::text;
  assert (q ->> 'convenience_fee_paise')::int = 2500, q::text;
  begin
    perform public.confirm_free_hold(h.id);
    raise exception 'expected payment_required';
  exception when others then assert sqlerrm = 'payment_required', sqlerrm; end;
  insert into t5_state values ('paid_hold', h.id::text), ('free_booking', b::text);
end $$;
reset role;

-- The blocked 3-ball closes the slot to a fourth golfer.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true);
do $$
declare ctx t5;
begin
  select * into ctx from t5;
  begin
    perform public.acquire_slot_hold(ctx.course_id, ctx.play_date, '06:00', 'full_18', 1::smallint);
    raise exception 'expected slot_full';
  exception when others then assert sqlerrm = 'slot_full', sqlerrm; end;
end $$;
reset role;

-- Pay the mixed 4-ball (service role), then the guest signs in and sees it.
do $$
declare v_hold uuid := (select v::uuid from t5_state where k = 'paid_hold'); q jsonb; r record;
begin
  select quote into q from public.slot_holds where id = v_hold;
  perform public.attach_razorpay_order(v_hold, 'order_T5', (q ->> 'total_paise')::int);
  select * into r from public.confirm_hold_payment('order_T5', 'pay_T5', (q ->> 'total_paise')::int);
  assert r.result = 'confirmed', r.result;
  insert into t5_state values ('paid_booking', r.booking_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true);
do $$
declare v_booking uuid := (select v::uuid from t5_state where k = 'paid_booking');
begin
  -- Linked at confirmation already (verified email) or by claim; either way visible.
  perform public.claim_my_bookings();
  assert exists (select 1 from public.bookings where id = v_booking), 'invited player sees the booking';
  assert public.claim_my_bookings() = 0, 'claim is idempotent';
end $$;
reset role;

-- Caddie schedule and check-in.
update public.profiles set role = 'caddy' where id = '00000000-0000-4000-a000-000000000003';
update public.caddies set profile_id = '00000000-0000-4000-a000-000000000003' where caddy_code = 'ASC-C03';
do $$
declare ctx t5; v_seeded int; v_a uuid; v_b uuid;
begin
  select * into ctx from t5;
  v_seeded := public.seed_demo_tee_sheet(ctx.course_id, '00000000-0000-4000-a000-000000000004', 3);
  assert v_seeded > 0, 'demo seed created bookings';
  assert public.seed_demo_tee_sheet(ctx.course_id, '00000000-0000-4000-a000-000000000004', 3) = 0, 'seed is idempotent';

  -- Give caddie C03 a booking today for the check-in test.
  select b.id into v_b from public.bookings b
   where b.notes = 'demo_seed' and b.play_date = (now() at time zone 'Asia/Kolkata')::date
     and not exists (select 1 from public.caddy_assignments a where a.booking_id = b.id and a.status = 'confirmed')
   limit 1;
  if v_b is not null then
    insert into public.caddy_assignments (course_id, caddy_id, booking_id, seat_number, hole_format, starts_at, ends_at, status, rate_paise)
    select ctx.course_id, c.id, v_b, 2, 'full_18', b.tee_starts_at, b.tee_starts_at + interval '4 hours', 'confirmed', 90000
    from public.caddies c, public.bookings b where c.caddy_code = 'ASC-C03' and b.id = v_b
    returning id into v_a;
    insert into t5_state values ('assignment', v_a::text);
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000003', true);
do $$
declare v_a uuid := (select v::uuid from t5_state where k = 'assignment'); n int;
begin
  select count(*) into n from public.get_caddy_schedule(current_date - 1, current_date + 30);
  assert n >= 1 or v_a is null, 'caddie sees own schedule';
  if v_a is not null then
    assert public.caddy_check_in(v_a) is not null, 'check-in stamps time';
    assert (select status from public.bookings b join public.caddy_assignments a on a.booking_id = b.id where a.id = v_a)
           = 'checked_in', 'booking marked checked in';
  end if;
end $$;
reset role;

-- Another user cannot check in someone else's assignment.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true);
do $$
declare v_a uuid := (select v::uuid from t5_state where k = 'assignment');
begin
  if v_a is not null then
    begin
      perform public.caddy_check_in(v_a);
      raise exception 'expected assignment_not_found';
    exception when others then assert sqlerrm = 'assignment_not_found', sqlerrm; end;
  end if;
  assert (select count(*) from public.get_caddy_schedule(current_date - 1, current_date + 30)) = 0, 'non-caddie sees nothing';
end $$;
reset role;

rollback;
