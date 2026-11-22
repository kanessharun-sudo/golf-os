import "server-only";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Course } from "@/types/database";

export type AdminCourse = Pick<
  Course,
  "id" | "slug" | "name" | "timezone" | "currency" | "pricing" | "member_sheet_url" | "members_synced_at" | "members_sync_error"
>;

/** The course this admin runs (the first one; super admins get the first published course). */
export async function requireAdminCourse(nextPath: string): Promise<AdminCourse> {
  const session = await requireRole(["course_admin", "super_admin"], nextPath);
  const supabase = await getSupabaseServerClient();
  let query = supabase
    .from("courses")
    .select("id, slug, name, timezone, currency, pricing, member_sheet_url, members_synced_at, members_sync_error")
    .order("created_at")
    .limit(1);
  if (session.profile.role !== "super_admin") {
    if (session.adminCourseIds.length === 0) redirect("/");
    query = query.in("id", session.adminCourseIds);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Admin course lookup failed: ${error.message}`);
  if (!data) redirect("/");
  return data;
}
