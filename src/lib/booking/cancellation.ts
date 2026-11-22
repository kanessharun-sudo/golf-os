import type { Booking, CancellationPolicy, Paise } from "@/types/database";

export type RefundPreview = {
  refundPaise: Paise;
  hoursBeforeTee: number;
  /** Hours-before threshold of the tier that applies; null when no refund applies. */
  tierHours: number | null;
};

/** Mirrors public.cancel_booking() so the UI can show the refund before the golfer commits. */
export function previewRefund(
  booking: Pick<
    Booking,
    "tee_starts_at" | "payment_status" | "green_fee_paise" | "tournament_addon_paise" | "caddy_fee_paise" | "convenience_fee_paise"
  >,
  policy: CancellationPolicy,
  now: Date = new Date(),
): RefundPreview {
  const hoursBeforeTee = (new Date(booking.tee_starts_at).getTime() - now.getTime()) / 3_600_000;
  const tier = [...policy.tiers]
    .filter((t) => t.min_hours_before <= hoursBeforeTee)
    .sort((a, b) => b.min_hours_before - a.min_hours_before)[0];

  if (!tier || booking.payment_status !== "paid" || hoursBeforeTee <= 0) {
    return { refundPaise: 0, hoursBeforeTee, tierHours: null };
  }

  const refundPaise =
    Math.floor(((booking.green_fee_paise + booking.tournament_addon_paise) * tier.green_fee_refund_percent) / 100) +
    Math.floor((booking.caddy_fee_paise * tier.caddy_fee_refund_percent) / 100) +
    (policy.refund_convenience_fee ? booking.convenience_fee_paise : 0);

  return { refundPaise, hoursBeforeTee, tierHours: tier.min_hours_before };
}

/** "Full refund of green and caddy fees if you cancel 24 hours or more before tee time." */
export function describePolicy(policy: CancellationPolicy): string[] {
  const lines = [...policy.tiers]
    .sort((a, b) => b.min_hours_before - a.min_hours_before)
    .map((t) => {
      const green = t.green_fee_refund_percent;
      const caddy = t.caddy_fee_refund_percent;
      const share =
        green === 100 && caddy === 100
          ? "Full refund of green and caddy fees"
          : `${green}% of green fees and ${caddy}% of caddy fees refunded`;
      return `${share} if you cancel ${t.min_hours_before} hours or more before tee time.`;
    });
  const minHours = Math.min(...policy.tiers.map((t) => t.min_hours_before));
  if (policy.tiers.length > 0) lines.push(`No refund inside ${minHours} hours.`);
  else lines.push("Bookings are non-refundable.");
  if (!policy.refund_convenience_fee) lines.push("The convenience fee is not refundable.");
  return lines;
}
