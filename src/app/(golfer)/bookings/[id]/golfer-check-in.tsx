"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { golferCheckInAction } from "@/lib/checkin-actions";

export function GolferCheckIn({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await golferCheckInAction(bookingId);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
        className="inline-flex h-12 items-center gap-2 bg-brass px-6 text-sm font-semibold text-pine-900 hover:bg-brass-400 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Check in at the club
      </button>
      {error ? <p className="mt-2 text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
