-- ============================================================================
-- VPPS One fee-migration (One-only): put public.office_sync_events back into the
-- supabase_realtime publication.
--
-- Why this differs from the fees app: it does not. The fees app's
-- 20260516100000_office_sync_events.sql adds the table to the publication; the
-- table reached wtgxcptmucjerhufzjcf through the masked replica, but publication
-- membership is not part of a table copy (critique1 B1), so on wtgx
-- OfficeSyncListener (src/ui/shell/office-sync-listener.tsx) subscribed to a
-- table that never published anything. Found by the 30 Oct schema parity check
-- (docs/cutover/SCHEMA-PARITY.md). The block is the fees original's, verbatim.
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table public.office_sync_events;
exception
  when duplicate_object then null;
end
$$;
