-- PLACEHOLDER VERSION: written by the smoke-run admin stream (20 Oct findings,
-- dev group 5) and NOT applied anywhere. The lead applies it to DEV and renames
-- the file to the version the MCP stamps.
--
-- A person may put a teacher into a lesson that is running now with nobody in
-- it. The cover command treats a begun period as history (cover_period_open);
-- this is the one narrow door: today only, a period that has started and not
-- ended, a lesson with no live duty, a teacher who is active, in school, not
-- teaching and not already covering then. It writes one manual, pinned duty
-- and queues its notice, in the same shape and under the same per-day lock as
-- commit_cover_command, so the next command leaves it alone (its step 7 skips
-- begun periods) and every screen reads the lesson as covered.

create or replace function vppsone.assign_late_cover(p_command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actor uuid;
  v_session text := p_command->>'session_label';
  v_day date;
  v_hash text := p_command->>'payload_hash';
  v_tt_day text := p_command->>'timetable_day';
  v_need jsonb := p_command->'need';
  v_covering uuid;
  v_period integer;
  v_previous vppsone.cover_commands%rowtype;
  v_day_row vppsone.cover_days%rowtype;
  v_version uuid;
  v_bells_revision integer;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_minutes integer := extract(hour from (now() at time zone 'Asia/Kolkata'))::integer * 60
                     + extract(minute from (now() at time zone 'Asia/Kolkata'))::integer;
  v_starts text;
  v_ends text;
  v_revision integer;
  v_new_id uuid;
  v_live jsonb;
  v_receipt jsonb;
begin
  begin
    v_id := (p_command->>'command_id')::uuid;
    v_actor := (p_command->>'actor_staff_id')::uuid;
    v_day := (p_command->>'day')::date;
    v_covering := (p_command->>'covering_staff_id')::uuid;
    v_period := (v_need->>'period')::integer;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end;

  if v_id is null or v_actor is null or v_session is null or v_day is null or v_hash is null
     or v_covering is null or v_period is null or v_need->>'need_key' is null or v_tt_day is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;

  -- Who is asking, now.
  if not exists (
    select 1 from vppsone.staff_profiles sp
    join vppsone.role_permissions rp on rp.role = sp.role
    where sp.id = v_actor and sp.is_active and rp.permission = 'substitutions:manage'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_permitted');
  end if;

  perform pg_advisory_xact_lock(hashtext('vppsone:cover:' || v_session || ':' || v_day::text));

  -- The same submission again gets the same answer.
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

  -- Today, and a period that is running now.
  select period->>'starts', period->>'ends' into v_starts, v_ends
  from vppsone.bell_schedules b, jsonb_array_elements(b.periods) period
  where b.session_label = v_session and b.is_current
    and (period->>'index')::integer = v_period;
  if v_day <> v_today or v_starts is null or v_ends is null
     or v_minutes < split_part(v_starts, ':', 1)::integer * 60 + split_part(v_starts, ':', 2)::integer
     or v_minutes >= split_part(v_ends, ':', 1)::integer * 60 + split_part(v_ends, ':', 2)::integer then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;

  select id into v_version from vppsone.timetable_versions
  where session_label = v_session and status = 'published';
  select revision into v_bells_revision from vppsone.bell_schedules
  where session_label = v_session and is_current;
  if v_version is null or v_version is distinct from (p_command->>'timetable_version_id')::uuid then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  -- Nobody has been put in that lesson meanwhile.
  if exists (
    select 1 from vppsone.cover_duties
    where session_label = v_session and day = v_day and need_key = v_need->>'need_key'
      and status in ('assigned', 'needs_help')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'stale');
  end if;

  -- The teacher can be there.
  if not exists (select 1 from vppsone.staff_profiles where id = v_covering and is_active)
     or exists (
       select 1 from vppsone.teacher_absences ta
       where ta.staff_profile_id = v_covering and ta.day = v_day
         and (cardinality(ta.periods) = 0 or v_period::smallint = any (ta.periods))
     )
     or exists (
       select 1 from vppsone.timetable_slots s
       where s.version_id = v_version and s.day = v_tt_day
         and s.period = v_period::smallint and s.staff_profile_id = v_covering
     )
     or exists (
       select 1 from vppsone.cover_duties d
       where d.session_label = v_session and d.day = v_day and d.period = v_period::smallint
         and d.covering_staff_id = v_covering and d.status = 'assigned'
     ) then
    return jsonb_build_object('ok', false, 'reason', 'refused_override');
  end if;

  insert into vppsone.cover_days (session_label, day) values (v_session, v_day)
  on conflict (session_label, day) do nothing;
  select * into v_day_row from vppsone.cover_days
  where session_label = v_session and day = v_day for update;

  select coalesce(max(revision), 0) + 1 into v_revision
  from vppsone.cover_duties
  where session_label = v_session and day = v_day and need_key = v_need->>'need_key';

  v_new_id := vppsone.cover_duty_insert(
    v_need || jsonb_build_object(
      'status', 'assigned',
      'covering_staff_id', v_covering,
      'suggested_staff_id', null,
      'reason', null,
      'source', 'manual',
      'pinned', true,
      'match_tier', null,
      'warnings', '[]'::jsonb
    ),
    v_session, v_day, v_revision, null, v_day_row.revision + 1, v_id, v_actor
  );
  perform vppsone.cover_notice_queue(v_new_id, 'cover_assigned', v_id);

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
    'kind', 'late_assign',
    'day', v_day,
    'day_revision', v_day_row.revision + 1,
    'assigned', (v_live->>'assigned')::integer,
    'needs_help', (v_live->>'needs_help')::integer,
    'new', 1,
    'changed', 0,
    'cancelled', 0,
    'unchanged', 0,
    'pinned', 0,
    'skipped_started', 0,
    'notices_queued', (select count(*) from vppsone.staff_notices where command_id = v_id and status = 'pending'),
    'notices_withdrawn', 0,
    'notice_recipients', (select count(distinct staff_profile_id) from vppsone.staff_notices where command_id = v_id and status = 'pending'),
    'recipients_without_phone', (
      select count(distinct n.staff_profile_id)
      from vppsone.staff_notices n
      join vppsone.staff_profiles sp on sp.id = n.staff_profile_id
      where n.command_id = v_id and n.status = 'pending'
        and coalesce(nullif(sp.whatsapp_phone, ''), nullif(sp.phone, '')) is null
    ),
    'replayed', false
  );

  insert into vppsone.cover_commands (id, kind, session_label, day, actor_staff_id, payload_hash, receipt)
  values (v_id, 'late_assign', v_session, v_day, v_actor, v_hash, v_receipt);

  return v_receipt;
end;
$$;

comment on function vppsone.assign_late_cover(jsonb) is
  'Put a teacher into a lesson running now with nobody in it (today, a begun and unfinished period, no live duty). One manual pinned duty and its notice, under the cover day lock. The cover command leaves begun periods alone, so it stays.';

revoke all on function vppsone.assign_late_cover(jsonb) from public;
grant execute on function vppsone.assign_late_cover(jsonb) to service_role;
