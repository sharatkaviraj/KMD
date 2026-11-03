-- Versioned official-file contracts and One-owned external registration facts.
-- No source-student, financial, guardian, photo or internal-mark mutation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table vppsone.school_return_adapters (
 id uuid primary key default gen_random_uuid(),portal text not null,module text not null,session_label text not null,school_code text not null,
 version integer not null,adapter jsonb not null,approved_by uuid not null references vppsone.staff_profiles(id),created_at timestamptz not null default now(),
 unique(portal,module,session_label,school_code,version),check(adapter->>'mode'='verified_upload'),
 check(adapter->>'specimenSha256' ~ '^[a-f0-9]{64}$'),check(length(adapter->>'sourceReference')>=10)
);
alter table vppsone.school_return_adapters enable row level security;
create policy school_return_adapters_read on vppsone.school_return_adapters for select to authenticated
 using ((select vppsone.staff_can('government:view')) and (select vppsone.reads_every_class()) and vppsone.school_office_session_visible(session_label));
revoke all on vppsone.school_return_adapters from public,anon,authenticated;
grant select on vppsone.school_return_adapters to authenticated;
grant all on vppsone.school_return_adapters to service_role;

create table vppsone.school_external_records (
 id uuid primary key default gen_random_uuid(),portal text not null,module text not null,school_code text not null,session_label text not null,
 student_id uuid not null,external_id text,registration_status text,revision integer not null default 1,
 source_batch_id uuid,updated_by uuid not null references vppsone.staff_profiles(id),updated_at timestamptz not null default now(),
 unique(portal,module,school_code,session_label,student_id),check(external_id is null or length(external_id) between 1 and 250)
);
create unique index school_external_record_identity on vppsone.school_external_records(portal,module,school_code,session_label,upper(regexp_replace(external_id,'\s','','g'))) where external_id is not null;
create index school_external_records_student on vppsone.school_external_records(student_id,session_label);
alter table vppsone.school_external_records enable row level security;
create policy school_external_records_read on vppsone.school_external_records for select to authenticated
 using ((select vppsone.staff_can_any(array['government:view','outcomes:view'])) and (select vppsone.reads_every_class()) and vppsone.school_office_session_visible(session_label));
revoke all on vppsone.school_external_records from public,anon,authenticated;
grant select on vppsone.school_external_records to authenticated;
grant all on vppsone.school_external_records to service_role;

create table vppsone.school_return_batches (
 id uuid primary key,session_label text not null,portal text not null,module text not null,direction text not null check(direction in('export','import')),
 state text not null check(state in('preparing','exported','staged','applied','submitted','accepted','partially_accepted','rejected')),
 actor_id uuid not null references vppsone.staff_profiles(id),request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 adapter jsonb not null,payload jsonb not null,source_hash text,parent_batch_id uuid references vppsone.school_return_batches(id),
 file_path text,file_sha256 text,file_name text,content_type text,
 evidence_path text,evidence_sha256 text,evidence_name text,evidence_content_type text,acknowledgement text,row_outcomes jsonb not null default '[]'::jsonb,apply_command uuid unique,apply_receipt jsonb,
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(adapter->>'portal'=portal),check(adapter->>'module'=module),check(adapter->>'sessionLabel'=session_label)
);
alter table vppsone.school_external_records add constraint school_external_record_source foreign key(source_batch_id) references vppsone.school_return_batches(id);
create index school_return_batches_register on vppsone.school_return_batches(session_label,created_at desc);
alter table vppsone.school_return_batches enable row level security;
create policy school_return_batches_read on vppsone.school_return_batches for select to authenticated
 using ((select vppsone.staff_can('government:view')) and (select vppsone.reads_every_class()) and vppsone.school_office_session_visible(session_label));
revoke all on vppsone.school_return_batches from public,anon,authenticated;
grant select on vppsone.school_return_batches to authenticated;
grant all on vppsone.school_return_batches to service_role;

