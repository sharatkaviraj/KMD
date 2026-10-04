-- P6: a register is saved whole, once, with a receipt — and changed only by a
-- correction that says why.
--
-- Before this a register could be submitted with some children marked and the
-- rest simply missing, which every reader then had to interpret; a lost
-- response was recovered by comparing marks in the action; and changing a
-- submitted register rewrote the mark in place behind an approval, leaving no
-- before-and-after. The plan's rule (§12) is the other way round:
--
--   - opening a roster records nothing; "present" is only a preview until a
--     person presses Save;
--   - a save names every child on the roll for that date, or it is refused —
--     a roll that changed underneath the page is shown, not guessed at;
--   - only the server's receipt makes a register recorded, and the receipt
--     says who, when, the totals and the revision;
--   - a correction is a new revision with a reason, by the class's current
--     teacher or by the office, and the old one is kept.
--
-- Everything here is in `vppsone`. Nothing reads or writes fee data.

-- ---------------------------------------------------------------------------
-- The school's rule for a half day
-- ---------------------------------------------------------------------------

create table vppsone.attendance_rules (
  session_label text primary key,
  /** How much of a day a half day counts as in a percentage: 0 to 1. */
  half_day_credit numeric(3, 2) not null default 0.50,
  revision integer not null default 1,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint attendance_rules_half_day_credit_range
    check (half_day_credit >= 0 and half_day_credit <= 1)
);

comment on table vppsone.attendance_rules is
  'Per session, how attendance is counted. Absent a row, a half day counts as 0.5 — the default the school can change.';

alter table vppsone.attendance_rules enable row level security;
create policy attendance_rules_select_staff
  on vppsone.attendance_rules for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.attendance_rules to authenticated;
grant all on vppsone.attendance_rules to service_role;

create or replace function vppsone.half_day_credit(p_session text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select half_day_credit from vppsone.attendance_rules where session_label = p_session),
    0.50
  );
$$;

-- ---------------------------------------------------------------------------
-- The register carries its revision; every revision is kept
-- ---------------------------------------------------------------------------

alter table vppsone.attendance_registers
  add column revision integer not null default 0,
  add column roster_hash text,
  add column totals jsonb;

comment on column vppsone.attendance_registers.revision is
  '0 until the first save; each save or correction adds one. Only a register at revision 1 or more is recorded.';

create table vppsone.attendance_register_revisions (
  id uuid primary key default gen_random_uuid(),
  -- RESTRICT: a register's history outlives nothing. Registers are never
  -- deleted by the app; a test that removes one removes its history first.
  register_id uuid not null references vppsone.attendance_registers (id) on delete restrict,
  revision integer not null,
  kind text not null,
  /** The browser's submission id. A repeat returns this revision's receipt. */
  command_id uuid not null,
  payload_hash text,
  actor_staff_id uuid references vppsone.staff_profiles (id) on delete restrict,
  /** The class teacher the office stood in for, if it did. No FK: one is enough to embed. */
  on_behalf_of uuid,
  reason text,
  /** The whole register as saved: student id → status. */
  marks jsonb not null,
  /** What this revision changed: [{student_id, from, to}]. */
  changes jsonb not null default '[]'::jsonb,
  /** The roll it was saved against, as md5 of the sorted ids. */
  roster_hash text,
  totals jsonb not null,
  /** The request this correction answered, when it came through the queue. */
  correction_request_id uuid,
  created_at timestamptz not null default now(),
  constraint attendance_register_revisions_kind_known
    check (kind in ('save', 'correction', 'imported')),
  constraint attendance_register_revisions_correction_says_why
    check (kind <> 'correction' or (reason is not null and btrim(reason) <> ''))
);

comment on table vppsone.attendance_register_revisions is
  'Every saved state of every daily register, with who, when, why and what changed. Append-only.';

create unique index attendance_register_revisions_one_per_number
  on vppsone.attendance_register_revisions (register_id, revision);
create unique index attendance_register_revisions_command_unique
  on vppsone.attendance_register_revisions (command_id);

alter table vppsone.attendance_register_revisions enable row level security;
-- Visible exactly when its register is: the subquery is itself under the
-- register's own scoped policy (P1).
create policy attendance_register_revisions_select_scoped
  on vppsone.attendance_register_revisions for select to authenticated
  using (exists (select 1 from vppsone.attendance_registers r where r.id = register_id));
