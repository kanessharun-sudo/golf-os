import { CalendarDays, Clock, Flag, Ruler, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { describePolicy } from "@/lib/booking/cancellation";
import { getCourseShowcase } from "@/lib/courses";
import { weekdayName } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatPaise, formatTeeTime } from "@/lib/utils";
import { Scorecard } from "./scorecard";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getCourseShowcase(slug);
  if (!data) return { title: "Course not found" };
  return {
    title: data.course.name,
    description: data.course.tagline ?? data.course.description ?? undefined,
  };
}

export default async function CourseShowcasePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getCourseShowcase(slug);
  if (!data) notFound();
  const { course, tees, holes, yards, rateTiers } = data;

  const supabase = await getSupabaseServerClient();
  const { data: caddies, error: caddyError } = await supabase.rpc("get_course_caddies", { p_course_id: course.id });
  if (caddyError) throw new Error(`Caddy roster failed: ${caddyError.message}`);

  const defaultTee = tees.find((t) => t.is_default) ?? tees[0];
  const par = holes.reduce((acc, h) => acc + h.par, 0);
  const hero = course.media.hero_banner;
  const closedDays = course.closed_weekdays.map(weekdayName);
  const pricing = course.pricing;
  const bookHref = `/courses/${course.slug}/book`;

  return (
    <article>
      {/* Hero */}
      <section className="relative overflow-hidden bg-pine text-alabaster">
        {hero ? (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center opacity-35"
            style={{ backgroundImage: `url(${JSON.stringify(hero)})` }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-pine via-pine/70 to-transparent" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-24 sm:pb-24 sm:pt-36">
          <p className="text-eyebrow uppercase text-brass">
            {[course.area, course.city, course.established_year ? `Est. ${course.established_year}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h1 className="mt-4 max-w-3xl font-display text-display-md text-alabaster sm:text-display-lg">{course.name}</h1>
          {course.tagline ? <p className="mt-4 max-w-2xl text-lg text-pine-100">{course.tagline}</p> : null}
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={bookHref} className={buttonVariants({ variant: "brass", size: "lg" })}>
              Book a tee time
            </Link>
            <a href="#scorecard" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "text-alabaster hover:bg-pine-700")}>
              View scorecard
            </a>
          </div>
        </div>
      </section>

      {/* Key facts */}
      <section className="border-b border-alabaster-300 bg-alabaster-50">
        <dl className="numerals mx-auto grid max-w-6xl grid-cols-2 gap-px px-5 sm:grid-cols-4">
          {[
            { icon: Flag, label: "Holes · Par", value: `${course.holes_count} · ${par || "—"}` },
            {
              icon: Ruler,
              label: `${defaultTee?.name ?? "Default"} tees`,
              value: defaultTee?.total_yards ? `${defaultTee.total_yards.toLocaleString("en-IN")} yds` : "—",
            },
            { icon: Clock, label: "First tee", value: formatTeeTime(course.first_tee_time) },
            {
              icon: CalendarDays,
              label: "Closed",
              value: closedDays.length ? closedDays.join(", ") : "Open daily",
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="py-6">
              <dt className="flex items-center gap-2 text-eyebrow uppercase text-ink-faint">
                <Icon className="size-3.5" aria-hidden />
                {label}
              </dt>
              <dd className="mt-2 text-xl text-pine">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-5 py-16 sm:py-24">
        {course.description || course.facilities.length ? (
          <section className="grid gap-10 md:grid-cols-[2fr_1fr]">
            {course.description ? (
              <div>
                <p className="text-eyebrow uppercase text-brass-700">The course</p>
                <p className="mt-4 whitespace-pre-line font-display text-2xl leading-relaxed text-pine">
                  {course.description}
                </p>
              </div>
            ) : null}
            {course.facilities.length ? (
              <div>
                <p className="text-eyebrow uppercase text-brass-700">Facilities</p>
                <ul className="mt-4 space-y-2 text-sm text-ink-muted">
                  {course.facilities.map((f) => (
                    <li key={f} className="border-b border-alabaster-300 pb-2">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Scorecard */}
        <section id="scorecard" className="scroll-mt-24">
          <SectionHeading eyebrow="Scorecard" title="Hole by hole" />
          <div className="mt-8">
            <Scorecard holes={holes} tees={tees} yards={yards} />
          </div>
          <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
            {tees.map((tee) => (
              <li key={tee.id} className="flex items-center justify-between rounded-card bg-card px-4 py-3 shadow-hairline">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-3 rounded-full ring-1 ring-pine/20"
                    style={{ backgroundColor: tee.color_hex ?? "#8C928D" }}
                  />
                  {tee.name}
                </span>
                <span className="numerals text-ink-muted">
                  {tee.course_rating_18 && tee.slope_rating_18
                    ? `CR ${tee.course_rating_18} · Slope ${tee.slope_rating_18}`
                    : "Unrated"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Rates */}
        <section>
          <SectionHeading eyebrow="Green fees" title="Rate card" />
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="overflow-hidden rounded-card bg-card shadow-card">
              <table className="numerals w-full text-sm">
                <thead className="bg-pine text-alabaster">
                  <tr>
                    <th className="px-5 py-3 text-left text-eyebrow uppercase font-normal">Per player</th>
                    <th className="px-5 py-3 text-right text-eyebrow uppercase font-normal">9 holes</th>
                    <th className="px-5 py-3 text-right text-eyebrow uppercase font-normal">18 holes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-alabaster-300">
                  <tr>
                    <th className="px-5 py-3 text-left font-normal">Weekday</th>
                    <td className="px-5 py-3 text-right">{formatPaise(pricing.weekday.nine_holes)}</td>
                    <td className="px-5 py-3 text-right">{formatPaise(pricing.weekday.eighteen_holes)}</td>
                  </tr>
                  <tr>
                    <th className="px-5 py-3 text-left font-normal">
                      Weekend <span className="text-ink-faint">({pricing.weekend_isodow.map((d) => weekdayName(d).slice(0, 3)).join(", ")})</span>
                    </th>
                    <td className="px-5 py-3 text-right">{formatPaise(pricing.weekend.nine_holes)}</td>
                    <td className="px-5 py-3 text-right">{formatPaise(pricing.weekend.eighteen_holes)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="numerals border-t border-alabaster-300 px-5 py-3 text-xs text-ink-muted">
                Tournament entry adds {formatPaise(pricing.tournament_entry_addon)} per player. A{" "}
                {pricing.platform_convenience_fee_percent}% convenience fee applies at checkout.
              </p>
            </div>
            <div className="rounded-card border border-alabaster-300 p-6 text-sm">
              <p className="text-eyebrow uppercase text-brass-700">Cancellations</p>
              <ul className="mt-3 space-y-2 text-ink-muted">
                {describePolicy(course.cancellation_policy).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Caddies */}
        <section>
          <SectionHeading eyebrow="Caddies" title="Walk with someone who knows every break" />
          {rateTiers.length ? (
            <ul className="numerals mt-8 grid gap-4 sm:grid-cols-3">
              {rateTiers.map((tier) => (
                <li key={tier.grade} className="rounded-card bg-pine p-5 text-alabaster">
                  <p className="text-eyebrow uppercase text-brass">{tier.label}</p>
                  <p className="mt-3 text-sm text-pine-100">
                    {formatPaise(tier.rate_9_paise)} for 9 · {formatPaise(tier.rate_18_paise)} for 18
                  </p>
                  {tier.description ? <p className="mt-2 text-xs text-pine-200">{tier.description}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(caddies ?? []).map((caddy) => (
              <li key={caddy.caddy_id} className="rounded-card bg-card p-5 shadow-hairline">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-pine">{caddy.full_name}</p>
                    <p className="text-eyebrow uppercase text-ink-faint">{caddy.caddy_code}</p>
                  </div>
                  {caddy.rating !== null ? (
                    <span className="numerals flex items-center gap-1 text-sm text-brass-700">
                      <Star className="size-3.5 fill-brass text-brass" aria-hidden />
                      {Number(caddy.rating).toFixed(1)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-sm text-ink-muted">
                  {caddy.grade_label ?? caddy.grade}
                  {caddy.years_experience !== null ? ` · ${caddy.years_experience} yrs` : ""}
                </p>
                {!caddy.is_available ? <p className="mt-2 text-xs text-ink-faint">Not taking bookings</p> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-card bg-pine px-8 py-12 text-center text-alabaster sm:px-16">
          <p className="text-eyebrow uppercase text-brass">Tee sheet</p>
          <h2 className="mt-3 font-display text-display-sm text-alabaster">
            Tee times every {course.slot_interval_minutes} minutes from {formatTeeTime(course.first_tee_time)}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-pine-200">
            Book up to {course.max_players_per_slot} players, or join an open group. Seats are held for{" "}
            {course.checkout_hold_minutes} minutes while you pay.
          </p>
          <Link href={bookHref} className={cn(buttonVariants({ variant: "brass", size: "lg" }), "mt-8")}>
            See available times
          </Link>
        </section>
      </div>
    </article>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-eyebrow uppercase text-brass-700">{eyebrow}</p>
      <h2 className="mt-3 font-display text-display-sm text-pine">{title}</h2>
      <div className="rule-brass mt-5 max-w-24" />
    </div>
  );
}
