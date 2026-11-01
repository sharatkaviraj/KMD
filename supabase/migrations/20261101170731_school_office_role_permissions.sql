-- Additive capabilities for school-issued documents and official records.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'certificates:view'),
  ('admin', 'certificates:issue'),
  ('admin', 'certificates:manage'),
  ('admin', 'government:view'),
  ('admin', 'government:export'),
  ('admin', 'government:import'),
  ('admin', 'outcomes:view'),
  ('admin', 'outcomes:manage'),
  ('office', 'certificates:view'),
  ('office', 'certificates:issue'),
  ('office', 'government:view'),
  ('office', 'government:export'),
  ('office', 'government:import'),
  ('office', 'outcomes:view'),
  ('exam_coordinator', 'outcomes:view'),
  ('exam_coordinator', 'outcomes:manage')
on conflict do nothing;
