import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCourseShowcase(slug);
  return { title: data ? `Tee times · ${data.course.name}` : "Tee times" };
}

export default async function BookPage({ params, searchParams }: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const data = await getCourseShowcase(slug);
  if (!data) notFound();
  const { course } = data;

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
  const [{ data: slots, error }, session] = await Promise.all([
    supabase.rpc("get_tee_sheet", { p_course_id: course.id, p_play_date: date }),
    getSessionContext(),
  ]);
  if (error) throw new Error(`Tee sheet failed: ${error.message}`);

  return (
    <TeeSheet
      course={{
        id: course.id,
        slug: course.slug,
        name: course.name,
        holesCount: course.holes_count,
        maxPlayers: course.max_players_per_slot,
        holdMinutes: course.checkout_hold_minutes,
        allowJoin: course.allow_join_open_batch,
        guestFeePaise: course.pricing.guest_green_fee ?? null,
      }}
      dates={dates}
      date={date}
      format={format}
      players={players}
      slots={slots}
      signedIn={session !== null}
    />
  );
}
