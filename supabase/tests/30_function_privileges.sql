-- Golf OS — function privilege checks (migration 004).
-- Fails if anon can reach any write RPC, or if a role loses a function it needs.
begin;

do $$
declare
  v_leak text;
begin
  -- anon must only reach read RPCs and policy helpers.
  select string_agg(p.oid::regprocedure::text, ', ') into v_leak
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('get_tee_sheet', 'get_available_caddies', 'get_course_caddies',
                          'is_super_admin', 'is_course_admin', 'is_course_visible',
                          'is_booking_participant', 'is_round_participant',
                          'is_public_round_player', 'current_caddy_id', 'try_uuid')
    and p.proname not like 'gbt%' and p.proname not like 'gbtreekey%';
  if v_leak is not null then
    raise exception 'anon can execute: %', v_leak;
  end if;

  if has_function_privilege('anon', 'public.cancel_booking(uuid, text)', 'execute') then
    raise exception 'anon can cancel bookings';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_booking(uuid, text)', 'execute') then
    raise exception 'authenticated lost cancel_booking';
  end if;
  if has_function_privilege('authenticated', 'public.confirm_hold_payment(text, text, integer)', 'execute') then
    raise exception 'authenticated can confirm payments';
  end if;
  if not has_function_privilege('authenticated', 'public.acquire_slot_hold(uuid, date, time, public.hole_format, smallint, boolean)', 'execute') then
    raise exception 'authenticated lost acquire_slot_hold';
  end if;
  if not has_function_privilege('anon', 'public.get_tee_sheet(uuid, date)', 'execute') then
    raise exception 'anon lost get_tee_sheet';
  end if;
end $$;

-- Anonymous calls are refused at the privilege layer.
set local role anon;
do $$
begin
  begin
    perform public.cancel_booking(gen_random_uuid(), 'x');
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
end $$;
-- RLS-backed reads still work for anon (policies call helper functions).
select count(*) from public.course_holes;
select count(*) from public.get_tee_sheet((select id from public.courses where slug = 'asc-centre-bengaluru'),
                                          (now() at time zone 'Asia/Kolkata')::date + 2);
reset role;

-- Signed-in golfer still passes CHECK constraints and RLS paths.
set local role authenticated;
select count(*) from public.courses;
reset role;

select 'ALL PRIVILEGE CHECKS PASSED' as result;
rollback;
