import { formatPaise } from "@/lib/utils";
import type { HoleFormat, IsoDate, IsoTime, TeeSheetSlot, TeeSheetUnavailableReason, Uuid } from "@/types/database";

export type DateOption = { date: IsoDate; closed: boolean };

export type FlightHandicaps = { min: number; max: number; counted: number };

export type CourseInfo = {
  id: Uuid;
  slug: string;
  name: string;
  city: string;
  holesCount: number;
  maxPlayers: number;
  holdMinutes: number;
  firstTee: IsoTime;
  /** Flat non-member fee when the course prices members and guests separately. */
  guestFeePaise: number | null;
  memberFeePaise: number;
  convenienceFeePercent: number;
  /** Cheapest caddie grade for the chosen format; null when the course lists none. */
  caddyFromPaise: number | null;
  heroImage: string;
};

export type Viewer = {
  handicapIndex: number | null;
  roundsCounted: number;
  /** null when the member check could not run. */
  isMember: boolean | null;
} | null;

export type WindowId = "morning" | "mid" | "afternoon";

export const WINDOWS: readonly { id: WindowId; label: string; until: IsoTime }[] = [
  { id: "morning", label: "Morning", until: "08:30:59" },
  { id: "mid", label: "Mid-morning", until: "11:59:59" },
  { id: "afternoon", label: "Afternoon", until: "23:59:59" },
];

const REASON_LABEL: Record<TeeSheetUnavailableReason, string> = {
  course_closed_on_date: "Closed",
  beyond_booking_window: "Not open yet",
  tee_time_in_past: "Gone",
  inside_booking_cutoff: "Closed online",
  private_four_ball: "Private",
  slot_full: "Full",
  open_batch_join_disabled: "Taken",
};

export const slotKey = (slot: Pick<TeeSheetSlot, "tee_time" | "start_hole">): string => `${slot.tee_time}-${slot.start_hole}`;

/** "05:15:00" -> "05:15". The sheet reads as a 24-hour timetable. */
export const clock = (time: IsoTime): string => time.slice(0, 5);

export function windowOf(time: IsoTime): WindowId {
  return (WINDOWS.find((w) => time <= w.until) ?? WINDOWS[WINDOWS.length - 1]!).id;
}

export function slotAllows(slot: TeeSheetSlot, format: HoleFormat): boolean {
  if (format === "full_18") return slot.allows_full_18;
  if (format === "front_9") return slot.allows_front_9;
  return slot.allows_back_9;
}

/** Why this party can't take the slot, or null when it can. */
export function blockedReason(slot: TeeSheetSlot, players: number): string | null {
  if (slot.unavailable_reason) return REASON_LABEL[slot.unavailable_reason];
  if (slot.seats_left < players) return slot.seats_left === 0 ? "Full" : `${slot.seats_left} open`;
  return null;
}

export type FeeLine = { label: string; amount: number };
export type FeeEstimate = { lines: FeeLine[]; subtotal: number; convenience: number; total: number; assumesGuests: boolean };

/**
 * Mirrors the checkout quote (007_members_admin_caddy.sql): members pay the member fee,
 * everyone else the guest fee, caddies at the cheapest grade, then the convenience fee.
 * Only the booker's own membership is known here, so other players count as guests.
 */
export function estimateFees(args: {
  course: CourseInfo;
  viewer: Viewer;
  slot: TeeSheetSlot;
  players: number;
  format: HoleFormat;
  caddies: boolean;
}): FeeEstimate {
  const { course, viewer, slot, players, format, caddies } = args;
  const lines: FeeLine[] = [];
  let green = 0;

  if (course.guestFeePaise !== null) {
    const members = viewer?.isMember ? 1 : 0;
    const guests = players - members;
    if (members) {
      lines.push({ label: "You, as a member", amount: course.memberFeePaise });
      green += course.memberFeePaise;
    }
    if (guests > 0) {
      const label = members ? `${guests} guest${guests > 1 ? "s" : ""}` : `${guests} player${guests > 1 ? "s" : ""}`;
      lines.push({ label: `${label} × ${formatPaise(course.guestFeePaise)}`, amount: guests * course.guestFeePaise });
      green += guests * course.guestFeePaise;
    }
  } else {
    const each = format === "full_18" ? slot.price_18_paise : slot.price_9_paise;
    lines.push({ label: `Green fee, ${players} × ${formatPaise(each)}`, amount: players * each });
    green += players * each;
  }

  const caddyTotal = caddies && course.caddyFromPaise ? players * course.caddyFromPaise : 0;
  if (caddyTotal) lines.push({ label: `Caddies, ${players} × from ${formatPaise(course.caddyFromPaise!)}`, amount: caddyTotal });

  const subtotal = green + caddyTotal;
  const convenience = Math.round((subtotal * course.convenienceFeePercent) / 100);
  return {
    lines,
    subtotal,
    convenience,
    total: subtotal + convenience,
    assumesGuests: course.guestFeePaise !== null && players > (viewer?.isMember ? 1 : 0),
  };
}
