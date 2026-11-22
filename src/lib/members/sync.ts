import "server-only";

import { normalisePhone } from "@/lib/phone";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Uuid } from "@/types/database";

/** A sync older than this is refreshed before member pricing is applied. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export type SyncResult = { ok: true; count: number } | { ok: false; error: string };

type MemberRow = { member_no: string; full_name: string; phone: string | null; email: string | null; status: string };

/** Turns any Google Sheets link into its CSV export URL (first tab unless the link names a gid). */
export function sheetCsvUrl(sheetUrl: string): string | null {
  const match = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(sheetUrl);
  if (!match) return null;
  const gid = /[#&?]gid=(\d+)/.exec(sheetUrl)?.[1];
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** RFC 4180 CSV: quoted fields, escaped quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HEADER_ALIASES: Record<keyof MemberRow, string[]> = {
  member_no: ["member_no", "member no", "membership no", "membership number", "member number", "member id", "id"],
  full_name: ["full_name", "full name", "name", "member name"],
  phone: ["phone", "mobile", "mobile number", "phone number", "contact"],
  email: ["email", "email address", "e-mail"],
  status: ["status", "active", "membership status"],
};

export function rowsToMembers(rows: string[][]): MemberRow[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  const col = (name: keyof MemberRow) => keys.findIndex((k) => HEADER_ALIASES[name].includes(k));
  const idx = { member_no: col("member_no"), full_name: col("full_name"), phone: col("phone"), email: col("email"), status: col("status") };
  if (idx.member_no < 0 || idx.full_name < 0) {
    throw new Error("The sheet needs member_no and full_name columns in its first row.");
  }
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return body.map((r) => {
    const email = cell(r, idx.email).toLowerCase();
    return {
      member_no: cell(r, idx.member_no),
      full_name: cell(r, idx.full_name),
      phone: normalisePhone(cell(r, idx.phone)),
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      status: cell(r, idx.status) || "active",
    };
  });
}

/** Reads the course's member sheet and replaces the sheet-sourced member rows. */
export async function syncMembers(courseId: Uuid): Promise<SyncResult> {
  const admin = getSupabaseAdminClient();
  const { data: course, error } = await admin.from("courses").select("member_sheet_url").eq("id", courseId).single();
  if (error) return { ok: false, error: error.message };
  if (!course.member_sheet_url) return { ok: false, error: "No member sheet is connected." };

  const url = sheetCsvUrl(course.member_sheet_url);
  let message: string;
  if (!url) {
    message = "That link is not a Google Sheets link.";
  } else {
    try {
      const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(8000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("text/html")) {
        message = "The sheet could not be read. Share it as 'Anyone with the link can view'.";
      } else {
        const members = rowsToMembers(parseCsv(await res.text()));
        const { data: count, error: rpcError } = await admin.rpc("replace_sheet_members", {
          p_course_id: courseId,
          p_rows: members,
        });
        if (rpcError) return { ok: false, error: rpcError.message };
        return { ok: true, count };
      }
    } catch (fetchError) {
      message = fetchError instanceof Error ? fetchError.message : "The sheet could not be read.";
    }
  }
  await admin.rpc("replace_sheet_members", { p_course_id: courseId, p_rows: [], p_error: message });
  return { ok: false, error: message };
}

/** Refreshes the roll if the last sync is stale. Never throws: a failed read keeps the last good list. */
export async function syncMembersIfStale(courseId: Uuid): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    const { data } = await admin.from("courses").select("member_sheet_url, members_synced_at").eq("id", courseId).single();
    if (!data?.member_sheet_url) return;
    const last = data.members_synced_at ? new Date(data.members_synced_at).getTime() : 0;
    if (Date.now() - last < STALE_AFTER_MS) return;
    const result = await syncMembers(courseId);
    if (!result.ok) console.warn("[members] sync failed", result.error);
  } catch (error) {
    console.warn("[members] sync skipped", error);
  }
}
