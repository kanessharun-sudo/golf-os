import "server-only";

import { randomBytes } from "node:crypto";
import { isDemoPayments } from "@/lib/env";
import { notifyBooking } from "@/lib/notifications/booking";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ConfirmPaymentResult, Json, Paise, Uuid } from "@/types/database";
import { capturePayment, createRefund, fetchPayment, RazorpayError } from "./razorpay";

export type SettleOutcome =
  | { status: "confirmed"; bookingId: Uuid }
  | { status: "refunded"; reason: Exclude<ConfirmPaymentResult, "confirmed" | "already_confirmed"> }
  | { status: "payment_not_captured" }
  | { status: "unknown_order" };

/**
 * Single path from "Razorpay says paid" to "booking exists or money goes back".
 * Called by the checkout callback and the webhook; both may race on one payment,
 * which the database makes safe (row lock on the hold, unique refund claim).
 */
export async function settlePayment(input: {
  orderId: string;
  paymentId: string;
  source: "checkout_callback" | "webhook";
  eventType: string;
  eventId?: string | null;
  signatureVerified: true;
  payload: Json;
}): Promise<SettleOutcome> {
  const admin = getSupabaseAdminClient();

  // Trust Razorpay's record of the payment, not the browser's.
  let payment = await fetchPayment(input.paymentId);
  if (payment.order_id !== input.orderId) {
    await logEvent(input, payment.amount, "order_mismatch");
    return { status: "unknown_order" };
  }
  if (payment.status === "authorized") {
    payment = await capturePayment(payment.id, payment.amount, payment.currency);
  }
  if (payment.status !== "captured") {
    await logEvent(input, payment.amount, `not_captured:${payment.status}`);
    return { status: "payment_not_captured" };
  }

  const { data, error } = await admin.rpc("confirm_hold_payment", {
    p_order_id: input.orderId,
    p_payment_id: payment.id,
    p_amount_paise: payment.amount,
  });
  if (error) {
    if (error.message === "order_not_found") {
      await logEvent(input, payment.amount, "order_not_found");
      return { status: "unknown_order" };
    }
    throw new Error(`confirm_hold_payment failed: ${error.message}`);
  }
  const row = data[0];
  if (!row) throw new Error("confirm_hold_payment returned no row");
  await logEvent(input, payment.amount, row.result);

  if (row.result === "confirmed" || row.result === "already_confirmed") {
    if (!row.booking_id) throw new Error("confirmed payment without booking id");
    if (row.result === "confirmed") await notifyBooking(row.booking_id, "booking_confirmed");
    return { status: "confirmed", bookingId: row.booking_id };
  }

  await refundOnce({
    paymentId: payment.id,
    orderId: input.orderId,
    amount: payment.amount,
    reason: row.result,
  });
  return { status: "refunded", reason: row.result };
}

/**
 * Claims the refund in payment_events (unique per payment) before calling
 * Razorpay, so a racing callback and webhook cannot refund twice. If Razorpay
 * rejects the call, the claim is released so the next delivery retries.
 */
