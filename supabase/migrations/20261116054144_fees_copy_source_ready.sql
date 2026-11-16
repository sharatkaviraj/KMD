-- One's office checks read One's own copy once the Fees link is off (D-648).
--
-- Six functions asked whether the Fees link (vppsone.fees_bridge_state) was on
-- and fresh before they would answer for a real year, and refused otherwise:
-- the government-returns roster, the certificate roster and facts, the
-- office's attention list, the board-results source and the return-batch
-- reserve. With the link off, the identity views (fees_identity_students,
-- fees_identity_classes) already read One's own `public` tables, which the
-- night's copy (vppsone.fees_copy_nightly) keeps in line with Fees. So the
-- question those six ask becomes: is that copy recent?
--
--   * vppsone.fees_source_is_bridge(session): a real year read through the
--     Fees link (the link is on). A practice year never is.
--   * vppsone.fees_source_ready(session): may One answer for this year now?
--     A practice year always. Through the link: the link's own rule, unchanged
--     (ready, no error, checked in the last 26 hours). Without it: a copy
--     applied in the last 50 hours, so one failed night does not stop the
--     office and a copy that has stopped for two nights does.
--   * vppsone.fees_source_revision(session): what the roster's sourceRevision
--     is. Through the link: the link's revision, unchanged. Otherwise the same
--     fingerprint a practice year has always had (every active child, class
--     and enrolment, by id and last change), as 'test:…' for a practice year
--     and 'copy:…' for a real one. It moves only when a row moves, so an
--     export prepared before a quiet night still goes through after it.
--
-- Each function below is its live body with only the bridge question swapped
-- for these helpers; everything else is byte-for-byte the body it replaces.
-- While the link is on, all six answer exactly as before. When One becomes
-- the ledger and the copy stops, fees_source_ready is the one place to change.

