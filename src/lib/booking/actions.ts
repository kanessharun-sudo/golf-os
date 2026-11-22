"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isDemoPayments, publicEnv } from "@/lib/env";
import { notifyBooking } from "@/lib/notifications/booking";
import { createOrder, RazorpayError } from "@/lib/payments/razorpay";
import { refundOnce, settleDemoPayment, type SettleOutcome } from "@/lib/payments/settle";
import { syncMembersIfStale } from "@/lib/members/sync";
import { normalisePhone } from "@/lib/phone";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { HoldCaddy, HoldQuote, Paise, Uuid } from "@/types/database";
import { toActionError, type ActionResult } from "./errors";

const uuid = z.string().uuid();
const seatNumber = z.number().int().min(1).max(4);

async function requireUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const unauthenticated = { ok: false as const, error: "Please sign in to continue.", code: "auth_required" };
const invalidInput = { ok: false as const, error: "Something in that request was not valid. Please try again." };

// ---------------------------------------------------------------------------
// Tee sheet → hold
// ---------------------------------------------------------------------------
const acquireSchema = z.object({
  courseId: uuid,
  playDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teeTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  holeFormat: z.enum(["front_9", "back_9", "full_18"]),
  seats: seatNumber,
  isPrivate: z.boolean(),
});

