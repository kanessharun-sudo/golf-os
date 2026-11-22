import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { cn, formatPaise } from "@/lib/utils";
import { CancelPayout, RequestPayout, UpiForm } from "./pay-controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My pay · Caddie" };

const ENTRY: Record<string, string> = {
  round_earning: "Round",
  tip: "Tip",
  adjustment: "Adjustment",
  payout: "Paid to UPI",
  payout_reversal: "Payout reversed",
};
const STATUS: Record<string, string> = {
  requested: "Waiting for the office",
  approved: "Approved, payment on the way",
  processing: "Being paid",
  paid: "Paid",
  rejected: "Rejected",
  cancelled: "Cancelled",
  failed: "Failed",
};

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function CaddyPayPage() {
  const session = await getSessionContext();
  if (!session?.caddy) {
    return <p className="text-alabaster/80">This account is not linked to a caddie yet. Ask the club office to link it.</p>;
  }
  const caddyId = session.caddy.id;
  const supabase = await getSupabaseServerClient();
  const [{ data: caddy }, { data: balance }, { data: payouts }, { data: ledger, error }] = await Promise.all([
    supabase.from("caddies").select("upi_id").eq("id", caddyId).single(),
    supabase.from("caddy_balances").select("balance_paise, pending_payout_paise").eq("caddy_id", caddyId).maybeSingle(),
    supabase
      .from("caddy_payout_requests")
      .select("id, amount_paise, status, upi_id, rejection_reason, utr, created_at, paid_at")
      .eq("caddy_id", caddyId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("caddy_ledger")
      .select("id, entry_type, direction, amount_paise, balance_after_paise, description, created_at")
      .eq("caddy_id", caddyId)
      .order("id", { ascending: false })
      .limit(50),
  ]);
  if (error) throw new Error(`Statement lookup failed: ${error.message}`);

  const available = balance?.balance_paise ?? 0;
  const pending = balance?.pending_payout_paise ?? 0;
  const open = (payouts ?? []).find((p) => p.status === "requested" || p.status === "approved" || p.status === "processing");
  const disabledReason = !caddy?.upi_id
    ? "Add your UPI ID first."
    : open
      ? "One request at a time. The office is handling your last one."
      : available <= 0
        ? "Your balance grows when you check in to a group."
        : null;

  return (
    <div className="space-y-10">
      <p className="text-sm">
        <Link href="/caddy" className="text-alabaster/60 hover:text-alabaster">
          ← My groups
        </Link>
      </p>
      <section>
        <p className="text-xs text-alabaster/60">Available to pay out</p>
        <p className="numerals mt-1 font-display text-6xl">{formatPaise(available)}</p>
        {pending > 0 ? <p className="mt-1 text-sm text-alabaster/60">{formatPaise(pending)} already requested</p> : null}
        <p className="mt-3 max-w-md text-sm text-alabaster/70">
          Each group you check in to adds your fee, less the club&apos;s share. The club office pays to your UPI ID.
        </p>
        <div className="mt-6 space-y-6 border-t border-pine-600 pt-6">
          <UpiForm current={caddy?.upi_id ?? null} />
          <RequestPayout balance={available} disabledReason={disabledReason} />
        </div>
      </section>

      {payouts?.length ? (
        <section>
          <h2 className="font-display text-2xl">Payout requests</h2>
          <ul className="mt-4 border-t border-pine-600">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-pine-600 py-3">
                <div>
                  <p className="numerals">{formatPaise(p.amount_paise)}</p>
                  <p className={cn("text-xs", p.status === "rejected" || p.status === "failed" ? "text-red-300" : "text-alabaster/60")}>
                    {STATUS[p.status] ?? p.status}
                    {p.rejection_reason ? `: ${p.rejection_reason}` : ""}
                    {p.utr ? ` · UTR ${p.utr}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="numerals text-xs text-alabaster/60">{dateTime.format(new Date(p.paid_at ?? p.created_at))}</p>
                  {p.status === "requested" ? <CancelPayout payoutId={p.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="font-display text-2xl">Statement</h2>
        {ledger.length === 0 ? (
          <p className="mt-3 text-alabaster/70">No entries yet.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-xs text-alabaster/50">
              <tr>
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Entry</th>
                <th className="py-2 text-right font-normal">Amount</th>
                <th className="py-2 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id} className="border-t border-pine-600">
                  <td className="numerals py-2 text-alabaster/70">{dateTime.format(new Date(l.created_at))}</td>
                  <td className="py-2">
                    {ENTRY[l.entry_type] ?? l.entry_type}
                    {l.description ? <span className="block text-xs text-alabaster/50">{l.description}</span> : null}
                  </td>
                  <td className={cn("numerals py-2 text-right", l.direction === "credit" ? "text-brass" : "text-alabaster/80")}>
                    {l.direction === "credit" ? "+" : "−"}
                    {formatPaise(l.amount_paise)}
                  </td>
                  <td className="numerals py-2 text-right">{formatPaise(l.balance_after_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
