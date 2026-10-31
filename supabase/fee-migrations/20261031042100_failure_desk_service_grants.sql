-- ============================================================================
-- VPPS One fee-migration, One-only (go-live Phase D). Applied to
-- wtgxcptmucjerhufzjcf through the Supabase MCP; never to the fees database.
--
-- Why it differs from the fees app: the fees app's
-- 20261030190000_whatsapp_failure_desk.sql grants nothing to service_role on
-- its two new tables, because live's ALTER DEFAULT PRIVILEGES in `public` hand
-- service_role ALL on every new table. One's database has no default
-- privileges there (SCHEMA-PARITY.md: "One stricter"), so after the catch-up
-- the service role could not read the attempts log or the number-health table
-- at all. These are the grants the failure desk's server code needs, and
-- nothing for anon or authenticated beyond the fees file's own SELECT.
-- (The fees file's own staff_payment_alerts grants are explicit and need no
-- help.) Pinned by tests/fee-catch-up-phase-d.test.ts.
-- ============================================================================

grant select, insert, update, delete on public.whatsapp_send_attempts to service_role;
grant select, insert, update, delete on public.whatsapp_number_health to service_role;
