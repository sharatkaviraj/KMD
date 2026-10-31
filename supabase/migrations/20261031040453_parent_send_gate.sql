-- One gate for every WhatsApp message to a parent (go-live Phase D; plan §6.3,
-- critique0 #10, #30; D-353).
--
-- `src/modules/whatsapp/data/aisensy.ts` refuses a parent send unless, in
-- order: the deployment is VPPSONE_ENV=live, `runtime_flags.parent_dispatch`
-- is on, `runtime_flags.parent_dispatch_categories` lists the notice's kind,
-- and — when the session is a test session, the actor is a test account, or
-- the deployment is not Vercel production — the destination is in
-- `message_test_recipients`. Every read that fails refuses.
--
-- What this migration adds:
--
--  * `runtime_flags.value` (jsonb), for the two switches that are not a plain
--    on/off: `parent_dispatch_categories` (a JSON array of notice kinds) and
--    `absent_notice_owner` ("fees_notice" or "native": which path may tell a
--    parent their child is absent, so a family never gets both).
--  * `parent_dispatch_categories` seeded to `[]`: no category may send until
--    the owner names it.
--  * `absent_notice_owner` seeded to "fees_notice": the fees app's school
--    notice is how parents are told today, and One's native register message
--    (D-320) stays behind the approval rules of D-10 either way.
--  * `message_test_recipients`: the only numbers a test session, a test
--    account or a non-production deployment may message. Empty: numbers are
--    added by the operator in SQL, never by a migration (rule 6).
--
-- Additive. Service role reads all of it; `authenticated` keeps its existing
-- SELECT on runtime_flags (table-level, so the new column is covered) and gets
-- nothing on the allowlist.
--
-- Rollback:
--   drop table vppsone.message_test_recipients;
--   delete from vppsone.runtime_flags where key in ('parent_dispatch_categories', 'absent_notice_owner');
--   alter table vppsone.runtime_flags drop constraint runtime_flags_key_known;
--   alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
--     key in ('cover_command', 'staff_notice_dispatch', 'fault_injection', 'parent_dispatch'));
--   alter table vppsone.runtime_flags drop column value;

alter table vppsone.runtime_flags add column if not exists value jsonb;

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner'
  )
);

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_value_shape;
alter table vppsone.runtime_flags add constraint runtime_flags_value_shape check (
  case key
    when 'parent_dispatch_categories' then value is not null and jsonb_typeof(value) = 'array'
    when 'absent_notice_owner' then value is null or value in ('"fees_notice"'::jsonb, '"native"'::jsonb)
    else true
  end
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('parent_dispatch_categories', true, '[]'::jsonb,
   'Notice kinds that may reach a parent once parent_dispatch is on: fee_reminder, receipt, reversal, fee_statement, school_notice, absent_notice, collection_request, report_delivery, general. Empty until the owner names them.'),
  ('absent_notice_owner', true, '"fees_notice"'::jsonb,
   'Which path tells a parent their child is absent: fees_notice (the ported school notice) or native (the register message, D-320). Never both.')
on conflict (key) do nothing;

comment on column vppsone.runtime_flags.value is
  'Structured value for switches that are not plain on/off (parent_dispatch_categories, absent_notice_owner).';

create table if not exists vppsone.message_test_recipients (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text not null check (char_length(label) between 1 and 120),
  added_by uuid references vppsone.staff_profiles (id) on delete set null,
  added_at timestamptz not null default now()
);

comment on table vppsone.message_test_recipients is
  'The only numbers a test session, a test account or a non-production deployment may WhatsApp (plan §6.3). Added by the operator in SQL; never seeded by a migration.';

alter table vppsone.message_test_recipients enable row level security;
revoke all on vppsone.message_test_recipients from public, anon, authenticated;
grant select, insert, update, delete on vppsone.message_test_recipients to service_role;
