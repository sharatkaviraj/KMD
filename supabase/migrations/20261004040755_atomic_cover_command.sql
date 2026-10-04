-- P3 (Gate E): one atomic, versioned, idempotent absence-and-cover command.
--
-- Before this, arranging cover was five separate requests — save the absence,
-- generate (delete, insert, stamp), edit, publish — with no transaction around
-- any of them. A failure halfway left a published plan with rows missing; two
-- coordinators could interleave; publishing never checked the plan against
-- the absence that had changed since; and nobody was ever told.
--
-- Now there is one database command, `vppsone.commit_cover_command`, and it is
-- the only writer of absences, duties and notice intents. Given a logical
-- submission id, the actor and the *whole desired state* of the day's future
-- duties (which the server worked out — never the browser), it:
--
--   1. refuses an actor who may not manage cover, or a disabled command;
--   2. serialises on the day (an advisory lock), so two operators queue;
--   3. returns the stored receipt for a repeated id with the same payload,
--      and refuses the same id with a different payload;
--   4. refuses a stale plan — the day, the published timetable or the bells
--      moved since the operator looked — rather than last-write-wins;
--   5. writes the absence change with an appended revision;
--   6. re-validates every assignment against the facts as they now are
--      (active, present, not teaching, not double booked, period not begun)
--      and raises — rolling everything back — if one fails;
--   7. diffs desired against live duties: unchanged rows keep their identity
--      and are not re-announced; changed ones are superseded by a new
--      revision; vanished ones are cancelled; started periods are history and
--      are never touched;
--   8. writes the notice intents those changes need — and cancels an unsent
--      notice instead of sending a correction for it;
--   9. bumps the day's revision and stores the receipt.
--
-- All of it in the one transaction the function is. Provider calls happen
-- later, outside it (P4), and cannot undo a valid plan.
--
-- The old `substitution_plans`/`substitution_assignments` stay, read-only, as
-- history. Additive otherwise; nothing touches fee data.

-- ------------------------------------------------------------- switches

create table vppsone.runtime_flags (
  key text primary key,
  enabled boolean not null,
  note text,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint runtime_flags_key_known check (
    key in ('cover_command', 'staff_notice_dispatch', 'fault_injection', 'parent_dispatch')
  )
);

comment on table vppsone.runtime_flags is
  'Operator switches. cover_command and staff_notice_dispatch can be turned off independently (rollback without deleting evidence). fault_injection exists for the atomicity tests and is never on in production. parent_dispatch stays off: parents are approval-by-default (PLAN §14).';

insert into vppsone.runtime_flags (key, enabled, note) values
  ('cover_command', true, 'Save absence & arrange cover'),
  ('staff_notice_dispatch', false, 'Off until P4 ships its dispatcher; turned on per deployment'),
  ('fault_injection', false, 'Test-only. Turned on by hand on schoolfees-dev, never by a migration'),
  ('parent_dispatch', false, 'Parent messages are approval-only')
on conflict (key) do nothing;

alter table vppsone.runtime_flags enable row level security;
create policy runtime_flags_select_active_staff
  on vppsone.runtime_flags for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.runtime_flags to authenticated;
grant all on vppsone.runtime_flags to service_role;

create or replace function vppsone.flag_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from vppsone.runtime_flags where key = p_key), false)
$$;

revoke all on function vppsone.flag_enabled(text) from public;
grant execute on function vppsone.flag_enabled(text) to authenticated, service_role;

-- ------------------------------------------------------------- the clock

/*
 * Whether cover for a period can still be arranged: it has not begun.
 *
 * By the session's current bells, in school time. A day before today never;
 * a day after today always; today by the bell. No bells at all for today means
 * nobody can say, so the answer is no — a person decides.
 * Mirrors `isArrangeable()` in src/modules/timetable/domain/bells.ts.
 */
