"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { isDemoPayments } from "@/lib/env";
import { safeNextPath } from "@/lib/redirects";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type DemoSignInState = { error: string | null };

const DEMO_EMAIL_DOMAIN = "demo.golf-os.example";

/**
 * Signs the visitor into a fresh, throwaway golfer account so the demo works
 * without an email or SMS round-trip. Each visitor gets their own account, so
 * holds and bookings never collide between people trying the demo at once.
 * Only available while payments run in demo mode.
 */
export async function signInAsDemoGolferAction(
  _previous: DemoSignInState,
  formData: FormData,
): Promise<DemoSignInState> {
  if (!isDemoPayments()) {
    return { error: "Demo sign-in is not available on this site." };
  }

  const nextPath = safeNextPath(formData.get("next")?.toString());
  const tag = randomBytes(4).toString("hex");
  const email = `golfer-${tag}@${DEMO_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");

  const admin = getSupabaseAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Demo Golfer", username: `demo_${tag}`, is_demo: true },
  });
  if (createError) {
    console.error("demo sign-in: createUser failed", createError.message);
    return { error: "The demo account could not be created. Please try again in a moment." };
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
