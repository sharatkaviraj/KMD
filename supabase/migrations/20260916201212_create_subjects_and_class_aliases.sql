-- VPPS One — subjects, and the map from the fee app's classes to the labels
-- the timetable uses.
--
-- Both tables exist because the timetable (Phase 2) names things in the
-- school's own shorthand and the fee app names them in full. `class_aliases`
-- is the translation layer, and it is master data rather than a lookup table
-- in code because only the school knows that "11 Science" is the row a
-- timetable cell calls "11-S".

create table vppsone.subjects (
  id uuid primary key default gen_random_uuid(),

  -- What a timetable cell says: "MATHS", "SST", "HIN". Unique
  -- case-insensitively (see the index below) for the same reason a staff
  -- short name is: it is a join key, and a case-variant duplicate is a
  -- silently wrong import.
  code text not null,

  -- What a human reads. Hindi first, because the app is.
  name_hi text not null,
  name_en text not null,

  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subjects_code_trimmed
    check (code = btrim(code) and code <> ''),
  constraint subjects_name_hi_not_blank check (btrim(name_hi) <> ''),
  constraint subjects_name_en_not_blank check (btrim(name_en) <> '')
);

comment on table vppsone.subjects is
  'Subjects as the timetable names them. `code` is the join key a timetable cell carries.';
comment on column vppsone.subjects.code is
  'The token a timetable cell uses. Unique case-insensitively; immutable once written.';

create unique index subjects_code_unique_ci on vppsone.subjects (lower(code));
create index subjects_active_sort_idx on vppsone.subjects (sort_order, name_en) where is_active;

create trigger subjects_set_updated_at
  before update on vppsone.subjects
  for each row execute function vppsone.set_updated_at();

-- Same reasoning as staff_profiles.short_name: a code is referenced by rows
-- that already exist, so it is replaced, never renamed.
create or replace function vppsone.subjects_code_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception
      'subject code is immutable (% -> %). It is the timetable''s join key; create a new subject instead.',
      old.code, new.code
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger subjects_code_immutable
  before update on vppsone.subjects
  for each row execute function vppsone.subjects_code_is_immutable();

alter table vppsone.subjects enable row level security;

create policy subjects_select_authenticated
  on vppsone.subjects for select to authenticated using (true);

grant select on vppsone.subjects to authenticated;
grant all on vppsone.subjects to service_role;


-- ---------------------------------------------------------------------------
-- class_aliases
-- ---------------------------------------------------------------------------

create table vppsone.class_aliases (
  id uuid primary key default gen_random_uuid(),

  -- `public.classes.id`. A plain uuid column with NO foreign key: a constraint
  -- pointing into the fee app's schema would be a write into it (rule 2, D-5).
  -- The consistency check in task 1.6 is what notices a class that has gone.
  class_id uuid not null,

  -- Denormalised from `public.classes.session_label` on purpose. The fee app's
  -- classes are per session, so an alias is too — and carrying the label here
  -- means "this year's aliases" is one index, not a join into another schema.
  session_label text not null,

  -- What a timetable cell calls this class: "11-S", "5", "NUR".
  timetable_label text not null,

  -- What the class is called in VPPS One's own screens, when the fee app's
  -- name is not the one staff say out loud. NULL means "use the fee app's".
  display_name text,

  sort_order integer not null default 0,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_aliases_timetable_label_trimmed
    check (timetable_label = btrim(timetable_label) and timetable_label <> ''),
  constraint class_aliases_session_label_trimmed
    check (session_label = btrim(session_label) and session_label <> '')
);

comment on table vppsone.class_aliases is
  'Maps a fee-app class row to the label the timetable uses for it. class_id has no FK into public by design (rule 2).';

-- One alias per class per session, and one class per label per session. Both
-- directions matter: two labels for one class makes the timetable ambiguous,
-- and two classes for one label makes it wrong.
create unique index class_aliases_class_per_session_unique
  on vppsone.class_aliases (class_id, session_label);

create unique index class_aliases_label_per_session_unique_ci
  on vppsone.class_aliases (session_label, lower(timetable_label));

create index class_aliases_session_sort_idx
  on vppsone.class_aliases (session_label, sort_order);

create trigger class_aliases_set_updated_at
  before update on vppsone.class_aliases
  for each row execute function vppsone.set_updated_at();

alter table vppsone.class_aliases enable row level security;

create policy class_aliases_select_authenticated
  on vppsone.class_aliases for select to authenticated using (true);

grant select on vppsone.class_aliases to authenticated;
grant all on vppsone.class_aliases to service_role;
