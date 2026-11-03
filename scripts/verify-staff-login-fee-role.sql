-- Proves D-350 / D-355 on One's database: a staff login made through One's
-- /staff path gets its fee role from its staff profile, there is no trigger on
-- auth.users that could give a sign-up a role, and an existing admin is never
-- demoted. Run as postgres (SQL editor / MCP execute_sql). It changes nothing:
-- everything happens inside BEGIN … ROLLBACK, and the last statement returns
-- one row per case with pass = true/false.
--
-- The /staff path (src/app/(app)/staff/vx-actions.ts) is, in order:
--   addStaffAction      -> a vppsone.staff_profiles row with no login
--   createLoginAction   -> auth.admin.createUser (a bare auth.users row), then
--                          `update staff_profiles set user_id = … where user_id is null`
--   changeRoleAction    -> vppsone.change_staff_authority (role), and
--   setLoginActiveAction   the same function (activation)
-- Each step is replayed below as the SQL it issues; role and activation
-- changes go through change_staff_authority itself, with a proof admin (a
-- test account, so it may manage the test-account target) as the actor, so a
-- regression in that function or in fee_role_map shows here. The new people
-- are QA addresses and test accounts; nothing survives the rollback.
--
-- Runs (record each one here: date, database, result):
--   31 Oct 2026, wtgxcptmucjerhufzjcf, raw role updates for E/F/I: A–I pass
--   31 Oct 2026, wtgxcptmucjerhufzjcf, E/F/I through change_staff_authority
--     (Phase I fixer; the body run as one DO block that raised its results, so
--     it aborted): A–I pass, 3 active admins stay admin; no proof row left
--
-- Cases
--   A  no trigger on auth.users runs a function of public, private or vppsone
--      (live's sync_staff_profile_from_auth_users stays absent: D-355)
--   B  a profile with no login has no public.users row
--   C  a bare auth.users row (createUser, or a public sign-up) gets no public.users row
--   D  linking the login derives public.users with the mapped fee role (accountant -> accountant)
--   E  a role change follows: accountant -> teacher gives view_only
--   F  office maps to view_only, fee_collector to fee_collector
--   G  every active admin with a login is admin in public.users before anything is touched
--   H  touching every admin's profile (display_name) and auth row (metadata) leaves each admin admin
--   I  turning a login off leaves the fee row inactive, never deleted, never demoted below its role

begin;

create temp table proof_results (case_id text, detail text, pass boolean) on commit drop;

do $$
declare
  v_uid uuid := gen_random_uuid();
  v_profile uuid;
  v_email text := 'proof-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || '@qa.vpps.local';
  v_role text;
  v_active boolean;
  v_n integer;
  v_admins integer;
  v_bad integer;
  v_actor uuid;
  v_result jsonb;
begin
  -- A
  select count(*) into v_n
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace n on n.oid = p.pronamespace
  where t.tgrelid = 'auth.users'::regclass
    and not t.tgisinternal
    and n.nspname in ('public', 'private', 'vppsone');
  insert into proof_results values ('A', 'app triggers on auth.users: ' || v_n, v_n = 0);

  -- B: addStaffAction
  insert into vppsone.staff_profiles (display_name, short_name, role, is_test_account)
  values ('Proof Accountant', 'PRF' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), 'accountant', true)
  returning id into v_profile;
  select count(*) into v_n from public.users u
  join vppsone.staff_profiles sp on sp.user_id = u.id where sp.id = v_profile;
  insert into proof_results values ('B', 'fee rows for a profile with no login: ' || v_n, v_n = 0);

  -- C: createLoginAction's auth.admin.createUser (and what a public sign-up writes)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email, '',
          now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  select count(*) into v_n from public.users where id = v_uid;
  insert into proof_results values ('C', 'fee rows for a bare auth user: ' || v_n, v_n = 0);

  -- D: createLoginAction links the login
  update vppsone.staff_profiles set user_id = v_uid where id = v_profile and user_id is null;
  select role::text, is_active into v_role, v_active from public.users where id = v_uid;
  insert into proof_results values ('D', 'after linking: ' || coalesce(v_role, 'no row') || ', active ' || coalesce(v_active::text, '-'),
                                    v_role = 'accountant' and v_active);

  -- The actor for E, F and I: an active admin profile, a test account with no
  -- login (so it gets no fee row and is not one of G's admins).
  insert into vppsone.staff_profiles (display_name, short_name, role, is_test_account)
  values ('Proof Admin', 'PRA' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), 'admin', true)
  returning id into v_actor;

  -- E: changeRoleAction -> teacher, through change_staff_authority
  v_result := vppsone.change_staff_authority(v_actor, v_profile, 'teacher', true, 'proof E');
  select role::text into v_role from public.users where id = v_uid;
  insert into proof_results values ('E', 'teacher -> ' || coalesce(v_role, 'no row') || ' (' || v_result::text || ')',
                                    (v_result->>'ok')::boolean and v_role = 'view_only');

  -- F: the same function, office then fee_collector
  v_result := vppsone.change_staff_authority(v_actor, v_profile, 'office', true, 'proof F');
  select role::text into v_role from public.users where id = v_uid;
  v_bad := case when (v_result->>'ok')::boolean then 0 else 1 end;
  v_result := vppsone.change_staff_authority(v_actor, v_profile, 'fee_collector', true, 'proof F');
  insert into proof_results
  select 'F', 'office -> ' || coalesce(v_role, 'no row') || ', fee_collector -> ' || coalesce(u.role::text, 'no row'),
         v_bad = 0 and (v_result->>'ok')::boolean and v_role = 'view_only' and u.role::text = 'fee_collector'
  from public.users u where u.id = v_uid;

  -- G
  select count(*), count(*) filter (where u.role::text is distinct from 'admin')
    into v_admins, v_bad
  from vppsone.staff_profiles sp
  left join public.users u on u.id = sp.user_id
  where sp.role = 'admin' and sp.is_active and sp.user_id is not null;
  insert into proof_results values ('G', 'active admins with a login: ' || v_admins || ', not admin in public.users: ' || v_bad,
                                    v_admins > 0 and v_bad = 0);

  -- H: every write that could reach an admin's fee row, replayed
  update vppsone.staff_profiles set display_name = display_name
  where role = 'admin' and is_active and user_id is not null;
  update auth.users set raw_user_meta_data = raw_user_meta_data, updated_at = now()
  where id in (select user_id from vppsone.staff_profiles where role = 'admin' and is_active and user_id is not null);
  select count(*) filter (where u.role::text is distinct from 'admin' or not u.is_active)
    into v_bad
  from vppsone.staff_profiles sp
  left join public.users u on u.id = sp.user_id
  where sp.role = 'admin' and sp.is_active and sp.user_id is not null;
  insert into proof_results values ('H', 'admins demoted or deactivated after the touch: ' || v_bad, v_bad = 0);

  -- I: setLoginActiveAction (off), through change_staff_authority
  v_result := vppsone.change_staff_authority(v_actor, v_profile, 'fee_collector', false, 'proof I');
  select role::text, is_active into v_role, v_active from public.users where id = v_uid;
  insert into proof_results values ('I', 'login off: ' || coalesce(v_role, 'no row') || ', active ' || coalesce(v_active::text, '-'),
                                    (v_result->>'ok')::boolean and v_role = 'fee_collector' and not v_active);
end;
$$;

select case_id, detail, pass from proof_results order by case_id;

rollback;
