-- VPPS One — timetable versions, their slots, and the teaching assignments
-- regenerated from whichever version is published.

create type vppsone.timetable_status as enum ('draft', 'published', 'archived');

create table vppsone.timetable_versions (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,

  -- What the school calls this upload: "v11", "after Diwali", "corrected".
  label text not null,
  status vppsone.timetable_status not null default 'draft',

  -- The sheet exactly as it was pasted in. Kept so a version can be
  -- re-parsed after a parser fix without asking the office to find the file
  -- again, and so "what did we actually upload" has an answer.
  source_text text,
  notes text,

  cell_count integer not null default 0,
  slot_count integer not null default 0,

  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint timetable_versions_label_not_blank check (btrim(label) <> '')
);

comment on table vppsone.timetable_versions is
  'An uploaded timetable. draft -> published -> archived. Publishing archives whatever was published before, so exactly one version is live per session.';

-- Exactly one published version per session. Any number of drafts and
-- archives may sit beside it; two published ones would make "what is the
-- timetable today" ambiguous, which is the question the whole app asks.
create unique index timetable_versions_one_published_per_session
  on vppsone.timetable_versions (session_label)
  where status = 'published';

create index timetable_versions_session_idx
  on vppsone.timetable_versions (session_label, created_at desc);

create trigger timetable_versions_set_updated_at
  before update on vppsone.timetable_versions
  for each row execute function vppsone.set_updated_at();

alter table vppsone.timetable_versions enable row level security;

create policy timetable_versions_select_authenticated
  on vppsone.timetable_versions for select to authenticated using (true);

grant select on vppsone.timetable_versions to authenticated;
grant all on vppsone.timetable_versions to service_role;


-- ---------------------------------------------------------------------------
-- timetable_slots
-- ---------------------------------------------------------------------------

create table vppsone.timetable_slots (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: a draft that is thrown away takes its slots with it.
  -- They are derived from `source_text` and mean nothing without the version.
  version_id uuid not null
    references vppsone.timetable_versions (id) on delete cascade,

  day text not null,
  /** 0-based, as the parser produces. */
  period smallint not null,

  -- `public.classes.id` with no FK (rule 2, D-5). `class_label` beside it is
  -- what the sheet said, kept so a slot still reads correctly if an alias is
  -- later changed.
  class_id uuid not null,
  class_label text not null,

  -- RESTRICT on both: a subject or a staff profile referenced by a published
  -- timetable cannot be deleted out from under it. Neither ever is —
  -- both are deactivated instead (D-31) — so this only catches a mistake.
  subject_id uuid not null references vppsone.subjects (id) on delete restrict,
  subject_code text not null,
  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete restrict,
  teacher_short_name text not null,

  -- Carried from the parser rather than re-derived: `parallel` is what
  -- decides whether an absence needs a substitute, and re-deriving it here
  -- would mean the rule living in two places.
  parallel boolean not null default false,
  shared boolean not null default false,

  created_at timestamptz not null default now(),

  constraint timetable_slots_period_in_range check (period between 0 and 15)
);

comment on table vppsone.timetable_slots is
  'One row per teacher per period per class in a version. A parallel cell produces one row per teacher; a shared cell produces one per teacher too, flagged shared.';

create index timetable_slots_by_version_idx on vppsone.timetable_slots (version_id);
-- The two views task 2.4 builds: by class, and by teacher.
create index timetable_slots_by_class_idx
  on vppsone.timetable_slots (version_id, class_id, day, period);
create index timetable_slots_by_teacher_idx
  on vppsone.timetable_slots (version_id, staff_profile_id, day, period);

alter table vppsone.timetable_slots enable row level security;

create policy timetable_slots_select_authenticated
  on vppsone.timetable_slots for select to authenticated using (true);

grant select on vppsone.timetable_slots to authenticated;
grant all on vppsone.timetable_slots to service_role;


-- ---------------------------------------------------------------------------
-- teaching_assignments
-- ---------------------------------------------------------------------------
--
-- "regenerated on every publish" (PLAN §4). Never edited by hand: it is a
-- rollup of the published version, and an edit would be a fact the timetable
-- disagrees with.

create table vppsone.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete restrict,
  class_id uuid not null,
  subject_id uuid not null references vppsone.subjects (id) on delete restrict,
  periods_per_week integer not null default 0,
  version_id uuid not null
    references vppsone.timetable_versions (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table vppsone.teaching_assignments is
  'Who teaches what to whom, regenerated on every publish from the published version. Never edited by hand — PLAN §4 says regenerated.';

create unique index teaching_assignments_unique
  on vppsone.teaching_assignments (session_label, staff_profile_id, class_id, subject_id);

-- "Which classes do I teach" — the Phase 3 teacher workspace, and the scope
-- that makes `attendance:mark` mean *own* classes.
create index teaching_assignments_by_staff_idx
  on vppsone.teaching_assignments (staff_profile_id, session_label);

alter table vppsone.teaching_assignments enable row level security;

create policy teaching_assignments_select_authenticated
  on vppsone.teaching_assignments for select to authenticated using (true);

grant select on vppsone.teaching_assignments to authenticated;
grant all on vppsone.teaching_assignments to service_role;
