-- P1 (Gate C): one staff authority, and reads scoped to it.
--
-- Until now every `vppsone` table carried one policy, `for select to
-- authenticated using (true)`. The app checked permissions on every screen,
-- but PostgREST is reachable directly with any signed-in JWT on this project —
-- and the fee app's accounts, a profile-less login and a staff member
-- deactivated an hour ago all hold one. Each could read every register, note,
-- mark, guardian snapshot and every collection link's bearer token.
--
-- This migration makes the database agree with `src/platform/auth/permissions.ts`:
--
--  1. `vppsone.role_permissions` is the permission map, as rows. Seeded here
--     from the TypeScript map; `tests/scoped-reads.test.ts` fails if the two
--     disagree, so a change to one without the other cannot ship.
--  2. Helper functions answer "is this an active staff member", "may they do
--     X" and "which classes are theirs", from `staff_profiles` and nothing else
--     (D-6: never a JWT claim, never `public.users`).
--  3. Every policy is replaced. Reference data needs an active profile; pupil
--     data needs the permission its screen needs *and* the class scope — a
--     teacher reads her own classes, the office and coordinators read all.
--  4. (The three columns that stop being readable directly — staff phones, a
--     teacher's absence reason and a collection link's token — are the next
--     migration, applied once the code that reads them differently is live.)
--  5. Role, activation and the last administrator are one command,
--     `change_staff_authority`, admin-only, audited, and serialised so two
--     simultaneous demotions cannot remove the last admin.
--
-- Additive except for the dropped `using (true)` policies, which are what is
-- being fixed. Writes still go through the service role after the app checks.

-- ------------------------------------------------------------------ school date

create or replace function vppsone.school_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

comment on function vppsone.school_today() is
  'Today in Amet. Postgres runs in UTC, and 00:00-05:30 UTC is still yesterday at school.';

-- ----------------------------------------------------------- the permission map

create table vppsone.role_permissions (
  role vppsone.staff_role not null,
  permission text not null,
  primary key (role, permission),
  constraint role_permissions_shape check (permission ~ '^[a-z_]+:[a-z_]+$')
);

comment on table vppsone.role_permissions is
  'src/platform/auth/permissions.ts as rows, so a policy can ask the same question the app does. tests/scoped-reads.test.ts keeps them equal.';

insert into vppsone.role_permissions (role, permission) values
  ('admin', 'dashboard:view'),
  ('admin', 'staff:view'),
  ('admin', 'staff:manage'),
  ('admin', 'academics:view'),
  ('admin', 'academics:manage'),
  ('admin', 'timetable:view'),
  ('admin', 'timetable:manage'),
  ('admin', 'substitutions:view'),
  ('admin', 'substitutions:manage'),
  ('admin', 'attendance:view'),
  ('admin', 'attendance:mark'),
  ('admin', 'attendance:mark_on_behalf'),
  ('admin', 'attendance:correct'),
  ('admin', 'notes:view'),
  ('admin', 'notes:write'),
  ('admin', 'collection:view'),
  ('admin', 'collection:manage'),
  ('admin', 'documents:view'),
  ('admin', 'documents:manage'),
  ('admin', 'assessments:view'),
  ('admin', 'assessments:manage'),
  ('admin', 'marks:view'),
  ('admin', 'marks:write'),
  ('admin', 'reports:view'),
  ('admin', 'students:view'),
  ('admin', 'apps:view'),
  ('admin', 'fees:view'),
  ('admin', 'fees:collect'),
  ('admin', 'fees:manage'),
  ('admin', 'jobs:view'),
  ('admin', 'jobs:run'),
  ('admin', 'audit:view'),
  ('office', 'dashboard:view'),
  ('office', 'staff:view'),
  ('office', 'staff:manage'),
  ('office', 'academics:view'),
  ('office', 'academics:manage'),
  ('office', 'timetable:view'),
  ('office', 'substitutions:view'),
  ('office', 'attendance:view'),
  ('office', 'attendance:mark_on_behalf'),
  ('office', 'attendance:correct'),
  ('office', 'notes:view'),
  ('office', 'collection:view'),
  ('office', 'collection:manage'),
  ('office', 'documents:view'),
  ('office', 'documents:manage'),
  ('office', 'assessments:view'),
  ('office', 'marks:view'),
  ('office', 'reports:view'),
  ('office', 'apps:view'),
  ('office', 'students:view'),
  ('office', 'fees:view'),
  ('accountant', 'dashboard:view'),
  ('accountant', 'fees:view'),
  ('accountant', 'fees:collect'),
  ('fee_collector', 'dashboard:view'),
  ('fee_collector', 'fees:view'),
  ('academic_coordinator', 'dashboard:view'),
  ('academic_coordinator', 'staff:view'),
  ('academic_coordinator', 'academics:view'),
  ('academic_coordinator', 'academics:manage'),
  ('academic_coordinator', 'timetable:view'),
  ('academic_coordinator', 'timetable:manage'),
  ('academic_coordinator', 'substitutions:view'),
  ('academic_coordinator', 'substitutions:manage'),
  ('academic_coordinator', 'attendance:view'),
  ('academic_coordinator', 'notes:view'),
  ('academic_coordinator', 'assessments:view'),
  ('academic_coordinator', 'marks:view'),
  ('academic_coordinator', 'reports:view'),
  ('exam_coordinator', 'dashboard:view'),
  ('exam_coordinator', 'staff:view'),
  ('exam_coordinator', 'academics:view'),
  ('exam_coordinator', 'timetable:view'),
  ('exam_coordinator', 'attendance:view'),
  ('exam_coordinator', 'assessments:view'),
  ('exam_coordinator', 'assessments:manage'),
  ('exam_coordinator', 'marks:view'),
  ('exam_coordinator', 'marks:write'),
  ('exam_coordinator', 'reports:view'),
  ('teacher', 'dashboard:view'),
  ('teacher', 'timetable:view'),
  ('teacher', 'substitutions:view'),
  ('teacher', 'attendance:view'),
  ('teacher', 'attendance:mark'),
  ('teacher', 'notes:view'),
  ('teacher', 'notes:write'),
  ('teacher', 'assessments:view'),
  ('teacher', 'marks:view'),
  ('teacher', 'marks:write'),
  ('view_only', 'dashboard:view'),
  ('view_only', 'timetable:view');