create or replace function vppsone.cover_period_open(
  p_session_label text,
  p_day date,
  p_period integer
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_minutes integer := extract(hour from (now() at time zone 'Asia/Kolkata'))::integer * 60
                     + extract(minute from (now() at time zone 'Asia/Kolkata'))::integer;
  v_starts text;
begin
  if p_day < v_today then return false; end if;
  if p_day > v_today then return true; end if;

  select period->>'starts' into v_starts
  from vppsone.bell_schedules b, jsonb_array_elements(b.periods) period
  where b.session_label = p_session_label and b.is_current
    and (period->>'index')::integer = p_period;

  if v_starts is null then return false; end if;
  return v_minutes < split_part(v_starts, ':', 1)::integer * 60 + split_part(v_starts, ':', 2)::integer;
end;
$$;

/* When a period ends, as an instant — after it a cover notice is pointless. */
create or replace function vppsone.cover_period_ends_at(
  p_session_label text,
  p_day date,
  p_period integer
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_day::text || ' ' || coalesce(
    (select period->>'ends'
     from vppsone.bell_schedules b, jsonb_array_elements(b.periods) period
     where b.session_label = p_session_label and b.is_current
       and (period->>'index')::integer = p_period),
    '23:59'
  ))::timestamp at time zone 'Asia/Kolkata')
$$;

revoke all on function vppsone.cover_period_open(text, date, integer) from public;
revoke all on function vppsone.cover_period_ends_at(text, date, integer) from public;
grant execute on function vppsone.cover_period_open(text, date, integer) to authenticated, service_role;
grant execute on function vppsone.cover_period_ends_at(text, date, integer) to authenticated, service_role;

-- ------------------------------------------------------------- absences

alter table vppsone.teacher_absences
  add column revision integer not null default 1,
  add column updated_by uuid references vppsone.staff_profiles (id) on delete set null;

create table vppsone.teacher_absence_history (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete cascade,
  day date not null,
  /** Null records the absence being cleared — they came in after all. */
  periods smallint[],
  revision integer not null,
  command_id uuid not null,
  actor_staff_id uuid references vppsone.staff_profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);

comment on table vppsone.teacher_absence_history is
  'Every change to an absence, appended by commit_cover_command. No reasons are stored: the command does not ask for one.';

create index teacher_absence_history_by_day_idx
  on vppsone.teacher_absence_history (session_label, day, staff_profile_id, revision);

alter table vppsone.teacher_absence_history enable row level security;
create policy teacher_absence_history_select_scoped
  on vppsone.teacher_absence_history for select to authenticated
  using ((select vppsone.staff_can('substitutions:manage')));
grant select on vppsone.teacher_absence_history to authenticated;
grant all on vppsone.teacher_absence_history to service_role;

-- ------------------------------------------------------------- the day

create table vppsone.cover_days (
  session_label text not null,
  day date not null,
  revision integer not null default 0,
  timetable_version_id uuid references vppsone.timetable_versions (id) on delete set null,
  bells_revision integer,
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (session_label, day)
);

comment on table vppsone.cover_days is
  'One row per day cover was arranged for. revision bumps on every committed command; a command that names an older revision is stale.';

alter table vppsone.cover_days enable row level security;
create policy cover_days_select_active_staff
  on vppsone.cover_days for select to authenticated
  using ((select vppsone.is_active_staff()));
grant select on vppsone.cover_days to authenticated;
grant all on vppsone.cover_days to service_role;

-- ------------------------------------------------------------- duties

create type vppsone.cover_duty_status as enum ('assigned', 'needs_help', 'cancelled', 'superseded');

