import "server-only";

import { serverEnv } from "@/lib/env";

export type DeliveryResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "skipped"; reason: string };

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<DeliveryResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { status: "skipped", reason: "email not configured" };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    throw new DeliveryError(`Resend ${response.status}: ${payload?.message ?? "request failed"}`);
  }
  return { status: "sent", providerMessageId: payload?.id ?? null };
}

/**
 * WhatsApp and SMS go through provider-agnostic webhooks (Gupshup, Interakt,
 * MSG91 …). The receiver maps `template` to its approved template/DLT id.
 */
async function postMessageWebhook(
  url: string | undefined,
  token: string | undefined,
  body: { to: string; template: string; params: Record<string, string>; idempotency_key: string },
): Promise<DeliveryResult> {
  if (!url) return { status: "skipped", reason: "channel not configured" };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Idempotency-Key": body.idempotency_key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new DeliveryError(`Message webhook ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as { id?: string; message_id?: string } | null;
  return { status: "sent", providerMessageId: payload?.message_id ?? payload?.id ?? null };
}

export function sendWhatsApp(body: { to: string; template: string; params: Record<string, string>; idempotency_key: string }) {
  const env = serverEnv();
  return postMessageWebhook(env.WHATSAPP_WEBHOOK_URL, env.WHATSAPP_WEBHOOK_TOKEN, body);
}

export function sendSms(body: { to: string; template: string; params: Record<string, string>; idempotency_key: string }) {
  const env = serverEnv();
  return postMessageWebhook(env.SMS_WEBHOOK_URL, env.SMS_WEBHOOK_TOKEN, body);
}

export function messagingChannel(): "whatsapp" | "sms" | null {
  const env = serverEnv();
  if (env.WHATSAPP_WEBHOOK_URL) return "whatsapp";
  if (env.SMS_WEBHOOK_URL) return "sms";
  return null;
}
