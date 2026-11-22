"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActionError, type ActionResult } from "@/lib/booking/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { LeaderboardRow, RoundStatus, Uuid } from "@/types/database";

const uuid = z.string().uuid();

export type RoundSnapshot = {
  status: RoundStatus;
  scores: {
    round_player_id: Uuid;
    hole_number: number;
    strokes: number;
    putts: number | null;
    penalties: number;
    adjusted_strokes: number;
    strokes_received: number;
  }[];
  players: {
    id: Uuid;
    holes_played: number;
    gross_score: number | null;
    adjusted_gross_score: number | null;
    net_score: number | null;
    is_complete: boolean;
  }[];
};

const unauthenticated = { ok: false as const, error: "Please sign in to continue.", code: "auth_required" };
const invalidInput = { ok: false as const, error: "Something in that request was not valid. Please try again." };

async function loadSnapshot(roundId: Uuid): Promise<ActionResult<RoundSnapshot>> {
  const supabase = await getSupabaseServerClient();
  const [round, scores, players] = await Promise.all([
    supabase.from("rounds").select("status").eq("id", roundId).maybeSingle(),
    supabase
      .from("hole_scores")
      .select("round_player_id, hole_number, strokes, putts, penalties, adjusted_strokes, strokes_received")
      .eq("round_id", roundId),
    supabase
      .from("round_players")
      .select("id, holes_played, gross_score, adjusted_gross_score, net_score, is_complete")
      .eq("round_id", roundId),
  ]);
  const failed = round.error ?? scores.error ?? players.error;
  if (failed) return toActionError(failed);
  if (!round.data) return { ok: false, error: "We could not find that round.", code: "round_not_found" };
  return { ok: true, data: { status: round.data.status, scores: scores.data ?? [], players: players.data ?? [] } };
}

/** Starts (or reopens) the round for a booking and goes to its scorecard. */
export async function startRoundAction(bookingId: string): Promise<ActionResult<never>> {
  if (!uuid.safeParse(bookingId).success) return invalidInput;
  const supabase = await getSupabaseServerClient();
  const { data: roundId, error } = await supabase.rpc("start_round", { p_booking_id: bookingId });
  if (error || !roundId) return toActionError(error);
  redirect(`/rounds/${roundId}/score`);
}

export async function loadRoundAction(roundId: string): Promise<ActionResult<RoundSnapshot>> {
  if (!uuid.safeParse(roundId).success) return invalidInput;
  return loadSnapshot(roundId);
}

const entrySchema = z.object({
  roundPlayerId: uuid,
  holeNumber: z.number().int().min(1).max(18),
  strokes: z.number().int().min(1).max(20),
  putts: z.number().int().min(0).max(10).nullable(),
  penalties: z.number().int().min(0).max(10),
});
export type HoleScoreInput = z.infer<typeof entrySchema>;

/** Saves one or more hole scores (the offline queue flushes in batches) and returns the fresh card. */
export async function saveHoleScoresAction(roundId: string, entries: HoleScoreInput[]): Promise<ActionResult<RoundSnapshot>> {
  const parsed = z.array(entrySchema).min(1).max(72).safeParse(entries);
  if (!uuid.safeParse(roundId).success || !parsed.success) return invalidInput;

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthenticated;

  const { error } = await supabase.from("hole_scores").upsert(
    parsed.data.map((e) => ({
      round_id: roundId,
      round_player_id: e.roundPlayerId,
      hole_number: e.holeNumber,
      strokes: e.strokes,
      putts: e.putts,
      penalties: e.penalties,
    })),
    { onConflict: "round_player_id,hole_number" },
  );
  if (error) return toActionError(error);
  return loadSnapshot(roundId);
}

export async function submitRoundAction(roundId: string, abandon: boolean): Promise<ActionResult<RoundStatus>> {
  if (!uuid.safeParse(roundId).success) return invalidInput;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("submit_round", { p_round_id: roundId, p_abandon: abandon });
  if (error || !data) return toActionError(error);
  revalidatePath(`/rounds/${roundId}/score`);
  revalidatePath("/bookings");
  return { ok: true, data };
}

export async function loadLeaderboardAction(courseId: string, playDate: string): Promise<ActionResult<LeaderboardRow[]>> {
  if (!uuid.safeParse(courseId).success || !/^\d{4}-\d{2}-\d{2}$/.test(playDate)) return invalidInput;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_tournament_leaderboard", { p_course_id: courseId, p_play_date: playDate });
  if (error) return toActionError(error);
  return { ok: true, data: data ?? [] };
}
