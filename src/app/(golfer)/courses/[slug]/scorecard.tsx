import type { CourseHole, CourseTee, Uuid } from "@/types/database";
import { cn } from "@/lib/utils";

type Props = {
  holes: CourseHole[];
  tees: CourseTee[];
  yards: Record<Uuid, Record<number, number>>;
};

function sum(values: (number | undefined)[]): number | null {
  if (values.some((v) => v === undefined)) return null;
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

/** Classic two-nine card: 1–9 | OUT | 10–18 | IN | TOT. Tees without per-hole yardage are omitted. */
export function Scorecard({ holes, tees, yards }: Props) {
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number >= 10);
  const tees_with_yards = tees.filter((t) => Object.keys(yards[t.id] ?? {}).length > 0);

  const columns: ({ kind: "hole"; hole: CourseHole } | { kind: "total"; label: string; nine: CourseHole[] })[] = [
    ...front.map((hole) => ({ kind: "hole" as const, hole })),
    { kind: "total" as const, label: "Out", nine: front },
    ...back.map((hole) => ({ kind: "hole" as const, hole })),
    ...(back.length ? [{ kind: "total" as const, label: "In", nine: back }] : []),
    { kind: "total" as const, label: "Tot", nine: holes },
  ];

  const cell = "px-2.5 py-2 text-center";
  const totalCell = "bg-alabaster-200 font-medium text-pine";

  return (
    <div className="overflow-x-auto rounded-card bg-card shadow-card">
      <table className="numerals w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="bg-pine text-alabaster">
            <th scope="row" className="px-4 py-2.5 text-left text-eyebrow uppercase font-normal">
              Hole
            </th>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={cn(cell, "font-normal", c.kind === "total" && "bg-pine-700 text-brass")}>
                {c.kind === "hole" ? c.hole.hole_number : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-alabaster-300">
          {tees_with_yards.map((tee) => (
            <tr key={tee.id}>
              <th scope="row" className="px-4 py-2 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full ring-1 ring-pine/20"
                    style={{ backgroundColor: tee.color_hex ?? "#8C928D" }}
                  />
                  {tee.name}
                </span>
              </th>
              {columns.map((c, i) =>
                c.kind === "hole" ? (
                  <td key={i} className={cell}>
                    {yards[tee.id]?.[c.hole.hole_number] ?? "—"}
                  </td>
                ) : (
                  <td key={i} className={cn(cell, totalCell)}>
                    {sum(c.nine.map((h) => yards[tee.id]?.[h.hole_number])) ?? "—"}
                  </td>
                ),
              )}
            </tr>
          ))}
          <tr className="bg-pine-50/60">
            <th scope="row" className="px-4 py-2 text-left font-medium text-pine">
              Par
            </th>
            {columns.map((c, i) =>
              c.kind === "hole" ? (
                <td key={i} className={cn(cell, "font-medium text-pine")}>
                  {c.hole.par}
                </td>
              ) : (
                <td key={i} className={cn(cell, totalCell)}>
                  {sum(c.nine.map((h) => h.par))}
                </td>
              ),
            )}
          </tr>
          <tr>
            <th scope="row" className="px-4 py-2 text-left font-normal text-ink-muted">
              Stroke index
            </th>
            {columns.map((c, i) =>
              c.kind === "hole" ? (
                <td key={i} className={cn(cell, "text-ink-muted")}>
                  {c.hole.stroke_index}
                </td>
              ) : (
                <td key={i} className={cn(cell, "bg-alabaster-200")} />
              ),
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
