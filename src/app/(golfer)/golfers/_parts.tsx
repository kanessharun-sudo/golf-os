import { formatPlayDate } from "@/lib/dates";
import type { GalleryItem, ProfileRound } from "@/lib/profile/data";
import { cn, HOLE_FORMAT_LABEL } from "@/lib/utils";
import type { HoleFormat } from "@/types/database";

/** Handicap index over time. Lower is better, so the chart's y axis is flipped. */
export function HandicapChart({ points, label }: { points: { at: string; index: number }[]; label: string }) {
  if (points.length === 0) return null;
  const w = 560;
  const h = 140;
  const pad = 24;
  const values = points.map((p) => p.index);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (points.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (points.length - 1));
  const y = (v: number) => pad + ((v - min) / span) * (h - pad * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <figure className="border border-alabaster-300 bg-card p-4">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="numerals font-sans text-3xl font-bold tracking-tight text-ink">{last.index.toFixed(1)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-32 w-full" role="img" aria-label={`${label}: from ${points[0].index.toFixed(1)} to ${last.index.toFixed(1)}`}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-pine" />
        {points.map((p, i) => (
          <circle key={p.at} cx={x(i)} cy={y(p.index)} r={i === points.length - 1 ? 4 : 2.5} className={i === points.length - 1 ? "fill-brass" : "fill-pine"} />
        ))}
        <text x={pad} y={h - 4} className="fill-ink-faint text-[11px]">
          {formatPlayDate(points[0].at.slice(0, 10), "short")}
        </text>
        <text x={w - pad} y={h - 4} textAnchor="end" className="fill-ink-faint text-[11px]">
          {formatPlayDate(last.at.slice(0, 10), "short")}
        </text>
      </svg>
    </figure>
  );
}

export function RoundsTable({ rounds }: { rounds: ProfileRound[] }) {
  if (rounds.length === 0) return <p className="text-sm text-ink-muted">No completed rounds yet.</p>;
  return (
    <div className="overflow-x-auto border border-alabaster-300 bg-card">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="border-b border-alabaster-300 text-xs text-ink-muted">
          <tr>
            <th className="px-4 py-3 font-normal">Date</th>
            <th className="px-4 py-3 font-normal">Course</th>
            <th className="px-4 py-3 text-right font-normal">Gross</th>
            <th className="px-4 py-3 text-right font-normal">Net</th>
            <th className="px-4 py-3 text-right font-normal">Differential</th>
          </tr>
        </thead>
        <tbody className="numerals">
          {rounds.map((r) => (
            <tr key={r.id} className="border-b border-alabaster-200 last:border-0">
              <td className="px-4 py-3">{r.date ? formatPlayDate(r.date.slice(0, 10), "short") : ""}</td>
              <td className="px-4 py-3">
                {r.course}
                <span className="block text-xs text-ink-faint">
                  {HOLE_FORMAT_LABEL[r.format as HoleFormat] ?? r.format}
                  {r.tournament ? ` · ${r.tournament}` : ""}
                </span>
              </td>
              <td className="px-4 py-3 text-right">{r.gross ?? "–"}</td>
              <td className="px-4 py-3 text-right">{r.net ?? "–"}</td>
              <td className="px-4 py-3 text-right">
                {r.differential !== null ? r.differential.toFixed(1) : "–"}
                {!r.counted ? <span className="block text-[0.65rem] text-ink-faint">not counted</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GalleryGrid({ photos, footer }: { photos: GalleryItem[]; footer?: (p: GalleryItem) => React.ReactNode }) {
  if (photos.length === 0) return <p className="text-sm text-ink-muted">No photos yet.</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((p) => (
        <li key={p.id} className="border border-alabaster-300 bg-card">
          {/* Signed URLs expire, so these bypass the image optimiser. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.caption ?? "Golf photo"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          {p.caption || footer ? (
            <div className="flex items-start justify-between gap-2 px-3 py-2 text-xs text-ink-muted">
              <span>{p.caption}</span>
              {footer?.(p)}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Last 20 gross scores, oldest on the left. Pine bars are the rounds that make up the index. */
export function RecentScoresChart({ rounds }: { rounds: ProfileRound[] }) {
  const shown = rounds.filter((r) => r.gross !== null).slice(0, 20).reverse();
  if (shown.length === 0) return <p className="text-sm text-ink-muted">Scores appear here after your first completed round.</p>;
  const max = Math.max(...shown.map((r) => r.gross ?? 0));
  const min = Math.min(...shown.map((r) => r.gross ?? 0));
  const floor = Math.max(0, min - 15);
  return (
    <figure className="border border-alabaster-300 bg-card p-5">
      <div className="flex h-56 items-end gap-1.5 sm:gap-3" role="img" aria-label={`Last ${shown.length} scores`}>
        {shown.map((r) => {
          const pct = 25 + (((r.gross ?? 0) - floor) / Math.max(1, max - floor)) * 75;
          const nine = r.format !== "full_18";
          return (
            <div key={r.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <span className="numerals text-xs font-medium text-ink sm:text-sm">{r.gross}</span>
              <div
                className={cn("mt-1 w-full max-w-8 rounded-t-[3px]", r.inIndex ? "bg-pine" : "bg-alabaster-400", nine && "opacity-60")}
                style={{ height: `${pct}%` }}
                title={`${r.course}, ${r.date.slice(0, 10)}${nine ? " (9 holes)" : ""}${r.differential !== null ? `, differential ${r.differential.toFixed(1)}` : ""}`}
              />
              <span className="numerals mt-1.5 hidden text-[0.6rem] text-ink-faint sm:block">
                {r.date ? formatPlayDate(r.date.slice(0, 10), "short").split(", ")[1] ?? "" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-4 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-pine" /> Counts towards the index
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-alabaster-400" /> Not counting
        </span>
        <span>Faded bars are 9-hole rounds.</span>
      </figcaption>
    </figure>
  );
}
