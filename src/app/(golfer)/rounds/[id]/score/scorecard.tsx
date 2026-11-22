"use client";

import { ChevronLeft, ChevronRight, CloudOff, Loader2, Minus, Plus, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { formatPlayDate } from "@/lib/dates";
import {
  loadLeaderboardAction,
  loadRoundAction,
  saveHoleScoresAction,
  submitRoundAction,
  type HoleScoreInput,
  type RoundSnapshot,
} from "@/lib/scoring/actions";
import {
  cappedStrokes,
  difficultyRank,
  MAX_STROKES,
  MIN_STROKES,
  strokesReceived,
  toParLabel,
  type HoleEntry,
  type ScoreHole,
} from "@/lib/scoring/model";
import { cn, formatTeeTime, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { HoleFormat, LeaderboardRow, RoundMode, RoundStatus } from "@/types/database";

export type ScorecardRound = {
  id: string;
  status: RoundStatus;
  mode: RoundMode;
  holeFormat: HoleFormat;
  courseId: string;
  courseName: string;
  courseSlug: string;
  bookingId: string;
  playDate: string;
  teeTime: string;
  teeName: string | null;
  tournamentName: string | null;
  holes: ScoreHole[];
};

export type ScorecardPlayer = {
  id: string;
  name: string;
  isMe: boolean;
  isGuest: boolean;
  courseHandicap: number | null;
  indexAtStart: number | null;
  grossScore: number | null;
  adjustedGross: number | null;
  netScore: number | null;
  differential: number | null;
  countsForHandicap: boolean;
};

type View = "hole" | "card" | "board";
type SyncState = "saved" | "saving" | "offline" | "error";
type Entries = Record<string, HoleEntry>;

const POLL_MS = 15_000;
const RETRY_MS = 20_000;
const SAVE_DEBOUNCE_MS = 500;

const key = (playerId: string, hole: number) => `${playerId}:${hole}`;

function entriesFrom(scores: RoundSnapshot["scores"]): Entries {
  const out: Entries = {};
  for (const s of scores) out[key(s.round_player_id, s.hole_number)] = { strokes: s.strokes, putts: s.putts, penalties: s.penalties };
  return out;
}

function storageKey(roundId: string) {
  return `golfos:round:${roundId}:pending`;
}

function readPending(roundId: string): Record<string, HoleScoreInput> {
  try {
    const raw = window.localStorage.getItem(storageKey(roundId));
    return raw ? (JSON.parse(raw) as Record<string, HoleScoreInput>) : {};
  } catch {
    return {};
  }
}

function writePending(roundId: string, pending: Record<string, HoleScoreInput>) {
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(storageKey(roundId));
    else window.localStorage.setItem(storageKey(roundId), JSON.stringify(pending));
  } catch {
    // Private mode or full storage: scores still save while online.
  }
}

const sameInput = (a: HoleScoreInput | undefined, b: HoleScoreInput) =>
  !!a && a.strokes === b.strokes && a.putts === b.putts && a.penalties === b.penalties;

export function Scorecard({
  round,
  players,
  initialScores,
  myHandicap,
}: {
  round: ScorecardRound;
  players: ScorecardPlayer[];
  initialScores: RoundSnapshot["scores"];
  myHandicap: { track: "9-hole" | "18-hole"; index: number | null; roundsCounted: number };
}) {
  const router = useRouter();
  const final = round.status === "completed" || round.status === "abandoned";
  const holes = round.holes;
  const holeCount = holes.length;

  const [view, setView] = useState<View>(final ? "card" : "hole");
  const [entries, setEntries] = useState<Entries>(() => entriesFrom(initialScores));
  const [pendingCount, setPendingCount] = useState(0);
  const [sync, setSync] = useState<SyncState>("saved");
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Record<string, HoleScoreInput>>({});
  const flushTimer = useRef<number | null>(null);
  const flushing = useRef(false);

  // First unscored hole, so reopening the card lands where the group is.
  const [holeIdx, setHoleIdx] = useState(() => {
    const idx = holes.findIndex((h) => players.some((p) => !entries[key(p.id, h.number)]));
    return idx === -1 ? holeCount - 1 : idx;
  });

  const received = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of players) {
      for (const h of holes) map.set(key(p.id, h.number), strokesReceived(p.courseHandicap, difficultyRank(holes, h), holeCount));
    }
    return map;
  }, [players, holes, holeCount]);

  const mergeSnapshot = useCallback((snapshot: RoundSnapshot) => {
    const server = entriesFrom(snapshot.scores);
    setEntries((current) => {
      const next: Entries = { ...server };
      // Local edits not yet confirmed by the server win.
      for (const k of Object.keys(pendingRef.current)) if (current[k]) next[k] = current[k];
      return next;
    });
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    const batch = { ...pendingRef.current };
    const inputs = Object.values(batch);
    if (inputs.length === 0) {
      setSync("saved");
      return;
    }
    flushing.current = true;
    setSync("saving");
    try {
      const result = await saveHoleScoresAction(round.id, inputs);
      if (result.ok) {
        for (const [k, sent] of Object.entries(batch)) {
          if (sameInput(pendingRef.current[k], sent)) delete pendingRef.current[k];
        }
        writePending(round.id, pendingRef.current);
        setPendingCount(Object.keys(pendingRef.current).length);
        mergeSnapshot(result.data);
        setError(null);
        setSync(Object.keys(pendingRef.current).length ? "saving" : "saved");
        if (result.data.status !== round.status) router.refresh();
      } else {
        // The server refused (e.g. the round was submitted on another phone): drop the queue.
        pendingRef.current = {};
        writePending(round.id, {});
        setPendingCount(0);
        setError(result.error);
        setSync("error");
        router.refresh();
      }
    } catch {
      setSync("offline");
    } finally {
      flushing.current = false;
    }
    if (Object.keys(pendingRef.current).length && navigator.onLine) {
      flushTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    }
  }, [mergeSnapshot, round.id, round.status, router]);

  // Restore anything queued on this phone before it lost signal.
  useEffect(() => {
    if (final) return;
    const saved = readPending(round.id);
    if (Object.keys(saved).length === 0) return;
    pendingRef.current = saved;
    setPendingCount(Object.keys(saved).length);
    setEntries((current) => {
      const next = { ...current };
      for (const [k, v] of Object.entries(saved)) next[k] = { strokes: v.strokes, putts: v.putts, penalties: v.penalties };
      return next;
    });
    void flush();
  }, [final, flush, round.id]);

  // Retry when the connection returns, and every 20 s while offline.
  useEffect(() => {
    if (final) return;
    const retry = () => void flush();
    window.addEventListener("online", retry);
    const timer = window.setInterval(() => {
      if (Object.keys(pendingRef.current).length) retry();
    }, RETRY_MS);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, [final, flush]);

  // Pick up scores entered on another phone in the group.
  useEffect(() => {
    if (final) return;
    const timer = window.setInterval(async () => {
      if (document.hidden || Object.keys(pendingRef.current).length || flushing.current) return;
      try {
        const result = await loadRoundAction(round.id);
        if (!result.ok) return;
        mergeSnapshot(result.data);
        if (result.data.status !== round.status) router.refresh();
      } catch {
        // Offline: the next tick tries again.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [final, mergeSnapshot, round.id, round.status, router]);

  function setEntry(playerId: string, hole: ScoreHole, entry: HoleEntry) {
    const k = key(playerId, hole.number);
    setEntries((current) => ({ ...current, [k]: entry }));
    pendingRef.current[k] = {
      roundPlayerId: playerId,
      holeNumber: hole.number,
      strokes: entry.strokes,
      putts: entry.putts,
      penalties: entry.penalties,
    };
    writePending(round.id, pendingRef.current);
    setPendingCount(Object.keys(pendingRef.current).length);
    setSync("saving");
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  const totals = useMemo(
    () =>
      players.map((p) => {
        let gross = 0;
        let adjusted = 0;
        let played = 0;
        let toPar = 0;
        let received_ = 0;
        for (const h of holes) {
          const e = entries[key(p.id, h.number)];
          if (!e) continue;
          const r = received.get(key(p.id, h.number)) ?? 0;
          played += 1;
          gross += e.strokes;
          adjusted += cappedStrokes(e.strokes, h.par, r, p.courseHandicap);
          toPar += e.strokes - h.par;
          received_ += r;
        }
        return { playerId: p.id, gross, adjusted, played, toPar, netToPar: toPar - received_ };
      }),
    [players, holes, entries, received],
  );
  const allComplete = totals.every((t) => t.played === holeCount);

  const hole = holes[holeIdx];

  return (
    <div className="mx-auto max-w-xl px-4 pb-32 pt-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-eyebrow uppercase text-brass-700">
            {round.courseName}
            {round.mode === "tournament" ? ` · ${round.tournamentName ?? "Tournament"}` : ""}
          </p>
          <p className="numerals mt-1 text-sm text-ink-muted">
            {formatPlayDate(round.playDate, "short")} · {formatTeeTime(round.teeTime)} · {HOLE_FORMAT_LABEL[round.holeFormat]}
            {round.teeName ? ` · ${round.teeName} tees` : ""}
          </p>
        </div>
        {!final ? <SyncBadge state={sync} pending={pendingCount} /> : null}
      </header>

      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      {final ? <ResultPanel round={round} players={players} myHandicap={myHandicap} /> : null}

      <nav className="mt-5 grid grid-cols-3 gap-1 rounded-card bg-alabaster-200 p-1 text-sm" aria-label="Scorecard views">
        {(
          [
            ["hole", "Hole", !final],
            ["card", "Card", true],
            ["board", "Leaderboard", round.mode === "tournament"],
          ] as const
        )
          .filter(([, , show]) => show)
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "h-10 rounded-[0.25rem] transition-colors",
                view === value ? "bg-card text-pine shadow-hairline" : "text-ink-muted hover:text-pine",
              )}
            >
              {label}
            </button>
          ))}
      </nav>

      {view === "hole" && hole && !final ? (
        <>
          <HoleStrip holes={holes} current={holeIdx} onPick={setHoleIdx} isDone={(h) => players.every((p) => !!entries[key(p.id, h.number)])} />
          <section className="mt-4 rounded-card bg-pine px-5 py-4 text-alabaster">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-eyebrow uppercase text-brass">Hole</p>
                <p className="numerals font-mono tracking-tight text-6xl leading-none">{hole.number}</p>
              </div>
              <dl className="numerals grid grid-cols-3 gap-5 text-right">
                <Stat label="Par" value={hole.par} />
                <Stat label="Index" value={hole.strokeIndex} />
                <Stat label="Yards" value={hole.yards ?? "—"} />
              </dl>
            </div>
          </section>

          <ul className="mt-4 space-y-3">
            {players.map((p, i) => (
              <PlayerRow
                key={p.id}
                player={p}
                hole={hole}
                entry={entries[key(p.id, hole.number)]}
                received={received.get(key(p.id, hole.number)) ?? 0}
                total={totals[i]}
                onChange={(entry) => setEntry(p.id, hole, entry)}
              />
            ))}
          </ul>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-alabaster-300 bg-alabaster-50/95 backdrop-blur">
            <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
              <Button variant="outline" size="lg" className="flex-1" disabled={holeIdx === 0} onClick={() => setHoleIdx((i) => i - 1)}>
                <ChevronLeft /> Hole {holes[holeIdx - 1]?.number ?? ""}
              </Button>
              {holeIdx < holeCount - 1 ? (
                <Button size="lg" className="flex-1" onClick={() => setHoleIdx((i) => i + 1)}>
                  Hole {holes[holeIdx + 1]?.number} <ChevronRight />
                </Button>
              ) : (
                <Button variant="brass" size="lg" className="flex-1" onClick={() => setView("card")}>
                  Review card
                </Button>
              )}
            </div>
          </div>
        </>
      ) : null}

      {view === "card" ? (
        <>
          <CardTable holes={holes} players={players} entries={entries} received={received} totals={totals} />
          {!final ? (
            <SubmitPanel
              roundId={round.id}
              allComplete={allComplete}
              missing={totals.reduce((n, t) => n + (holeCount - t.played), 0)}
              hasPending={pendingCount > 0}
              onDone={() => router.refresh()}
            />
          ) : null}
        </>
      ) : null}

      {view === "board" ? <Leaderboard courseId={round.courseId} playDate={round.playDate} myRoundId={round.id} /> : null}

      <p className="mt-10 text-center text-xs text-ink-faint">
        <Link href={`/bookings/${round.bookingId}`} className="hover:text-pine hover:underline">
          Back to booking
        </Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-eyebrow uppercase text-pine-200">{label}</dt>
      <dd className="text-2xl">{value}</dd>
    </div>
  );
}

function SyncBadge({ state, pending }: { state: SyncState; pending: number }) {
  if (state === "offline") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brass-100 px-3 py-1 text-xs text-brass-800">
        <CloudOff className="size-3.5" /> {pending} waiting for signal
      </span>
    );
  }
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-alabaster-200 px-3 py-1 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Saving
      </span>
    );
  }
  if (state === "error") return null;
  return <span className="rounded-full bg-pine-50 px-3 py-1 text-xs text-pine">Saved</span>;
}