alter table vppsone.role_permissions enable row level security;
-- Read only through the functions below; nothing needs the raw table.
revoke all on vppsone.role_permissions from authenticated;
grant all on vppsone.role_permissions to service_role;

-- ------------------------------------------------------------- who is asking

create or replace function vppsone.current_staff_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sp.id
  from vppsone.staff_profiles sp
  where sp.user_id = (select auth.uid()) and sp.is_active
$$;

create or replace function vppsone.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select vppsone.current_staff_profile_id() is not null
$$;

create or replace function vppsone.staff_can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.user_id = (select auth.uid())
      and sp.is_active
      and rp.permission = p_permission
  )
$$;

create or replace function vppsone.staff_can_any(p_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.user_id = (select auth.uid())
      and sp.is_active
      and rp.permission = any (p_permissions)
  )
$$;

/*
 * Whose job is every class. Mirrors `readsEveryClass()` in permissions.ts:
 * the office and the administrator run the school, the two coordinators
 * oversee it. A teacher is not on this list — her classes are her own.
 */
create or replace function vppsone.reads_every_class()
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
      and sp.role in ('admin', 'office', 'academic_coordinator', 'exam_coordinator')
  )
$$;

/*
 * The classes that are this person's, as `class_id|session_label` keys.
 *
 * Class teacher over the whole effective interval, not only `effective_to is
 * null`: a teacher handed a class from next Monday is not its teacher today,
 * and one replaced today still is until tonight. Plus every class the
 * published timetable has them teaching. A cover duty is deliberately not a
 * source: covering a period gives no right to the class's records (PLAN P1).
 */
create or replace function vppsone.my_class_keys()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select vppsone.current_staff_profile_id() as id)
  select coalesce(array_agg(distinct k), '{}'::text[])
  from (
    select ct.class_id::text || '|' || ct.session_label as k
    from vppsone.class_teachers ct, me
    where ct.staff_profile_id = me.id
      and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
      and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
    union
    select ta.class_id::text || '|' || ta.session_label
    from vppsone.teaching_assignments ta, me
    where ta.staff_profile_id = me.id
  ) keys
$$;

revoke all on function vppsone.current_staff_profile_id() from public;
revoke all on function vppsone.is_active_staff() from public;
revoke all on function vppsone.staff_can(text) from public;
revoke all on function vppsone.staff_can_any(text[]) from public;
revoke all on function vppsone.reads_every_class() from public;
revoke all on function vppsone.my_class_keys() from public;
grant execute on function vppsone.current_staff_profile_id() to authenticated, service_role;
grant execute on function vppsone.is_active_staff() to authenticated, service_role;
grant execute on function vppsone.staff_can(text) to authenticated, service_role;
grant execute on function vppsone.staff_can_any(text[]) to authenticated, service_role;
grant execute on function vppsone.reads_every_class() to authenticated, service_role;
grant execute on function vppsone.my_class_keys() to authenticated, service_role;
grant execute on function vppsone.school_today() to authenticated, service_role;

