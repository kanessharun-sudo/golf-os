import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AvailableCaddy } from "@/types/database";
import { CheckoutFlow } from "./checkout-flow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ holdId: string }> }) {
  const { holdId } = await params;
  if (!z.string().uuid().safeParse(holdId).success) notFound();

  const session = await getSessionContext();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/checkout/${holdId}`)}`);

  const supabase = await getSupabaseServerClient();
  const { data: hold, error } = await supabase
    .from("slot_holds")
    .select("*, courses(id, slug, name, pricing, max_players_per_slot, cancellation_policy)")
    .eq("id", holdId)
    .maybeSingle();
  if (error) throw new Error(`Hold lookup failed: ${error.message}`);
  if (!hold) notFound();
  if (hold.status === "converted" && hold.converted_booking_id) {
    redirect(`/bookings/${hold.converted_booking_id}?paid=1`);
  }

  const [tees, players, heldCaddies, available] = await Promise.all([
    supabase.from("course_tees").select("id, name, color_hex, total_yards, is_default").eq("course_id", hold.course_id).eq("is_active", true).order("sort_order"),
    supabase.from("slot_hold_players").select("*").eq("hold_id", holdId).order("seat_number"),
    supabase.rpc("get_hold_caddies", { p_hold_id: holdId }),
    supabase.rpc("get_available_caddies", {
      p_course_id: hold.course_id,
      p_play_date: hold.play_date,
      p_tee_time: hold.tee_time,
      p_hole_format: hold.hole_format,
    }),
  ]);
  if (tees.error) throw new Error(`Tees lookup failed: ${tees.error.message}`);

  // Past the booking cut-off the RPC refuses; the golfer can still pay for seats already held.
  const availableCaddies: AvailableCaddy[] = available.error ? [] : available.data;

  return (
    <CheckoutFlow
      hold={{
        id: hold.id,
        status: hold.status,
        expiresAt: hold.expires_at,
        playDate: hold.play_date,
        teeTime: hold.tee_time,
        startHole: hold.start_hole,
        holeFormat: hold.hole_format,
        seats: hold.seats,
        isPrivate: hold.is_private,
        teeId: hold.tee_id,
        mode: hold.mode,
        orderId: hold.razorpay_order_id,
      }}
      course={{
        slug: hold.courses.slug,
        name: hold.courses.name,
        pricing: hold.courses.pricing,
        cancellationPolicy: hold.courses.cancellation_policy,
      }}
      tees={tees.data}
      savedPlayers={players.data ?? []}
      heldCaddies={heldCaddies.data ?? []}
      availableCaddies={availableCaddies}
      bookerName={session.profile.full_name}
    />
  );
}
