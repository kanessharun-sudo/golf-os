"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatPlayDate } from "@/lib/dates";
import { cn, formatPaise, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { HoleFormat, IsoDate, TeeSheetSlot } from "@/types/database";
import { clock, estimateFees, type CourseInfo, type FlightHandicaps, type Viewer } from "./model";

type Props = {
  slot: TeeSheetSlot | null;
  course: CourseInfo;
  viewer: Viewer;
  date: IsoDate;
  format: HoleFormat;
  players: number;
  onPlayersChange: (next: number) => void;
  caddies: boolean;
  onCaddiesChange: (next: boolean) => void;
  handicaps: FlightHandicaps | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (isPrivate: boolean) => void;
};

/** Slide-over summary for one tee time: right panel on wide screens, bottom sheet on phones. */
export function BookingDrawer(props: Props) {
  const { slot, onClose } = props;
  const reduce = useReducedMotion();
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!slot) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [slot, onClose]);

  const offscreen = reduce ? { opacity: 0 } : wide ? { x: "100%" } : { y: "100%" };
  const spring = reduce ? { duration: 0.15 } : { type: "spring" as const, bounce: 0, duration: 0.4 };

  return (
    <AnimatePresence>
      {slot ? (
        <div className="fixed inset-0 z-50" key="drawer">
          <motion.div
            className="absolute inset-0 bg-pine/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            initial={offscreen}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={offscreen}
            transition={spring}
            className={cn(
              "absolute flex flex-col overflow-y-auto border-alabaster-300 bg-alabaster-100",
              wide ? "inset-y-0 right-0 w-[28rem] border-l" : "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-[6px] border-t",
            )}
          >
            <DrawerBody {...props} slot={slot} />
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function DrawerBody({
  slot,
  course,
  viewer,
  date,
  format,
  players,
  onPlayersChange,
  caddies,
  onCaddiesChange,
  handicaps,
  pending,
  error,
  onClose,
  onConfirm,
}: Props & { slot: TeeSheetSlot }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  useEffect(() => closeRef.current?.focus(), []);

  const canBlock = slot.seats_taken === 0 && players >= 3;
  const maxPlayers = Math.min(course.maxPlayers, slot.seats_left);
  const fees = estimateFees({ course, viewer, slot, players, format, caddies });

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-alabaster-300 px-6 pb-6 pt-6">
        <div>
          <p className="text-sm text-ink-muted">{formatPlayDate(date)}</p>
          <h2 id="drawer-title" className="mt-2 font-mono text-5xl font-medium tabular-nums tracking-tight text-pine">
            {clock(slot.tee_time)}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {course.name} · {HOLE_FORMAT_LABEL[format]}
            {slot.start_hole === 10 ? ", from hole 10" : ""}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="text-sm text-ink-muted underline-offset-4 hover:text-pine hover:underline"
        >
          Close
        </button>
      </div>

      <dl className="divide-y divide-alabaster-300 border-b border-alabaster-300 px-6">
        <Row term="Players">
          <div className="flex items-center gap-1">
            <StepButton label="Fewer players" disabled={players <= 1} onClick={() => onPlayersChange(players - 1)}>
              −
            </StepButton>
            <output aria-live="polite" className="w-7 text-center font-mono text-lg tabular-nums text-pine">
              {players}
            </output>
            <StepButton label="More players" disabled={players >= maxPlayers} onClick={() => onPlayersChange(players + 1)}>
              +
            </StepButton>
          </div>
        </Row>

        <Row term="Flight">
          <span className="text-right text-sm text-pine">
            {slot.seats_taken === 0 ? (
              "Empty, you tee off first"
            ) : (
              <>
                Joining <span className="font-mono tabular-nums">{slot.seats_taken}</span>{" "}
                {handicaps ? (
                  <>
                    · HCP{" "}
                    <span className="font-mono tabular-nums">
                      {handicaps.min === handicaps.max ? handicaps.min.toFixed(1) : `${handicaps.min.toFixed(1)}–${handicaps.max.toFixed(1)}`}
                    </span>
                  </>
                ) : null}
              </>
            )}
          </span>
        </Row>

        <Row term="Your handicap index">
          {viewer ? (
            viewer.handicapIndex !== null ? (
              <span className="font-mono text-lg tabular-nums text-pine">{viewer.handicapIndex.toFixed(1)}</span>
            ) : (
              <span className="text-right text-sm text-ink-muted">
                None yet · <span className="font-mono tabular-nums">{viewer.roundsCounted}</span> of{" "}
                <span className="font-mono tabular-nums">3</span> rounds
              </span>
            )
          ) : (
            <span className="text-sm text-ink-muted">Shown after sign-in</span>
          )}
        </Row>

        {course.caddyFromPaise ? (
          <Row term="Caddies" hint={`Chosen at checkout, from ${formatPaise(course.caddyFromPaise)} each`}>
            <Switch checked={caddies} onChange={onCaddiesChange} label="Request caddies" />
          </Row>
        ) : null}

        {canBlock ? (
          <Row term={`Keep it a private ${players}-ball`} hint="No one else can join this flight">
            <Switch checked={isPrivate} onChange={setIsPrivate} label={`Keep it a private ${players}-ball`} />
          </Row>
        ) : null}
      </dl>

      <div className="px-6 py-6">
        <h3 className="font-sans text-sm font-normal text-ink-muted">Fees</h3>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {fees.lines.map((l) => (
              <tr key={l.label}>
                <td className="py-1.5 pr-3 text-pine">{l.label}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-pine">{formatPaise(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5 pr-3 text-ink-muted">Booking fee, {course.convenienceFeePercent}%</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink-muted">{formatPaise(fees.convenience)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t border-pine">
              <td className="pb-1 pt-3 text-pine">Estimated total</td>
              <td className="pb-1 pt-3 text-right font-mono text-2xl tabular-nums text-pine">{formatPaise(fees.total)}</td>
            </tr>
          </tfoot>
        </table>
        {fees.assumesGuests ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Counts your other players as guests. Members among them play free once you add their names.
          </p>
        ) : null}
      </div>

      <div className="mt-auto border-t border-alabaster-300 px-6 pb-6 pt-5">
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => onConfirm(canBlock && isPrivate)}
          className="flex h-12 w-full items-center justify-between rounded-[4px] bg-brass px-5 text-[15px] font-medium text-white transition-colors hover:bg-brass-600 disabled:opacity-60"
        >
          <span>{pending ? "Holding…" : viewer ? "Hold and continue to pay" : "Sign in to hold"}</span>
          <span className="font-mono tabular-nums">{clock(slot.tee_time)}</span>
        </button>
        <p className="mt-3 text-xs text-ink-muted">
          We hold the time for <span className="font-mono tabular-nums">{course.holdMinutes}</span> minutes while you add names and pay.
        </p>
      </div>
    </>
  );
}

function Row({ term, hint, children }: { term: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <dt>
        <span className="text-sm text-pine">{term}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span> : null}
      </dt>
      <dd className="shrink-0">{children}</dd>
    </div>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-[3px] border border-alabaster-300 font-mono text-pine transition-colors hover:border-pine/40 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-[3px] border transition-colors",
        checked ? "border-brass bg-brass" : "border-alabaster-400 bg-alabaster-200",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3.5 rounded-[2px] bg-alabaster-50 transition-transform duration-200 ease-quiet",
          checked ? "translate-x-[1.1rem]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
