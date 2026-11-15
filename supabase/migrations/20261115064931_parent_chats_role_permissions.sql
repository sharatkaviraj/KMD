-- D-616: who answers parents in Chats, kept where every permission addition
-- is kept (`*_role_permissions.sql`). The promotion seed
-- (scripts/migrate/lib/quarantine-rules.mjs#rolePermissionSeed) and
-- tests/scoped-reads.test.ts read the role -> permission map from those files.
--
-- 20261115034215_parent_chats.sql already wrote these rows on One, so on One
-- this changes nothing (on conflict do nothing). Rows only; additive.
--
-- chats:reply  "Chat with parents": the class teacher answers their own
--              class's parents, the fee desk the accounts chats, the office
--              the office's.
-- chats:all    "See every chat": every desk, filtered, and taking a chat over.
-- The admin rows are what lets Staff -> Roles offer these to other roles.
insert into vppsone.role_permissions (role, permission) values
  ('admin', 'chats:reply'),
  ('admin', 'chats:all'),
  ('office', 'chats:reply'),
  ('accountant', 'chats:reply'),
  ('fee_collector', 'chats:reply'),
  ('academic_coordinator', 'chats:reply'),
  ('exam_coordinator', 'chats:reply'),
  ('teacher', 'chats:reply')
on conflict (role, permission) do nothing;
