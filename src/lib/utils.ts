import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import type { HoleFormat, IsoTime, Paise } from "@/types/database";

/** Teaches tailwind-merge the custom font sizes so `text-eyebrow` is not dropped next to `text-ink-muted`. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["eyebrow", "display-sm", "display-md", "display-lg"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** 120000 paise -> "₹1,200". Rounds to whole rupees for display only. */
export function formatPaise(amount: Paise): string {
  return inrFormatter.format(amount / 100);
}

/** "05:00:00" -> "5:00 AM" (course-local wall clock; no timezone conversion). */
export function formatTeeTime(time: IsoTime): string {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new RangeError(`Invalid tee time: ${time}`);
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minuteText} ${suffix}`;
}

export const HOLE_FORMAT_LABEL: Record<HoleFormat, string> = {
  front_9: "Front 9",
  back_9: "Back 9",
  full_18: "18 Holes",
};
