import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdminCourse } from "@/lib/admin/course";
import { formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import { PageHead } from "../../_ui/parts";
import { AssignCaddy, CancelBooking, RemoveCaddy } from "./booking-controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking · Club office" };

export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const course = await requireAdminCourse(`/admin/bookings/${id}`);
  const supabase = await getSupabaseServerClient();

  const { data: b, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, play_date, tee_time, tee_starts_at, start_hole, hole_format, status, payment_status, is_private, green_fee_paise, caddy_fee_paise, convenience_fee_paise, total_paise, refund_paise, cancellation_reason, notes, course_id, golfer_checked_in_at, booking_players!booking_players_booking_id_fkey(seat_number, full_name, phone, email, is_member, is_booker), caddy_assignments!caddy_assignments_booking_id_fkey(id, seat_number, status, checked_in_at, rate_paise, caddies!caddy_assignments_course_id_caddy_id_fkey(full_name, caddy_code))",
    )
    .eq("id", id)
    .eq("course_id", course.id)
    .maybeSingle();
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  if (!b) notFound();

  const players = [...b.booking_players].sort((x, y) => x.seat_number - y.seat_number);
  const caddies = b.caddy_assignments.filter((a) => a.status === "confirmed" || a.status === "completed");
  const active = b.status === "confirmed" || b.status === "checked_in";
  const freeSeats = players.filter((p) => !caddies.some((c) => c.seat_number === p.seat_number)).map((p) => ({ seat: p.seat_number, name: p.full_name }));

  let caddyOptions: { id: string; label: string }[] = [];
  if (active && freeSeats.length) {
    const [{ data: all }, { data: busy }] = await Promise.all([
      supabase.from("caddies").select("id, full_name, caddy_code, grade, daily_rate_18_paise, daily_rate_9_paise").eq("course_id", course.id).eq("is_active", true).order("caddy_code"),
      supabase
        .from("caddy_assignments")
        .select("caddy_id, starts_at, ends_at")
        .eq("course_id", course.id)
        .in("status", ["held", "confirmed", "completed"])
        .lt("starts_at", new Date(new Date(b.tee_starts_at).getTime() + 5 * 3600_000).toISOString())
        .gt("ends_at", b.tee_starts_at),
    ]);
    const taken = new Set((busy ?? []).map((a) => a.caddy_id));
    caddyOptions = (all ?? [])
      .filter((c) => !taken.has(c.id))
      .map((c) => ({
        id: c.id,
        label: `${c.full_name} · ${c.caddy_code} · ${formatPaise(b.hole_format === "full_18" ? c.daily_rate_18_paise : c.daily_rate_9_paise)}`,
      }));
  }

  const hoursAhead = (new Date(b.tee_starts_at).getTime() - Date.now()) / 3600_000;
  const refundPreview = b.payment_status === "paid" ? (hoursAhead >= 24 ? b.green_fee_paise + b.caddy_fee_paise : 0) : null;

  return (
    <>
      <p className="text-sm">
        <Link href="/admin/bookings" className="text-ink-muted hover:text-pine">
          ← Bookings
        </Link>
      </p>
      <PageHead
        title={`${formatTeeTime(b.tee_time)}, ${formatPlayDate(b.play_date, "short")}`}
        detail={`${b.booking_ref} · ${HOLE_FORMAT_LABEL[b.hole_format]}${b.start_hole === 10 ? " from hole 10" : ""}${b.is_private ? ` · blocked ${players.length}-ball` : ""}`}
      >
        <span className={cn("text-sm", active ? "text-pine" : "text-destructive")}>
          {b.status.replace("_", " ")}
          {b.golfer_checked_in_at
            ? ` · golfers in at ${new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(b.golfer_checked_in_at))}`
            : ""}
        </span>
      </PageHead>

      <div className="mt-6 grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="border border-alabaster-300 bg-card">
          <h2 className="border-b border-alabaster-300 px-5 py-3 font-display text-2xl text-pine">Players and caddies</h2>
          <ul>
            {players.map((p) => {
              const c = caddies.find((a) => a.seat_number === p.seat_number);
              return (
                <li key={p.seat_number} className="flex flex-wrap items-start justify-between gap-3 border-b border-alabaster-200 px-5 py-3 last:border-0">
                  <div>
                    <p>
                      {p.full_name}
                      <span className={cn("ml-2 text-[0.7rem] uppercase tracking-wide", p.is_member ? "text-pine-600" : "text-brass-700")}>
                        {p.is_member ? "Member" : "Guest"}
                      </span>
                      {p.is_booker ? <span className="ml-2 text-xs text-ink-faint">Booker</span> : null}
                    </p>
                    <p className="numerals text-xs text-ink-faint">{[p.phone, p.email].filter(Boolean).join(" · ") || "No contact details"}</p>
                  </div>
                  <div className="text-right text-sm">
                    {c ? (
                      <>
                        <p>
                          {c.caddies.full_name} <span className="numerals text-xs text-ink-faint">{c.caddies.caddy_code}</span>
                        </p>
                        <p className="text-xs text-ink-muted">
                          {formatPaise(c.rate_paise)} · {c.checked_in_at ? "checked in" : "not checked in"}
                        </p>
                        {active && !c.checked_in_at && c.status === "confirmed" ? <RemoveCaddy bookingId={b.id} assignmentId={c.id} /> : null}
                      </>
                    ) : (
                      <span className="text-ink-faint">No caddie</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {active ? (
            <div className="border-t border-alabaster-300 p-5">
              <AssignCaddy bookingId={b.id} seats={freeSeats} caddies={caddyOptions} />
            </div>
          ) : null}
        </section>

        <section className="space-y-6">
          <div className="border border-alabaster-300 bg-card p-5">
            <h2 className="font-display text-2xl text-pine">Payment</h2>
            <dl className="numerals mt-3 space-y-1.5 text-sm">
              {[
                ["Guest green fees", b.green_fee_paise],
                ["Caddie fees", b.caddy_fee_paise],
                ["Convenience fee", b.convenience_fee_paise],
              ].map(([label, v]) => (
                <div key={label as string} className="flex justify-between">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd>{formatPaise(v as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-alabaster-300 pt-2">
                <dt>Total</dt>
                <dd className="font-display text-2xl text-pine">{b.payment_status === "waived" && b.total_paise === 0 ? "Free" : formatPaise(b.total_paise)}</dd>
              </div>
              {b.refund_paise > 0 ? (
                <div className="flex justify-between text-destructive">
                  <dt>Refund ({b.payment_status.replace("_", " ")})</dt>
                  <dd>{formatPaise(b.refund_paise)}</dd>
                </div>
              ) : null}
            </dl>
            {b.cancellation_reason ? <p className="mt-3 text-sm text-ink-muted">Reason: {b.cancellation_reason}</p> : null}
          </div>
          {b.status === "confirmed" && hoursAhead > 0 ? <CancelBooking bookingId={b.id} refundPreview={refundPreview} /> : null}
        </section>
      </div>
    </>
  );
}
