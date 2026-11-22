"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { saveCourseSettingsAction, type AdminActionState } from "@/lib/admin/actions";
import { Field, SubmitButton } from "../_ui/form-bits";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INTERVALS = [6, 7, 8, 9, 10, 12, 15];

export type SettingsValues = {
  courseId: string;
  guestFee: number;
  memberFee: number;
  convenience: number;
  commission: number;
  firstTee: string;
  last18: string;
  last9: string;
  interval: number;
  windowDays: number;
  closed: number[];
};

export function SettingsForm({ values }: { values: SettingsValues }) {
  const [state, action] = useActionState<AdminActionState, FormData>(saveCourseSettingsAction, { ok: true, message: null });
  return (
    <form action={action} className="mt-6 space-y-8">
      <input type="hidden" name="courseId" value={values.courseId} />

      <fieldset className="border border-alabaster-300 bg-card p-5">
        <legend className="px-1 font-display text-2xl text-pine">Prices</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Guest green fee (₹)" name="guestFee" inputMode="decimal" defaultValue={values.guestFee} required />
          <Field label="Member green fee (₹)" name="memberFee" inputMode="decimal" defaultValue={values.memberFee} hint="0 means members play free" required />
          <Field label="Convenience fee (%)" name="convenience" inputMode="decimal" defaultValue={values.convenience} hint="Charged on online payments" required />
          <Field label="Club's cut of caddie fees (%)" name="commission" inputMode="decimal" defaultValue={values.commission} hint="The rest goes to the caddie" required />
        </div>
      </fieldset>

      <fieldset className="border border-alabaster-300 bg-card p-5">
        <legend className="px-1 font-display text-2xl text-pine">Tee times</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="First tee" name="firstTee" type="time" defaultValue={values.firstTee} required />
          <Field label="Last 18-hole tee" name="last18" type="time" defaultValue={values.last18} required />
          <Field label="Last 9-hole tee" name="last9" type="time" defaultValue={values.last9} required />
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-muted">Minutes between groups</span>
            <select name="interval" defaultValue={values.interval} className="h-11 w-full border border-alabaster-300 bg-card px-3 text-sm outline-none focus:border-pine">
              {INTERVALS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <Field label="Open for booking (days ahead)" name="windowDays" type="number" min={1} max={60} defaultValue={values.windowDays} required />
        </div>
        <div className="mt-5">
          <p className="text-xs text-ink-muted">Closed on</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DAYS.map((day, i) => (
              <label key={day} className="flex cursor-pointer items-center gap-2 border border-alabaster-300 px-3 py-2 text-sm has-[:checked]:border-pine has-[:checked]:bg-pine has-[:checked]:text-alabaster">
                <input type="checkbox" name="closed" value={i + 1} defaultChecked={values.closed.includes(i + 1)} className="sr-only" />
                {day}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {state.message ? <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice> : null}
      <SubmitButton>Save settings</SubmitButton>
    </form>
  );
}
