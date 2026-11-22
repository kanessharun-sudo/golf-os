"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { sheetCsvUrl, syncMembers } from "@/lib/members/sync";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { toActionError } from "@/lib/booking/errors";
import { normalisePhone } from "@/lib/phone";
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

// ---------------------------------------------------------------------------
// Phase 5: course settings, caddies, bookings, payouts
// ---------------------------------------------------------------------------

const rupees = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) : null;
};
const time = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "");
  return /^\d{2}:\d{2}$/.test(s) ? `${s}:00` : null;
};

export async function saveCourseSettingsAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const courseId = await assertAdminOf(formData.get("courseId")?.toString() ?? "");
  if (!courseId) return { ok: false, message: "You do not run this course." };

  const guest = rupees(formData.get("guestFee"));
  const member = rupees(formData.get("memberFee"));
  const convenience = Number(formData.get("convenience"));
  const commission = Number(formData.get("commission"));
  const first = time(formData.get("firstTee"));
  const last18 = time(formData.get("last18"));
  const last9 = time(formData.get("last9"));
  const interval = Number(formData.get("interval"));
  const windowDays = Number(formData.get("windowDays"));
  const closed = formData.getAll("closed").map(Number).filter((d) => d >= 1 && d <= 7);

  if (guest === null || member === null) return { ok: false, message: "Enter the fees in rupees." };
  if (!(convenience >= 0 && convenience <= 10)) return { ok: false, message: "The convenience fee must be between 0% and 10%." };
  if (!(commission >= 0 && commission <= 50)) return { ok: false, message: "The club's cut of caddie fees must be between 0% and 50%." };
  if (!first || !last18 || !last9 || first >= last18 || first >= last9) return { ok: false, message: "Check the tee times: the first tee must come before the last." };
  if (![6, 7, 8, 9, 10, 12, 15].includes(interval)) return { ok: false, message: "Choose a tee interval from the list." };
  if (!(windowDays >= 1 && windowDays <= 60)) return { ok: false, message: "Bookings can open between 1 and 60 days ahead." };
  if (closed.length >= 7) return { ok: false, message: "The course must be open at least one day a week." };

  const supabase = await getSupabaseServerClient();
  const { data: course, error: readError } = await supabase.from("courses").select("pricing").eq("id", courseId).single();
  if (readError) return { ok: false, message: "The course could not be read." };

  const { error } = await supabase
    .from("courses")
    .update({
      pricing: { ...course.pricing, guest_green_fee: guest, member_green_fee: member, platform_convenience_fee_percent: convenience },
      caddy_commission_percent: commission,
      first_tee_time: first,
      last_tee_time_18: last18,
      last_tee_time_9: last9,
      slot_interval_minutes: interval,
      booking_window_days: windowDays,
      closed_weekdays: closed as (1 | 2 | 3 | 4 | 5 | 6 | 7)[],
    })
    .eq("id", courseId);
  if (error) {
    console.error("[admin] settings update failed", error.message);
    return { ok: false, message: "The settings could not be saved. Check the values and try again." };
  }
  revalidatePath("/admin/settings");
  return { ok: true, message: "Saved. New bookings use these settings straight away; existing bookings keep their price." };
}

const caddySchema = z.object({
  courseId: z.string().uuid(),
  caddyId: z.string().uuid().optional().or(z.literal("")),
  fullName: z.string().trim().min(2).max(120),
  caddyCode: z.string().trim().min(2).max(20),
  phone: z.string().trim().max(20).optional(),
  grade: z.enum(["grade_a", "grade_b", "grade_c"]),
  isActive: z.boolean(),
});

