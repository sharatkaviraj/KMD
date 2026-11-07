-- D-484, D-485: the AI report (reports:ai, "Download the AI report" on Staff -> Roles):
-- one file of everything One and Fees hold for a session, student photographs
-- included, for staff to give to an AI assistant. The admin's alone by default
-- (owner, 7 Nov 2026); the admin can grant it to another role in the matrix,
-- and what the file carries is still narrowed to what that reader may see.
-- Rows only; additive. The admin row is the only one: set_role_permissions
-- offers a permission to other roles only once the admin role holds it.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'reports:ai')
on conflict do nothing;
