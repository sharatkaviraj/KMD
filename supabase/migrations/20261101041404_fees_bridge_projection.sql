-- One-owned disposable read projections. No copied financial engine or send triggers.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.fees_bridge_state (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  live_read_ready boolean not null default false,
  source_project_ref text not null default 'vgqyilgstjvgohrsiwkb'
    check (source_project_ref = 'vgqyilgstjvgohrsiwkb'),
  contract_version integer not null default 1 check (contract_version = 1),
  last_revision bigint not null default 0 check (last_revision >= 0),
  snapshot_id uuid,
  captured_at timestamptz,
  applied_at timestamptz,
  last_checked_at timestamptz,
  as_of_date date,
  active_session_label text,
  counts jsonb not null default '{}'::jsonb,
  snapshot_sha256 text,
  last_error_code text,
  last_attempt_at timestamptz
);
insert into vppsone.fees_bridge_state (id) values (true);

create table vppsone.fees_bridge_sessions (
  id uuid primary key,
  session_label text not null unique,
  status text,
  is_current boolean not null default false,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  fields jsonb not null default '{}'::jsonb
);
create table vppsone.fees_bridge_classes (
  id uuid primary key,
  session_label text not null,
  class_name text not null,
  section text,
  stream_name text,
  sort_order integer,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  fields jsonb not null default '{}'::jsonb,
  constraint fees_bridge_classes_session_fkey foreign key (session_label)
    references vppsone.fees_bridge_sessions(session_label) deferrable initially deferred
);
create index fees_bridge_classes_session_idx on vppsone.fees_bridge_classes(session_label);
create table vppsone.fees_bridge_students (
  id uuid primary key,
  session_label text not null,
  class_id uuid not null,
  admission_no text,
  full_name text not null,
  father_name text,
  mother_name text,
  guardian_name text,
  guardian_relation text,
  guardian_phone text,
  primary_phone text,
  secondary_phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  roll_no text,
  status text,
  photo_path text,
  photo_url text,
  date_of_birth date,
  gender text,
  house text,
  address text,
  village_city text,
  transport_route_id uuid,
  joined_on date,
  left_on date,
  created_at timestamptz,
  updated_at timestamptz,
  fields jsonb not null default '{}'::jsonb,
  constraint fees_bridge_students_class_id_fkey foreign key (class_id)
    references vppsone.fees_bridge_classes(id) deferrable initially deferred
);
create index fees_bridge_students_session_class_idx on vppsone.fees_bridge_students(session_label,class_id);
create table vppsone.fees_bridge_households (
  id text not null check (id ~ '^(family|student):[0-9a-f-]{36}$'),
  session_label text not null,
  fields jsonb not null,
  primary key(id,session_label)
);
create table vppsone.fees_bridge_runs (
  id uuid primary key,
  revision bigint not null unique,
  captured_at timestamptz not null,
  applied_at timestamptz not null default clock_timestamp(),
  as_of_date date not null,
  counts jsonb not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('applied','verified'))
);
-- Retain display identity for academic history when a canonical row disappears.
-- These never appear in the current roster or authorize a financial operation.
create table vppsone.fees_bridge_retired_students (
  id uuid primary key, session_label text not null, fields jsonb not null,
  retired_at timestamptz not null default clock_timestamp()
);
create table vppsone.fees_bridge_retired_classes (
  id uuid primary key, session_label text not null, fields jsonb not null,
  retired_at timestamptz not null default clock_timestamp()
);

-- No client roles can query or alter these tables directly. All reads must pass
-- the app's staff, class and session authorization, and TEST confinement checks.
alter table vppsone.fees_bridge_state enable row level security;
alter table vppsone.fees_bridge_sessions enable row level security;
alter table vppsone.fees_bridge_classes enable row level security;
alter table vppsone.fees_bridge_students enable row level security;
alter table vppsone.fees_bridge_households enable row level security;
alter table vppsone.fees_bridge_runs enable row level security;
alter table vppsone.fees_bridge_retired_students enable row level security;
alter table vppsone.fees_bridge_retired_classes enable row level security;
revoke all on vppsone.fees_bridge_state, vppsone.fees_bridge_sessions,
  vppsone.fees_bridge_classes, vppsone.fees_bridge_students,
  vppsone.fees_bridge_households, vppsone.fees_bridge_runs,
  vppsone.fees_bridge_retired_students,vppsone.fees_bridge_retired_classes from public,anon,authenticated;