create table vppsone.cover_duties (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  day date not null,
  /** The physical lesson and what it needs (events.ts); stable across revisions. */
  need_key text not null,
  period smallint not null,
  event_kind text not null,
  class_ids uuid[] not null,
  class_labels text[] not null,
  subject_code text not null,
  absent_staff_ids uuid[] not null,
  status vppsone.cover_duty_status not null,
  covering_staff_id uuid references vppsone.staff_profiles (id) on delete restrict,
  /** Who the engine would ask, for a duty it may not assign by itself. */
  suggested_staff_id uuid references vppsone.staff_profiles (id) on delete set null,
  /** Why a person has to look: no_candidate, team_unmapped, pin_invalid, cannot_cover, … */
  reason text,
  source text not null,
  pinned boolean not null default false,
  match_tier text,
  warnings text[] not null default '{}',
  revision integer not null default 1,
  supersedes uuid references vppsone.cover_duties (id) on delete set null,
  day_revision integer not null,
  command_id uuid not null,
  created_by uuid references vppsone.staff_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  acknowledged_at timestamptz,
  cannot_cover_at timestamptz,
  cannot_cover_note text,
  constraint cover_duties_period_in_range check (period between 0 and 15),
  constraint cover_duties_kind_known check (
    event_kind in ('ordinary', 'joint', 'parallel_cohort', 'team_block')
  ),
  constraint cover_duties_source_known check (source in ('auto', 'manual')),
  constraint cover_duties_assigned_has_teacher check (
    status <> 'assigned' or covering_staff_id is not null
  ),
  constraint cover_duties_classes_aligned check (
    cardinality(class_ids) > 0 and cardinality(class_ids) = cardinality(class_labels)
  ),
  constraint cover_duties_ended_when_done check (
    (status in ('cancelled', 'superseded')) = (ended_at is not null)
  )
);

comment on table vppsone.cover_duties is
  'One row per revision of one cover need. Live rows are assigned or needs_help; a change supersedes a row with a new revision rather than editing it, so what a teacher was told stays on record.';

-- One live row per need, and nobody in two rooms at once — across the whole
-- day, not only within one plan.
create unique index cover_duties_one_live_per_need
  on vppsone.cover_duties (session_label, day, need_key)
  where status in ('assigned', 'needs_help');
create unique index cover_duties_no_double_booking
  on vppsone.cover_duties (session_label, day, period, covering_staff_id)
  where status = 'assigned';
create index cover_duties_by_day_idx on vppsone.cover_duties (session_label, day, period);
create index cover_duties_by_teacher_idx
  on vppsone.cover_duties (covering_staff_id, day) where status = 'assigned';
create index cover_duties_by_need_idx on vppsone.cover_duties (session_label, day, need_key, revision);

alter table vppsone.cover_duties enable row level security;
create policy cover_duties_select_scoped
  on vppsone.cover_duties for select to authenticated
  using (
    (select vppsone.staff_can('substitutions:view'))
    or covering_staff_id = (select vppsone.current_staff_profile_id())
  );
grant select on vppsone.cover_duties to authenticated;
grant all on vppsone.cover_duties to service_role;

-- ------------------------------------------------------------- commands

create table vppsone.cover_commands (
  /** The logical submission id the browser minted once per form. */
  id uuid primary key,
  kind text not null,
  session_label text not null,
  day date not null,
  actor_staff_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now()
);

comment on table vppsone.cover_commands is
  'Every committed cover command and the receipt it returned. A repeated id with the same payload gets this receipt back; with a different payload it is refused.';

create index cover_commands_by_day_idx on vppsone.cover_commands (session_label, day, created_at desc);

alter table vppsone.cover_commands enable row level security;
create policy cover_commands_select_scoped
  on vppsone.cover_commands for select to authenticated
  using (
    actor_staff_id = (select vppsone.current_staff_profile_id())
    or (select vppsone.staff_can('substitutions:manage'))
  );
grant select on vppsone.cover_commands to authenticated;
grant all on vppsone.cover_commands to service_role;

-- ------------------------------------------------------------- notice intents

create type vppsone.staff_notice_status as enum (
  'pending', 'cancelled', 'suppressed', 'dispatching', 'accepted', 'failed', 'unknown',
  'delivered', 'read'
);

