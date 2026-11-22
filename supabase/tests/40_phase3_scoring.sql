-- Behavioural checks for Phase 3 live scoring. Run after shim + 001..006.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-4000-a000-000000000001', 'player@example.com', now(), '{"full_name":"Priya Player"}', '{}'),
  ('00000000-0000-4000-a000-000000000002', 'golfer-ab12cd34@demo.golf-os.example', now(),
   '{"full_name":"Demo Golfer","is_demo":true}', '{"is_demo":true}'),
  ('00000000-0000-4000-a000-000000000003', 'stranger@example.com', now(), '{"full_name":"Stranger"}', '{}'),
  -- Sets is_demo only in user_metadata, which users can edit themselves: must not count.
  ('00000000-0000-4000-a000-000000000004', 'faker@example.com', now(), '{"full_name":"Faker","is_demo":true}', '{}');

create temp table t4 as
select (current_date + (((3 - extract(isodow from current_date)::int) + 7) % 7) + 7)::date as play_date,
       c.id as course_id,
       (select id from public.course_tees where course_id = c.id and name = 'White') as tee_id
from public.courses c where c.slug = 'asc-centre-bengaluru';
create temp table t4_state (k text primary key, v text);
grant select on t4 to authenticated;
grant select, insert, update on t4_state to authenticated;

-- Bookings made by the table owner (checkout is covered by tests/20).
do $$
declare ctx t4; b1 uuid; b2 uuid; b3 uuid; b4 uuid;
begin
  select * into ctx from t4;
  insert into public.bookings (course_id, booked_by, play_date, tee_time, hole_format, player_count, mode,
                               total_paise, tee_id, paid_at, start_hole, tee_starts_at)
  values (ctx.course_id, '00000000-0000-4000-a000-000000000001', ctx.play_date, '07:00', 'full_18', 2, 'tournament',
          0, ctx.tee_id, now(), 1, now())
  returning id into b1;
  insert into public.booking_players (booking_id, seat_number, full_name, profile_id, is_booker) values
    (b1, 1, 'Priya Player', '00000000-0000-4000-a000-000000000001', true),
    (b1, 2, 'Guest Partner', null, false);

  insert into public.bookings (course_id, booked_by, play_date, tee_time, hole_format, player_count, mode,
                               total_paise, tee_id, paid_at, start_hole, tee_starts_at)
  values (ctx.course_id, '00000000-0000-4000-a000-000000000002', ctx.play_date, '07:15', 'full_18', 1, 'tournament',
          0, ctx.tee_id, now(), 1, now())
  returning id into b2;
  insert into public.booking_players (booking_id, seat_number, full_name, profile_id, is_booker) values
    (b2, 1, 'Demo Golfer', '00000000-0000-4000-a000-000000000002', true);

  insert into public.bookings (course_id, booked_by, play_date, tee_time, hole_format, player_count,
                               total_paise, tee_id, paid_at, start_hole, tee_starts_at)
  values (ctx.course_id, '00000000-0000-4000-a000-000000000001', ctx.play_date, '08:00', 'front_9', 1,
          0, ctx.tee_id, now(), 1, now())
  returning id into b3;
  insert into public.booking_players (booking_id, seat_number, full_name, profile_id, is_booker) values
    (b3, 1, 'Priya Player', '00000000-0000-4000-a000-000000000001', true);

  insert into public.bookings (course_id, booked_by, play_date, tee_time, hole_format, player_count,
                               total_paise, tee_id, paid_at, start_hole, tee_starts_at)
  values (ctx.course_id, '00000000-0000-4000-a000-000000000004', ctx.play_date, '08:15', 'front_9', 1,
          0, ctx.tee_id, now(), 1, now())
  returning id into b4;
  insert into public.booking_players (booking_id, seat_number, full_name, profile_id, is_booker) values
    (b4, 1, 'Faker', '00000000-0000-4000-a000-000000000004', true);

  insert into t4_state values ('b1', b1), ('b2', b2), ('b3', b3), ('b4', b4);
end $$;

-- 1. Start window -----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000003', true);
do $$ begin
  perform public.start_round((select v::uuid from t4_state where k = 'b1'));
  raise exception 'expected booking_not_found';
exception when others then assert sqlerrm = 'booking_not_found', sqlerrm; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
do $$ begin
  perform public.start_round((select v::uuid from t4_state where k = 'b1'));
  raise exception 'expected round_not_open_yet';
exception when others then assert sqlerrm = 'round_not_open_yet', sqlerrm; end $$;

do $$ begin
  insert into public.rounds (booking_id, course_id, hole_format, start_hole)
  values ((select v::uuid from t4_state where k = 'b1'), gen_random_uuid(), 'full_18', 1);
  raise exception 'expected insufficient_privilege';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000004', true);
do $$ begin
  perform public.start_round((select v::uuid from t4_state where k = 'b4'));
  raise exception 'user_metadata must not unlock demo mode';
exception when others then assert sqlerrm = 'round_not_open_yet', sqlerrm; end $$;
reset role;

-- Move b1 to 30 minutes from now and b3 to two days ago (bypassing the
-- derive-from-tee-time trigger, which is what the window reads).
set session_replication_role = replica;
update public.bookings set tee_starts_at = now() + interval '30 minutes'
 where id = (select v::uuid from t4_state where k = 'b1');
update public.bookings set play_date = current_date - 2, tee_starts_at = now() - interval '2 days'
 where id = (select v::uuid from t4_state where k = 'b3');
