-- VPPS One — staff roles and staff profiles.
--
-- A staff profile is not an account. `user_id` is nullable because not every
-- staff member signs in: the timetable needs a row for every teacher on it,
-- including the ones who will never open the app. Accounts are created by an
-- admin in Supabase Auth; this table only says who a signed-in account is and
-- what they may do (D-6 — the role comes from here, never public.users.role).

create type vppsone.staff_role as enum (
  'admin',
  'office',
  'academic_coordinator',
  'exam_coordinator',
  'teacher',
  'view_only'
);

comment on type vppsone.staff_role is
  'VPPS One roles (PLAN §3). Unrelated to the fee app''s public.users.role — a person can be an accountant there and a class teacher here.';

create table vppsone.staff_profiles (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE SET NULL, not CASCADE: deleting an auth user must not take the
  -- timetable's join key with it. The profile survives, unlinked.
  user_id uuid unique references auth.users (id) on delete set null,

  display_name text not null,

  -- The timetable's join key. Immutable once set — enforced by the trigger
  -- below, because a rename here silently orphans every slot that named it.
  short_name text not null,

  role vppsone.staff_role not null default 'view_only',

  phone text,
  whatsapp_phone text,

  is_teaching boolean not null default false,
  is_active boolean not null default true,

  -- The app is Hindi-first; 'en' is the opt-out.
  preferred_language text not null default 'hi',

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_profiles_display_name_not_blank
    check (btrim(display_name) <> ''),
  constraint staff_profiles_short_name_trimmed
    check (short_name = btrim(short_name) and short_name <> ''),
  constraint staff_profiles_preferred_language_known
    check (preferred_language in ('hi', 'en'))
);

comment on table vppsone.staff_profiles is
  'Who a staff member is and what they may do. Not an account — user_id is nullable so non-users (teachers on the timetable) still have a row.';
comment on column vppsone.staff_profiles.short_name is
  'The timetable''s join key (e.g. the initials a slot names). Unique case-insensitively, and immutable once the row exists.';
comment on column vppsone.staff_profiles.user_id is
  'The auth.users row that signs in as this person, or NULL if they never sign in.';

-- Case-insensitive, because "RKS" and "rks" are the same teacher to everyone
-- except a unique constraint. This is the timetable's join key, so a
-- case-variant duplicate is a silently wrong import, not a cosmetic problem.
create unique index staff_profiles_short_name_unique_ci
  on vppsone.staff_profiles (lower(short_name));

-- The two reads the app actually makes: "who is this signed-in user" (covered
-- by the unique constraint on user_id) and "list the active teaching staff".
create index staff_profiles_active_teaching_idx
  on vppsone.staff_profiles (is_active, is_teaching)
  where is_active;

create trigger staff_profiles_set_updated_at
  before update on vppsone.staff_profiles
  for each row
  execute function vppsone.set_updated_at();

-- short_name immutability, in the database rather than only in the form that
-- happens to be the current way in. A server action can be rewritten; this
-- cannot be forgotten.
create or replace function vppsone.staff_profiles_short_name_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.short_name is distinct from old.short_name then
    raise exception
      'short_name is immutable (% -> %). It is the timetable''s join key; create a new profile instead.',
      old.short_name, new.short_name
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger staff_profiles_short_name_immutable
  before update on vppsone.staff_profiles
  for each row
  execute function vppsone.staff_profiles_short_name_is_immutable();

alter table vppsone.staff_profiles enable row level security;

-- SELECT only, and no INSERT/UPDATE/DELETE policy at all. Writes go through
-- server actions that have already checked the permission and then use the
-- service-role client, which bypasses RLS. That keeps "who may write" in one
-- readable TypeScript file (src/platform/auth/permissions.ts) instead of
-- spread across policies that a role change would have to be kept in step with.
create policy staff_profiles_select_authenticated
  on vppsone.staff_profiles
  for select
  to authenticated
  using (true);

-- Explicit, because ALTER DEFAULT PRIVILEGES only covers objects created after
-- it by the same role — worth not depending on when this file is replayed
-- against the live project at cutover.
grant select on vppsone.staff_profiles to authenticated;
grant all on vppsone.staff_profiles to service_role;
