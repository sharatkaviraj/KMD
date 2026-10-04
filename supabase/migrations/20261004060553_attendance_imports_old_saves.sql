-- P6 follow-up: a register submitted without a revision is kept, not overwritten.
--
-- Until this release is deployed, the previous build still saves registers the
-- old way: status 'submitted', revision 0, no history row. None exist on dev
-- now (checked before writing this), but one could be made in the minutes
-- between this migration and the deploy. The save command now imports such a
-- register as revision 1 — exactly as the P6 migration imported the rest —
-- before it compares revisions, so the next save is refused as stale and the
-- page shows what was recorded. Any that exist when this runs are imported
-- here.

create or replace function vppsone.import_unrevisioned_register(p_register uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r vppsone.attendance_registers%rowtype;
  v_marks jsonb;
begin
  select * into r from vppsone.attendance_registers where id = p_register for update;
  if not found or r.status <> 'submitted' or r.revision <> 0 then
    return;
  end if;

  select coalesce(jsonb_object_agg(student_id::text, status::text), '{}'::jsonb) into v_marks
  from vppsone.attendance_marks where register_id = p_register;

  update vppsone.attendance_registers
  set revision = 1, totals = vppsone.attendance_totals(v_marks)
  where id = p_register;

  insert into vppsone.attendance_register_revisions (
    register_id, revision, kind, command_id, actor_staff_id, on_behalf_of, marks, totals, created_at
  ) values (
    p_register, 1, 'imported', gen_random_uuid(), r.taken_by, r.on_behalf_of,
    v_marks, vppsone.attendance_totals(v_marks), coalesce(r.submitted_at, r.updated_at)
  );
end;
$$;

revoke all on function vppsone.import_unrevisioned_register(uuid) from public;
grant execute on function vppsone.import_unrevisioned_register(uuid) to service_role;

create or replace function vppsone.save_attendance_register(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_session text := p->>'session_label';
  v_class uuid;
  v_day date;
  v_kind text := coalesce(p->>'kind', 'save');
  v_expected integer;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_hash text := p->>'payload_hash';
  v_fault text := p->>'fault';
  v_request uuid;
  v_previous vppsone.attendance_register_revisions%rowtype;
  v_register vppsone.attendance_registers%rowtype;
  v_actor_name text;
  v_actor_user uuid;
  v_owner boolean;
  v_office boolean;
  v_corrector boolean;
  v_day_kind vppsone.calendar_day_kind;
  v_roster uuid[];
  v_marks jsonb := '{}'::jsonb;
  m jsonb;
  v_status text;
  v_missing uuid[];
  v_extra text[];
  v_current integer;
  v_latest uuid;
  v_old jsonb := '{}'::jsonb;
  v_changes jsonb;
  v_totals jsonb;
  v_roster_hash text;
  v_on_behalf uuid;
  v_revision_id uuid;
  v_now timestamptz := now();
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_class := (p->>'class_id')::uuid;
    v_day := (p->>'day')::date;
    v_expected := coalesce((p->>'expected_revision')::integer, 0);
    v_request := nullif(p->>'correction_request_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;

  if v_command is null or v_actor is null or v_session is null or v_class is null or v_day is null
     or v_hash is null or v_kind not in ('save', 'correction')
     or jsonb_typeof(p->'marks') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  -- 1. One command per register at a time.
  perform pg_advisory_xact_lock(
    hashtext('vppsone:attendance:' || v_session || ':' || v_class::text || ':' || v_day::text)
  );

  -- 2. The same submission again gets the same receipt, however long after.
  select * into v_previous from vppsone.attendance_register_revisions where command_id = v_command;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.actor_staff_id = v_actor then
      return vppsone.attendance_receipt(v_previous.id) || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  -- 3. Who is asking, now. The class teacher (or assistant) as of today owns
  -- the register; a former one does not keep it. The office marks on behalf
  -- and corrects; deciding somebody else's request is the office's.
  select display_name, user_id into v_actor_name, v_actor_user
  from vppsone.staff_profiles where id = v_actor and is_active;
  if v_actor_name is null then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  v_owner := exists (
    select 1
    from vppsone.class_teachers ct
    join vppsone.staff_profiles sp on sp.id = ct.staff_profile_id
    join vppsone.role_permissions rp on rp.role = sp.role and rp.permission = 'attendance:mark'
    where ct.staff_profile_id = v_actor
      and ct.class_id = v_class
      and ct.session_label = v_session
      and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
      and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
  );
  v_office := exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and rp.permission = 'attendance:mark_on_behalf'
  );
  v_corrector := exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and rp.permission = 'attendance:correct'
  );

  if (v_kind = 'save' and not (v_owner or v_office))
     or (v_kind = 'correction' and not (v_owner or v_corrector))
     or (v_request is not null and not v_corrector) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  -- 4. A day that happened, on which the school was open.
  if v_day > vppsone.school_today() then
    return jsonb_build_object('ok', false, 'reason', 'future_day');
  end if;
  select kind into v_day_kind from vppsone.academic_calendar_days
  where session_label = v_session and day = v_day;
  if (v_day_kind is not null and v_day_kind in ('holiday', 'vacation'))
     or (v_day_kind is null and extract(dow from v_day) = 0) then
    return jsonb_build_object('ok', false, 'reason', 'school_closed');
  end if;

  -- 5. Every child on that day's roll, exactly once, and nobody else.
  select coalesce(array_agg(s order by s), '{}') into v_roster
  from vppsone.attendance_roster(v_session, v_class, v_day) s;
  if cardinality(v_roster) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_roster');
  end if;

  for m in select value from jsonb_array_elements(p->'marks')
  loop
    v_status := m->>'status';
    if (m->>'student_id') is null
       or v_status is null
       or v_status not in ('present', 'absent', 'late', 'half_day', 'leave')
       or v_marks ? (m->>'student_id') then
      return jsonb_build_object('ok', false, 'reason', 'bad_request');
    end if;
    v_marks := v_marks || jsonb_build_object(m->>'student_id', v_status);
  end loop;

  select coalesce(array_agg(r order by r), '{}') into v_missing
  from unnest(v_roster) r where not (v_marks ? r::text);
  select coalesce(array_agg(k order by k), '{}') into v_extra
  from jsonb_object_keys(v_marks) k
  where not (k = any (select r::text from unnest(v_roster) r));

  if cardinality(v_missing) > 0 or cardinality(v_extra) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'roster_changed', 'missing', to_jsonb(v_missing), 'extra', to_jsonb(v_extra));
  end if;

  -- 6. Nothing has moved since the page was drawn.
  select * into v_register from vppsone.attendance_registers
  where session_label = v_session and class_id = v_class and day = v_day and period is null
  for update;

  -- A register submitted before revisions were kept — by an older build,
  -- while this one was deploying — is history too. Keep it as revision 1
  -- before anything else, so this save is told it is stale rather than
  -- writing over a register somebody already handed in.
  if v_register.id is not null and v_register.status = 'submitted' and v_register.revision = 0 then
    perform vppsone.import_unrevisioned_register(v_register.id);
    select * into v_register from vppsone.attendance_registers where id = v_register.id;
  end if;

  v_current := coalesce(v_register.revision, 0);

  if v_current <> v_expected then
    select id into v_latest from vppsone.attendance_register_revisions
    where register_id = v_register.id order by revision desc limit 1;
    return jsonb_build_object(
      'ok', false,
      'reason', 'stale',
      'current_revision', v_current,
      'latest', case when v_latest is null then null else vppsone.attendance_receipt(v_latest) end
    );
  end if;

  if v_kind = 'correction' and v_current = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_saved_yet');
  end if;
  if v_kind = 'correction' and v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  if v_register.id is not null then
    select coalesce(jsonb_object_agg(student_id::text, status::text), '{}'::jsonb) into v_old
    from vppsone.attendance_marks where register_id = v_register.id;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('student_id', k, 'from', v_old->>k, 'to', v_marks->>k) order by k),
    '[]'::jsonb
  ) into v_changes
  from jsonb_object_keys(v_marks) k
  where (v_old->>k) is distinct from (v_marks->>k);

  if v_kind = 'correction' and jsonb_array_length(v_changes) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_change');
  end if;

  v_totals := vppsone.attendance_totals(v_marks);
  v_roster_hash := md5(array_to_string(v_roster, ','));

  -- The office standing in: name the class teacher it stood in for.
  if v_kind = 'save' and not v_owner then
    select ct.staff_profile_id into v_on_behalf
    from vppsone.class_teachers ct
    where ct.class_id = v_class and ct.session_label = v_session and ct.role = 'class_teacher'
      and ct.staff_profile_id <> v_actor
      and (ct.effective_from is null or ct.effective_from <= vppsone.school_today())
      and (ct.effective_to is null or ct.effective_to >= vppsone.school_today())
    limit 1;
  end if;

  -- 7. The register. The morning job may have opened it meanwhile; either way
  -- there is exactly one, and it moves to the next revision.
  if v_register.id is null then
    insert into vppsone.attendance_registers (session_label, class_id, day, period, status, created_by)
    values (v_session, v_class, v_day, null, 'open', v_actor_user)
    on conflict (session_label, class_id, day) where period is null do nothing;
    select * into v_register from vppsone.attendance_registers
    where session_label = v_session and class_id = v_class and day = v_day and period is null
    for update;
    if v_register.revision <> 0 then
      raise exception 'attendance:raced';
    end if;
  end if;

  update vppsone.attendance_registers
  set status = 'submitted',
      taken_by = case when v_kind = 'save' then v_actor else taken_by end,
      on_behalf_of = case when v_kind = 'save' then v_on_behalf else on_behalf_of end,
      submitted_at = coalesce(submitted_at, v_now),
      revision = v_current + 1,
      roster_hash = v_roster_hash,
      totals = v_totals
  where id = v_register.id;

  if v_fault = 'after_register' and vppsone.flag_enabled('fault_injection') then
    raise exception 'attendance:injected_fault:after_register';
  end if;

  delete from vppsone.attendance_marks
  where register_id = v_register.id and not (v_marks ? student_id::text);

  insert into vppsone.attendance_marks (register_id, student_id, status)
  select v_register.id, k::uuid, (v_marks->>k)::vppsone.attendance_status
  from jsonb_object_keys(v_marks) k
  on conflict (register_id, student_id) do update
    set status = excluded.status
    where vppsone.attendance_marks.status is distinct from excluded.status;

  if v_fault = 'after_marks' and vppsone.flag_enabled('fault_injection') then
    raise exception 'attendance:injected_fault:after_marks';
  end if;

  insert into vppsone.attendance_register_revisions (
    register_id, revision, kind, command_id, payload_hash, actor_staff_id, on_behalf_of,
    reason, marks, changes, roster_hash, totals, correction_request_id
  ) values (
    v_register.id, v_current + 1, v_kind, v_command, v_hash, v_actor,
    case when v_kind = 'save' then v_on_behalf else null end,
    v_reason, v_marks, v_changes, v_roster_hash, v_totals, v_request
  )
  returning id into v_revision_id;

  -- 8. A correction that answers a request closes it, in the same breath.
  if v_request is not null then
    update vppsone.attendance_corrections
    set status = 'approved', decided_by = v_actor, decided_at = v_now,
        decision_note = nullif(btrim(coalesce(p->>'decision_note', '')), '')
    where id = v_request and status = 'pending' and register_id = v_register.id
      and requested_by <> v_actor;
    if not found then
      raise exception 'attendance:request_not_pending';
    end if;
  end if;

  if v_fault = 'before_receipt' and vppsone.flag_enabled('fault_injection') then
    raise exception 'attendance:injected_fault:before_receipt';
  end if;

  return vppsone.attendance_receipt(v_revision_id);
end;
$$;

select vppsone.import_unrevisioned_register(id)
from vppsone.attendance_registers
where status = 'submitted' and revision = 0;
