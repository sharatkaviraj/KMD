-- Built-in AI goes live for staff (owner direction, 4 November 2026).
--
-- The pilot fenced every AI job, cover-photo apply and Undo to TEST-2026-27.
-- A job now belongs to the session the member of staff is working in, which
-- the app resolves with the ordinary session rule. The fence that stays is the
-- one every other write keeps (D-340): a test account works only in a TEST
-- session. Cover-photo apply and Undo take their session from the job row,
-- never from the caller, and still go through commit_cover_command.

alter table vppsone.ai_jobs drop constraint ai_jobs_session_label_check;
alter table vppsone.ai_jobs add constraint ai_jobs_session_label_check
  check (session_label ~ '^([A-Z]{2,5}-)?[0-9]{4}-[0-9]{2}$');

drop function vppsone.reserve_ai_job(uuid, text, uuid, integer, integer, text, text);
create function vppsone.reserve_ai_job(
  p_staff uuid, p_action text, p_session text, p_target uuid, p_revision integer,
  p_pages integer, p_model text, p_audio_extension text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_day timestamptz := date_trunc('day', v_now at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_limit integer;
  v_extension text := coalesce(p_audio_extension, 'jpg');
  v_test boolean;
begin
  if p_action not in ('marks-photo','substitution-photo','voice')
     or p_pages is null or p_pages not between 1 and 4
     or (p_action = 'voice' and (p_pages <> 1 or v_extension not in ('webm','m4a','wav')))
     or (p_action <> 'voice' and p_audio_extension is not null)
     or p_action is null
     or p_session is null or p_session !~ '^([A-Z]{2,5}-)?[0-9]{4}-[0-9]{2}$' then
    raise exception 'invalid AI input';
  end if;
  select is_test_account into v_test from vppsone.staff_profiles where id = p_staff and is_active;
  if not found then
    raise exception 'invalid AI input';
  end if;
  -- A test account works only in a TEST session (D-340). Which real session a
  -- member of staff may open is the app's session rule (resolveSessionLabel).
  if v_test and p_session !~ '^(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}$' then
    raise exception 'AI session not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('builtin-ai:' || p_staff::text, 0));
  select daily_limit into v_limit from vppsone.builtin_ai_settings where id = 1;
  if v_limit is null or (select count(*) from vppsone.ai_jobs where staff_profile_id = p_staff and created_at >= v_day) >= v_limit then
    return null;
  end if;
  insert into vppsone.ai_jobs (id, staff_profile_id, action, session_label, target_id, target_revision, input_paths, model, created_at)
  values (v_id, p_staff, p_action, p_session, p_target, p_revision,
    array(select v_id::text || '/' || i::text || '.' || v_extension from generate_series(1, p_pages) i), p_model, v_now);
  return v_id;
end;
$$;
revoke all on function vppsone.reserve_ai_job(uuid, text, text, uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function vppsone.reserve_ai_job(uuid, text, text, uuid, integer, integer, text, text) to service_role;

create or replace function vppsone.apply_ai_cover_photo(
  p_job uuid, p_actor uuid, p_day date, p_timetable_day text,
  p_version uuid, p_bells integer, p_assignments jsonb, p_review jsonb
) returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_session text;
  j vppsone.ai_jobs%rowtype;
  s vppsone.timetable_slots%rowtype;
  r record;
  v_existing jsonb;
  v_desired jsonb := '[]';
  v_previous_absences jsonb;
  v_absences jsonb;
  v_applied jsonb := '[]';
  v_keys text[] := '{}';
  v_row jsonb;
  v_written text;
  v_date_parts text[];
  v_starts timestamptz;
  v_first_start timestamptz;
  v_undo_until timestamptz;
  v_receipt jsonb;
  v_result jsonb;
begin
  if p_day is null or p_version is null or p_timetable_day is null or p_bells is null
     or length(btrim(p_timetable_day)) < 3
     or not starts_with(lower(to_char(p_day, 'FMDay')), lower(btrim(p_timetable_day)))
     or jsonb_typeof(p_assignments) is distinct from 'array'
     or jsonb_array_length(p_assignments) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = p_actor and sp.is_active and rp.permission = 'substitutions:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  select * into j from vppsone.ai_jobs
  where id = p_job and staff_profile_id = p_actor
    and action = 'substitution-photo' and purged_at is null
    and target_id = ('00000000-0000-4000-8000-0000' || to_char(p_day, 'YYYYMMDD'))::uuid
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_session := j.session_label;
  -- A test account acts only in a TEST session (D-340), whatever the caller says.
  if exists (select 1 from vppsone.staff_profiles where id = p_actor and is_test_account)
     and v_session !~ '^(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  if j.status = 'applied' then
    return jsonb_build_object('ok', true, 'result', j.final_applied_data);
  end if;
  if j.status <> 'draft' or j.parsed_at is null or j.raw_output is null
     or j.roster_stamp is distinct from p_version::text || ':' || p_bells::text then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:cover:' || v_session || ':' || p_day::text));
  if coalesce((select revision from vppsone.cover_days where session_label = v_session and day = p_day), 0)
       <> j.target_revision
     or not exists (select 1 from vppsone.timetable_versions
                    where id = p_version and session_label = v_session and status = 'published') then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  -- The ordinary absence table's unique key omits session_label. Prevent a
  -- concurrent insertion for the same staff/day from letting the upsert
  -- replace an absence belonging to another session.
  lock table vppsone.teacher_absences in share row exclusive mode;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]') into v_existing
  from vppsone.cover_duties d
  where d.session_label = v_session and d.day = p_day and d.status in ('assigned', 'needs_help');

  for r in
    select * from jsonb_to_recordset(p_assignments)
      as x(index integer, "absentId" uuid, "coveringId" uuid, "classId" uuid, period smallint, "needKey" text)
  loop
    if r."absentId" is null or r."coveringId" is null or r."absentId" = r."coveringId"
       or r."classId" is null or r.period is null or r.period not between 0 and 7
       or r.index is null or r.index not between 0 and 59 or r."needKey" is null
       or r."needKey" = any(v_keys) or v_applied @> jsonb_build_array(r.index) then
      return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;

    v_row := j.raw_output->'rows'->r.index;
    v_written := btrim(translate(v_row->>'sourceDate', '०१२३४५६७८९０１２３４５６７８９', '01234567890123456789'));
    v_date_parts := regexp_match(v_written, '^([0-9]{1,2})[[:space:]]*([./-])[[:space:]]*([0-9]{1,2})[[:space:]]*\2[[:space:]]*([0-9]{4})$');
    if v_row->'unclear' is distinct from 'false'::jsonb or (
      v_written is distinct from p_day::text and
      (v_date_parts[4] || '-' || lpad(v_date_parts[3], 2, '0') || '-' || lpad(v_date_parts[1], 2, '0')) is distinct from p_day::text
    ) then
      return jsonb_build_object('ok', false, 'reason', 'source_date');
    end if;

    select (p_day + (period->>'starts')::time) at time zone 'Asia/Kolkata'
    into v_starts
    from vppsone.bell_schedules b, jsonb_array_elements(b.periods) period
    where b.session_label = v_session and b.is_current and b.revision = p_bells
      and (period->>'index')::smallint = r.period;
    if v_starts is null or v_starts <= clock_timestamp() + interval '2 minutes' then
      return jsonb_build_object('ok', false, 'reason', 'closed');
    end if;
    v_first_start := least(v_first_start, v_starts);

    select * into s from vppsone.timetable_slots ts
    where ts.version_id = p_version and ts.day = p_timetable_day and ts.period = r.period
      and ts.class_id = r."classId" and ts.staff_profile_id = r."absentId"
      and not ts.parallel and not ts.shared;
    if not found or r."needKey" <>
       (s.day || '|P' || s.period || '|ordinary|' || s.subject_code || '|' || s.class_id || '|' || s.staff_profile_id || '#lesson')
       or (select count(*) from vppsone.timetable_slots ts
           where ts.version_id = p_version and ts.day = p_timetable_day and ts.period = r.period
             and (ts.class_id = r."classId" or ts.staff_profile_id = r."absentId")) <> 1
       or (select count(*) from vppsone.staff_profiles sp
           where sp.id in (r."absentId", r."coveringId") and sp.is_active and sp.is_teaching) <> 2
       or not exists (select 1 from vppsone.timetable_slots ts
                      where ts.version_id = p_version and ts.staff_profile_id = r."coveringId")
       or exists (select 1 from vppsone.cover_policies cp
                  where cp.session_label = v_session and cp.staff_profile_id = r."coveringId"
                    and not (r.period = any(cp.allowed_periods)))
       or exists (select 1 from vppsone.teacher_leave l
                  where l.session_label = v_session and l.staff_profile_id = r."coveringId" and l.status = 'approved'
                    and p_day between l.from_day and l.to_day
                    and (l.span = 'full' or (l.span = 'first_half' and r.period <= 3)
                                         or (l.span = 'second_half' and r.period > 3)))
       or exists (select 1 from vppsone.teacher_absences a
                  where a.staff_profile_id = r."absentId" and a.day = p_day and a.session_label <> v_session)
       or exists (select 1 from vppsone.cover_duties d
                  where d.session_label = v_session and d.day = p_day and d.need_key = r."needKey"
                    and (d.status = 'assigned' or (d.covering_staff_id = r."coveringId" and d.cannot_cover_at is not null)))
    then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    v_desired := v_desired || jsonb_build_object(
      'need_key', r."needKey", 'period', r.period, 'event_kind', 'ordinary',
      'class_ids', jsonb_build_array(s.class_id), 'class_labels', jsonb_build_array(s.class_label),
      'subject_code', s.subject_code, 'absent_staff_ids', jsonb_build_array(r."absentId"),
      'status', 'assigned', 'covering_staff_id', r."coveringId", 'source', 'manual', 'pinned', true
    );
    v_applied := v_applied || to_jsonb(r.index);
    v_keys := array_append(v_keys, r."needKey");
  end loop;

  -- Only append or fill the photographed duties. Keep every other duty,
  -- including unresolved duties and the coordinator's existing choices.
  v_desired := v_desired || coalesce(
    (select jsonb_agg(value) from jsonb_array_elements(v_existing) where not (value->>'need_key' = any(v_keys))),
    '[]'
  );
  with changes as (
    select (entry->>'absentId')::uuid as staff_id, array_agg(distinct (entry->>'period')::smallint) as periods
    from jsonb_array_elements(p_assignments) entry
    group by (entry->>'absentId')::uuid
  ), additions as (
    select c.staff_id, c.periods, a.periods as previous
    from changes c left join vppsone.teacher_absences a
      on a.staff_profile_id = c.staff_id and a.day = p_day and a.session_label = v_session
    where a.periods is null or not c.periods <@ a.periods
  )
  select coalesce(jsonb_agg(jsonb_build_object('staff_profile_id', staff_id, 'periods', previous)), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('staff_profile_id', staff_id, 'periods', previous || periods)), '[]')
  into v_previous_absences, v_absences
  from additions;

  v_receipt := vppsone.commit_cover_command(jsonb_build_object(
    'command_id', p_job, 'kind', 'substitution_photo', 'actor_staff_id', p_actor, 'session_label', v_session,
    'day', p_day, 'timetable_day', p_timetable_day, 'payload_hash', 'substitution-photo:' || p_job,
    'expected', jsonb_build_object('day_revision', j.target_revision, 'timetable_version_id', p_version, 'bells_revision', p_bells),
    'absences', v_absences, 'duties', v_desired
  ));
  if not (v_receipt->>'ok')::boolean then return v_receipt; end if;
  v_undo_until := clock_timestamp() + interval '2 minutes';
  if v_first_start <= v_undo_until
     or (select count(*) from vppsone.staff_notices where command_id = p_job and status = 'pending')
          <> jsonb_array_length(v_applied) then
    raise exception 'substitution photo was not fully applied';
  end if;
  update vppsone.staff_notices set next_attempt_at = v_undo_until
  where command_id = p_job and status = 'pending';

  v_result := jsonb_build_object('jobId', p_job, 'review', p_review, 'applied', v_applied, 'undoUntil', v_undo_until);
  update vppsone.ai_jobs set
    status = 'applied', applied_at = v_undo_until - interval '2 minutes', final_applied_data = v_result,
    reviewed_data = jsonb_build_object(
      'duties', v_existing, 'absences', v_previous_absences, 'dayRevision', v_receipt->'day_revision',
      'version', p_version, 'bells', p_bells, 'timetableDay', p_timetable_day
    )
  where id = p_job;
  return jsonb_build_object('ok', true, 'result', v_result);
end;
$$;

create or replace function vppsone.undo_ai_cover_photo(p_job uuid, p_actor uuid, p_day date)
returns jsonb
language plpgsql volatile security invoker set search_path = ''
as $$
declare
  v_session text;
  j vppsone.ai_jobs%rowtype;
  v_undo_until timestamptz;
  v_notice_count integer;
  v_receipt jsonb;
  v_result jsonb;
begin
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = p_actor and sp.is_active and rp.permission = 'substitutions:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  select * into j from vppsone.ai_jobs
  where id = p_job and staff_profile_id = p_actor
    and action = 'substitution-photo' and status = 'applied' and purged_at is null
    and target_id = ('00000000-0000-4000-8000-0000' || to_char(p_day, 'YYYYMMDD'))::uuid
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_session := j.session_label;
  -- A test account acts only in a TEST session (D-340), whatever the caller says.
  if exists (select 1 from vppsone.staff_profiles where id = p_actor and is_test_account)
     and v_session !~ '^(TEST|UAT|DEMO)-[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  if j.final_applied_data->>'undone' = 'true' then
    return jsonb_build_object('ok', true, 'result', j.final_applied_data);
  end if;
  v_undo_until := (j.final_applied_data->>'undoUntil')::timestamptz;
  if v_undo_until is null or clock_timestamp() >= v_undo_until then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:cover:' || v_session || ':' || p_day::text));
  lock table vppsone.teacher_absences in share row exclusive mode;
  if exists (
    select 1 from vppsone.teacher_absences a
    join jsonb_array_elements(j.reviewed_data->'absences') prior on a.staff_profile_id = (prior->>'staff_profile_id')::uuid
    where a.day = p_day and a.session_label <> v_session
  ) then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  -- Teacher replies lock their duty before writing a notice. Use that same
  -- order here so any reply which already happened stays in the history and
  -- any reply to the withdrawn duty is refused after Undo commits.
  perform 1 from vppsone.cover_duties d where d.command_id = p_job order by d.id for update;

  -- Take the same notice locks the dispatcher claims, before the real-clock
  -- check. Once locked, the dispatcher skips these rows until Undo commits.
  perform 1 from vppsone.staff_notices n where n.command_id = p_job order by n.id for update;
  select count(*) into v_notice_count from vppsone.staff_notices
  where command_id = p_job and kind = 'cover_assigned';
  if clock_timestamp() >= v_undo_until then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_notice_count <> jsonb_array_length(j.final_applied_data->'applied') or exists (
    select 1 from vppsone.staff_notices n
    join vppsone.cover_duties d on d.id = n.duty_id
    where n.command_id = p_job
      and (n.status <> 'pending' or n.attempts <> 0 or n.next_attempt_at is distinct from v_undo_until
           or d.status <> 'assigned')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  v_receipt := vppsone.commit_cover_command(jsonb_build_object(
    'command_id', gen_random_uuid(), 'kind', 'substitution_photo_undo', 'actor_staff_id', p_actor,
    'session_label', v_session, 'day', p_day, 'timetable_day', j.reviewed_data->'timetableDay',
    'payload_hash', 'substitution-photo-undo:' || p_job,
    'expected', jsonb_build_object(
      'day_revision', j.reviewed_data->'dayRevision',
      'timetable_version_id', j.reviewed_data->'version', 'bells_revision', j.reviewed_data->'bells'
    ),
    'absences', j.reviewed_data->'absences', 'duties', j.reviewed_data->'duties'
  ));
  if not (v_receipt->>'ok')::boolean then return v_receipt; end if;
  if exists (select 1 from vppsone.staff_notices where command_id = p_job and status <> 'cancelled') then
    raise exception 'substitution photo notices were not withdrawn';
  end if;
  v_result := j.final_applied_data || jsonb_build_object('undone', true);
  update vppsone.ai_jobs set final_applied_data = v_result where id = p_job;
  return jsonb_build_object('ok', true, 'result', v_result);
end;
$$;

-- Create or replace keeps the grants; restated for the reader.
revoke all on function vppsone.apply_ai_cover_photo(uuid, uuid, date, text, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
revoke all on function vppsone.undo_ai_cover_photo(uuid, uuid, date) from public, anon, authenticated;
grant execute on function vppsone.apply_ai_cover_photo(uuid, uuid, date, text, uuid, integer, jsonb, jsonb) to service_role;
grant execute on function vppsone.undo_ai_cover_photo(uuid, uuid, date) to service_role;

-- A notice for any duty that descends from an applied AI cover photo honours
-- its Undo hold, in every session.
create or replace function vppsone.inherit_ai_cover_photo_hold()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_hold timestamptz;
begin
  if new.duty_id is null then return new; end if;
  with recursive chain as (
    select id, supersedes, command_id from vppsone.cover_duties where id = new.duty_id
    union
    select d.id, d.supersedes, d.command_id from vppsone.cover_duties d join chain c on c.supersedes = d.id
  )
  select max((j.final_applied_data->>'undoUntil')::timestamptz) into v_hold
  from chain c join vppsone.ai_jobs j on c.command_id = j.id
  where j.action = 'substitution-photo' and j.status = 'applied';

  if v_hold > clock_timestamp() then new.next_attempt_at := greatest(new.next_attempt_at, v_hold); end if;
  return new;
end;
$$;
revoke all on function vppsone.inherit_ai_cover_photo_hold() from public, anon, authenticated;
