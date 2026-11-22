"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { startRoundAction } from "@/lib/scoring/actions";

export function StartRound({ bookingId }: { bookingId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        variant="brass"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // On success the action redirects to the scorecard.
            const result = await startRoundAction(bookingId);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Flag />}
        Start round
      </Button>
    </div>
  );
}
