-- P7: marks are saved by one command per paper — drafted, then submitted, then
-- only corrected with a reason — and blank, zero, absent and exempt stay four
-- different things.
--
-- Before this a column saved cell by cell: a failure half-way left half a
-- column written. "Exempt" did not exist, so a child excused from a paper was
-- either a blank (and the paper never finished) or an absence (and a nought
-- on a report). Nothing said a teacher had finished: a column with every cell
-- filled looked the same as a column she was still checking. And any teacher
-- with a class could type marks for every subject in it.
--
-- The plan (§13): open only the assigned class and subject; keep blank, zero,
-- absent and exempt distinct; take the maximum and the precision from the
-- scheme; a draft returns a draft receipt; submitting completes the teacher's
-- task under the completeness rule and approves nothing; a missing entry is
-- visible and never a zero.

-- ---------------------------------------------------------------------------
-- The cell: exempt is its own state
-- ---------------------------------------------------------------------------

alter table vppsone.marks
  add column exempt boolean not null default false,
  add constraint marks_exempt_has_no_value check (not exempt or (value is null and not absent));

comment on column vppsone.marks.exempt is
  'Excused from this paper: not sat, not a nought, and out of both halves of any total.';

alter table vppsone.marks_change_log
  add column from_exempt boolean,
  add column to_exempt boolean,
  add column command_id uuid;

-- ---------------------------------------------------------------------------
-- The paper: its scheme, and whether its marks are in
-- ---------------------------------------------------------------------------

alter table vppsone.assessment_subjects
  add column mark_step numeric(4, 2) not null default 0.5,
  add column allow_exempt boolean not null default true,
  add column entry_status text not null default 'open',
  add column entry_revision integer not null default 0,
  add column submitted_by uuid references vppsone.staff_profiles (id) on delete restrict,
  add column submitted_at timestamptz,
  add constraint assessment_subjects_mark_step_known check (mark_step in (0.25, 0.5, 1)),
  add constraint assessment_subjects_entry_status_known check (entry_status in ('open', 'submitted')),
  add constraint assessment_subjects_submitted_together
    check ((entry_status = 'submitted') = (submitted_at is not null));

comment on column vppsone.assessment_subjects.mark_step is
  'The smallest part of a mark this paper gives: 1, 0.5 or 0.25.';
comment on column vppsone.assessment_subjects.entry_status is
  'open while the teacher drafts; submitted once every child has a mark, an absence or an exemption. Submitting approves nothing.';

-- ---------------------------------------------------------------------------
-- Every command, and its receipt
-- ---------------------------------------------------------------------------

create table vppsone.marks_commands (
  /** The submission id the browser minted once. */
  id uuid primary key,
  assessment_subject_id uuid not null references vppsone.assessment_subjects (id) on delete cascade,
  actor_staff_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  kind text not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  constraint marks_commands_kind_known check (kind in ('draft', 'submit', 'correction', 'reopen'))
);

comment on table vppsone.marks_commands is
  'Every committed marks command and the receipt it returned. A repeated id with the same payload gets the receipt back.';

create index marks_commands_by_paper_idx on vppsone.marks_commands (assessment_subject_id, created_at desc);

alter table vppsone.marks_commands enable row level security;
grant all on vppsone.marks_commands to service_role;

-- ---------------------------------------------------------------------------
-- Who sat a paper
-- ---------------------------------------------------------------------------

/**
 * The children on a paper's class roll at some point during its exam: enrolled
 * by the time it ended, and not gone before it began. Without dates, today's
 * roll. A child who joined after the exam is not asked for a mark; one who
 * left during it still is.
 */
