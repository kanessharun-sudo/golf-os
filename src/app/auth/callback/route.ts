import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/redirects";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

/**
 * Lands Google OAuth (?code=) and email magic links (?token_hash=&type=).
 * The session cookie is written by the server client before redirecting.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await getSupabaseServerClient();

  const fail = (reason: "oauth_failed" | "link_invalid") => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("next", nextPath);
    target.searchParams.set("error", reason);
    return NextResponse.redirect(target);
  };

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? fail("oauth_failed") : NextResponse.redirect(new URL(nextPath, url.origin));
  }

  if (tokenHash && type && (EMAIL_OTP_TYPES as readonly string[]).includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    return error ? fail("link_invalid") : NextResponse.redirect(new URL(nextPath, url.origin));
  }

  return fail("link_invalid");
}
