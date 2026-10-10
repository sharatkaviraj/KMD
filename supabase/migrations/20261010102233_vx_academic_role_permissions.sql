-- The academic coordinator's attendance screen (docs/design-handoff SCREENS
-- "AcadAttendance") marks a class for a teacher on leave and approves change
-- requests from teachers (RULES C, F: "attendance oversight"). Those are the
-- two acts the office already has; the coordinator gets the same two rows.
-- Rows only; additive. tests/scoped-reads.test.ts reads this file.

insert into vppsone.role_permissions (role, permission) values
  ('academic_coordinator', 'attendance:mark_on_behalf'),
  ('academic_coordinator', 'attendance:correct')
on conflict do nothing;
