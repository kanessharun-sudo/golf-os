import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { BookingStatus, HoleFormat, IsoDate, IsoTime, Paise, PaymentStatus, Uuid } from "@/types/database";

export type AdminBooking = {
  id: Uuid;
  ref: string;
  playDate: IsoDate;
  teeTime: IsoTime;
  startHole: number;
  holeFormat: HoleFormat;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  isPrivate: boolean;
  greenPaise: Paise;
  caddyPaise: Paise;
  feePaise: Paise;
  totalPaise: Paise;
  refundPaise: Paise;
  createdAt: string;
  players: { seat: number; name: string; phone: string | null; email: string | null; isMember: boolean; isBooker: boolean }[];
  caddies: { name: string; code: string; checkedIn: boolean }[];
};

/** Bookings in a date range with players and caddies, read through the admin's RLS. */
export async function loadBookings(courseId: Uuid, from: IsoDate, to: IsoDate): Promise<AdminBooking[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, booking_ref, play_date, tee_time, start_hole, hole_format, status, payment_status, is_private, green_fee_paise, caddy_fee_paise, convenience_fee_paise, total_paise, refund_paise, created_at, booking_players!booking_players_booking_id_fkey(seat_number, full_name, phone, email, is_member, is_booker), caddy_assignments!caddy_assignments_booking_id_fkey(status, checked_in_at, caddies!caddy_assignments_course_id_caddy_id_fkey(full_name, caddy_code))",
    )
    .eq("course_id", courseId)
    .gte("play_date", from)
    .lte("play_date", to)
    .order("play_date")
    .order("tee_time")
    .limit(1000);
  if (error) throw new Error(`Bookings lookup failed: ${error.message}`);

  return data.map((b) => ({
    id: b.id,
    ref: b.booking_ref,
    playDate: b.play_date,
    teeTime: b.tee_time,
    startHole: b.start_hole,
    holeFormat: b.hole_format,
    status: b.status,
    paymentStatus: b.payment_status,
    isPrivate: b.is_private,
    greenPaise: b.green_fee_paise,
    caddyPaise: b.caddy_fee_paise,
    feePaise: b.convenience_fee_paise,
    totalPaise: b.total_paise,
    refundPaise: b.refund_paise,
    createdAt: b.created_at,
    players: [...b.booking_players]
      .sort((x, y) => x.seat_number - y.seat_number)
      .map((p) => ({ seat: p.seat_number, name: p.full_name, phone: p.phone, email: p.email, isMember: p.is_member, isBooker: p.is_booker })),
    caddies: b.caddy_assignments
      .filter((a) => a.status === "confirmed" || a.status === "completed")
      .map((a) => ({ name: a.caddies.full_name, code: a.caddies.caddy_code, checkedIn: a.checked_in_at !== null })),
  }));
}

export const ACTIVE_STATUSES: readonly BookingStatus[] = ["confirmed", "checked_in", "completed"];

export function summarise(bookings: AdminBooking[]) {
  const active = bookings.filter((b) => ACTIVE_STATUSES.includes(b.status));
  const players = active.flatMap((b) => b.players);
  const members = players.filter((p) => p.isMember).length;
  return {
    groups: active.length,
    players: players.length,
    members,
    guests: players.length - members,
    caddies: active.reduce((n, b) => n + b.caddies.length, 0),
    checkedIn: active.filter((b) => b.status === "checked_in" || b.status === "completed").length,
    greenPaise: active.reduce((n, b) => n + b.greenPaise, 0),
    caddyPaise: active.reduce((n, b) => n + b.caddyPaise, 0),
    feePaise: active.reduce((n, b) => n + b.feePaise, 0),
    totalPaise: active.reduce((n, b) => n + b.totalPaise, 0),
    cancelled: bookings.filter((b) => b.status === "cancelled" || b.status === "refunded").length,
    refundPaise: bookings.reduce((n, b) => n + b.refundPaise, 0),
  };
}
