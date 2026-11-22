"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { caddyCheckInAction } from "@/lib/caddy-actions";

export function CheckInButton({ assignmentId }: { assignmentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await caddyCheckInAction(assignmentId);
            if (!result.ok) setError(result.error);
          })
        }
        className="flex h-11 items-center gap-2 bg-brass px-5 text-sm font-medium text-pine-900 transition-colors hover:bg-brass-400 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Check in group
      </button>
      {error ? <p className="text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
