-- Test accounts manage only test accounts, and six student-keyed tables join
-- the test-session fence (Phase 3 fixes, PR #143 review; D-340).
--
-- 1. vppsone.change_staff_authority refuses a test-account actor changing the
--    role or access of a profile that is not a test account (reason
--    'test_account'). Two QA test accounts hold role admin; before this they
--    could demote, deactivate or promote real staff — the owner included —
--    stopped only by the last-admin rule. The app refuses first
--    (actorMayManage in staff-repo.ts); this is the database's half, because
--    the command runs as the service role with the actor passed in.
--
-- 2. vppsone.student_in_visible_session(student_id): the student's class
--    session against the viewer, the same sentence as every other fence:
--      a test account sees only test sessions, everybody else only real ones,
--      a real admin both. A row with no student is outside the fence (true);
--      a student or class that cannot be found is visible to real staff only.
--    SECURITY DEFINER so it reads public.students/classes whatever the
--    viewer's own fee permissions are (a teacher has no students:view).
--
-- 3. RESTRICTIVE test_session_fence policies on the six vppsone tables that
--    carry a student but no session_label, which 20261030155339 left out:
--    acc_counter_queue, acc_requests, data_quality_skips,
--    external_student_ids, parent_route_flags, promotion_marks.
--    USING and WITH CHECK both, to authenticated (service role bypasses RLS;
--    the app's assert*Visible hold that path).
--
-- Rollback:
--   drop policy test_session_fence on vppsone.<each of the six>;
--   drop function vppsone.student_in_visible_session(uuid);
--   restore change_staff_authority from 20261004031630 (without the
--   test_account branch).

create or replace function vppsone.student_in_visible_session(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_student_id is null
      or vppsone.is_real_admin()
      or coalesce(
           (select vppsone.is_test_session(c.session_label) = vppsone.current_is_test_account()
              from public.students s
              join public.classes c on c.id = s.class_id
             where s.id = p_student_id),
           not vppsone.current_is_test_account()
         );
$$;

comment on function vppsone.student_in_visible_session(uuid) is
  'Is this student''s class session one the signed-in viewer may open? Test accounts: TEST only; real staff: real only; real admin: both (D-340).';

revoke all on function vppsone.student_in_visible_session(uuid) from public, anon;
grant execute on function vppsone.student_in_visible_session(uuid) to authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array[
    'acc_counter_queue', 'acc_requests', 'data_quality_skips',
    'external_student_ids', 'parent_route_flags', 'promotion_marks'
  ]
  loop
    execute format('drop policy if exists test_session_fence on vppsone.%I', t);
    execute format(
      'create policy test_session_fence on vppsone.%I as restrictive for all to authenticated '
      'using (vppsone.student_in_visible_session(student_id)) '
      'with check (vppsone.student_in_visible_session(student_id))', t);
  end loop;
end;
$$;

create or replace function vppsone.change_staff_authority(
  p_actor_staff_id uuid,
  p_target_staff_id uuid,
  p_role vppsone.staff_role,
  p_is_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor vppsone.staff_profiles%rowtype;
  target vppsone.staff_profiles%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('vppsone:staff-authority'));

  select * into actor from vppsone.staff_profiles where id = p_actor_staff_id;
  if not found or not actor.is_active or actor.role <> 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  select * into target from vppsone.staff_profiles where id = p_target_staff_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Phase 3 (D-340): a test account manages only test accounts.
  if actor.is_test_account and not target.is_test_account then
    return jsonb_build_object('ok', false, 'reason', 'test_account');
  end if;

  if target.role = p_role and target.is_active = p_is_active then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if target.id = actor.id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  begin
    update vppsone.staff_profiles set role = p_role, is_active = p_is_active where id = target.id;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'reason', 'last_admin');
  end;

  insert into vppsone.staff_authority_changes (
    staff_profile_id, actor_staff_id, from_role, to_role, from_active, to_active, reason
  ) values (
    target.id, actor.id, target.role, p_role, target.is_active, p_is_active,
    nullif(btrim(coalesce(p_reason, '')), '')
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$function$;
