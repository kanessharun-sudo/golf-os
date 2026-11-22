-- =============================================================================
-- Golf OS — 004_function_privileges.sql
-- Postgres grants EXECUTE on every new function to PUBLIC, and anon inherits
-- PUBLIC. Migrations 001/003 revoked EXECUTE "from anon" only, which left the
-- PUBLIC grant in place, so anon could still call write RPCs. cancel_booking
-- skips its ownership check when auth.uid() is null (the service-role path),
-- so an anonymous caller holding a booking id could cancel it.
--
-- Fix: deny by default, then grant each function to exactly the roles that need it.
--   * Trigger functions need no grant: EXECUTE is checked when CREATE TRIGGER
--     runs, not when the trigger fires.
--   * Functions referenced by RLS policies, CHECK constraints or SECURITY
--     INVOKER triggers run as the calling role, so those roles keep EXECUTE.
-- =============================================================================

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- RLS and storage policy helpers (policies are evaluated as the querying role).
grant execute on function public.is_super_admin()                    to anon, authenticated;
grant execute on function public.is_course_admin(uuid)               to anon, authenticated;
grant execute on function public.is_course_visible(uuid)             to anon, authenticated;
grant execute on function public.is_booking_participant(uuid)        to anon, authenticated;
grant execute on function public.is_round_participant(uuid)          to anon, authenticated;
grant execute on function public.is_public_round_player(uuid)        to anon, authenticated;
grant execute on function public.current_caddy_id()                  to anon, authenticated;
grant execute on function public.try_uuid(text)                      to anon, authenticated;

-- CHECK constraint validators and helpers called from SECURITY INVOKER triggers.
grant execute on function public.is_valid_course_pricing(jsonb)      to authenticated;
grant execute on function public.is_valid_course_media(jsonb)        to authenticated;
grant execute on function public.is_valid_cancellation_policy(jsonb) to authenticated;
grant execute on function public.is_end_user_context()               to authenticated;

-- Public read RPCs.
grant execute on function public.get_tee_sheet(uuid, date)                                  to anon, authenticated;
grant execute on function public.get_available_caddies(uuid, date, time, public.hole_format) to anon, authenticated;
grant execute on function public.get_course_caddies(uuid)                                   to anon, authenticated;

-- Signed-in golfer RPCs (each checks auth.uid() ownership internally).
grant execute on function public.acquire_slot_hold(uuid, date, time, public.hole_format, smallint, boolean) to authenticated;
grant execute on function public.release_slot_hold(uuid)                                    to authenticated;
grant execute on function public.save_hold_details(uuid, jsonb, uuid, public.round_mode)   to authenticated;
grant execute on function public.hold_caddy(uuid, uuid, smallint)                          to authenticated;
grant execute on function public.release_hold_caddy(uuid, smallint)                        to authenticated;
grant execute on function public.quote_slot_hold(uuid)                                     to authenticated;
grant execute on function public.cancel_booking(uuid, text)                                to authenticated;
grant execute on function public.get_hold_caddies(uuid)                                    to authenticated;
grant execute on function public.get_booking_caddies(uuid)                                 to authenticated;

-- Server-only RPCs (payment confirmation, refunds, hold expiry job).
grant execute on function public.attach_razorpay_order(uuid, text, integer)  to service_role;
grant execute on function public.confirm_hold_payment(text, text, integer)   to service_role;
grant execute on function public.mark_booking_refunded(uuid, text)           to service_role;
grant execute on function public.cancel_booking(uuid, text)                  to service_role;
grant execute on function public.expire_stale_holds()                        to service_role;
