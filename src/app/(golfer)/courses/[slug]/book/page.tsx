import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { getFlightHandicaps, viewerIsMember } from "@/lib/booking/tee-sheet-context";
import { getCourseShowcase } from "@/lib/courses";
import { addDays, courseToday, isIsoDate, isoWeekday } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { HoleFormat } from "@/types/database";
import { TeeSheet, type DateOption } from "./tee-sheet";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; format?: string; players?: string }>;
};

const FORMATS: readonly HoleFormat[] = ["full_18", "front_9", "back_9"];

/** Misty-fairway still also used on the front page (AI-generated, labelled in the UI). */
const FALLBACK_HERO = "/landing/img/fairway-poster.jpg";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCourseShowcase(slug);
  return { title: data ? `Tee times · ${data.course.name}` : "Tee times" };
}

export default async function BookPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const data = await getCourseShowcase(slug);
  if (!data) notFound();
  const { course, rateTiers } = data;

  const today = courseToday(course.timezone);
  const dates: DateOption[] = Array.from({ length: course.booking_window_days + 1 }, (_, i) => {
    const date = addDays(today, i);
    return { date, closed: (course.closed_weekdays as readonly number[]).includes(isoWeekday(date)) };
  });
  const firstOpen = dates.find((d) => !d.closed)?.date ?? today;
  const date = query.date && isIsoDate(query.date) && dates.some((d) => d.date === query.date) ? query.date : firstOpen;
  const format: HoleFormat = FORMATS.includes(query.format as HoleFormat) ? (query.format as HoleFormat) : "full_18";
  const players = Math.min(Math.max(Number.parseInt(query.players ?? "", 10) || 2, 1), course.max_players_per_slot);

  const supabase = await getSupabaseServerClient();
  const [{ data: slots, error }, session, { data: courses }, { data: auth }, handicaps] = await Promise.all([
    supabase.rpc("get_tee_sheet", { p_course_id: course.id, p_play_date: date }),
    getSessionContext(),
    supabase.from("courses").select("slug, name").eq("is_published", true).order("name"),
    supabase.auth.getUser(),
    getFlightHandicaps(course.id, date),
  ]);
  if (error) throw new Error(`Tee sheet failed: ${error.message}`);
  const isMember = await viewerIsMember(course.id, auth.user);

  const caddyRates = rateTiers.map((t) => (format === "full_18" ? t.rate_18_paise : t.rate_9_paise)).filter((r) => r > 0);

  return (
    <TeeSheet
      course={{
        id: course.id,
        slug: course.slug,
        name: course.name,
        city: course.city,
        holesCount: course.holes_count,
        maxPlayers: course.max_players_per_slot,
        holdMinutes: course.checkout_hold_minutes,
        firstTee: course.first_tee_time,
        guestFeePaise: course.pricing.guest_green_fee ?? null,
        memberFeePaise: course.pricing.member_green_fee ?? 0,
        convenienceFeePercent: course.pricing.platform_convenience_fee_percent,
        caddyFromPaise: caddyRates.length ? Math.min(...caddyRates) : null,
        heroImage: course.media.hero_banner?.startsWith("/landing/") ? course.media.hero_banner : FALLBACK_HERO,
      }}
      courses={courses ?? [{ slug: course.slug, name: course.name }]}
      dates={dates}
      today={today}
      date={date}
      format={format}
      players={players}
      slots={slots}
      handicaps={handicaps}
      viewer={
        session
          ? { handicapIndex: session.profile.handicap_18, roundsCounted: session.profile.rounds_counted_18, isMember }
          : null
      }
    />
  );
}
