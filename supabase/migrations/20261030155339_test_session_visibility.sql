-- Who may see a test session (Phase 3, D-340; critique0 #13, #14, #15).
--
-- wtgxcptmucjerhufzjcf is production AND the only test bed (D-346, owner T1):
-- testing happens in TEST-2026-27, by test accounts
-- (staff_profiles.is_test_account, added by 20261030112133). The rule is one
-- sentence, and this file is its SQL half:
--
--   A test account sees and writes only test sessions; everybody else sees and
--   writes only real ones; a REAL admin (role admin AND not a test account)
--   sees and writes both.
--
-- The app half is src/platform/auth/test-session-access.ts. Both use the same
-- definition of "real admin" — the ROLE, not a permission (critique0 #14: the
-- permission matrix is editable, so a `settings:manage` predicate here and a
-- role check there could drift apart).
--
-- What this file adds:
--  * vppsone.is_test_session(label)       = is_test_session_label(label)
--  * vppsone.current_is_test_account()     the viewer's flag (false with no profile)
--  * vppsone.is_real_admin()               role admin, active, not a test account
--  * vppsone.can_see_test_sessions()       is_real_admin() or current_is_test_account()
--  * vppsone.set_test_account(id, value, reason)
--        the one way a signed-in person changes the flag: a real admin, never
--        on themselves, logged to staff_authority_changes.
--  * one RESTRICTIVE policy per session-labelled table (53 of them), USING and
--    WITH CHECK both
--        (is_test_session(session_label) = current_is_test_account()) or is_real_admin()
--    and the same, through an EXISTS join to the parent's label, on the 27
--    child tables and 7 grandchild tables that carry no label of their own (87 in all).
--
-- What it does NOT do. One's own writes are service role (D-179), which
-- bypasses RLS: these policies hold the PostgREST path (a signed-in browser
-- reading vppsone directly). The app's assertSessionWritable/Visible hold the
-- rest. And `public` (the fee tables) keeps the fees app's permission-only RLS
-- while mirror mode runs — a test account reading PostgREST directly could
-- see real fee rows. That is the accepted, owner-signed limit in plan §3.4.
--
-- staff_profiles_test_flag_guard is replaced: it used to refuse every change
-- under an `authenticated` JWT, which also refused set_test_account. It now
-- keys on the database role actually running the UPDATE: a direct PostgREST
-- update runs as `authenticated` and is refused; set_test_account runs as its
-- owner and is let through (it does its own, stricter checks).
--
-- Rollback:
--   drop policy test_session_fence on vppsone.<each table>;   (87 tables)
--   drop function vppsone.set_test_account(uuid, boolean, text);
--   drop function vppsone.can_see_test_sessions(); drop function vppsone.is_real_admin();
--   drop function vppsone.current_is_test_account(); drop function vppsone.is_test_session(text);
--   and restore staff_profiles_test_flag_guard from 20261030112133.

/* ------------------------------------------------------------- definitions */

create or replace function vppsone.is_test_session(p_label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select vppsone.is_test_session_label(p_label);
$$;

comment on function vppsone.is_test_session(text) is
  'A rehearsal session label (TEST-/UAT-/DEMO-YYYY-YY). Same as isTestAcademicSessionLabel().';

create or replace function vppsone.current_is_test_account()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select sp.is_test_account from vppsone.staff_profiles sp
     where sp.user_id = (select auth.uid()) and sp.is_active),
    false
  );
$$;

comment on function vppsone.current_is_test_account() is
  'The signed-in staff member''s is_test_account (false without an active profile).';

create or replace function vppsone.is_real_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vppsone.staff_profiles sp
    where sp.user_id = (select auth.uid())
      and sp.is_active
      and sp.role = 'admin'
      and not sp.is_test_account
  );
$$;

comment on function vppsone.is_real_admin() is
  'Role admin, active, and NOT a test account. A test admin is fenced to TEST like every test account (critique0 #14).';

create or replace function vppsone.can_see_test_sessions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.is_real_admin() or vppsone.current_is_test_account();
$$;

comment on function vppsone.can_see_test_sessions() is
  'May this viewer see test sessions at all: a real admin or a test account.';

