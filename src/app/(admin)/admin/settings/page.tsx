import type { Metadata } from "next";
import { requireAdminCourse } from "@/lib/admin/course";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PageHead } from "../_ui/parts";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings · Club office" };

export default async function AdminSettingsPage() {
  const course = await requireAdminCourse("/admin/settings");
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("courses")
    .select("pricing, caddy_commission_percent, first_tee_time, last_tee_time_18, last_tee_time_9, slot_interval_minutes, booking_window_days, closed_weekdays")
    .eq("id", course.id)
    .single();
  if (error) throw new Error(`Settings lookup failed: ${error.message}`);

  return (
    <>
      <PageHead title="Settings" detail={`${course.name} · prices and tee times`} />
      <SettingsForm
        values={{
          courseId: course.id,
          guestFee: (data.pricing.guest_green_fee ?? data.pricing.weekday.eighteen_holes) / 100,
          memberFee: (data.pricing.member_green_fee ?? 0) / 100,
          convenience: data.pricing.platform_convenience_fee_percent,
          commission: Number(data.caddy_commission_percent),
          firstTee: data.first_tee_time.slice(0, 5),
          last18: data.last_tee_time_18.slice(0, 5),
          last9: data.last_tee_time_9.slice(0, 5),
          interval: data.slot_interval_minutes,
          windowDays: data.booking_window_days,
          closed: [...data.closed_weekdays],
        }}
      />
    </>
  );
}
