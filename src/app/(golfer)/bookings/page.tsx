import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getSessionContext } from "@/lib/auth/session";
import { formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My bookings" };

export default async function BookingsPage() {
  const session = await getSessionContext();
  if (!session) redirect("/login?next=/bookings");

  const supabase = await getSupabaseServerClient();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, booking_ref, play_date, tee_time, hole_format, player_count, status, total_paise, tee_starts_at, booked_by, courses(name, slug)")
    .order("tee_starts_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Bookings lookup failed: ${error.message}`);

  const now = Date.now();
  const upcoming = bookings
    .filter((b) => new Date(b.tee_starts_at).getTime() > now && b.status === "confirmed")
    .reverse();
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
      <p className="text-eyebrow uppercase text-brass-700">Your tee sheet</p>
      <h1 className="mt-3 font-display text-display-sm text-pine">My bookings</h1>

      {bookings.length === 0 ? (
        <div className="mt-10 rounded-card border border-dashed border-alabaster-400 p-10 text-center">
          <p className="text-ink-muted">No bookings yet.</p>
          <Link href="/" className={cn(buttonVariants(), "mt-6")}>
            Find a tee time
          </Link>
        </div>
      ) : (
        <>
          <List title="Upcoming" items={upcoming} userId={session.profile.id} />
          <List title="Past and cancelled" items={past} userId={session.profile.id} />
        </>
      )}
    </div>
  );
}

function List({
  title,
  items,
  userId,
}: {
  title: string;
  items: {
    id: string;
    booking_ref: string;
    play_date: string;
    tee_time: string;
    hole_format: keyof typeof HOLE_FORMAT_LABEL;
    player_count: number;
    status: Parameters<typeof StatusBadge>[0]["status"];
    total_paise: number;
    booked_by: string;
    courses: { name: string; slug: string };
  }[];
  userId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-eyebrow uppercase text-ink-faint">{title}</h2>
      <ul className="mt-3 divide-y divide-alabaster-300 overflow-hidden rounded-card bg-card shadow-card">
        {items.map((b) => (
          <li key={b.id}>
            <Link href={`/bookings/${b.id}`} className="numerals flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-pine-50/60">
              <div>
                <p className="text-pine">
                  {formatTeeTime(b.tee_time)} · {formatPlayDate(b.play_date, "short")}
                </p>
                <p className="text-sm text-ink-muted">
                  {b.courses.name} · {HOLE_FORMAT_LABEL[b.hole_format]} · {b.player_count} player{b.player_count > 1 ? "s" : ""}
                  {b.booked_by !== userId ? " · Guest" : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {b.booked_by === userId ? <span className="text-sm text-ink-muted">{formatPaise(b.total_paise)}</span> : null}
                <StatusBadge status={b.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