create table vppsone.school_return_events (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references vppsone.school_return_batches(id),actor_id uuid not null references vppsone.staff_profiles(id),
 kind text not null,detail jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create index school_return_events_batch on vppsone.school_return_events(batch_id,created_at);
alter table vppsone.school_return_events enable row level security;
create policy school_return_events_read on vppsone.school_return_events for select to authenticated
 using(exists(select 1 from vppsone.school_return_batches b where b.id=batch_id));
revoke all on vppsone.school_return_events from public,anon,authenticated;
grant select on vppsone.school_return_events to authenticated;
grant all on vppsone.school_return_events to service_role;

-- Shared, minimal roster for return and official-exam capabilities. No money.
create function vppsone.school_office_roster(p_actor uuid,p_session text,p_permission text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb; source_revision text;
begin
 if p_permission not in('government:view','government:export','government:import','outcomes:view','outcomes:manage')
  or not vppsone.school_office_actor_allowed(p_actor,p_permission,p_session,p_confined)
  or not exists(select 1 from vppsone.staff_profiles where id=p_actor and role in('admin','office','academic_coordinator','exam_coordinator')) then raise exception 'office:forbidden'; end if;
 if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then raise exception 'office:source_unavailable'; end if;
 source_revision:=case when vppsone.is_test_session(p_session) then 'test' else (select last_revision::text from vppsone.fees_bridge_state where id) end;
 if vppsone.is_test_session(p_session) then
   select 'test:'||md5(coalesce(string_agg(s.id::text||coalesce(s.updated_at::text,'')||coalesce(c.updated_at::text,'')||coalesce(e.updated_at::text,''),',' order by s.id),'')) into source_revision
    from vppsone.fees_identity_students s join vppsone.fees_identity_classes c on c.id=s.class_id
    left join vppsone.enrolments e on e.student_id=s.id and e.class_id=c.id and e.session_label=p_session
    where c.session_label=p_session and s.status::text='active';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('studentId',s.id,'studentName',s.full_name,'admissionNo',coalesce(s.admission_no,''),
   'classLabel',concat_ws(' ',c.class_name,nullif(c.section,'')),'classId',c.id,'sessionLabel',p_session,'schoolCode','',
   'externalId','','registrationStatus','','sourceRevision',source_revision,'externalRevision',0,
   'identityVerified',exists(select 1 from vppsone.enrolments e where e.student_id=s.id and e.class_id=c.id and e.session_label=p_session and e.status='enrolled' and e.left_on is null)) order by c.sort_order,s.full_name),'[]'::jsonb)
 into result from vppsone.fees_identity_students s join vppsone.fees_identity_classes c on c.id=s.class_id
 where c.session_label=p_session and s.status::text='active';
 if jsonb_array_length(result)>2000 then raise exception 'office:roster_limit'; end if;
 return result;
