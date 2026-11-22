"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelPayoutAction, requestPayoutAction, setUpiAction } from "@/lib/caddy-actions";
import { formatPaise } from "@/lib/utils";

const btn = "inline-flex h-11 items-center gap-2 bg-brass px-5 text-sm font-medium text-pine-900 hover:bg-brass-400 disabled:opacity-50";

export function UpiForm({ current }: { current: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!current);
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <p className="text-sm text-alabaster/80">
        Paid to <span className="numerals text-alabaster">{current}</span>{" "}
        <button type="button" onClick={() => setEditing(true)} className="ml-2 text-brass underline-offset-4 hover:underline">
          Change
        </button>
      </p>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await setUpiAction(value);
          if (r.ok) {
            setEditing(false);
            router.refresh();
          } else setError(r.error);
        });
      }}
    >
      <label className="block text-xs text-alabaster/60" htmlFor="upi">
        Your UPI ID
      </label>
      <div className="flex gap-2">
        <input
          id="upi"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="name@okaxis"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 border border-pine-600 bg-pine-700 px-3 text-alabaster placeholder:text-alabaster/40"
        />
        <button type="submit" disabled={pending} className={btn}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </button>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}

export function RequestPayout({ balance, disabledReason }: { balance: number; disabledReason: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending || disabledReason !== null}
        className={btn}
        onClick={() =>
          start(async () => {
            const r = await requestPayoutAction();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Request {formatPaise(balance)}
      </button>
      {disabledReason ? <p className="mt-2 text-xs text-alabaster/60">{disabledReason}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}

export function CancelPayout({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-alabaster/70 underline-offset-4 hover:underline disabled:opacity-50"
      onClick={() =>
        start(async () => {
          const r = await cancelPayoutAction(payoutId);
          if (r.ok) router.refresh();
        })
      }
    >
      {pending ? "Cancelling…" : "Cancel request"}
    </button>
  );
}
