-- Toilet checks' three switches on Staff -> Roles (owner, 17 Nov 2026, D-652).
--
-- toilets:view    open Toilet checks, print the charts, see the photos.
-- toilets:upload  upload a photographed chart.
-- toilets:manage  add, rename and remove toilets; set the check times and the
--                 tick list; take off a wrong photo.
-- The admin's (every permission is) and the office's. Any other role is one
-- switch away on Staff -> Roles.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'toilets:view'),
  ('admin', 'toilets:upload'),
  ('admin', 'toilets:manage'),
  ('office', 'toilets:view'),
  ('office', 'toilets:upload'),
  ('office', 'toilets:manage')
on conflict (role, permission) do nothing;
