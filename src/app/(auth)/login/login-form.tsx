"use client";

import { Loader2, Mail, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { normalisePhone } from "@/lib/phone";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Method = "email" | "phone";
type Stage = "request" | "verify";

const RESEND_SECONDS = 60;
const OTP_PATTERN = /^\d{6}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function callbackUrl(nextPath: string): string {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

export function LoginForm({ nextPath, initialError }: { nextPath: string; initialError: string | null }) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();

  const [method, setMethod] = useState<Method>("email");
  const [stage, setStage] = useState<Stage>("request");
  const [identifier, setIdentifier] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"google" | "send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function switchMethod(next: Method) {
    setMethod(next);
    setStage("request");
    setIdentifier("");
    setCode("");
    setError(null);
  }

  async function signInWithGoogle() {
    setError(null);
    setPending("google");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl(nextPath) },
    });
    if (oauthError) {
      setError("Google sign-in is unavailable right now. Use email or phone instead.");
      setPending(null);
    }
  }

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setError(null);

    let target: string;
    if (method === "email") {
      target = identifier.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(target)) {
        setError("Enter a valid email address.");
        return;
      }
    } else {
      const phone = normalisePhone(identifier);
      if (!phone) {
        setError("Enter a 10-digit mobile number, or include the country code.");
        return;
      }
      target = phone;
    }

    setPending("send");
    const { error: sendError } =
      method === "email"
        ? await supabase.auth.signInWithOtp({
            email: target,
            options: { shouldCreateUser: true, emailRedirectTo: callbackUrl(nextPath) },
          })
        : await supabase.auth.signInWithOtp({ phone: target, options: { shouldCreateUser: true } });
    setPending(null);

    if (sendError) {
      setError(
        sendError.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : method === "phone"
            ? "We could not send an SMS to that number. Check it, or sign in with email."
            : "We could not send the email. Check the address and try again.",
      );
      return;
    }
    setSentTo(target);
    setStage("verify");
    setCode("");
    setCooldown(RESEND_SECONDS);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const token = code.trim();
    if (!OTP_PATTERN.test(token)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setPending("verify");
    const { error: verifyError } =
      method === "email"
        ? await supabase.auth.verifyOtp({ email: sentTo, token, type: "email" })
        : await supabase.auth.verifyOtp({ phone: sentTo, token, type: "sms" });

    if (verifyError) {
      setPending(null);
      setError("That code is wrong or has expired. Check it, or send a new one.");
      return;
    }
    router.replace(nextPath);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button variant="outline" size="lg" className="w-full" onClick={signInWithGoogle} disabled={pending !== null}>
        {pending === "google" ? <Loader2 className="animate-spin" /> : <GoogleMark />}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-eyebrow uppercase text-ink-faint">
        <span className="h-px flex-1 bg-alabaster-300" />
        or use a one-time code
        <span className="h-px flex-1 bg-alabaster-300" />
      </div>

      <div role="tablist" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-card bg-alabaster-200 p-1">
        {(["email", "phone"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={method === m}
            onClick={() => switchMethod(m)}
            className={cn(
              "flex h-9 items-center justify-center gap-2 rounded-[0.25rem] text-sm transition-colors",
              method === m ? "bg-card text-pine shadow-hairline" : "text-ink-muted hover:text-pine",
            )}
          >
            {m === "email" ? <Mail className="size-4" /> : <Smartphone className="size-4" />}
            {m === "email" ? "Email" : "Mobile"}
          </button>
        ))}
      </div>

      {stage === "request" ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="identifier">{method === "email" ? "Email address" : "Mobile number"}</Label>
            <Input
              id="identifier"
              type={method === "email" ? "email" : "tel"}
              inputMode={method === "email" ? "email" : "tel"}
              autoComplete={method === "email" ? "email" : "tel"}
              placeholder={method === "email" ? "you@example.com" : "98765 43210"}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending !== null || identifier.trim() === ""}>
            {pending === "send" ? <Loader2 className="animate-spin" /> : null}
            Send code
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4" noValidate>
          <p className="text-sm text-ink-muted">
            {method === "email" ? (
              <>
                We emailed a 6-digit code and a sign-in link to <span className="text-pine">{sentTo}</span>. Use
                whichever arrives first.
              </>
            ) : (
              <>
                We sent a 6-digit code by SMS to <span className="numerals text-pine">{sentTo}</span>.
              </>
            )}
          </p>
          <div className="space-y-2">
            <Label htmlFor="otp">6-digit code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="numerals text-center text-lg tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={pending !== null || code.length !== 6}>
            {pending === "verify" ? <Loader2 className="animate-spin" /> : null}
            Verify and continue
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-ink-muted hover:text-pine" onClick={() => setStage("request")}>
              Use a different {method === "email" ? "email" : "number"}
            </button>
            <button
              type="button"
              className="numerals text-pine disabled:text-ink-faint"
              disabled={cooldown > 0 || pending !== null}
              onClick={() => void sendCode()}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
