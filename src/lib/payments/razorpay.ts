import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { publicEnv, serverEnv } from "@/lib/env";
import type { Paise } from "@/types/database";

const API_BASE = "https://api.razorpay.com/v1";

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

export type RazorpayOrder = { id: string; amount: Paise; currency: string; receipt: string | null; status: string };
export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: Paise;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  email: string | null;
  contact: string | null;
};
export type RazorpayRefund = { id: string; payment_id: string; amount: Paise; status: "pending" | "processed" | "failed" };

function requireSecret(value: string | undefined, name: string): string {
  if (!value) throw new RazorpayError(`${name} is not configured`, 500, "not_configured");
  return value;
}

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: Record<string, unknown> }): Promise<T> {
  const keyId = requireSecret(publicEnv().NEXT_PUBLIC_RAZORPAY_KEY_ID, "NEXT_PUBLIC_RAZORPAY_KEY_ID");
  const keySecret = requireSecret(serverEnv().RAZORPAY_KEY_SECRET, "RAZORPAY_KEY_SECRET");
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error?: { code?: string; description?: string } }
    | null;
  if (!response.ok || !payload) {
    const err = (payload as { error?: { code?: string; description?: string } } | null)?.error;
    throw new RazorpayError(err?.description ?? `Razorpay ${init.method} ${path} failed`, response.status, err?.code);
  }
  return payload as T;
}

export function createOrder(input: {
  amount: Paise;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  return call<RazorpayOrder>("/orders", {
    method: "POST",
    body: { amount: input.amount, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: input.notes, payment_capture: 1 },
  });
}

export function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}

export function capturePayment(paymentId: string, amount: Paise, currency: string): Promise<RazorpayPayment> {
  return call<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST",
    body: { amount, currency },
  });
}

export function createRefund(input: {
  paymentId: string;
  amount: Paise;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayRefund> {
  return call<RazorpayRefund>(`/payments/${encodeURIComponent(input.paymentId)}/refund`, {
    method: "POST",
    body: { amount: input.amount, speed: "normal", receipt: input.receipt.slice(0, 40), notes: input.notes },
  });
}

function hmacEquals(secret: string | undefined, message: string, signature: string): boolean {
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checkout handler signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  return hmacEquals(serverEnv().RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  return hmacEquals(serverEnv().RAZORPAY_WEBHOOK_SECRET, rawBody, signature);
}
