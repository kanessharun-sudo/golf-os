import Link from "next/link";
import type { AdminBooking } from "@/lib/admin/data";
import { formatPlayDate } from "@/lib/dates";
import { cn, formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { IsoDate } from "@/types/database";

export function PageHead({ title, detail, children }: { title: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-alabaster-300 pb-5">
      <div>
        <h1 className="font-display text-4xl font-medium text-pine">{title}</h1>
        {detail ? <p className="mt-1 text-sm text-ink-muted">{detail}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Stats({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <dl className="mt-6 grid grid-cols-2 border-l border-t border-alabaster-300 bg-card sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="border-b border-r border-alabaster-300 p-4">
          <dt className="text-xs text-ink-muted">{item.label}</dt>
          <dd className="numerals mt-1 font-mono tracking-tight text-3xl text-pine">{item.value}</dd>
          {item.note ? <dd className="mt-0.5 text-xs text-ink-faint">{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "text-pine",
  checked_in: "text-brass-700",
  completed: "text-ink-muted",
  cancelled: "text-destructive",
  refunded: "text-destructive",
  no_show: "text-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked in",
  completed: "Played",
  cancelled: "Cancelled",
  refunded: "Refunded",
  no_show: "No show",
};

export function BookingTable({ bookings, showDate = false }: { bookings: AdminBooking[]; showDate?: boolean }) {
  if (bookings.length === 0) {
    return <p className="mt-6 border border-alabaster-400 p-10 text-center text-ink-muted">No bookings.</p>;
  }
  return (
    <div className="mt-6 overflow-x-auto border border-alabaster-300 bg-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-alabaster-300 text-xs text-ink-muted">
          <tr>
            {showDate ? <th className="px-4 py-3 font-normal">Date</th> : null}
            <th className="px-4 py-3 font-normal">Tee</th>
            <th className="px-4 py-3 font-normal">Players</th>
            <th className="px-4 py-3 font-normal">Caddie</th>
            <th className="px-4 py-3 text-right font-normal">Paid</th>
            <th className="px-4 py-3 font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-b border-alabaster-200 align-top last:border-0">
              {showDate ? <td className="numerals whitespace-nowrap px-4 py-3 text-ink-muted">{formatPlayDate(b.playDate, "short")}</td> : null}
              <td className="whitespace-nowrap px-4 py-3">
                <span className="numerals font-mono tracking-tight text-xl text-pine">{formatTeeTime(b.teeTime)}</span>
                <span className="block text-xs text-ink-faint">
                  {HOLE_FORMAT_LABEL[b.holeFormat]}
                  {b.startHole === 10 ? " · hole 10" : ""}
                  {b.isPrivate ? ` · ${b.players.length}-ball` : ""}
                </span>
                <Link href={`/admin/bookings/${b.id}`} className="numerals block text-xs text-pine underline-offset-4 hover:underline">
                  {b.ref}
                </Link>
              </td>
              <td className="px-4 py-3">
                <ul className="space-y-0.5">
                  {b.players.map((p) => (
                    <li key={p.seat} className="flex items-baseline gap-2">
                      <span className="text-ink">{p.name}</span>
                      <span className={cn("text-[0.7rem] uppercase tracking-wide", p.isMember ? "text-pine-600" : "text-brass-700")}>
                        {p.isMember ? "Member" : "Guest"}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="px-4 py-3 text-ink-muted">
                {b.caddies.length
                  ? b.caddies.map((c) => (
                      <span key={c.code} className="block">
                        {c.name} <span className="numerals text-xs text-ink-faint">{c.code}</span>
                        {c.checkedIn ? <span className="ml-1 text-xs text-brass-700">✓ in</span> : null}
                      </span>
                    ))
                  : "—"}
              </td>
              <td className="numerals whitespace-nowrap px-4 py-3 text-right">
                {b.paymentStatus === "waived" ? <span className="text-ink-muted">Free</span> : formatPaise(b.totalPaise)}
              </td>
              <td className={cn("whitespace-nowrap px-4 py-3", STATUS_STYLE[b.status])}>{STATUS_LABEL[b.status] ?? b.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DateStepper({ date, today, basePath }: { date: IsoDate; today: IsoDate; basePath: string }) {
  const shift = (d: IsoDate, n: number) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const link = "border border-alabaster-300 bg-card px-3 py-2 text-pine hover:border-pine/40";
  return (
    <div className="flex items-center gap-2 text-sm">
      <Link className={link} href={`${basePath}?date=${shift(date, -1)}`} aria-label="Previous day">
        ←
      </Link>
      <Link className={cn(link, date === today && "border-pine")} href={basePath}>
        Today
      </Link>
      <Link className={link} href={`${basePath}?date=${shift(date, 1)}`} aria-label="Next day">
        →
      </Link>
    </div>
  );
}
