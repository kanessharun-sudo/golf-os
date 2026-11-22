import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/types/database";

const STYLE: Record<BookingStatus, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-pine text-alabaster" },
  checked_in: { label: "Checked in", className: "bg-pine-500 text-alabaster" },
  completed: { label: "Played", className: "bg-alabaster-200 text-pine" },
  cancelled: { label: "Cancelled", className: "bg-alabaster-200 text-ink-muted" },
  refunded: { label: "Refunded", className: "bg-brass-100 text-brass-800" },
  no_show: { label: "No-show", className: "bg-destructive/10 text-destructive" },
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { label, className } = STYLE[status];
  return <span className={cn("rounded-full px-2.5 py-1 text-eyebrow uppercase", className)}>{label}</span>;
}
