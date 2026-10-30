-- ============================================================================
-- VPPS One fee-migration (One-only): public.users is DERIVED from
-- vppsone.staff_profiles for every One account (D-350, default — the owner
-- may overrule; plan §1.4, Q5, D-207).
--
-- Why this differs from the fees app: in the fees app `public.users` IS the
-- staff record — its role decides `private.current_staff_role()` and so
-- `public.has_permission()` and every fee RLS policy, and an auth.users trigger
-- (`sync_staff_profile_from_auth_users`) creates a `read_only_staff` row for
-- each new sign-in. On One's database there are two staff records, and two
-- authorities would disagree: `current_staff_role()` reads `public.users`
-- FIRST, so a One admin or accountant with a stale or default fee row would
-- fail `has_permission('payments:write')` (plan §1.4). One decides: the role
-- is `vppsone.staff_profiles.role`, and the fee row follows it.
--
--  * vppsone.fee_role_map — One role -> fee role, least privilege. The fees
--    vocabulary is admin, accountant, fee_collector, teacher, view_only (live
--    renamed read_only_staff to view_only on 25 May). Only the three money
--    roles keep a money role; everybody else reads as view_only — office
--    included (D-6: posting is granted one person at a time, through
--    accountant), and teacher included (the fees `teacher` role reads every
--    fee screen; a One teacher has no fees:view at all). It agrees with
--    feeRoleFor() in src/platform/auth/fee-roles.ts except teacher, which is
--    narrower here: a database role is the last line, the app's is a screen.
--  * vppsone.sync_fee_user_from_staff_profile(profile_id) upserts the
--    profile's public.users row (id = auth user, role from the map, active
--    as the profile). A profile without a login has no row.
--  * a trigger on vppsone.staff_profiles runs it whenever role, is_active,
--    user_id or display_name changes; a login moved to another profile
--    leaves the old user's fee row inactive.
--  * every existing profile with a login is derived once, here.
--
-- `sync_staff_profile_from_auth_users` is NOT recreated: One's /staff makes
-- the profile, and this trigger makes the fee row from it, so a second
-- automatic writer keyed on auth.users would only ever be able to contradict
-- the profile. It stays absent on this database (PR-1 did not replay it).
--
-- The mirror load (scripts/migrate/load-snapshot.mjs) never writes the
-- public.users row of a user who has a staff profile, remaps a fees user whose
-- email is a One account onto that account, and re-derives afterwards.
--
-- Rollback:
--   drop trigger staff_profiles_sync_fee_user on vppsone.staff_profiles;
--   drop function vppsone.staff_profiles_sync_fee_user();
--   drop function vppsone.sync_fee_user_from_staff_profile(uuid);
--   drop table vppsone.fee_role_map;
--   (the derived public.users rows stay; delete them by id if wanted)
-- ============================================================================

create table vppsone.fee_role_map (
  one_role vppsone.staff_role primary key,
  fee_role public.staff_role not null,
  why text not null check (char_length(why) between 1 and 300)
);

comment on table vppsone.fee_role_map is
  'One role -> the fee role public.users gets (D-350). Least privilege; staff_profiles is the authority.';

insert into vppsone.fee_role_map (one_role, fee_role, why) values
  ('admin', 'admin', 'Runs the school, including its money.'),
  ('accountant', 'accountant', 'Posts payments and keeps the books (D-6: posting is granted through this role).'),
  ('fee_collector', 'fee_collector', 'Collects fees at the desk.'),
  ('office', 'view_only', 'Reads fees; posting is not the office''s by default (D-6).'),
  ('academic_coordinator', 'view_only', 'No fee duty: the least fee role.'),
  ('exam_coordinator', 'view_only', 'No fee duty: the least fee role.'),
  ('teacher', 'view_only', 'No fees:view in One; the fees teacher role would read every fee screen.'),
  ('view_only', 'view_only', 'Reads only.');

alter table vppsone.fee_role_map enable row level security;
revoke all on vppsone.fee_role_map from public, anon, authenticated;
grant select on vppsone.fee_role_map to service_role;

create or replace function vppsone.sync_fee_user_from_staff_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile vppsone.staff_profiles%rowtype;
  v_role public.staff_role;
begin
  select * into v_profile from vppsone.staff_profiles where id = p_profile_id;
  if not found or v_profile.user_id is null then
    return;
  end if;
  select m.fee_role into v_role from vppsone.fee_role_map m where m.one_role = v_profile.role;
  -- A One role with no row in the map is the least fee role, never a guess upward.
  v_role := coalesce(v_role, 'view_only'::public.staff_role);

  insert into public.users (id, full_name, role, is_active)
  values (v_profile.user_id, v_profile.display_name, v_role, v_profile.is_active)
  on conflict (id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        full_name = excluded.full_name
    where (public.users.role, public.users.is_active, public.users.full_name)
      is distinct from (excluded.role, excluded.is_active, excluded.full_name);
end;
$$;

comment on function vppsone.sync_fee_user_from_staff_profile(uuid) is
  'Derive public.users (the fee role row) from a staff profile through vppsone.fee_role_map (D-350).';

revoke all on function vppsone.sync_fee_user_from_staff_profile(uuid) from public, anon, authenticated;
grant execute on function vppsone.sync_fee_user_from_staff_profile(uuid) to service_role;

create or replace function vppsone.staff_profiles_sync_fee_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
    update public.users set is_active = false where id = old.user_id and is_active;
  end if;
  perform vppsone.sync_fee_user_from_staff_profile(new.id);
  return null;
end;
$$;

revoke all on function vppsone.staff_profiles_sync_fee_user() from public, anon, authenticated;

create trigger staff_profiles_sync_fee_user
  after insert or update of role, is_active, user_id, display_name on vppsone.staff_profiles
  for each row execute function vppsone.staff_profiles_sync_fee_user();

-- Every existing profile with a login, once.
select vppsone.sync_fee_user_from_staff_profile(sp.id)
from vppsone.staff_profiles sp
where sp.user_id is not null;
