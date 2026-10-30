-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261029020128_online_payments_server_grants.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- The server role gets exactly what the online-payments design gives it.
--
-- `20261028140100` granted service_role SELECT, INSERT, UPDATE (and only
-- SELECT, INSERT on the audit) without first revoking what Supabase's default
-- privileges hand every new table in `public`: ALL, including DELETE and
-- TRUNCATE. On production the five tables therefore allowed both. TRUNCATE
-- matters most on the audit, because it skips the append-only row trigger.
-- Nothing in the app deletes from these tables; money records are kept, not
-- removed.
--
-- The schoolfees-dev project has no such default, which is why the dry run there
-- saw "permission denied" and production did not.

begin;

revoke all on public.online_payment_intents,
              public.online_payment_events,
              public.online_payment_captures,
              public.notification_outbox,
              public.online_payment_audit
  from service_role;

grant select, insert, update on public.online_payment_intents,
                                 public.online_payment_events,
                                 public.online_payment_captures,
                                 public.notification_outbox
  to service_role;

grant select, insert on public.online_payment_audit to service_role;

commit;
