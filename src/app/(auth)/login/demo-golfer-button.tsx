"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { signInAsDemoGolferAction, type DemoSignInState } from "@/lib/auth/demo-actions";

const INITIAL_STATE: DemoSignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="brass" size="lg" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Setting up your demo account…" : "Try as demo golfer"}
    </Button>
  );
}

export function DemoGolferButton({ nextPath }: { nextPath: string }) {
  const [state, formAction] = useActionState(signInAsDemoGolferAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="next" value={nextPath} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <SubmitButton />
      <p className="text-center text-xs text-ink-muted">
        No sign-up needed. You get a private demo account, and payments are simulated.
      </p>
    </form>
  );
}
