-- Attention remembers a failed attempt, not a copy of student identity.
-- Reads re-evaluate current certificate facts; GET never creates/resolves rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table vppsone.school_certificate_attention (
 student_id uuid not null,session_label text not null,
 blocker_codes text[] not null,last_seen_at timestamptz not null default now(),
 primary key(student_id,session_label),
 check(session_label ~ '^(TEST-)?[0-9]{4}-[0-9]{2}$'),
 check(cardinality(blocker_codes) between 1 and 21 and array_position(blocker_codes,null) is null),
 check(blocker_codes <@ array[
  'studentName:missing_field','studentName:invalid_date','admissionNo:missing_field','admissionNo:invalid_date',
  'classLabel:missing_field','classLabel:invalid_date','sessionLabel:missing_field','sessionLabel:invalid_date',
  'enrolledOn:missing_field','enrolledOn:invalid_date','leftOn:missing_field','leftOn:invalid_date',
  'dateOfBirth:missing_field','dateOfBirth:invalid_date','fatherName:missing_field','fatherName:invalid_date',
  'motherName:missing_field','motherName:invalid_date','identity:identity_unverified','template:template_inactive','source:source_unavailable']::text[])
);
create index school_certificate_attention_session on vppsone.school_certificate_attention(session_label,last_seen_at desc);
alter table vppsone.school_certificate_attention enable row level security;
create policy school_certificate_attention_read on vppsone.school_certificate_attention for select to authenticated
 using ((select vppsone.staff_can('certificates:view')) and (select vppsone.reads_every_class())
   and vppsone.school_office_session_visible(session_label));
revoke all on vppsone.school_certificate_attention from public,anon,authenticated;
grant select on vppsone.school_certificate_attention to authenticated;
grant all on vppsone.school_certificate_attention to service_role;

create function vppsone.school_certificate_attention_record(p_actor uuid,p_student uuid,p_session text,p_blockers text[],p_confined boolean default false)
returns void language plpgsql set search_path='' as $$
declare normalized text[];
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined)
  or not vppsone.school_office_actor_allowed(p_actor,'certificates:view',p_session,p_confined) then raise exception 'office:forbidden'; end if;
 select array_agg(distinct x order by x) into normalized from unnest(p_blockers) x;
 insert into vppsone.school_certificate_attention(student_id,session_label,blocker_codes)
 values(p_student,p_session,normalized)
 on conflict(student_id,session_label) do update set blocker_codes=excluded.blocker_codes,last_seen_at=now();
end;
$$;
revoke all on function vppsone.school_certificate_attention_record(uuid,uuid,text,text[],boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_attention_record(uuid,uuid,text,text[],boolean) to service_role;

create function vppsone.school_certificate_attention_clear(p_actor uuid,p_student uuid,p_session text,p_confined boolean default false)
returns void language plpgsql set search_path='' as $$
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined)
  or not vppsone.school_office_actor_allowed(p_actor,'certificates:view',p_session,p_confined) then raise exception 'office:forbidden'; end if;
 delete from vppsone.school_certificate_attention where student_id=p_student and session_label=p_session;
end;
$$;
revoke all on function vppsone.school_certificate_attention_clear(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_attention_clear(uuid,uuid,text,boolean) to service_role;

create index school_return_import_attention on vppsone.school_return_batches(session_label,(coalesce(parent_batch_id,id)),created_at desc,id desc) where direction='import';

-- Service-only, actor-checked, bounded projection. Per-student facts are joined
-- in one query, rather than one source/client request for every logged child.
create function vppsone.school_office_attention(p_actor uuid,p_session text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare certificates boolean; government boolean; t jsonb; candidates jsonb:='[]'; artifacts jsonb:='[]'; batches jsonb:='[]'; unavailable boolean:=false;
begin
 certificates:=vppsone.school_office_actor_allowed(p_actor,'certificates:view',p_session,p_confined);
 government:=vppsone.school_office_actor_allowed(p_actor,'government:view',p_session,p_confined);
 if p_session is null or p_session !~ '^(TEST-)?[0-9]{4}-[0-9]{2}$' or not(certificates or government) then raise exception 'office:forbidden'; end if;
 if certificates then
  select template||jsonb_build_object('active',active) into t from vppsone.school_certificate_templates order by version desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into artifacts from (
   select id,student_id,student_name,session_label,artifact_state from vppsone.school_certificate_issues
   where session_label=p_session and status in('prepared','issued') and artifact_state in('preparing','failed')
   order by issued_at desc,id desc limit 4
  ) x;
  if exists(select 1 from vppsone.school_certificate_attention where session_label=p_session) then
   if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled
    and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then
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
      -- Skip resolved logs before limiting the response, so old corrected
      -- records cannot crowd an unresolved student out of the card.
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
  -- State filtering deliberately happens AFTER newest-per-parent selection.
  -- An older conflicted preview cannot survive a newer applied import.
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
$$;
revoke all on function vppsone.school_office_attention(uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_office_attention(uuid,text,boolean) to service_role;

commit;
