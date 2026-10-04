-- P10b: SamPark's records come in through the one writer, and a row nobody
-- can identify waits for a person.
--
-- Plan §11, identity reconciliation: "resolve as a multimap: matched,
-- ambiguous and unmatched. Never join pupils by name or shared phone alone.
-- Preserve … source field precedence." P10: "ambiguity queue, accepted
-- precedence and legacy links".
--
-- The office exports SamPark's Students workbook and uploads it. The app
-- reads it, resolves each row by ids alone (`domain/sampark-import.ts`) and
-- stages the file here: one batch, one row per spreadsheet row, with what the
-- row says, the values it carries (already validated) and how its identity
-- resolved. Nothing is written to a child's record by staging.
--
-- Applying is a command. For each matched row it records the mapping in
-- `external_student_ids` — which is what makes SamPark's own links to a
-- child resolve (S-10) — and offers each value to `write_student_value()` as
-- an import from SamPark, where precedence keeps anything a person recorded.
-- An ambiguous or unmatched row is the queue: an office member picks the
-- child, or dismisses the row with a reason, and only then is it applied.

create table vppsone.sampark_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_sha256 text not null,
  -- Which dataset the children were matched in (S-10): a mapping made on dev
  -- says nothing about a child on live.
  source_environment text not null,
  session_label text not null,
  row_count integer not null,
  mapped_fields text[] not null default '{}',
  ignored_headers text[] not null default '{}',
  uploaded_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  -- The same file twice is the same batch: uploading again resumes it.
  constraint sampark_import_batches_one_per_file unique (source_environment, file_sha256)
);

comment on table vppsone.sampark_import_batches is
  'One uploaded SamPark Students workbook. Re-uploading the same file resumes the same batch.';

create table vppsone.sampark_import_rows (
  batch_id uuid not null references vppsone.sampark_import_batches (id) on delete cascade,
  row_no integer not null,
  external_id text,
  -- What the row says about who it is: {sr, admission, name, class}. Shown to
  -- the person resolving it; never used to decide it.
  presented jsonb not null default '{}',
  -- field key → value, already validated and normalised.
  field_values jsonb not null default '{}',
  -- Cells that did not validate: [{field, value, message}]. Not written.
  problems jsonb not null default '[]',
  resolution text not null,
  why text,
  matched_on text,
  student_id uuid,
  candidates uuid[] not null default '{}',
  applied_at timestamptz,
  outcome jsonb,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  primary key (batch_id, row_no),
  constraint sampark_import_rows_resolution check (resolution in ('matched', 'ambiguous', 'unmatched', 'resolved', 'dismissed')),
  constraint sampark_import_rows_child_when_known check (
    (resolution in ('matched', 'resolved')) = (student_id is not null)
  ),
  constraint sampark_import_rows_dismissal_says_why check (
    resolution <> 'dismissed' or nullif(btrim(decision_note), '') is not null
  )
);

comment on table vppsone.sampark_import_rows is
  'Each row of an uploaded SamPark workbook: who it resolved to (by ids only), its values, and whether it has been applied. Ambiguous and unmatched rows are the identity queue.';

create index sampark_import_rows_queue_idx
  on vppsone.sampark_import_rows (batch_id) where resolution in ('ambiguous', 'unmatched');

alter table vppsone.sampark_import_batches enable row level security;
alter table vppsone.sampark_import_rows enable row level security;
create policy sampark_import_batches_select_office
  on vppsone.sampark_import_batches for select to authenticated
  using ((select vppsone.staff_can('collection:manage')));
create policy sampark_import_rows_select_office
  on vppsone.sampark_import_rows for select to authenticated
  using ((select vppsone.staff_can('collection:manage')));
grant select on vppsone.sampark_import_batches, vppsone.sampark_import_rows to authenticated;
grant all on vppsone.sampark_import_batches, vppsone.sampark_import_rows to service_role;

alter table vppsone.record_commands drop constraint record_commands_kind;
alter table vppsone.record_commands add constraint record_commands_kind
  check (kind in ('accept', 'reject', 'import', 'resolve'));

-- ---------------------------------------------------------------------------
-- Applying one row
-- ---------------------------------------------------------------------------

