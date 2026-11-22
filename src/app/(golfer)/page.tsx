import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPaise, formatTeeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await getSupabaseServerClient();
  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, slug, name, tagline, area, city, holes_count, first_tee_time, pricing, course_tees(par_18, total_yards, is_default)")
    .eq("is_published", true)
    .order("name");

  if (error) {
    throw new Error(`Could not load courses: ${error.message}`);
  }

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
      <p className="text-eyebrow uppercase text-brass-700">Members&apos; tee sheet</p>
      <h1 className="mt-4 max-w-3xl text-display-sm sm:text-display-lg">
        Unhurried mornings on India&apos;s heritage fairways.
      </h1>
      <div className="rule-brass mt-10 max-w-xs" />

      <ul className="mt-12 grid gap-6 sm:grid-cols-2">
        {courses.map((course) => {
          const tee = course.course_tees.find((t) => t.is_default) ?? course.course_tees[0];
          return (
            <li key={course.id} className="animate-fade-up">
              <Link
                href={`/courses/${course.slug}`}
                className="block rounded-card bg-card p-8 shadow-card transition-shadow duration-300 ease-quiet hover:shadow-brass"
              >
              <p className="text-eyebrow uppercase text-ink-muted">
                {[course.area, course.city].filter(Boolean).join(" · ")}
              </p>
              <h2 className="mt-3 text-3xl">{course.name}</h2>
              {course.tagline ? <p className="mt-2 text-ink-muted">{course.tagline}</p> : null}
              <dl className="numerals mt-6 grid grid-cols-3 gap-4 border-t border-alabaster-300 pt-5 text-sm">
                <div>
                  <dt className="text-eyebrow uppercase text-ink-faint">Holes · Par</dt>
                  <dd className="mt-1 text-pine">
                    {course.holes_count} · {tee?.par_18 ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-eyebrow uppercase text-ink-faint">First tee</dt>
                  <dd className="mt-1 text-pine">{formatTeeTime(course.first_tee_time)}</dd>
                </div>
                <div>
                  <dt className="text-eyebrow uppercase text-ink-faint">18 holes from</dt>
                  <dd className="mt-1 text-pine">{formatPaise(course.pricing.weekday.eighteen_holes)}</dd>
                </div>
              </dl>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
