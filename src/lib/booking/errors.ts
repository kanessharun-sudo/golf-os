import type { GolfOsDbErrorCode } from "@/types/database";

const MESSAGES: Partial<Record<GolfOsDbErrorCode, string>> = {
  auth_required: "Please sign in to continue.",
  course_not_bookable: "This course is not taking bookings right now.",
  back_nine_unavailable: "The back nine cannot be booked on its own here.",
  course_closed_on_date: "The course is closed on that day.",
  tee_time_outside_window: "That tee time is outside the course's booking hours.",
  tee_time_off_grid: "That is not a valid tee time.",
  tee_time_in_past: "That tee time has already gone.",
  inside_booking_cutoff: "Online booking for that tee time has closed.",
  beyond_booking_window: "That date is not open for booking yet.",
  invalid_seat_count: "Choose between 1 and 4 players.",
  slot_full: "Someone has just taken those seats. Please pick another time.",
  slot_not_empty_for_private: "A private four-ball needs an empty slot.",
  open_batch_join_disabled: "This course does not let groups join a partly filled slot.",
  hold_not_found: "We could not find your reserved seats.",
  hold_expired: "Your 7-minute hold has run out. Please pick the tee time again.",
  hold_locked_for_payment: "Payment has started for this booking, so its details can no longer change.",
  invalid_players: "Please check the player details.",
  player_count_mismatch: "Add a name for every seat you reserved.",
  seat_numbers_not_contiguous: "Please check the player details.",
  tee_not_available: "That tee box is not available.",
  seat_not_found: "Save the player details before choosing caddies.",
  caddy_unavailable: "That caddy has just been booked for this time. Please choose another.",
  hold_details_missing: "Add player details before paying.",
  quote_mismatch: "The price changed. Please review the total again.",
  booking_not_found: "We could not find that booking.",
  booking_not_cancellable: "This booking can no longer be cancelled.",
  round_already_started: "This round has started, so it cannot be cancelled.",
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Turns a PostgREST/RPC error into copy a golfer can act on. */
export function toActionError(error: { message: string } | null | undefined): { ok: false; error: string; code?: string } {
  const code = error?.message?.trim() ?? "";
  const known = MESSAGES[code as GolfOsDbErrorCode];
  if (known) return { ok: false, error: known, code };
  console.error("[booking] unexpected database error", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}
