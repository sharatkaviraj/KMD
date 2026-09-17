-- VPPS One — assessments, marks and report cards (Phase 6).

create type vppsone.assessment_kind as enum ('formative', 'summative', 'practical', 'other');
create type vppsone.assessment_status as enum ('draft', 'open', 'locked');
create type vppsone.export_kind as enum ('marks', 'attendance', 'report_cards');

-- ---------------------------------------------------------------------------
-- assessments — one exam, in one term
-- ---------------------------------------------------------------------------

create table vppsone.assessments (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  term text not null,
  code text not null,
  label_hi text not null,
  label_en text not null,

  kind vppsone.assessment_kind not null default 'summative',

  starts_on date,
  ends_on date,

  -- How much this exam contributes to the term's report card, as a share.
  -- Kept on the exam rather than in a separate weighting table: a school that
  -- changes the weighting changes it for the exam, and one number on one row
  -- is a number somebody can check.
  weight numeric not null default 1,

  status vppsone.assessment_status not null default 'draft',
  locked_at timestamptz,
  locked_by uuid references vppsone.staff_profiles (id) on delete restrict,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assessments_weight_sane check (weight >= 0 and weight <= 10),
  constraint assessments_dates_ordered check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint assessments_locked_together
    check ((status = 'locked') = (locked_at is not null))
);

comment on table vppsone.assessments is
  'One exam in one term. Marks are entered against its subjects; locking it stops further entry.';

create unique index assessments_code_unique
  on vppsone.assessments (session_label, term, code);

create index assessments_open_idx
  on vppsone.assessments (session_label, status);

create trigger assessments_set_updated_at
  before update on vppsone.assessments
  for each row execute function vppsone.set_updated_at();

alter table vppsone.assessments enable row level security;
create policy assessments_select_authenticated
  on vppsone.assessments for select to authenticated using (true);
grant select on vppsone.assessments to authenticated;
grant all on vppsone.assessments to service_role;

-- ---------------------------------------------------------------------------
-- assessment_subjects — what is examined, for whom, out of how much
-- ---------------------------------------------------------------------------
--
-- Not named in PLAN §5, and necessary: an exam is not one max mark. A Class 5
-- English paper and a Class 10 English paper are different papers out of
-- different totals, and a single `max_marks` on the exam would make every class
-- in the school sit the same one.

create table vppsone.assessment_subjects (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null
    references vppsone.assessments (id) on delete cascade,

  -- `public.classes.id`, with no FK (rule 2, D-5).
  class_id uuid not null,
  class_label text not null,

  subject_id uuid not null
    references vppsone.subjects (id) on delete restrict,
  subject_code text not null,

  max_marks numeric not null,
  pass_marks numeric,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assessment_subjects_max_sane check (max_marks > 0 and max_marks <= 1000),
  constraint assessment_subjects_pass_sane
    check (pass_marks is null or (pass_marks >= 0 and pass_marks <= max_marks))
);

comment on table vppsone.assessment_subjects is
  'One paper: an exam, a class and a subject, out of a max. A Class 5 paper and a Class 10 paper are different papers.';

create unique index assessment_subjects_unique
  on vppsone.assessment_subjects (assessment_id, class_id, subject_id);

create index assessment_subjects_class_idx
  on vppsone.assessment_subjects (class_id);

create trigger assessment_subjects_set_updated_at
  before update on vppsone.assessment_subjects
  for each row execute function vppsone.set_updated_at();

alter table vppsone.assessment_subjects enable row level security;
create policy assessment_subjects_select_authenticated
  on vppsone.assessment_subjects for select to authenticated using (true);
grant select on vppsone.assessment_subjects to authenticated;
grant all on vppsone.assessment_subjects to service_role;

-- ---------------------------------------------------------------------------
-- marks
-- ---------------------------------------------------------------------------
--
-- One mark per child per paper. `value` NULL and `absent` false is "nobody has
-- entered this yet", which is a different fact from a zero and from a child who
-- did not sit the paper — and a grid that could not tell the three apart would
-- make "who has not entered yet" unanswerable, which is the question the whole
-- board exists for.

