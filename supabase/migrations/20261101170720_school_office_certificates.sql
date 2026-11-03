-- School Office: independent school document authority; no financial mutations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Called by the server only, after its session and view-as checks. Recheck
-- active actor, current matrix and TEST scope inside every consequential command.
create function vppsone.school_office_actor_allowed(p_actor uuid,p_permission text,p_session text default null,p_confined boolean default false)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from vppsone.staff_profiles sp
   join vppsone.role_permissions rp on rp.role=sp.role and rp.permission=p_permission
   where sp.id=p_actor and sp.is_active
   and (p_permission not like 'certificates:%' and p_permission not like 'government:%' and p_permission not like 'outcomes:%'
     or sp.role in('admin','office','academic_coordinator','exam_coordinator'))
   and (p_session is null or (
     (not p_confined or vppsone.is_test_session(p_session))
     and (vppsone.is_test_session(p_session)=coalesce(sp.is_test_account,false)
       or (sp.role='admin' and not coalesce(sp.is_test_account,false)))))
   and (p_permission<>'certificates:manage' or (not coalesce(sp.is_test_account,false) and not p_confined)));
$$;
revoke all on function vppsone.school_office_actor_allowed(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_office_actor_allowed(uuid,text,text,boolean) to service_role;

create function vppsone.school_office_session_visible(p_session text)
returns boolean language sql stable security definer set search_path='' as $$
 select vppsone.is_active_staff() and (
   vppsone.is_test_session(p_session)=vppsone.current_is_test_account() or vppsone.is_real_admin());
$$;
revoke all on function vppsone.school_office_session_visible(text) from public,anon;
grant execute on function vppsone.school_office_session_visible(text) to authenticated,service_role;

create table vppsone.school_certificate_templates (
 version integer primary key check(version>0), active boolean not null default false,
 template jsonb not null check(jsonb_typeof(template)='object'),
 approved_by uuid references vppsone.staff_profiles(id), approved_via text not null,
 created_at timestamptz not null default now(),
 check((template->>'version')::integer=version),check((template->>'signaturePolicy')='manual')
);
create unique index school_certificate_template_active on vppsone.school_certificate_templates(active) where active;
alter table vppsone.school_certificate_templates enable row level security;
create policy certificate_templates_read on vppsone.school_certificate_templates for select to authenticated
 using ((select vppsone.staff_can_any(array['certificates:view','certificates:issue','certificates:manage'])));
revoke all on vppsone.school_certificate_templates from public,anon,authenticated;
grant select on vppsone.school_certificate_templates to authenticated;
grant all on vppsone.school_certificate_templates to service_role;

insert into vppsone.school_certificate_templates(version,active,approved_via,template) values(1,true,
 'owner instruction 2026-11-01: existing letterhead, manual signature, VPPS/STUDY/<session>/0001',
 jsonb_build_object('version',1,'active',true,'titleEn','Study Certificate','titleHi','अध्ययन प्रमाण पत्र',
 'bodyEn','This is to certify that {studentName}, admission/SR number {admissionNo}, is enrolled in Class {classLabel} for academic session {sessionLabel} at {schoolName}.',
 'bodyHi','प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} में {schoolName} की कक्षा {classLabel} में अध्ययनरत हैं।',
 'historicalBodyEn','This is to certify that {studentName}, admission/SR number {admissionNo}, was enrolled in Class {classLabel} during academic session {sessionLabel} at {schoolName}.',
 'historicalBodyHi','प्रमाणित किया जाता है कि {studentName}, प्रवेश/एसआर संख्या {admissionNo}, शैक्षणिक सत्र {sessionLabel} के दौरान {schoolName} की कक्षा {classLabel} में अध्ययनरत थे।',
 'requiredFields',jsonb_build_array('studentName','admissionNo','classLabel','sessionLabel'),
 'language','en','prefix','VPPS/STUDY','signaturePolicy','manual'));

create table vppsone.school_certificate_series (
 prefix text not null,session_label text not null,is_test boolean not null,last_number bigint not null check(last_number>0),
 primary key(prefix,session_label,is_test),check(is_test=vppsone.is_test_session(session_label))
);
alter table vppsone.school_certificate_series enable row level security;
revoke all on vppsone.school_certificate_series from public,anon,authenticated;
grant all on vppsone.school_certificate_series to service_role;

create table vppsone.school_certificate_issues (
 id uuid primary key default gen_random_uuid(),student_id uuid not null,session_label text not null,
 enrolment_id uuid not null references vppsone.enrolments(id),template_version integer not null references vppsone.school_certificate_templates(version),
 serial text not null unique,status text not null default 'prepared' check(status in('prepared','issued','superseded','cancelled')),
 artifact_state text not null default 'preparing' check(artifact_state in('preparing','ready','failed')),
 snapshot jsonb not null,issued_by uuid not null references vppsone.staff_profiles(id),issued_at timestamptz not null default now(),
 student_name text generated always as(snapshot->'facts'->>'studentName') stored,
 admission_no text generated always as(snapshot->'facts'->>'admissionNo') stored,
 storage_path text unique,artifact_sha256 text,artifact_bytes integer,
 supersedes uuid references vppsone.school_certificate_issues(id),reason text,
 check(artifact_sha256 is null or artifact_sha256 ~ '^[a-f0-9]{64}$'),
 check(artifact_state<>'ready' or (storage_path is not null and artifact_sha256 is not null and artifact_bytes>0)),
 check((snapshot->>'serial')=serial),check((snapshot->'facts'->>'studentId')::uuid=student_id),
 check(snapshot->'facts'->>'sessionLabel'=session_label)
);
create index school_certificate_student_session on vppsone.school_certificate_issues(student_id,session_label,issued_at desc);
create index school_certificate_register on vppsone.school_certificate_issues(session_label,issued_at desc);
create unique index school_certificate_supersedes_once on vppsone.school_certificate_issues(supersedes) where supersedes is not null and status<>'cancelled';
alter table vppsone.school_certificate_issues enable row level security;
create policy certificate_issues_read on vppsone.school_certificate_issues for select to authenticated
 using ((select vppsone.staff_can('certificates:view')) and (select vppsone.reads_every_class()) and vppsone.school_office_session_visible(session_label));
revoke all on vppsone.school_certificate_issues from public,anon,authenticated;
grant select on vppsone.school_certificate_issues to authenticated;
grant all on vppsone.school_certificate_issues to service_role;

create table vppsone.school_certificate_commands (
 command_id uuid primary key,actor_id uuid not null references vppsone.staff_profiles(id),request_hash text not null,
 issue_id uuid not null references vppsone.school_certificate_issues(id),created_at timestamptz not null default now()
);
alter table vppsone.school_certificate_commands enable row level security;
revoke all on vppsone.school_certificate_commands from public,anon,authenticated;
grant all on vppsone.school_certificate_commands to service_role;
create table vppsone.school_certificate_events (
 id uuid primary key default gen_random_uuid(),issue_id uuid not null references vppsone.school_certificate_issues(id),
 actor_id uuid not null references vppsone.staff_profiles(id),kind text not null check(kind in('prepared','download_requested','print_requested','handed_over','superseded','cancelled','artifact_ready','artifact_failed')),
 reason text,command_id uuid unique,created_at timestamptz not null default now()
);
create index school_certificate_events_issue on vppsone.school_certificate_events(issue_id,created_at);
alter table vppsone.school_certificate_events enable row level security;
create policy certificate_events_read on vppsone.school_certificate_events for select to authenticated
 using (exists(select 1 from vppsone.school_certificate_issues i where i.id=issue_id));
revoke all on vppsone.school_certificate_events from public,anon,authenticated;
grant select on vppsone.school_certificate_events to authenticated;
grant all on vppsone.school_certificate_events to service_role;

create function vppsone.school_certificate_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'certificate:immutable'; end if;
 if new.snapshot is distinct from old.snapshot or new.serial<>old.serial or new.student_id<>old.student_id
   or new.session_label<>old.session_label or new.enrolment_id<>old.enrolment_id or new.template_version<>old.template_version
   or new.issued_at<>old.issued_at or new.issued_by<>old.issued_by or new.supersedes is distinct from old.supersedes
   or new.reason is distinct from old.reason then raise exception 'certificate:immutable'; end if;
 if old.artifact_state='ready' and (new.artifact_state<>old.artifact_state or new.storage_path is distinct from old.storage_path
    or new.artifact_sha256 is distinct from old.artifact_sha256 or new.artifact_bytes is distinct from old.artifact_bytes) then
   raise exception 'certificate:artifact_immutable'; end if;
 if new.status<>old.status and not (old.status='prepared' and new.status in('issued','superseded','cancelled')
   or old.status='issued' and new.status in('superseded','cancelled')) then raise exception 'certificate:invalid_transition'; end if;
 return new;
end;
$$;
create trigger school_certificate_immutable before update or delete on vppsone.school_certificate_issues
 for each row execute function vppsone.school_certificate_immutable();
revoke all on function vppsone.school_certificate_immutable() from public,anon,authenticated;

-- Minimal, authorized document facts. The views enforce source freshness;
-- historical wording needs an explicit, dated historical enrolment.
create function vppsone.school_certificate_facts(p_actor uuid,p_student uuid,p_session text,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare e vppsone.enrolments; s jsonb; c jsonb; t jsonb; current_record boolean; verified boolean; optional_text text;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if not vppsone.is_test_session(p_session) and not exists(select 1 from vppsone.fees_bridge_state where id and enabled and live_read_ready and last_error_code is null and last_checked_at>=clock_timestamp()-interval '5 minutes') then raise exception 'certificate:source_unavailable'; end if;
 select * into e from vppsone.enrolments where student_id=p_student and session_label=p_session order by created_at desc limit 1;
 select to_jsonb(x) into s from vppsone.fees_identity_students x where x.id=p_student limit 1;
 select to_jsonb(x) into c from vppsone.fees_identity_classes x where x.id=e.class_id and x.session_label=p_session;
 select template into t from vppsone.school_certificate_templates where active;
 current_record:=coalesce(e.status::text='enrolled' and e.left_on is null and s->>'status'='active' and (s->>'class_id')::uuid=e.class_id,false);
 verified:=e.id is not null and s is not null and c is not null and (current_record or (e.enrolled_on is not null and e.left_on is not null and e.left_on>=e.enrolled_on));
 optional_text:=coalesce((t->'requiredFields')::text,'') || ' ' ||
   case when t->>'language' in('en','both') then coalesce(t->>(case when current_record then 'bodyEn' else 'historicalBodyEn' end),'') else '' end || ' ' ||
   case when t->>'language' in('hi','both') then coalesce(t->>(case when current_record then 'bodyHi' else 'historicalBodyHi' end),'') else '' end;
 return jsonb_build_object('studentId',p_student,'enrolmentId',coalesce(e.id,'00000000-0000-0000-0000-000000000000'::uuid),
   'classId',coalesce(e.class_id,'00000000-0000-0000-0000-000000000000'::uuid),'studentName',coalesce(s->>'full_name',''),
   'admissionNo',coalesce(s->>'admission_no',''),'classLabel',concat_ws(' ',c->>'class_name',nullif(c->>'section','')),
   'sessionLabel',p_session,'status',case when current_record then 'current' else 'historical' end,
   'enrolledOn',e.enrolled_on,'leftOn',e.left_on,
   'dateOfBirth',case when position('dateOfBirth' in optional_text)>0 then s->>'date_of_birth' end,
   'fatherName',case when position('fatherName' in optional_text)>0 then s->>'father_name' end,
   'motherName',case when position('motherName' in optional_text)>0 then s->>'mother_name' end,
   'identityVerified',verified,'sourceCurrent',s is not null and c is not null,
   'sourceRevision',case when vppsone.is_test_session(p_session) then coalesce(s->>'updated_at','test') else coalesce((select last_revision::text from vppsone.fees_bridge_state where id),'unknown') end,
   'checkedAt',clock_timestamp());
end;
$$;
revoke all on function vppsone.school_certificate_facts(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_facts(uuid,uuid,text,boolean) to service_role;

-- A reprint is also a durable command. Keep it available during source outages
-- without allowing a delayed retry to become a new issuance after cancellation.
create function vppsone.school_certificate_current(p_actor uuid,p_student uuid,p_session text,p_command uuid,p_request_hash text,p_confined boolean default false,p_issue uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare prior vppsone.school_certificate_commands; issue vppsone.school_certificate_issues;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'certificate:invalid_command'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-command:'||p_command::text,0));
 select * into prior from vppsone.school_certificate_commands where command_id=p_command;
 if found then
   if prior.actor_id<>p_actor or prior.request_hash<>p_request_hash then raise exception 'certificate:command_reused'; end if;
   select * into issue from vppsone.school_certificate_issues where id=prior.issue_id;
   if issue.student_id<>p_student or issue.session_label<>p_session then raise exception 'certificate:command_reused'; end if;
   return to_jsonb(issue);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-student:'||p_student::text||':'||p_session,0));
 select * into issue from vppsone.school_certificate_issues where student_id=p_student and session_label=p_session
   and status in('prepared','issued') and (p_issue is null or id=p_issue) order by issued_at desc limit 1;
 if not found then
   if p_issue is not null then raise exception 'certificate:stale_issue'; end if;
   return null;
 end if;
 insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
 return to_jsonb(issue);
end;
$$;
revoke all on function vppsone.school_certificate_current(uuid,uuid,text,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_current(uuid,uuid,text,uuid,text,boolean,uuid) to service_role;

create function vppsone.school_certificate_reserve(p_actor uuid,p_student uuid,p_session text,p_command uuid,p_request_hash text,
 p_expected_facts jsonb,p_school jsonb,p_expected_template integer,p_new boolean default false,p_supersedes uuid default null,p_reason text default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare prior vppsone.school_certificate_commands; issue vppsone.school_certificate_issues; t vppsone.school_certificate_templates;
 facts jsonb; serial_number bigint; serial_text text; instant timestamptz:=clock_timestamp(); field text;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',p_session,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'certificate:invalid_command'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-command:'||p_command::text,0));
 select * into prior from vppsone.school_certificate_commands where command_id=p_command;
 if found then
   if prior.actor_id<>p_actor or prior.request_hash<>p_request_hash then raise exception 'certificate:command_reused'; end if;
   select * into issue from vppsone.school_certificate_issues where id=prior.issue_id;
   return jsonb_build_object('issue',to_jsonb(issue),'existing',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-student:'||p_student::text||':'||p_session,0));
 if not p_new and p_supersedes is null then
   select * into issue from vppsone.school_certificate_issues where student_id=p_student and session_label=p_session
     and status in('prepared','issued') order by issued_at desc limit 1;
   if found then
     insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
     return jsonb_build_object('issue',to_jsonb(issue),'existing',true);
   end if;
 end if;
 select * into t from vppsone.school_certificate_templates where active for share;
 if not found then raise exception 'certificate:template_inactive'; end if;
 if t.version<>p_expected_template then raise exception 'certificate:template_changed'; end if;
 facts:=vppsone.school_certificate_facts(p_actor,p_student,p_session,p_confined);
 if facts->>'identityVerified'<>'true' or facts->>'sourceCurrent'<>'true' then raise exception 'certificate:identity_unverified'; end if;
 if (facts-'checkedAt') is distinct from (p_expected_facts-'checkedAt') then raise exception 'certificate:source_changed'; end if;
 for field in select jsonb_array_elements_text(t.template->'requiredFields') loop
   if nullif(btrim(facts->>field),'') is null then raise exception 'certificate:missing_field:%',field; end if;
 end loop;
 if p_supersedes is not null then
   if not vppsone.school_office_actor_allowed(p_actor,'certificates:manage',p_session,p_confined) or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'certificate:correction_forbidden'; end if;
   select * into issue from vppsone.school_certificate_issues where id=p_supersedes and student_id=p_student and session_label=p_session for update;
   if not found or issue.status not in('prepared','issued') then raise exception 'certificate:stale_issue'; end if;
 end if;
 if p_school->>'name' is null or length(p_school->>'name')<2 then raise exception 'certificate:school_missing'; end if;
 insert into vppsone.school_certificate_series(prefix,session_label,is_test,last_number)
   values(t.template->>'prefix',p_session,vppsone.is_test_session(p_session),1)
   on conflict(prefix,session_label,is_test) do update set last_number=vppsone.school_certificate_series.last_number+1
   returning last_number into serial_number;
 serial_text:=case when vppsone.is_test_session(p_session) then 'TEST/' else '' end||(t.template->>'prefix');
 serial_text:=serial_text||'/'||p_session||'/'||lpad(serial_number::text,greatest(4,length(serial_number::text)),'0');
 insert into vppsone.school_certificate_issues(student_id,session_label,enrolment_id,template_version,serial,snapshot,issued_by,issued_at,supersedes,reason)
   values(p_student,p_session,(facts->>'enrolmentId')::uuid,t.version,serial_text,
    jsonb_build_object('serial',serial_text,'issuedAt',instant,'issuedOn',(instant at time zone 'Asia/Kolkata')::date,
      'isTest',vppsone.is_test_session(p_session),'school',p_school,'facts',facts,'template',t.template),p_actor,instant,p_supersedes,p_reason)
   returning * into issue;
 insert into vppsone.school_certificate_commands(command_id,actor_id,request_hash,issue_id) values(p_command,p_actor,p_request_hash,issue.id);
 insert into vppsone.school_certificate_events(issue_id,actor_id,kind) values(issue.id,p_actor,'prepared');
 -- Supersession is finalized only after the new artifact is safely stored.
 return jsonb_build_object('issue',to_jsonb(issue),'existing',false);
end;
$$;
revoke all on function vppsone.school_certificate_reserve(uuid,uuid,text,uuid,text,jsonb,jsonb,integer,boolean,uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_reserve(uuid,uuid,text,uuid,text,jsonb,jsonb,integer,boolean,uuid,text,boolean) to service_role;

create function vppsone.school_certificate_finish(p_actor uuid,p_issue uuid,p_path text,p_sha256 text,p_bytes integer,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare i vppsone.school_certificate_issues; expected_path text;
begin
 select * into i from vppsone.school_certificate_issues where id=p_issue for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',i.session_label,p_confined) then raise exception 'certificate:forbidden'; end if;
 expected_path:='certificates/'||i.session_label||'/'||i.student_id::text||'/'||i.id::text||'.pdf';
 if p_path<>expected_path or p_sha256 !~ '^[a-f0-9]{64}$' or p_bytes<20 or p_bytes>2097152 then raise exception 'certificate:invalid_artifact'; end if;
 if i.artifact_state='ready' then
   if i.storage_path<>p_path or i.artifact_sha256<>p_sha256 then raise exception 'certificate:artifact_immutable'; end if;
   return to_jsonb(i);
 end if;
 if i.status in('cancelled','superseded') then raise exception 'certificate:stale_issue'; end if;
 update vppsone.school_certificate_issues set artifact_state='ready',storage_path=p_path,artifact_sha256=p_sha256,artifact_bytes=p_bytes where id=i.id returning * into i;
 if i.supersedes is not null then
   update vppsone.school_certificate_issues set status='superseded' where id=i.supersedes and status in('prepared','issued');
   insert into vppsone.school_certificate_events(issue_id,actor_id,kind,reason) values(i.supersedes,p_actor,'superseded',i.reason);
 end if;
 insert into vppsone.school_certificate_events(issue_id,actor_id,kind) values(i.id,p_actor,'artifact_ready');
 return to_jsonb(i);
end;
$$;
revoke all on function vppsone.school_certificate_finish(uuid,uuid,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_finish(uuid,uuid,text,text,integer,boolean) to service_role;

create function vppsone.school_certificate_event(p_actor uuid,p_issue uuid,p_kind text,p_reason text,p_command uuid,p_confined boolean default false)
returns void language plpgsql set search_path='' as $$
declare i vppsone.school_certificate_issues; prior vppsone.school_certificate_events; required_permission text;
begin
 select * into i from vppsone.school_certificate_issues where id=p_issue for update;
 required_permission:=case when p_kind='cancelled' then 'certificates:manage' when p_kind='handed_over' then 'certificates:issue' else 'certificates:view' end;
 if not found or not vppsone.school_office_actor_allowed(p_actor,required_permission,i.session_label,p_confined) then raise exception 'certificate:forbidden'; end if;
 if p_kind not in('download_requested','print_requested','handed_over','cancelled') then raise exception 'certificate:invalid_event'; end if;
 select * into prior from vppsone.school_certificate_events where command_id=p_command;
 if found then
   if prior.actor_id<>p_actor or prior.issue_id<>p_issue or prior.kind<>p_kind or prior.reason is distinct from p_reason then raise exception 'certificate:command_reused'; end if;
   return;
 end if;
 if p_kind='cancelled' then
   if length(btrim(coalesce(p_reason,'')))<3 or i.status not in('prepared','issued') then raise exception 'certificate:reason_required'; end if;
   update vppsone.school_certificate_issues set status='cancelled' where id=i.id;
 elsif p_kind='handed_over' then
   if i.status<>'prepared' or i.artifact_state<>'ready' then raise exception 'certificate:not_ready'; end if;
   update vppsone.school_certificate_issues set status='issued' where id=i.id;
 end if;
 insert into vppsone.school_certificate_events(issue_id,actor_id,kind,reason,command_id) values(p_issue,p_actor,p_kind,p_reason,p_command);
end;
$$;
revoke all on function vppsone.school_certificate_event(uuid,uuid,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_event(uuid,uuid,text,text,uuid,boolean) to service_role;

create function vppsone.school_certificate_save_template(p_actor uuid,p_template jsonb,p_expected_version integer,p_confined boolean default false)
returns integer language plpgsql set search_path='' as $$
declare current_version integer; new_version integer;
begin
 if not vppsone.school_office_actor_allowed(p_actor,'certificates:manage',null,p_confined) then raise exception 'certificate:forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-template',0));
 select coalesce(max(version),0) into current_version from vppsone.school_certificate_templates;
 if current_version<>p_expected_version then raise exception 'certificate:template_changed'; end if;
 if p_template->>'signaturePolicy'<>'manual' or p_template->>'prefix' !~ '^[A-Z0-9][A-Z0-9/-]{0,39}$' then raise exception 'certificate:invalid_template'; end if;
 new_version:=current_version+1;
 update vppsone.school_certificate_templates set active=false where active;
 insert into vppsone.school_certificate_templates(version,active,template,approved_by,approved_via)
 values(new_version,coalesce((p_template->>'active')::boolean,false),p_template||jsonb_build_object('version',new_version),p_actor,'authorized template configuration');
 return new_version;
end;
$$;
revoke all on function vppsone.school_certificate_save_template(uuid,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_save_template(uuid,jsonb,integer,boolean) to service_role;

-- Certificate artifacts are immutable, private, and fetched only after the
-- certificate-specific authorization above. No broad student-document policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('vppsone-certificates','vppsone-certificates',false,2097152,array['application/pdf']) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
