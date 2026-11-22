"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { signInAsDemoAction, type DemoRole, type DemoSignInState } from "@/lib/auth/demo-actions";

const INITIAL_STATE: DemoSignInState = { error: null };

function SubmitButton({ label, variant }: { label: string; variant: "brass" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={variant === "brass" ? "lg" : "md"} className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : variant === "brass" ? <Sparkles /> : null}
      {pending ? "Setting up your demo account…" : label}
    </Button>
  );
}

function DemoForm({ role, label, nextPath, variant }: { role: DemoRole; label: string; nextPath: string; variant: "brass" | "outline" }) {
  const [state, formAction] = useActionState(signInAsDemoAction, INITIAL_STATE);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="next" value={nextPath} />
      <input type="hidden" name="role" value={role} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <SubmitButton label={label} variant={variant} />
    </form>
  );
}

export function DemoGolferButton({ nextPath }: { nextPath: string }) {
  return (
    <div className="space-y-3">
      <DemoForm role="golfer" label="Try as demo golfer" nextPath={nextPath} variant="brass" />
      <div className="grid gap-2 sm:grid-cols-2">
        <DemoForm role="admin" label="Club office demo" nextPath="/admin" variant="outline" />
        <DemoForm role="caddy" label="Caddie demo" nextPath="/caddy" variant="outline" />
      </div>
      <p className="text-center text-xs text-ink-muted">
        No sign-up needed. You get a private demo account, and payments are simulated. The demo golfer is a club member, so
        members play free; add a guest to see the ₹1,000 guest fee.
      </p>
    </div>
  );
}
