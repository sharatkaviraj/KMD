-- One-owned examination administration; no financial or internal-mark writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table vppsone.school_board_cycles (
 id uuid primary key, session_label text not null, config jsonb not null, revision integer not null default 1 check(revision>0),
 updated_by uuid not null references vppsone.staff_profiles(id),updated_at timestamptz not null default now(),
 check(config->>'sessionLabel'=session_label), check(config->>'authority' in('class5','class8','rbse10','rbse12')),
 check(config->>'attempt' in('main','supplementary','improvement','corrected'))
);
create index school_board_cycles_session on vppsone.school_board_cycles(session_label,updated_at desc);
create table vppsone.school_board_candidates (
 cycle_id uuid not null references vppsone.school_board_cycles(id),student_id uuid not null, registration text not null,roll text not null,
 subjects jsonb not null,verified boolean not null,student_snapshot jsonb,source_reference text not null,revision integer not null check(revision>0),
 verified_by uuid not null references vppsone.staff_profiles(id),verified_at timestamptz not null default now(),primary key(cycle_id,student_id),
 check(length(registration) between 1 and 100),check(length(roll) between 1 and 100),check(length(source_reference) between 10 and 1000),
 check(not verified or (student_snapshot is not null and student_snapshot->>'studentId'=student_id::text and student_snapshot->>'identityVerified'='true' and student_snapshot->>'enrolmentStatus'='enrolled'))
);
create unique index school_board_candidate_roll on vppsone.school_board_candidates(cycle_id,upper(regexp_replace(roll,'\s','','g')));
create unique index school_board_candidate_registration on vppsone.school_board_candidates(cycle_id,upper(regexp_replace(registration,'\s','','g')));
create table vppsone.school_board_readiness (
 cycle_id uuid not null references vppsone.school_board_cycles(id),student_id uuid not null,key text not null,status text not null,
 reference text not null,revision integer not null check(revision>0),cycle_revision integer not null check(cycle_revision>0),updated_by uuid not null references vppsone.staff_profiles(id),updated_at timestamptz not null default now(),
 primary key(cycle_id,student_id,key),check(status in('missing','present','checked','submitted','accepted','rejected')),
 check(status='missing' or length(reference)>=3)
);
create table vppsone.school_official_results (
 id uuid primary key default gen_random_uuid(),cycle_id uuid not null references vppsone.school_board_cycles(id), student_id uuid not null,
 subject_code text not null,revision integer not null check(revision>0),supersedes uuid references vppsone.school_official_results(id),
 status text not null check(status in('pending','available','withheld','absent','cancelled')),raw_value text,raw_status text not null,
 appearance text not null check(appearance in('appeared','not_appeared','unknown')),source_reference text not null,
 verified_by uuid not null references vppsone.staff_profiles(id),verified_at timestamptz not null default now(),
 candidate_revision integer not null,cycle_revision integer not null,evidence_path text,evidence_sha256 text,evidence_type text,
 unique(cycle_id,student_id,subject_code,revision),unique(supersedes),
 check(length(source_reference) between 10 and 1000),check(length(raw_status) between 1 and 250),
 check(raw_value is null or length(raw_value) between 1 and 250),check(status not in('pending','withheld') or raw_value is null),check(status<>'available' or raw_value is not null),
 check((evidence_path is null and evidence_sha256 is null and evidence_type is null) or (evidence_path is not null and evidence_sha256 ~ '^[a-f0-9]{64}$' and evidence_type in('application/pdf','image/png','image/jpeg')))
);
create index school_official_results_cycle on vppsone.school_official_results(cycle_id,student_id,subject_code,revision desc);
create table vppsone.school_board_commands (
 id uuid primary key,cycle_id uuid not null references vppsone.school_board_cycles(id),actor_id uuid not null references vppsone.staff_profiles(id),
 kind text not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),payload jsonb not null,receipt jsonb not null,created_at timestamptz not null default now()
);
create index school_board_commands_cycle on vppsone.school_board_commands(cycle_id,created_at desc);