create or replace function vppsone.apply_sampark_row(p_batch uuid, p_row integer, p_command uuid, p_actor uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row vppsone.sampark_import_rows%rowtype;
  v_batch vppsone.sampark_import_batches%rowtype;
  v_mapped uuid;
  v_other text;
  v_field uuid;
  v_key text;
  v_value text;
  v_outcome text;
  v_written integer := 0;
  v_unchanged integer := 0;
  v_kept_person integer := 0;
  v_kept_other integer := 0;
  v_no_field integer := 0;
  v_result jsonb;
begin
  select * into v_row from vppsone.sampark_import_rows
  where batch_id = p_batch and row_no = p_row
  for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'no_such_row');
  end if;
  if v_row.applied_at is not null then
    return coalesce(v_row.outcome, '{}'::jsonb) || jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;
  if v_row.resolution not in ('matched', 'resolved') then
    return jsonb_build_object('applied', false, 'reason', 'not_resolved');
  end if;
  select * into v_batch from vppsone.sampark_import_batches where id = p_batch;

  -- The child is still on the fee record (read only; rule 2).
  if not exists (select 1 from public.students s where s.id = v_row.student_id) then
    update vppsone.sampark_import_rows
    set resolution = 'unmatched', why = 'no_such_child', student_id = null, matched_on = null
    where batch_id = p_batch and row_no = p_row;
    return jsonb_build_object('applied', false, 'reason', 'no_such_child');
  end if;

  -- The mapping, which must agree with every earlier one in both directions.
  -- A disagreement goes back to the queue with both children named.
  if v_row.external_id is not null then
    select student_id into v_mapped from vppsone.external_student_ids
    where app_id = 'sampark' and external_id = v_row.external_id;
    if v_mapped is not null and v_mapped <> v_row.student_id then
      update vppsone.sampark_import_rows
      set resolution = 'ambiguous', why = 'ids_disagree', candidates = array[v_mapped, v_row.student_id],
          student_id = null, matched_on = null
      where batch_id = p_batch and row_no = p_row;
      return jsonb_build_object('applied', false, 'reason', 'mapping_conflict');
    end if;

    select external_id into v_other from vppsone.external_student_ids
    where app_id = 'sampark' and source_environment = v_batch.source_environment
      and student_id = v_row.student_id;
    if v_other is not null and v_other <> v_row.external_id then
      update vppsone.sampark_import_rows
      set resolution = 'ambiguous', why = 'child_mapped_elsewhere', candidates = array[v_row.student_id],
          student_id = null, matched_on = null
      where batch_id = p_batch and row_no = p_row;
      return jsonb_build_object('applied', false, 'reason', 'child_mapped_elsewhere');
    end if;

    if v_mapped is null then
      insert into vppsone.external_student_ids (
        app_id, external_id, student_id, source_environment, matched_on, note, created_by
      ) values (
        'sampark', v_row.external_id, v_row.student_id, v_batch.source_environment,
        coalesce(v_row.matched_on, 'hand'),
        'SamPark import ' || p_batch::text || ', row ' || p_row::text,
        (select user_id from vppsone.staff_profiles where id = p_actor)
      );
    end if;
  end if;

  -- Every value through the one writer, as an import from SamPark.
  for v_key, v_value in select key, value from jsonb_each_text(v_row.field_values) loop
    if nullif(btrim(coalesce(v_value, '')), '') is null then
      continue;
    end if;
    select id into v_field from vppsone.collection_fields where key = v_key and is_active;
    if v_field is null then
      v_no_field := v_no_field + 1;
      continue;
    end if;
    v_outcome := vppsone.write_student_value(
      v_row.student_id, v_field, v_batch.session_label, v_value, 'import', 'sampark',
      'sampark:' || p_batch::text || ':' || p_row::text, null, p_command, p_actor
    );
    if v_outcome = 'written' then
      v_written := v_written + 1;
    elsif v_outcome = 'unchanged' then
      v_unchanged := v_unchanged + 1;
    elsif v_outcome = 'blocked:human_value' then
      v_kept_person := v_kept_person + 1;
    else
      v_kept_other := v_kept_other + 1;
    end if;
    v_field := null;
  end loop;

  v_result := jsonb_build_object(
    'applied', true,
    'written', v_written,
    'unchanged', v_unchanged,
    'kept_person', v_kept_person,
    'kept_other_import', v_kept_other,
    'no_field', v_no_field
  );
  update vppsone.sampark_import_rows
  set applied_at = now(), outcome = v_result
  where batch_id = p_batch and row_no = p_row;
  return v_result;
end;
$$;

