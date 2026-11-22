import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth/session";
import { addDays, courseToday, formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { CaddyScheduleRow } from "@/types/database";
import { CheckInButton } from "./check-in-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My groups · Caddie" };

const TZ = "Asia/Kolkata";

export default async function CaddyHomePage() {
  const session = await getSessionContext();
  const supabase = await getSupabaseServerClient();
  const today = courseToday(TZ);
  const { data, error } = await supabase.rpc("get_caddy_schedule", { p_from: addDays(today, -30), p_to: addDays(today, 14) });
  if (error) throw new Error(`Schedule lookup failed: ${error.message}`);

  const live = data.filter((r) => r.booking_status !== "cancelled" && r.booking_status !== "refunded");
  const todays = live.filter((r) => r.play_date === today);
  const upcoming = live.filter((r) => r.play_date > today);
  const past = live.filter((r) => r.play_date < today);
  const earned30 = past.reduce((n, r) => n + r.rate_paise, 0) + todays.filter((r) => r.checked_in_at).reduce((n, r) => n + r.rate_paise, 0);
  const booked = [...todays, ...upcoming].reduce((n, r) => n + r.rate_paise, 0);

  if (!session?.caddy) {
    return <p className="text-alabaster/80">This account is not linked to a caddie yet. Ask the club office to link it.</p>;
  }

  return (
    <div className="space-y-10">
      <section>
        <p className="text-sm text-alabaster/60">{formatPlayDate(today)}</p>
        <h1 className="mt-1 font-display text-4xl font-medium">Hello, {session.caddy.full_name.split(" ")[0]}</h1>
        <dl className="mt-6 grid grid-cols-3 border-l border-t border-pine-600">
          {[
            { label: "Today", value: String(todays.length) },
            { label: "Coming up", value: String(upcoming.length) },
            { label: "Earned, 30 days", value: formatPaise(earned30) },
          ].map((s) => (
            <div key={s.label} className="border-b border-r border-pine-600 p-4">
              <dt className="text-xs text-alabaster/60">{s.label}</dt>
              <dd className="numerals mt-1 font-display text-2xl sm:text-3xl">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-alabaster/50">{formatPaise(booked)} booked across today and the next two weeks.</p>
      </section>

      <section>
        <h2 className="font-display text-2xl">Today</h2>
        {todays.length === 0 ? (
          <p className="mt-3 text-alabaster/70">No groups today.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {todays.map((r) => (
              <Group key={r.assignment_id} row={r} action={r.checked_in_at ? null : <CheckInButton assignmentId={r.assignment_id} />} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-alabaster/70">Nothing booked yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcoming.map((r) => (
              <Group key={r.assignment_id} row={r} showDate />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Group({ row, showDate = false, action = null }: { row: CaddyScheduleRow; showDate?: boolean; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-4 border border-pine-600 bg-pine-700/40 p-4">
      <div>
        <p className="numerals text-sm text-alabaster/60">
          {showDate ? `${formatPlayDate(row.play_date, "short")} · ` : ""}
          {HOLE_FORMAT_LABEL[row.hole_format]}
          {row.start_hole === 10 ? " · starts on 10" : ""} · {row.booking_ref}
        </p>
        <p className="numerals mt-1 font-display text-3xl">{formatTeeTime(row.tee_time)}</p>
        <p className="mt-1 text-sm">
          Carrying for <span className="text-brass">{row.player_name ?? "the group"}</span>
        </p>
        {row.group_names?.length ? <p className="text-xs text-alabaster/60">Group: {row.group_names.join(", ")}</p> : null}
      </div>
      <div className="text-right">
        <p className="numerals text-sm text-alabaster/80">{formatPaise(row.rate_paise)}</p>
        {row.checked_in_at ? (
          <p className="mt-2 text-sm text-brass">
            Checked in{" "}
            {new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: TZ }).format(new Date(row.checked_in_at))}
          </p>
        ) : (
          action
        )}
      </div>
    </li>
  );
}