alter table vppsone.school_board_cycles enable row level security;
alter table vppsone.school_board_candidates enable row level security;
alter table vppsone.school_board_readiness enable row level security;
alter table vppsone.school_official_results enable row level security;
alter table vppsone.school_board_commands enable row level security;
create policy school_board_cycles_read on vppsone.school_board_cycles for select to authenticated using((select vppsone.staff_can('outcomes:view')) and (select vppsone.reads_every_class()) and vppsone.school_office_session_visible(session_label));
create policy school_board_candidates_read on vppsone.school_board_candidates for select to authenticated using(exists(select 1 from vppsone.school_board_cycles c where c.id=cycle_id));
create policy school_board_readiness_read on vppsone.school_board_readiness for select to authenticated using(exists(select 1 from vppsone.school_board_cycles c where c.id=cycle_id));
create policy school_official_results_read on vppsone.school_official_results for select to authenticated using(exists(select 1 from vppsone.school_board_cycles c where c.id=cycle_id));
create policy school_board_commands_read on vppsone.school_board_commands for select to authenticated using(exists(select 1 from vppsone.school_board_cycles c where c.id=cycle_id));
revoke all on vppsone.school_board_cycles,vppsone.school_board_candidates,vppsone.school_board_readiness,vppsone.school_official_results,vppsone.school_board_commands from public,anon,authenticated;
grant select on vppsone.school_board_cycles,vppsone.school_board_candidates,vppsone.school_board_readiness,vppsone.school_official_results,vppsone.school_board_commands to authenticated;
grant all on vppsone.school_board_cycles,vppsone.school_board_candidates,vppsone.school_board_readiness,vppsone.school_official_results,vppsone.school_board_commands to service_role;

create function vppsone.school_board_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'board:immutable'; end; $$;
revoke all on function vppsone.school_board_immutable() from public,anon,authenticated;
create trigger school_official_results_immutable before update or delete on vppsone.school_official_results for each row execute function vppsone.school_board_immutable();
create trigger school_board_commands_immutable before update or delete on vppsone.school_board_commands for each row execute function vppsone.school_board_immutable();

create function vppsone.school_board_candidate_snapshot_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'board:snapshot_immutable'; end if;
 if old.student_snapshot is not null and new.student_snapshot is distinct from old.student_snapshot then raise exception 'board:snapshot_immutable'; end if;
 return new;
end; $$;
revoke all on function vppsone.school_board_candidate_snapshot_immutable() from public,anon,authenticated;
create trigger school_board_candidate_snapshot_immutable before update or delete on vppsone.school_board_candidates for each row execute function vppsone.school_board_candidate_snapshot_immutable();

