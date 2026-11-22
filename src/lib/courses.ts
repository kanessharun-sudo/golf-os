import "server-only";

import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Course, CourseHole, CourseTee, Tables, Uuid } from "@/types/database";

export type CourseShowcase = {
  course: Course;
  tees: CourseTee[];
  holes: CourseHole[];
  /** yards[teeId][holeNumber] */
  yards: Record<Uuid, Record<number, number>>;
  rateTiers: Tables<"caddy_rate_tiers">[];
};

/** Published course by slug with its scorecard; null when missing or unpublished (RLS). */
export const getCourseShowcase = cache(async (slug: string): Promise<CourseShowcase | null> => {
  const supabase = await getSupabaseServerClient();
  const { data: course, error } = await supabase.from("courses").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Course lookup failed: ${error.message}`);
  if (!course) return null;

  const [tees, holes, yardages, rateTiers] = await Promise.all([
    supabase.from("course_tees").select("*").eq("course_id", course.id).eq("is_active", true).order("sort_order"),
    supabase.from("course_holes").select("*").eq("course_id", course.id).order("hole_number"),
    supabase.from("hole_yardages").select("hole_id, tee_id, yards").eq("course_id", course.id),
    supabase.from("caddy_rate_tiers").select("*").eq("course_id", course.id).order("grade"),
  ]);
  for (const result of [tees, holes, yardages, rateTiers]) {
    if (result.error) throw new Error(`Course data lookup failed: ${result.error.message}`);
  }

  const holeNumberById = new Map((holes.data ?? []).map((h) => [h.id, h.hole_number]));
  const yards: CourseShowcase["yards"] = {};
  for (const row of yardages.data ?? []) {
    const holeNumber = holeNumberById.get(row.hole_id);
    if (holeNumber === undefined) continue;
    (yards[row.tee_id] ??= {})[holeNumber] = row.yards;
  }

  return {
    course,
    tees: tees.data ?? [],
    holes: holes.data ?? [],
    yards,
    rateTiers: rateTiers.data ?? [],
  };
});
