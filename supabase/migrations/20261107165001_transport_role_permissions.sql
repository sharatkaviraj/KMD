-- Transport's two switches on Staff -> Roles (owner, 7 Nov 2026, D-520).
--
-- transport:view   open Transport: routes, bus times, drivers and the
--                  children on each bus.
-- transport:manage add and change drivers and bus trips.
--
-- On for the admin (every permission is, and set_role_permissions only knows
-- a permission the Admin column holds) and for the office, whose Transport
-- tile this replaces. Any other role is one switch away on Staff -> Roles.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'transport:view'),
  ('admin', 'transport:manage'),
  ('office', 'transport:view'),
  ('office', 'transport:manage')
on conflict do nothing;
