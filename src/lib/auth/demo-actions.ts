"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { isDemoPayments } from "@/lib/env";
import { safeNextPath } from "@/lib/redirects";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole, Uuid } from "@/types/database";

export type DemoSignInState = { error: string | null };
export type DemoRole = "golfer" | "admin" | "caddy";

const DEMO_EMAIL_DOMAIN = "demo.golf-os.example";
const DEMO_COURSE_SLUG = "asc-centre-bengaluru";

const ROLE_SETUP: Record<DemoRole, { label: string; appRole: AppRole; home: string }> = {
  golfer: { label: "Demo Golfer", appRole: "golfer", home: "/courses" },
  admin: { label: "Demo Club Office", appRole: "course_admin", home: "/admin" },
  caddy: { label: "Demo Caddie", appRole: "caddy", home: "/caddy" },
};

/**
 * Signs the visitor into a fresh, throwaway account so the demo works without
 * an email or SMS round-trip. Each visitor gets their own account, so holds and
 * bookings never collide. Only available while payments run in demo mode.
 *
 * golfer: registered as a demo club member, so member pricing shows.
 * admin:  course admin of ASC, with a seeded demo tee sheet.
 * caddy:  linked to the seeded caddie with the most upcoming groups.
 */
export async function signInAsDemoAction(_previous: DemoSignInState, formData: FormData): Promise<DemoSignInState> {
  if (!isDemoPayments()) {
    return { error: "Demo sign-in is not available on this site." };
  }

  const roleInput = formData.get("role")?.toString();
  const role: DemoRole = roleInput === "admin" || roleInput === "caddy" ? roleInput : "golfer";
  const setup = ROLE_SETUP[role];
  const nextPath = role === "golfer" ? safeNextPath(formData.get("next")?.toString()) : setup.home;

  const tag = randomBytes(4).toString("hex");
  const email = `${role}-${tag}@${DEMO_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");

  const admin = getSupabaseAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: setup.label, username: `demo_${role.slice(0, 1)}${tag}` },
    // app_metadata is writable only with the service role, so users cannot flag themselves as demo.
    app_metadata: { is_demo: true },
  });
  if (createError || !created.user) {
    console.error("demo sign-in: createUser failed", createError?.message);
    return { error: "The demo account could not be created. Please try again in a moment." };
  }

  try {
    await prepareRole(role, created.user.id, email, tag);
  } catch (setupError) {
    console.error(`demo sign-in: ${role} setup failed`, setupError);
    return { error: "The demo account could not be set up. Please try again in a moment." };
  }

  const supabase = await getSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error("demo sign-in: signInWithPassword failed", signInError.message);
    return {
      error:
        signInError.status === 429
          ? "Lots of people are trying the demo right now. Please wait a minute and try again."
          : "The demo sign-in did not complete. Please try again.",
    };
  }

  redirect(nextPath);
}

/** Kept for the existing golfer button. */
export async function signInAsDemoGolferAction(previous: DemoSignInState, formData: FormData): Promise<DemoSignInState> {
  formData.set("role", "golfer");
  return signInAsDemoAction(previous, formData);
}

async function prepareRole(role: DemoRole, userId: Uuid, email: string, tag: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { data: course, error: courseError } = await admin.from("courses").select("id").eq("slug", DEMO_COURSE_SLUG).single();
  if (courseError) throw courseError;

  if (role === "golfer") {
    const { error } = await admin.from("club_members").insert({
      course_id: course.id,
      member_no: `DEMO-${tag.toUpperCase()}`,
      full_name: "Demo Golfer",
      email,
      source: "demo",
    });
    if (error) throw error;
    return;
  }

  // Both staff demos need a tee sheet with groups on it.
  const { error: seedError } = await admin.rpc("seed_demo_tee_sheet", { p_course_id: course.id, p_booker: userId, p_days: 7 });
  if (seedError) throw seedError;

  if (role === "admin") {
    const { error: roleError } = await admin.from("profiles").update({ role: "course_admin" }).eq("id", userId);
    if (roleError) throw roleError;
    const { error: linkError } = await admin.from("course_admins").insert({ course_id: course.id, profile_id: userId });
    if (linkError) throw linkError;
    return;
  }

  // Caddie: borrow the seeded caddie with the most upcoming groups. Only caddies with
  // no account, or one held by an earlier demo visitor, are borrowed.
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: caddies, error: caddyError }, { data: assignments }] = await Promise.all([
    admin.from("caddies").select("id, profile_id").eq("course_id", course.id).eq("is_active", true),
    admin.from("caddy_assignments").select("caddy_id, bookings!inner(play_date)").eq("status", "confirmed").gte("bookings.play_date", today),
  ]);
  if (caddyError) throw caddyError;

  const linkedProfiles = caddies.map((c) => c.profile_id).filter((id): id is Uuid => id !== null);
  const { data: linked } = linkedProfiles.length
    ? await admin.from("profiles").select("id, username").in("id", linkedProfiles)
    : { data: [] as { id: Uuid; username: string }[] };
  const demoHeld = new Set((linked ?? []).filter((p) => p.username.startsWith("demo_")).map((p) => p.id));
  const borrowable = caddies.filter((c) => c.profile_id === null || demoHeld.has(c.profile_id));
  if (borrowable.length === 0) throw new Error("no caddie free for the demo");

  const load = new Map<Uuid, number>();
  for (const a of assignments ?? []) load.set(a.caddy_id, (load.get(a.caddy_id) ?? 0) + 1);
  borrowable.sort((a, b) => (load.get(b.id) ?? 0) - (load.get(a.id) ?? 0));
  const chosen = borrowable[0];

  const { error: roleError } = await admin.from("profiles").update({ role: "caddy" }).eq("id", userId);
  if (roleError) throw roleError;
  const { error: linkError } = await admin.from("caddies").update({ profile_id: userId }).eq("id", chosen.id);
  if (linkError) throw linkError;
}