revoke all on function vppsone.is_test_session(text) from public, anon;
revoke all on function vppsone.current_is_test_account() from public, anon;
revoke all on function vppsone.is_real_admin() from public, anon;
revoke all on function vppsone.can_see_test_sessions() from public, anon;
grant execute on function vppsone.is_test_session(text) to authenticated, service_role;
grant execute on function vppsone.current_is_test_account() to authenticated, service_role;
grant execute on function vppsone.is_real_admin() to authenticated, service_role;
grant execute on function vppsone.can_see_test_sessions() to authenticated, service_role;

/* ------------------------------------------------- changing the test flag */

-- `current_user` is the role executing the UPDATE: `authenticated` / `anon`
-- for a PostgREST request, the function owner inside set_test_account, and
-- `service_role` / `postgres` for the admin client and the SQL editor.

create or replace function vppsone.staff_profiles_test_flag_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.is_test_account is distinct from old.is_test_account then
    raise exception 'is_test_account is changed through vppsone.set_test_account, by a real administrator.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function vppsone.staff_profiles_test_flag_guard() from public, anon, authenticated;

/*
 * Mark or unmark a test account. The signed-in person must be a REAL admin
 * (role admin, active, not a test account), may not change their own flag,
 * and must give a reason. Logged to staff_authority_changes with the role and
 * active flag unchanged and the flag change spelt out in `reason`.
 *
 * Callable by `authenticated` (the actor is auth.uid(), not a parameter), so
 * the app calls it with the signed-in person's own client, after its own check.
 */
