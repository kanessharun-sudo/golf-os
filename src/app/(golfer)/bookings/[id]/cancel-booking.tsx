"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { cancelBookingAction } from "@/lib/booking/actions";
import { formatPaise } from "@/lib/utils";
import type { Paise, Uuid } from "@/types/database";

export function CancelBooking({ bookingId, refundPaise }: { bookingId: Uuid; refundPaise: Paise }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setError(null);
    const result = await cancelBookingAction({ bookingId, reason });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  const refundLine =
    refundPaise > 0
      ? process.env.NEXT_PUBLIC_PAYMENTS_MODE === "demo"
        ? `You will get ${formatPaise(refundPaise)} back (demo refund, settled instantly).`
        : `You will get ${formatPaise(refundPaise)} back in 5–7 working days.`
      : "You will not get a refund.";

  if (!confirming) {
    return (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="numerals text-sm text-pine">If you cancel now: {refundLine}</p>
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Cancel booking
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="space-y-1.5">
        <Label htmlFor="cancel-reason">Reason (optional)</Label>
        <Input id="cancel-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </div>
      <p className="numerals text-sm text-pine">{refundLine} The tee time and any caddies will be released.</p>
      <div className="flex gap-3">
        <Button variant="destructive" onClick={() => void cancel()} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Yes, cancel
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Keep booking
        </Button>
      </div>
    </div>
  );
}
