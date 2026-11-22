import "server-only";

import type { User } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { IsoDate, Uuid } from "@/types/database";

/** Handicap spread of the golfers already booked into one flight. Never names. */
export type FlightHandicaps = { min: number; max: number; counted: number };

/** Keyed by `${tee_time}-${start_hole}`, matching TeeSheetSlot. */
export type FlightHandicapMap = Record<string, FlightHandicaps>;

const LIVE_STATUSES = ["confirmed", "checked_in"] as const;

/**
 * Handicap range per booked flight on one date.
 *
 * Booking rows are private to their owners under RLS, so this reads with the
 * service role and returns only an aggregate (min, max, count of golfers with an
 * index). It is the same information a starter's printed sheet shows. Returns an
 * empty map on any failure so the tee sheet still renders without the tags.
 */
export async function getFlightHandicaps(courseId: Uuid, playDate: IsoDate): Promise<FlightHandicapMap> {
  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from("bookings")
      .select("tee_time, start_hole, booking_players!booking_players_booking_id_fkey(profiles(handicap_18))")
      .eq("course_id", courseId)
      .eq("play_date", playDate)
      .in("status", LIVE_STATUSES);
    if (error || !data) return {};

    const map: FlightHandicapMap = {};
    for (const booking of data) {
      const key = `${booking.tee_time}-${booking.start_hole}`;
      for (const player of booking.booking_players ?? []) {
        const profile = Array.isArray(player.profiles) ? player.profiles[0] : player.profiles;
        const index = profile?.handicap_18;
        if (index === null || index === undefined) continue;
        const current = map[key];
        map[key] = current
          ? { min: Math.min(current.min, index), max: Math.max(current.max, index), counted: current.counted + 1 }
          : { min: index, max: index, counted: 1 };
      }
    }
    return map;
  } catch {
    return {};
  }
}

/** Whether the signed-in golfer matches the club's member list by phone or email. */
export async function viewerIsMember(courseId: Uuid, user: Pick<User, "phone" | "email"> | null): Promise<boolean | null> {
  if (!user) return null;
  const phone = user.phone ? `+${user.phone.replace(/^\+/, "")}` : null;
  const email = user.email ?? null;
  if (!phone && !email) return false;
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("is_club_member", {
      p_course_id: courseId,
      p_phone: phone,
      p_email: email,
    });
    return error ? null : data;
  } catch {
    return null;
  }
}
