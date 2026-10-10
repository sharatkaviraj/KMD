-- A fee reminder batch prepared on /reminders. QUEUED ONLY: nothing in VPPS
-- One sends these (CLAUDE.md rule 8). A person sends from the classic
-- WhatsApp screen after its own preview.

create table if not exists vppsone.fee_reminder_batches (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  name text not null,
  template text not null,
  language text not null default 'both',
  audience jsonb not null default '{}'::jsonb,
  audience_line text,
  student_ids uuid[] not null default '{}',
  family_count integer not null default 0,
  money_quoted numeric(14, 2) not null default 0,
  cost_estimate numeric(10, 2) not null default 0,
  status text not null default 'queued',
  scheduled_for timestamptz,
  created_by uuid references vppsone.staff_profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint fee_reminder_batches_template_known check (template in ('gentle', 'final', 'upcoming')),
  constraint fee_reminder_batches_language_known check (language in ('both', 'hi', 'en')),
  constraint fee_reminder_batches_status_known check (status in ('queued', 'scheduled', 'cancelled')),
  constraint fee_reminder_batches_name_not_blank check (btrim(name) <> '')
);
comment on table vppsone.fee_reminder_batches is
  'A fee reminder batch prepared on /reminders. QUEUED ONLY: nothing in VPPS One sends these (CLAUDE.md rule 8).';
create index if not exists fee_reminder_batches_recent_idx on vppsone.fee_reminder_batches (created_at desc);
alter table vppsone.fee_reminder_batches enable row level security;
create policy fee_reminder_batches_select on vppsone.fee_reminder_batches for select to authenticated
  using ((select vppsone.staff_can('fees:view')));
grant select on vppsone.fee_reminder_batches to authenticated;
grant select, insert, update on vppsone.fee_reminder_batches to service_role;
