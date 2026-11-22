"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { sheetCsvUrl, syncMembers } from "@/lib/members/sync";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Uuid } from "@/types/database";

export type AdminActionState = { ok: boolean; message: string | null };

async function assertAdminOf(courseId: string): Promise<Uuid | null> {
  if (!z.string().uuid().safeParse(courseId).success) return null;
  const session = await getSessionContext();
  if (!session) return null;
  if (session.profile.role === "super_admin" || session.adminCourseIds.includes(courseId)) return courseId;
  return null;
}

export async function saveMemberSheetAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const courseId = await assertAdminOf(formData.get("courseId")?.toString() ?? "");
  if (!courseId) return { ok: false, message: "You do not run this course." };
  const url = formData.get("sheetUrl")?.toString().trim() ?? "";
  if (url && !sheetCsvUrl(url)) return { ok: false, message: "Paste the link of a Google Sheet (docs.google.com/spreadsheets/…)." };

  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from("courses")
    .update({ member_sheet_url: url || null, members_sync_error: null })
    .eq("id", courseId);
  if (error) return { ok: false, message: "The link could not be saved." };
  if (!url) {
    revalidatePath("/admin/members");
    return { ok: true, message: "Sheet disconnected. Members already imported stay until the next sync." };
  }
  const result = await syncMembers(courseId);
  revalidatePath("/admin/members");
  return result.ok
    ? { ok: true, message: `Saved and synced ${result.count} members.` }
    : { ok: false, message: `Saved, but the sync failed: ${result.error}` };
}

export async function syncMembersNowAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const courseId = await assertAdminOf(formData.get("courseId")?.toString() ?? "");
  if (!courseId) return { ok: false, message: "You do not run this course." };
  const result = await syncMembers(courseId);
  revalidatePath("/admin/members");
  return result.ok ? { ok: true, message: `Synced ${result.count} members from the sheet.` } : { ok: false, message: result.error };
}