-- --------------------------------------------------- drop every using (true)

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'vppsone' and cmd = 'SELECT' and qual = 'true'
  loop
    execute format('drop policy %I on vppsone.%I', p.policyname, p.tablename);
  end loop;
end
$$;

-- ------------------------------------------- reference data: any active staff
--
-- Timetables, subjects, the calendar, who teaches what, cover policies and
-- plans. No child is named in any of these.

do $$
declare
  t text;
begin
  foreach t in array array[
    'subjects', 'class_aliases', 'class_teachers', 'academic_calendar_days',
    'timetable_versions', 'timetable_slots', 'teaching_assignments',
    'note_kinds', 'cover_policies', 'teacher_absences', 'substitution_plans',
    'substitution_assignments', 'collection_fields', 'message_templates',
    'assessments', 'assessment_subjects', 'staff_scopes', 'data_replica'
  ]
  loop
    execute format(
      'create policy %I on vppsone.%I for select to authenticated using ((select vppsone.is_active_staff()))',
      t || '_select_active_staff', t
    );
  end loop;
end
$$;

-- A profile row is readable by its own login even when inactive, so the sign-in
-- screen can say "your account is switched off" rather than "no account".
create policy staff_profiles_select_active_staff
  on vppsone.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select vppsone.is_active_staff()));

-- --------------------------------------------- pupil data: permission + class

create policy enrolments_select_scoped
  on vppsone.enrolments for select to authenticated
  using (
    (select vppsone.staff_can_any(array[
      'attendance:view', 'students:view', 'reports:view', 'collection:view',
      'marks:view', 'documents:view'
    ]))
    and (
      (select vppsone.reads_every_class())
      or (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
    )
  );

create policy attendance_registers_select_scoped
  on vppsone.attendance_registers for select to authenticated
  using (
    (select vppsone.staff_can('attendance:view'))
    and (
      (select vppsone.reads_every_class())
      or (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
    )
  );

-- A mark is visible when its register is: the subquery is itself under the
-- register policy above.
create policy attendance_marks_select_scoped
  on vppsone.attendance_marks for select to authenticated
  using (
    exists (select 1 from vppsone.attendance_registers r where r.id = register_id)
  );

create policy attendance_corrections_select_scoped
  on vppsone.attendance_corrections for select to authenticated
  using (
    requested_by = (select vppsone.current_staff_profile_id())
    or exists (select 1 from vppsone.attendance_registers r where r.id = register_id)
  );

-- Mirrors canReadNote(): the office and admin follow up on every concern;
-- anybody else reads what they wrote and what is about their own classes.
create policy notes_select_scoped
  on vppsone.notes for select to authenticated
  using (
    (select vppsone.staff_can('notes:view'))
    and (
      (select vppsone.staff_can('attendance:correct'))
      or written_by = (select vppsone.current_staff_profile_id())
      or (
        class_id is not null
        and (class_id::text || '|' || session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
      )
    )
  );

create policy marks_select_scoped
  on vppsone.marks for select to authenticated
  using (
    (select vppsone.staff_can('marks:view'))
    and exists (
      select 1
      from vppsone.assessment_subjects s
      join vppsone.assessments a on a.id = s.assessment_id
      where s.id = assessment_subject_id
        and (
          (select vppsone.reads_every_class())
          or (s.class_id::text || '|' || a.session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
        )
    )
  );

create policy marks_change_log_select_scoped
  on vppsone.marks_change_log for select to authenticated
  using (
    (select vppsone.staff_can('marks:view'))
    and exists (
      select 1
      from vppsone.assessment_subjects s
      join vppsone.assessments a on a.id = s.assessment_id
      where s.id = assessment_subject_id
        and (
          (select vppsone.reads_every_class())
          or (s.class_id::text || '|' || a.session_label) = any (coalesce((select vppsone.my_class_keys()), '{}'::text[]))
        )
    )
  );

-- A child is in scope when one of their enrolments is visible — which the
-- enrolments policy has already decided.
create policy report_cards_select_scoped
  on vppsone.report_cards for select to authenticated
  using (
    (select vppsone.staff_can('reports:view'))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = report_cards.student_id
          and e.session_label = report_cards.session_label
      )
    )
  );

create policy academic_exports_select_scoped
  on vppsone.academic_exports for select to authenticated
  using ((select vppsone.staff_can('reports:view')));

create policy student_records_select_scoped
  on vppsone.student_records for select to authenticated
  using (
    (select vppsone.staff_can_any(array[
      'collection:view', 'documents:view', 'students:view', 'attendance:view'
    ]))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = student_records.student_id
          and e.session_label = student_records.session_label
      )
    )
  );

