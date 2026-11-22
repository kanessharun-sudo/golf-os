import type { HoleFormat } from "@/types/database";

export type ScoreHole = {
  number: number;
  par: number;
  strokeIndex: number;
  yards: number | null;
};

export type HoleEntry = { strokes: number; putts: number | null; penalties: number };

/** Holes in playing order: an 18 starting on 10 runs 10..18 then 1..9. */
export function holesForRound(all: ScoreHole[], format: HoleFormat, startHole: number): ScoreHole[] {
  const inSpan = all
    .filter((h) => format === "full_18" || (format === "front_9" ? h.number <= 9 : h.number >= 10))
    .sort((a, b) => a.number - b.number);
  if (format !== "full_18" || startHole === 1) return inSpan;
  return [...inSpan.filter((h) => h.number >= startHole), ...inSpan.filter((h) => h.number < startHole)];
}

/** Mirrors public.hole_difficulty_rank: rank by stroke index within the holes played (1 = hardest). */
export function difficultyRank(holes: ScoreHole[], hole: ScoreHole): number {
  return holes.filter((h) => h.strokeIndex < hole.strokeIndex).length + 1;
}

/** Mirrors public.strokes_received (WHS allocation, plus handicaps give strokes back on the easiest holes). */
export function strokesReceived(courseHandicap: number | null, rank: number, holeCount: number): number {
  if (courseHandicap === null) return 0;
  if (courseHandicap >= 0) {
    return Math.floor(courseHandicap / holeCount) + (rank <= courseHandicap % holeCount ? 1 : 0);
  }
  const plus = -courseHandicap;
  return -(Math.floor(plus / holeCount) + (rank > holeCount - (plus % holeCount) ? 1 : 0));
}

/** Mirrors the Net Double Bogey cap in hole_scores_before_write. */
export function cappedStrokes(strokes: number, par: number, received: number, courseHandicap: number | null): number {
  return Math.min(strokes, courseHandicap === null ? par + 5 : par + 2 + received);
}

export function toParLabel(value: number): string {
  if (value === 0) return "E";
  return value > 0 ? `+${value}` : `${value}`;
}

export const MIN_STROKES = 1;
export const MAX_STROKES = 20;