create table vppsone.staff_notices (
  id uuid primary key default gen_random_uuid(),
  /** duty id : kind : staff — one notice per business event per person. */
  notice_key text not null,
  kind text not null,
  duty_id uuid not null references vppsone.cover_duties (id) on delete restrict,
  duty_revision integer not null,
  staff_profile_id uuid not null references vppsone.staff_profiles (id) on delete restrict,
  session_label text not null,
  day date not null,
  period smallint not null,
  status vppsone.staff_notice_status not null default 'pending',
  status_reason text,
  /** After this a cover notice says nothing useful and is not sent. */
  not_after timestamptz not null,
  command_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_notices_kind_known check (
    kind in ('cover_assigned', 'cover_changed', 'cover_cancelled', 'cover_escalation')
  )
);

comment on table vppsone.staff_notices is
  'What a member of staff should be told about a cover duty — the intent, written in the same transaction as the duty. Attempts to send it are a separate ledger (P4).';

create unique index staff_notices_key_unique on vppsone.staff_notices (notice_key);
create index staff_notices_queue_idx on vppsone.staff_notices (status, not_after);
create index staff_notices_by_duty_idx on vppsone.staff_notices (duty_id);
create index staff_notices_by_staff_idx on vppsone.staff_notices (staff_profile_id, day);

create trigger staff_notices_set_updated_at
  before update on vppsone.staff_notices
  for each row execute function vppsone.set_updated_at();

alter table vppsone.staff_notices enable row level security;
create policy staff_notices_select_scoped
  on vppsone.staff_notices for select to authenticated
  using (
    staff_profile_id = (select vppsone.current_staff_profile_id())
    or (select vppsone.staff_can('substitutions:manage'))
  );
grant select on vppsone.staff_notices to authenticated;
grant all on vppsone.staff_notices to service_role;

-- ------------------------------------------------------------- the command

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
      update vppsone.cover_duties
      set suggested_staff_id = (d->>'suggested_staff_id')::uuid,
          match_tier = d->>'match_tier',
          warnings = coalesce(array(select jsonb_array_elements_text(coalesce(d->'warnings', '[]'::jsonb))), '{}')
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

-- --------------------------------------------- the command's three helpers

