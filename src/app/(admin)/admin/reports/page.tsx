import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminCourse } from "@/lib/admin/course";
import { loadBookings, summarise, ACTIVE_STATUSES } from "@/lib/admin/data";
import { addDays, courseToday, formatPlayDate } from "@/lib/dates";
import { cn, formatPaise } from "@/lib/utils";
import { PageHead, Stats } from "../_ui/parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports · Club office" };

const RANGES = { "7": 7, "30": 30, "90": 90 } as const;
type RangeKey = keyof typeof RANGES;

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const course = await requireAdminCourse("/admin/reports");
  const { days: daysParam } = await searchParams;
  const key: RangeKey = daysParam === "7" || daysParam === "90" ? daysParam : "30";
  const today = courseToday(course.timezone);
  const from = addDays(today, -(RANGES[key] - 1));

  const bookings = await loadBookings(course.id, from, today);
  const s = summarise(bookings);

  const byDay = new Map<string, { members: number; guests: number; revenue: number }>();
  for (let i = 0; i < RANGES[key]; i++) byDay.set(addDays(from, i), { members: 0, guests: 0, revenue: 0 });
  for (const b of bookings) {
    if (!ACTIVE_STATUSES.includes(b.status)) continue;
    const row = byDay.get(b.playDate);
    if (!row) continue;
    for (const p of b.players) {
      if (p.isMember) row.members++;
      else row.guests++;
    }
    row.revenue += b.totalPaise;
  }
  const days = [...byDay.entries()];
  const maxPlayers = Math.max(1, ...days.map(([, d]) => d.members + d.guests));

  return (
    <>
      <PageHead title="Reports" detail={`${formatPlayDate(from, "short")} to ${formatPlayDate(today, "short")}`}>
        <div className="flex items-center gap-4 text-sm">
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <Link
              key={k}
              href={`/admin/reports?days=${k}`}
              className={cn("border-b-2 pb-1", k === key ? "border-brass text-pine" : "border-transparent text-ink-muted hover:text-pine")}
            >
              {k} days
            </Link>
          ))}
          <a href={`/admin/reports/export?from=${from}&to=${today}`} className="border border-pine px-3 py-2 text-pine hover:bg-pine-50">
            Download CSV
          </a>
        </div>
      </PageHead>

      <Stats
        items={[
          { label: "Rounds booked", value: String(s.groups), note: `${s.cancelled} cancelled` },
          { label: "Member rounds", value: String(s.members) },
          { label: "Guest rounds", value: String(s.guests) },
          { label: "Guest green fees", value: formatPaise(s.greenPaise) },
          { label: "Caddie fees", value: formatPaise(s.caddyPaise) },
          { label: "Convenience fees", value: formatPaise(s.feePaise), note: `Refunds ${formatPaise(s.refundPaise)}` },
        ]}
      />

      <section className="mt-8 border border-alabaster-300 bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl text-pine">Players per day</h2>
          <p className="flex gap-4 text-xs text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 bg-pine" /> Members
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 bg-brass" /> Guests
            </span>
          </p>
        </div>
        <div className="mt-5 flex h-48 items-end gap-[2px]" role="img" aria-label="Members and guests per day">
          {days.map(([day, d]) => (
            <div key={day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${formatPlayDate(day, "short")}: ${d.members} members, ${d.guests} guests, ${formatPaise(d.revenue)}`}>
              <div className="bg-brass" style={{ height: `${(d.guests / maxPlayers) * 100}%` }} />
              <div className="bg-pine" style={{ height: `${(d.members / maxPlayers) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="numerals mt-2 flex justify-between text-xs text-ink-faint">
          <span>{formatPlayDate(from, "short")}</span>
          <span>{formatPlayDate(today, "short")}</span>
        </div>
      </section>

      <p className="mt-4 text-sm text-ink-muted">
        Total collected {formatPaise(s.totalPaise)}. Monthly member dues are handled by the club office and are not part of these figures.
      </p>
    </>
  );
}
