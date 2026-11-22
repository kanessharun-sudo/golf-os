import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { loadGallery } from "@/lib/profile/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GalleryGrid } from "../../golfers/_parts";
import { AvatarUpload, DeletePhoto, GalleryUpload, ProfileForm } from "./profile-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile" };

export default async function EditProfilePage() {
  const session = await requireRole(["golfer", "caddy", "course_admin", "super_admin"], "/account/profile");
  const p = session.profile;
  const supabase = await getSupabaseServerClient();
  const [photos, { data: courses }] = await Promise.all([
    loadGallery(supabase, p.id, false),
    supabase.from("courses").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-5 py-10 sm:py-14">
      <header>
        <h1 className="font-display text-display-sm text-pine">Your profile</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your public page is{" "}
          <Link href={`/golfers/${p.username}`} className="text-pine underline-offset-4 hover:underline">
            /golfers/{p.username}
          </Link>
          . Handicaps update by themselves after each scored round.
        </p>
      </header>

      <AvatarUpload userId={p.id} current={p.avatar_url} initial={p.full_name.slice(0, 1)} />

      <ProfileForm
        values={{ fullName: p.full_name, bio: p.bio ?? "", golfingSince: p.golfing_since ? String(p.golfing_since) : "", isPublic: p.is_profile_public, homeCourseId: p.home_course_id ?? "" }}
        courses={courses ?? []}
      />

      <section className="space-y-4">
        <h2 className="font-display text-3xl text-pine">Photos</h2>
        <GalleryUpload userId={p.id} />
        <GalleryGrid photos={photos} footer={(photo) => <DeletePhoto photoId={photo.id} />} />
      </section>
    </div>
  );
}
