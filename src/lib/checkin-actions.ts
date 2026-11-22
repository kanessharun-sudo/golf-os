"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toActionError, type ActionResult } from "@/lib/booking/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/** The golfer's side of check-in. The caddie checks in separately from the caddie desk. */
export async function golferCheckInAction(bookingId: string): Promise<ActionResult<{ checkedInAt: string }>> {
  if (!z.string().uuid().safeParse(bookingId).success) return { ok: false, error: "That booking was not found." };
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("golfer_check_in", { p_booking_id: bookingId });
  if (error) return toActionError(error);
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, data: { checkedInAt: data } };
}
