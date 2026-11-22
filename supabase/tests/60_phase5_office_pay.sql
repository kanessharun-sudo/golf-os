-- Behavioural checks for Phase 5: check-in pays the caddie, payouts, office caddie assignment.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-b000-000000000001', 'office@example.com', now(), '{"full_name":"Office"}'),
  ('00000000-0000-4000-b000-000000000002', 'caddie5@example.com', now(), '{"full_name":"Caddie Five"}'),
  ('00000000-0000-4000-b000-000000000003', 'booker5@example.com', now(), '{"full_name":"Booker Five"}');

create temp table t6 (k text primary key, v text);
grant select, insert on t6 to authenticated;

update public.profiles set role = 'course_admin' where id = '00000000-0000-4000-b000-000000000001';
insert into public.course_admins (course_id, profile_id)
select id, '00000000-0000-4000-b000-000000000001' from public.courses where slug = 'asc-centre-bengaluru';
update public.profiles set role = 'caddy' where id = '00000000-0000-4000-b000-000000000002';

do $$
declare v_course uuid := (select id from public.courses where slug = 'asc-centre-bengaluru'); v_b uuid; v_c uuid;
begin
  perform public.seed_demo_tee_sheet(v_course, '00000000-0000-4000-b000-000000000003', 4);
  -- A seeded booking today (or the next open day) without a caddie.
  select b.id into v_b from public.bookings b
   where b.notes = 'demo_seed'
     and not exists (select 1 from public.caddy_assignments a where a.booking_id = b.id and a.status in ('confirmed','completed'))
   order by b.play_date, b.tee_time limit 1;
  -- A caddie free at that time.
  select c.id into v_c from public.caddies c, public.bookings b
   where b.id = v_b and c.course_id = v_course
     and not exists (select 1 from public.caddy_assignments a
                     where a.caddy_id = c.id and a.status in ('held','confirmed','completed')
                       and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.tee_starts_at, b.tee_starts_at + interval '5 hours'))
   order by c.caddy_code limit 1;
  update public.caddies set profile_id = '00000000-0000-4000-b000-000000000002' where id = v_c;
  insert into t6 values ('booking', v_b::text), ('caddy', v_c::text),
    ('total_before', (select total_paise::text from public.bookings where id = v_b)),
    ('play_date', (select play_date::text from public.bookings where id = v_b));
end $$;

-- Club office assigns the caddie to seat 1; a second caddie on the same seat is refused.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-000000000001', true);
do $$
declare v_b uuid := (select v::uuid from t6 where k = 'booking'); v_c uuid := (select v::uuid from t6 where k = 'caddy'); v_a uuid; v_rate int;
begin
  v_a := public.admin_assign_caddy(v_b, v_c, 1::smallint);
  select rate_paise into v_rate from public.caddy_assignments where id = v_a;
  assert (select total_paise from public.bookings where id = v_b) = (select v::int from t6 where k = 'total_before') + v_rate, 'total includes counter caddie fee';
  begin
    perform public.admin_assign_caddy(v_b, v_c, 1::smallint);
    raise exception 'expected seat_has_caddy';
  exception when others then assert sqlerrm = 'seat_has_caddy', sqlerrm; end;
  -- Remove and re-add restores the total.
  perform public.admin_remove_caddy(v_a);
  assert (select total_paise from public.bookings where id = v_b) = (select v::int from t6 where k = 'total_before'), 'remove restores total';
  v_a := public.admin_assign_caddy(v_b, v_c, 1::smallint);
  insert into t6 values ('assignment', v_a::text);
end $$;
reset role;

-- A golfer cannot assign caddies.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-000000000003', true);
do $$
begin
  perform public.admin_assign_caddy((select v::uuid from t6 where k = 'booking'), (select v::uuid from t6 where k = 'caddy'), 2::smallint);
  raise exception 'expected booking_not_found';
exception when others then assert sqlerrm = 'booking_not_found', sqlerrm;
end $$;
reset role;

-- Check-in on the day pays the caddie once (only testable when the booking is today).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-000000000002', true);
do $$
declare v_a uuid := (select v::uuid from t6 where k = 'assignment');
        v_today boolean := (select v::date from t6 where k = 'play_date') = (now() at time zone 'Asia/Kolkata')::date;
        v_bal bigint;
begin
  begin
    perform public.caddy_set_upi('not a upi');
    raise exception 'expected invalid_upi_id';
  exception when others then assert sqlerrm = 'invalid_upi_id', sqlerrm; end;
  perform public.caddy_set_upi('Caddie.Five@okaxis');

  if v_today then
    perform public.caddy_check_in(v_a);
    perform public.caddy_check_in(v_a);  -- second tap is harmless
    assert (select count(*) from public.caddy_ledger where caddy_assignment_id = v_a) = 1, 'one earning per assignment';
    select balance_paise into v_bal from public.caddy_balances where caddy_id = (select v::uuid from t6 where k = 'caddy');
    assert v_bal > 0, 'balance credited';
    insert into public.caddy_payout_requests (caddy_id, amount_paise, upi_id)
    values ((select v::uuid from t6 where k = 'caddy'), v_bal, 'ignored@x');
    begin
      insert into public.caddy_payout_requests (caddy_id, amount_paise, upi_id)
      values ((select v::uuid from t6 where k = 'caddy'), 100, 'ignored@x');
      raise exception 'expected one open payout';
    exception when unique_violation then null; end;
    insert into t6 values ('balance', v_bal::text);
  end if;
end $$;
reset role;

-- Office approves and marks paid; the ledger records the debit.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-b000-000000000001', true);
do $$
declare v_p uuid; v_c uuid := (select v::uuid from t6 where k = 'caddy');
begin
  select id into v_p from public.caddy_payout_requests where caddy_id = v_c and status = 'requested';
  if v_p is not null then
    assert (select upi_id from public.caddy_payout_requests where id = v_p) = 'caddie.five@okaxis', 'UPI comes from the caddie record';
    update public.caddy_payout_requests set status = 'approved' where id = v_p;
    update public.caddy_payout_requests set status = 'paid', utr = 'UTR123' where id = v_p;
    assert (select balance_paise from public.caddy_balances where caddy_id = v_c) = 0, 'paid out to zero';
    assert exists (select 1 from public.caddy_ledger where payout_request_id = v_p and entry_type = 'payout'), 'debit posted';
  end if;
end $$;
reset role;

rollback;
