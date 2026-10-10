-- Fake seed for /reminders (schoolfees-dev only). The four automatic rules
-- from the design and one queued batch. Nothing here sends: batches are
-- QUEUED ONLY and the rules are settings read by the screen.
-- Insert-only and re-runnable.

insert into vppsone.fee_reminder_rules
  (rule_key, title_en, title_hi, icon, timing_options, timing_choice, send_time, audience, template, quiet_hours, enabled, sort_order)
values
  ('before_due', '3 days before a due date', 'देय तिथि से 3 दिन पहले', 'calendar', '{1,3,7}', '3', '10', 'all', 'upcoming', true, true, 1),
  ('on_due', 'On the due date', 'देय तिथि पर', 'bell', '{0}', '0', '10', 'all', 'gentle', true, true, 2),
  ('after_due', '7 days after a due date', 'देय तिथि के 7 दिन बाद', 'alert', '{3,7,15}', '7', '12', 'skip_promised', 'gentle', true, false, 3),
  ('weekly_90', 'Every Monday for 90+ days overdue', '90+ दिन बकाया पर हर सोमवार', 'refresh', '{mon,thu}', 'mon', '10', 'skip_promised', 'final', true, false, 4)
on conflict (rule_key) do nothing;

insert into vppsone.fee_reminder_batches
  (session_label, name, template, language, audience, audience_line, student_ids, family_count, money_quoted, cost_estimate, status, created_by_name, created_at)
select '2026-27', '[seed] Inst 2 gentle reminder', 'gentle', 'both',
  '{"pendingToday": true, "inst2": true, "big": false, "bus": false, "bands": [], "excludePromised": true, "excludePaidRecently": true, "excludeLeft": true}'::jsonb,
  'Pending today · Inst 2 · all classes', '{}', 0, 0, 0, 'queued', 'Test Desk Clerk', '2026-10-08T05:00:00Z'
where not exists (select 1 from vppsone.fee_reminder_batches where name like '[seed]%');
