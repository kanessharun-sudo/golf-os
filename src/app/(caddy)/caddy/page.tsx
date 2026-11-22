import type { Metadata } from "next";
import { CheckChip, HeroTitle, PhotoHero, SectionTitle } from "@/components/app/photo-hero";
import { getSessionContext } from "@/lib/auth/session";
import { addDays, courseToday, formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { CaddyScheduleRow } from "@/types/database";
import { CheckInButton } from "./check-in-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My groups · Caddie" };

const TZ = "Asia/Kolkata";

export default async function CaddyHomePage() {
  const session = await getSessionContext();
  if (!session?.caddy) {
    return <p className="mx-auto max-w-5xl px-5 py-12 text-ink-muted">This account is not linked to a caddie yet. Ask the club office to link it.</p>;
  }
  const supabase = await getSupabaseServerClient();
  const today = courseToday(TZ);
  const { data, error } = await supabase.rpc("get_caddy_schedule", { p_from: addDays(today, -60), p_to: addDays(today, 30) });
  if (error) throw new Error(`Schedule lookup failed: ${error.message}`);

  const live = data.filter((r) => r.booking_status !== "cancelled" && r.booking_status !== "refunded");
  const todays = live.filter((r) => r.play_date === today);
  const upcoming = live.filter((r) => r.play_date > today);
  const past = live.filter((r) => r.play_date < today).reverse();
  const next = todays.find((r) => !r.checked_in_at) ?? upcoming[0] ?? null;

  return (
    <>
      <PhotoHero
        image="/landing/img/caddie-walk-poster.jpg"
        aside={
          <div className="bg-alabaster-50 p-5 text-ink shadow-card">
            <p className="text-sm font-semibold text-pine">Next group</p>
            {next ? (
              <>
                <p className="numerals mt-2 font-mono text-3xl font-medium tracking-tight text-ink">{formatTeeTime(next.tee_time)}</p>
                <p className="text-sm text-ink-muted">
                  {next.play_date === today ? "Today" : formatPlayDate(next.play_date, "short")} · {HOLE_FORMAT_LABEL[next.hole_format]}
                </p>
                <p className="mt-2 text-sm">
                  Carrying for <span className="font-semibold">{next.player_name ?? "the group"}</span>
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Nothing booked yet.</p>
            )}
          </div>
        }
      >
        <p className="text-sm text-alabaster/80">{formatPlayDate(today)}</p>
        <div className="mt-2">
          <HeroTitle>Hello, {session.caddy.full_name.split(" ")[0]}</HeroTitle>
        </div>
        <dl className="numerals mt-6 flex gap-8">
          {[
            { label: "Today", value: todays.length },
            { label: "Upcoming", value: upcoming.length },
            { label: "Past 60 days", value: past.length },
          ].map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-alabaster/70">{s.label}</dt>
              <dd className="font-sans text-4xl font-bold">{s.value}</dd>
            </div>
          ))}
        </dl>
      </PhotoHero>

      <div className="mx-auto max-w-5xl space-y-12 px-5 py-10">
        <section>
          <SectionTitle>Today</SectionTitle>
          {todays.length === 0 ? (
            <Empty>No groups today.</Empty>
          ) : (
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {todays.map((r) => (
                <GroupCard key={r.assignment_id} row={r} action={r.checked_in_at ? null : <CheckInButton assignmentId={r.assignment_id} />} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>Upcoming</SectionTitle>
          {upcoming.length === 0 ? (
            <Empty>Nothing booked yet.</Empty>
          ) : (
            <ScheduleTable rows={upcoming} />
          )}
        </section>

        <section>
          <SectionTitle>Past</SectionTitle>
          {past.length === 0 ? <Empty>No past groups in the last 60 days.</Empty> : <ScheduleTable rows={past} past />}
        </section>
      </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 border border-alabaster-400 bg-card px-5 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

function GroupCard({ row, action }: { row: CaddyScheduleRow; action: React.ReactNode }) {
  return (
    <li className="border border-alabaster-300 bg-card p-5 shadow-hairline">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="numerals font-mono text-4xl font-medium tracking-tight text-ink">{formatTeeTime(row.tee_time)}</p>
          <p className="numerals text-sm text-ink-muted">
            {HOLE_FORMAT_LABEL[row.hole_format]}
            {row.start_hole === 10 ? " · starts on 10" : ""} · {row.booking_ref}
          </p>
        </div>
        {action}
      </div>
      <p className="mt-4 text-sm">
        Carrying for <span className="font-semibold">{row.player_name ?? "the group"}</span>
      </p>
      {row.group_names?.length ? <p className="text-xs text-ink-muted">Group: {row.group_names.join(", ")}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <CheckChip label="Golfers" at={row.golfer_checked_in_at} />
        <CheckChip label="You" at={row.checked_in_at} />
      </div>
    </li>
  );
}

function ScheduleTable({ rows, past = false }: { rows: CaddyScheduleRow[]; past?: boolean }) {
  return (
    <div className="mt-4 overflow-x-auto border border-alabaster-300 bg-card">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-alabaster-300 text-xs text-ink-muted">
          <tr>
            <th className="px-4 py-3 font-normal">Date</th>
            <th className="px-4 py-3 font-normal">Tee</th>
            <th className="px-4 py-3 font-normal">Player</th>
            <th className="px-4 py-3 font-normal">Holes</th>
            {past ? <th className="px-4 py-3 font-normal">Check-in</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assignment_id} className="border-b border-alabaster-200 last:border-0">
              <td className="numerals px-4 py-3">{formatPlayDate(r.play_date, "short")}</td>
              <td className="numerals px-4 py-3 font-semibold">{formatTeeTime(r.tee_time)}</td>
              <td className="px-4 py-3">
                {r.player_name ?? "Group"}
                {r.group_names && r.group_names.length > 1 ? <span className="block text-xs text-ink-faint">{r.group_names.length} players</span> : null}
              </td>
              <td className="px-4 py-3 text-ink-muted">{HOLE_FORMAT_LABEL[r.hole_format]}</td>
              {past ? (
                <td className={cn("px-4 py-3 text-xs", r.checked_in_at ? "text-pine-700" : "text-ink-faint")}>
                  {r.checked_in_at ? "You checked in" : "No check-in"}
                  {r.golfer_checked_in_at ? " · golfers in" : ""}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
