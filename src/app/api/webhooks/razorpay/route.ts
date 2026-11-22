import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";
import { settlePayment } from "@/lib/payments/settle";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

type PaymentEntity = { id: string; order_id: string | null; amount: number; status: string };
type RefundEntity = { id: string; payment_id: string; amount: number; status: string };
type WebhookEvent = {
  event: string;
  payload: {
    payment?: { entity: PaymentEntity };
    refund?: { entity: RefundEntity };
  };
};

const SETTLE_EVENTS = new Set(["payment.captured", "payment.authorized", "order.paid"]);

/**
 * Razorpay webhook. Configure events: payment.authorized, payment.captured,
 * order.paid, refund.processed. Any non-2xx makes Razorpay retry.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const eventId = request.headers.get("x-razorpay-event-id");
  const admin = getSupabaseAdminClient();

  if (eventId) {
    const { data: seen } = await admin.from("payment_events").select("id").eq("razorpay_event_id", eventId).maybeSingle();
    if (seen) return NextResponse.json({ status: "duplicate" });
  }

  try {
    if (SETTLE_EVENTS.has(event.event)) {
      const payment = event.payload.payment?.entity;
      if (!payment?.order_id) return NextResponse.json({ status: "ignored" });
      const outcome = await settlePayment({
        orderId: payment.order_id,
        paymentId: payment.id,
        source: "webhook",
        eventType: event.event,
        eventId,
        signatureVerified: true,
        payload: JSON.parse(rawBody) as Json,
      });
      return NextResponse.json(outcome);
    }

    if (event.event === "refund.processed") {
      const refund = event.payload.refund?.entity;
      if (!refund) return NextResponse.json({ status: "ignored" });
      const { data: booking } = await admin
        .from("bookings")
        .select("id, payment_status")
        .eq("razorpay_payment_id", refund.payment_id)
        .maybeSingle();
      if (booking?.payment_status === "refund_pending") {
        const { error } = await admin.rpc("mark_booking_refunded", { p_booking_id: booking.id, p_refund_id: refund.id });
        if (error) throw new Error(error.message);
      }
      await admin.from("payment_events").insert({
        source: "webhook",
        event_type: event.event,
        razorpay_payment_id: refund.payment_id,
        razorpay_event_id: eventId,
        signature_verified: true,
        amount_paise: refund.amount,
        result: booking ? "booking_refunded" : "refund_without_booking",
        payload: JSON.parse(rawBody) as Json,
      });
      return NextResponse.json({ status: "ok" });
    }

    return NextResponse.json({ status: "ignored" });
  } catch (error) {
    console.error(`[webhooks/razorpay] ${event.event} failed`, error);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
