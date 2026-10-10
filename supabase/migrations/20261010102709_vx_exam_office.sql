-- UI P9: the exam office — date sheet, rooms, seating, duties, question
-- papers, marks links, the results pipeline (moderation, grace, per-class
-- lock, rechecks, publishing) and class-teacher remarks.
--
-- Everything here is VPPS One's own and lives in `vppsone`. Marks are still
-- written only by `save_marks`; this adds one rule to it from the outside: a
-- class whose results are locked takes no more marks, from either app, until
-- the exam office unlocks it. That rule is a trigger, so it holds whoever
-- writes.

-- ---------------------------------------------------------------------------
-- One row of settings per exam
-- ---------------------------------------------------------------------------

create table vppsone.exam_plans (
  assessment_id uuid primary key references vppsone.assessments (id) on delete cascade,
  marks_due_on date,
  results_on date,
  ptm_at time,
  reporting_time time not null default '08:15',
  copied_from uuid references vppsone.assessments (id) on delete set null,
  datesheet_checked_at timestamptz,
  datesheet_published_at timestamptz,
  datesheet_published_by uuid references vppsone.staff_profiles (id) on delete restrict,
  grace_max numeric(4, 1) not null default 3,
  grace_subjects smallint not null default 2,
  results_publish_at timestamptz,
  results_published_at timestamptz,
  results_published_by uuid references vppsone.staff_profiles (id) on delete restrict,
  results_channels jsonb not null default '{"whatsapp": true, "ptm": true}'::jsonb,
  -- {step_key: {"at": timestamptz, "by": staff id}} for the coordinator's checklist.
  checklist jsonb not null default '{}'::jsonb,
  updated_by uuid references vppsone.staff_profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint exam_plans_grace_sane check (grace_max between 0 and 10 and grace_subjects between 0 and 5)
);
comment on table vppsone.exam_plans is
  'The exam office''s settings for one exam: marks due, results day, grace rule, publishing, and the checklist.';

-- ---------------------------------------------------------------------------
-- The date sheet: one sitting of one paper for one group of classes
-- ---------------------------------------------------------------------------

create table vppsone.exam_slots (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  -- 'pre', 'c1_5', 'c6_8', 'c9_10', 'c11_12' — the bands the date sheet is drawn in.
  group_key text not null,
  subject_label text not null,
  sits_on date not null,
  starts_at time not null,
  minutes integer not null,
  sort_order integer not null default 0,
  created_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_slots_group_known check (group_key in ('pre', 'c1_5', 'c6_8', 'c9_10', 'c11_12')),
  constraint exam_slots_length_sane check (minutes between 15 and 240),
  constraint exam_slots_subject_present check (length(btrim(subject_label)) between 1 and 80)
);
create index exam_slots_by_exam on vppsone.exam_slots (assessment_id, sits_on, starts_at);
comment on table vppsone.exam_slots is 'The date sheet: which paper each group of classes sits, when and for how long.';

-- ---------------------------------------------------------------------------
-- Rooms, seats, invigilation duties
-- ---------------------------------------------------------------------------

create table vppsone.exam_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  seats integer not null,
  cols smallint not null default 4,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint exam_rooms_seats_sane check (seats between 1 and 400 and cols between 1 and 12)
);
comment on table vppsone.exam_rooms is 'Rooms the school seats exams in, and how many each holds.';

create table vppsone.exam_seats (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  room_id uuid not null references vppsone.exam_rooms (id) on delete restrict,
  seat_no integer not null,
  class_id uuid not null,
  -- `public.students.id`, with no foreign key (rule 2).
  student_id uuid not null,
  created_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint exam_seats_one_per_child unique (assessment_id, student_id),
  constraint exam_seats_one_per_seat unique (assessment_id, room_id, seat_no)
);
comment on table vppsone.exam_seats is 'Who sits where for one exam. Rebuilt whole by the seating command.';

create table vppsone.exam_duties (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  sits_on date not null,
  room_id uuid not null references vppsone.exam_rooms (id) on delete restrict,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint exam_duties_once unique (assessment_id, sits_on, staff_profile_id)
);
create index exam_duties_by_room on vppsone.exam_duties (assessment_id, sits_on, room_id);
comment on table vppsone.exam_duties is 'Invigilation: one teacher in one room on one exam day.';

