"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type ProfileActionState = { ok: boolean; message: string | null };

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(400),
  golfingSince: z.union([z.literal(""), z.coerce.number().int().min(1940).max(new Date().getFullYear())]),
  isPublic: z.boolean(),
});

async function currentUserId() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

export async function saveProfileAction(_prev: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    bio: formData.get("bio") ?? "",
    golfingSince: formData.get("golfingSince") ?? "",
    isPublic: formData.get("isPublic") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Check your name and the year you started playing." };
  const { supabase, userId } = await currentUserId();
  if (!userId) return { ok: false, message: "Sign in again to save your profile." };

  const { data, error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      bio: parsed.data.bio || null,
      golfing_since: parsed.data.golfingSince === "" ? null : parsed.data.golfingSince,
      is_profile_public: parsed.data.isPublic,
    })
    .eq("id", userId)
    .select("username")
    .single();
  if (error) return { ok: false, message: "Your profile could not be saved." };
  revalidatePath(`/golfers/${data.username}`);
  revalidatePath("/account/profile");
  return { ok: true, message: "Profile saved." };
}

/** The browser uploads to storage first; this records the file against the signed-in golfer. */
export async function setAvatarAction(storagePath: string): Promise<ProfileActionState> {
  const { supabase, userId } = await currentUserId();
  if (!userId || !storagePath.startsWith(`${userId}/`)) return { ok: false, message: "That photo could not be used." };
  const url = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl;
  const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) return { ok: false, message: "Your photo could not be saved." };
  revalidatePath("/account/profile");
  return { ok: true, message: "Photo updated." };
}

const photoSchema = z.object({
  storagePath: z.string().min(3).max(300),
  caption: z.string().trim().max(200),
  category: z.enum(["tournament", "course", "round", "social"]),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export async function addGalleryPhotoAction(input: z.input<typeof photoSchema>): Promise<ProfileActionState> {
  const parsed = photoSchema.safeParse(input);
  const { supabase, userId } = await currentUserId();
  if (!parsed.success || !userId || !parsed.data.storagePath.startsWith(`${userId}/`)) {
    return { ok: false, message: "That photo could not be added." };
  }
  const { error } = await supabase.from("gallery_photos").insert({
    profile_id: userId,
    storage_path: parsed.data.storagePath,
    caption: parsed.data.caption || null,
    category: parsed.data.category,
    width: parsed.data.width,
    height: parsed.data.height,
  });
  if (error) return { ok: false, message: "That photo could not be added." };
  revalidatePath("/account/profile");
  return { ok: true, message: "Photo added." };
}

export async function deleteGalleryPhotoAction(photoId: string): Promise<ProfileActionState> {
  if (!z.string().uuid().safeParse(photoId).success) return { ok: false, message: "That photo was not found." };
  const { supabase, userId } = await currentUserId();
  if (!userId) return { ok: false, message: "Sign in again." };
  const { data: photo } = await supabase.from("gallery_photos").select("storage_path").eq("id", photoId).eq("profile_id", userId).maybeSingle();
  if (!photo) return { ok: false, message: "That photo was not found." };
  const { error } = await supabase.from("gallery_photos").delete().eq("id", photoId);
  if (error) return { ok: false, message: "That photo could not be removed." };
  await supabase.storage.from("golfer-gallery").remove([photo.storage_path]);
  revalidatePath("/account/profile");
  return { ok: true, message: "Photo removed." };
}