revoke all on function vppsone.apply_sampark_row(uuid, integer, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Applying every matched row of a batch
-- ---------------------------------------------------------------------------

create or replace function vppsone.apply_sampark_import(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_batch uuid;
  v_hash text := p->>'payload_hash';
  v_fault text := p->>'fault';
  v_previous vppsone.record_commands%rowtype;
  v_row record;
  v_result jsonb;
  v_rows integer := 0;
  v_written integer := 0;
  v_unchanged integer := 0;
  v_kept_person integer := 0;
  v_kept_other integer := 0;
  v_conflicts integer := 0;
  v_receipt jsonb;
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_batch := (p->>'batch_id')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_command is null or v_actor is null or v_batch is null or v_hash is null then
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

  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'collection:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  if not exists (select 1 from vppsone.sampark_import_batches where id = v_batch) then
    return jsonb_build_object('ok', false, 'reason', 'no_such_batch');
  end if;

  -- One application of a batch at a time.
  perform pg_advisory_xact_lock(hashtext('vppsone:sampark-batch:' || v_batch::text));

  for v_row in
    select row_no from vppsone.sampark_import_rows
    where batch_id = v_batch and resolution in ('matched', 'resolved') and applied_at is null
    order by row_no
  loop
    v_result := vppsone.apply_sampark_row(v_batch, v_row.row_no, v_command, v_actor);
    if (v_result->>'applied')::boolean then
      v_rows := v_rows + 1;
      v_written := v_written + (v_result->>'written')::integer;
      v_unchanged := v_unchanged + (v_result->>'unchanged')::integer;
      v_kept_person := v_kept_person + (v_result->>'kept_person')::integer;
      v_kept_other := v_kept_other + (v_result->>'kept_other_import')::integer;
    elsif v_result->>'reason' in ('mapping_conflict', 'child_mapped_elsewhere', 'no_such_child') then
      v_conflicts := v_conflicts + 1;
    end if;

    if v_fault = 'after_first_row' and vppsone.flag_enabled('fault_injection') then
      raise exception 'fault injected after the first row';
    end if;
  end loop;

  v_receipt := jsonb_build_object(
    'ok', true,
    'command_id', v_command,
    'rows_applied', v_rows,
    'written', v_written,
    'unchanged', v_unchanged,
    'kept_person', v_kept_person,
    'kept_other_import', v_kept_other,
    'sent_back_to_queue', v_conflicts
  );
  insert into vppsone.record_commands (command_id, kind, actor_staff_id, payload_hash, receipt)
  values (v_command, 'import', v_actor, v_hash, v_receipt);
  return v_receipt;
end;
$$;

revoke all on function vppsone.apply_sampark_import(jsonb) from public, anon, authenticated;
grant execute on function vppsone.apply_sampark_import(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- The queue: a person picks the child, or says why nobody
-- ---------------------------------------------------------------------------

create or replace function vppsone.resolve_sampark_row(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_command uuid;
  v_actor uuid;
  v_batch uuid;
  v_row_no integer;
  v_student uuid;
  v_dismiss boolean := coalesce((p->>'dismiss')::boolean, false);
  v_note text := nullif(btrim(coalesce(p->>'note', '')), '');
  v_hash text := p->>'payload_hash';
  v_previous vppsone.record_commands%rowtype;
  v_row vppsone.sampark_import_rows%rowtype;
  v_result jsonb;
  v_receipt jsonb;
begin
  begin
    v_command := (p->>'command_id')::uuid;
    v_actor := (p->>'actor_staff_id')::uuid;
    v_batch := (p->>'batch_id')::uuid;
    v_row_no := (p->>'row_no')::integer;
    v_student := nullif(p->>'student_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;
  if v_command is null or v_actor is null or v_batch is null or v_row_no is null or v_hash is null
     or (v_dismiss and v_student is not null) or (not v_dismiss and v_student is null) then
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

  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'collection:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:sampark-batch:' || v_batch::text));
  select * into v_row from vppsone.sampark_import_rows
  where batch_id = v_batch and row_no = v_row_no
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_such_row');
  end if;
  -- Only a row in the queue is decided here; one somebody else decided stands.
  if v_row.resolution not in ('ambiguous', 'unmatched') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided', 'resolution', v_row.resolution);
  end if;

  if v_dismiss then
    if v_note is null then
      return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    update vppsone.sampark_import_rows
    set resolution = 'dismissed', decided_by = v_actor, decided_at = now(), decision_note = v_note
    where batch_id = v_batch and row_no = v_row_no;
    v_receipt := jsonb_build_object('ok', true, 'command_id', v_command, 'resolution', 'dismissed');
  else
    if not exists (select 1 from public.students s where s.id = v_student) then
      return jsonb_build_object('ok', false, 'reason', 'no_such_child');
    end if;
    update vppsone.sampark_import_rows
    set resolution = 'resolved', student_id = v_student, matched_on = 'hand',
        decided_by = v_actor, decided_at = now(), decision_note = v_note
    where batch_id = v_batch and row_no = v_row_no;
    v_result := vppsone.apply_sampark_row(v_batch, v_row_no, v_command, v_actor);
    v_receipt := jsonb_build_object('ok', true, 'command_id', v_command, 'resolution', 'resolved') || v_result;
  end if;

  insert into vppsone.record_commands (command_id, kind, actor_staff_id, payload_hash, receipt)
  values (v_command, 'resolve', v_actor, v_hash, v_receipt);
  return v_receipt;
end;
$$;

revoke all on function vppsone.resolve_sampark_row(jsonb) from public, anon, authenticated;
grant execute on function vppsone.resolve_sampark_row(jsonb) to service_role;
