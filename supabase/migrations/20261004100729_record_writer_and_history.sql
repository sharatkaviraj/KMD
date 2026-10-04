-- P10a: a child's collected values have one writer, every write is kept, and
-- who wins is decided in the database.
--
-- Plan §11: "Collected updates — accepted native overlay with field
-- provenance", and P10's "accepted precedence; one writer per entity".
--
-- Before this, accepting an answer was two statements from the app: mark the
-- submissions accepted, then upsert `student_records` for every row it had
-- *read* — so two people deciding at once could both write, an older answer
-- could overwrite a newer decision without anybody choosing to, and the
-- value a record held before was simply gone.
--
-- Now:
--
--   * `vppsone.write_student_value()` is the one function that writes a
--     value. It applies precedence (a person's value is never replaced by an
--     import; an import may correct only what it wrote itself) and appends
--     to `student_record_history`, whatever the outcome.
--   * `vppsone.accept_submissions()` is the one command that decides
--     answers: atomic, idempotent per command id, re-checking authority, and
--     refusing — not silently doing — the two dangerous cases: an answer
--     with a newer one waiting behind it, and an answer about a value that
--     has moved since the teacher was shown it.

-- ---------------------------------------------------------------------------
-- Where a held value came from, more precisely than teacher/office/import
-- ---------------------------------------------------------------------------

alter table vppsone.student_records
  -- Which import: 'sampark', 'psp'… Null for a person's value. An import may
  -- correct what the same import wrote, and nothing else.
  add column source_detail text,
  -- What, exactly: 'submission:<id>', 'sampark:<batch>:<row>'.
  add column source_ref text;

-- ---------------------------------------------------------------------------
-- Every write, kept
-- ---------------------------------------------------------------------------

create table vppsone.student_record_history (
  id bigint generated always as identity primary key,
  -- No foreign keys to the child or the field: the history outlives both,
  -- and the fee app's students are never referenced (rule 2, D-5).
  student_id uuid not null,
  field_id uuid not null,
  session_label text not null,
  outcome text not null,
  reason text,
  old_value text,
  new_value text,
  old_source vppsone.record_source,
  old_source_detail text,
  source vppsone.record_source not null,
  source_detail text,
  source_ref text,
  submission_id uuid,
  command_id uuid not null,
  actor_staff_id uuid,
  recorded_at timestamptz not null default now(),
  constraint student_record_history_outcome check (outcome in ('written', 'blocked')),
  constraint student_record_history_blocked_says_why check (outcome <> 'blocked' or reason is not null)
);

comment on table vppsone.student_record_history is
  'Every write to student_records and every value precedence refused, with where it came from. Append-only.';

create index student_record_history_student_idx
  on vppsone.student_record_history (student_id, field_id, recorded_at desc);

create or replace function vppsone.student_record_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'student_record_history is append-only' using errcode = '42501';
end;
$$;

create trigger student_record_history_append_only
  before update or delete on vppsone.student_record_history
  for each row execute function vppsone.student_record_history_append_only();

alter table vppsone.student_record_history enable row level security;
create policy student_record_history_select_scoped
  on vppsone.student_record_history for select to authenticated
  using (
    (select vppsone.staff_can_any(array['collection:view', 'students:view']))
    and (
      (select vppsone.reads_every_class())
      or exists (
        select 1 from vppsone.enrolments e
        where e.student_id = student_record_history.student_id
          and e.session_label = student_record_history.session_label
      )
    )
  );
grant select on vppsone.student_record_history to authenticated;
grant select, insert on vppsone.student_record_history to service_role;

-- What the record held before anybody kept a history: one row each, so every
-- value has somewhere it came from.
insert into vppsone.student_record_history (
  student_id, field_id, session_label, outcome, reason, new_value,
  source, source_detail, source_ref, submission_id, command_id, actor_staff_id, recorded_at
)
select
  r.student_id, r.field_id, r.session_label, 'written', 'held_before_history', r.value,
  r.source, r.source_detail, coalesce(r.source_ref, 'submission:' || r.source_submission_id::text),
  r.source_submission_id, '00000000-0000-0000-0000-00000000a10a'::uuid, r.recorded_by, r.updated_at
from vppsone.student_records r;

-- ---------------------------------------------------------------------------
-- Commands, for replay
-- ---------------------------------------------------------------------------

create table vppsone.record_commands (
  command_id uuid primary key,
  kind text not null,
  actor_staff_id uuid not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  constraint record_commands_kind check (kind in ('accept', 'reject', 'import'))
);

