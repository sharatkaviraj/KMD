-- Admin on/off switches for every message VPPS One queues for parents (owner,
-- 6 Nov 2026: "let admin make the switch on off of all the decisions that
-- needs to send to parent").
--
-- One row per kind of vppsone.parent_message_queue. `enabled` decides whether
-- the app queues that kind at all; `starts_on` is the register's parent switch
-- default for the first save of the day (D-320), read only for absent_alert.
-- Nothing here sends: the queue is still sent by a person from Messages → To
-- send. Seeded to today's behaviour, so applying this changes nothing until an
-- admin flips a switch.
--
-- Rollback: drop table vppsone.parent_message_switches;

create table if not exists vppsone.parent_message_switches (
  kind text primary key,
  enabled boolean not null default true,
  starts_on boolean not null default true,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint parent_message_switches_kind_known check (kind in ('absent_alert', 'birthday', 'note', 'support_plan'))
);
comment on table vppsone.parent_message_switches is
  'Admin switches: which kinds of parent_message_queue the app may queue, and whether the register''s parent switch starts on. Written by Settings → Messages to parents.';

insert into vppsone.parent_message_switches (kind, enabled, starts_on) values
  ('absent_alert', true, true),
  ('birthday', true, true),
  ('note', true, true),
  ('support_plan', true, true)
on conflict (kind) do nothing;

alter table vppsone.parent_message_switches enable row level security;
-- Read and written on the service role, after the caller's permission check.
grant select, insert, update on vppsone.parent_message_switches to service_role;