grant select,insert,update,delete on vppsone.fees_bridge_state, vppsone.fees_bridge_sessions,
  vppsone.fees_bridge_classes, vppsone.fees_bridge_students,
  vppsone.fees_bridge_households, vppsone.fees_bridge_runs,
  vppsone.fees_bridge_retired_students,vppsone.fees_bridge_retired_classes to service_role;

-- Reusable missing-only academic bootstrap, called in the same transaction as
-- an accepted bridge generation, AFTER fees_bridge_state is updated. This is
-- deliberately not the legacy rebuild: existing enrolments are One-owned
-- history and are never updated/deleted, including transfers and leavers.
-- Install via the reviewed bridge migration; do not run standalone on Fees.
create or replace function vppsone.bootstrap_fees_bridge_enrolments(p_snapshot_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer; projection_enabled boolean;
begin
  select enabled into projection_enabled from vppsone.fees_bridge_state
  where snapshot_id=p_snapshot_id and last_error_code is null;
  if p_snapshot_id is null or not found then
    raise exception 'bridge_enrolment_generation_mismatch';
  end if;
  -- Shadow bootstrap is validated before the operator enables live academics.
  if not projection_enabled then return 0; end if;
  insert into vppsone.enrolments
    (student_id,class_id,session_label,roll_no,status,enrolled_on,left_on)
  select s.id,s.class_id,s.session_label,s.roll_no,
    case when s.status='left' then 'left'::vppsone.enrolment_status
         else 'enrolled'::vppsone.enrolment_status end,
    s.joined_on,case when s.status='left' then s.left_on else null end
  from vppsone.fees_bridge_students s
  join vppsone.fees_bridge_classes c on c.id=s.class_id and c.session_label=s.session_label
  join vppsone.fees_bridge_sessions ss on ss.session_label=s.session_label
  where not vppsone.is_test_session_label(s.session_label)
    and s.status in ('active','left')
  on conflict (student_id,session_label) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;
revoke all on function vppsone.bootstrap_fees_bridge_enrolments(uuid) from public,anon,authenticated;
grant execute on function vppsone.bootstrap_fees_bridge_enrolments(uuid) to service_role;

create function vppsone.fees_bridge_apply_snapshot(p_snapshot jsonb,p_sha256 text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_state vppsone.fees_bridge_state%rowtype;
  v_revision bigint;
  v_id uuid;
  v_counts jsonb;
  v_captured timestamptz;
  v_day date;
  v_active text;
  v_replay boolean:=false;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'bridge_service_only' using errcode='42501';
  end if;
  if p_snapshot->>'version' is distinct from '1' or p_snapshot->>'sourceProjectRef' is distinct from 'vgqyilgstjvgohrsiwkb'
    or (p_snapshot->>'complete')::boolean is distinct from true
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_snapshot->'sessions') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'classes') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'students') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'households') is distinct from 'array' then
    raise exception 'bridge_invalid_contract';
  end if;
  v_revision := (p_snapshot->>'revision')::bigint;
  v_id := (p_snapshot->>'snapshotId')::uuid;
  v_captured := (p_snapshot->>'capturedAt')::timestamptz;
  v_day := (p_snapshot->>'asOfDate')::date;
  v_active := p_snapshot->>'activeSessionLabel';
  if v_revision is null or v_revision <= 0 or v_id is null or v_captured is null
    or v_day is null or v_active is null or length(v_active)=0
    or v_captured > clock_timestamp()+interval '1 minute'
    or v_captured < clock_timestamp()-interval '10 minutes'
    or v_day <> (v_captured at time zone 'Asia/Kolkata')::date then
    raise exception 'bridge_invalid_snapshot_identity';
  end if;
  v_counts := jsonb_build_object('sessions',jsonb_array_length(p_snapshot->'sessions'),
    'classes',jsonb_array_length(p_snapshot->'classes'),
    'students',jsonb_array_length(p_snapshot->'students'),
    'households',jsonb_array_length(p_snapshot->'households'));
  if v_counts is distinct from p_snapshot->'counts'
    or (v_counts->>'sessions')::int = 0 or (v_counts->>'classes')::int = 0
    or (v_counts->>'students')::int = 0 then
    raise exception 'bridge_incomplete_snapshot';
  end if;
  select * into strict v_state from vppsone.fees_bridge_state where id for update;
  if v_revision < v_state.last_revision then
    raise exception 'bridge_stale_fence';
  elsif v_revision = v_state.last_revision then
    if v_state.snapshot_id = v_id and v_state.snapshot_sha256 = p_sha256 then
      v_replay:=true;
    else
      raise exception 'bridge_fence_payload_conflict';
    end if;
  end if;
  -- Entire current generation changes in one transaction. Academics reference
  -- stable UUIDs without a cascading FK to these disposable projections.
  if v_state.snapshot_sha256 is distinct from p_sha256 then
  insert into vppsone.fees_bridge_retired_students(id,session_label,fields)
    select b.id,b.session_label,b.fields from vppsone.fees_bridge_students b
    where not exists(select 1 from jsonb_array_elements(p_snapshot->'students') j where (j->>'id')::uuid=b.id)
    on conflict(id) do update set fields=excluded.fields,session_label=excluded.session_label,retired_at=clock_timestamp();
  insert into vppsone.fees_bridge_retired_classes(id,session_label,fields)
    select b.id,b.session_label,b.fields from vppsone.fees_bridge_classes b
    where not exists(select 1 from jsonb_array_elements(p_snapshot->'classes') j where (j->>'id')::uuid=b.id)
    on conflict(id) do update set fields=excluded.fields,session_label=excluded.session_label,retired_at=clock_timestamp();
  delete from vppsone.fees_bridge_retired_students b
    where exists(select 1 from jsonb_array_elements(p_snapshot->'students') j where (j->>'id')::uuid=b.id);
  delete from vppsone.fees_bridge_retired_classes b
    where exists(select 1 from jsonb_array_elements(p_snapshot->'classes') j where (j->>'id')::uuid=b.id);
  delete from vppsone.fees_bridge_students b where not exists
    (select 1 from jsonb_array_elements(p_snapshot->'students') j where (j->>'id')::uuid=b.id);
  delete from vppsone.fees_bridge_classes b where not exists
    (select 1 from jsonb_array_elements(p_snapshot->'classes') j where (j->>'id')::uuid=b.id);
  delete from vppsone.fees_bridge_sessions b where not exists
    (select 1 from jsonb_array_elements(p_snapshot->'sessions') j where (j->>'id')::uuid=b.id);
  delete from vppsone.fees_bridge_households b where not exists
    (select 1 from jsonb_array_elements(p_snapshot->'households') j where j->>'id'=b.id and j->>'session_label'=b.session_label);
  insert into vppsone.fees_bridge_sessions as target
    (id,session_label,status,is_current,notes,created_at,updated_at,fields)
    select (j->>'id')::uuid,j->>'session_label',j->>'status',coalesce((j->>'is_current')::boolean,false),
      j->>'notes',(j->>'created_at')::timestamptz,(j->>'updated_at')::timestamptz,j
    from jsonb_array_elements(p_snapshot->'sessions') j
    on conflict(id) do update set session_label=excluded.session_label,status=excluded.status,
      is_current=excluded.is_current,notes=excluded.notes,created_at=excluded.created_at,
      updated_at=excluded.updated_at,fields=excluded.fields
    where to_jsonb(target) is distinct from to_jsonb(excluded);
  insert into vppsone.fees_bridge_classes as target
    (id,session_label,class_name,section,stream_name,sort_order,status,notes,created_at,updated_at,fields)
    select (j->>'id')::uuid,j->>'session_label',j->>'class_name',j->>'section',j->>'stream_name',
      (j->>'sort_order')::integer,j->>'status',j->>'notes',
      (j->>'created_at')::timestamptz,(j->>'updated_at')::timestamptz,j
    from jsonb_array_elements(p_snapshot->'classes') j
    on conflict(id) do update set session_label=excluded.session_label,class_name=excluded.class_name,
      section=excluded.section,stream_name=excluded.stream_name,sort_order=excluded.sort_order,
      status=excluded.status,notes=excluded.notes,created_at=excluded.created_at,
      updated_at=excluded.updated_at,fields=excluded.fields
    where to_jsonb(target) is distinct from to_jsonb(excluded);
  insert into vppsone.fees_bridge_students as target
    (id,session_label,class_id,admission_no,full_name,father_name,mother_name,guardian_name,
     guardian_relation,guardian_phone,primary_phone,secondary_phone,emergency_contact_name,
     emergency_contact_phone,roll_no,status,photo_path,photo_url,date_of_birth,gender,house,
     address,village_city,transport_route_id,joined_on,left_on,created_at,updated_at,fields)
    select (j->>'id')::uuid,j->>'session_label',(j->>'class_id')::uuid,j->>'admission_no',
      j->>'full_name',j->>'father_name',j->>'mother_name',j->>'guardian_name',j->>'guardian_relation',
      j->>'guardian_phone',j->>'primary_phone',j->>'secondary_phone',j->>'emergency_contact_name',
      j->>'emergency_contact_phone',j->>'roll_no',j->>'status',j->>'photo_path',j->>'photo_url',
      (j->>'date_of_birth')::date,j->>'gender',j->>'house',j->>'address',j->>'village_city',
      (j->>'transport_route_id')::uuid,(j->>'joined_on')::date,(j->>'left_on')::date,
      (j->>'created_at')::timestamptz,(j->>'updated_at')::timestamptz,j
    from jsonb_array_elements(p_snapshot->'students') j
    on conflict(id) do update set session_label=excluded.session_label,class_id=excluded.class_id,
      admission_no=excluded.admission_no,full_name=excluded.full_name,father_name=excluded.father_name,
      mother_name=excluded.mother_name,guardian_name=excluded.guardian_name,
      guardian_relation=excluded.guardian_relation,guardian_phone=excluded.guardian_phone,
      primary_phone=excluded.primary_phone,secondary_phone=excluded.secondary_phone,
      emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,
      roll_no=excluded.roll_no,status=excluded.status,photo_path=excluded.photo_path,photo_url=excluded.photo_url,
      date_of_birth=excluded.date_of_birth,gender=excluded.gender,house=excluded.house,address=excluded.address,
      village_city=excluded.village_city,transport_route_id=excluded.transport_route_id,
      joined_on=excluded.joined_on,left_on=excluded.left_on,created_at=excluded.created_at,
      updated_at=excluded.updated_at,fields=excluded.fields
    where to_jsonb(target) is distinct from to_jsonb(excluded);
  insert into vppsone.fees_bridge_households as target(id,session_label,fields)
    select j->>'id',j->>'session_label',j from jsonb_array_elements(p_snapshot->'households') j
    on conflict(id,session_label) do update set fields=excluded.fields
    where target.fields is distinct from excluded.fields;
  if not exists(select 1 from vppsone.fees_bridge_sessions where session_label=v_active)
    or exists(select 1 from vppsone.fees_bridge_students s
      join vppsone.fees_bridge_classes c on c.id=s.class_id where s.session_label<>c.session_label) then
    raise exception 'bridge_invalid_session_references';
  end if;
  set constraints vppsone.fees_bridge_classes_session_fkey,vppsone.fees_bridge_students_class_id_fkey immediate;
  end if;
  -- Verify projected content against this exact source snapshot, never two
  -- moving live queries. An unexpected local change fails without publishing.
  if (select count(*) from vppsone.fees_bridge_students)<>(v_counts->>'students')::int
    or (select count(*) from vppsone.fees_bridge_classes)<>(v_counts->>'classes')::int
    or (select count(*) from vppsone.fees_bridge_sessions)<>(v_counts->>'sessions')::int
    or (select count(*) from vppsone.fees_bridge_households)<>(v_counts->>'households')::int
    or exists(select 1 from jsonb_array_elements(p_snapshot->'students') j
      left join vppsone.fees_bridge_students b on b.id=(j->>'id')::uuid
      where to_jsonb(b) is distinct from to_jsonb(jsonb_populate_record(null::vppsone.fees_bridge_students,j || jsonb_build_object('fields',j))))
    or exists(select 1 from jsonb_array_elements(p_snapshot->'classes') j
      left join vppsone.fees_bridge_classes b on b.id=(j->>'id')::uuid
      where to_jsonb(b) is distinct from to_jsonb(jsonb_populate_record(null::vppsone.fees_bridge_classes,j || jsonb_build_object('fields',j))))
    or exists(select 1 from jsonb_array_elements(p_snapshot->'sessions') j
      left join vppsone.fees_bridge_sessions b on b.id=(j->>'id')::uuid
      where to_jsonb(b) is distinct from to_jsonb(jsonb_populate_record(null::vppsone.fees_bridge_sessions,
        j || jsonb_build_object('fields',j,'is_current',coalesce((j->>'is_current')::boolean,false)))))
    or exists(select 1 from jsonb_array_elements(p_snapshot->'households') j
      left join vppsone.fees_bridge_households b on b.id=j->>'id' and b.session_label=j->>'session_label'
      where b.fields is distinct from j) then
    raise exception 'bridge_projection_verification_failed';
  end if;
  if v_replay then
    perform vppsone.bootstrap_fees_bridge_enrolments(v_id);
    return jsonb_build_object('applied',false,'replayed',true,'revision',v_revision::text,'snapshotId',v_id);
  end if;
  update vppsone.fees_bridge_state set last_revision=v_revision,snapshot_id=v_id,
    captured_at=v_captured,applied_at=clock_timestamp(),as_of_date=v_day,
    active_session_label=v_active,counts=v_counts,snapshot_sha256=p_sha256,
    last_error_code=null,last_attempt_at=clock_timestamp(),last_checked_at=clock_timestamp() where id;
  perform vppsone.bootstrap_fees_bridge_enrolments(v_id);
  insert into vppsone.fees_bridge_runs(id,revision,captured_at,as_of_date,counts,snapshot_sha256,status)
    values(v_id,v_revision,v_captured,v_day,v_counts,p_sha256,'verified');
  return jsonb_build_object('applied',true,'replayed',false,'revision',v_revision::text,'snapshotId',v_id,'counts',v_counts);
