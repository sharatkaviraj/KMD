-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261029030619_guarded_staff_reads_not_callable_by_anon.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- Two guarded staff reads stop being callable with the browser key.
--
-- Supabase's security advisor on production (2026-10-29) reported that `anon`
-- can execute public.get_dashboard_analytics(text) and
-- public.preview_workbook_payment_allocation(uuid, date). Both are SECURITY
-- DEFINER and both carried `=X/postgres`: EXECUTE for PUBLIC, which `anon` is
-- part of.
--
-- Neither leaked anything. get_dashboard_analytics raises unless the caller is
-- service_role or has dashboard:view / finance:view, and the preview filters
-- every row on a permission list. Called over REST with the publishable key on
-- production, the first answered "You do not have permission to read dashboard
-- analytics." and the second [] for a student the engine owes five rows on.
-- This takes away the grant those guards were covering for, so a later rebuild
-- that loses a guard does not hand the browser key a family's dues.
--
-- How the grant came back: 20260523164957 ran `alter default privileges in
-- schema public revoke execute on functions from public`. A per-schema default
-- can only add to the global one, never take away from it, and the global
-- default gives PUBLIC EXECUTE on every new function. So every `create function`
-- in public comes out callable by PUBLIC: 20260812150000 created the analytics
-- read, and 20260812120000 and 20260905064847 dropped and recreated the preview,
-- each granting authenticated and service_role without revoking PUBLIC.
-- **A migration that creates or drops-and-recreates a function in public must
-- revoke EXECUTE from public, anon in the same file.**
--
-- Keeps EXECUTE: authenticated (Payment Desk preview, the system-sync health
-- probe, the dashboard when no service key is set) and service_role (the
-- dashboard's cache-safe client, the MCP worker, scripts). Loses it: anon, and
-- the roles that only had it through PUBLIC (notion_fee_sync_role,
-- dashboard_user, the Supabase platform roles). No view, function, cron job or
-- edge function calls either one as those roles.
--
-- Function bodies are untouched. Rollback:
--   grant execute on function public.get_dashboard_analytics(text) to public;
--   grant execute on function public.preview_workbook_payment_allocation(uuid, date) to public;

begin;

revoke execute on function public.get_dashboard_analytics(text) from public, anon;
revoke execute on function public.preview_workbook_payment_allocation(uuid, date) from public, anon;

grant execute on function public.get_dashboard_analytics(text) to authenticated, service_role;
grant execute on function public.preview_workbook_payment_allocation(uuid, date) to authenticated, service_role;

commit;
