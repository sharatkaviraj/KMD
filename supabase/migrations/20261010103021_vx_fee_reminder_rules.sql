-- Settings of the automatic fee reminder rules shown on /reminders. Sending
-- stays with the fee app's scheduled sender; nothing here sends.

create table if not exists vppsone.fee_reminder_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  title_en text not null,
  title_hi text,
  icon text not null default 'bell',
  timing_options text[] not null default '{}',
  timing_choice text not null,
  send_time text not null default '10',
  audience text not null default 'all',
  template text not null default 'gentle',
  quiet_hours boolean not null default true,
  enabled boolean not null default false,
  sort_order integer not null default 0,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint fee_reminder_rules_send_time_known check (send_time in ('10', '12', '17', '19')),
  constraint fee_reminder_rules_audience_known check (audience in ('all', 'skip_promised')),
  constraint fee_reminder_rules_template_known check (template in ('gentle', 'final', 'upcoming'))
);
comment on table vppsone.fee_reminder_rules is
  'Settings of the automatic fee reminder rules shown on /reminders. Sending stays with the fee app''s scheduled sender.';
alter table vppsone.fee_reminder_rules enable row level security;
create policy fee_reminder_rules_select on vppsone.fee_reminder_rules for select to authenticated
  using ((select vppsone.staff_can('fees:view')));
grant select on vppsone.fee_reminder_rules to authenticated;
grant select, insert, update on vppsone.fee_reminder_rules to service_role;