end;
$$;
revoke all on function vppsone.fees_bridge_apply_snapshot(jsonb,text) from public,anon,authenticated;
grant execute on function vppsone.fees_bridge_apply_snapshot(jsonb,text) to service_role;
comment on function vppsone.fees_bridge_apply_snapshot(jsonb,text) is
  'Service-only complete roster generation replacement, fenced and atomic. Never posts money or sends messages.';

-- Publication is a separate acceptance step. Enforce its identity and freshness
-- prerequisites in the database as well as the rollout tooling.
create function vppsone.fees_bridge_guard_publication() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.enabled and new.live_read_ready then
    if new.last_revision<=0 or new.last_error_code is not null
      or new.last_checked_at is null or new.last_checked_at<clock_timestamp()-interval '5 minutes'
      or new.as_of_date is distinct from (clock_timestamp() at time zone 'Asia/Kolkata')::date then
      -- Once published, allow error/health updates to report an outage. This
      -- check guards only the transition into publication.
      if not (old.enabled and old.live_read_ready) then raise exception 'bridge_not_ready'; end if;
    end if;
    if exists(select 1 from vppsone.fees_bridge_classes where vppsone.is_test_session(session_label))
      or exists(select 1 from public.classes c join vppsone.fees_bridge_classes b using(id)
        where vppsone.is_test_session(c.session_label))
      or exists(select 1 from public.students s join public.classes c on c.id=s.class_id
        join vppsone.fees_bridge_students b on b.id=s.id where vppsone.is_test_session(c.session_label))
      or exists(select 1 from public.classes c join vppsone.fees_bridge_retired_classes b using(id)
        where vppsone.is_test_session(c.session_label))
      or exists(select 1 from public.students s join public.classes c on c.id=s.class_id
        join vppsone.fees_bridge_retired_students b on b.id=s.id where vppsone.is_test_session(c.session_label)) then
      raise exception 'bridge_test_identity_collision';
    end if;
    if not (old.enabled and old.live_read_ready) and exists(
      select 1 from vppsone.fees_bridge_students s
      where s.status in ('active','left') and not exists(select 1 from vppsone.enrolments e
        where e.student_id=s.id and e.session_label=s.session_label)) then
      raise exception 'bridge_academic_bootstrap_incomplete';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function vppsone.fees_bridge_guard_publication() from public,anon,authenticated;
create trigger fees_bridge_publication_guard before update on vppsone.fees_bridge_state
for each row execute function vppsone.fees_bridge_guard_publication();
notify pgrst,'reload schema';
commit;