grant select on vppsone.attendance_register_revisions to authenticated;
grant all on vppsone.attendance_register_revisions to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function vppsone.attendance_totals(p_marks jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'present', count(*) filter (where value = 'present'),
    'absent', count(*) filter (where value = 'absent'),
    'late', count(*) filter (where value = 'late'),
    'half_day', count(*) filter (where value = 'half_day'),
    'leave', count(*) filter (where value = 'leave'),
    'total', count(*)
  )
  from jsonb_each_text(coalesce(p_marks, '{}'::jsonb));
$$;

/**
 * Who was on a class's roll on a date.
 *
 * From the academic enrolment, not today's roll: a child admitted on the 10th
 * is not on the 9th's register, and one who left on the 10th is still on it
 * that day (the leaving date is their last). A row that says "left" with no
 * date cannot be placed and is not counted.
 */
create or replace function vppsone.attendance_roster(p_session text, p_class uuid, p_day date)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.student_id
  from vppsone.enrolments e
  where e.session_label = p_session
    and e.class_id = p_class
    and (e.enrolled_on is null or e.enrolled_on <= p_day)
    and (
      (e.status in ('enrolled', 'promoted') and e.left_on is null)
      or (e.left_on is not null and e.left_on >= p_day)
    );
$$;

create or replace function vppsone.attendance_receipt(p_revision uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'command_id', rv.command_id,
    'register_id', rv.register_id,
    'class_id', r.class_id,
    'day', r.day,
    'revision', rv.revision,
    'kind', rv.kind,
    'saved_at', rv.created_at,
    'actor_staff_id', rv.actor_staff_id,
    'actor_name', sp.display_name,
    'on_behalf_of', rv.on_behalf_of,
    'totals', rv.totals,
    'changes', jsonb_array_length(rv.changes),
    'replayed', false
  )
  from vppsone.attendance_register_revisions rv
  join vppsone.attendance_registers r on r.id = rv.register_id
  left join vppsone.staff_profiles sp on sp.id = rv.actor_staff_id
  where rv.id = p_revision;
$$;

-- ---------------------------------------------------------------------------
-- The command
-- ---------------------------------------------------------------------------

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

revoke all on function vppsone.half_day_credit(text) from public;
revoke all on function vppsone.attendance_totals(jsonb) from public;
revoke all on function vppsone.attendance_roster(text, uuid, date) from public;
revoke all on function vppsone.attendance_receipt(uuid) from public;
revoke all on function vppsone.save_attendance_register(jsonb) from public;
grant execute on function vppsone.half_day_credit(text) to authenticated, service_role;
grant execute on function vppsone.attendance_totals(jsonb) to service_role;
grant execute on function vppsone.attendance_roster(text, uuid, date) to service_role;
grant execute on function vppsone.attendance_receipt(uuid) to service_role;
grant execute on function vppsone.save_attendance_register(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- What was already submitted becomes revision 1, kept as it was
-- ---------------------------------------------------------------------------

with snapshot as (
  select r.id,
         coalesce(jsonb_object_agg(m.student_id::text, m.status::text) filter (where m.id is not null), '{}'::jsonb) as marks
  from vppsone.attendance_registers r
  left join vppsone.attendance_marks m on m.register_id = r.id
  where r.status = 'submitted'
  group by r.id
)
update vppsone.attendance_registers r
set revision = 1, totals = vppsone.attendance_totals(s.marks)
from snapshot s
where s.id = r.id;

insert into vppsone.attendance_register_revisions (
  register_id, revision, kind, command_id, actor_staff_id, on_behalf_of, marks, totals, created_at
)
select r.id, 1, 'imported', gen_random_uuid(), r.taken_by, r.on_behalf_of,
       coalesce(jsonb_object_agg(m.student_id::text, m.status::text) filter (where m.id is not null), '{}'::jsonb),
       r.totals,
       coalesce(r.submitted_at, r.updated_at)
from vppsone.attendance_registers r
left join vppsone.attendance_marks m on m.register_id = r.id
where r.status = 'submitted'
group by r.id;
