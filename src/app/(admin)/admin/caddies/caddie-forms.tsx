"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { decidePayoutAction, saveCaddyAction, type AdminActionState } from "@/lib/admin/actions";
import { Field, SubmitButton } from "../_ui/form-bits";

export type CaddyFormValues = {
  caddyId: string | null;
  fullName: string;
  caddyCode: string;
  phone: string;
  grade: string;
  rate18: number;
  rate9: number;
  isActive: boolean;
};

export function CaddyForm({ courseId, values }: { courseId: string; values: CaddyFormValues }) {
  const [state, action] = useActionState<AdminActionState, FormData>(saveCaddyAction, { ok: true, message: null });
  return (
    <form action={action} className="mt-6 border border-alabaster-300 bg-card p-5">
      <h2 className="font-display text-2xl text-pine">{values.caddyId ? `Edit ${values.fullName}` : "Add a caddie"}</h2>
      <input type="hidden" name="courseId" value={courseId} />
      {values.caddyId ? <input type="hidden" name="caddyId" value={values.caddyId} /> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Full name" name="fullName" defaultValue={values.fullName} required maxLength={80} />
        <Field label="Caddie code" name="caddyCode" defaultValue={values.caddyCode} required maxLength={12} hint="Printed on the bib, e.g. ASC-021" />
        <Field label="Mobile" name="phone" inputMode="tel" defaultValue={values.phone} />
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-muted">Grade</span>
          <select name="grade" defaultValue={values.grade} className="h-11 w-full border border-alabaster-300 bg-card px-3 text-sm outline-none focus:border-pine">
            <option value="grade_a">Grade A</option>
            <option value="grade_b">Grade B</option>
            <option value="grade_c">Grade C</option>
          </select>
        </label>
        <Field label="Rate, 18 holes (₹)" name="rate18" inputMode="decimal" defaultValue={values.rate18} required />
        <Field label="Rate, 9 holes (₹)" name="rate9" inputMode="decimal" defaultValue={values.rate9} required />
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={values.isActive} className="size-4 accent-pine" />
          Working at the club
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SubmitButton>{values.caddyId ? "Save caddie" : "Add caddie"}</SubmitButton>
        <a href="/admin/caddies" className="text-sm text-ink-muted hover:text-pine">
          Close
        </a>
      </div>
      {state.message ? (
        <Notice tone={state.ok ? "success" : "error"} className="mt-4">
          {state.message}
        </Notice>
      ) : null}
    </form>
  );
}

export function PayoutActions({ payoutId, status }: { payoutId: string; status: "requested" | "approved" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "reject" | "paid">("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(decision: "approve" | "reject" | "paid") {
    start(async () => {
      const r = await decidePayoutAction({ payoutId, decision, reason: decision === "reject" ? text : undefined, utr: decision === "paid" ? text : undefined });
      if (r.ok) {
        setMode("idle");
        setText("");
        router.refresh();
      } else setError(r.message);
    });
  }

  if (mode !== "idle") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "reject" ? "Reason for the caddie" : "UPI reference (UTR), optional"}
          className="h-9 w-56 border border-alabaster-300 bg-card px-2 text-sm"
          maxLength={mode === "reject" ? 300 : 40}
        />
        <Button size="sm" variant={mode === "reject" ? "destructive" : "primary"} disabled={pending} onClick={() => run(mode)}>
          {mode === "reject" ? "Reject" : "Mark paid"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
          Back
        </Button>
        {error ? <span className="w-full text-right text-xs text-destructive">{error}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {status === "requested" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("approve")}>
          Approve
        </Button>
      ) : null}
      <Button size="sm" disabled={pending} onClick={() => setMode("paid")}>
        Mark paid
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setMode("reject")}>
        Reject
      </Button>
      {error ? <span className="w-full text-right text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
