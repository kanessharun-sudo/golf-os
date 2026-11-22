import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, HandicapTrack } from "@/types/database";

type Client = SupabaseClient<Database>;

export type ProfileRound = {
  id: string;
  date: string;
  course: string;
  format: string;
  tournament: string | null;
  gross: number | null;
  net: number | null;
  differential: number | null;
  counted: boolean;
};

export async function loadRounds(supabase: Client, profileId: string, limit = 20): Promise<ProfileRound[]> {
  const { data, error } = await supabase
    .from("round_players")
    .select(
      "id, gross_score, net_score, score_differential, counts_for_handicap, rounds!round_players_round_id_fkey!inner(completed_at, hole_format, tournament_name, status, courses!rounds_course_id_fkey(name))",
    )
    .eq("profile_id", profileId)
    .eq("is_complete", true)
    .eq("rounds.status", "completed")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Rounds lookup failed: ${error.message}`);
  return data.map((r) => ({
    id: r.id,
    date: r.rounds.completed_at ?? "",
    course: r.rounds.courses?.name ?? "",
    format: r.rounds.hole_format,
    tournament: r.rounds.tournament_name,
    gross: r.gross_score,
    net: r.net_score,
    differential: r.score_differential,
    counted: r.counts_for_handicap,
  }));
}

export async function loadHandicapHistory(supabase: Client, profileId: string) {
  const { data, error } = await supabase
    .from("handicap_snapshots")
    .select("track, handicap_index, created_at")
    .eq("profile_id", profileId)
    .not("handicap_index", "is", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Handicap history lookup failed: ${error.message}`);
  const byTrack: Record<HandicapTrack, { at: string; index: number }[]> = { eighteen_hole: [], nine_hole: [] };
  for (const s of data) if (s.handicap_index !== null) byTrack[s.track].push({ at: s.created_at, index: s.handicap_index });
  return byTrack;
}

export type GalleryItem = { id: string; url: string; caption: string | null; category: string; isPublic: boolean };

export async function loadGallery(supabase: Client, profileId: string, onlyPublic: boolean): Promise<GalleryItem[]> {
  let query = supabase
    .from("gallery_photos")
    .select("id, storage_path, caption, category, is_public")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(48);
  if (onlyPublic) query = query.eq("is_public", true);
  const { data, error } = await query;
  if (error) throw new Error(`Gallery lookup failed: ${error.message}`);
  if (data.length === 0) return [];
  const { data: signed } = await supabase.storage.from("golfer-gallery").createSignedUrls(
    data.map((p) => p.storage_path),
    3600,
  );
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return data
    .map((p) => ({ id: p.id, url: urlOf.get(p.storage_path) ?? "", caption: p.caption, category: p.category, isPublic: p.is_public }))
    .filter((p) => p.url);
}
