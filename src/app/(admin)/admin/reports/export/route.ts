import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { loadBookings } from "@/lib/admin/data";
import { isIsoDate } from "@/lib/dates";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const csvCell = (value: string | number) => {
  const text = String(value);
  // Quote everything and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session || (session.profile.role !== "super_admin" && session.adminCourseIds.length === 0)) {
    return new NextResponse("Not allowed", { status: 403 });
  }
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return new NextResponse("Bad range", { status: 400 });

  const supabase = await getSupabaseServerClient();
  const courseQuery = supabase.from("courses").select("id, slug").order("created_at").limit(1);
  const { data: course } = await (session.profile.role === "super_admin" ? courseQuery : courseQuery.in("id", session.adminCourseIds)).maybeSingle();
  if (!course) return new NextResponse("No course", { status: 404 });

  const bookings = await loadBookings(course.id, from, to);
  const header = ["date", "tee_time", "booking_ref", "status", "payment", "players", "members", "guests", "player_names", "caddies", "green_fee_inr", "caddy_fee_inr", "convenience_fee_inr", "total_inr", "refund_inr"];
  const rows = bookings.map((b) => {
    const members = b.players.filter((p) => p.isMember).length;
    return [
      b.playDate,
      b.teeTime.slice(0, 5),
      b.ref,
      b.status,
      b.paymentStatus,
      b.players.length,
      members,
      b.players.length - members,
      b.players.map((p) => `${p.name} (${p.isMember ? "member" : "guest"})`).join("; "),
      b.caddies.map((c) => `${c.name} ${c.code}`).join("; "),
      b.greenPaise / 100,
      b.caddyPaise / 100,
      b.feePaise / 100,
      b.totalPaise / 100,
      b.refundPaise / 100,
    ];
  });
  const body = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(`﻿${body}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${course.slug}-bookings-${from}-to-${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
