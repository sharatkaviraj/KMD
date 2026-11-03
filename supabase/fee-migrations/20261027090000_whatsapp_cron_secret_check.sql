-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261027090000_whatsapp_cron_secret_check.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- The morning timer's secret, checked where it lives.
--
-- `20261026120020` schedules pg_cron to call /api/cron/whatsapp-scheduled-runs
-- at 09:30 IST with Vault's `VPPS_WHATSAPP_CRON_SECRET`. The route used to
-- accept only Vercel env vars, so the same value had to be copied into a
-- `WHATSAPP_CRON_SECRET` on the production deployment — two copies of one
-- secret, and a copy nobody with database access could make. This lets the
-- route ask Postgres instead: is this the timer's secret, yes or no.
--
-- Never returns the secret. SECURITY DEFINER so it can read Vault; EXECUTE is
-- revoked from everyone but the service role, which is what the route calls
-- with. A NULL or wrong value is simply false.

create or replace function public.whatsapp_cron_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select ds.decrypted_secret = p_secret
      from vault.decrypted_secrets ds
      where ds.name = 'VPPS_WHATSAPP_CRON_SECRET'
      limit 1
    ),
    false
  );
$$;

revoke all on function public.whatsapp_cron_secret_matches(text) from public;
revoke all on function public.whatsapp_cron_secret_matches(text) from anon, authenticated;
grant execute on function public.whatsapp_cron_secret_matches(text) to service_role;

comment on function public.whatsapp_cron_secret_matches(text) is
  'True when p_secret equals Vault''s VPPS_WHATSAPP_CRON_SECRET. Lets '
  '/api/cron/whatsapp-scheduled-runs accept the pg_cron timer without a second copy of the '
  'secret in Vercel. Never returns the secret; service_role only.';
