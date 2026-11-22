import { formatPlayDate } from "@/lib/dates";
import { HOLE_FORMAT_LABEL, formatPaise, formatTeeTime } from "@/lib/utils";
import type { Booking, Course, Paise } from "@/types/database";

export type BookingTemplate = "booking_confirmed" | "booking_cancelled";

export type BookingMessageContext = {
  booking: Pick<
    Booking,
    "id" | "booking_ref" | "play_date" | "tee_time" | "start_hole" | "hole_format" | "player_count" | "total_paise" | "refund_paise"
  >;
  course: Pick<Course, "name" | "slug">;
  players: string[];
  caddies: string[];
  siteUrl: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/** Short parameters for WhatsApp/SMS templates (DLT templates take positional variables). */
export function messageParams(ctx: BookingMessageContext): Record<string, string> {
  return {
    booking_ref: ctx.booking.booking_ref,
    course: ctx.course.name,
    date: formatPlayDate(ctx.booking.play_date, "short"),
    tee_time: formatTeeTime(ctx.booking.tee_time),
    start_hole: String(ctx.booking.start_hole),
    format: HOLE_FORMAT_LABEL[ctx.booking.hole_format],
    players: String(ctx.booking.player_count),
    total: formatPaise(ctx.booking.total_paise),
    refund: formatPaise(ctx.booking.refund_paise),
    link: `${ctx.siteUrl}/bookings/${ctx.booking.id}`,
  };
}

export function renderEmail(template: BookingTemplate, ctx: BookingMessageContext): { subject: string; html: string; text: string } {
  const p = messageParams(ctx);
  const confirmed = template === "booking_confirmed";
  const subject = confirmed
    ? `Tee time confirmed · ${p.course} · ${p.date}, ${p.tee_time}`
    : `Booking cancelled · ${p.course} · ${p.date}, ${p.tee_time}`;

  const rows: [string, string][] = [
    ["Booking", p.booking_ref],
    ["Date", formatPlayDate(ctx.booking.play_date)],
    ["Tee time", `${p.tee_time} from hole ${p.start_hole}`],
    ["Format", p.format],
    ["Players", ctx.players.join(", ")],
    ...(ctx.caddies.length ? ([["Caddies", ctx.caddies.join(", ")]] as [string, string][]) : []),
    confirmed ? ["Paid", p.total] : ["Refund", refundLine(ctx.booking.refund_paise)],
  ];

  const lead = confirmed
    ? "Your tee time is booked. Please reach the starter's hut 20 minutes before your tee time."
    : "Your booking has been cancelled.";

  const html = `<!doctype html><html><body style="margin:0;background:#F7F5F0;font-family:Inter,Arial,sans-serif;color:#1A1F1C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FDFCFA;border-radius:6px;overflow:hidden">
<tr><td style="background:#0B2B1E;padding:28px 32px;color:#F7F5F0">
<div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#C5A059">${escapeHtml(p.course)}</div>
<div style="font-family:Georgia,serif;font-size:28px;margin-top:8px">${confirmed ? "Tee time confirmed" : "Booking cancelled"}</div>
</td></tr>
<tr><td style="padding:28px 32px">
<p style="margin:0 0 20px;font-size:15px;line-height:22px">${escapeHtml(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;font-variant-numeric:tabular-nums">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid #E2DCCF;color:#5B625D;width:110px">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid #E2DCCF;color:#0B2B1E">${escapeHtml(v)}</td></tr>`,
  )
  .join("")}
</table>
<p style="margin:28px 0 0"><a href="${escapeHtml(p.link)}" style="display:inline-block;background:#0B2B1E;color:#F7F5F0;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px">View booking</a></p>
</td></tr></table></td></tr></table></body></html>`;

  const text = [subject, "", lead, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", p.link].join("\n");
  return { subject, html, text };
}

function refundLine(refund: Paise): string {
  return refund > 0 ? `${formatPaise(refund)} to your original payment method in 5–7 working days` : "Not eligible under the course policy";
}