create table vppsone.exam_question_papers (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references vppsone.exam_slots (id) on delete cascade,
  setter_staff_id uuid references vppsone.staff_profiles (id) on delete restrict,
  status text not null default 'waiting',
  updated_by uuid references vppsone.staff_profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint exam_question_papers_status_known check (status in ('waiting', 'received', 'checked', 'printed'))
);
comment on table vppsone.exam_question_papers is 'Each sitting''s question paper: who sets it and how far it has got.';

-- ---------------------------------------------------------------------------
-- Marks links: one token per teacher per exam, no account needed
-- ---------------------------------------------------------------------------

create table vppsone.exam_marks_links (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  token text not null unique,
  created_by uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references vppsone.staff_profiles (id) on delete restrict,
  constraint exam_marks_links_token_shape check (token ~ '^[A-Za-z0-9_-]{16,64}$')
);
create unique index exam_marks_links_one_live
  on vppsone.exam_marks_links (assessment_id, staff_profile_id) where revoked_at is null;
comment on table vppsone.exam_marks_links is
  'A teacher''s marks link for one exam. It reaches only the papers the timetable gives her; save_marks checks that again.';

-- ---------------------------------------------------------------------------
-- The results pipeline
-- ---------------------------------------------------------------------------

create table vppsone.exam_class_locks (
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  class_id uuid not null,
  locked_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  locked_at timestamptz not null default now(),
  primary key (assessment_id, class_id)
);
comment on table vppsone.exam_class_locks is
  'A class whose results are locked for one exam. While a row is here no mark on its papers changes, from either app.';

create table vppsone.exam_moderation (
  paper_id uuid primary key references vppsone.assessment_subjects (id) on delete cascade,
  decision text not null,
  note text,
  decided_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint exam_moderation_decision_known check (decision in ('fine', 'recheck'))
);
comment on table vppsone.exam_moderation is 'The exam office''s look at a paper whose average moved a lot: fine, or sent back to recheck.';

create table vppsone.exam_grace (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references vppsone.assessment_subjects (id) on delete cascade,
  student_id uuid not null,
  grace numeric(4, 1) not null,
  applied_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  applied_at timestamptz not null default now(),
  constraint exam_grace_once unique (paper_id, student_id),
  constraint exam_grace_sane check (grace > 0 and grace <= 10)
);
comment on table vppsone.exam_grace is
  'Grace marks given to one child on one paper. Kept beside the mark, never added into it, so the card can say which is which.';

create table vppsone.exam_rechecks (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references vppsone.assessment_subjects (id) on delete cascade,
  student_id uuid not null,
  asked_by text not null,
  note text,
  status text not null default 'new',
  old_value numeric,
  new_value numeric,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_by uuid references vppsone.staff_profiles (id) on delete restrict,
  resolved_at timestamptz,
  constraint exam_rechecks_status_known check (status in ('new', 'with_teacher', 'changed', 'no_change')),
  constraint exam_rechecks_resolved_together check ((status in ('changed', 'no_change')) = (resolved_at is not null))
);
create index exam_rechecks_open on vppsone.exam_rechecks (paper_id) where resolved_at is null;
comment on table vppsone.exam_rechecks is 'A family or teacher asking for a paper to be looked at again, and what came of it.';

create table vppsone.report_card_remarks (
  session_label text not null,
  term text not null,
  student_id uuid not null,
  remark text not null,
  written_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (session_label, term, student_id),
  constraint report_card_remarks_length check (length(btrim(remark)) between 1 and 400)
);
comment on table vppsone.report_card_remarks is 'The class teacher''s one line on each child''s card for a term.';

create table vppsone.exam_reminders (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vppsone.assessments (id) on delete cascade,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  channel text not null,
  sent_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  sent_at timestamptz not null default now(),
  constraint exam_reminders_channel_known check (channel in ('whatsapp', 'copy', 'notice'))
);
comment on table vppsone.exam_reminders is
  'Reminders to late teachers. The coordinator sends them from her own phone; this records that she did.';

