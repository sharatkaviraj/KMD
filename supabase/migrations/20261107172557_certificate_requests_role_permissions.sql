-- D-542: certificate requests. A teacher asks for a study, character or
-- date-of-birth certificate for a child in her own classes
-- (certificates:request, "Ask for a certificate"); an approver signs and seals
-- it (certificates:approve, "Approve teachers' requests" on Staff -> Roles).
-- The admin holds both and teachers ask by default (owner, 7 Nov 2026).
-- Approving also needs certificates:issue, so another role gets it only when
-- the admin grants it in the matrix. Rows only; additive. The admin rows are
-- what lets set_role_permissions offer these to other roles at all.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'certificates:request'),
  ('admin', 'certificates:approve'),
  ('teacher', 'certificates:request')
on conflict do nothing;
