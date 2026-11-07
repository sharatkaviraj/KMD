-- D-476: Reports gets its own switch, fees:reports ("See fee reports" on
-- Staff -> Roles), so the admin decides who opens the fee reports apart from
-- who reads the other fee screens. On for the roles that had Reports before
-- and whose Fees role carries reports:view; off for the office (owner,
-- 7 Nov 2026: the two Viewers do not get reports). Rows only; additive.
-- The admin row comes first because set_role_permissions only offers a
-- permission the admin role already holds.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'fees:reports'),
  ('accountant', 'fees:reports'),
  ('fee_collector', 'fees:reports')
on conflict do nothing;