create or replace function vppsone.paper_roster(p_paper uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.student_id
  from vppsone.assessment_subjects s
  join vppsone.assessments a on a.id = s.assessment_id
  join vppsone.enrolments e on e.class_id = s.class_id and e.session_label = a.session_label
  where s.id = p_paper
    and (e.enrolled_on is null or e.enrolled_on <= coalesce(a.ends_on, a.starts_on, vppsone.school_today()))
    and (
      (e.status in ('enrolled', 'promoted') and e.left_on is null)
      or (e.left_on is not null and e.left_on >= coalesce(a.starts_on, a.ends_on, vppsone.school_today()))
    );
$$;

-- ---------------------------------------------------------------------------
-- The command
-- ---------------------------------------------------------------------------

create or replace function vppsone.save_marks(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_paper uuid;
  v_kind text := coalesce(p->>'kind', 'draft');
  v_expected integer;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_hash text := p->>'payload_hash';
  v_fault text := p->>'fault';
  v_previous vppsone.marks_commands%rowtype;
  s vppsone.assessment_subjects%rowtype;
  a vppsone.assessments%rowtype;
  v_actor_name text;
  v_manager boolean;
  v_assigned boolean;
  v_roster uuid[];
  e jsonb;
  v_student uuid;
  v_state text;
  v_value numeric;
  v_seen uuid[] := '{}';
  v_old record;
  v_existed boolean;
  v_old_state text;
  v_changes integer := 0;
  v_blank uuid[];
  v_counts jsonb;
  v_receipt jsonb;
  v_now timestamptz := now();
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_paper := (p->>'paper_id')::uuid;
    v_expected := coalesce((p->>'expected_revision')::integer, 0);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;

  if v_command is null or v_actor is null or v_paper is null or v_hash is null
     or v_kind not in ('draft', 'submit', 'correction', 'reopen') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  -- 1. One command per paper at a time.
  select * into s from vppsone.assessment_subjects where id = v_paper for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 2. The same submission again gets the same receipt.
  select * into v_previous from vppsone.marks_commands where id = v_command;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.actor_staff_id = v_actor then
      return v_previous.receipt || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  select * into a from vppsone.assessments where id = s.assessment_id;

  -- 3. Who is asking: the teacher who teaches this subject to this class, or
  -- whoever runs the exams. A class teacher is not thereby every subject's.
  select display_name into v_actor_name from vppsone.staff_profiles where id = v_actor and is_active;
  if v_actor_name is null then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  v_manager := exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and rp.permission = 'assessments:manage'
  );
  v_assigned := exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role and rp.permission = 'marks:write'
    join vppsone.teaching_assignments ta
      on ta.staff_profile_id = sp.id and ta.session_label = a.session_label
     and ta.class_id = s.class_id and ta.subject_id = s.subject_id
    where sp.id = v_actor
  );
  if (v_kind = 'reopen' and not v_manager) or (v_kind <> 'reopen' and not (v_manager or v_assigned)) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  -- 4. An exam that is taking marks.
  if a.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'exam_not_open');
  end if;

  -- 5. Nothing has moved since the page was drawn.
  if s.entry_revision <> v_expected then
    return jsonb_build_object(
      'ok', false, 'reason', 'stale',
      'current_revision', s.entry_revision, 'entry_status', s.entry_status
    );
  end if;

  -- 6. What each kind may do from where the paper is.
  if v_kind = 'reopen' then
    if s.entry_status <> 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'not_submitted');
    end if;
    update vppsone.assessment_subjects
    set entry_status = 'open', entry_revision = entry_revision + 1, submitted_by = null, submitted_at = null
    where id = v_paper;
  else
    if v_kind in ('draft', 'submit') and s.entry_status = 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'already_submitted');
    end if;
    if v_kind = 'correction' and s.entry_status <> 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'not_submitted');
    end if;
    if v_kind = 'correction' and v_reason is null then
      return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    select coalesce(array_agg(r), '{}') into v_roster from vppsone.paper_roster(v_paper) r;

    -- 7. Every cell, against the scheme. A refusal leaves the column as it was.
    for e in select value from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb))
    loop
      begin
        v_student := (e->>'student_id')::uuid;
      exception when others then
        raise exception 'marks:bad_request';
      end;
      if v_student is null or v_student = any (v_seen) then
        raise exception 'marks:bad_request';
      end if;
      v_seen := v_seen || v_student;
      if not (v_student = any (v_roster)) then
        raise exception 'marks:not_on_roll:%', v_student;
      end if;

      v_state := e->>'state';
      v_value := null;
      if v_state = 'value' then
        begin
          v_value := (e->>'value')::numeric;
        exception when others then
          raise exception 'marks:invalid_value:%', v_student;
        end;
        if v_value is null or v_value < 0 or v_value > s.max_marks or mod(v_value, s.mark_step) <> 0 then
          raise exception 'marks:invalid_value:%', v_student;
        end if;
      elsif v_state = 'exempt' then
        if not s.allow_exempt then
          raise exception 'marks:exempt_not_allowed:%', v_student;
        end if;
      elsif v_state is null or v_state not in ('blank', 'absent') then
        raise exception 'marks:bad_request';
      end if;

      select value, absent, exempt into v_old
      from vppsone.marks where assessment_subject_id = v_paper and student_id = v_student;
      v_existed := found;
      v_old_state := case
        when not v_existed then 'blank'
        when v_old.exempt then 'exempt'
        when v_old.absent then 'absent'
        when v_old.value is not null then 'value'
        else 'blank'
      end;

      if v_old_state = v_state and (v_state <> 'value' or (v_existed and v_old.value = v_value)) then
        continue;
      end if;

      if v_kind = 'correction' and v_state = 'blank' then
        raise exception 'marks:cannot_blank:%', v_student;
      end if;

      insert into vppsone.marks (assessment_subject_id, student_id, value, absent, exempt, entered_by, entered_at)
      values (v_paper, v_student, v_value, v_state = 'absent', v_state = 'exempt', v_actor, v_now)
      on conflict (assessment_subject_id, student_id) do update
        set value = excluded.value, absent = excluded.absent, exempt = excluded.exempt,
            entered_by = excluded.entered_by, entered_at = excluded.entered_at;

      insert into vppsone.marks_change_log (
        assessment_subject_id, student_id, from_value, to_value, from_absent, to_absent,
        from_exempt, to_exempt, reason, changed_by, command_id
      ) values (
        v_paper, v_student,
        case when v_existed then v_old.value end, v_value,
        case when v_existed then v_old.absent end, v_state = 'absent',
        case when v_existed then v_old.exempt end, v_state = 'exempt',
        v_reason, v_actor, v_command
      );
      v_changes := v_changes + 1;
    end loop;

    if v_fault = 'after_marks' and vppsone.flag_enabled('fault_injection') then
      raise exception 'marks:injected_fault:after_marks';
    end if;

    -- 8. Submitting is the teacher saying she is done: every child on the
    -- roll has a mark, an absence or an exemption. A blank is never a zero.
    select coalesce(array_agg(r), '{}') into v_blank
    from unnest(v_roster) r
    where not exists (
      select 1 from vppsone.marks m
      where m.assessment_subject_id = v_paper and m.student_id = r
        and (m.value is not null or m.absent or m.exempt)
    );

    if v_kind in ('submit', 'correction') and cardinality(v_blank) > 0 then
      raise exception 'marks:incomplete:%', array_to_string(v_blank, ',');
    end if;
    if v_kind in ('draft', 'correction') and v_changes = 0 then
      raise exception 'marks:no_change';
    end if;

    update vppsone.assessment_subjects
    set entry_revision = entry_revision + 1,
        entry_status = case when v_kind = 'submit' then 'submitted' else entry_status end,
        submitted_by = case when v_kind = 'submit' then v_actor else submitted_by end,
        submitted_at = case when v_kind = 'submit' then v_now else submitted_at end
    where id = v_paper;
  end if;

  -- 9. The receipt.
  select coalesce(array_agg(r), '{}') into v_roster from vppsone.paper_roster(v_paper) r;
  select jsonb_build_object(
    'entered', count(*) filter (where m.value is not null),
    'absent', count(*) filter (where m.absent),
    'exempt', count(*) filter (where m.exempt),
    'blank', cardinality(v_roster) - count(*) filter (where m.value is not null or m.absent or m.exempt),
    'total', cardinality(v_roster)
  ) into v_counts
  from vppsone.marks m
  where m.assessment_subject_id = v_paper and m.student_id = any (v_roster);

  select * into s from vppsone.assessment_subjects where id = v_paper;
  v_receipt := jsonb_build_object(
    'ok', true,
    'command_id', v_command,
    'paper_id', v_paper,
    'kind', v_kind,
    'revision', s.entry_revision,
    'entry_status', s.entry_status,
    'saved_at', v_now,
    'actor_name', v_actor_name,
    'changed', v_changes,
    'counts', v_counts,
    'replayed', false
  );

  if v_fault = 'before_receipt' and vppsone.flag_enabled('fault_injection') then
    raise exception 'marks:injected_fault:before_receipt';
  end if;

  insert into vppsone.marks_commands (id, assessment_subject_id, actor_staff_id, kind, payload_hash, receipt)
  values (v_command, v_paper, v_actor, v_kind, v_hash, v_receipt);

  return v_receipt;
end;
$$;

revoke all on function vppsone.paper_roster(uuid) from public;
revoke all on function vppsone.save_marks(jsonb) from public;
grant execute on function vppsone.paper_roster(uuid) to service_role;
grant execute on function vppsone.save_marks(jsonb) to service_role;
