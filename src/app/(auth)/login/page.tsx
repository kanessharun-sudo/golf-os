import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { isDemoPayments } from "@/lib/env";
import { safeNextPath } from "@/lib/redirects";
import { DemoGolferButton } from "./demo-golfer-button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const CALLBACK_ERRORS: Record<string, string> = {
  link_invalid: "That sign-in link has expired or was already used. Request a new code below.",
  oauth_failed: "Google sign-in did not complete. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const nextPath = safeNextPath(next);

  if (await getSessionContext()) {
    redirect(nextPath);
  }

  return (
    <div className="w-full max-w-md">
      <p className="text-eyebrow uppercase text-brass">Members&apos; entrance</p>
      <h1 className="mt-3 font-display text-display-sm text-pine">Sign in to book</h1>
      <p className="mt-3 text-sm text-ink-muted">
        New here? Signing in creates your Golf OS account, with your handicap and rounds in one place.
      </p>
      <div className="mt-8 rounded-card bg-alabaster-50 p-6 text-ink shadow-card sm:p-8">
        {isDemoPayments() ? (
          <div className="mb-6 space-y-6">
            <DemoGolferButton nextPath={nextPath} />
            <div className="flex items-center gap-3 text-eyebrow uppercase text-ink-faint">
              <span className="h-px flex-1 bg-alabaster-300" />
              or use your own account
              <span className="h-px flex-1 bg-alabaster-300" />
            </div>
          </div>
        ) : null}
        <LoginForm nextPath={nextPath} initialError={error ? (CALLBACK_ERRORS[error] ?? null) : null} />
      </div>
    </div>
  );
}
