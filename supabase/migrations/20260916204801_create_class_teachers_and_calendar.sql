-- VPPS One — class teachers (with history) and the academic calendar.

-- ---------------------------------------------------------------------------
-- class_teachers
-- ---------------------------------------------------------------------------
--
-- "With history: replaced, never edited" (PLAN §4). A class teacher changing
-- mid-year is a fact about a date, not a correction: attendance already taken,
-- notes already written and report cards already signed all belong to whoever
-- held the class then. So a change closes the current row and opens a new one.

create type vppsone.class_teacher_role as enum ('class_teacher', 'assistant');

create table vppsone.class_teachers (
  id uuid primary key default gen_random_uuid(),

  -- `public.classes.id`, with no FK: a constraint into the fee app's schema
  -- would be a write into it (rule 2, D-5).
  class_id uuid not null,
  session_label text not null,

  -- ON DELETE RESTRICT, unlike everywhere else. A staff profile that has ever
  -- been a class teacher cannot be deleted out from under this history —
  -- and it never is, because staff are deactivated rather than deleted (D-31).
  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete restrict,

  role vppsone.class_teacher_role not null default 'class_teacher',

  effective_from date not null default current_date,
  -- NULL means current.
  effective_to date,
  replaced_reason text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_teachers_period_ordered
    check (effective_to is null or effective_to >= effective_from)
);

comment on table vppsone.class_teachers is
  'Who is class teacher of which class, with history. A change closes the old row and opens a new one; rows are never edited (PLAN §4).';
comment on column vppsone.class_teachers.effective_to is
  'NULL means current. A replacement sets this to the day before the new row starts.';

-- One *current* holder per class per role. The partial index is the whole
-- point: any number of closed rows may exist, but two open ones would mean
-- the class has two class teachers today, which is the bug this prevents.
create unique index class_teachers_one_current_per_class
  on vppsone.class_teachers (class_id, session_label, role)
  where effective_to is null;

-- "Which classes am I responsible for" — the Phase 3 teacher workspace's
-- first question.
create index class_teachers_by_staff_idx
  on vppsone.class_teachers (staff_profile_id, session_label);

create index class_teachers_session_idx
  on vppsone.class_teachers (session_label, class_id);

create trigger class_teachers_set_updated_at
  before update on vppsone.class_teachers
  for each row execute function vppsone.set_updated_at();

alter table vppsone.class_teachers enable row level security;

create policy class_teachers_select_authenticated
  on vppsone.class_teachers for select to authenticated using (true);

grant select on vppsone.class_teachers to authenticated;
grant all on vppsone.class_teachers to service_role;


-- ---------------------------------------------------------------------------
-- academic_calendar_days
-- ---------------------------------------------------------------------------
--
-- Only the days that are *not* an ordinary teaching day, plus the ones that
-- are instructional against the weekly pattern — a working Sunday before an
-- exam, say. Absence of a row means "whatever the weekly pattern says", so a
-- year needs a few dozen rows rather than 365.

create type vppsone.calendar_day_kind as enum (
  'instructional',
  'holiday',
  'exam',
  'event',
  'vacation'
);

create table vppsone.academic_calendar_days (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  day date not null,
  kind vppsone.calendar_day_kind not null,

  -- Both halves, because language is per reader (PLAN §3a). Nullable: a
  -- holiday does not always have a name worth typing.
  label_hi text,
  label_en text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.academic_calendar_days is
  'Days that are not an ordinary teaching day, plus explicit instructional days. Absence of a row means an ordinary day decided by the weekly pattern.';

-- A day is one thing. Two rows for 15 August would make "is school open"
-- depend on which row was read first.
create unique index calendar_one_row_per_day
  on vppsone.academic_calendar_days (session_label, day);

create index calendar_session_day_idx
  on vppsone.academic_calendar_days (session_label, day);

create trigger calendar_set_updated_at
  before update on vppsone.academic_calendar_days
  for each row execute function vppsone.set_updated_at();

alter table vppsone.academic_calendar_days enable row level security;

create policy calendar_select_authenticated
  on vppsone.academic_calendar_days for select to authenticated using (true);

grant select on vppsone.academic_calendar_days to authenticated;
grant all on vppsone.academic_calendar_days to service_role;