-- Append-only: what happened in an exam, newest first on the coordinator's home.
create table vppsone.exam_activity (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid references vppsone.assessments (id) on delete cascade,
  kind text not null,
  text_en text not null,
  text_hi text,
  actor_staff_id uuid references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index exam_activity_recent on vppsone.exam_activity (assessment_id, created_at desc);
comment on table vppsone.exam_activity is 'What happened in an exam, in order. Never edited.';

create or replace function vppsone.exam_activity_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A cascade from a deleted exam is the one way a row leaves.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'exam_activity is append-only';
end;
$$;

create trigger exam_activity_no_update before update or delete on vppsone.exam_activity
  for each row execute function vppsone.exam_activity_append_only();

-- ---------------------------------------------------------------------------
-- A locked class takes no marks
-- ---------------------------------------------------------------------------

create or replace function vppsone.marks_respect_class_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_paper uuid := coalesce(new.assessment_subject_id, old.assessment_subject_id);
begin
  if exists (
    select 1 from vppsone.assessment_subjects s
    join vppsone.exam_class_locks l on l.assessment_id = s.assessment_id and l.class_id = s.class_id
    where s.id = v_paper
  ) then
    raise exception 'marks:paper_locked';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger marks_class_lock before insert or update or delete on vppsone.marks
  for each row execute function vppsone.marks_respect_class_lock();

create or replace function vppsone.papers_respect_class_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entry_revision is distinct from old.entry_revision and exists (
    select 1 from vppsone.exam_class_locks l
    where l.assessment_id = new.assessment_id and l.class_id = new.class_id
  ) then
    raise exception 'marks:paper_locked';
  end if;
  return new;
end;
$$;

create trigger assessment_subjects_class_lock before update on vppsone.assessment_subjects
  for each row execute function vppsone.papers_respect_class_lock();

-- ---------------------------------------------------------------------------
-- A teacher takes back her own submission, within ten minutes
-- ---------------------------------------------------------------------------

create or replace function vppsone.withdraw_marks_submission(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_paper uuid;
  v_expected integer;
  s vppsone.assessment_subjects%rowtype;
  a vppsone.assessments%rowtype;
begin
  begin
    v_actor := (p->>'actor_staff_id')::uuid;
    v_paper := (p->>'paper_id')::uuid;
    v_expected := (p->>'expected_revision')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_actor is null or v_paper is null or v_expected is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  select * into s from vppsone.assessment_subjects where id = v_paper for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into a from vppsone.assessments where id = s.assessment_id;
  if a.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'exam_not_open');
  end if;
  if s.entry_status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'not_submitted');
  end if;
  if s.entry_revision <> v_expected then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;
  -- Only her own submission, and only while it is fresh. After that it is the
  -- exam office's to hand back (save_marks 'reopen').
  if s.submitted_by is distinct from v_actor then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  if s.submitted_at < now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  update vppsone.assessment_subjects
  set entry_status = 'open', entry_revision = entry_revision + 1, submitted_by = null, submitted_at = null
  where id = v_paper;

  insert into vppsone.exam_activity (assessment_id, kind, text_en, text_hi, actor_staff_id)
  select s.assessment_id, 'withdrawn',
         sp.display_name || ' took back ' || s.class_label || ' ' || s.subject_code || ' to change it',
         sp.display_name || ' ने ' || s.class_label || ' ' || s.subject_code || ' बदलने के लिए वापस लिया',
         v_actor
  from vppsone.staff_profiles sp where sp.id = v_actor;

  return jsonb_build_object('ok', true, 'revision', s.entry_revision + 1);
end;
$$;

revoke all on function vppsone.withdraw_marks_submission(jsonb) from public;
grant execute on function vppsone.withdraw_marks_submission(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Reads: staff who can see exams see the plan; writes are the service role's,
-- after the app has checked the permission.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'exam_plans', 'exam_slots', 'exam_rooms', 'exam_seats', 'exam_duties', 'exam_question_papers',
    'exam_class_locks', 'exam_moderation', 'exam_grace', 'exam_rechecks', 'report_card_remarks',
    'exam_reminders', 'exam_activity'
  ]
  loop
    execute format('alter table vppsone.%I enable row level security', t);
    execute format(
      'create policy %I on vppsone.%I for select to authenticated using ((select vppsone.staff_can_any(array[''assessments:view'', ''marks:view''])))',
      t || '_select_staff', t
    );
    execute format('grant select on vppsone.%I to authenticated', t);
    execute format('grant all on vppsone.%I to service_role', t);
  end loop;
end;
$$;

-- Tokens are never readable from a browser session.
alter table vppsone.exam_marks_links enable row level security;
grant all on vppsone.exam_marks_links to service_role;
