"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { assignCaddyAction, removeCaddyAction } from "@/lib/admin/actions";
import { cancelBookingAction } from "@/lib/booking/actions";
import { formatPaise } from "@/lib/utils";

type Msg = { ok: boolean; text: string } | null;

export function AssignCaddy({
  bookingId,
  seats,
  caddies,
}: {
  bookingId: string;
  seats: { seat: number; name: string }[];
  caddies: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [seat, setSeat] = useState(seats[0]?.seat ?? 1);
  const [caddyId, setCaddyId] = useState(caddies[0]?.id ?? "");
  const [msg, setMsg] = useState<Msg>(null);

  if (seats.length === 0) return <p className="text-sm text-ink-muted">Every player has a caddie.</p>;
  if (caddies.length === 0) return <p className="text-sm text-ink-muted">No caddie is free at this time.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select value={seat} onChange={(e) => setSeat(Number(e.target.value))} className="h-11 border border-alabaster-300 bg-card px-3 text-sm">
          {seats.map((s) => (
            <option key={s.seat} value={s.seat}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={caddyId} onChange={(e) => setCaddyId(e.target.value)} className="h-11 min-w-0 flex-1 border border-alabaster-300 bg-card px-3 text-sm">
          {caddies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await assignCaddyAction({ bookingId, caddyId, seat });
              setMsg({ ok: r.ok, text: r.message ?? "" });
              if (r.ok) router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Assign caddie
        </Button>
      </div>
      {msg ? <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice> : null}
    </div>
  );
}

export function RemoveCaddy({ bookingId, assignmentId }: { bookingId: string; assignmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        className="text-xs text-destructive underline-offset-4 hover:underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await removeCaddyAction({ bookingId, assignmentId });
            if (r.ok) router.refresh();
            else setError(r.message);
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

export function CancelBooking({ bookingId, refundPreview }: { bookingId: string; refundPreview: number | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)}>
        Cancel this booking
      </Button>
    );
  }
  return (
    <div className="space-y-3 border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-ink">
        The golfer&apos;s cancellation policy applies.
        {refundPreview !== null ? ` They get ${formatPaise(refundPreview)} back.` : ""} This cannot be undone.
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (shown to the golfer)"
        maxLength={300}
        className="h-11 w-full border border-alabaster-300 bg-card px-3 text-sm"
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelBookingAction({ bookingId, reason: reason || "Cancelled by the club office" });
              if (r.ok) {
                setMsg({ ok: true, text: `Cancelled. Refund: ${formatPaise(r.data.refundPaise)}.` });
                router.refresh();
              } else setMsg({ ok: false, text: r.error });
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Cancel booking
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
      {msg ? <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice> : null}
    </div>
  );
}
