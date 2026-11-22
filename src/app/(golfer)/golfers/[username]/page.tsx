import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { loadGallery, loadHandicapHistory, loadRounds } from "@/lib/profile/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GalleryGrid, HandicapChart, RoundsTable } from "../_parts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function GolferProfilePage({ params }: Params) {
  const { username } = await params;
  if (!/^[a-z0-9][a-z0-9_.]{2,29}$/.test(username)) notFound();
  const supabase = await getSupabaseServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, full_name, avatar_url, bio, golfing_since, is_profile_public, handicap_18, handicap_9, rounds_counted_18, rounds_counted_9")
    .eq("username", username)
    .maybeSingle();
  // RLS hides private profiles from everyone but their owner.
  if (!profile) notFound();

  const session = await getSessionContext();
  const isOwner = session?.profile.id === profile.id;
  const [rounds, history, photos] = await Promise.all([
    loadRounds(supabase, profile.id),
    loadHandicapHistory(supabase, profile.id),
    loadGallery(supabase, profile.id, !isOwner),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-alabaster-300 pb-8">
        <div className="flex items-center gap-5">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="size-20 rounded-full object-cover" />
          ) : (
            <span className="grid size-20 place-items-center rounded-full bg-pine font-display text-3xl text-alabaster">
              {profile.full_name.slice(0, 1)}
            </span>
          )}
          <div>
            <h1 className="font-display text-display-sm text-pine">{profile.full_name}</h1>
            <p className="text-sm text-ink-muted">
              @{profile.username}
              {profile.golfing_since ? ` · playing since ${profile.golfing_since}` : ""}
            </p>
          </div>
        </div>
        <dl className="numerals flex gap-8">
          <div>
            <dt className="text-xs text-ink-muted">Handicap, 18 holes</dt>
            <dd className="font-display text-4xl text-pine">{profile.handicap_18 !== null ? profile.handicap_18.toFixed(1) : "–"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Handicap, 9 holes</dt>
            <dd className="font-display text-4xl text-pine">{profile.handicap_9 !== null ? profile.handicap_9.toFixed(1) : "–"}</dd>
          </div>
        </dl>
      </header>
      {isOwner ? (
        <p className="mt-4 text-sm text-ink-muted">
          {profile.is_profile_public ? "Anyone with the link can see this page." : "Only you can see this page."}{" "}
          <Link href="/account/profile" className="text-pine underline-offset-4 hover:underline">
            Edit profile
          </Link>
        </p>
      ) : null}
      {profile.bio ? <p className="mt-6 max-w-2xl text-ink">{profile.bio}</p> : null}

      <section className="mt-10">
        <h2 className="font-display text-3xl text-pine">Handicap</h2>
        {history.eighteen_hole.length || history.nine_hole.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <HandicapChart label="18-hole index" points={history.eighteen_hole} />
            <HandicapChart label="9-hole index" points={history.nine_hole} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            An index appears after three scored rounds ({profile.rounds_counted_18} 18-hole and {profile.rounds_counted_9} 9-hole so far).
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-3xl text-pine">Rounds</h2>
        <div className="mt-4">
          <RoundsTable rounds={rounds} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-3xl text-pine">Photos</h2>
        <div className="mt-4">
          <GalleryGrid photos={photos} />
        </div>
      </section>
    </div>
  );
}