export async function saveCaddyAction(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const parsed = caddySchema.safeParse({
    courseId: formData.get("courseId"),
    caddyId: formData.get("caddyId") ?? "",
    fullName: formData.get("fullName"),
    caddyCode: formData.get("caddyCode"),
    phone: formData.get("phone") ?? "",
    grade: formData.get("grade"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { ok: false, message: "Every caddie needs a name, a code and a grade." };
  const courseId = await assertAdminOf(parsed.data.courseId);
  if (!courseId) return { ok: false, message: "You do not run this course." };
  const rate18 = rupees(formData.get("rate18"));
  const rate9 = rupees(formData.get("rate9"));
  if (rate18 === null || rate9 === null) return { ok: false, message: "Enter the caddie rates in rupees." };

  const phone = parsed.data.phone ? normalisePhone(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return { ok: false, message: "That mobile number is not valid." };

  const supabase = await getSupabaseServerClient();
  const row = {
    full_name: parsed.data.fullName,
    caddy_code: parsed.data.caddyCode.toUpperCase(),
    phone,
    grade: parsed.data.grade,
    daily_rate_18_paise: rate18,
    daily_rate_9_paise: rate9,
    is_active: parsed.data.isActive,
  };
  const { error } = parsed.data.caddyId
    ? await supabase.from("caddies").update(row).eq("id", parsed.data.caddyId).eq("course_id", courseId)
    : await supabase.from("caddies").insert({ ...row, course_id: courseId });
  if (error) {
    return { ok: false, message: error.code === "23505" ? "Another caddie already has that code." : "The caddie could not be saved." };
  }
  revalidatePath("/admin/caddies");
  return { ok: true, message: parsed.data.caddyId ? "Caddie updated." : "Caddie added." };
}

export async function assignCaddyAction(input: { bookingId: string; caddyId: string; seat: number }): Promise<AdminActionState> {
  const parsed = z.object({ bookingId: z.string().uuid(), caddyId: z.string().uuid(), seat: z.number().int().min(1).max(4) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Choose a player and a caddie." };
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("admin_assign_caddy", {
    p_booking_id: parsed.data.bookingId,
    p_caddy_id: parsed.data.caddyId,
    p_seat_number: parsed.data.seat,
  });
  if (error) return { ok: false, message: toActionError(error).error };
  revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
  return { ok: true, message: "Caddie assigned. The caddie fee is collected at the counter." };
}

export async function removeCaddyAction(input: { bookingId: string; assignmentId: string }): Promise<AdminActionState> {
  if (!z.string().uuid().safeParse(input.assignmentId).success) return { ok: false, message: "That caddie was not found." };
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("admin_remove_caddy", { p_assignment_id: input.assignmentId });
  if (error) return { ok: false, message: toActionError(error).error };
  revalidatePath(`/admin/bookings/${input.bookingId}`);
  return { ok: true, message: "Caddie removed." };
}

const payoutSchema = z.object({
  payoutId: z.string().uuid(),
  decision: z.enum(["approve", "reject", "paid"]),
  reason: z.string().trim().max(300).optional(),
  utr: z.string().trim().max(40).optional(),
});

export async function decidePayoutAction(input: z.input<typeof payoutSchema>): Promise<AdminActionState> {
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Something in that request was not valid." };
  const { payoutId, decision, reason, utr } = parsed.data;
  if (decision === "reject" && !reason) return { ok: false, message: "Give a reason so the caddie knows why." };

  const supabase = await getSupabaseServerClient();
  const { data: current } = await supabase.from("caddy_payout_requests").select("status").eq("id", payoutId).maybeSingle();
  if (!current) return { ok: false, message: "That payout was not found." };

  if (decision === "paid" && current.status === "requested") {
    // Paying straight from the request approves it first; the trigger records who approved.
    const { error } = await supabase.from("caddy_payout_requests").update({ status: "approved" }).eq("id", payoutId);
    if (error) return { ok: false, message: toActionError(error).error };
  }
  const update =
    decision === "approve"
      ? { status: "approved" as const }
      : decision === "reject"
        ? { status: "rejected" as const, rejection_reason: reason }
        : { status: "paid" as const, utr: utr || null };
  const { error } = await supabase.from("caddy_payout_requests").update(update).eq("id", payoutId);
  if (error) return { ok: false, message: toActionError(error).error };
  revalidatePath("/admin/caddies");
  return { ok: true, message: decision === "paid" ? "Marked as paid." : decision === "approve" ? "Approved." : "Rejected." };
}