create policy student_documents_select_scoped
  on vppsone.student_documents for select to authenticated
  using (
    (select vppsone.staff_can('documents:view'))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = student_documents.student_id
          and e.session_label = student_documents.session_label
      )
    )
  );

create policy external_student_ids_select_scoped
  on vppsone.external_student_ids for select to authenticated
  using (
    (select vppsone.staff_can_any(array['students:view', 'collection:view', 'attendance:view']))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e where e.student_id = external_student_ids.student_id
      )
    )
  );

-- ------------------------------------------------- collection: office + owner

create policy collection_rounds_select_scoped
  on vppsone.collection_rounds for select to authenticated
  using ((select vppsone.staff_can('collection:view')));

create policy collection_round_fields_select_scoped
  on vppsone.collection_round_fields for select to authenticated
  using ((select vppsone.staff_can('collection:view')));

create policy collection_requests_select_scoped
  on vppsone.collection_requests for select to authenticated
  using (
    (select vppsone.staff_can('collection:view'))
    or assigned_staff_id = (select vppsone.current_staff_profile_id())
  );

create policy collection_request_fields_select_scoped
  on vppsone.collection_request_fields for select to authenticated
  using (exists (select 1 from vppsone.collection_requests r where r.id = request_id));

create policy collection_request_members_select_scoped
  on vppsone.collection_request_members for select to authenticated
  using (exists (select 1 from vppsone.collection_requests r where r.id = request_id));

create policy collection_submissions_select_scoped
  on vppsone.collection_submissions for select to authenticated
  using (exists (select 1 from vppsone.collection_requests r where r.id = request_id));

create policy message_sends_select_scoped
  on vppsone.message_sends for select to authenticated
  using ((select vppsone.staff_can('collection:view')));

create policy job_runs_select_scoped
  on vppsone.job_runs for select to authenticated
  using ((select vppsone.staff_can('jobs:view')));

-- ------------------------------------------- one authority for role and access

create table vppsone.staff_authority_changes (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  actor_staff_id uuid references vppsone.staff_profiles (id) on delete set null,
  from_role vppsone.staff_role not null,
  to_role vppsone.staff_role not null,
  from_active boolean not null,
  to_active boolean not null,
  reason text,
  changed_at timestamptz not null default now()
);

comment on table vppsone.staff_authority_changes is
  'Every change of role or activation, who made it and why. Appended by change_staff_authority(); never edited.';

create index staff_authority_changes_by_staff_idx
  on vppsone.staff_authority_changes (staff_profile_id, changed_at desc);

alter table vppsone.staff_authority_changes enable row level security;
create policy staff_authority_changes_select_scoped
  on vppsone.staff_authority_changes for select to authenticated
  using ((select vppsone.staff_can('staff:manage')));
grant select on vppsone.staff_authority_changes to authenticated;
grant all on vppsone.staff_authority_changes to service_role;

/*
 * The last active administrator cannot stop being one.
 *
 * A trigger, not only a check in the command, because the command is not the
 * only writer a future change might add — and serialised on one advisory lock,
 * because two demotions of two different admins each see the other admin as
 * still there unless one waits for the other to commit. The count runs after
 * the lock is held, so it sees the first one's result.
 */
create or replace function vppsone.staff_profiles_keep_an_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining integer;
begin
  if tg_op = 'DELETE' then
    if not (old.role = 'admin' and old.is_active) then
      return old;
    end if;
  elsif not (old.role = 'admin' and old.is_active)
     or (new.role = 'admin' and new.is_active) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:staff-authority'));

  select count(*) into remaining
  from vppsone.staff_profiles sp
  where sp.role = 'admin' and sp.is_active and sp.id <> old.id;

  if remaining = 0 then
    raise exception 'The school must keep at least one active administrator.'
      using errcode = 'check_violation', hint = 'last_admin';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger staff_profiles_keep_an_admin
  before update of role, is_active or delete on vppsone.staff_profiles
  for each row execute function vppsone.staff_profiles_keep_an_admin();

/*
 * Change who somebody is allowed to be. Admin only, audited, atomic.
 *
 * The app checks the actor too; this checks again, against the row as it is
 * now rather than as the page saw it, because the page may be an hour old and
 * the actor may have been demoted since. Called by the service role only.
 */
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
as $$
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

  if target.role = p_role and target.is_active = p_is_active then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if target.id = actor.id then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;

  begin
    update vppsone.staff_profiles
    set role = p_role, is_active = p_is_active
    where id = target.id;
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
$$;

revoke all on function vppsone.change_staff_authority(uuid, uuid, vppsone.staff_role, boolean, text) from public;
grant execute on function vppsone.change_staff_authority(uuid, uuid, vppsone.staff_role, boolean, text) to service_role;
