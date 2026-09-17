-- VPPS One — who is in charge of a house or a bus route.
--
-- **B-32.** A round can be addressed to a house or a route, and until now
-- nothing in this schema could say who such a link would go *to*.
-- `vppsone.class_teachers` covers classes and `staff_profiles` has no
-- equivalent columns, so a house round resolved to children and then had
-- nowhere to send them. SamPark carries `teacher.houses` and `teacher.routes`;
-- this is the same fact, normalised.
--
-- **Classes deliberately stay in `class_teachers`.** Merging them would mean
-- either dropping that table's `role`, `effective_from`/`effective_to` and
-- `replaced_reason` — which exist because a class teacher is replaced
-- mid-year and the register has to know when — or bolting four columns that
-- mean nothing for a bus route onto every row here. One source of truth per
-- kind, and `ownersFor()` reads both.

create table vppsone.staff_scopes (
  id uuid primary key default gen_random_uuid(),

  staff_profile_id uuid not null
    references vppsone.staff_profiles (id) on delete cascade,

  -- `house` | `route`. Plain text with no enum, following `audience_kind`
  -- (D-144): a fourth thing somebody can be in charge of should cost a row.
  kind text not null,

  -- The house name as `public.students.house` spells it, or the route id as
  -- `public.students.transport_route_id` holds it. **Matched exactly**, never
  -- by prefix: several bus routes differ only by a parenthesised suffix
  -- ("Amet Railway Station (Inside)" against "(On Road)"), and a loose match
  -- would hand one route's children to another route's in-charge.
  value text not null,

  -- In-charge of a house *this year*. It changes, and a round sent last term
  -- was sent to whoever held it then.
  session_label text not null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint staff_scopes_kind_is_known check (kind in ('house', 'route')),
  constraint staff_scopes_value_not_blank check (btrim(value) <> '')
);

comment on table vppsone.staff_scopes is
  'Who is in charge of a house or a bus route this session. Classes live in class_teachers, which carries handover dates this does not need (B-32).';

-- One row per person per thing. A second identical row would make "two people
-- are assigned to Chetak" true when one person was recorded twice, and that
-- reads to the office as a choice to make rather than a duplicate to delete.
create unique index staff_scopes_one_per_person
  on vppsone.staff_scopes (session_label, kind, value, staff_profile_id);

-- "Who owns this house" — the fan-out's own query, once per group.
create index staff_scopes_by_value
  on vppsone.staff_scopes (session_label, kind, value);

create index staff_scopes_by_person
  on vppsone.staff_scopes (staff_profile_id);

alter table vppsone.staff_scopes enable row level security;
create policy staff_scopes_select_authenticated
  on vppsone.staff_scopes for select to authenticated using (true);
grant select on vppsone.staff_scopes to authenticated;
grant all on vppsone.staff_scopes to service_role;
