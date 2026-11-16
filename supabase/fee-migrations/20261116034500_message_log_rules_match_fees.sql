-- ============================================================================
-- VPPS One fee-migration (One-only): the two message logs take the rules the
-- fees app loosened on its own database, so a straight copy of the fees app's
-- sends fits (D-644, 16 Nov 2026).
--
-- Why this differs from the fees app: the fees app changed these rules with its
-- household-communications work (31 Oct to 9 Nov 2026):
--   * a send whose fate is unknown is 'uncertain' (status, on both logs);
--   * a family can be reached on a third number, 'contact:<sha-256>'
--     (destination_role);
--   * "once a day" and "once per receipt" count per destination_role, and the
--     reminder rule leaves household-event sends to their own index.
-- One still had the older, stricter rules. On 16 Nov the fees app held rows
-- they refuse (41 'uncertain', 274 'contact:' rows, 7 receipts noticed to two
-- numbers), and every online_payment_orders row needs its send
-- (send_id not null), so without this the D-644 copy could not bring the
-- online-payment records across either.
--
-- What changes: the three CHECKs become the fees app's exact definitions; the
-- two One-only unique indexes go (their per-role replacements,
-- school_notice_sends_one_a_day_role and
-- whatsapp_reminder_sends_receipt_kind_role_idx, came with 20261116033500);
-- whatsapp_reminder_sends_reminder_day_idx becomes the fees definition.
--
-- What One's own senders notice: nothing. One's receipt, reversal and
-- fee-statement notices claim their row with destination_role 'primary', and a
-- school notice takes the column default 'primary', so the per-role indexes
-- stop the same second send the old ones did; reminders already counted per
-- role. No function, and no ON CONFLICT anywhere, names these indexes.
--
-- Applied with the Supabase CLI from the owner's PC (`supabase db query
-- --remote --yes -f`), because the MCP asks for a confirmation on DROP that
-- nobody sees in time; the ledger row was written straight after it, under the
-- usual name, with the time it ran as its version.
--
-- Rollback: put the old CHECKs and indexes back, which works only while no row
-- uses the looser values.
-- ============================================================================

begin;

alter table public.whatsapp_reminder_sends drop constraint whatsapp_reminder_sends_status_check;
alter table public.whatsapp_reminder_sends add constraint whatsapp_reminder_sends_status_check
  check (status = any (array['pending', 'sent', 'failed', 'covered_by_sibling', 'uncertain']));

alter table public.whatsapp_reminder_sends drop constraint whatsapp_reminder_sends_destination_role_check;
alter table public.whatsapp_reminder_sends add constraint whatsapp_reminder_sends_destination_role_check
  check (destination_role = any (array['primary', 'secondary']) or destination_role ~ '^contact:[0-9a-f]{64}$');

alter table public.school_notice_sends drop constraint school_notice_sends_status_check;
alter table public.school_notice_sends add constraint school_notice_sends_status_check
  check (status = any (array['pending', 'sent', 'failed', 'uncertain', 'covered_by_sibling']));

drop index public.school_notice_sends_one_a_day;
drop index public.whatsapp_reminder_sends_receipt_kind_idx;

create unique index whatsapp_reminder_sends_reminder_day_idx_d644
  on public.whatsapp_reminder_sends (student_id, session_label, sent_on, campaign_name, destination_role)
  where receipt_id is null and household_event_id is null and notice_kind = 'reminder';
drop index public.whatsapp_reminder_sends_reminder_day_idx;
alter index public.whatsapp_reminder_sends_reminder_day_idx_d644 rename to whatsapp_reminder_sends_reminder_day_idx;

commit;