end;
$$;
revoke all on function vppsone.school_office_roster(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_office_roster(uuid,text,text,boolean) to service_role;

create function vppsone.school_return_reserve(p_actor uuid,p_id uuid,p_request_hash text,p_adapter jsonb,p_payload jsonb,p_direction text,p_source_hash text default null,p_parent uuid default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
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
 source_revision:=coalesce(roster->0->>'sourceRevision',case when vppsone.is_test_session(p_adapter->>'sessionLabel') then 'test' else (select last_revision::text from vppsone.fees_bridge_state where id) end);
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
$$;
revoke all on function vppsone.school_return_reserve(uuid,uuid,text,jsonb,jsonb,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_reserve(uuid,uuid,text,jsonb,jsonb,text,text,uuid,boolean) to service_role;

create function vppsone.school_return_finish(p_actor uuid,p_id uuid,p_path text,p_hash text,p_name text,p_type text,p_confined boolean default false)
returns void language plpgsql set search_path='' as $$
declare b vppsone.school_return_batches;
begin
 select * into b from vppsone.school_return_batches where id=p_id for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,case when b.direction='export' then 'government:export' else 'government:import' end,b.session_label,p_confined) then raise exception 'office:forbidden'; end if;
 if p_path not like 'batches/'||b.id::text||'/%' or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'office:invalid_file'; end if;
 if b.file_path is not null then
   if b.file_path<>p_path or b.file_sha256<>p_hash then raise exception 'office:file_immutable'; end if;
   return;
 end if;
 update vppsone.school_return_batches set file_path=p_path,file_sha256=p_hash,file_name=p_name,content_type=p_type,
   state=case when direction='export' then 'exported' else 'staged' end,revision=revision+1,updated_at=now() where id=p_id;
end;
$$;
revoke all on function vppsone.school_return_finish(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_finish(uuid,uuid,text,text,text,text,boolean) to service_role;

create function vppsone.school_return_apply(p_actor uuid,p_batch uuid,p_command uuid,p_expected_revision integer,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare b vppsone.school_return_batches; row_data jsonb; link vppsone.school_external_records; source_revision text; roster jsonb; applied integer:=0; unchanged integer:=0;
begin
 select * into b from vppsone.school_return_batches where id=p_batch for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'government:import',b.session_label,p_confined) then raise exception 'office:forbidden'; end if;
 if b.apply_command=p_command then return b.apply_receipt; end if;
 if b.direction<>'import' or b.state<>'staged' or b.revision<>p_expected_revision or b.file_path is null then raise exception 'office:stale_preview'; end if;
 if exists(select 1 from jsonb_array_elements(b.payload->'preview') r where r->>'state' in('conflict','unmatched')) then raise exception 'office:unresolved_conflicts'; end if;
 roster:=vppsone.school_office_roster(p_actor,b.session_label,'government:import',p_confined);
 source_revision:=roster->0->>'sourceRevision';
 if source_revision is distinct from b.payload->>'sourceRevision' then raise exception 'office:source_changed'; end if;
 -- Serialize link changes within one destination/session namespace.
 perform pg_advisory_xact_lock(hashtextextended('school-return-links:'||b.portal||':'||b.module||':'||b.session_label||':'||(b.adapter->>'schoolCode'),0));
 for row_data in select * from jsonb_array_elements(b.payload->'preview') loop
   if row_data->>'state' not in('ready','unchanged') or (row_data->>'studentId') is null then raise exception 'office:invalid_row'; end if;
   if exists(select 1 from jsonb_object_keys(row_data->'changes') k where k not in('externalId','registrationStatus')) then raise exception 'office:protected_field'; end if;
   if not exists(select 1 from jsonb_array_elements(roster) r where r->>'studentId'=row_data->>'studentId' and r->>'identityVerified'='true') then raise exception 'office:identity_changed'; end if;
   select * into link from vppsone.school_external_records where portal=b.portal and module=b.module and school_code=b.adapter->>'schoolCode' and session_label=b.session_label and student_id=(row_data->>'studentId')::uuid for update;
   if coalesce(link.revision,0)<>coalesce((row_data->>'expectedRevision')::integer,0) then raise exception 'office:stale_preview'; end if;
   if row_data->>'state'='unchanged' then unchanged:=unchanged+1; continue; end if;
   insert into vppsone.school_external_records(portal,module,school_code,session_label,student_id,external_id,registration_status,source_batch_id,updated_by)
   values(b.portal,b.module,b.adapter->>'schoolCode',b.session_label,(row_data->>'studentId')::uuid,nullif(row_data->'changes'->>'externalId',''),nullif(row_data->'changes'->>'registrationStatus',''),b.id,p_actor)
   on conflict(portal,module,school_code,session_label,student_id) do update set
     external_id=coalesce(nullif(row_data->'changes'->>'externalId',''),vppsone.school_external_records.external_id),
     registration_status=coalesce(nullif(row_data->'changes'->>'registrationStatus',''),vppsone.school_external_records.registration_status),
     revision=vppsone.school_external_records.revision+1,source_batch_id=b.id,updated_by=p_actor,updated_at=now();
   applied:=applied+1;
 end loop;
 update vppsone.school_return_batches set state='applied',apply_command=p_command,
   apply_receipt=jsonb_build_object('applied',applied,'unchanged',unchanged,'sourceHash',source_hash,'commandId',p_command),revision=revision+1,updated_at=now()
   where id=b.id returning * into b;
 insert into vppsone.school_return_events(batch_id,actor_id,kind,detail) values(b.id,p_actor,'import_applied',b.apply_receipt);
 return b.apply_receipt;
end;
$$;
revoke all on function vppsone.school_return_apply(uuid,uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_apply(uuid,uuid,uuid,integer,boolean) to service_role;

create function vppsone.school_return_outcome(p_actor uuid,p_batch uuid,p_expected_revision integer,p_state text,p_ack text,p_evidence text,p_evidence_hash text,p_evidence_name text,p_evidence_type text,p_rows jsonb,p_confined boolean default false)
returns void language plpgsql set search_path='' as $$
declare b vppsone.school_return_batches; accepted_count integer; row_count integer;
begin
 select * into b from vppsone.school_return_batches where id=p_batch for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'government:export',b.session_label,p_confined) then raise exception 'office:forbidden'; end if;
 if b.direction<>'export' or b.file_path is null or b.revision<>p_expected_revision or p_state not in('submitted','accepted','partially_accepted','rejected') then raise exception 'office:stale_batch'; end if;
 if p_state='submitted' and b.state not in('exported','rejected') then raise exception 'office:invalid_transition'; end if;
 if p_state in('accepted','partially_accepted','rejected') and b.state not in('submitted','partially_accepted') then raise exception 'office:submission_required'; end if;
 if length(btrim(coalesce(p_ack,'')))<3 then raise exception 'office:acknowledgement_required'; end if;
 if p_state in('accepted','partially_accepted','rejected') and (p_evidence not like 'evidence/'||p_batch::text||'/%' or not exists(select 1 from storage.objects where bucket_id='vppsone-school-office' and name=p_evidence)) then raise exception 'office:evidence_required'; end if;
 if p_state in('accepted','partially_accepted','rejected') and p_evidence_hash !~ '^[a-f0-9]{64}$' then raise exception 'office:evidence_required'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'office:invalid_outcome'; end if;
 if p_state='submitted' then
   if jsonb_array_length(p_rows)<>0 then raise exception 'office:invalid_outcome'; end if;
 else
   row_count:=jsonb_array_length(b.payload->'rows');
   if row_count=0 or jsonb_array_length(p_rows)<>row_count
     or exists(select 1 from jsonb_array_elements(p_rows) x where x->>'state' not in('accepted','not_accepted') or x->>'state' is null
       or not exists(select 1 from jsonb_array_elements(b.payload->'rows') r where r->>'studentId'=x->>'studentId'))
     or (select count(distinct x->>'studentId') from jsonb_array_elements(p_rows) x)<>row_count then raise exception 'office:invalid_outcome'; end if;
   select count(*) into accepted_count from jsonb_array_elements(p_rows) x where x->>'state'='accepted';
   if (p_state='accepted' and accepted_count<>row_count) or (p_state='rejected' and accepted_count<>0)
     or (p_state='partially_accepted' and (accepted_count=0 or accepted_count=row_count)) then raise exception 'office:invalid_outcome'; end if;
 end if;
 update vppsone.school_return_batches set state=p_state,row_outcomes=p_rows,acknowledgement=p_ack,evidence_path=coalesce(p_evidence,evidence_path),
   evidence_sha256=coalesce(p_evidence_hash,evidence_sha256),evidence_name=coalesce(p_evidence_name,evidence_name),evidence_content_type=coalesce(p_evidence_type,evidence_content_type),revision=revision+1,updated_at=now() where id=p_batch;
 insert into vppsone.school_return_events(batch_id,actor_id,kind,detail) values(p_batch,p_actor,p_state||'_recorded',jsonb_build_object('acknowledgement',p_ack,'evidencePath',p_evidence,'evidenceSha256',p_evidence_hash,'rowOutcomes',p_rows));
end;
$$;
revoke all on function vppsone.school_return_outcome(uuid,uuid,integer,text,text,text,text,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_outcome(uuid,uuid,integer,text,text,text,text,text,text,jsonb,boolean) to service_role;

create function vppsone.school_return_save_adapter(p_actor uuid,p_adapter jsonb,p_expected_version integer,p_confined boolean default false)
returns uuid language plpgsql set search_path='' as $$
declare latest integer; result uuid;
begin
 if p_confined or not vppsone.school_office_actor_allowed(p_actor,'settings:manage') or not exists(select 1 from vppsone.staff_profiles where id=p_actor and not is_test_account and is_active) then raise exception 'office:forbidden'; end if;
 if p_adapter->>'mode'<>'verified_upload' or p_adapter->>'specimenSha256' !~ '^[a-f0-9]{64}$' or length(p_adapter->>'sourceReference')<10 or length(p_adapter->>'schoolCode')<1 then raise exception 'office:unverified_adapter'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-return-adapter:'||(p_adapter->>'portal')||':'||(p_adapter->>'module')||':'||(p_adapter->>'sessionLabel')||':'||(p_adapter->>'schoolCode'),0));
 select coalesce(max(version),0) into latest from vppsone.school_return_adapters where portal=p_adapter->>'portal' and module=p_adapter->>'module' and session_label=p_adapter->>'sessionLabel' and school_code=p_adapter->>'schoolCode';
 if latest<>p_expected_version then raise exception 'office:adapter_changed'; end if;
 insert into vppsone.school_return_adapters(portal,module,session_label,school_code,version,adapter,approved_by)
 values(p_adapter->>'portal',p_adapter->>'module',p_adapter->>'sessionLabel',p_adapter->>'schoolCode',latest+1,p_adapter||jsonb_build_object('version',latest+1),p_actor) returning id into result;
 return result;
end;
$$;
revoke all on function vppsone.school_return_save_adapter(uuid,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_return_save_adapter(uuid,jsonb,integer,boolean) to service_role;

create function vppsone.school_return_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'office:immutable'; end if;
 if new.payload is distinct from old.payload or new.adapter is distinct from old.adapter or new.actor_id<>old.actor_id or new.request_hash<>old.request_hash
  or new.direction<>old.direction or new.session_label<>old.session_label or new.portal<>old.portal or new.module<>old.module or new.source_hash is distinct from old.source_hash
  or new.parent_batch_id is distinct from old.parent_batch_id or new.created_at<>old.created_at then raise exception 'office:immutable'; end if;
 if old.file_path is not null and (new.file_path is distinct from old.file_path or new.file_sha256 is distinct from old.file_sha256 or new.file_name is distinct from old.file_name or new.content_type is distinct from old.content_type) then raise exception 'office:file_immutable'; end if;
 return new;
end;
$$;
create trigger school_return_immutable before update or delete on vppsone.school_return_batches for each row execute function vppsone.school_return_immutable();
revoke all on function vppsone.school_return_immutable() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('vppsone-school-office','vppsone-school-office',false,2097152,
 array['application/pdf','image/png','image/jpeg','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream']) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