create or replace function vppsone.cover_duty_insert(
  d jsonb,
  p_session text,
  p_day date,
  p_revision integer,
  p_supersedes uuid,
  p_day_revision integer,
  p_command uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into vppsone.cover_duties (
    session_label, day, need_key, period, event_kind, class_ids, class_labels, subject_code,
    absent_staff_ids, status, covering_staff_id, suggested_staff_id, reason, source, pinned,
    match_tier, warnings, revision, supersedes, day_revision, command_id, created_by
  ) values (
    p_session, p_day, d->>'need_key', (d->>'period')::smallint, d->>'event_kind',
    array(select value::uuid from jsonb_array_elements_text(d->'class_ids')),
    array(select value from jsonb_array_elements_text(d->'class_labels')),
    d->>'subject_code',
    array(select value::uuid from jsonb_array_elements_text(coalesce(d->'absent_staff_ids', '[]'::jsonb))),
    (d->>'status')::vppsone.cover_duty_status,
    (d->>'covering_staff_id')::uuid,
    (d->>'suggested_staff_id')::uuid,
    d->>'reason',
    coalesce(d->>'source', 'auto'),
    coalesce((d->>'pinned')::boolean, false),
    d->>'match_tier',
    coalesce(array(select jsonb_array_elements_text(coalesce(d->'warnings', '[]'::jsonb))), '{}'),
    p_revision, p_supersedes, p_day_revision, p_command, p_actor
  )
  returning id into v_id;
  return v_id;
end;
$$;

/* Tell somebody a duty is theirs. One notice per duty row, kind and person. */
create or replace function vppsone.cover_notice_queue(p_duty uuid, p_kind text, p_command uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r vppsone.cover_duties%rowtype;
begin
  select * into r from vppsone.cover_duties where id = p_duty;
  if r.covering_staff_id is null then return; end if;
  insert into vppsone.staff_notices (
    notice_key, kind, duty_id, duty_revision, staff_profile_id, session_label, day, period,
    not_after, command_id
  ) values (
    r.id::text || ':' || p_kind || ':' || r.covering_staff_id::text,
    p_kind, r.id, r.revision, r.covering_staff_id, r.session_label, r.day, r.period,
    vppsone.cover_period_ends_at(r.session_label, r.day, r.period), p_command
  )
  on conflict (notice_key) do nothing;
end;
$$;

/*
 * A duty somebody held is no longer theirs.
 *
 * If what they were told has not been sent yet, it is simply withdrawn —
 * there is nothing to correct. If it went out, or might have (dispatching,
 * accepted, unknown), they are owed an explicit cancellation. If they were
 * never told anything, there is nothing to say.
 */
create or replace function vppsone.cover_notice_withdrawn(p_old vppsone.cover_duties, p_command uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent boolean;
begin
  update vppsone.staff_notices
  set status = 'cancelled', status_reason = 'withdrawn:' || p_command::text
  where duty_id = p_old.id and status = 'pending';

  select exists (
    select 1 from vppsone.staff_notices
    where duty_id = p_old.id
      and kind in ('cover_assigned', 'cover_changed')
      and status in ('dispatching', 'accepted', 'unknown', 'delivered', 'read')
  ) into v_sent;

  if v_sent then
    insert into vppsone.staff_notices (
      notice_key, kind, duty_id, duty_revision, staff_profile_id, session_label, day, period,
      not_after, command_id
    ) values (
      p_old.id::text || ':cover_cancelled:' || p_old.covering_staff_id::text,
      'cover_cancelled', p_old.id, p_old.revision, p_old.covering_staff_id,
      p_old.session_label, p_old.day, p_old.period,
      vppsone.cover_period_ends_at(p_old.session_label, p_old.day, p_old.period), p_command
    )
    on conflict (notice_key) do nothing;
  end if;
end;
$$;

/* Same teacher, changed facts: a correction if they were told, else a fresh notice. */
create or replace function vppsone.cover_notice_changed(p_old vppsone.cover_duties, p_new uuid, p_command uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent boolean;
begin
  update vppsone.staff_notices
  set status = 'cancelled', status_reason = 'withdrawn:' || p_command::text
  where duty_id = p_old.id and status = 'pending';

  select exists (
    select 1 from vppsone.staff_notices
    where duty_id = p_old.id and status in ('dispatching', 'accepted', 'unknown', 'delivered', 'read')
  ) into v_sent;

  perform vppsone.cover_notice_queue(p_new, case when v_sent then 'cover_changed' else 'cover_assigned' end, p_command);
end;
$$;

revoke all on function vppsone.commit_cover_command(jsonb) from public;
revoke all on function vppsone.cover_duty_insert(jsonb, text, date, integer, uuid, integer, uuid, uuid) from public;
revoke all on function vppsone.cover_notice_queue(uuid, text, uuid) from public;
revoke all on function vppsone.cover_notice_withdrawn(vppsone.cover_duties, uuid) from public;
revoke all on function vppsone.cover_notice_changed(vppsone.cover_duties, uuid, uuid) from public;
grant execute on function vppsone.commit_cover_command(jsonb) to service_role;
grant execute on function vppsone.cover_duty_insert(jsonb, text, date, integer, uuid, integer, uuid, uuid) to service_role;
grant execute on function vppsone.cover_notice_queue(uuid, text, uuid) to service_role;
grant execute on function vppsone.cover_notice_withdrawn(vppsone.cover_duties, uuid) to service_role;
grant execute on function vppsone.cover_notice_changed(vppsone.cover_duties, uuid, uuid) to service_role;
