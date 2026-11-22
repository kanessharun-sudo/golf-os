import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/notice";
import { getSessionContext } from "@/lib/auth/session";
import { describePolicy, previewRefund } from "@/lib/booking/cancellation";
import { courseToday, formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import {
  CheckChip,
  HeroTitle,
  PhotoHero,
  SectionTitle,
} from "@/components/app/photo-hero";
import { StatusBadge } from "../status-badge";
import { GolferCheckIn } from "./golfer-check-in";
import { CancelBooking } from "./cancel-booking";
import { StartRound } from "./start-round";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Booking",
  robots: { index: false },
};

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
    .select(
      "*, courses(name, slug, timezone, cancellation_policy), course_tees(name, color_hex)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  if (!booking) notFound();

  const [
    { data: players },
    { data: caddies },
    { data: round },
    { data: auth },
  ] = await Promise.all([
    supabase
      .from("booking_players")
      .select("seat_number, full_name, is_booker, is_member")
      .eq("booking_id", id)
      .order("seat_number"),
    supabase.rpc("get_booking_caddies", { p_booking_id: id }),
    supabase
      .from("rounds")
      .select("id, status")
      .eq("booking_id", id)
      .maybeSingle(),
    supabase.auth.getUser(),
  ]);

  // Mirrors start_round: from 60 min before tee time to the end of the tee date; demo accounts any time.
  const isDemo = auth.user?.app_metadata?.is_demo === true;
  const opensAt = new Date(
    new Date(booking.tee_starts_at).getTime() - 60 * 60 * 1000,
  );
  const windowOpen =
    Date.now() >= opensAt.getTime() &&
    courseToday(booking.courses.timezone) <= booking.play_date;
  const playable =
    booking.status === "confirmed" || booking.status === "checked_in";

  const isBooker = booking.booked_by === session.profile.id;
  const policy = booking.courses.cancellation_policy;
  const canCancel =
    isBooker &&
    !round &&
    booking.status === "confirmed" &&
    new Date(booking.tee_starts_at).getTime() > Date.now();
  const refund = canCancel ? previewRefund(booking, policy) : null;
  const today = courseToday(booking.courses.timezone);
  const canCheckIn =
    playable &&
    !booking.golfer_checked_in_at &&
    (booking.play_date === today || isDemo);
  const activeCaddies = (caddies ?? []).filter((c) => c.status !== "cancelled");
  const caddyBySeat = new Map(
    (caddies ?? [])
      .filter((c) => c.status !== "cancelled")
      .map((c) => [c.seat_number, c]),
  );

  return (
    <div>
      <PhotoHero
        image="/landing/img/first-tee-poster.jpg"
        aside={
          <div className="bg-alabaster-50 p-5 text-ink shadow-card">
            <p className="text-sm font-semibold text-pine">Check-in</p>
            <div className="mt-3 flex flex-col items-start gap-2">
              <CheckChip
                label="Golfers"
                at={booking.golfer_checked_in_at}
                timeZone={booking.courses.timezone}
              />
              {activeCaddies.map((c) => (
                <CheckChip
                  key={c.seat_number}
                  label={c.full_name.split(" ")[0]}
                  at={c.checked_in_at}
                  timeZone={booking.courses.timezone}
                />
              ))}
            </div>
            <p className="mt-3 border-t border-alabaster-300 pt-3 text-xs text-ink-muted">
              {activeCaddies.length
                ? "You and your caddie each check in when you reach the club."
                : "Check in when you reach the club."}
            </p>
          </div>
        }
      >
        <p className="text-sm text-alabaster/80">
          <Link
            href={`/courses/${booking.courses.slug}`}
            className="hover:underline"
          >
            {booking.courses.name}
          </Link>
        </p>
        <div className="mt-2">
          <HeroTitle>{formatTeeTime(booking.tee_time)}</HeroTitle>
        </div>
        <p className="mt-2 text-lg font-medium text-alabaster">
          {formatPlayDate(booking.play_date)}
        </p>
        <p className="numerals mt-1 text-sm text-alabaster/80">
          {HOLE_FORMAT_LABEL[booking.hole_format]} from hole{" "}
          {booking.start_hole}
          {booking.course_tees ? ` · ${booking.course_tees.name} tees` : ""}
          {booking.mode === "tournament" ? " · Tournament" : ""}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="numerals bg-alabaster/10 px-3 py-1.5 font-mono text-sm tracking-wider">
            {booking.booking_ref}
          </span>
          <StatusBadge status={booking.status} />
        </div>
        {canCheckIn ? (
          <div className="mt-6">
            <GolferCheckIn bookingId={booking.id} />
          </div>
        ) : null}
      </PhotoHero>

      <div className="mx-auto max-w-3xl px-5 py-10">
        {paid === "1" && booking.status === "confirmed" ? (
          <Notice tone="success" className="mb-8">
            You&apos;re booked. A confirmation is on its way by email
            {booking.player_count > 1 ? " to you and your players" : ""}.
          </Notice>
        ) : null}

        <p className="text-sm text-ink-muted">
          Show the booking reference at the starter&apos;s hut 20 minutes before
          your tee time.
        </p>

        {round ? (
          <section className="mt-8 rounded-card border border-pine/15 bg-pine-50 p-6">
            <SectionTitle>Scorecard</SectionTitle>
            <p className="mt-2 text-sm text-pine">
              {round.status === "completed"
                ? "Round submitted. See the final card and your handicap update."
                : round.status === "abandoned"
                  ? "This round was abandoned."
                  : "Your round is under way."}
            </p>
            <Link
              href={`/rounds/${round.id}/score`}
              className="mt-4 inline-flex h-11 items-center rounded-card bg-pine px-5 text-sm font-medium text-alabaster hover:bg-pine-700"
            >
              {round.status === "in_progress" || round.status === "scheduled"
                ? "Continue scoring"
                : "View scorecard"}
            </Link>
          </section>
        ) : playable ? (
          <section className="mt-8 rounded-card border border-pine/15 bg-pine-50 p-6">
            <SectionTitle>Live scorecard</SectionTitle>
            {isDemo || windowOpen ? (
              <>
                <p className="mt-2 text-sm text-pine">
                  One phone scores the whole group, hole by hole. Handicaps
                  update when you submit.
                  {isDemo && !windowOpen
                    ? " Demo accounts can start before the tee date."
                    : ""}
                </p>
                <div className="mt-4">
                  <StartRound bookingId={booking.id} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-pine">
                Scoring opens at{" "}
                {new Intl.DateTimeFormat("en-IN", {
                  timeZone: booking.courses.timezone,
                  hour: "numeric",
                  minute: "2-digit",
                  day: "numeric",
                  month: "short",
                }).format(opensAt)}
                , 60 minutes before your tee time.
              </p>
            )}
          </section>
        ) : null}

        <section className="mt-8 rounded-card bg-card shadow-card">
          <div className="border-b border-alabaster-300 px-6 py-4">
            <SectionTitle>Players</SectionTitle>
          </div>
          <ul className="divide-y divide-alabaster-300">
            {(players ?? []).map((p) => {
              const caddy = caddyBySeat.get(p.seat_number);
              return (
                <li
                  key={p.seat_number}
                  className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm"
                >
                  <span className="text-pine">
                    {p.full_name}
                    {p.is_booker ? (
                      <span className="ml-2 text-xs text-ink-faint">
                        Booker
                      </span>
                    ) : null}
                    <span className="ml-2 text-xs text-ink-faint">
                      {p.is_member ? "Member" : "Guest"}
                    </span>
                  </span>
                  <span className="text-ink-muted">
                    {caddy
                      ? `Caddie: ${caddy.full_name} (${caddy.caddy_code})`
                      : "No caddie"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {isBooker ? (
          <section className="numerals mt-8 rounded-card bg-card p-6 shadow-card">
            <SectionTitle>Payment</SectionTitle>
            <dl className="mt-4 space-y-2 text-sm">
              <Line label="Green fees" value={booking.green_fee_paise} />
              {booking.caddy_fee_paise > 0 ? (
                <Line label="Caddie fees" value={booking.caddy_fee_paise} />
              ) : null}
              {booking.tournament_addon_paise > 0 ? (
                <Line
                  label="Tournament entry"
                  value={booking.tournament_addon_paise}
                />
              ) : null}
              <Line
                label="Convenience fee"
                value={booking.convenience_fee_paise}
              />
              <div className="flex justify-between border-t border-alabaster-300 pt-3 text-pine">
                <dt>Total paid</dt>
                <dd className="font-display text-2xl">
                  {formatPaise(booking.total_paise)}
                </dd>
              </div>
              {booking.refund_paise > 0 ? (
                <div className="flex justify-between text-brass-800">
                  <dt>
                    {booking.payment_status === "refunded"
                      ? "Refunded"
                      : "Refund in progress"}
                  </dt>
                  <dd>{formatPaise(booking.refund_paise)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        {canCancel && refund ? (
          <section className="mt-8 rounded-card border border-alabaster-300 p-6">
            <SectionTitle>Cancel booking</SectionTitle>
            <ul className="mt-3 space-y-1 text-sm text-ink-muted">
              {describePolicy(policy).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <CancelBooking
              bookingId={booking.id}
              refundPaise={refund.refundPaise}
            />
          </section>
        ) : null}
      </div>
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