export async function acquireHoldAction(input: z.input<typeof acquireSchema>): Promise<ActionResult<{ holdId: Uuid }>> {
  const parsed = acquireSchema.safeParse(input);
  if (!parsed.success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { courseId, playDate, teeTime, holeFormat, seats, isPrivate } = parsed.data;
  if (isPrivate && seats < 3) {
    return { ok: false, error: "A blocked slot is a 3-ball or a 4-ball. Choose 3 or 4 players." };
  }
  const { data, error } = await supabase.rpc("acquire_slot_hold", {
    p_course_id: courseId,
    p_play_date: playDate,
    p_tee_time: teeTime,
    p_hole_format: holeFormat,
    // A blocked 3-ball or 4-ball closes the whole slot; the hold records the seats played.
    p_seats: seats,
    p_is_private: isPrivate,
  });
  if (error) return toActionError(error);
  return { ok: true, data: { holdId: data.id } };
}

export async function releaseHoldAction(holdId: string): Promise<ActionResult<null>> {
  if (!uuid.safeParse(holdId).success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;
  const { error } = await supabase.rpc("release_slot_hold", { p_hold_id: holdId });
  if (error) return toActionError(error);
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Checkout: players, tee, mode
// ---------------------------------------------------------------------------
const playerSchema = z.object({
  seatNumber: seatNumber,
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional().default(""),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .default("")
    .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "invalid email"),
  isBooker: z.boolean(),
});

const detailsSchema = z.object({
  holdId: uuid,
  teeId: uuid,
  mode: z.enum(["normal", "tournament"]),
  players: z.array(playerSchema).min(1).max(4),
});

export type PlayerInput = z.input<typeof playerSchema>;

export async function saveHoldDetailsAction(input: z.input<typeof detailsSchema>): Promise<ActionResult<null>> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.at(-1);
    return {
      ok: false,
      error:
        field === "email"
          ? "One of the email addresses is not valid."
          : field === "fullName"
            ? "Every player needs a name."
            : invalidInput.error,
    };
  }
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const players = [];
  for (const p of parsed.data.players) {
    let phone: string | null = null;
    if (p.phone) {
      phone = normalisePhone(p.phone);
      if (!phone) return { ok: false, error: `The mobile number for ${p.fullName} is not valid.` };
    }
    players.push({
      seat_number: p.seatNumber,
      full_name: p.fullName,
      phone,
      email: p.email ? p.email.toLowerCase() : null,
      is_booker: p.isBooker,
    });
  }
  if (players.filter((p) => p.is_booker).length > 1) return invalidInput;

  // Member pricing reads the club's sheet; refresh it if the copy is stale.
  const { data: holdCourse } = await supabase.from("slot_holds").select("course_id").eq("id", parsed.data.holdId).maybeSingle();
  if (holdCourse) await syncMembersIfStale(holdCourse.course_id);

  const { error } = await supabase.rpc("save_hold_details", {
    p_hold_id: parsed.data.holdId,
    p_players: players,
    p_tee_id: parsed.data.teeId,
    p_mode: parsed.data.mode,
  });
  if (error) return toActionError(error);
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Checkout: caddies
// ---------------------------------------------------------------------------
const caddySchema = z.object({ holdId: uuid, caddyId: uuid, seatNumber: seatNumber });

export async function holdCaddyAction(input: z.input<typeof caddySchema>): Promise<ActionResult<HoldCaddy[]>> {
  const parsed = caddySchema.safeParse(input);
  if (!parsed.success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { error } = await supabase.rpc("hold_caddy", {
    p_hold_id: parsed.data.holdId,
    p_caddy_id: parsed.data.caddyId,
    p_seat_number: parsed.data.seatNumber,
  });
  if (error) return toActionError(error);
  return listHoldCaddies(parsed.data.holdId);
}

export async function releaseHoldCaddyAction(input: { holdId: string; seatNumber: number }): Promise<ActionResult<HoldCaddy[]>> {
  const parsed = z.object({ holdId: uuid, seatNumber: seatNumber }).safeParse(input);
  if (!parsed.success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { error } = await supabase.rpc("release_hold_caddy", {
    p_hold_id: parsed.data.holdId,
    p_seat_number: parsed.data.seatNumber,
  });
  if (error) return toActionError(error);
  return listHoldCaddies(parsed.data.holdId);
}

async function listHoldCaddies(holdId: Uuid): Promise<ActionResult<HoldCaddy[]>> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_hold_caddies", { p_hold_id: holdId });
  if (error) return toActionError(error);
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// Checkout: quote and Razorpay order
// ---------------------------------------------------------------------------
export async function quoteHoldAction(holdId: string): Promise<ActionResult<HoldQuote>> {
  if (!uuid.safeParse(holdId).success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { data: hold, error: holdError } = await supabase
    .from("slot_holds")
    .select("razorpay_order_id, quote")
    .eq("id", holdId)
    .maybeSingle();
  if (holdError) return toActionError(holdError);
  if (!hold) return toActionError({ message: "hold_not_found" });
  // Once an order exists the price is frozen; show the quote it was created from.
  if (hold.razorpay_order_id && hold.quote) return { ok: true, data: hold.quote };

  const { data, error } = await supabase.rpc("quote_slot_hold", { p_hold_id: holdId });
  if (error) return toActionError(error);
  return { ok: true, data };
}

export type CheckoutOrder = {
  mode: "razorpay" | "demo";
  keyId: string;
  orderId: string;
  amount: Paise;
  currency: string;
  courseName: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
};

export async function createPaymentOrderAction(holdId: string): Promise<ActionResult<CheckoutOrder>> {
  if (!uuid.safeParse(holdId).success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { data: hold, error: holdError } = await supabase
    .from("slot_holds")
    .select("id, status, expires_at, razorpay_order_id, total_paise, play_date, tee_time, hole_format, courses(name, currency)")
    .eq("id", holdId)
    .maybeSingle();
  if (holdError) return toActionError(holdError);
  if (!hold) return toActionError({ message: "hold_not_found" });

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const demo = isDemoPayments();
  const base = {
    mode: demo ? ("demo" as const) : ("razorpay" as const),
    keyId: publicEnv().NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
    currency: hold.courses.currency,
    courseName: hold.courses.name,
    description: `Tee time ${hold.play_date} ${hold.tee_time.slice(0, 5)}`,
    prefill: { name: profile?.full_name ?? "", email: user.email ?? "", contact: user.phone ? `+${user.phone.replace(/^\+/, "")}` : "" },
  };

  // Re-opening checkout after dismissing the modal reuses the same order.
  if (hold.razorpay_order_id && hold.total_paise !== null) {
    return { ok: true, data: { ...base, orderId: hold.razorpay_order_id, amount: hold.total_paise } };
  }
  if (hold.status !== "active" || new Date(hold.expires_at).getTime() <= Date.now()) {
    return toActionError({ message: "hold_expired" });
  }

  const { data: quote, error: quoteError } = await supabase.rpc("quote_slot_hold", { p_hold_id: holdId });
  if (quoteError) return toActionError(quoteError);

  let order: { id: string; amount: Paise; currency: string };
  if (demo) {
    order = { id: `demo_order_${randomBytes(7).toString("hex")}`, amount: quote.total_paise, currency: quote.currency };
  } else {
    try {
      order = await createOrder({
        amount: quote.total_paise,
        currency: quote.currency,
        receipt: `hold_${holdId}`,
        notes: { hold_id: holdId, profile_id: user.id },
      });
    } catch (error) {
      console.error("[checkout] Razorpay order failed", error instanceof RazorpayError ? error.message : error);
      return { ok: false, error: "The payment gateway is not responding. Your seats are still held; please try again." };
    }
  }

  const admin = getSupabaseAdminClient();
  const { error: attachError } = await admin.rpc("attach_razorpay_order", {
    p_hold_id: holdId,
    p_order_id: order.id,
    p_amount_paise: order.amount,
  });
  if (attachError) return toActionError(attachError);

  return { ok: true, data: { ...base, orderId: order.id, amount: order.amount, currency: order.currency } };
}

/** Every player is a member and no caddie was added: nothing to pay, so confirm directly. */
export async function confirmFreeBookingAction(holdId: string): Promise<ActionResult<{ bookingId: Uuid }>> {
  if (!uuid.safeParse(holdId).success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { data: bookingId, error } = await supabase.rpc("confirm_free_hold", { p_hold_id: holdId });
  if (error) return toActionError(error);
  await notifyBooking(bookingId, "booking_confirmed");
  revalidatePath("/bookings");
  return { ok: true, data: { bookingId } };
}

/**
 * Demo mode only: the golfer confirmed the simulated payment screen. The hold
 * must belong to the caller (RLS on slot_holds) and already carry its order.
 */
export async function completeDemoPaymentAction(holdId: string): Promise<ActionResult<SettleOutcome>> {
  if (!uuid.safeParse(holdId).success) return invalidInput;
  if (!isDemoPayments()) return { ok: false, error: "Demo payments are switched off." };
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { data: hold, error } = await supabase
    .from("slot_holds")
    .select("razorpay_order_id, total_paise")
    .eq("id", holdId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) return toActionError(error);
  if (!hold?.razorpay_order_id || hold.total_paise === null || !hold.razorpay_order_id.startsWith("demo_order_")) {
    return toActionError({ message: "hold_not_found" });
  }

  try {
    const outcome = await settleDemoPayment({ orderId: hold.razorpay_order_id, amount: hold.total_paise });
    if (outcome.status === "confirmed") revalidatePath("/bookings");
    return { ok: true, data: outcome };
  } catch (settleError) {
    console.error("[checkout] demo settlement failed", settleError);
    return { ok: false, error: "The booking could not be confirmed. Your seats are still held; please try again." };
  }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------
export async function cancelBookingAction(input: {
  bookingId: string;
  reason?: string;
}): Promise<ActionResult<{ refundPaise: Paise }>> {
  const parsed = z.object({ bookingId: uuid, reason: z.string().trim().max(500).optional() }).safeParse(input);
  if (!parsed.success) return invalidInput;
  const { supabase, user } = await requireUser();
  if (!user) return unauthenticated;

  const { data, error } = await supabase.rpc("cancel_booking", {
    p_booking_id: parsed.data.bookingId,
    p_reason: parsed.data.reason || null,
  });
  if (error) return toActionError(error);
  const refundPaise = data[0]?.refund_paise ?? 0;

  if (refundPaise > 0) {
    const admin = getSupabaseAdminClient();
    const { data: booking } = await admin
      .from("bookings")
      .select("razorpay_payment_id, razorpay_order_id")
      .eq("id", parsed.data.bookingId)
      .single();
    if (booking?.razorpay_payment_id) {
      try {
        await refundOnce({
          paymentId: booking.razorpay_payment_id,
          orderId: booking.razorpay_order_id,
          amount: refundPaise,
          reason: "cancelled_by_golfer",
          bookingId: parsed.data.bookingId,
        });
      } catch (refundError) {
        // The booking stays refund_pending and is retried from the admin console.
        console.error("[cancel] refund call failed", refundError);
      }
    }
  }

  await notifyBooking(parsed.data.bookingId, "booking_cancelled");
  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/bookings");
  return { ok: true, data: { refundPaise } };
}