create table vppsone.marks (
  id uuid primary key default gen_random_uuid(),
  assessment_subject_id uuid not null
    references vppsone.assessment_subjects (id) on delete cascade,

  student_id uuid not null,

  value numeric,
  absent boolean not null default false,

  entered_by uuid references vppsone.staff_profiles (id) on delete restrict,
  entered_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A child who was absent has no mark. Storing both would leave two answers
  -- to "what did they get", and the report card would have to guess.
  constraint marks_absent_has_no_value check (not absent or value is null),
  constraint marks_not_negative check (value is null or value >= 0)
);

comment on table vppsone.marks is
  'One mark per child per paper. NULL value with absent false means nobody has entered it yet — which is not a zero.';

create unique index marks_unique
  on vppsone.marks (assessment_subject_id, student_id);

create index marks_student_idx on vppsone.marks (student_id);

create trigger marks_set_updated_at
  before update on vppsone.marks
  for each row execute function vppsone.set_updated_at();

alter table vppsone.marks enable row level security;
create policy marks_select_authenticated
  on vppsone.marks for select to authenticated using (true);
grant select on vppsone.marks to authenticated;
grant all on vppsone.marks to service_role;

-- ---------------------------------------------------------------------------
-- marks_change_log — append-only
-- ---------------------------------------------------------------------------
--
-- A mark that changes after a parent has seen it is the single most sensitive
-- write in this app. The log is append-only and carries both sides of every
-- change, so "it was 68 last week" has an answer that does not depend on
-- anybody remembering.

create table vppsone.marks_change_log (
  id uuid primary key default gen_random_uuid(),

  assessment_subject_id uuid not null
    references vppsone.assessment_subjects (id) on delete cascade,
  student_id uuid not null,

  from_value numeric,
  to_value numeric,
  from_absent boolean,
  to_absent boolean,

  reason text,

  changed_by uuid references vppsone.staff_profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);

comment on table vppsone.marks_change_log is
  'Append-only. Every change to a mark, both sides of it, and who made it.';

create index marks_change_log_paper_idx
  on vppsone.marks_change_log (assessment_subject_id, changed_at desc);

create index marks_change_log_student_idx
  on vppsone.marks_change_log (student_id, changed_at desc);

alter table vppsone.marks_change_log enable row level security;
create policy marks_change_log_select_authenticated
  on vppsone.marks_change_log for select to authenticated using (true);
grant select on vppsone.marks_change_log to authenticated;
grant all on vppsone.marks_change_log to service_role;

-- ---------------------------------------------------------------------------
-- report_cards
-- ---------------------------------------------------------------------------
--
-- A snapshot, not a view. A report card is what the school handed a family on
-- a day, and marks change afterwards — a correction, a re-mark, a paper found.
-- Recomputing the card from today's marks would silently rewrite what the
-- parent is holding, so the card keeps its own copy of what it said.

create table vppsone.report_cards (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,
  term text not null,

  payload jsonb not null,

  generated_by uuid references vppsone.staff_profiles (id) on delete restrict,
  generated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.report_cards is
  'What the school handed a family, kept as it was. Marks change afterwards; a card does not.';

create unique index report_cards_unique
  on vppsone.report_cards (session_label, student_id, term);

create index report_cards_term_idx
  on vppsone.report_cards (session_label, term);

create trigger report_cards_set_updated_at
  before update on vppsone.report_cards
  for each row execute function vppsone.set_updated_at();

alter table vppsone.report_cards enable row level security;
create policy report_cards_select_authenticated
  on vppsone.report_cards for select to authenticated using (true);
grant select on vppsone.report_cards to authenticated;
grant all on vppsone.report_cards to service_role;

-- ---------------------------------------------------------------------------
-- academic_exports — the log PLAN 6.5 asks for
-- ---------------------------------------------------------------------------
--
-- An export is a copy of the school's records leaving the building. Who took
-- what, and when, is the whole reason the task says "logged".

create table vppsone.academic_exports (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  kind vppsone.export_kind not null,
  scope text not null,
  row_count integer not null default 0,

  exported_by uuid references vppsone.staff_profiles (id) on delete restrict,
  exported_at timestamptz not null default now()
);

comment on table vppsone.academic_exports is
  'One row per export taken. Who took what, and when.';

create index academic_exports_recent_idx
  on vppsone.academic_exports (session_label, exported_at desc);

alter table vppsone.academic_exports enable row level security;
create policy academic_exports_select_authenticated
  on vppsone.academic_exports for select to authenticated using (true);
grant select on vppsone.academic_exports to authenticated;
grant all on vppsone.academic_exports to service_role;
