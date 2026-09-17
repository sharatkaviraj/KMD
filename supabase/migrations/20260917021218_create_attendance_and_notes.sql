-- VPPS One — attendance, corrections and notes: the teacher's day (Phase 3).

create type vppsone.attendance_status as enum ('present', 'absent', 'late', 'leave');
create type vppsone.register_status as enum ('open', 'submitted');

-- ---------------------------------------------------------------------------
-- attendance_registers
-- ---------------------------------------------------------------------------

create table vppsone.attendance_registers (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  -- `public.classes.id` with no FK (rule 2, D-5).
  class_id uuid not null,
  day date not null,

  -- NULL means the daily register the class teacher takes. A number means a
  -- subject period. The school takes one register a day today; the column is
  -- here because the timetable already knows about periods and adding it
  -- later would mean rewriting the unique index under live rows.
  period smallint,

  status vppsone.register_status not null default 'open',

  -- Who actually marked it.
  taken_by uuid references vppsone.staff_profiles (id) on delete restrict,
  submitted_at timestamptz,

  -- Set when the office marks for a teacher who could not (task 3.3). Kept
  -- separate from `taken_by` because "the office recorded this" and "the
  -- teacher recorded this" are different facts, and a register that hides
  -- which one it was cannot be audited.
  on_behalf_of uuid references vppsone.staff_profiles (id) on delete restrict,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.attendance_registers is
  'One register per class per day (period NULL = the daily register). Opened when a teacher starts marking; submitted when they finish.';

-- Two partial indexes rather than one over a nullable column: in Postgres,
-- NULLs are distinct in a unique index, so a single index on
-- (session, class, day, period) would happily allow two daily registers for
-- the same class on the same day — which is the exact duplicate this must
-- prevent.
create unique index attendance_registers_unique_daily
  on vppsone.attendance_registers (session_label, class_id, day)
  where period is null;

create unique index attendance_registers_unique_period
  on vppsone.attendance_registers (session_label, class_id, day, period)
  where period is not null;

create index attendance_registers_by_day_idx
  on vppsone.attendance_registers (session_label, day);

create index attendance_registers_by_class_idx
  on vppsone.attendance_registers (class_id, day desc);

create trigger attendance_registers_set_updated_at
  before update on vppsone.attendance_registers
  for each row execute function vppsone.set_updated_at();

alter table vppsone.attendance_registers enable row level security;
create policy attendance_registers_select_authenticated
  on vppsone.attendance_registers for select to authenticated using (true);
grant select on vppsone.attendance_registers to authenticated;
grant all on vppsone.attendance_registers to service_role;


-- ---------------------------------------------------------------------------
-- attendance_marks
-- ---------------------------------------------------------------------------

create table vppsone.attendance_marks (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null
    references vppsone.attendance_registers (id) on delete cascade,
  student_id uuid not null,
  status vppsone.attendance_status not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.attendance_marks is
  'One mark per student per register. Upserted on (register_id, student_id), which is what makes a retried submit idempotent.';

-- The whole offline story rests on this index. A teacher on a bad connection
-- submits, sees nothing happen, and submits again; the upsert turns the second
-- attempt into the same row rather than a duplicate mark.
create unique index attendance_marks_unique
  on vppsone.attendance_marks (register_id, student_id);

create index attendance_marks_by_student_idx
  on vppsone.attendance_marks (student_id);

create trigger attendance_marks_set_updated_at
  before update on vppsone.attendance_marks
  for each row execute function vppsone.set_updated_at();

alter table vppsone.attendance_marks enable row level security;
create policy attendance_marks_select_authenticated
  on vppsone.attendance_marks for select to authenticated using (true);
grant select on vppsone.attendance_marks to authenticated;
grant all on vppsone.attendance_marks to service_role;


-- ---------------------------------------------------------------------------
-- attendance_corrections
-- ---------------------------------------------------------------------------
--
-- A submitted register is a record, not a draft. Changing a mark after the
-- fact is a request somebody approves, so the original stands until then and
-- the change carries a reason and a name.

create type vppsone.correction_status as enum ('pending', 'approved', 'rejected');

create table vppsone.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  register_id uuid not null
    references vppsone.attendance_registers (id) on delete cascade,
  student_id uuid not null,

  -- What it was, so the history reads without joining back to a mark that has
  -- since been rewritten.
  from_status vppsone.attendance_status,
  to_status vppsone.attendance_status not null,
  reason text not null,

  requested_by uuid not null
    references vppsone.staff_profiles (id) on delete restrict,
  requested_at timestamptz not null default now(),

  status vppsone.correction_status not null default 'pending',
  decided_by uuid references vppsone.staff_profiles (id) on delete restrict,
  decided_at timestamptz,
  decision_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint corrections_reason_not_blank check (btrim(reason) <> ''),
  -- A decided request with no decision time, or a pending one that has been
  -- decided, is a row nobody can interpret later.
  constraint corrections_decided_together
    check (
      (status = 'pending' and decided_at is null)
      or (status <> 'pending' and decided_at is not null)
    )
);

comment on table vppsone.attendance_corrections is
  'A request to change a submitted mark. The mark is only rewritten when the request is approved, so the original stands until somebody decides.';

-- One open request per mark: two pending corrections for the same child would
-- make the approval queue a race.
create unique index corrections_one_pending_per_mark
  on vppsone.attendance_corrections (register_id, student_id)
  where status = 'pending';

create index corrections_pending_idx
  on vppsone.attendance_corrections (status, requested_at desc);

create trigger corrections_set_updated_at
  before update on vppsone.attendance_corrections
  for each row execute function vppsone.set_updated_at();

alter table vppsone.attendance_corrections enable row level security;
create policy corrections_select_authenticated
  on vppsone.attendance_corrections for select to authenticated using (true);
grant select on vppsone.attendance_corrections to authenticated;
grant all on vppsone.attendance_corrections to service_role;


-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create table vppsone.note_kinds (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  label_hi text not null,
  label_en text not null,
  -- Decides the colour a screen gives it. Not a judgement about the child:
  -- "concern" means the note wants following up, not that the child is a
  -- problem.
  tone text not null default 'neutral',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_kinds_code_trimmed check (code = btrim(code) and code <> ''),
  constraint note_kinds_tone_known check (tone in ('neutral', 'good', 'concern'))
);

create unique index note_kinds_code_unique_ci on vppsone.note_kinds (lower(code));

create trigger note_kinds_set_updated_at
  before update on vppsone.note_kinds
  for each row execute function vppsone.set_updated_at();

alter table vppsone.note_kinds enable row level security;
create policy note_kinds_select_authenticated
  on vppsone.note_kinds for select to authenticated using (true);
grant select on vppsone.note_kinds to authenticated;
grant all on vppsone.note_kinds to service_role;

create table vppsone.notes (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  -- One or the other, or both: a note can be about a child, about a whole
  -- class, or about a child in the context of a class.
  student_id uuid,
  class_id uuid,

  kind_id uuid not null references vppsone.note_kinds (id) on delete restrict,
  body text not null,
  written_by uuid not null
    references vppsone.staff_profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notes_body_not_blank check (btrim(body) <> ''),
  -- A note about nobody is a note nobody will ever find again.
  constraint notes_about_somebody
    check (student_id is not null or class_id is not null)
);

comment on table vppsone.notes is
  'A note about one student or a whole class. Typed by note_kinds so a screen can filter without reading every body.';

create index notes_by_student_idx on vppsone.notes (student_id, created_at desc);
create index notes_by_class_idx on vppsone.notes (class_id, created_at desc);
create index notes_by_session_idx on vppsone.notes (session_label, created_at desc);

create trigger notes_set_updated_at
  before update on vppsone.notes
  for each row execute function vppsone.set_updated_at();

alter table vppsone.notes enable row level security;
create policy notes_select_authenticated
  on vppsone.notes for select to authenticated using (true);
grant select on vppsone.notes to authenticated;
grant all on vppsone.notes to service_role;

-- The kinds the school already uses on paper. Seeded rather than left empty,
-- because a notes screen with no kinds is a screen nobody can use, and these
-- six are not a guess — they are what the register margins say.
insert into vppsone.note_kinds (code, label_hi, label_en, tone, sort_order) values
  ('behaviour', 'व्यवहार', 'Behaviour', 'concern', 1),
  ('praise', 'शाबाशी', 'Praise', 'good', 2),
  ('homework', 'गृहकार्य', 'Homework', 'concern', 3),
  ('health', 'स्वास्थ्य', 'Health', 'neutral', 4),
  ('parent', 'अभिभावक से बात', 'Parent contact', 'neutral', 5),
  ('other', 'अन्य', 'Other', 'neutral', 9)
on conflict do nothing;
