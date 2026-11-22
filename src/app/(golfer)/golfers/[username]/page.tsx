import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { formatPlayDate } from "@/lib/dates";
import { loadGallery, loadHandicapHistory, loadRounds } from "@/lib/profile/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GalleryUpload } from "../../account/profile/profile-forms";
import { GalleryGrid, HandicapChart, RecentScoresChart, RoundsTable } from "../_parts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

const FALLBACK_COVER = "/landing/img/fairway-poster.jpg";

export default async function GolferProfilePage({ params }: Params) {
  const { username } = await params;
  if (!/^[a-z0-9][a-z0-9_.]{2,29}$/.test(username)) notFound();
  const supabase = await getSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, username, full_name, avatar_url, bio, golfing_since, home_course_id, is_profile_public, handicap_18, handicap_9, avg_score_18, rounds_counted_18, rounds_counted_9, created_at",
    )
    .eq("username", username)
    .maybeSingle();
  // RLS hides private profiles from everyone but their owner.
  if (!profile) notFound();

  const session = await getSessionContext();
  const isOwner = session?.profile.id === profile.id;
  const [rounds, history, photos, home] = await Promise.all([
    loadRounds(supabase, profile.id),
    loadHandicapHistory(supabase, profile.id),
    loadGallery(supabase, profile.id, !isOwner),
    profile.home_course_id
      ? supabase.from("courses").select("name, city").eq("id", profile.home_course_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const index = profile.handicap_18 ?? profile.handicap_9;
  const indexTrack = profile.handicap_18 !== null ? history.eighteen_hole : history.nine_hole;
  const low = indexTrack.length ? indexTrack.reduce((a, b) => (b.index < a.index ? b : a)) : null;
  const scored = rounds.filter((r) => r.gross !== null && r.format === "full_18");
  const best = scored.length ? Math.min(...scored.map((r) => r.gross ?? 999)) : null;
  const cover = photos[0]?.url ?? null;

  return (
    <div>
      <section className="relative isolate overflow-hidden bg-pine text-alabaster">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover ?? FALLBACK_COVER} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-pine-900/90 via-pine-900/65 to-pine-900/20" />
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-14 sm:py-20 md:grid-cols-[1fr_20rem] md:items-center">
          <div>
            <div className="flex items-center gap-4">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="" className="size-16 rounded-full border-2 border-alabaster/70 object-cover" />
              ) : null}
              <h1 className="font-display text-5xl font-medium text-alabaster sm:text-6xl">{profile.full_name}</h1>
            </div>
            <div className="mt-5 flex items-end gap-3">
              <span className="numerals font-display text-7xl leading-none sm:text-8xl">{index !== null ? index.toFixed(1) : "–"}</span>
              <span className="pb-2 text-sm leading-tight text-alabaster/80">
                Handicap
                <br />
                Index{profile.handicap_18 === null && profile.handicap_9 !== null ? " (9 holes)" : ""}
              </span>
            </div>
            <dl className="mt-4 space-y-0.5 text-sm text-alabaster/85">
              {low ? (
                <div>
                  <dt className="inline">Low H.I.: </dt>
                  <dd className="numerals inline">
                    {low.index.toFixed(1)} ({formatPlayDate(low.at.slice(0, 10), "short").split(", ")[1]} {low.at.slice(0, 4)})
                  </dd>
                </div>
              ) : (
                <div>An index appears after three scored rounds.</div>
              )}
              <div>
                <dt className="inline">Golf OS: </dt>
                <dd className="inline">@{profile.username}</dd>
              </div>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/courses/asc-centre-bengaluru/book" className="inline-flex h-11 items-center bg-brass px-5 text-sm font-medium text-pine-900 hover:bg-brass-400">
                Book a round
              </Link>
              {isOwner ? (
                <Link href="/account/profile" className="inline-flex h-11 items-center border border-alabaster/40 px-5 text-sm text-alabaster hover:bg-alabaster/10">
                  Edit profile
                </Link>
              ) : null}
            </div>
          </div>
          <aside className="bg-alabaster-50 p-5 text-ink shadow-card">
            <h2 className="text-sm font-semibold text-pine">Memberships</h2>
            {home ? (
              <p className="mt-3 text-sm">
                <span className="block font-medium">{home.name}</span>
                <span className="text-ink-muted">{home.city ? `${home.city} · ` : ""}Home club</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">{isOwner ? "Set your home club on Edit profile." : "No home club set."}</p>
            )}
            <p className="mt-3 border-t border-alabaster-300 pt-3 text-xs text-ink-muted">
              {profile.golfing_since ? `Playing since ${profile.golfing_since}. ` : ""}
              {rounds.length} round{rounds.length === 1 ? "" : "s"} on Golf OS.
            </p>
          </aside>
        </div>
        {!cover ? <span className="absolute bottom-2 right-3 text-[0.65rem] text-alabaster/60">AI-generated image</span> : null}
      </section>

      <div className="mx-auto max-w-5xl space-y-12 px-5 py-12">
        {isOwner ? (
          <p className="text-sm text-ink-muted">
            {profile.is_profile_public ? "Anyone with the link can see this page." : "Only you can see this page."} Your newest photo is used as the banner.
          </p>
        ) : null}
        {profile.bio ? <p className="max-w-2xl text-lg text-ink">{profile.bio}</p> : null}

        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-3xl text-pine">Recent scores</h2>
            <a href="#rounds" className="text-sm text-pine underline-offset-4 hover:underline">
              All rounds ›
            </a>
          </div>
          <div className="mt-4">
            <RecentScoresChart rounds={rounds} />
          </div>
          <dl className="numerals mt-4 grid grid-cols-3 border-l border-t border-alabaster-300 bg-card">
            {[
              { label: "Rounds", value: String(rounds.length) },
              { label: "Average, 18 holes", value: profile.avg_score_18 !== null ? profile.avg_score_18.toFixed(1) : "–" },
              { label: "Best, 18 holes", value: best !== null ? String(best) : "–" },
            ].map((s) => (
              <div key={s.label} className="border-b border-r border-alabaster-300 p-4">
                <dt className="text-xs text-ink-muted">{s.label}</dt>
                <dd className="mt-1 font-display text-3xl text-pine">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {history.eighteen_hole.length || history.nine_hole.length ? (
          <section>
            <h2 className="font-display text-3xl text-pine">Handicap history</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <HandicapChart label="18-hole index" points={history.eighteen_hole} />
              <HandicapChart label="9-hole index" points={history.nine_hole} />
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="font-display text-3xl text-pine">Photos</h2>
          <div className="mt-4 space-y-4">
            {isOwner ? <GalleryUpload userId={profile.id} /> : null}
            <GalleryGrid photos={photos} />
          </div>
        </section>

        <section id="rounds">
          <h2 className="font-display text-3xl text-pine">Rounds</h2>
          <div className="mt-4">
            <RoundsTable rounds={rounds} />
          </div>
        </section>
      </div>
    </div>
  );
}
