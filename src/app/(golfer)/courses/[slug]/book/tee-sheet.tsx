"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Lock, Minus, Plus, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Notice } from "@/components/ui/notice";
import { acquireHoldAction } from "@/lib/booking/actions";
import { formatPlayDate } from "@/lib/dates";
import { cn, formatPaise, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { HoleFormat, IsoDate, TeeSheetSlot, TeeSheetUnavailableReason, Uuid } from "@/types/database";

export type DateOption = { date: IsoDate; closed: boolean };

type Props = {
  course: {
    id: Uuid;
    slug: string;
    name: string;
    holesCount: number;
    maxPlayers: number;
    holdMinutes: number;
    allowJoin: boolean;
    /** Flat non-member fee when the course prices members and guests separately. */
    guestFeePaise: number | null;
  };
  dates: DateOption[];
  date: IsoDate;
  format: HoleFormat;
  players: number;
  slots: TeeSheetSlot[];
  signedIn: boolean;
};

const REASON_LABEL: Record<TeeSheetUnavailableReason, string> = {
  course_closed_on_date: "Closed",
  beyond_booking_window: "Not open yet",
  tee_time_in_past: "Gone",
  inside_booking_cutoff: "Closed online",
  private_four_ball: "Blocked",
  slot_full: "Full",
  open_batch_join_disabled: "Taken",
};

const PERIODS = [
  { label: "Early", until: "07:00:00" },
  { label: "Morning", until: "10:00:00" },
  { label: "Midday", until: "13:00:00" },
  { label: "Afternoon", until: "24:00:00" },
] as const;

function slotAllows(slot: TeeSheetSlot, format: HoleFormat): boolean {
  if (format === "full_18") return slot.allows_full_18;
  if (format === "front_9") return slot.allows_front_9;
  return slot.allows_back_9;
}

export function TeeSheet({ course, dates, date, format, players, slots, signedIn }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [isPrivate, setIsPrivate] = useState(false);
  const [pendingTime, setPendingTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dateStrip = useRef<HTMLDivElement>(null);

  const formats: HoleFormat[] = course.holesCount === 18 ? ["full_18", "front_9", "back_9"] : ["front_9"];

  // Keep the selected date in view on load.
  useEffect(() => {
    dateStrip.current?.querySelector<HTMLElement>("[aria-current='date']")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [date]);

  // Seat counts move while golfers book; refresh every 45 s while the tab is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [router]);

  function navigate(next: Partial<{ date: IsoDate; format: HoleFormat; players: number }>) {
    const params = new URLSearchParams({
      date: next.date ?? date,
      format: next.format ?? format,
      players: String(next.players ?? players),
    });
    setError(null);
    startNavigation(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const visible = useMemo(
    () => slots.filter((s) => (format === "back_9" ? s.start_hole === 10 : s.start_hole === 1) && slotAllows(s, format)),
    [slots, format],
  );

  const grouped = useMemo(() => {
    let start = 0;
    return PERIODS.map((period) => {
      const items = visible.filter((s, i) => i >= start && s.tee_time < period.until);
      start += items.length;
      return { label: period.label, items };
    }).filter((g) => g.items.length > 0);
  }, [visible]);

  async function choose(slot: TeeSheetSlot) {
    setError(null);
    const params = new URLSearchParams({ date, format, players: String(players) });
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`);
      return;
    }
    setPendingTime(slot.tee_time);
    const result = await acquireHoldAction({
      courseId: course.id,
      playDate: date,
      teeTime: slot.tee_time,
      holeFormat: format,
      seats: players,
      isPrivate,
    });
    if (!result.ok) {
      setPendingTime(null);
      setError(result.error);
      router.refresh();
      return;
    }
    router.push(`/checkout/${result.data.holdId}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
      <p className="text-eyebrow uppercase text-brass-700">{course.name}</p>
      <h1 className="mt-3 font-display text-display-sm text-pine">Choose a tee time</h1>

      {/* Date strip */}
      <div ref={dateStrip} className="-mx-5 mt-8 flex gap-2 overflow-x-auto px-5 pb-2" role="tablist" aria-label="Play date">
        {dates.map((d) => {
          const active = d.date === date;
          const [weekday, day, month] = formatPlayDate(d.date, "short").replace(",", "").split(" ");
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={active}
              aria-current={active ? "date" : undefined}
              disabled={d.closed}
              onClick={() => navigate({ date: d.date })}
              className={cn(
                "numerals flex w-16 shrink-0 flex-col items-center rounded-card border py-2.5 transition-colors",
                active ? "border-brass bg-brass text-white" : "border-alabaster-300 bg-card text-pine hover:border-pine/40",
                d.closed && "cursor-not-allowed bg-transparent text-ink-faint",
              )}
            >
              <span className="text-eyebrow uppercase">{weekday}</span>
              <span className="font-display text-2xl leading-7">{day}</span>
              <span className="text-[0.65rem] uppercase tracking-wider">{d.closed ? "Closed" : month}</span>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div role="radiogroup" aria-label="Holes" className="flex gap-1 rounded-card bg-alabaster-200 p-1">
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={f === format}
              onClick={() => navigate({ format: f })}
              className={cn(
                "h-9 rounded-[0.25rem] px-4 text-sm transition-colors",
                f === format ? "bg-card text-pine shadow-hairline" : "text-ink-muted hover:text-pine",
              )}
            >
              {HOLE_FORMAT_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-card border border-alabaster-300 bg-card p-1">
          <button
            type="button"
            aria-label="Fewer players"
            disabled={players <= (isPrivate ? 3 : 1)}
            onClick={() => navigate({ players: players - 1 })}
            className="grid size-9 place-items-center rounded-[0.25rem] text-pine hover:bg-pine-50 disabled:opacity-30"
          >
            <Minus className="size-4" />
          </button>
          <span className="numerals flex min-w-24 items-center justify-center gap-1.5 text-sm text-pine" aria-live="polite">
            <Users className="size-4" aria-hidden />
            {isPrivate ? `${players}-ball` : `${players} player${players > 1 ? "s" : ""}`}
          </span>
          <button
            type="button"
            aria-label="More players"
            disabled={players >= course.maxPlayers}
            onClick={() => navigate({ players: players + 1 })}
            className="grid size-9 place-items-center rounded-[0.25rem] text-pine hover:bg-pine-50 disabled:opacity-30"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => {
              setIsPrivate(e.target.checked);
              if (e.target.checked && players < 3) navigate({ players: Math.min(4, course.maxPlayers) });
            }}
            className="size-4 accent-pine"
          />
          <Lock className="size-3.5" aria-hidden />
          Block the slot as a 3-ball or 4-ball
        </label>

        {navigating ? <Loader2 className="size-4 animate-spin text-ink-faint" aria-label="Loading" /> : null}
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        {formatPlayDate(date)} · {HOLE_FORMAT_LABEL[format]}
        {format === "back_9" ? " (tees off on hole 10)" : ""}. Seats are held for {course.holdMinutes} minutes while you pay.
        {course.guestFeePaise !== null ? ` Members play free; guests pay ${formatPaise(course.guestFeePaise)} each.` : ""}
      </p>

      {error ? (
        <Notice tone="error" className="mt-6">
          {error}
        </Notice>
      ) : null}

      {/* Slots */}
      <div className={cn("mt-8 space-y-10 transition-opacity", navigating && "opacity-50")}>
        {grouped.length === 0 ? (
          <p className="rounded-card border border-alabaster-400 p-10 text-center text-ink-muted">
            No {HOLE_FORMAT_LABEL[format].toLowerCase()} tee times on this date.
          </p>
        ) : (
          grouped.map((group) => (
            <section key={group.label}>
              <h2 className="text-eyebrow uppercase text-ink-faint">{group.label}</h2>
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <AnimatePresence initial={false}>
                  {group.items.map((slot) => {
                    const wanted = players;
                    const blockedReason: string | null = slot.unavailable_reason
                      ? REASON_LABEL[slot.unavailable_reason]
                      : isPrivate && slot.seats_taken > 0
                        ? "Shared"
                        : slot.seats_left < wanted
                          ? `${slot.seats_left} left`
                          : null;
                    const price = format === "full_18" ? slot.price_18_paise : slot.price_9_paise;
                    const busy = pendingTime === slot.tee_time;
                    return (
                      <motion.li key={`${slot.tee_time}-${slot.start_hole}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <button
                          type="button"
                          disabled={blockedReason !== null || pendingTime !== null}
                          onClick={() => void choose(slot)}
                          className={cn(
                            "numerals group w-full rounded-card border p-3.5 text-left transition-all duration-200 ease-quiet",
                            blockedReason
                              ? "cursor-not-allowed border-alabaster-300 bg-alabaster-200/60 text-ink-faint"
                              : "border-alabaster-300 bg-card text-pine shadow-hairline hover:-translate-y-0.5 hover:border-brass hover:shadow-card",
                          )}
                        >
                          <span className="flex items-center justify-between">
                            <span className="font-mono tracking-tight text-2xl">{formatTeeTime(slot.tee_time)}</span>
                            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                          </span>
                          <span className="mt-2 flex items-center gap-1" aria-label={`${slot.seats_left} of ${course.maxPlayers} seats free`}>
                            {Array.from({ length: course.maxPlayers }, (_, i) => (
                              <span
                                key={i}
                                className={cn(
                                  "size-2 rounded-full",
                                  i < slot.seats_taken ? "bg-ink-faint/50" : blockedReason ? "bg-alabaster-400" : "bg-brass",
                                )}
                              />
                            ))}
                            {slot.seats_taken > 0 && !slot.is_private_locked && !blockedReason ? (
                              <span className="ml-1 text-[0.65rem] uppercase tracking-wider text-ink-muted">Open group</span>
                            ) : null}
                          </span>
                          <span className="mt-2 block text-xs">
                            {blockedReason ??
                              (course.guestFeePaise !== null ? `Guests ${formatPaise(course.guestFeePaise)}` : `${formatPaise(price)} / player`)}
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
