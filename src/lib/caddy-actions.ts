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