-- The roster is still the canonical freshness gate. An empty roster needs its
-- current revision too, so departed registrations never reuse a stale snapshot fence.
create function vppsone.school_board_source(p_actor uuid,p_session text,p_permission text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare roster jsonb; source_revision text;
begin
 if p_permission not in('outcomes:view','outcomes:manage') then raise exception 'board:forbidden'; end if;
 roster:=vppsone.school_office_roster(p_actor,p_session,p_permission,p_confined);
 source_revision:=roster->0->>'sourceRevision';
 if source_revision is null then
  source_revision:=case when vppsone.is_test_session(p_session) then 'test:'||md5('') else (select last_revision::text from vppsone.fees_bridge_state where id) end;
 end if;
 if source_revision is null or source_revision='' then raise exception 'board:source_unavailable'; end if;
 return jsonb_build_object('roster',roster,'sourceRevision',source_revision);
end; $$;
revoke all on function vppsone.school_board_source(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_board_source(uuid,text,text,boolean) to service_role;

-- Only service calls may write, after checking the real actor and current scope.
create function vppsone.school_board_command(p_actor uuid,p_command uuid,p_cycle uuid,p_kind text,p_payload jsonb,p_hash text,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare c vppsone.school_board_cycles; prior vppsone.school_board_commands; candidate vppsone.school_board_candidates;
 result_row vppsone.school_official_results; cfg jsonb; roster jsonb; source jsonb; pupil jsonb; snapshot jsonb; item jsonb; old_revision integer; receipt jsonb; student uuid; session_label text;
begin
 if p_kind not in('cycle','candidate','readiness','result') or p_hash !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text)>50000 then raise exception 'board:invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-board-command:'||p_command::text,0));
 perform pg_advisory_xact_lock(hashtextextended('school-board-cycle:'||p_cycle::text,0));
 select * into c from vppsone.school_board_cycles where id=p_cycle for update;
 session_label:=case when p_kind='cycle' then p_payload->'config'->>'sessionLabel' else c.session_label end;
 if session_label is null or not vppsone.school_office_actor_allowed(p_actor,'outcomes:manage',session_label,p_confined) then raise exception 'board:forbidden'; end if;
 select * into prior from vppsone.school_board_commands where id=p_command;
 if found then
  if prior.actor_id<>p_actor or prior.cycle_id<>p_cycle or prior.kind<>p_kind or prior.request_hash<>p_hash then raise exception 'board:command_reused'; end if;
  return prior.receipt;
 end if;
 source:=vppsone.school_board_source(p_actor,session_label,'outcomes:manage',p_confined);
 roster:=source->'roster';
 if p_kind='cycle' then
  cfg:=p_payload->'config';
  if coalesce(c.revision,0) is distinct from (p_payload->>'expectedRevision')::integer or (c.id is not null and c.session_label<>session_label) then raise exception 'board:stale'; end if;
  if cfg is null or not (cfg ?& array['authority','attempt','classIds','subjects','requirements','sourceReference','responsible','verifiedOn','label','attemptLabel'])
   or jsonb_typeof(cfg->'classIds')<>'array' or jsonb_typeof(cfg->'subjects')<>'array' or jsonb_typeof(cfg->'requirements')<>'array' then raise exception 'board:invalid'; end if;
  if cfg->>'authority' not in('class5','class8','rbse10','rbse12') or cfg->>'attempt' not in('main','supplementary','improvement','corrected')
   or jsonb_array_length(cfg->'classIds') not between 1 and 100 or jsonb_array_length(cfg->'subjects') not between 1 and 80 or jsonb_array_length(cfg->'requirements')>40
   or length(cfg->>'sourceReference') not between 10 and 1000 or length(cfg->>'responsible') not between 2 and 120 or cfg->>'verifiedOn' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'board:invalid'; end if;
  if (select count(distinct s->>'code') from jsonb_array_elements(cfg->'subjects') s)<>jsonb_array_length(cfg->'subjects')
   or exists(select 1 from jsonb_array_elements(cfg->'subjects') s where coalesce(length(s->>'code'),0) not between 1 and 40 or coalesce(length(s->>'label'),0) not between 1 and 100)
   or (select count(distinct r->>'key') from jsonb_array_elements(cfg->'requirements') r)<>jsonb_array_length(cfg->'requirements') then raise exception 'board:invalid'; end if;
  for item in select value from jsonb_array_elements(cfg->'classIds') loop
   if not exists(select 1 from jsonb_array_elements(roster) r where r->>'classId'=item#>>'{}')
    and not (c.id is not null and c.config->'classIds'=cfg->'classIds') then raise exception 'board:wrong_class'; end if;
  end loop;
  if exists(select 1 from vppsone.school_board_candidates where cycle_id=p_cycle) and
    (c.config->'classIds'<>cfg->'classIds' or c.config->'subjects'<>cfg->'subjects' or c.config->>'authority'<>cfg->>'authority' or c.config->>'attempt'<>cfg->>'attempt' or c.config->>'attemptLabel'<>cfg->>'attemptLabel') then raise exception 'board:scope_frozen'; end if;
  insert into vppsone.school_board_cycles(id,session_label,config,revision,updated_by) values(p_cycle,session_label,cfg,1,p_actor)
   on conflict(id) do update set config=excluded.config,revision=school_board_cycles.revision+1,updated_by=p_actor,updated_at=now() returning to_jsonb(school_board_cycles) into receipt;
 else
  if c.id is null or c.revision is distinct from (p_payload->>'cycleRevision')::integer then raise exception 'board:stale'; end if;
  student:=(p_payload->>'studentId')::uuid;
  if source->>'sourceRevision' is distinct from p_payload->>'expectedSource' then raise exception 'board:source_changed'; end if;
  select * into candidate from vppsone.school_board_candidates where cycle_id=p_cycle and student_id=student for update;
  select value into pupil from jsonb_array_elements(roster) where value->>'studentId'=student::text;
  if p_kind in('readiness','result') and candidate.verified and candidate.student_snapshot is not null
   and candidate.student_snapshot->>'studentId'=student::text and candidate.student_snapshot->>'sessionLabel'=session_label
   and candidate.student_snapshot->>'identityVerified'='true' and candidate.student_snapshot->>'enrolmentStatus'='enrolled'
   and c.config->'classIds' ? (candidate.student_snapshot->>'classId') then pupil:=candidate.student_snapshot; end if;
  if pupil is null or not coalesce((pupil->>'identityVerified')::boolean,false) or not (c.config->'classIds' ? (pupil->>'classId')) then raise exception 'board:identity'; end if;
  if p_kind='candidate' then
   if coalesce(candidate.revision,0) is distinct from (p_payload->>'expectedRevision')::integer then raise exception 'board:stale'; end if;
   if jsonb_typeof(p_payload->'subjects') is distinct from 'array' then raise exception 'board:invalid'; end if;
   if jsonb_array_length(p_payload->'subjects') not between 1 and 80 or length(p_payload->>'sourceReference') not between 10 and 1000
    or (select count(distinct value) from jsonb_array_elements(p_payload->'subjects'))<>jsonb_array_length(p_payload->'subjects') then raise exception 'board:invalid'; end if;
   for item in select value from jsonb_array_elements(p_payload->'subjects') loop
    if not exists(select 1 from jsonb_array_elements(c.config->'subjects') s where s->>'code'=item#>>'{}') then raise exception 'board:subject'; end if;
   end loop;
   if exists(select 1 from vppsone.school_official_results where cycle_id=p_cycle and student_id=student) and
    (candidate.subjects<>p_payload->'subjects' or candidate.registration<>p_payload->>'registration' or candidate.roll<>p_payload->>'roll' or not (p_payload->>'verified')::boolean) then raise exception 'board:registration_frozen'; end if;
   snapshot:=case when (p_payload->>'verified')::boolean then jsonb_build_object('studentId',pupil->>'studentId','studentName',pupil->>'studentName','admissionNo',pupil->>'admissionNo','classId',pupil->>'classId','classLabel',pupil->>'classLabel','sessionLabel',session_label,'identityVerified',true,'enrolmentStatus','enrolled','sourceRevision',source->>'sourceRevision') else null end;
   insert into vppsone.school_board_candidates(cycle_id,student_id,registration,roll,subjects,verified,student_snapshot,source_reference,revision,verified_by)
    values(p_cycle,student,p_payload->>'registration',p_payload->>'roll',p_payload->'subjects',(p_payload->>'verified')::boolean,snapshot,p_payload->>'sourceReference',coalesce(candidate.revision,0)+1,p_actor)
    on conflict(cycle_id,student_id) do update set registration=excluded.registration,roll=excluded.roll,subjects=excluded.subjects,verified=excluded.verified,student_snapshot=coalesce(school_board_candidates.student_snapshot,excluded.student_snapshot),source_reference=excluded.source_reference,revision=excluded.revision,verified_by=p_actor,verified_at=now()
    returning to_jsonb(school_board_candidates) into receipt;
  elsif p_kind='readiness' then
   if not exists(select 1 from jsonb_array_elements(c.config->'requirements') r where r->>'key'=p_payload->>'key') then raise exception 'board:requirement'; end if;
   select revision into old_revision from vppsone.school_board_readiness where cycle_id=p_cycle and student_id=student and key=p_payload->>'key' for update;
   if coalesce(old_revision,0) is distinct from (p_payload->>'expectedRevision')::integer then raise exception 'board:stale'; end if;
   insert into vppsone.school_board_readiness(cycle_id,student_id,key,status,reference,revision,cycle_revision,updated_by)
    values(p_cycle,student,p_payload->>'key',p_payload->>'status',p_payload->>'reference',coalesce(old_revision,0)+1,c.revision,p_actor)
    on conflict(cycle_id,student_id,key) do update set status=excluded.status,reference=excluded.reference,revision=excluded.revision,cycle_revision=excluded.cycle_revision,updated_by=p_actor,updated_at=now()
    returning to_jsonb(school_board_readiness) into receipt;
  else
   select * into candidate from vppsone.school_board_candidates where cycle_id=p_cycle and student_id=student for update;
   if candidate.student_id is null or not candidate.verified or candidate.revision is distinct from (p_payload->>'candidateRevision')::integer or not(candidate.subjects ? (p_payload->>'subjectCode')) then raise exception 'board:registration'; end if;
   select * into result_row from vppsone.school_official_results where cycle_id=p_cycle and student_id=student and subject_code=p_payload->>'subjectCode' order by revision desc limit 1;
   if coalesce(result_row.revision,0) is distinct from (p_payload->>'expectedRevision')::integer then raise exception 'board:stale'; end if;
   if p_payload->'evidence' is not null and p_payload->'evidence'<>'null'::jsonb and (p_payload->'evidence'->>'path' not like 'board/'||p_cycle::text||'/'||p_command::text||'/%') then raise exception 'board:evidence_scope'; end if;
   insert into vppsone.school_official_results(cycle_id,student_id,subject_code,revision,supersedes,status,raw_value,raw_status,appearance,source_reference,verified_by,candidate_revision,cycle_revision,evidence_path,evidence_sha256,evidence_type)
    values(p_cycle,student,p_payload->>'subjectCode',coalesce(result_row.revision,0)+1,result_row.id,p_payload->>'status',p_payload->>'rawValue',p_payload->>'rawStatus',p_payload->>'appearance',p_payload->>'sourceReference',p_actor,candidate.revision,c.revision,p_payload->'evidence'->>'path',p_payload->'evidence'->>'hash',p_payload->'evidence'->>'type')
    returning to_jsonb(school_official_results) into receipt;
  end if;
 end if;
 insert into vppsone.school_board_commands(id,cycle_id,actor_id,kind,request_hash,payload,receipt) values(p_command,p_cycle,p_actor,p_kind,p_hash,p_payload,receipt);
 return receipt;
end; $$;
revoke all on function vppsone.school_board_command(uuid,uuid,uuid,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_board_command(uuid,uuid,uuid,text,jsonb,text,boolean) to service_role;
commit;
