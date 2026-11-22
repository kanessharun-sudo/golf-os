-- =============================================================================
-- Golf OS — 006_live_scoring.sql (Phase 3)
-- Rounds are started and submitted only through RPCs, so the app cannot skip
-- the start window or complete a half-entered card.
--   * start_round:    participant only; from 60 min before tee time to the end
--                     of the tee date (course time zone). Demo accounts
--                     (app_metadata.is_demo, settable only by the service role)
--                     may start at any time. Idempotent.
--   * submit_round:   completes the round when every player has every hole
--                     (fires finalize_round: differentials, handicaps, caddy
--                     pay), or abandons it (never counts for handicaps).
--   * get_tournament_leaderboard: every tournament-mode player at a course on
--                     one date, ranked by net to par.
-- Hole scores stay directly writable by participants under RLS; the existing
-- triggers apply the Net Double Bogey cap and refuse edits after submit.
-- =============================================================================

-- Demo flag lives in app_metadata: users can edit user_metadata themselves.
create or replace function public.is_demo_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (u.raw_app_meta_data ->> 'is_demo')::boolean
                   from auth.users u where u.id = p_user_id), false);
$$;

create or replace function public.round_start_window(p_booking_id uuid)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.tee_starts_at - interval '60 minutes',
         ((b.play_date + 1)::timestamp at time zone c.timezone)
  from public.bookings b join public.courses c on c.id = b.course_id
  where b.id = p_booking_id;
$$;

create or replace function public.start_round(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_round   uuid;
  v_window  record;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found or not (public.is_booking_participant(p_booking_id) or public.is_course_admin(v_booking.course_id)) then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  select id into v_round from public.rounds where booking_id = p_booking_id;
  if v_round is not null then
    return v_round;
  end if;

  if v_booking.status not in ('confirmed', 'checked_in') then
    raise exception 'booking_not_playable' using errcode = 'P0001';
  end if;

  if not public.is_demo_account(v_uid) and not public.is_course_admin(v_booking.course_id) then
    select * into v_window from public.round_start_window(p_booking_id);
    if now() < v_window.opens_at then
      raise exception 'round_not_open_yet' using errcode = 'P0001';
    end if;
    if now() >= v_window.closes_at then
      raise exception 'round_window_closed' using errcode = 'P0001';
    end if;
  end if;

  insert into public.rounds (booking_id, course_id, hole_format, start_hole, status, created_by, tournament_name)
  values (p_booking_id, v_booking.course_id, v_booking.hole_format, v_booking.start_hole, 'in_progress', v_uid,
          case when v_booking.mode = 'tournament' then 'Daily Medal' end)
  returning id into v_round;
  return v_round;
end;
$$;

create or replace function public.submit_round(p_round_id uuid, p_abandon boolean default false)
returns public.round_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round   public.rounds%rowtype;
  v_missing integer;
begin
  if auth.uid() is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_round from public.rounds where id = p_round_id for update;
  if not found or not (public.is_round_participant(p_round_id) or public.is_course_admin(v_round.course_id)) then
    raise exception 'round_not_found' using errcode = 'P0001';
  end if;
  if v_round.status in ('completed', 'abandoned') then
    raise exception 'round_already_final' using errcode = 'P0001';
  end if;

  if p_abandon then
    update public.rounds set status = 'abandoned' where id = p_round_id;
    return 'abandoned';
  end if;

  select count(*) into v_missing from public.round_players
  where round_id = p_round_id and not is_complete;
  if v_missing > 0 then
    raise exception 'scores_incomplete' using errcode = 'P0001', detail = v_missing::text;
  end if;

  update public.rounds set status = 'completed' where id = p_round_id;
  return 'completed';
end;
$$;

create or replace function public.get_tournament_leaderboard(p_course_id uuid, p_play_date date)
returns table (
  round_player_id uuid,
  round_id        uuid,
  display_name    text,
  tee_time        time,
  round_status    public.round_status,
  holes_played    smallint,
  gross_score     smallint,
  net_score       smallint,
  gross_to_par    integer,
  net_to_par      integer,
  is_complete     boolean,
  rank_position   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with players as (
    select rp.id, rp.round_id, rp.display_name, b.tee_time, r.status, rp.holes_played,
           rp.gross_score, rp.net_score, rp.is_complete,
           coalesce(sum(hs.strokes - hs.par), 0)::integer as gross_to_par,
           coalesce(sum(hs.strokes - hs.par - hs.strokes_received), 0)::integer as net_to_par
    from public.rounds r
    join public.bookings b on b.id = r.booking_id
    join public.round_players rp on rp.round_id = r.id
    left join public.hole_scores hs on hs.round_player_id = rp.id
    where r.course_id = p_course_id
      and b.play_date = p_play_date
      and r.mode = 'tournament'
      and r.status <> 'abandoned'
    group by rp.id, rp.round_id, rp.display_name, b.tee_time, r.status, rp.holes_played,
             rp.gross_score, rp.net_score, rp.is_complete
  )
  select id, round_id, display_name, tee_time, status, holes_played, gross_score, net_score,
         gross_to_par, net_to_par, is_complete,
         case when holes_played = 0 then null
              else rank() over (order by (holes_played = 0), net_to_par, gross_to_par) end
  from players
  order by (holes_played = 0), net_to_par, gross_to_par, display_name;
$$;

-- Rounds change only through the RPCs above (and triggers). Hole scores stay
-- writable by participants under RLS.
revoke insert, update, delete on public.rounds from anon, authenticated;

revoke execute on function public.is_demo_account(uuid)                    from public, anon, authenticated;
revoke execute on function public.round_start_window(uuid)                 from public, anon, authenticated;
revoke execute on function public.start_round(uuid)                        from public, anon;
revoke execute on function public.submit_round(uuid, boolean)              from public, anon;
revoke execute on function public.get_tournament_leaderboard(uuid, date)   from public, anon;
grant execute on function public.start_round(uuid)                         to authenticated;
grant execute on function public.submit_round(uuid, boolean)               to authenticated;
grant execute on function public.get_tournament_leaderboard(uuid, date)    to authenticated;

-- Demo accounts created before this migration carried the flag only in
-- user_metadata; the demo email domain is reserved for them.
update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_demo": true}'::jsonb
 where email like '%@demo.golf-os.example';
