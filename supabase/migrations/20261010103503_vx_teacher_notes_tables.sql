-- Replies on notes, "Got it" on staff notices, and the queue of messages to
-- parents (absent alerts, birthday wishes, notes, support plans).
--
-- support_plans / support_plan_steps belong to vx_academics_calendar; the
-- notes screens add only what they need on top. Leave requests reuse
-- vppsone.teacher_leave and "large text" reuses vppsone.staff_ui_preferences.
--
-- parent_message_queue is QUEUED ONLY: nothing in VPPS One sends it.
set local lock_timeout = '15s';

alter table vppsone.support_plans
  add column if not exists class_id uuid,
  add column if not exists note_id uuid references vppsone.notes (id) on delete set null,
  add column if not exists tell_parents boolean not null default false;
create index if not exists support_plans_by_note_idx on vppsone.support_plans (note_id);

alter table vppsone.support_plan_steps
  add column if not exists owner_role text,
  add column if not exists created_by uuid references vppsone.staff_profiles (id) on delete set null,
  add column if not exists removed_by uuid references vppsone.staff_profiles (id) on delete set null;
alter table vppsone.support_plan_steps
  add constraint support_plan_steps_owner_role_known
  check (owner_role is null or owner_role in ('me', 'class_teacher', 'subject_teacher', 'coordinator', 'admin', 'parents'));

create table vppsone.note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references vppsone.notes (id) on delete cascade,
  body text not null,
  source text not null default 'typed',
  written_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint note_replies_body_not_blank check (btrim(body) <> '' and length(body) <= 1000),
  constraint note_replies_source_known check (source in ('typed', 'voice', 'system'))
);
comment on table vppsone.note_replies is
  'Replies on a note about a child. Insert-only: a reply is never edited, so the thread is a record.';
create index note_replies_by_note_idx on vppsone.note_replies (note_id, created_at);
alter table vppsone.note_replies enable row level security;
create policy note_replies_select_with_note
  on vppsone.note_replies for select to authenticated
  using (exists (select 1 from vppsone.notes n where n.id = note_id));
grant select on vppsone.note_replies to authenticated;
grant select, insert on vppsone.note_replies to service_role;

create table vppsone.staff_notice_reads (
  campaign_id uuid not null references vppsone.message_campaigns (id) on delete cascade,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (campaign_id, staff_profile_id)
);
comment on table vppsone.staff_notice_reads is
  'A member of staff tapped "Got it" on a notice the office sent to staff. The office sees who has read it.';
alter table vppsone.staff_notice_reads enable row level security;
create policy staff_notice_reads_select
  on vppsone.staff_notice_reads for select to authenticated
  using (
    staff_profile_id = (select vppsone.current_staff_profile_id())
    or (select vppsone.staff_can('messages:send'))
  );
grant select on vppsone.staff_notice_reads to authenticated;
grant all on vppsone.staff_notice_reads to service_role;

create table vppsone.parent_message_queue (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  kind text not null,
  student_id uuid not null,
  class_id uuid,
  register_id uuid references vppsone.attendance_registers (id) on delete set null,
  note_id uuid references vppsone.notes (id) on delete set null,
  plan_id uuid references vppsone.support_plans (id) on delete set null,
  day date,
  body_hi text not null,
  body_en text,
  status text not null default 'queued',
  queued_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references vppsone.staff_profiles (id) on delete set null,
  constraint parent_message_queue_kind_known check (kind in ('absent_alert', 'birthday', 'note', 'support_plan')),
  constraint parent_message_queue_status_known check (status in ('queued', 'cancelled'))
);
comment on table vppsone.parent_message_queue is
  'Messages to parents a teacher asked for. QUEUED ONLY: nothing in VPPS One sends these. A person previews and sends from Messages (RULES H; CLAUDE.md rule 8).';
create unique index parent_message_queue_one_absent_alert
  on vppsone.parent_message_queue (register_id, student_id)
  where kind = 'absent_alert' and status = 'queued';
create index parent_message_queue_recent_idx on vppsone.parent_message_queue (created_at desc);
alter table vppsone.parent_message_queue enable row level security;
create policy parent_message_queue_select
  on vppsone.parent_message_queue for select to authenticated
  using (
    queued_by = (select vppsone.current_staff_profile_id())
    or (select vppsone.staff_can('messages:send'))
  );
grant select on vppsone.parent_message_queue to authenticated;
grant all on vppsone.parent_message_queue to service_role;
