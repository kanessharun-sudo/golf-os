import "server-only";

import { publicEnv } from "@/lib/env";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { NotificationChannel, Uuid } from "@/types/database";
import { DeliveryError, messagingChannel, sendEmail, sendSms, sendWhatsApp, type DeliveryResult } from "./channels";
import { messageParams, renderEmail, type BookingMessageContext, type BookingTemplate } from "./templates";

const MAX_ATTEMPTS = 3;

type Recipient = { channel: NotificationChannel; address: string };

/**
 * Sends one message per (channel, recipient) and records it in notification_log.
 * Safe to call repeatedly: sent rows are skipped, failed rows retry up to 3 times.
 * Never throws; a failed notification must not undo a paid booking.
 */
export async function notifyBooking(bookingId: Uuid, template: BookingTemplate): Promise<void> {
  try {
    await deliver(bookingId, template);
  } catch (error) {
    console.error(`[notify] ${template} for ${bookingId} failed`, error);
  }
}

async function deliver(bookingId: Uuid, template: BookingTemplate): Promise<void> {
  const admin = getSupabaseAdminClient();

  const { data: booking, error } = await admin
    .from("bookings")
    .select("id, booking_ref, course_id, booked_by, play_date, tee_time, start_hole, hole_format, player_count, total_paise, refund_paise, courses(name, slug)")
    .eq("id", bookingId)
    .single();
  if (error) throw new Error(`booking lookup: ${error.message}`);

  const [{ data: players }, { data: caddies }, { data: booker }] = await Promise.all([
    admin.from("booking_players").select("full_name, phone, email, is_booker").eq("booking_id", bookingId).order("seat_number"),
    admin
      .from("caddy_assignments")
      .select("caddies(full_name)")
      .eq("booking_id", bookingId)
      .in("status", ["confirmed", "completed", "cancelled"]),
    admin.auth.admin.getUserById(booking.booked_by),
  ]);

  const ctx: BookingMessageContext = {
    booking,
    course: booking.courses,
    players: (players ?? []).map((p) => p.full_name),
    caddies: (caddies ?? []).map((c) => c.caddies.full_name),
    siteUrl: publicEnv().NEXT_PUBLIC_SITE_URL,
  };

  const recipients = collectRecipients(
    template,
    { email: booker.user?.email ?? null, phone: booker.user?.phone ? `+${booker.user.phone.replace(/^\+/, "")}` : null },
    players ?? [],
  );

  for (const recipient of recipients) {
    const { data: existing } = await admin
      .from("notification_log")
      .upsert(
        { booking_id: bookingId, course_id: booking.course_id, channel: recipient.channel, template, recipient: recipient.address },
        { onConflict: "booking_id,channel,template,recipient", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    const { data: row } = existing
      ? await admin.from("notification_log").select("id, status, attempts").eq("id", existing.id).single()
      : await admin
          .from("notification_log")
          .select("id, status, attempts")
          .match({ booking_id: bookingId, channel: recipient.channel, template, recipient: recipient.address })
          .single();
    if (!row || row.status === "sent" || row.status === "skipped" || row.attempts >= MAX_ATTEMPTS) continue;

    let result: DeliveryResult;
    try {
      result = await send(recipient, template, ctx, row.id);
    } catch (sendError) {
      await admin
        .from("notification_log")
        .update({
          status: "failed",
          attempts: row.attempts + 1,
          last_error: sendError instanceof DeliveryError ? sendError.message : String(sendError).slice(0, 500),
        })
        .eq("id", row.id);
      continue;
    }

    await admin
      .from("notification_log")
      .update(
        result.status === "sent"
          ? { status: "sent", attempts: row.attempts + 1, provider_message_id: result.providerMessageId, sent_at: new Date().toISOString(), last_error: null }
          : { status: "skipped", last_error: result.reason },
      )
      .eq("id", row.id);
  }
}

function collectRecipients(
  template: BookingTemplate,
  booker: { email: string | null; phone: string | null },
  players: { email: string | null; phone: string | null; is_booker: boolean }[],
): Recipient[] {
  const emails = new Set<string>();
  const phones = new Set<string>();
  if (booker.email) emails.add(booker.email.toLowerCase());
  if (booker.phone) phones.add(booker.phone);
  // Guests hear about confirmations; only the booker hears about cancellations and refunds.
  if (template === "booking_confirmed") {
    for (const p of players) {
      if (p.email) emails.add(p.email.toLowerCase());
      if (p.phone) phones.add(p.phone);
    }
  }
  const phoneChannel = messagingChannel();
  return [
    ...[...emails].map((address) => ({ channel: "email" as const, address })),
    ...(phoneChannel ? [...phones].map((address) => ({ channel: phoneChannel, address })) : []),
  ];
}

function send(recipient: Recipient, template: BookingTemplate, ctx: BookingMessageContext, logId: Uuid): Promise<DeliveryResult> {
  const idempotencyKey = `notif-${logId}`;
  if (recipient.channel === "email") {
    return sendEmail({ to: recipient.address, ...renderEmail(template, ctx), idempotencyKey });
  }
  const body = { to: recipient.address, template, params: messageParams(ctx), idempotency_key: idempotencyKey };
  return recipient.channel === "whatsapp" ? sendWhatsApp(body) : sendSms(body);
}