comment on table vppsone.record_commands is
  'One row per decision or import command: a repeated submission of the same id returns this receipt instead of acting twice.';

alter table vppsone.record_commands enable row level security;
grant all on vppsone.record_commands to service_role;

-- ---------------------------------------------------------------------------
-- The one writer
-- ---------------------------------------------------------------------------

create or replace function vppsone.write_student_value(
  p_student uuid,
  p_field uuid,
  p_session text,
  p_value text,
  p_source vppsone.record_source,
  p_source_detail text,
  p_source_ref text,
  p_submission uuid,
  p_command uuid,
  p_actor uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_held vppsone.student_records%rowtype;
  v_human boolean := p_source in ('teacher', 'office');
  v_reason text;
begin
  select * into v_held from vppsone.student_records
  where student_id = p_student and field_id = p_field
  for update;

  if not found then
    insert into vppsone.student_records (
      session_label, student_id, field_id, value, source, source_detail, source_ref,
      source_submission_id, recorded_by
    ) values (
      p_session, p_student, p_field, p_value, p_source, p_source_detail, p_source_ref,
      p_submission, p_actor
    );
    insert into vppsone.student_record_history (
      student_id, field_id, session_label, outcome, new_value, source, source_detail,
      source_ref, submission_id, command_id, actor_staff_id
    ) values (
      p_student, p_field, p_session, 'written', p_value, p_source, p_source_detail,
      p_source_ref, p_submission, p_command, p_actor
    );
    return 'written';
  end if;

  -- Precedence. A person's value is never replaced by an import. An import
  -- may correct what the same import wrote, and nothing else. A person
  -- replaces anything — whether they may replace a *newer* decision is the
  -- calling command's question, asked before this.
  if not v_human then
    if v_held.source in ('teacher', 'office') then
      v_reason := 'human_value';
    elsif v_held.source is distinct from p_source
       or v_held.source_detail is distinct from p_source_detail then
      v_reason := 'other_source';
    end if;
  end if;

  if v_reason is not null then
    if v_held.value is distinct from p_value then
      insert into vppsone.student_record_history (
        student_id, field_id, session_label, outcome, reason, old_value, new_value,
        old_source, old_source_detail, source, source_detail, source_ref, submission_id,
        command_id, actor_staff_id
      ) values (
        p_student, p_field, p_session, 'blocked', v_reason, v_held.value, p_value,
        v_held.source, v_held.source_detail, p_source, p_source_detail, p_source_ref,
        p_submission, p_command, p_actor
      );
    end if;
    return 'blocked:' || v_reason;
  end if;

  -- The same value from the same kind of source is nothing to write. The same
  -- value confirmed by a person over an import's is: it is now a person's,
  -- and the next import may not replace it.
  if v_held.value is not distinct from p_value
     and (not v_human or v_held.source in ('teacher', 'office')) then
    return 'unchanged';
  end if;

  update vppsone.student_records set
    session_label = p_session,
    value = p_value,
    source = p_source,
    source_detail = p_source_detail,
    source_ref = p_source_ref,
    source_submission_id = p_submission,
    recorded_by = p_actor
  where id = v_held.id;

  insert into vppsone.student_record_history (
    student_id, field_id, session_label, outcome, reason, old_value, new_value,
    old_source, old_source_detail, source, source_detail, source_ref, submission_id,
    command_id, actor_staff_id
  ) values (
    p_student, p_field, p_session, 'written',
    case when v_held.value is not distinct from p_value then 'confirmed_by_person' end,
    v_held.value, p_value, v_held.source, v_held.source_detail, p_source, p_source_detail,
    p_source_ref, p_submission, p_command, p_actor
  );
  return 'written';
end;
$$;

comment on function vppsone.write_student_value is
  'The only writer of student_records. Applies precedence and appends to student_record_history. Called by accept_submissions and the import command, never by the app directly.';

revoke all on function vppsone.write_student_value(uuid, uuid, text, text, vppsone.record_source, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deciding answers
-- ---------------------------------------------------------------------------

create or replace function vppsone.accept_submissions(p jsonb)
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
  v_decision text := p->>'decision';
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_replace boolean := coalesce((p->>'replace_newer')::boolean, false);
  v_hash text := p->>'payload_hash';
  v_fault text := p->>'fault';
  v_ids uuid[];
  v_previous vppsone.record_commands%rowtype;
  v_row record;
  v_value text;
  v_held text;
  v_outcome text;
  v_decided integer := 0;
  v_recorded integer := 0;
  v_confirmed integer := 0;
  v_already integer := 0;
  v_refused jsonb := '[]'::jsonb;
  v_receipt jsonb;
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    select coalesce(array_agg(value::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(p->'submission_ids', '[]'::jsonb));
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_command is null or v_actor is null or v_session is null or v_hash is null
     or v_decision not in ('accept', 'reject') or cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:record-command:' || v_command::text));

  select * into v_previous from vppsone.record_commands where command_id = v_command;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.actor_staff_id = v_actor then
      return v_previous.receipt || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  -- Deciding answers is the office's: collection:manage, re-read now.
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'collection:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  for v_row in
    select s.*
    from vppsone.collection_submissions s
    where s.id = any(v_ids)
    order by s.submitted_at, s.id
    for update
  loop
    -- Somebody else decided it first. Theirs stands; nothing is written twice.
    if v_row.status <> 'pending' then
      v_already := v_already + 1;
      continue;
    end if;

    if v_decision = 'reject' then
      update vppsone.collection_submissions
      set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_note
      where id = v_row.id;
      v_decided := v_decided + 1;
      continue;
    end if;

    -- A newer answer for the same child and field is waiting: accepting this
    -- one would put an older answer on the record. Refused, not guessed.
    if exists (
      select 1 from vppsone.collection_submissions n
      where n.student_id = v_row.student_id and n.field_id = v_row.field_id
        and n.id <> v_row.id and n.status = 'pending'
        and (n.submitted_at, n.id) > (v_row.submitted_at, v_row.id)
    ) then
      v_refused := v_refused || jsonb_build_object('submission_id', v_row.id, 'reason', 'superseded');
      continue;
    end if;

    v_value := nullif(btrim(coalesce(v_row.value, '')), '');

    -- Blank means "no change": accepted as a confirmation, nothing written.
    if v_value is null then
      update vppsone.collection_submissions
      set status = 'accepted', decided_by = v_actor, decided_at = now(), decision_note = v_note
      where id = v_row.id;
      v_decided := v_decided + 1;
      v_confirmed := v_confirmed + 1;
      continue;
    end if;

    -- The record moved after she was shown it, to something other than her
    -- answer: accepting would quietly revert whoever moved it. Only a person
    -- who has seen both, and says so, replaces it (S-07).
    select nullif(btrim(coalesce(r.value, '')), '') into v_held
    from vppsone.student_records r
    where r.student_id = v_row.student_id and r.field_id = v_row.field_id;
    if v_held is not null
       and v_held is distinct from nullif(btrim(coalesce(v_row.previous_value, '')), '')
       and v_held is distinct from v_value
       and not v_replace then
      v_refused := v_refused || jsonb_build_object('submission_id', v_row.id, 'reason', 'record_moved');
      continue;
    end if;

    v_outcome := vppsone.write_student_value(
      v_row.student_id, v_row.field_id, v_session, v_value, 'teacher', null,
      'submission:' || v_row.id::text, v_row.id, v_command, v_actor
    );

    update vppsone.collection_submissions
    set status = 'accepted', decided_by = v_actor, decided_at = now(), decision_note = v_note
    where id = v_row.id;
    v_decided := v_decided + 1;
    if v_outcome = 'written' then
      v_recorded := v_recorded + 1;
    else
      v_confirmed := v_confirmed + 1;
    end if;

    if v_fault = 'after_first_write' and vppsone.flag_enabled('fault_injection') then
      raise exception 'fault injected after the first write';
    end if;
  end loop;

  v_receipt := jsonb_build_object(
    'ok', true,
    'command_id', v_command,
    'decision', v_decision,
    'decided', v_decided,
    'recorded', v_recorded,
    'confirmed', v_confirmed,
    'already_decided', v_already,
    'refused', v_refused
  );

  insert into vppsone.record_commands (command_id, kind, actor_staff_id, payload_hash, receipt)
  values (v_command, v_decision, v_actor, v_hash, v_receipt);

  return v_receipt;
end;
$$;

comment on function vppsone.accept_submissions is
  'Accept or reject collected answers in one transaction: authority re-checked, a newer waiting answer or a moved record refused unless replace_newer, every write through write_student_value. Idempotent per command_id.';

revoke all on function vppsone.accept_submissions(jsonb) from public, anon, authenticated;
grant execute on function vppsone.accept_submissions(jsonb) to service_role;
