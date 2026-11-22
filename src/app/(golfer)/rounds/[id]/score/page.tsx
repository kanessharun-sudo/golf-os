import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { holesForRound, type ScoreHole } from "@/lib/scoring/model";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { Scorecard, type ScorecardPlayer, type ScorecardRound } from "./scorecard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scorecard", robots: { index: false } };

export default async function ScorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const session = await getSessionContext();
  if (!session) redirect(`/login?next=/rounds/${id}/score`);

  const supabase = await getSupabaseServerClient();
  const { data: round, error } = await supabase
    .from("rounds")
    .select(
      "id, status, mode, hole_format, start_hole, course_id, booking_id, tournament_name, bookings(play_date, tee_time, tee_id, booking_ref), courses(name, slug)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Round lookup failed: ${error.message}`);
  if (!round) notFound();

  const [players, holes, scores] = await Promise.all([
    supabase
      .from("round_players")
      .select(
        "id, profile_id, tee_id, display_name, handicap_index_at_start, course_handicap, holes_played, gross_score, adjusted_gross_score, net_score, score_differential, is_complete, counts_for_handicap, booking_players(seat_number)",
      )
      .eq("round_id", id),
    supabase.from("course_holes").select("id, hole_number, par, stroke_index").eq("course_id", round.course_id),
    supabase
      .from("hole_scores")
      .select("round_player_id, hole_number, strokes, putts, penalties, adjusted_strokes, strokes_received")
      .eq("round_id", id),
  ]);
  const failed = players.error ?? holes.error ?? scores.error;
  if (failed) throw new Error(`Scorecard lookup failed: ${failed.message}`);

  const teeId = players.data?.[0]?.tee_id ?? round.bookings.tee_id;
  const [{ data: yardages }, { data: tee }] = await Promise.all([
    teeId
      ? supabase.from("hole_yardages").select("hole_id, yards").eq("tee_id", teeId)
      : Promise.resolve({ data: [] as { hole_id: string; yards: number }[] }),
    teeId
      ? supabase.from("course_tees").select("name, color_hex").eq("id", teeId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const yardsByHole = new Map((yardages ?? []).map((y) => [y.hole_id, y.yards]));
  const allHoles: ScoreHole[] = (holes.data ?? []).map((h) => ({
    number: h.hole_number,
    par: h.par,
    strokeIndex: h.stroke_index,
    yards: yardsByHole.get(h.id) ?? null,
  }));

  const orderedPlayers: ScorecardPlayer[] = (players.data ?? [])
    .slice()
    .sort((a, b) => (a.booking_players?.seat_number ?? 0) - (b.booking_players?.seat_number ?? 0))
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      isMe: p.profile_id === session.profile.id,
      isGuest: p.profile_id === null,
      courseHandicap: p.course_handicap,
      indexAtStart: p.handicap_index_at_start,
      grossScore: p.gross_score,
      adjustedGross: p.adjusted_gross_score,
      netScore: p.net_score,
      differential: p.score_differential,
      countsForHandicap: p.counts_for_handicap,
    }));

  const nineHole = round.hole_format !== "full_18";
  const roundView: ScorecardRound = {
    id: round.id,
    status: round.status,
    mode: round.mode,
    holeFormat: round.hole_format,
    courseId: round.course_id,
    courseName: round.courses.name,
    courseSlug: round.courses.slug,
    bookingId: round.booking_id,
    playDate: round.bookings.play_date,
    teeTime: round.bookings.tee_time,
    teeName: tee?.name ?? null,
    tournamentName: round.tournament_name,
    holes: holesForRound(allHoles, round.hole_format, round.start_hole),
  };

  const myHandicap = {
    track: nineHole ? ("9-hole" as const) : ("18-hole" as const),
    index: nineHole ? session.profile.handicap_9 : session.profile.handicap_18,
    roundsCounted: nineHole ? session.profile.rounds_counted_9 : session.profile.rounds_counted_18,
  };

  return (
    <Scorecard
      round={roundView}
      players={orderedPlayers}
      initialScores={scores.data ?? []}
      myHandicap={myHandicap}
    />
  );
}
