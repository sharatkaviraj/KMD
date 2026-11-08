/*
 * Each session has its own kind of staff (owner, 8 Nov 2026: "the test
 * accounts and QA accounts should be in the test session only ... the real
 * live data will only have the genuine accounts").
 *
 * A test account (`staff_profiles.is_test_account`) works only in a test
 * session (TEST-/UAT-/DEMO-); real staff work only in a real one. The app's
 * half is `staffBelongsToSession()` in src/platform/auth/test-session-policy.ts,
 * which every staff list, picker and count now asks. This is the database's
 * half, for the writes a picker cannot reach:
 *
 *   1. `vppsone.staff_matches_session(staff, session)`: the same predicate.
 *   2. `queue_staff_notice` skips a notice whose person and session differ,
 *      both ways. It already skipped a test account in a real session; it now
 *      also skips a real person in a test session (a TEST leave request was
 *      queuing a WhatsApp notice to the real admin). Skipping, not raising:
 *      a notice is a side effect, and the cover/leave write that queued it
 *      must still succeed.
 *   3. `staff_session_match` triggers refuse putting somebody on another
 *      session's work: class teachers, teaching assignments, timetable slots,
 *      staff scopes, cover policies, teacher tasks, collection requests, exam
 *      duties and exam marks links. Each is a deliberate assignment chosen
 *      from a staff picker. Columns that can default to the person writing
 *      (a note's "follow up: me", a plan step's owner) are left alone: that is
 *      authorship, and a real admin may still look at the test session.
 *      An update is checked only when the person or the session changes, so
 *      existing rows and same-value upserts are untouched.
 *   4. No rows are changed here. The handful of test-only leftovers (never-
 *      sent notices across the line, practice-day leave for real teachers in
 *      the TEST session, one real-year cover policy for a test account) were
 *      removed as a one-off data fix the same day; see D-560 in
 *      docs/DECISIONS.md. Existing rows are never re-checked.
 *
 * Nothing here is in `public` and no fee row is read or written.
 */

begin;

/* ------------------------------------------------------------ predicate */

create or replace function vppsone.staff_matches_session(p_staff uuid, p_session text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- No person, or a person the foreign key will refuse anyway: nothing to say.
  select coalesce((
    select sp.is_test_account = vppsone.is_test_session_label(p_session)
    from vppsone.staff_profiles sp
    where sp.id = p_staff
  ), true);
$$;

revoke all on function vppsone.staff_matches_session(uuid, text) from public, anon;
grant execute on function vppsone.staff_matches_session(uuid, text) to authenticated, service_role;

/* ---------------------------------------------------- notices, both ways */

create or replace function vppsone.queue_staff_notice(
  p_key text,
  p_kind text,
  p_staff uuid,
  p_session text,
  p_payload jsonb,
  p_not_after timestamptz default null,
  p_requested_by uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_test boolean;
  v_id uuid;
begin
  if p_staff is null or coalesce(p_session, '') = '' then
    return null;
  end if;
  select is_test_account into v_test
  from vppsone.staff_profiles where id = p_staff and is_active;
  if not found then
    return null;
  end if;
  -- A test account hears only about test sessions, and real staff only about
  -- real ones (8 Nov 2026; before, only the first half was checked).
  if v_test is distinct from vppsone.is_test_session_label(p_session) then
    return null;
  end if;

  insert into vppsone.staff_notices (
    notice_key, kind, staff_profile_id, session_label, day, not_after, command_id, payload, requested_by
  ) values (
    p_key, p_kind, p_staff, p_session, (now() at time zone 'Asia/Kolkata')::date,
    coalesce(p_not_after, now() + interval '3 days'), gen_random_uuid(), coalesce(p_payload, '{}'::jsonb), p_requested_by
  )
  on conflict (notice_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

/* ------------------------------------------------------- the row guard */

/*
 * TG_ARGV[0]: the column holding the session label, or (with TG_ARGV[1]) the
 *             column holding the parent row's id.
 * TG_ARGV[1]: '' when the row carries its own session_label; otherwise the
 *             vppsone table whose `session_label` the row belongs to.
 * TG_ARGV[2..]: the staff columns to check.
 */
create or replace function vppsone.guard_staff_session_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_key text := tg_argv[0];
  v_parent text := nullif(tg_argv[1], '');
  v_session text;
  v_staff uuid;
  v_changed boolean;
  i integer;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_changed := (v_new -> v_key) is distinct from (v_old -> v_key);
    for i in 2 .. tg_nargs - 1 loop
      v_changed := v_changed or (v_new -> tg_argv[i]) is distinct from (v_old -> tg_argv[i]);
    end loop;
    if not v_changed then
      return new;
    end if;
  end if;

  if v_parent is null then
    v_session := v_new ->> v_key;
  else
    if (v_new ->> v_key) is null then
      return new;
    end if;
    execute format('select session_label from vppsone.%I where id = $1', v_parent)
      into v_session
      using (v_new ->> v_key)::uuid;
    if v_session is null then
      return new; -- no parent: the foreign key decides
    end if;
  end if;

  for i in 2 .. tg_nargs - 1 loop
    v_staff := (v_new ->> tg_argv[i])::uuid;
    if v_staff is not null and not vppsone.staff_matches_session(v_staff, v_session) then
      raise exception using
        errcode = 'check_violation',
        message = 'Test accounts work only in a test session, and real staff only in the real year.',
        detail = format('%s.%s, session %s', tg_table_name, tg_argv[i], coalesce(v_session, '(none)'));
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function vppsone.guard_staff_session_match() from public, anon, authenticated;

create or replace trigger staff_session_match
  before insert or update of session_label, staff_profile_id on vppsone.class_teachers
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of session_label, staff_profile_id on vppsone.teaching_assignments
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of session_label, staff_profile_id on vppsone.staff_scopes
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of session_label, staff_profile_id on vppsone.cover_policies
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of session_label, assigned_staff_id on vppsone.teacher_tasks
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'assigned_staff_id');

create or replace trigger staff_session_match
  before insert or update of session_label, assigned_staff_id on vppsone.collection_requests
  for each row execute function vppsone.guard_staff_session_match('session_label', '', 'assigned_staff_id');

create or replace trigger staff_session_match
  before insert or update of version_id, staff_profile_id on vppsone.timetable_slots
  for each row execute function vppsone.guard_staff_session_match('version_id', 'timetable_versions', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of assessment_id, staff_profile_id on vppsone.exam_duties
  for each row execute function vppsone.guard_staff_session_match('assessment_id', 'assessments', 'staff_profile_id');

create or replace trigger staff_session_match
  before insert or update of assessment_id, staff_profile_id on vppsone.exam_marks_links
  for each row execute function vppsone.guard_staff_session_match('assessment_id', 'assessments', 'staff_profile_id');

commit;
