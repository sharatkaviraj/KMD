-- The redesigned app (docs/design-handoff) adds two screens that need their own
-- permission: Messages (send a notice to staff or families) and Settings
-- (school-wide settings and the role matrix). Rows only; additive.
-- tests/scoped-reads.test.ts reads this file alongside the authority seed.

insert into vppsone.role_permissions (role, permission) values
  ('admin', 'messages:send'),
  ('admin', 'settings:manage'),
  ('office', 'messages:send'),
  ('academic_coordinator', 'messages:send'),
  ('exam_coordinator', 'messages:send')
on conflict do nothing;
