import type { Metadata } from "next";
import { requireAdminCourse } from "@/lib/admin/course";
import { loadBookings, summarise } from "@/lib/admin/data";
import { courseToday, formatPlayDate, isIsoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/utils";
import { BookingTable, DateStepper, PageHead, Stats } from "./_ui/parts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tee sheet · Club office" };

export default async function AdminTeeSheetPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const course = await requireAdminCourse("/admin");
  const { date: dateParam } = await searchParams;
  const today = courseToday(course.timezone);
  const date = dateParam && isIsoDate(dateParam) ? dateParam : today;

  const bookings = await loadBookings(course.id, date, date);
  const s = summarise(bookings);

  return (
    <>
      <PageHead title="Tee sheet" detail={`${course.name} · ${formatPlayDate(date)}`}>
        <DateStepper date={date} today={today} basePath="/admin" />
      </PageHead>
      <Stats
        items={[
          { label: "Groups", value: String(s.groups), note: s.cancelled ? `${s.cancelled} cancelled` : undefined },
          { label: "Players", value: String(s.players) },
          { label: "Members", value: String(s.members), note: "play free" },
          { label: "Guests", value: String(s.guests), note: "₹1,000 each" },
          { label: "Caddies out", value: String(s.caddies) },
          { label: "Collected", value: formatPaise(s.totalPaise), note: `${s.checkedIn} groups checked in` },
        ]}
      />
      <BookingTable bookings={bookings} />
    </>
  );
}