function HoleStrip({
  holes,
  current,
  onPick,
  isDone,
}: {
  holes: ScoreHole[];
  current: number;
  onPick: (idx: number) => void;
  isDone: (hole: ScoreHole) => boolean;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [current]);
  return (
    <div className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none]">
      <ol className="flex gap-1.5">
        {holes.map((h, i) => {
          const done = isDone(h);
          return (
            <li key={h.number}>
              <button
                ref={i === current ? activeRef : undefined}
                type="button"
                onClick={() => onPick(i)}
                aria-current={i === current ? "step" : undefined}
                aria-label={`Hole ${h.number}${done ? ", scored" : ""}`}
                className={cn(
                  "numerals flex size-10 items-center justify-center rounded-full border text-sm transition-colors",
                  i === current
                    ? "border-brass bg-brass text-white"
                    : done
                      ? "border-pine/30 bg-pine-50 text-pine"
                      : "border-alabaster-300 bg-card text-ink-muted",
                )}
              >
                {h.number}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PlayerRow({
  player,
  hole,
  entry,
  received,
  total,
  onChange,
}: {
  player: ScorecardPlayer;
  hole: ScoreHole;
  entry: HoleEntry | undefined;
  received: number;
  total: { played: number; toPar: number; netToPar: number };
  onChange: (entry: HoleEntry) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const strokes = entry?.strokes ?? hole.par;
  const capped = entry ? cappedStrokes(entry.strokes, hole.par, received, player.courseHandicap) : null;
  const set = (next: Partial<HoleEntry>) =>
    onChange({ strokes, putts: entry?.putts ?? null, penalties: entry?.penalties ?? 0, ...next });

  return (
    <li className="rounded-card bg-card px-4 py-3 shadow-card">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-pine">
            {player.name}
            {player.isMe ? <span className="ml-1.5 text-xs font-normal text-ink-faint">You</span> : null}
          </p>
          <p className="numerals mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
            <span>{player.courseHandicap === null ? "No handicap" : `CH ${player.courseHandicap}`}</span>
            {received !== 0 ? (
              <span aria-label={`${received} stroke${Math.abs(received) === 1 ? "" : "s"} received`} className="flex gap-0.5">
                {Array.from({ length: Math.abs(received) }, (_, i) => (
                  <span key={i} className={cn("size-1.5 rounded-full", received > 0 ? "bg-brass" : "bg-destructive")} />
                ))}
              </span>
            ) : null}
            {total.played > 0 ? <span>{toParLabel(total.toPar)} thru {total.played}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StepButton label={`One fewer stroke for ${player.name}`} disabled={strokes <= MIN_STROKES} onClick={() => set({ strokes: strokes - 1 })}>
            <Minus />
          </StepButton>
          <button
            type="button"
            onClick={() => (entry ? setShowDetail((v) => !v) : set({ strokes: hole.par }))}
            aria-label={entry ? `${player.name}: ${strokes} strokes. Show putts and penalties` : `Record par for ${player.name}`}
            className={cn(
              "numerals relative flex size-14 items-center justify-center rounded-full font-mono tracking-tight text-3xl transition-colors",
              entry ? scoreTone(strokes - hole.par) : "border border-alabaster-300 text-ink-faint",
            )}
          >
            {strokes}
            {capped !== null && capped < strokes ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-brass px-1.5 text-[10px] font-sans text-white" title="Capped for handicap">
                {capped}
              </span>
            ) : null}
          </button>
          <StepButton label={`One more stroke for ${player.name}`} disabled={strokes >= MAX_STROKES} onClick={() => set({ strokes: strokes + 1 })}>
            <Plus />
          </StepButton>
        </div>
      </div>
      {entry && showDetail ? (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-alabaster-300 pt-3 text-sm">
          <MiniStepper label="Putts" value={entry.putts} min={0} max={10} onChange={(putts) => set({ putts })} />
          <MiniStepper label="Penalties" value={entry.penalties} min={0} max={10} onChange={(penalties) => set({ penalties: penalties ?? 0 })} />
        </div>
      ) : null}
    </li>
  );
}

function scoreTone(toPar: number): string {
  if (toPar <= -2) return "bg-brass-700 text-white";
  if (toPar === -1) return "bg-brass text-white";
  if (toPar === 0) return "bg-pine-50 text-pine";
  if (toPar === 1) return "bg-alabaster-200 text-ink";
  return "bg-alabaster-300 text-ink";
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-12 items-center justify-center rounded-full border border-pine/20 text-pine transition-colors active:bg-pine-50 disabled:opacity-30 [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

function MiniStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (value: number | null) => void;
}) {
  const current = value ?? 0;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-muted">{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={current <= min} onClick={() => onChange(current - 1)} className="size-8 rounded-full border border-pine/20 text-pine disabled:opacity-30">
          −
        </button>
        <span className="numerals w-5 text-center text-pine">{value ?? "–"}</span>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={current >= max} onClick={() => onChange(current + 1)} className="size-8 rounded-full border border-pine/20 text-pine disabled:opacity-30">
          +
        </button>
      </span>
    </div>
  );
}

function CardTable({
  holes,
  players,
  entries,
  received,
  totals,
}: {
  holes: ScoreHole[];
  players: ScorecardPlayer[];
  entries: Entries;
  received: Map<string, number>;
  totals: { playerId: string; gross: number; adjusted: number; played: number; toPar: number; netToPar: number }[];
}) {
  const par = holes.reduce((n, h) => n + h.par, 0);
  return (
    <div className="mt-5 overflow-x-auto rounded-card bg-card shadow-card">
      <table className="numerals w-full text-sm">
        <thead>
          <tr className="border-b border-alabaster-300 text-eyebrow uppercase text-ink-faint">
            <th className="px-3 py-2 text-left font-normal">Hole</th>
            <th className="px-2 py-2 text-center font-normal">Par</th>
            {players.map((p) => (
              <th key={p.id} className="max-w-24 truncate px-2 py-2 text-center font-normal" title={p.name}>
                {p.name.split(" ")[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holes.map((h) => (
            <tr key={h.number} className="border-b border-alabaster-200">
              <td className="px-3 py-1.5 text-pine">
                {h.number}
                <span className="ml-1.5 text-xs text-ink-faint">SI {h.strokeIndex}</span>
              </td>
              <td className="px-2 py-1.5 text-center text-ink-muted">{h.par}</td>
              {players.map((p) => {
                const e = entries[key(p.id, h.number)];
                const r = received.get(key(p.id, h.number)) ?? 0;
                const capped = e ? cappedStrokes(e.strokes, h.par, r, p.courseHandicap) : null;
                return (
                  <td key={p.id} className="px-2 py-1.5 text-center">
                    {e ? (
                      <span className={cn("inline-flex size-7 items-center justify-center rounded-full", scoreTone(e.strokes - h.par))}>
                        {e.strokes}
                      </span>
                    ) : (
                      <span className="text-ink-faint">·</span>
                    )}
                    {capped !== null && capped < (e?.strokes ?? 0) ? <sup className="ml-0.5 text-brass-700">{capped}</sup> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot className="text-pine">
          <tr className="border-t border-alabaster-300">
            <td className="px-3 py-2">Gross</td>
            <td className="px-2 py-2 text-center text-ink-muted">{par}</td>
            {totals.map((t) => (
              <td key={t.playerId} className="px-2 py-2 text-center font-medium">
                {t.played ? t.gross : "–"}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-ink-muted">To par</td>
            <td />
            {totals.map((t) => (
              <td key={t.playerId} className="px-2 py-1.5 text-center">
                {t.played ? toParLabel(t.toPar) : "–"}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-ink-muted">Net to par</td>
            <td />
            {totals.map((t, i) => (
              <td key={t.playerId} className="px-2 py-1.5 text-center">
                {t.played && players[i]?.courseHandicap !== null ? toParLabel(t.netToPar) : "–"}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-3 py-1.5 text-ink-muted">For handicap</td>
            <td />
            {totals.map((t, i) => (
              <td key={t.playerId} className="px-2 py-1.5 text-center">
                {t.played && !players[i]?.isGuest ? t.adjusted : "–"}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="px-3 py-2 text-xs text-ink-faint">
        Small brass numbers are the capped score used for handicaps (Net Double Bogey).
      </p>
    </div>
  );
}

function SubmitPanel({
  roundId,
  allComplete,
  missing,
  hasPending,
  onDone,
}: {
  roundId: string;
  allComplete: boolean;
  missing: number;
  hasPending: boolean;
  onDone: () => void;
}) {
  const [confirm, setConfirm] = useState<"submit" | "abandon" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(abandon: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await submitRoundAction(roundId, abandon);
      if (!result.ok) {
        setError(result.error);
        setConfirm(null);
        return;
      }
      onDone();
    });
  }

  return (
    <section className="mt-6 space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {hasPending ? <Notice>Some scores are still saving. Submit once the badge shows Saved.</Notice> : null}
      {!allComplete ? (
        <Notice>
          {missing} score{missing === 1 ? "" : "s"} still to enter before this round can be submitted.
        </Notice>
      ) : null}

      {confirm === "submit" ? (
        <div className="rounded-card border border-pine/20 p-4">
          <p className="text-sm text-pine">Submit the round? Scores lock and handicaps update. This cannot be undone.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirm(null)} disabled={pending}>
              Keep editing
            </Button>
            <Button className="flex-1" onClick={() => run(false)} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null} Submit
            </Button>
          </div>
        </div>
      ) : (
        <Button size="lg" variant="brass" className="w-full" disabled={!allComplete || hasPending} onClick={() => setConfirm("submit")}>
          Submit round
        </Button>
      )}

      {confirm === "abandon" ? (
        <div className="rounded-card border border-destructive/30 p-4">
          <p className="text-sm text-ink">Abandon the round? It stays on record but never counts for handicaps.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirm(null)} disabled={pending}>
              Back
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => run(true)} disabled={pending}>
              Abandon round
            </Button>
          </div>
        </div>
      ) : confirm === null ? (
        <button type="button" onClick={() => setConfirm("abandon")} className="w-full py-2 text-center text-sm text-ink-faint hover:text-destructive">
          Abandon round (weather, injury)
        </button>
      ) : null}
    </section>
  );
}

function ResultPanel({
  round,
  players,
  myHandicap,
}: {
  round: ScorecardRound;
  players: ScorecardPlayer[];
  myHandicap: { track: "9-hole" | "18-hole"; index: number | null; roundsCounted: number };
}) {
  if (round.status === "abandoned") {
    return (
      <Notice className="mt-4">This round was abandoned. Scores are kept for the record but do not count for handicaps.</Notice>
    );
  }
  const me = players.find((p) => p.isMe);
  const before = me?.indexAtStart ?? null;
  const change = before !== null && myHandicap.index !== null ? Math.round((myHandicap.index - before) * 10) / 10 : null;
  const needed = Math.max(0, 3 - myHandicap.roundsCounted);

  return (
    <section className="mt-4 rounded-card bg-pine px-5 py-5 text-alabaster">
      <p className="flex items-center gap-2 text-eyebrow uppercase text-brass">
        <Trophy className="size-4" /> Round submitted
      </p>
      {me ? (
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-pine-200">Your {myHandicap.track} handicap index</p>
            <p className="numerals font-mono tracking-tight text-5xl leading-tight">
              {myHandicap.index !== null ? myHandicap.index.toFixed(1) : "—"}
            </p>
            {change !== null ? (
              <p className="numerals text-sm text-pine-200">
                {change === 0 ? "No change" : change < 0 ? `Down ${Math.abs(change).toFixed(1)}` : `Up ${change.toFixed(1)}`} from {before?.toFixed(1)}
              </p>
            ) : needed > 0 ? (
              <p className="text-sm text-pine-200">
                {needed} more round{needed === 1 ? "" : "s"} until your first index (WHS needs 3).
              </p>
            ) : null}
          </div>
          {me.differential !== null ? (
            <div className="text-right">
              <p className="text-sm text-pine-200">Score differential</p>
              <p className="numerals font-mono tracking-tight text-3xl">{me.differential.toFixed(1)}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <ul className="numerals mt-4 space-y-1 border-t border-pine-700 pt-3 text-sm">
        {players.map((p) => (
          <li key={p.id} className="flex justify-between gap-3">
            <span>{p.name}</span>
            <span className="text-pine-200">
              {p.grossScore ?? "–"} gross{p.netScore !== null ? ` · ${p.netScore} net` : ""}
              {p.isGuest ? " · guest, no handicap" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Leaderboard({ courseId, playDate, myRoundId }: { courseId: string; playDate: string; myRoundId: string }) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await loadLeaderboardAction(courseId, playDate);
        if (cancelled) return;
        if (result.ok) {
          setRows(result.data);
          setError(null);
        } else setError(result.error);
      } catch {
        // Offline: keep the last board and try again on the next tick.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [courseId, playDate]);

  if (error) return <Notice tone="error" className="mt-5">{error}</Notice>;
  if (!rows) {
    return (
      <p className="mt-8 flex items-center justify-center gap-2 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" /> Loading leaderboard
      </p>
    );
  }

  return (
    <section className="mt-5 rounded-card bg-card shadow-card">
      <h2 className="flex items-center justify-between border-b border-alabaster-300 px-4 py-3 text-eyebrow uppercase text-ink-faint">
        <span>Tournament · {formatPlayDate(playDate, "short")}</span>
        <span>Net</span>
      </h2>
      <ol className="numerals divide-y divide-alabaster-200">
        {rows.map((r) => (
          <li key={r.round_player_id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", r.round_id === myRoundId && "bg-pine-50/60")}>
            <span className="w-6 text-ink-faint">{r.rank_position ?? "–"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-pine">{r.display_name}</span>
              <span className="text-xs text-ink-faint">
                {r.holes_played === 0
                  ? `Tees off ${formatTeeTime(r.tee_time)}`
                  : r.is_complete
                    ? `Finished · ${toParLabel(r.gross_to_par)} gross`
                    : `Thru ${r.holes_played} · ${toParLabel(r.gross_to_par)} gross`}
              </span>
            </span>
            <span className="font-display text-xl text-pine">{r.holes_played ? toParLabel(r.net_to_par) : ""}</span>
          </li>
        ))}
      </ol>
      <p className="px-4 py-2 text-xs text-ink-faint">Updates every 15 seconds. Ranked by net score to par.</p>
    </section>
  );
}