create or replace function vppsone.set_test_account(
  p_profile_id uuid,
  p_value boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor vppsone.staff_profiles%rowtype;
  target vppsone.staff_profiles%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_value is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:staff-authority'));

  select * into actor from vppsone.staff_profiles
  where user_id = (select auth.uid()) and is_active;
  if not found or actor.role <> 'admin' or actor.is_test_account then
    return jsonb_build_object('ok', false, 'reason', 'not_real_admin');
  end if;

  select * into target from vppsone.staff_profiles where id = p_profile_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if target.id = actor.id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if target.is_test_account = p_value then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update vppsone.staff_profiles set is_test_account = p_value where id = target.id;

  insert into vppsone.staff_authority_changes (
    staff_profile_id, actor_staff_id, from_role, to_role, from_active, to_active, reason
  ) values (
    target.id, actor.id, target.role, target.role, target.is_active, target.is_active,
    format('is_test_account: %s -> %s. %s', target.is_test_account, p_value, v_reason)
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

comment on function vppsone.set_test_account(uuid, boolean, text) is
  'Mark/unmark a test account: real admin only, never self, reason required, logged (critique0 #14).';

revoke all on function vppsone.set_test_account(uuid, boolean, text) from public, anon;
grant execute on function vppsone.set_test_account(uuid, boolean, text) to authenticated;

/* -------------------------------------------------- the fence, per table */

do $$
declare
  t text;
  labelled text[] := array[
    'academic_calendar_days', 'academic_exports', 'admission_details', 'archives',
    'assessments', 'attendance_registers', 'attendance_rules', 'bell_schedules',
    'calendar_events', 'calendar_notices', 'class_aliases', 'class_seats',
    'class_teachers', 'collection_requests', 'collection_rounds', 'cover_commands',
    'cover_days', 'cover_duties', 'cover_policies', 'drive_folders', 'enquiries',
    'enrolments', 'fee_call_promises', 'fee_day_close_events', 'fee_desk_requests',
    'fee_reminder_batches', 'message_campaigns', 'message_sends', 'notes',
    'parent_message_queue', 'parent_replies', 'report_card_issues',
    'report_card_remarks', 'report_cards', 'report_schemes', 'sampark_import_batches',
    'staff_notices', 'staff_scopes', 'student_documents', 'student_followups',
    'student_photos', 'student_record_history', 'student_records',
    'substitution_plans', 'support_plans', 'teacher_absence_history',
    'teacher_absences', 'teacher_leave', 'teacher_tasks', 'teaching_assignments',
    'team_supervision_rules', 'timetable_changes', 'timetable_versions'
  ];
  -- child table, its foreign-key column, the parent that carries the label
  children text[][] := array[
    ['assessment_subjects', 'assessment_id', 'assessments'],
    ['attendance_corrections', 'register_id', 'attendance_registers'],
    ['attendance_marks', 'register_id', 'attendance_registers'],
    ['attendance_register_revisions', 'register_id', 'attendance_registers'],
    ['collection_request_fields', 'request_id', 'collection_requests'],
    ['collection_request_members', 'request_id', 'collection_requests'],
    ['collection_round_fields', 'round_id', 'collection_rounds'],
    ['collection_submissions', 'request_id', 'collection_requests'],
    ['document_upload_sessions', 'document_id', 'student_documents'],
    ['exam_activity', 'assessment_id', 'assessments'],
    ['exam_class_locks', 'assessment_id', 'assessments'],
    ['exam_duties', 'assessment_id', 'assessments'],
    ['exam_marks_links', 'assessment_id', 'assessments'],
    ['exam_plans', 'assessment_id', 'assessments'],
    ['exam_reminders', 'assessment_id', 'assessments'],
    ['exam_seats', 'assessment_id', 'assessments'],
    ['exam_slots', 'assessment_id', 'assessments'],
    ['note_replies', 'note_id', 'notes'],
    ['parent_reply_answers', 'message_send_id', 'message_sends'],
    ['photo_proposals', 'request_id', 'collection_requests'],
    ['restore_drills', 'archive_id', 'archives'],
    ['sampark_import_rows', 'batch_id', 'sampark_import_batches'],
    ['staff_notice_attempts', 'notice_id', 'staff_notices'],
    ['staff_notice_reads', 'campaign_id', 'message_campaigns'],
    ['substitution_assignments', 'plan_id', 'substitution_plans'],
    ['support_plan_steps', 'plan_id', 'support_plans'],
    ['timetable_slots', 'version_id', 'timetable_versions']
  ];
  -- grandchild, its column, the child it points at, the child's column, the labelled parent
  grandchildren text[][] := array[
    ['marks', 'assessment_subject_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['marks_change_log', 'assessment_subject_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['marks_commands', 'assessment_subject_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['exam_grace', 'paper_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['exam_moderation', 'paper_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['exam_rechecks', 'paper_id', 'assessment_subjects', 'assessment_id', 'assessments'],
    ['exam_question_papers', 'slot_id', 'exam_slots', 'assessment_id', 'assessments']
  ];
  fence constant text :=
    '((vppsone.is_test_session(%s) = (select vppsone.current_is_test_account())) or (select vppsone.is_real_admin()))';
  predicate text;
  i int;
begin
  foreach t in array labelled loop
    predicate := format(fence, 'session_label');
    execute format(
      'create policy test_session_fence on vppsone.%I as restrictive for all to authenticated using %s with check %s',
      t, predicate, predicate
    );
  end loop;

  for i in 1 .. array_length(children, 1) loop
    -- A null parent id has no session: visible as a real row, like any unlabelled row.
    predicate := format(
      '(%1$I is null or exists (select 1 from vppsone.%2$I p where p.id = %3$I.%1$I and %4$s))',
      children[i][2], children[i][3], children[i][1], format(fence, 'p.session_label')
    );
    execute format(
      'create policy test_session_fence on vppsone.%I as restrictive for all to authenticated using %s with check %s',
      children[i][1], predicate, predicate
    );
  end loop;

  for i in 1 .. array_length(grandchildren, 1) loop
    predicate := format(
      '(%1$I is null or exists (select 1 from vppsone.%2$I c join vppsone.%4$I p on p.id = c.%3$I '
        'where c.id = %5$I.%1$I and %6$s))',
      grandchildren[i][2], grandchildren[i][3], grandchildren[i][4], grandchildren[i][5],
      grandchildren[i][1], format(fence, 'p.session_label')
    );
    execute format(
      'create policy test_session_fence on vppsone.%I as restrictive for all to authenticated using %s with check %s',
      grandchildren[i][1], predicate, predicate
    );
  end loop;
end;
$$;
