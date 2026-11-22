import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole, Caddy, Profile, Uuid } from "@/types/database";

export type SessionContext = {
  profile: Profile;
  /** Course ids this user administers (empty unless course_admin / super_admin). */
  adminCourseIds: Uuid[];
  caddy: Pick<Caddy, "id" | "course_id" | "caddy_code" | "full_name"> | null;
};

/** One round-trip set per request, memoised across layouts and pages. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profileResult, adminResult, caddyResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("course_admins").select("course_id").eq("profile_id", user.id),
    supabase.from("caddies").select("id, course_id, caddy_code, full_name").eq("profile_id", user.id).maybeSingle(),
  ]);

  if (profileResult.error) {
    throw new Error(`Profile lookup failed: ${profileResult.error.message}`);
  }

  return {
    profile: profileResult.data,
    adminCourseIds: (adminResult.data ?? []).map((row) => row.course_id),
    caddy: caddyResult.data ?? null,
  };
});

/** Redirects anonymous users to login and users without a permitted role home. */
export async function requireRole(allowed: readonly AppRole[], nextPath: string): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  const isSuperAdmin = session.profile.role === "super_admin";
  if (!isSuperAdmin && !allowed.includes(session.profile.role)) {
    redirect("/");
  }
  return session;
}
