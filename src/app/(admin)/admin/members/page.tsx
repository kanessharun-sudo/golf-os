import type { Metadata } from "next";
import { requireAdminCourse } from "@/lib/admin/course";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PageHead } from "../_ui/parts";
import { SheetForm } from "./sheet-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Members · Club office" };

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso))
    : "never";

export default async function AdminMembersPage() {
  const course = await requireAdminCourse("/admin/members");
  const supabase = await getSupabaseServerClient();
  const { data: members, error } = await supabase
    .from("club_members")
    .select("id, member_no, full_name, phone, email, status, source")
    .eq("course_id", course.id)
    .eq("source", "sheet")
    .order("member_no");
  if (error) throw new Error(`Members lookup failed: ${error.message}`);
  const active = members.filter((m) => m.status === "active").length;

  return (
    <>
      <PageHead title="Members" detail={`${active} active members · last synced ${when(course.members_synced_at)}`} />

      <section className="mt-6 grid gap-8 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-4">
          <h2 className="font-display text-2xl text-pine">Member list</h2>
          <p className="text-sm text-ink-muted">
            Golf OS reads the club&apos;s Google Sheet when someone books, at most every 10 minutes, and when you press Sync now. A
            player is a member when their mobile or email matches an active row. Members play free; guests pay the guest green fee.
          </p>
          <p className="text-sm text-ink-muted">
            Columns: <span className="numerals text-ink">member_no, full_name, phone, email, status</span>. Status is active or
            lapsed. Share the sheet as &ldquo;Anyone with the link can view&rdquo;.
          </p>
          <SheetForm courseId={course.id} sheetUrl={course.member_sheet_url} />
          {course.members_sync_error ? (
            <p className="text-sm text-destructive">Last sync failed: {course.members_sync_error}</p>
          ) : null}
          {course.member_sheet_url ? (
            <a href={course.member_sheet_url} target="_blank" rel="noreferrer" className="text-sm text-pine underline underline-offset-4">
              Open the sheet
            </a>
          ) : null}
        </div>

        <div className="overflow-x-auto border border-alabaster-300 bg-card">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-alabaster-300 text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-normal">No.</th>
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Mobile</th>
                <th className="px-4 py-3 font-normal">Email</th>
                <th className="px-4 py-3 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-muted">
                    No members imported yet. Save the sheet link, then press Sync now.
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id} className="border-b border-alabaster-200 last:border-0">
                    <td className="numerals px-4 py-2.5 text-ink-muted">{m.member_no}</td>
                    <td className="px-4 py-2.5">{m.full_name}</td>
                    <td className="numerals px-4 py-2.5 text-ink-muted">{m.phone ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{m.email ?? "—"}</td>
                    <td className={cn("px-4 py-2.5", m.status === "active" ? "text-pine" : "text-destructive")}>
                      {m.status === "active" ? "Active" : "Lapsed"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