export async function refundOnce(input: {
  paymentId: string;
  orderId: string | null;
  amount: Paise;
  reason: string;
  bookingId?: Uuid;
}): Promise<"refund_requested" | "already_claimed"> {
  const admin = getSupabaseAdminClient();
  const { data: claim, error } = await admin
    .from("payment_events")
    .insert({
      source: "refund",
      event_type: "refund.requested",
      razorpay_order_id: input.orderId,
      razorpay_payment_id: input.paymentId,
      signature_verified: true,
      amount_paise: input.amount,
      result: input.reason,
      payload: { reason: input.reason, booking_id: input.bookingId ?? null },
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "already_claimed";
    throw new Error(`refund claim failed: ${error.message}`);
  }

  if (isDemoPayments()) {
    // Demo mode: no gateway, so the refund settles the moment it is claimed.
    const refundId = `demo_rfnd_${randomBytes(7).toString("hex")}`;
    await admin
      .from("payment_events")
      .update({ result: `${input.reason}:processed`, payload: { reason: input.reason, refund_id: refundId, booking_id: input.bookingId ?? null, demo: true } })
      .eq("id", claim.id);
    if (input.bookingId) {
      await admin.rpc("mark_booking_refunded", { p_booking_id: input.bookingId, p_refund_id: refundId });
    }
    return "refund_requested";
  }

  try {
    const refund = await createRefund({
      paymentId: input.paymentId,
      amount: input.amount,
      receipt: `rf_${input.paymentId}`,
      notes: { reason: input.reason, ...(input.bookingId ? { booking_id: input.bookingId } : {}) },
    });
    await admin
      .from("payment_events")
      .update({ result: `${input.reason}:${refund.status}`, payload: { reason: input.reason, refund_id: refund.id, booking_id: input.bookingId ?? null } })
      .eq("id", claim.id);
    if (input.bookingId && refund.status === "processed") {
      await admin.rpc("mark_booking_refunded", { p_booking_id: input.bookingId, p_refund_id: refund.id });
    }
    return "refund_requested";
  } catch (refundError) {
    await admin.from("payment_events").delete().eq("id", claim.id);
    if (refundError instanceof RazorpayError) {
      throw new Error(`Razorpay refund failed (${refundError.status} ${refundError.code ?? ""}): ${refundError.message}`);
    }
    throw refundError;
  }
}

async function logEvent(
  input: { orderId: string; paymentId: string; source: "checkout_callback" | "webhook"; eventType: string; eventId?: string | null; payload: Json },
  amount: Paise,
  result: string,
): Promise<void> {
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from("payment_events").insert({
    source: input.source,
    event_type: input.eventType,
    razorpay_order_id: input.orderId,
    razorpay_payment_id: input.paymentId,
    // Webhook event ids are unique; replays are rejected earlier by the route.
    razorpay_event_id: input.eventId ?? null,
    signature_verified: true,
    amount_paise: amount,
    result,
    payload: input.payload,
  });
  if (error && error.code !== "23505") {
    console.error("[payments] could not log payment event", error);
  }
}

/**
 * Demo-mode settlement: the golfer pressed "Pay" on the simulated payment
 * screen. Runs the same confirm_hold_payment path a real capture would, with
 * a synthetic payment id, so slot locks, caddy re-arming and notifications are
 * exercised exactly as in production.
 */
export async function settleDemoPayment(input: { orderId: string; amount: Paise }): Promise<SettleOutcome> {
  if (!isDemoPayments()) throw new Error("settleDemoPayment called outside demo mode");
  const paymentId = `demo_pay_${randomBytes(7).toString("hex")}`;
  const event = {
    orderId: input.orderId,
    paymentId,
    source: "checkout_callback" as const,
    eventType: "demo.payment.captured",
    payload: { order_id: input.orderId, payment_id: paymentId, demo: true },
  };

  const { data, error } = await getSupabaseAdminClient().rpc("confirm_hold_payment", {
    p_order_id: input.orderId,
    p_payment_id: paymentId,
    p_amount_paise: input.amount,
  });
  if (error) {
    if (error.message === "order_not_found") return { status: "unknown_order" };
    throw new Error(`confirm_hold_payment failed: ${error.message}`);
  }
  const row = data[0];
  if (!row) throw new Error("confirm_hold_payment returned no row");
  await logEvent(event, input.amount, row.result);

  if (row.result === "confirmed" || row.result === "already_confirmed") {
    if (!row.booking_id) throw new Error("confirmed payment without booking id");
    if (row.result === "confirmed") await notifyBooking(row.booking_id, "booking_confirmed");
    return { status: "confirmed", bookingId: row.booking_id };
  }
  await refundOnce({ paymentId, orderId: input.orderId, amount: input.amount, reason: row.result });
  return { status: "refunded", reason: row.result };
}
