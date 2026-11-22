import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyCheckoutSignature } from "@/lib/payments/razorpay";
import { settlePayment } from "@/lib/payments/settle";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Razorpay Checkout success handler. The webhook settles the same payment if this call never arrives. */
export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = parsed.data;

  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // The order must belong to this golfer's hold.
  const { data: hold } = await supabase.from("slot_holds").select("id").eq("razorpay_order_id", orderId).maybeSingle();
  if (!hold) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  try {
    const outcome = await settlePayment({
      orderId,
      paymentId,
      source: "checkout_callback",
      eventType: "checkout.success",
      signatureVerified: true,
      payload: { order_id: orderId, payment_id: paymentId },
    });
    return NextResponse.json(outcome);
  } catch (error) {
    console.error("[payments/verify] settlement failed", error);
    // The webhook will retry; tell the client to poll the booking instead of paying again.
    return NextResponse.json({ status: "pending" }, { status: 202 });
  }
}
