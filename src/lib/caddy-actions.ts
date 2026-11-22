"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionError, type ActionResult } from "@/lib/booking/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function caddyCheckInAction(assignmentId: string): Promise<ActionResult<{ checkedInAt: string }>> {
  if (!z.string().uuid().safeParse(assignmentId).success) return { ok: false, error: "That group was not found." };
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("caddy_check_in", { p_assignment_id: assignmentId });
  if (error) return toActionError(error);
  revalidatePath("/caddy");
  return { ok: true, data: { checkedInAt: data } };
}

export async function setUpiAction(upiId: string): Promise<ActionResult<null>> {
  const value = upiId.trim();
  if (!value || value.length > 320) return { ok: false, error: "Enter your UPI ID, for example name@okaxis." };
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("caddy_set_upi", { p_upi_id: value });
  if (error) return toActionError(error);
  revalidatePath("/caddy/pay");
  return { ok: true, data: null };
}

/** Asks the club office to pay out the whole available balance to the caddie's UPI ID. */
export async function requestPayoutAction(): Promise<ActionResult<null>> {
  const supabase = await getSupabaseServerClient();
  const { data: caddyId } = await supabase.rpc("current_caddy_id");
  if (!caddyId) return { ok: false, error: "This account is not linked to a caddie." };
  const { data: balance } = await supabase.from("caddy_balances").select("balance_paise, pending_payout_paise, course_id").eq("caddy_id", caddyId).maybeSingle();
  if (!balance || balance.balance_paise <= 0) return { ok: false, error: "There is nothing to pay out yet." };
  if (balance.pending_payout_paise > 0) return { ok: false, error: "You already have a payout waiting for the club office." };

  const { error } = await supabase.from("caddy_payout_requests").insert({
    caddy_id: caddyId,
    course_id: balance.course_id,
    amount_paise: balance.balance_paise,
    upi_id: "set-by-trigger@upi",
  });
  if (error) return toActionError(error);
  revalidatePath("/caddy/pay");
  return { ok: true, data: null };
}

export async function cancelPayoutAction(payoutId: string): Promise<ActionResult<null>> {
  if (!z.string().uuid().safeParse(payoutId).success) return { ok: false, error: "That payout was not found." };
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("caddy_payout_requests").update({ status: "cancelled" }).eq("id", payoutId);
  if (error) return toActionError(error);
  revalidatePath("/caddy/pay");
  return { ok: true, data: null };
}
