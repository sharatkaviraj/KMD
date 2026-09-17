-- VPPS One — substitutions: absences, cover policies, plans (Phase 4).

create type vppsone.substitution_plan_status as enum ('draft', 'published');
create type vppsone.substitution_kind as enum ('cover', 'self_study', 'merged');
create type vppsone.substitution_source as enum ('auto', 'suggestion', 'manual');

-- Who may be asked to cover, and when they are in the building.
create type vppsone.cover_role as enum ('normal', 'duty', 'reserve');

-- ---------------------------------------------------------------------------
-- cover_policies
-- ---------------------------------------------------------------------------
--
-- Two standing facts about a member of staff that the planner cannot read off
-- a timetable.
--
-- **The shift window.** A part-time teacher who arrives at the fifth period
-- has four empty periods in their timetable that are not free time — they are
-- periods they are not in the building for. Without this the planner hands
-- them cover duty before they arrive, which is the bug the ported engine was
-- written to fix.
--
-- **The cover role.** `duty` is a coordinator or exam in-charge: still
-- teaching staff, still suggested, but only after everybody else and never
-- automatically. `reserve` is admin staff who may be asked and are never
-- volunteered — they have no timetable at all, so they read as free in every
-- period, which is exactly how they would otherwise end up covering the
-- hardest lesson of the day.
--
-- The engine this was ported from shipped both as constants with real
-- teachers' names in the source. Rule 6 forbids that here, and a school that
-- cannot change its own part-time hours without a deploy is worse off anyway,
-- so they are rows a coordinator edits (task 4.4).

create table vppsone.cover_policies (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete cascade,

  -- The period indexes this person is on site for, 0-based. The full day is
  -- stored explicitly rather than as NULL: "every period" and "nobody has said"
  -- are the same answer here, and one representation is easier to read.
  allowed_periods smallint[] not null default '{0,1,2,3,4,5,6,7}',

  cover_role vppsone.cover_role not null default 'normal',

  -- How many covers the planner may hand this person without a coordinator
  -- confirming. Two is the ported engine's default.
  max_auto_covers smallint not null default 2,

  note text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cover_policies_max_auto_sane check (max_auto_covers between 0 and 8)
);

comment on table vppsone.cover_policies is
  'Standing cover facts per staff member: the periods they are on site for, whether they are duty or reserve, and their automatic cover cap.';

create unique index cover_policies_unique
  on vppsone.cover_policies (session_label, staff_profile_id);

create trigger cover_policies_set_updated_at
  before update on vppsone.cover_policies
  for each row execute function vppsone.set_updated_at();

alter table vppsone.cover_policies enable row level security;
create policy cover_policies_select_authenticated
  on vppsone.cover_policies for select to authenticated using (true);
grant select on vppsone.cover_policies to authenticated;
grant all on vppsone.cover_policies to service_role;


-- ---------------------------------------------------------------------------
-- teacher_absences
-- ---------------------------------------------------------------------------
--
-- An absence is one day — but not always the whole of one. Teachers leave
-- after the fourth period for a hospital appointment, or arrive at the fifth
-- from one. Modelled as a whole day, those hours read as absent while the
-- teacher is standing in the staff room: the planner invents vacancies nobody
-- needs and refuses the cover this teacher could actually give.
--
-- So the periods are stored, and a whole day is simply every period. This is
-- not a shift: a shift holds every day and lives in `cover_policies`; an
-- absence belongs to one date.

create table vppsone.teacher_absences (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete cascade,
  day date not null,
  periods smallint[] not null,
  reason text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An entry with no periods is not an absence. Refused here so no screen has
  -- to decide what an empty one would have meant.
  constraint teacher_absences_has_periods check (cardinality(periods) > 0)
);

comment on table vppsone.teacher_absences is
  'One row per staff member per day away, carrying the periods it applies to. A whole day is every period.';

create unique index teacher_absences_unique
  on vppsone.teacher_absences (staff_profile_id, day);

create index teacher_absences_by_day_idx
  on vppsone.teacher_absences (session_label, day);

create trigger teacher_absences_set_updated_at
  before update on vppsone.teacher_absences
  for each row execute function vppsone.set_updated_at();

