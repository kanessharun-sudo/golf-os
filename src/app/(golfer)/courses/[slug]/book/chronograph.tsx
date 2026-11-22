"use client";

import { formatPlayDate } from "@/lib/dates";
import { cn, formatPaise, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { HoleFormat, IsoDate, TeeSheetSlot } from "@/types/database";
import { blockedReason, clock, estimateFees, slotKey, type CourseInfo, type FlightHandicaps, type Viewer } from "./model";

type Props = {
  className?: string;
  course: CourseInfo;
  viewer: Viewer;
  date: IsoDate;
  format: HoleFormat;
  players: number;
  caddies: boolean;
  onCaddiesChange: (next: boolean) => void;
  slots: TeeSheetSlot[];
  windowLabel: string;
  handicaps: Record<string, FlightHandicaps>;
  selected: string | null;
  onSelect: (slot: TeeSheetSlot) => void;
};

/**
 * The tee sheet as a timetable: one row per hour, one column per tee interval,
 * each cell a flight with its four places drawn as open and taken marks.
 */
export function Chronograph(props: Props) {
  const { className, course, date, format, players, caddies, onCaddiesChange, slots, windowLabel } = props;

  const minutes = [...new Set(slots.map((s) => s.tee_time.slice(3, 5)))].sort();
  const hours = [...new Set(slots.map((s) => s.tee_time.slice(0, 2)))].sort();
  const byKey = new Map(slots.map((s) => [s.tee_time.slice(0, 5), s]));
  const open = slots.filter((s) => blockedReason(s, players) === null).length;

  return (
    <section className={className} aria-labelledby="sheet-title">
      <header className="flex flex-col gap-4 border-b border-pine pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="sheet-title" className="font-display text-3xl font-normal tracking-[-0.02em] text-pine">
            {windowLabel} tee sheet
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {formatPlayDate(date)} · {HOLE_FORMAT_LABEL[format]}
            {format === "back_9" ? ", from hole 10" : ""} ·{" "}
            <span className="font-mono tabular-nums text-pine">{open}</span> of{" "}
            <span className="font-mono tabular-nums">{slots.length}</span> flights take {players}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5" aria-hidden>
            <Dot state="taken" /> Taken
            <Dot state="open" className="ml-2" /> Open
            <Dot state="yours" className="ml-2" /> Your party
          </span>
          {course.caddyFromPaise ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-pine">
              <button
                type="button"
                role="switch"
                aria-checked={caddies}
                onClick={() => onCaddiesChange(!caddies)}
                className={cn(
                  "relative h-5 w-9 rounded-[3px] border transition-colors",
                  caddies ? "border-brass bg-brass" : "border-alabaster-400 bg-alabaster-200",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-3.5 rounded-[2px] bg-alabaster-50 transition-transform duration-200 ease-quiet",
                    caddies ? "translate-x-[1.1rem]" : "translate-x-0.5",
                  )}
                />
              </button>
              Caddies
            </label>
          ) : null}
        </div>
      </header>

      {slots.length === 0 ? (
        <p className="border-b border-alabaster-300 py-16 text-center text-ink-muted">No tee times in this window.</p>
      ) : (
        <>
          {/* Wide screens: hour × interval matrix */}
          <table className="hidden w-full border-collapse md:table">
            <caption className="sr-only">
              Tee times by hour. Columns are minutes past the hour.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="w-20 py-2 text-left text-xs font-normal text-ink-muted">
                  Hour
                </th>
                {minutes.map((m) => (
                  <th key={m} scope="col" className="border-l border-alabaster-300 py-2 pl-4 text-left font-mono text-xs font-normal tabular-nums text-ink-muted">
                    :{m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h} className="border-t border-alabaster-300">
                  <th scope="row" className="py-4 pr-4 text-left align-top font-mono text-3xl font-normal tabular-nums leading-none text-pine">
                    {h}
                  </th>
                  {minutes.map((m) => {
                    const slot = byKey.get(`${h}:${m}`);
                    return (
                      <td key={m} className="border-l border-alabaster-300 p-0 align-top">
                        {slot ? <Flight {...props} slot={slot} /> : <span className="block h-full min-h-28" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phones: one ruled line per flight */}
          <ul className="md:hidden">
            {slots.map((slot) => (
              <li key={slotKey(slot)} className="border-b border-alabaster-300">
                <Flight {...props} slot={slot} compact />
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-muted">
        Fees are for your party of <span className="font-mono tabular-nums">{players}</span> before the{" "}
        <span className="font-mono tabular-nums">{course.convenienceFeePercent}%</span> booking fee.
        {course.guestFeePaise !== null && props.viewer?.isMember !== true ? " Members play free; membership is checked when you add names." : ""}{" "}
        Handicap ranges show only golfers with an index. The sheet updates every 45 seconds.
      </p>
    </section>
  );
}

function Flight({
  slot,
  compact = false,
  course,
  viewer,
  format,
  players,
  caddies,
  handicaps,
  selected,
  onSelect,
}: Props & { slot: TeeSheetSlot; compact?: boolean }) {
  const reason = blockedReason(slot, players);
  const isSelected = selected === slotKey(slot);
  const hcp = handicaps[slotKey(slot)];
  const fee = estimateFees({ course, viewer, slot, players, format, caddies }).subtotal;
  const taken = slot.seats_taken;
  const marks = Array.from({ length: course.maxPlayers }, (_, i) =>
    i < taken ? "taken" : isSelected && i < taken + players ? "yours" : "open",
  ) as DotState[];
  const status = reason ?? `${slot.seats_left} open`;
  const label = `${clock(slot.tee_time)}, ${taken} of ${course.maxPlayers} places taken, ${reason ? reason : `${slot.seats_left} open`}${
    hcp ? `, handicaps ${hcp.min} to ${hcp.max}` : ""
  }${reason ? "" : `, ${formatPaise(fee)} for your party`}`;

  return (
    <button
      type="button"
      disabled={reason !== null}
      aria-label={label}
      aria-pressed={isSelected}
      onClick={() => onSelect(slot)}
      className={cn(
        "group relative w-full text-left transition-colors duration-150",
        compact ? "grid grid-cols-[4.25rem_1fr_auto] items-center gap-x-3 px-1 py-3.5" : "flex min-h-28 flex-col gap-2 px-4 py-3.5",
        reason ? "cursor-not-allowed text-ink-faint" : "text-pine hover:bg-alabaster-50",
        isSelected && "bg-alabaster-50 shadow-[inset_3px_0_0_0_#B05E36]",
      )}
    >
      <span className={cn("font-mono tabular-nums tracking-tight", compact ? "text-xl" : "text-lg", isSelected && "text-brass-600")}>
        {clock(slot.tee_time)}
      </span>

      <span className={cn("flex flex-col gap-1.5", compact && "min-w-0")}>
        <span className="flex items-center gap-1" aria-hidden>
          {marks.map((m, i) => (
            <Dot key={i} state={reason && m === "open" ? "void" : m} />
          ))}
          <span className={cn("ml-1.5 text-xs", reason ? "text-ink-faint" : "text-ink-muted")}>{status}</span>
        </span>
        {hcp ? (
          <span className="w-fit rounded-[2px] border border-alabaster-300 px-1.5 py-px font-mono text-[11px] tabular-nums text-ink-muted">
            HCP {hcp.min === hcp.max ? hcp.min.toFixed(1) : `${hcp.min.toFixed(1)}–${hcp.max.toFixed(1)}`}
          </span>
        ) : null}
      </span>

      {reason ? null : (
        <span className={cn("font-mono text-sm tabular-nums", compact ? "text-right" : "mt-auto", isSelected ? "text-brass-600" : "text-pine")}>
          {fee === 0 ? "₹0" : formatPaise(fee)}
        </span>
      )}
    </button>
  );
}

type DotState = "taken" | "open" | "yours" | "void";

function Dot({ state, className }: { state: DotState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        state === "taken" && "bg-pine-500",
        state === "open" && "border border-pine-500",
        state === "yours" && "bg-brass",
        state === "void" && "border border-alabaster-400",
        className,
      )}
    />
  );
}
