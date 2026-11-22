import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/notice";
import { getSessionContext } from "@/lib/auth/session";
import { describePolicy, previewRefund } from "@/lib/booking/cancellation";
import { formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import { StatusBadge } from "../status-badge";
import { CancelBooking } from "./cancel-booking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Booking", robots: { index: false } };

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const [{ id }, { paid }] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();
  const session = await getSessionContext();
  if (!session) redirect(`/login?next=/bookings/${id}`);

  const supabase = await getSupabaseServerClient();
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, courses(name, slug, timezone, cancellation_policy), course_tees(name, color_hex)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  if (!booking) notFound();

  const [{ data: players }, { data: caddies }] = await Promise.all([
    supabase.from("booking_players").select("seat_number, full_name, is_booker").eq("booking_id", id).order("seat_number"),
    supabase.rpc("get_booking_caddies", { p_booking_id: id }),
  ]);

  const isBooker = booking.booked_by === session.profile.id;
  const policy = booking.courses.cancellation_policy;
  const canCancel = isBooker && booking.status === "confirmed" && new Date(booking.tee_starts_at).getTime() > Date.now();
  const refund = canCancel ? previewRefund(booking, policy) : null;
  const caddyBySeat = new Map((caddies ?? []).filter((c) => c.status !== "cancelled").map((c) => [c.seat_number, c]));

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      {paid === "1" && booking.status === "confirmed" ? (
        <Notice tone="success" className="mb-8">
          You&apos;re booked. A confirmation is on its way by email{booking.player_count > 1 ? " to you and your players" : ""}.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow uppercase text-brass-700">
            <Link href={`/courses/${booking.courses.slug}`} className="hover:underline">
              {booking.courses.name}
            </Link>
          </p>
          <h1 className="mt-2 font-display text-display-sm text-pine">
            {formatTeeTime(booking.tee_time)}, {formatPlayDate(booking.play_date)}
          </h1>
          <p className="numerals mt-1 text-sm text-ink-muted">
            {HOLE_FORMAT_LABEL[booking.hole_format]} from hole {booking.start_hole}
            {booking.course_tees ? ` · ${booking.course_tees.name} tees` : ""}
            {booking.mode === "tournament" ? " · Tournament" : ""}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="numerals mt-8 rounded-card bg-pine px-6 py-4 text-alabaster">
        <p className="text-eyebrow uppercase text-brass">Booking reference</p>
        <p className="mt-1 font-mono text-xl tracking-wider">{booking.booking_ref}</p>
        <p className="mt-1 text-xs text-pine-200">Show this at the starter&apos;s hut 20 minutes before your tee time.</p>
      </div>

      <section className="mt-8 rounded-card bg-card shadow-card">
        <h2 className="border-b border-alabaster-300 px-6 py-4 text-eyebrow uppercase text-ink-faint">Players</h2>
        <ul className="divide-y divide-alabaster-300">
          {(players ?? []).map((p) => {
            const caddy = caddyBySeat.get(p.seat_number);
            return (
              <li key={p.seat_number} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                <span className="text-pine">
                  {p.full_name}
                  {p.is_booker ? <span className="ml-2 text-xs text-ink-faint">Booker</span> : null}
                </span>
                <span className="text-ink-muted">{caddy ? `Caddy: ${caddy.full_name} (${caddy.caddy_code})` : "No caddy"}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {isBooker ? (
        <section className="numerals mt-8 rounded-card bg-card p-6 shadow-card">
          <h2 className="text-eyebrow uppercase text-ink-faint">Payment</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Line label="Green fees" value={booking.green_fee_paise} />
            {booking.caddy_fee_paise > 0 ? <Line label="Caddy fees" value={booking.caddy_fee_paise} /> : null}
            {booking.tournament_addon_paise > 0 ? <Line label="Tournament entry" value={booking.tournament_addon_paise} /> : null}
            <Line label="Convenience fee" value={booking.convenience_fee_paise} />
            <div className="flex justify-between border-t border-alabaster-300 pt-3 text-pine">
              <dt>Total paid</dt>
              <dd className="font-display text-2xl">{formatPaise(booking.total_paise)}</dd>
            </div>
            {booking.refund_paise > 0 ? (
              <div className="flex justify-between text-brass-800">
                <dt>{booking.payment_status === "refunded" ? "Refunded" : "Refund in progress"}</dt>
                <dd>{formatPaise(booking.refund_paise)}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {canCancel && refund ? (
        <section className="mt-8 rounded-card border border-alabaster-300 p-6">
          <h2 className="text-eyebrow uppercase text-ink-faint">Cancel booking</h2>
          <ul className="mt-3 space-y-1 text-sm text-ink-muted">
            {describePolicy(policy).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <CancelBooking bookingId={booking.id} refundPaise={refund.refundPaise} />
        </section>
      ) : null}
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-pine">{formatPaise(value)}</dd>
    </div>
  );
}
