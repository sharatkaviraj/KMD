-- Fake seed for /receipts (schoolfees-dev only). One counted close of a past
-- desk day so the "closed" state has something to show. Invented staff name.
-- Insert-only and re-runnable: guarded by the '[seed]' marker in the note.

insert into vppsone.fee_day_close_events
  (payment_date, action, session_label, expected, denominations, cash_expected, cash_counted,
   upi_checked, receipt_count, reversed_count, note, actor_name, created_at)
select '2026-09-19', 'close', '2026-27',
  '{"cash": 0, "upi": 0, "cheque": 0, "bank": 0}'::jsonb,
  '{}'::jsonb, 0, 0, true, 0, 0,
  '[seed] Counted at the desk, all matched.', 'Test Desk Clerk', '2026-09-19T12:30:00Z'
where not exists (select 1 from vppsone.fee_day_close_events where note like '[seed]%');
