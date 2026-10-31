-- Test-only parent sending (owner, 31 Oct): AiSensy can be verified on the
-- owner's approved numbers while parent sending stays closed.
--
-- Before this, `src/platform/messaging/parent-send-gate.ts` refused every send
-- at `parent_dispatch = off`, before it ever looked at the allowlist, so the
-- only way to test a real send was to open sends to real parents.
--
-- `runtime_flags.parent_dispatch_test_only` (seeded OFF):
--   parent_dispatch OFF, test_only OFF -> every parent send refused (as before);
--   parent_dispatch OFF, test_only ON  -> a send passes ONLY when its number is
--     in `vppsone.message_test_recipients`, whatever the session or the sender;
--     `_v6` is still refused, VPPSONE_ENV must still be `live`, the category
--     list is not consulted;
--   parent_dispatch ON                 -> the gate as before (test_only unused).
-- A read that fails refuses. The switch is the operator's, set in SQL
-- (docs/cutover/AISENSY-TEMPLATES.md, "Test-only sending"); no app screen
-- writes it.
--
-- Grants: none new. `runtime_flags` keeps its table-level grants — the service
-- role reads and updates every row (the gate reads with it), `authenticated`
-- may only SELECT, `anon` nothing. Checked after applying with
-- has_table_privilege; pinned in tests/parent-send-gate.test.ts.
--
-- Rollback:
--   delete from vppsone.runtime_flags where key = 'parent_dispatch_test_only';
--   alter table vppsone.runtime_flags drop constraint runtime_flags_key_known;
--   alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
--     key in ('cover_command', 'staff_notice_dispatch', 'fault_injection', 'parent_dispatch',
--             'parent_dispatch_categories', 'absent_notice_owner'));

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only'
  )
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('parent_dispatch_test_only', false, null,
   'While parent_dispatch is off: on = a parent WhatsApp may go ONLY to a number in vppsone.message_test_recipients (testing AiSensy on approved numbers). Off = nothing goes. Ignored once parent_dispatch is on.')
on conflict (key) do nothing;
