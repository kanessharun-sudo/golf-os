"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Notice } from "@/components/ui/notice";
import { acquireHoldAction } from "@/lib/booking/actions";
import { addDays, formatPlayDate, isoWeekday } from "@/lib/dates";
import { cn, formatPaise } from "@/lib/utils";
import type { HoleFormat, IsoDate, TeeSheetSlot } from "@/types/database";
import { BookingDrawer } from "./booking-drawer";
import { Chronograph } from "./chronograph";
import {
  blockedReason,
  clock,
  slotAllows,
  slotKey,
  windowOf,
  WINDOWS,
  type CourseInfo,
  type DateOption,
  type FlightHandicaps,
  type Viewer,
  type WindowId,
} from "./model";

export type { DateOption } from "./model";

type Props = {
  course: CourseInfo;
  courses: { slug: string; name: string }[];
  dates: DateOption[];
  today: IsoDate;
  date: IsoDate;
  format: HoleFormat;
  players: number;
  slots: TeeSheetSlot[];
  handicaps: Record<string, FlightHandicaps>;
  viewer: Viewer;
};

export function TeeSheet({ course, courses, dates, today, date, format, players: initialPlayers, slots, handicaps, viewer }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [players, setPlayers] = useState(initialPlayers);
  const [caddies, setCaddies] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seat counts move while golfers book; refresh every 45 s while the tab is visible and no slot is open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && selected === null) router.refresh();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [router, selected]);

  function navigate(next: Partial<{ date: IsoDate; format: HoleFormat; slug: string }>) {
    const params = new URLSearchParams({ date: next.date ?? date, format: next.format ?? format, players: String(players) });
    const base = next.slug ? `/courses/${next.slug}/book` : pathname;
    setError(null);
    setSelected(null);
    startNavigation(() => router.push(`${base}?${params.toString()}`, { scroll: false }));
  }

  const visible = useMemo(
    () => slots.filter((s) => (format === "back_9" ? s.start_hole === 10 : s.start_hole === 1) && slotAllows(s, format)),
    [slots, format],
  );

  // Open on the first window that still has a tee time this party can take.
  const [windowId, setWindowId] = useState<WindowId>(() => {
    const firstFree = visible.find((s) => blockedReason(s, initialPlayers) === null);
    return firstFree ? windowOf(firstFree.tee_time) : "morning";
  });
  useEffect(() => {
    const firstFree = visible.find((s) => blockedReason(s, players) === null);
    if (firstFree) setWindowId(windowOf(firstFree.tee_time));
    // Only when the day or format changes, not on every player-count change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, format]);

  const windows = WINDOWS.map((w) => {
    const inWindow = visible.filter((s) => windowOf(s.tee_time) === w.id);
    const open = inWindow.filter((s) => blockedReason(s, players) === null).length;
    const range = inWindow.length ? `${clock(inWindow[0]!.tee_time)}–${clock(inWindow[inWindow.length - 1]!.tee_time)}` : "None";
    return { ...w, range, open, empty: inWindow.length === 0 };
  });

  const slot = selected ? (visible.find((s) => slotKey(s) === selected) ?? null) : null;

  async function confirm(isPrivate: boolean) {
    if (!slot) return;
    setError(null);
    if (!viewer) {
      const params = new URLSearchParams({ date, format, players: String(players) });
      router.push(`/login?next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`);
      return;
    }
    setPending(true);
    const result = await acquireHoldAction({
      courseId: course.id,
      playDate: date,
      teeTime: slot.tee_time,
      holeFormat: format,
      seats: players,
      isPrivate,
    });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      router.refresh();
      return;
    }
    router.push(`/checkout/${result.data.holdId}`);
  }

  const quick = quickDates(dates, today);
  const nextOpenDate = dates.find((d) => d.date > date && !d.closed)?.date ?? null;
  const nine = format !== "full_18";

  return (
    <div className="overflow-x-clip">
      {/* Editorial hero: type left, photograph bleeding off the right edge */}
      <section className="mx-auto grid max-w-6xl gap-8 px-5 pt-10 md:grid-cols-12 md:items-end md:pt-16">
        <div className="md:col-span-5 md:pb-24">
          <p className="text-sm text-ink-muted">
            {course.name}, {course.city}
          </p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,6.2vw,5rem)] font-normal leading-[0.95] tracking-[-0.02em] text-pine">
            Reserve a<br />
            tee time
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-ink-muted">
            First tee at <span className="font-mono tabular-nums text-pine">{clock(course.firstTee)}</span>.{" "}
            {course.guestFeePaise !== null ? (
              <>
                Members play free. Guests pay <span className="font-mono tabular-nums text-pine">{formatPaise(course.guestFeePaise)}</span>{" "}
                each.
              </>
            ) : (
              "Green fees are shown per flight."
            )}{" "}
            A chosen time is held for {course.holdMinutes} minutes while you pay.
          </p>
        </div>
        <figure className="md:col-span-7 md:mr-[calc(-1*max(0px,(100vw-72rem)/2)-1.25rem)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static poster, no optimisation needed */}
          <img
            src={course.heroImage}
            alt="A fairway lined with tall trees in early morning mist"
            className="h-48 w-full object-cover sm:h-80 md:h-[26rem]"
          />
          <figcaption className="mt-2 px-0.5 text-[11px] text-ink-faint">Fairway at first light. Illustrative image, AI-generated.</figcaption>
        </figure>
      </section>

      {/* Reservation strip */}
      <div className="mx-auto max-w-6xl px-5">
        <div
          className={cn(
            "relative z-10 mt-6 grid border border-alabaster-300 bg-alabaster-50 md:-mt-16",
            "grid-cols-2 [&>*]:border-alabaster-300 [&>*:not(:first-child)]:border-t",
            "lg:grid-cols-[minmax(11rem,1fr)_auto_auto_auto_auto] lg:[&>*:not(:first-child)]:border-l lg:[&>*:not(:first-child)]:border-t-0",
          )}
        >
          <Segment label="Course" wide>
            <div className="relative">
              <select
                aria-label="Course"
                value={course.slug}
                onChange={(e) => navigate({ slug: e.target.value })}
                className="w-full appearance-none truncate bg-transparent pr-5 text-[15px] font-medium text-pine focus:outline-none"
              >
                {courses.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Caret />
            </div>
          </Segment>

          <Segment label="Date" wide>
            <div className="flex flex-wrap items-center gap-1">
              {quick.map((q) => (
                <Choice key={q.label} active={q.date === date} disabled={q.closed} onClick={() => navigate({ date: q.date })}>
                  {q.label}
                </Choice>
              ))}
              <div className="relative">
                <select
                  aria-label="Other date"
                  value={quick.some((q) => q.date === date) ? "" : date}
                  onChange={(e) => e.target.value && navigate({ date: e.target.value })}
                  className={cn(
                    "h-8 appearance-none rounded-[3px] bg-transparent pl-2 pr-6 text-sm focus:outline-none",
                    quick.some((q) => q.date === date) ? "text-ink-muted" : "bg-alabaster-200 text-pine shadow-[inset_0_0_0_1px_rgb(24_22_20/0.35)]",
                  )}
                >
                  <option value="">Other date</option>
                  {dates.map((d) => (
                    <option key={d.date} value={d.date} disabled={d.closed}>
                      {formatPlayDate(d.date, "short")}
                      {d.closed ? " (closed)" : ""}
                    </option>
                  ))}
                </select>
                <Caret />
              </div>
            </div>
          </Segment>

          <Segment label="Window" wide>
            <div className="grid grid-cols-3 gap-1 lg:flex" role="radiogroup" aria-label="Time window">
              {windows.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="radio"
                  aria-checked={w.id === windowId}
                  disabled={w.empty}
                  onClick={() => setWindowId(w.id)}
                  className={cn(
                    "rounded-[3px] px-2 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    w.id === windowId ? "bg-alabaster-200 shadow-[inset_0_0_0_1px_rgb(24_22_20/0.35)]" : "hover:bg-alabaster-200/60",
                  )}
                >
                  <span className="block whitespace-nowrap text-sm text-pine">{w.label}</span>
                  <span className="block whitespace-nowrap font-mono text-[11px] tabular-nums text-ink-muted">{w.range}</span>
                </button>
              ))}
            </div>
          </Segment>

          <Segment label="Holes">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Holes">
              <Choice active={!nine} onClick={() => navigate({ format: "full_18" })} mono disabled={course.holesCount !== 18}>
                18H
              </Choice>
              <Choice active={nine} onClick={() => !nine && navigate({ format: "front_9" })} mono>
                9H
              </Choice>
              {nine && course.holesCount === 18 ? (
                <select
                  aria-label="Which nine"
                  value={format}
                  onChange={(e) => navigate({ format: e.target.value as HoleFormat })}
                  className="ml-1 h-8 appearance-none bg-transparent text-sm text-ink-muted underline decoration-alabaster-400 underline-offset-4 focus:outline-none"
                >
                  <option value="front_9">from 1</option>
                  <option value="back_9">from 10</option>
                </select>
              ) : null}
            </div>
          </Segment>

          <Segment label="Players" className="border-l lg:border-l">
            <div className="flex items-center gap-1">
              <Stepper label="Fewer players" disabled={players <= 1} onClick={() => setPlayers((p) => p - 1)}>
                −
              </Stepper>
              <output aria-live="polite" className="w-7 text-center font-mono text-lg tabular-nums text-pine">
                {players}
              </output>
              <Stepper label="More players" disabled={players >= course.maxPlayers} onClick={() => setPlayers((p) => p + 1)}>
                +
              </Stepper>
            </div>
          </Segment>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-20">
        {error ? (
          <Notice tone="error" className="mt-6">
            {error}
          </Notice>
        ) : null}

        {visible.length > 0 && !visible.some((s) => blockedReason(s, players) === null) ? (
          <div className="mt-10 flex flex-wrap items-baseline justify-between gap-3 border-y border-alabaster-300 py-4 text-sm">
            <span className="text-pine">No tee time on {formatPlayDate(date)} takes a party of {players}.</span>
            {nextOpenDate ? (
              <button type="button" onClick={() => navigate({ date: nextOpenDate })} className="text-brass-600 underline-offset-4 hover:underline">
                See {formatPlayDate(nextOpenDate, "short")}
              </button>
            ) : null}
          </div>
        ) : null}

        <Chronograph
          className={cn("mt-14 transition-opacity", navigating && "opacity-50")}
          course={course}
          viewer={viewer}
          date={date}
          format={format}
          players={players}
          caddies={caddies}
          onCaddiesChange={setCaddies}
          slots={visible.filter((s) => windowOf(s.tee_time) === windowId)}
          windowLabel={windows.find((w) => w.id === windowId)!.label}
          handicaps={handicaps}
          selected={selected}
          onSelect={(s) => {
            setError(null);
            setSelected(slotKey(s));
          }}
        />
      </div>

      <BookingDrawer
        slot={slot}
        course={course}
        viewer={viewer}
        date={date}
        format={format}
        players={players}
        onPlayersChange={setPlayers}
        caddies={caddies}
        onCaddiesChange={setCaddies}
        handicaps={slot ? (handicaps[slotKey(slot)] ?? null) : null}
        pending={pending}
        error={error}
        onClose={() => {
          if (!pending) setSelected(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}

/** Today, Tomorrow and the coming weekend day; the select covers the rest of the window. */
function quickDates(dates: DateOption[], today: IsoDate) {
  const find = (d: IsoDate) => dates.find((x) => x.date === d);
  const out: { label: string; date: IsoDate; closed: boolean }[] = [];
  const t = find(today);
  if (t) out.push({ label: "Today", ...t });
  const tm = find(addDays(today, 1));
  if (tm) out.push({ label: "Tomorrow", ...tm });
  const weekend = dates.find((d) => d.date > addDays(today, 1) && isoWeekday(d.date) >= 6 && !d.closed);
  if (weekend) out.push({ label: `${isoWeekday(weekend.date) === 6 ? "Sat" : "Sun"} ${Number(weekend.date.slice(8))}`, ...weekend });
  return out;
}

function Segment({
  label,
  wide = false,
  className,
  children,
}: {
  label: string;
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-3", wide && "col-span-2 lg:col-span-1", className)}>
      <p className="mb-1.5 text-xs text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

function Choice({
  active,
  disabled,
  mono,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  mono?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 rounded-[3px] px-2.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        mono && "font-mono tabular-nums",
        active ? "bg-alabaster-200 text-pine shadow-[inset_0_0_0_1px_rgb(24_22_20/0.35)]" : "text-ink-muted hover:text-pine",
      )}
    >
      {children}
    </button>
  );
}

function Stepper({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-[3px] border border-alabaster-300 font-mono text-base text-pine transition-colors hover:border-pine/40 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Caret() {
  return (
    <svg aria-hidden viewBox="0 0 10 6" className="pointer-events-none absolute right-1 top-1/2 h-1.5 w-2.5 -translate-y-1/2 text-ink-muted">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