create or replace function vppsone.fees_source_is_bridge(p_session text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select not coalesce(vppsone.is_test_session(p_session), false)
     and coalesce((select b.enabled from vppsone.fees_bridge_state b where b.id), false)
$fn$;

create or replace function vppsone.fees_source_ready(p_session text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(vppsone.is_test_session(p_session), false)
      or case when vppsone.fees_source_is_bridge(p_session)
           then exists(select 1 from vppsone.fees_bridge_state b
                        where b.id and b.enabled and b.live_read_ready and b.last_error_code is null
                          and b.last_checked_at >= pg_catalog.clock_timestamp() - interval '26 hours')
           else exists(select 1 from vppsone.fees_copy_runs r
                        where r.mode = 'apply' and r.status = 'applied'
                          and r.finished_at >= pg_catalog.clock_timestamp() - interval '50 hours')
         end
$fn$;

create or replace function vppsone.fees_source_revision(p_session text)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when vppsone.fees_source_is_bridge(p_session)
    then (select b.last_revision::text from vppsone.fees_bridge_state b where b.id)
    else case when coalesce(vppsone.is_test_session(p_session), false) then 'test:' else 'copy:' end
      || pg_catalog.md5(coalesce((
           select pg_catalog.string_agg(s.id::text || coalesce(s.updated_at::text, '') || coalesce(c.updated_at::text, '')
                    || coalesce(e.updated_at::text, ''), ',' order by s.id)
             from vppsone.fees_identity_students s
             join vppsone.fees_identity_classes c on c.id = s.class_id
             left join vppsone.enrolments e on e.student_id = s.id and e.class_id = c.id and e.session_label = p_session
            where c.session_label = p_session and s.status::text = 'active'), ''))
  end
$fn$;

revoke all on function vppsone.fees_source_is_bridge(text) from public, anon, authenticated;
revoke all on function vppsone.fees_source_ready(text) from public, anon, authenticated;
revoke all on function vppsone.fees_source_revision(text) from public, anon, authenticated;
grant execute on function vppsone.fees_source_is_bridge(text) to service_role;
grant execute on function vppsone.fees_source_ready(text) to service_role;
grant execute on function vppsone.fees_source_revision(text) to service_role;

comment on function vppsone.fees_source_ready(text) is
  'May One answer for this year now (D-648)? A practice year always; through the Fees link, the link''s own 26-hour rule; without it, a copy applied in the last 50 hours.';
comment on function vppsone.fees_source_revision(text) is
  'The roster''s sourceRevision (D-648): the Fees link''s revision while it is on, otherwise a fingerprint of the year''s active children, classes and enrolments (test:… / copy:…).';

create or replace function vppsone.school_office_roster(p_actor uuid, p_session text, p_permission text, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare result jsonb; source_revision text;
begin
 if p_permission not in('government:view','government:export','government:import','outcomes:view','outcomes:manage')
  or not vppsone.school_office_actor_allowed(p_actor,p_permission,p_session,p_confined)
  or not exists(select 1 from vppsone.staff_profiles where id=p_actor and role in('admin','office','academic_coordinator','exam_coordinator')) then raise exception 'office:forbidden'; end if;
 if not vppsone.fees_source_ready(p_session) then raise exception 'office:source_unavailable'; end if;
 source_revision:=vppsone.fees_source_revision(p_session);
 select coalesce(jsonb_agg(jsonb_build_object('studentId',s.id,'studentName',s.full_name,'admissionNo',coalesce(s.admission_no,''),
   'classLabel',concat_ws(' ',c.class_name,nullif(c.section,'')),'classId',c.id,'sessionLabel',p_session,'schoolCode','',
   'externalId','','registrationStatus','','sourceRevision',source_revision,'externalRevision',0,
   'identityVerified',exists(select 1 from vppsone.enrolments e where e.student_id=s.id and e.class_id=c.id and e.session_label=p_session and e.status='enrolled' and e.left_on is null)) order by c.sort_order,s.full_name),'[]'::jsonb)
 into result from vppsone.fees_identity_students s join vppsone.fees_identity_classes c on c.id=s.class_id
 where c.session_label=p_session and s.status::text='active';
 if jsonb_array_length(result)>2000 then raise exception 'office:roster_limit'; end if;
 return result;
end;
$fn$;

create or replace function vppsone.school_certificate_roster(p_actor uuid, p_session text, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if not vppsone.fees_source_ready(p_session) then raise exception 'certificate:source_unavailable'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('studentId',s.id,'studentName',s.full_name,'admissionNo',s.admission_no,'classId',c.id,
     'classLabel',concat_ws(' ',c.class_name,nullif(c.section,''))) order by c.class_name,c.section,s.full_name)
   from vppsone.enrolments e
   join vppsone.fees_identity_students s on s.id=e.student_id
   join vppsone.fees_identity_classes c on c.id=e.class_id and c.session_label=p_session
   where e.session_label=p_session and e.status::text='enrolled' and e.left_on is null),'[]'::jsonb);
end;
$fn$;

create or replace function vppsone.school_certificate_facts_v2(p_actor uuid, p_student uuid, p_session text, p_kind text, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare e vppsone.enrolments; s jsonb; c jsonb; t jsonb; current_record boolean; verified boolean; mentioned text;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_kind not in ('study','character','dob','tc') then raise exception 'certificate:invalid_kind'; end if;
 if not vppsone.fees_source_ready(p_session) then raise exception 'certificate:source_unavailable'; end if;
 select * into e from vppsone.enrolments where student_id=p_student and session_label=p_session order by created_at desc limit 1;
 select to_jsonb(x) into s from vppsone.fees_identity_students x where x.id=p_student limit 1;
 select to_jsonb(x) into c from vppsone.fees_identity_classes x where x.id=e.class_id and x.session_label=p_session;
 select template into t from vppsone.school_certificate_templates where active and kind=p_kind;
 current_record:=coalesce(e.status::text='enrolled' and e.left_on is null and s->>'status'='active' and (s->>'class_id')::uuid=e.class_id,false);
 verified:=e.id is not null and s is not null and c is not null and (current_record or (e.enrolled_on is not null and e.left_on is not null and e.left_on>=e.enrolled_on));
 mentioned:=coalesce(t::text,'');
 return jsonb_build_object('studentId',p_student,'enrolmentId',coalesce(e.id,'00000000-0000-0000-0000-000000000000'::uuid),
   'classId',coalesce(e.class_id,'00000000-0000-0000-0000-000000000000'::uuid),'studentName',coalesce(s->>'full_name',''),
   'admissionNo',coalesce(s->>'admission_no',''),'classLabel',concat_ws(' ',c->>'class_name',nullif(c->>'section','')),
   'sessionLabel',p_session,'status',case when current_record then 'current' else 'historical' end,
   'enrolledOn',e.enrolled_on,'leftOn',e.left_on,
   'admittedOn',case when position('admittedOn' in mentioned)>0 then s->>'joined_on' end,
   'dateOfBirth',case when position('dateOfBirth' in mentioned)>0 then s->>'date_of_birth' end,
   'fatherName',case when position('fatherName' in mentioned)>0 then s->>'father_name' end,
   'motherName',case when position('motherName' in mentioned)>0 then s->>'mother_name' end,
   'gender',case when position('{sonDaughter}' in mentioned)+position('{heShe}' in mentioned)+position('{himHer}' in mentioned)+position('{hisHer}' in mentioned)+position('{putraPutri}' in mentioned)>0 then s->>'gender' end,
   'identityVerified',verified,'sourceCurrent',s is not null and c is not null,
   'sourceRevision',case when vppsone.fees_source_is_bridge(p_session) then coalesce((select last_revision::text from vppsone.fees_bridge_state where id),'unknown') else coalesce(s->>'updated_at',case when vppsone.is_test_session(p_session) then 'test' else 'copy' end) end,
   'checkedAt',clock_timestamp());
end;
$fn$;

create or replace function vppsone.school_office_attention(p_actor uuid, p_session text, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare certificates boolean; government boolean; t jsonb; candidates jsonb:='[]'; artifacts jsonb:='[]'; batches jsonb:='[]'; unavailable boolean:=false;
begin
 certificates:=vppsone.school_office_actor_allowed(p_actor,'certificates:view',p_session,p_confined);
 government:=vppsone.school_office_actor_allowed(p_actor,'government:view',p_session,p_confined);
 if p_session is null or p_session !~ '^(TEST-)?[0-9]{4}-[0-9]{2}$' or not(certificates or government) then raise exception 'office:forbidden'; end if;
 if certificates then
  select template||jsonb_build_object('active',active) into t from vppsone.school_certificate_templates where kind='study' order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into artifacts from (
   select id,student_id,student_name,session_label,artifact_state from vppsone.school_certificate_issues
   where session_label=p_session and status in('prepared','issued') and artifact_state in('preparing','failed')
   order by issued_at desc,id desc limit 4
  ) x;
  if exists(select 1 from vppsone.school_certificate_attention where session_label=p_session) then
   if not vppsone.fees_source_ready(p_session) then
    unavailable:=true;
   else
    begin
     with logged as materialized (
      select student_id,blocker_codes,last_seen_at from vppsone.school_certificate_attention where session_label=p_session
      order by last_seen_at desc,student_id limit 1000
     ), records as (
      select l.*,e.id enrolment_id,e.class_id,e.enrolled_on,e.left_on,s.id source_id,s.full_name,s.admission_no,
       s.date_of_birth,s.father_name,s.mother_name,c.id source_class_id,concat_ws(' ',c.class_name,nullif(c.section,'')) class_label,
       coalesce(e.status::text='enrolled' and e.left_on is null and s.status::text='active' and s.class_id=e.class_id,false) current_record
      from logged l
      left join lateral(select * from vppsone.enrolments e where e.student_id=l.student_id and e.session_label=p_session order by e.created_at desc,e.id desc limit 1) e on true
      left join vppsone.fees_identity_students s on s.id=l.student_id and exists(
       select 1 from vppsone.fees_identity_classes scope where scope.id=s.class_id
        and vppsone.is_test_session(scope.session_label)=vppsone.is_test_session(p_session))
      left join vppsone.fees_identity_classes c on c.id=e.class_id and c.session_label=p_session
     ), facts as (
      select r.*,
       coalesce((t->'requiredFields')::text,'')||' '||
        case when t->>'language' in('en','both') then coalesce(t->>(case when current_record then 'bodyEn' else 'historicalBodyEn' end),'') else '' end||' '||
        case when t->>'language' in('hi','both') then coalesce(t->>(case when current_record then 'bodyHi' else 'historicalBodyHi' end),'') else '' end optional_text
      from records r
     ), snapshots as (
      select student_id,blocker_codes,last_seen_at,optional_text,
       jsonb_build_object('studentId',student_id,'enrolmentId',coalesce(enrolment_id,'00000000-0000-0000-0000-000000000000'::uuid),
       'classId',coalesce(class_id,'00000000-0000-0000-0000-000000000000'::uuid),'studentName',coalesce(full_name,''),'admissionNo',coalesce(admission_no,''),
       'classLabel',class_label,'sessionLabel',p_session,'status',case when current_record then 'current' else 'historical' end,
       'enrolledOn',enrolled_on,'leftOn',left_on,'dateOfBirth',case when position('dateOfBirth' in optional_text)>0 then date_of_birth end,
       'fatherName',case when position('fatherName' in optional_text)>0 then father_name end,'motherName',case when position('motherName' in optional_text)>0 then mother_name end,
       'identityVerified',enrolment_id is not null and source_id is not null and source_class_id is not null
        and (current_record or (enrolled_on is not null and left_on is not null and left_on>=enrolled_on)),
       'sourceCurrent',source_id is not null and source_class_id is not null,'sourceRevision','attention-current','checkedAt',clock_timestamp()) facts
      from facts
     )
     select coalesce(jsonb_agg(jsonb_build_object('student_id',student_id,'blocker_codes',blocker_codes,'facts',facts)),'[]'::jsonb)
     into candidates from (
      select * from snapshots f where f.facts->>'sourceCurrent'='false' or exists(
       select 1 from unnest(f.blocker_codes) code where
        (code='identity:identity_unverified' and f.facts->>'identityVerified'='false')
        or (code='template:template_inactive' and t->>'active'='false')
        or (split_part(code,':',2)='missing_field'
         and ((t->'requiredFields') ? split_part(code,':',1) or position('{'||split_part(code,':',1)||'}' in f.optional_text)>0)
         and nullif(btrim(f.facts->>split_part(code,':',1)),'') is null)
      ) order by last_seen_at desc,student_id limit 8
     ) current_candidates;
    exception when others then unavailable:=true; candidates:='[]'; end;
   end if;
  end if;
 end if;
 if government then
  with latest_imports as materialized (
   select distinct on(coalesce(parent_batch_id,id)) id,parent_batch_id,direction,state,created_at,session_label,payload
   from vppsone.school_return_batches where session_label=p_session and direction='import'
   order by coalesce(parent_batch_id,id),created_at desc,id desc
  ), actionable as (
   select id,parent_batch_id,direction,state,created_at,session_label,
    exists(select 1 from jsonb_array_elements(coalesce(payload->'preview','[]'::jsonb)) r where r->>'state' in('conflict','unmatched')) has_conflicts
   from latest_imports where state in('preparing','staged')
   union all
   select id,parent_batch_id,direction,state,created_at,session_label,false from vppsone.school_return_batches
   where session_label=p_session and direction='export' and state='preparing'
  )
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into batches from (
   select * from actionable where state='preparing' or has_conflicts order by created_at desc,id desc limit 8
  ) x;
 end if;
 return jsonb_build_object('template',t,'certificate_candidates',candidates,'certificate_artifacts',artifacts,
  'return_batches',batches,'certificate_unavailable',unavailable);
end;
$fn$;

create or replace function vppsone.school_board_source(p_actor uuid, p_session text, p_permission text, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare roster jsonb; source_revision text;
begin
 if p_permission not in('outcomes:view','outcomes:manage') then raise exception 'board:forbidden'; end if;
 roster:=vppsone.school_office_roster(p_actor,p_session,p_permission,p_confined);
 source_revision:=roster->0->>'sourceRevision';
 if source_revision is null then
  source_revision:=vppsone.fees_source_revision(p_session);
 end if;
 if source_revision is null or source_revision='' then raise exception 'board:source_unavailable'; end if;
 return jsonb_build_object('roster',roster,'sourceRevision',source_revision);
end;
$fn$;

create or replace function vppsone.school_return_reserve(p_actor uuid, p_id uuid, p_request_hash text, p_adapter jsonb, p_payload jsonb, p_direction text, p_source_hash text DEFAULT NULL::text, p_parent uuid DEFAULT NULL::uuid, p_confined boolean DEFAULT false)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare prior vppsone.school_return_batches; permission text; entry jsonb; source_revision text; roster jsonb;
begin
 permission:=case when p_direction='export' then 'government:export' else 'government:import' end;
 if not vppsone.school_office_actor_allowed(p_actor,permission,p_adapter->>'sessionLabel',p_confined) then raise exception 'office:forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-return:'||p_id::text,0));
 select * into prior from vppsone.school_return_batches where id=p_id;
 if found then
   if prior.actor_id<>p_actor or prior.request_hash<>p_request_hash then raise exception 'office:command_reused'; end if;
   return to_jsonb(prior);
 end if;
 if p_direction not in('export','import') or p_request_hash !~ '^[a-f0-9]{64}$' or p_adapter->>'portal' not in('psp','udise','class5','class8','rbse10','rbse12') then raise exception 'office:invalid'; end if;
 if p_adapter->>'mode'='verified_upload' then
   if not exists(select 1 from vppsone.school_return_adapters where adapter=p_adapter) then raise exception 'office:unverified_adapter'; end if;
 elsif p_direction='import' or p_adapter->>'mode'<>'manual_reference' then raise exception 'office:unverified_adapter'; end if;
 roster:=vppsone.school_office_roster(p_actor,p_adapter->>'sessionLabel',permission,p_confined);
 source_revision:=coalesce(roster->0->>'sourceRevision',vppsone.fees_source_revision(p_adapter->>'sessionLabel'));
 if p_payload->>'sourceRevision' is distinct from source_revision then raise exception 'office:source_changed'; end if;
 if p_direction='export' then
   if jsonb_array_length(p_payload->'rows') not between 1 and 2000 then raise exception 'office:invalid_rows'; end if;
   for entry in select * from jsonb_array_elements(p_payload->'rows') loop
     if not exists(select 1 from jsonb_array_elements(roster) r where r->>'studentId'=entry->>'studentId' and r->>'identityVerified'='true'
       and r->>'studentName'=entry->>'studentName' and r->>'admissionNo'=entry->>'admissionNo' and r->>'classLabel'=entry->>'classLabel') then raise exception 'office:roster_changed'; end if;
   end loop;
 else
   if p_source_hash !~ '^[a-f0-9]{64}$' or jsonb_array_length(p_payload->'preview') not between 1 and 2000 then raise exception 'office:invalid_import'; end if;
 end if;
 if p_parent is not null and not exists(select 1 from vppsone.school_return_batches b where b.id=p_parent and b.session_label=p_adapter->>'sessionLabel' and b.portal=p_adapter->>'portal' and b.module=p_adapter->>'module') then raise exception 'office:wrong_parent'; end if;
 insert into vppsone.school_return_batches(id,session_label,portal,module,direction,state,actor_id,request_hash,adapter,payload,source_hash,parent_batch_id)
 values(p_id,p_adapter->>'sessionLabel',p_adapter->>'portal',p_adapter->>'module',p_direction,'preparing',p_actor,p_request_hash,p_adapter,p_payload,p_source_hash,p_parent) returning * into prior;
 insert into vppsone.school_return_events(batch_id,actor_id,kind) values(p_id,p_actor,case when p_direction='export' then 'prepared' else 'import_staged' end);
 return to_jsonb(prior);
end;
$fn$;
