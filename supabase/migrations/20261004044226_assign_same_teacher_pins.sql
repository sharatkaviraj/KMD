-- P3 follow-up: a hand-picked cover for the teacher who already holds it is a pin.
--
-- The coordinator presses "Assign" on the teacher the planner already chose.
-- The diff compared only what the teacher was told — status, holder, reason,
-- classes, who is away — found it unchanged, and kept `source = 'auto',
-- pinned = false`. The screen said "Saved"; the next re-arrangement was then
-- free to move that teacher, which is exactly what pressing Assign was meant
-- to prevent.
--
-- Now the unchanged branch also carries the planner's `source` and `pinned`
-- forward, in place and without a revision (nobody is told anything new), and
-- the receipt counts it as `pinned` so the screen can say so.
--
-- Only `commit_cover_command` changes. Its grants are those of the original
-- (service_role only); `create or replace` keeps them.

create or replace function vppsone.commit_cover_command(p_command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_kind text := coalesce(p_command->>'kind', 'arrange');
  v_actor uuid;
  v_session text := p_command->>'session_label';
  v_day date;
  v_hash text := p_command->>'payload_hash';
  v_tt_day text := p_command->>'timetable_day';
  v_expected jsonb := coalesce(p_command->'expected', '{}'::jsonb);
  v_fault text := p_command->>'fault';
  v_desired jsonb := coalesce(p_command->'duties', '[]'::jsonb);
  v_previous vppsone.cover_commands%rowtype;
  v_day_row vppsone.cover_days%rowtype;
  v_version uuid;
  v_bells_revision integer;
  v_actor_user uuid;
  a jsonb;
  d jsonb;
  e vppsone.cover_duties%rowtype;
  v_staff uuid;
  v_periods smallint[];
  v_revision integer;
  v_problems jsonb := '[]'::jsonb;
  v_handled text[] := '{}';
  v_new_id uuid;
  v_new_revision integer;
  v_covering uuid;
  v_count_new integer := 0;
  v_count_changed integer := 0;
  v_count_cancelled integer := 0;
  v_count_unchanged integer := 0;
  v_count_skipped integer := 0;
  v_count_pinned integer := 0;
  v_receipt jsonb;
  v_live jsonb;
  v_pairs jsonb := '[]'::jsonb;
  p jsonb;
  v_old vppsone.cover_duties%rowtype;
  v_old_status text;
begin
  begin
    v_id := (p_command->>'command_id')::uuid;
    v_actor := (p_command->>'actor_staff_id')::uuid;
    v_day := (p_command->>'day')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;

  if v_id is null or v_actor is null or v_session is null or v_day is null or v_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  -- 1. Who is asking, now — not when the page was drawn.
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'substitutions:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;
  select user_id into v_actor_user from vppsone.staff_profiles where id = v_actor;

  -- 2. One command per day at a time. Different days never conflict: a
  -- teacher can only be double booked within one day.
  perform pg_advisory_xact_lock(hashtext('vppsone:cover:' || v_session || ':' || v_day::text));

  -- 3. The same submission again gets the same answer.
  select * into v_previous from vppsone.cover_commands where id = v_id;
  if found then
    if v_previous.payload_hash = v_hash and v_previous.actor_staff_id = v_actor then
      return v_previous.receipt || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'id_reused');
  end if;

  if not vppsone.flag_enabled('cover_command') then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  -- 4. Nothing has moved since the operator looked.
  insert into vppsone.cover_days (session_label, day) values (v_session, v_day)
  on conflict (session_label, day) do nothing;
  select * into v_day_row from vppsone.cover_days
  where session_label = v_session and day = v_day for update;
  select id into v_version from vppsone.timetable_versions
  where session_label = v_session and status = 'published';
  select revision into v_bells_revision from vppsone.bell_schedules
  where session_label = v_session and is_current;

  if v_day_row.revision is distinct from (v_expected->>'day_revision')::integer
     or v_version is distinct from (v_expected->>'timetable_version_id')::uuid
     or coalesce(v_bells_revision, 0) is distinct from coalesce((v_expected->>'bells_revision')::integer, 0)
  then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stale',
      'current', jsonb_build_object(
        'day_revision', v_day_row.revision,
        'timetable_version_id', v_version,
        'bells_revision', coalesce(v_bells_revision, 0)
      )
    );
  end if;

  if v_version is null then
    return jsonb_build_object('ok', false, 'reason', 'no_timetable');
  end if;

  -- 5. The absence, with its history appended.
  for a in select value from jsonb_array_elements(coalesce(p_command->'absences', '[]'::jsonb))
  loop
    v_staff := (a->>'staff_profile_id')::uuid;
    if jsonb_typeof(a->'periods') = 'array' and jsonb_array_length(a->'periods') > 0 then
      select array_agg(distinct value::smallint order by value::smallint)
      into v_periods
      from jsonb_array_elements_text(a->'periods');

      insert into vppsone.teacher_absences (
        session_label, staff_profile_id, day, periods, created_by, updated_by
      ) values (v_session, v_staff, v_day, v_periods, v_actor_user, v_actor)
      on conflict (staff_profile_id, day) do update
        set periods = excluded.periods,
            session_label = excluded.session_label,
            updated_by = excluded.updated_by,
            revision = vppsone.teacher_absences.revision + 1
      returning revision into v_revision;
    else
      v_periods := null;
      v_revision := null;
      delete from vppsone.teacher_absences
      where staff_profile_id = v_staff and day = v_day
      returning revision + 1 into v_revision;
      if v_revision is null then
        continue;
      end if;
    end if;

    insert into vppsone.teacher_absence_history (
      session_label, staff_profile_id, day, periods, revision, command_id, actor_staff_id
    ) values (v_session, v_staff, v_day, v_periods, v_revision, v_id, v_actor);
  end loop;

  if v_fault = 'after_absences' and vppsone.flag_enabled('fault_injection') then
    raise exception 'cover_command:injected_fault:after_absences';
  end if;

  -- 6. Every assignment, against the facts as they now are.
  for d in select value from jsonb_array_elements(v_desired)
  loop
    if d->>'status' <> 'assigned' then continue; end if;
    v_covering := (d->>'covering_staff_id')::uuid;

    if not vppsone.cover_period_open(v_session, v_day, (d->>'period')::integer) then
      continue; -- a begun period is history; step 7 leaves it alone
    end if;

    if not exists (
      select 1 from vppsone.staff_profiles where id = v_covering and is_active
    ) then
      v_problems := v_problems || jsonb_build_object('need_key', d->>'need_key', 'problem', 'inactive');
    end if;

    if exists (
      select 1 from vppsone.teacher_absences ta
      where ta.staff_profile_id = v_covering and ta.day = v_day
        and (d->>'period')::smallint = any (ta.periods)
    ) then
      v_problems := v_problems || jsonb_build_object('need_key', d->>'need_key', 'problem', 'absent');
    end if;

    if exists (
      select 1 from vppsone.timetable_slots s
      where s.version_id = v_version and s.day = v_tt_day
        and s.period = (d->>'period')::smallint and s.staff_profile_id = v_covering
    ) then
      v_problems := v_problems || jsonb_build_object('need_key', d->>'need_key', 'problem', 'teaching');
    end if;

    if (
      select count(*) from jsonb_array_elements(v_desired) other
      where other->>'status' = 'assigned'
        and other->>'covering_staff_id' = d->>'covering_staff_id'
        and other->>'period' = d->>'period'
    ) > 1 then
      v_problems := v_problems || jsonb_build_object('need_key', d->>'need_key', 'problem', 'double_booked');
    end if;
  end loop;

  if jsonb_array_length(v_problems) > 0 then
    -- Raise, so the absence written above is rolled back with everything else.
    raise exception 'cover_command:invalid:%', v_problems::text;
  end if;

  -- 7. Desired against live, in two phases so a teacher moved from one
  -- lesson to another in the same period never collides with herself: first
  -- every row that changes is ended, then the new rows are written.
  -- Begun periods are history and are skipped.
  for e in
    select * from vppsone.cover_duties
    where session_label = v_session and day = v_day and status in ('assigned', 'needs_help')
    order by period, need_key
    for update
  loop
    v_handled := v_handled || e.need_key;
    d := null;
    select value into d from jsonb_array_elements(v_desired) where value->>'need_key' = e.need_key limit 1;

    if not vppsone.cover_period_open(v_session, v_day, e.period) then
      if d is not null then v_count_skipped := v_count_skipped + 1; end if;
      continue;
    end if;

    if d is null then
      update vppsone.cover_duties set status = 'cancelled', ended_at = now() where id = e.id;
      v_count_cancelled := v_count_cancelled + 1;
      if e.status = 'assigned' then
        perform vppsone.cover_notice_withdrawn(e, v_id);
      end if;
      continue;
    end if;

    if d->>'status' = e.status::text
       and (d->>'covering_staff_id')::uuid is not distinct from e.covering_staff_id
       and coalesce(d->>'reason', '') = coalesce(e.reason, '')
       and (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(d->'class_ids'))
           = (select array_agg(c order by c) from unnest(e.class_ids) c)
       and (select coalesce(array_agg(value::uuid order by value::uuid), '{}') from jsonb_array_elements_text(coalesce(d->'absent_staff_ids', '[]'::jsonb)))
           = (select coalesce(array_agg(c order by c), '{}') from unnest(e.absent_staff_ids) c)
    then
      -- Unchanged in every way anybody was told. Suggestions and warnings
      -- are working notes, refreshed in place without a new revision.
      --
      -- So is a pin: a coordinator choosing, by hand, the teacher who already
      -- has the duty changes nothing that teacher was told, but it does change
      -- what the next re-arrangement may do with it. Recorded here, in place,
      -- because a new revision would send her a notice about nothing.
      if coalesce(d->>'source', 'auto') is distinct from e.source
         or coalesce((d->>'pinned')::boolean, false) is distinct from e.pinned then
        v_count_pinned := v_count_pinned + 1;
      end if;
      update vppsone.cover_duties
      set suggested_staff_id = (d->>'suggested_staff_id')::uuid,
          match_tier = d->>'match_tier',
          warnings = coalesce(array(select jsonb_array_elements_text(coalesce(d->'warnings', '[]'::jsonb))), '{}'),
          source = coalesce(d->>'source', 'auto'),
          pinned = coalesce((d->>'pinned')::boolean, false)
      where id = e.id;
      v_count_unchanged := v_count_unchanged + 1;
      continue;
    end if;

    update vppsone.cover_duties set status = 'superseded', ended_at = now() where id = e.id;
    v_pairs := v_pairs || jsonb_build_object('old_id', e.id, 'old_status', e.status::text, 'desired', d);
  end loop;

  for p in select value from jsonb_array_elements(v_pairs)
  loop
    select * into v_old from vppsone.cover_duties where id = (p->>'old_id')::uuid;
    v_old_status := p->>'old_status';
    d := p->'desired';

    v_new_id := vppsone.cover_duty_insert(d, v_session, v_day, v_old.revision + 1, v_old.id, v_day_row.revision + 1, v_id, v_actor);
    v_count_changed := v_count_changed + 1;

    if v_old_status = 'assigned' and (
      d->>'status' <> 'assigned' or (d->>'covering_staff_id')::uuid <> v_old.covering_staff_id
    ) then
      perform vppsone.cover_notice_withdrawn(v_old, v_id);
    end if;

    if d->>'status' = 'assigned' then
      if v_old_status = 'assigned' and (d->>'covering_staff_id')::uuid = v_old.covering_staff_id then
        perform vppsone.cover_notice_changed(v_old, v_new_id, v_id);
      else
        perform vppsone.cover_notice_queue(v_new_id, 'cover_assigned', v_id);
      end if;
    end if;
  end loop;

  for d in select value from jsonb_array_elements(v_desired)
  loop
    if (d->>'need_key') = any (v_handled) then continue; end if;
    if not vppsone.cover_period_open(v_session, v_day, (d->>'period')::integer) then
      v_count_skipped := v_count_skipped + 1;
      continue;
    end if;

    select coalesce(max(revision), 0) + 1 into v_new_revision
    from vppsone.cover_duties
    where session_label = v_session and day = v_day and need_key = d->>'need_key';

    v_new_id := vppsone.cover_duty_insert(d, v_session, v_day, v_new_revision, null, v_day_row.revision + 1, v_id, v_actor);
    v_count_new := v_count_new + 1;
    if d->>'status' = 'assigned' then
      perform vppsone.cover_notice_queue(v_new_id, 'cover_assigned', v_id);
    end if;
  end loop;

  if v_fault = 'after_duties' and vppsone.flag_enabled('fault_injection') then
    raise exception 'cover_command:injected_fault:after_duties';
  end if;

  -- 9. The day moves on, and the receipt is kept.
  update vppsone.cover_days
  set revision = revision + 1,
      timetable_version_id = v_version,
      bells_revision = v_bells_revision,
      updated_by = v_actor,
      updated_at = now()
  where session_label = v_session and day = v_day;

  select jsonb_build_object(
    'assigned', count(*) filter (where status = 'assigned'),
    'needs_help', count(*) filter (where status = 'needs_help')
  ) into v_live
  from vppsone.cover_duties
  where session_label = v_session and day = v_day and status in ('assigned', 'needs_help');

  v_receipt := jsonb_build_object(
    'ok', true,
    'command_id', v_id,
    'kind', v_kind,
    'day', v_day,
    'day_revision', v_day_row.revision + 1,
    'assigned', (v_live->>'assigned')::integer,
    'needs_help', (v_live->>'needs_help')::integer,
    'new', v_count_new,
    'changed', v_count_changed,
    'cancelled', v_count_cancelled,
    'unchanged', v_count_unchanged,
    'pinned', v_count_pinned,
    'skipped_started', v_count_skipped,
    'notices_queued', (
      select count(*) from vppsone.staff_notices where command_id = v_id and status = 'pending'
    ),
    'notices_withdrawn', (
      select count(*) from vppsone.staff_notices
      where status = 'cancelled' and status_reason = 'withdrawn:' || v_id::text
    ),
    'notice_recipients', (
      select count(distinct staff_profile_id) from vppsone.staff_notices
      where command_id = v_id and status = 'pending'
    ),
    'recipients_without_phone', (
      select count(distinct n.staff_profile_id)
      from vppsone.staff_notices n
      join vppsone.staff_profiles sp on sp.id = n.staff_profile_id
      where n.command_id = v_id and n.status = 'pending'
        and coalesce(nullif(sp.whatsapp_phone, ''), nullif(sp.phone, '')) is null
    ),
    'replayed', false
  );

  if v_fault = 'before_receipt' and vppsone.flag_enabled('fault_injection') then
    raise exception 'cover_command:injected_fault:before_receipt';
  end if;

  insert into vppsone.cover_commands (id, kind, session_label, day, actor_staff_id, payload_hash, receipt)
  values (v_id, v_kind, v_session, v_day, v_actor, v_hash, v_receipt);

  return v_receipt;
end;
$$;
