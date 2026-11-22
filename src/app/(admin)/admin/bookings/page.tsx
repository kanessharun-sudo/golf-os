import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminCourse } from "@/lib/admin/course";
import { loadBookings } from "@/lib/admin/data";
import { addDays, courseToday } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { BookingTable, PageHead } from "../_ui/parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bookings · Club office" };

const VIEWS = {
  upcoming: { label: "Next 14 days", from: 0, to: 14 },
  recent: { label: "Last 14 days", from: -14, to: -1 },
} as const;

export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const course = await requireAdminCourse("/admin/bookings");
  const { view: viewParam, q } = await searchParams;
  const view = viewParam === "recent" ? "recent" : "upcoming";
  const today = courseToday(course.timezone);
  const range = VIEWS[view];

  let bookings = await loadBookings(course.id, addDays(today, range.from), addDays(today, range.to));
  if (view === "recent") bookings = bookings.reverse();
  const term = q?.trim().toLowerCase();
  if (term) {
    bookings = bookings.filter(
      (b) =>
        b.ref.toLowerCase().includes(term) ||
        b.players.some((p) => p.name.toLowerCase().includes(term) || p.phone?.includes(term) || p.email?.includes(term)),
    );
  }

  return (
    <>
      <PageHead title="Bookings" detail={`${bookings.length} bookings · ${range.label.toLowerCase()}`}>
        <form className="flex gap-2 text-sm" action="/admin/bookings">
          <input type="hidden" name="view" value={view} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, mobile or ref"
            className="h-10 w-56 border border-alabaster-300 bg-card px-3 outline-none focus:border-pine"
          />
          <button className="h-10 border border-pine bg-pine px-4 text-alabaster" type="submit">
            Search
          </button>
        </form>
      </PageHead>
      <div className="mt-4 flex gap-4 text-sm">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((key) => (
          <Link
            key={key}
            href={`/admin/bookings?view=${key}`}
            className={cn("border-b-2 pb-1", key === view ? "border-brass text-pine" : "border-transparent text-ink-muted hover:text-pine")}
          >
            {VIEWS[key].label}
          </Link>
        ))}
      </div>
      <BookingTable bookings={bookings} showDate />
    </>
  );
}