set session_replication_role = origin;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
do $$
declare v_round uuid; v_again uuid;
begin
  begin
    perform public.start_round((select v::uuid from t4_state where k = 'b3'));
    raise exception 'expected round_window_closed';
  exception when others then assert sqlerrm = 'round_window_closed', sqlerrm; end;

  v_round := public.start_round((select v::uuid from t4_state where k = 'b1'));
  v_again := public.start_round((select v::uuid from t4_state where k = 'b1'));
  assert v_round = v_again, 'start_round is idempotent';
  assert (select status from public.rounds where id = v_round) = 'in_progress', 'round in progress';
  assert (select mode = 'tournament' and tournament_name is not null from public.rounds where id = v_round), 'tournament round';
  assert (select count(*) from public.round_players where round_id = v_round) = 2, 'both players on the card';
  insert into t4_state values ('r1', v_round);
end $$;

-- 2. Scoring and submit -------------------------------------------------------------
do $$
declare v_round uuid := (select v::uuid from t4_state where k = 'r1'); rp record; h record;
begin
  -- Holes 1..17 for both players, bogey golf; the guest takes a 12 on hole 1.
  for rp in select id, profile_id from public.round_players where round_id = v_round loop
    for h in select hole_number, par from public.course_holes
             where course_id = (select course_id from t4) and hole_number < 18 loop
      insert into public.hole_scores (round_player_id, round_id, hole_number, strokes)
      values (rp.id, v_round, h.hole_number,
              case when rp.profile_id is null and h.hole_number = 1 then 12 else h.par + 1 end);
    end loop;
  end loop;

  -- No index yet: cap at par + 5.
  assert (select adjusted_strokes = par + 5 from public.hole_scores hs
          join public.round_players pl on pl.id = hs.round_player_id
          where pl.round_id = v_round and pl.profile_id is null and hs.hole_number = 1), 'guest 12 capped at par + 5';

  begin
    perform public.submit_round(v_round);
    raise exception 'expected scores_incomplete';
  exception when others then assert sqlerrm = 'scores_incomplete', sqlerrm; end;

  begin
    update public.rounds set status = 'completed' where id = v_round;
    raise exception 'expected insufficient_privilege';
  exception when insufficient_privilege then null; end;

  for rp in select id from public.round_players where round_id = v_round loop
    insert into public.hole_scores (round_player_id, round_id, hole_number, strokes)
    select rp.id, v_round, 18, par + 1 from public.course_holes where course_id = (select course_id from t4) and hole_number = 18;
  end loop;

  assert public.submit_round(v_round) = 'completed', 'submit completes';
end $$;
reset role;

do $$
declare v_round uuid := (select v::uuid from t4_state where k = 'r1');
begin
  assert (select status from public.bookings where id = (select v::uuid from t4_state where k = 'b1')) = 'completed',
    'booking completed';
  assert (select rounds_counted_18 = 1 and avg_score_18 = 90 from public.profiles
          where id = '00000000-0000-4000-a000-000000000001'), 'handicap stats updated (72 + 18 = 90)';
  assert (select counts_for_handicap from public.round_players where round_id = v_round and profile_id is null) = false,
    'guest never counts';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000001', true);
do $$
declare v_round uuid := (select v::uuid from t4_state where k = 'r1');
begin
  begin
    update public.hole_scores set strokes = 3 where round_id = v_round and hole_number = 1;
    raise exception 'expected round_not_editable';
  exception when others then assert sqlerrm = 'round_not_editable', sqlerrm; end;
  begin
    perform public.submit_round(v_round, true);
    raise exception 'expected round_already_final';
  exception when others then assert sqlerrm = 'round_already_final', sqlerrm; end;
end $$;

-- 3. Demo account, leaderboard, abandon ---------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000002', true);
do $$
declare v_round uuid; rp uuid; n int; top record;
begin
  -- Demo accounts may start a future round.
  v_round := public.start_round((select v::uuid from t4_state where k = 'b2'));
  select id into rp from public.round_players where round_id = v_round;
  insert into public.hole_scores (round_player_id, round_id, hole_number, strokes)
  select rp, v_round, hole_number, par - 1 from public.course_holes
  where course_id = (select course_id from t4) and hole_number <= 3;

  select count(*) into n from public.get_tournament_leaderboard((select course_id from t4), (select play_date from t4));
  assert n = 3, format('leaderboard rows %s', n);
  select * into top from public.get_tournament_leaderboard((select course_id from t4), (select play_date from t4)) limit 1;
  assert top.display_name = 'Demo Golfer' and top.gross_to_par = -3 and top.holes_played = 3 and top.rank_position = 1,
    format('leader %s', row_to_json(top));

  assert public.submit_round(v_round, true) = 'abandoned', 'abandon';
  select count(*) into n from public.get_tournament_leaderboard((select course_id from t4), (select play_date from t4));
  assert n = 2, 'abandoned rounds leave the leaderboard';
  assert (select rounds_counted_18 from public.profiles where id = '00000000-0000-4000-a000-000000000002') = 0,
    'abandoned round never counts';
end $$;
reset role;

-- 4. Privileges -------------------------------------------------------------------
set local role anon;
do $$ begin
  begin
    perform public.start_round(gen_random_uuid());
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_tournament_leaderboard(gen_random_uuid(), current_date);
    raise exception 'expected permission denied';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  perform public.is_demo_account(gen_random_uuid());
  raise exception 'expected permission denied';
exception when insufficient_privilege then null; end $$;
reset role;

-- WHS table at 5 rounds: lowest 1, no adjustment.
do $$ begin
  assert public.handicap_index_from_differentials(array[20.0, 18.4, 22.0, 25.0, 19.0]) = 18.4, '5 rounds: lowest 1';
end $$;

select 'ALL PHASE 3 CHECKS PASSED' as result;
rollback;
