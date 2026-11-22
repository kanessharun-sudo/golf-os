import type { Metadata } from "next";
import { requireAdminCourse } from "@/lib/admin/course";
import { addDays, courseToday, formatPlayDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPaise, formatTeeTime } from "@/lib/utils";
import type { Uuid } from "@/types/database";
import Link from "next/link";
import { PageHead, Stats } from "../_ui/parts";
import { CaddyForm, type CaddyFormValues } from "./caddie-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Caddies · Club office" };

const GRADE: Record<string, string> = { grade_a: "Grade A", grade_b: "Grade B", grade_c: "Grade C" };

export default async function AdminCaddiesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const course = await requireAdminCourse("/admin/caddies");
  const today = courseToday(course.timezone);
  const supabase = await getSupabaseServerClient();

  const [{ data: caddies, error }, { data: assignments, error: aError }] = await Promise.all([
    supabase
      .from("caddies")
      .select("id, caddy_code, full_name, phone, grade, daily_rate_18_paise, daily_rate_9_paise, rating, is_available, is_active, profile_id")
      .eq("course_id", course.id)
      .order("caddy_code"),
    supabase
      .from("caddy_assignments")
      .select("caddy_id, rate_paise, checked_in_at, status, bookings!inner(play_date, tee_time, status)")
      .eq("course_id", course.id)
      .in("status", ["confirmed", "completed"])
      .gte("bookings.play_date", addDays(today, -30))
      .lte("bookings.play_date", addDays(today, 7)),
  ]);
  if (error) throw new Error(`Caddies lookup failed: ${error.message}`);

  const editing = edit === "new" ? null : caddies.find((c) => c.id === edit);
  const formValues: CaddyFormValues | null =
    edit === "new"
      ? { caddyId: null, fullName: "", caddyCode: "", phone: "", grade: "grade_b", rate18: 600, rate9: 400, isActive: true }
      : editing
        ? {
            caddyId: editing.id,
            fullName: editing.full_name,
            caddyCode: editing.caddy_code,
            phone: editing.phone ?? "",
            grade: editing.grade,
            rate18: editing.daily_rate_18_paise / 100,
            rate9: editing.daily_rate_9_paise / 100,
            isActive: editing.is_active,
          }
        : null;
  if (aError) throw new Error(`Assignments lookup failed: ${aError.message}`);

  const byCaddy = new Map<Uuid, { today: { time: string; in: boolean }[]; week: number; earned: number }>();
  for (const a of assignments) {
    const row = byCaddy.get(a.caddy_id) ?? { today: [], week: 0, earned: 0 };
    const b = a.bookings;
    if (b.status === "cancelled" || b.status === "refunded") continue;
    if (b.play_date === today) row.today.push({ time: b.tee_time, in: a.checked_in_at !== null });
    if (b.play_date >= today) row.week += 1;
    if (b.play_date <= today) row.earned += a.rate_paise;
    byCaddy.set(a.caddy_id, row);
  }
  const all = [...byCaddy.values()];

  return (
    <>
      <PageHead title="Caddies" detail={`${caddies.length} caddies · ${formatPlayDate(today)}`}>
        <Link href="/admin/caddies?edit=new" className="text-sm text-pine underline-offset-4 hover:underline">
          Add a caddie
        </Link>
      </PageHead>
      {formValues ? <CaddyForm key={edit} courseId={course.id} values={formValues} /> : null}
      <Stats
        items={[
          { label: "Out today", value: String(all.reduce((n, r) => n + r.today.length, 0)) },
          { label: "Checked in", value: String(all.reduce((n, r) => n + r.today.filter((t) => t.in).length, 0)) },
          { label: "Next 7 days", value: String(all.reduce((n, r) => n + r.week, 0)) },
          { label: "Caddie fees, 30 days", value: formatPaise(all.reduce((n, r) => n + r.earned, 0)) },
        ]}
      />
      <div className="mt-6 overflow-x-auto border border-alabaster-300 bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-alabaster-300 text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-normal">Caddie</th>
              <th className="px-4 py-3 font-normal">Grade</th>
              <th className="px-4 py-3 font-normal">Today</th>
              <th className="px-4 py-3 text-right font-normal">Next 7 days</th>
              <th className="px-4 py-3 text-right font-normal">Earned, 30 days</th>
              <th className="px-4 py-3 font-normal">App</th>
              <th className="px-4 py-3 font-normal" />
            </tr>
          </thead>
          <tbody>
            {caddies.map((c) => {
              const r = byCaddy.get(c.id);
              return (
                <tr key={c.id} className="border-b border-alabaster-200 last:border-0">
                  <td className="px-4 py-3">
                    {c.full_name}
                    <span className="numerals ml-2 text-xs text-ink-faint">{c.caddy_code}</span>
                    {!c.is_active ? <span className="ml-2 text-xs text-destructive">Inactive</span> : null}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {GRADE[c.grade] ?? c.grade} · {formatPaise(c.daily_rate_18_paise)}
                  </td>
                  <td className="numerals px-4 py-3">
                    {r?.today.length
                      ? r.today.map((t) => (
                          <span key={t.time} className="mr-2 inline-block">
                            {formatTeeTime(t.time)}
                            {t.in ? <span className="ml-1 text-xs text-brass-700">✓</span> : null}
                          </span>
                        ))
                      : <span className="text-ink-faint">Free</span>}
                  </td>
                  <td className="numerals px-4 py-3 text-right">{r?.week ?? 0}</td>
                  <td className="numerals px-4 py-3 text-right">{formatPaise(r?.earned ?? 0)}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.profile_id ? "Signed in" : "Not set up"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/admin/caddies?edit=${c.id}`} className="text-xs text-pine underline-offset-4 hover:underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </>
  );
}