alter table vppsone.teacher_absences enable row level security;
create policy teacher_absences_select_authenticated
  on vppsone.teacher_absences for select to authenticated using (true);
grant select on vppsone.teacher_absences to authenticated;
grant all on vppsone.teacher_absences to service_role;


-- ---------------------------------------------------------------------------
-- substitution_plans
-- ---------------------------------------------------------------------------
--
-- One plan per day. `version_id` records the timetable it was planned
-- against, because a plan built on a timetable that has since been republished
-- is describing periods that may no longer exist — the ported engine threw
-- saved plans away on a schedule version change, and this is where that rule
-- lives now.

create table vppsone.substitution_plans (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  day date not null,
  version_id uuid not null
    references vppsone.timetable_versions (id) on delete restrict,

  status vppsone.substitution_plan_status not null default 'draft',

  generated_at timestamptz,
  published_at timestamptz,
  published_by uuid references vppsone.staff_profiles (id) on delete restrict,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint substitution_plans_published_together
    check (
      (status = 'draft' and published_at is null)
      or (status = 'published' and published_at is not null)
    )
);

comment on table vppsone.substitution_plans is
  'One cover plan per day, planned against a specific published timetable version.';

create unique index substitution_plans_unique_day
  on vppsone.substitution_plans (session_label, day);

create trigger substitution_plans_set_updated_at
  before update on vppsone.substitution_plans
  for each row execute function vppsone.set_updated_at();

alter table vppsone.substitution_plans enable row level security;
create policy substitution_plans_select_authenticated
  on vppsone.substitution_plans for select to authenticated using (true);
grant select on vppsone.substitution_plans to authenticated;
grant all on vppsone.substitution_plans to service_role;


-- ---------------------------------------------------------------------------
-- substitution_assignments
-- ---------------------------------------------------------------------------

create table vppsone.substitution_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null
    references vppsone.substitution_plans (id) on delete cascade,

  period smallint not null,
  class_id uuid not null,
  -- Denormalised, like `timetable_slots.class_label`: a printed cover sheet
  -- has to read correctly a year later, when an alias may have been renamed.
  class_label text not null,
  subject_code text,

  original_staff_id uuid
    references vppsone.staff_profiles (id) on delete restrict,

  -- NULL for self study and for a merged class: nobody is covering, which is
  -- a decision in its own right and not a gap in the data.
  covering_staff_id uuid
    references vppsone.staff_profiles (id) on delete restrict,

  kind vppsone.substitution_kind not null default 'cover',
  merge_host_class_id uuid,
  merge_host_class_label text,

  -- Why the engine chose this person, kept so the sheet can say so and so a
  -- coordinator can see what a regenerate would change.
  match_tier text,
  source vppsone.substitution_source not null default 'manual',
  warnings text[] not null default '{}',

  -- A pin survives a regenerate. It is a decision somebody made on purpose.
  pinned boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint substitution_assignments_cover_has_teacher
    check (kind <> 'cover' or covering_staff_id is not null),
  constraint substitution_assignments_merge_has_host
    check (kind <> 'merged' or merge_host_class_id is not null)
);

comment on table vppsone.substitution_assignments is
  'One row per vacancy in a plan: who covers it, or that it is self study or merged into another class.';

-- One decision per class per period.
create unique index substitution_assignments_unique_slot
  on vppsone.substitution_assignments (plan_id, class_id, period);

-- Nobody covers two classes at once. The engine refuses it too; this is the
-- half that still holds when a coordinator overrides by hand.
create unique index substitution_assignments_no_double_booking
  on vppsone.substitution_assignments (plan_id, covering_staff_id, period)
  where covering_staff_id is not null;

create index substitution_assignments_by_teacher_idx
  on vppsone.substitution_assignments (covering_staff_id);

create trigger substitution_assignments_set_updated_at
  before update on vppsone.substitution_assignments
  for each row execute function vppsone.set_updated_at();

alter table vppsone.substitution_assignments enable row level security;
create policy substitution_assignments_select_authenticated
  on vppsone.substitution_assignments for select to authenticated using (true);
grant select on vppsone.substitution_assignments to authenticated;
grant all on vppsone.substitution_assignments to service_role;
