-- P2 (Gates B and D): when periods happen, and what a team block needs.
--
-- Two facts the timetable never held, both school policy rather than data the
-- sheet can be parsed for, both edited by whoever arranges cover:
--
--  1. `bell_schedules` — the time of each period. One current row per session,
--     versioned by `revision`, seeded with the regular profile Raj chose as the
--     editable default on 4 October (eight 40-minute periods from 08:30, a
--     break 11:10-11:30, the day ending 14:10, Asia/Kolkata). The cover command
--     refuses to arrange a period that has started, and says which bells it
--     judged that by.
--  2. `team_supervision_rules` — how many of a team block's teachers must be
--     present for it to run without help (ELGA: some number of five). With no
--     rule, any absence from a team is shown to a person and never arranged
--     automatically (src/modules/substitutions/domain/events.ts).
--
-- Additive. Nothing here touches fee data.

create table vppsone.bell_schedules (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  label text not null default 'Regular',
  /** [{"index":0,"starts":"08:30","ends":"09:10"}, ...], school wall-clock. */
  periods jsonb not null,
  revision integer not null default 1,
  is_current boolean not null default true,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bell_schedules_periods_array check (jsonb_typeof(periods) = 'array'),
  constraint bell_schedules_revision_positive check (revision > 0)
);

comment on table vppsone.bell_schedules is
  'When each period happens, per session. One current row; revision bumps on every edit so a cover plan can name the bells it was judged by.';

create unique index bell_schedules_one_current
  on vppsone.bell_schedules (session_label) where is_current;

create trigger bell_schedules_set_updated_at
  before update on vppsone.bell_schedules
  for each row execute function vppsone.set_updated_at();

alter table vppsone.bell_schedules enable row level security;
create policy bell_schedules_select_active_staff
  on vppsone.bell_schedules for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.bell_schedules to authenticated;
grant all on vppsone.bell_schedules to service_role;

-- The regular profile for every session the school has enrolments in.
insert into vppsone.bell_schedules (session_label, label, periods)
select distinct e.session_label, 'Regular', '[
  {"index":0,"starts":"08:30","ends":"09:10"},
  {"index":1,"starts":"09:10","ends":"09:50"},
  {"index":2,"starts":"09:50","ends":"10:30"},
  {"index":3,"starts":"10:30","ends":"11:10"},
  {"index":4,"starts":"11:30","ends":"12:10"},
  {"index":5,"starts":"12:10","ends":"12:50"},
  {"index":6,"starts":"12:50","ends":"13:30"},
  {"index":7,"starts":"13:30","ends":"14:10"}
]'::jsonb
from vppsone.enrolments e
on conflict do nothing;

create table vppsone.team_supervision_rules (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  subject_code text not null,
  minimum_present smallint not null,
  note text,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_supervision_rules_minimum_sane check (minimum_present between 1 and 15)
);

comment on table vppsone.team_supervision_rules is
  'A school rule for a team block (ELGA): how many of its teachers must be present for it to run without help. No row means the block is unmapped and every absence from it is shown to a person.';

create unique index team_supervision_rules_unique
  on vppsone.team_supervision_rules (session_label, subject_code);

create trigger team_supervision_rules_set_updated_at
  before update on vppsone.team_supervision_rules
  for each row execute function vppsone.set_updated_at();

alter table vppsone.team_supervision_rules enable row level security;
create policy team_supervision_rules_select_active_staff
  on vppsone.team_supervision_rules for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.team_supervision_rules to authenticated;
grant all on vppsone.team_supervision_rules to service_role;
