-- Certificates a teacher asks for, and an approver's answer (D-542).
--
-- A teacher prepares nothing. The request names a child in one of the
-- teacher's own classes, a document (study, character or date of birth; a TC
-- stays with the office, which owns the leaving workflow) and an optional
-- purpose. An approver's "Approve and sign" issues the document through the
-- existing issue path under the approver's own name, so it carries the
-- principal's printed signature and the school seal (D-541), and the request
-- then points at that stored original. The person who asked can download it
-- and hand it to the family; every download is written into the
-- certificate's own history. No financial data, nothing in public.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Who may ask and approve is in ..._certificate_requests_role_permissions.sql.

create table vppsone.school_certificate_requests (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null,
 session_label text not null check (session_label ~ '^(TEST-)?[0-9]{4}-[0-9]{2}$'),
 class_id uuid not null,
 kind text not null check (kind in ('study','character','dob')),
 purpose text check (purpose is null or (length(btrim(purpose)) between 2 and 80 and purpose !~ '[{}<>]')),
 extras jsonb not null default '{}'::jsonb check (jsonb_typeof(extras)='object'),
 note text check (note is null or (length(btrim(note)) between 1 and 300 and note !~ '[{}<>]')),
 requested_by uuid not null references vppsone.staff_profiles(id),
 requested_at timestamptz not null default now(),
 command_id uuid not null unique,
 state text not null default 'waiting' check (state in ('waiting','approved','declined','withdrawn')),
 decided_by uuid references vppsone.staff_profiles(id),
 decided_at timestamptz,
 decline_reason text check (decline_reason is null or (length(btrim(decline_reason)) between 3 and 300 and decline_reason !~ '[{}<>]')),
 issue_id uuid references vppsone.school_certificate_issues(id),
 constraint school_certificate_request_decided check (((state='waiting')=(decided_at is null)) and ((state='waiting')=(decided_by is null))),
 constraint school_certificate_request_issue check ((state='approved')=(issue_id is not null)),
 constraint school_certificate_request_declined check ((state='declined')=(decline_reason is not null))
);
-- One open request per child, session and document; a second ask finds the first.
create unique index school_certificate_request_waiting on vppsone.school_certificate_requests(student_id,session_label,kind) where state='waiting';
create index school_certificate_request_queue on vppsone.school_certificate_requests(session_label,state,requested_at desc);
create index school_certificate_request_mine on vppsone.school_certificate_requests(requested_by,requested_at desc);
create index school_certificate_request_student on vppsone.school_certificate_requests(student_id,session_label,requested_at desc);
create index school_certificate_request_issue_ref on vppsone.school_certificate_requests(issue_id) where issue_id is not null;
alter table vppsone.school_certificate_requests enable row level security;
revoke all on vppsone.school_certificate_requests from public,anon,authenticated;
grant all on vppsone.school_certificate_requests to service_role;

-- What was asked never changes, and an answer is final.
create function vppsone.school_certificate_request_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'certificate_request:immutable'; end if;
 if new.id<>old.id or new.student_id<>old.student_id or new.session_label<>old.session_label or new.class_id<>old.class_id
   or new.kind<>old.kind or new.purpose is distinct from old.purpose or new.extras<>old.extras or new.note is distinct from old.note
   or new.requested_by<>old.requested_by or new.requested_at<>old.requested_at or new.command_id<>old.command_id then
   raise exception 'certificate_request:immutable';
 end if;
 if old.state<>'waiting' and row(new.state,new.decided_by,new.decided_at,new.decline_reason,new.issue_id)
   is distinct from row(old.state,old.decided_by,old.decided_at,old.decline_reason,old.issue_id) then
   raise exception 'certificate_request:decided';
 end if;
 return new;
end;
$$;
create trigger school_certificate_request_guard before update or delete on vppsone.school_certificate_requests
 for each row execute function vppsone.school_certificate_request_guard();
revoke all on function vppsone.school_certificate_request_guard() from public,anon,authenticated;

-- Who may ask: active staff whose role holds certificates:request, in a
-- session their account may touch (TEST with TEST), for a class they hold
-- today or teach -- the classes vppsone.my_class_keys() gives a teacher --
-- or any class for the school-wide roles.
create function vppsone.school_certificate_requester_allowed(p_actor uuid,p_session text,p_class uuid,p_confined boolean default false)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from vppsone.staff_profiles sp
   join vppsone.role_permissions rp on rp.role=sp.role and rp.permission='certificates:request'
   where sp.id=p_actor and sp.is_active
     and p_session ~ '^(TEST-)?[0-9]{4}-[0-9]{2}$'
     and (not p_confined or vppsone.is_test_session(p_session))
     and (vppsone.is_test_session(p_session)=coalesce(sp.is_test_account,false)
       or (sp.role='admin' and not coalesce(sp.is_test_account,false)))
     and (sp.role in ('admin','office','academic_coordinator','exam_coordinator')
       or exists(select 1 from vppsone.class_teachers ct
         where ct.staff_profile_id=p_actor and ct.class_id=p_class and ct.session_label=p_session
           and (ct.effective_from is null or ct.effective_from<=vppsone.school_today())
           and (ct.effective_to is null or ct.effective_to>=vppsone.school_today()))
       or exists(select 1 from vppsone.teaching_assignments ta
         where ta.staff_profile_id=p_actor and ta.class_id=p_class and ta.session_label=p_session)));
$$;
revoke all on function vppsone.school_certificate_requester_allowed(uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_requester_allowed(uuid,text,uuid,boolean) to service_role;

-- The person who asked, still active and still allowed to ask at all.
create function vppsone.school_certificate_request_owner(p_actor uuid,p_request vppsone.school_certificate_requests,p_confined boolean default false)
returns boolean language sql stable set search_path='' as $$
 select p_request.requested_by=p_actor and (not p_confined or vppsone.is_test_session(p_request.session_label))
   and exists(select 1 from vppsone.staff_profiles sp
     join vppsone.role_permissions rp on rp.role=sp.role and rp.permission='certificates:request'
     where sp.id=p_actor and sp.is_active);
$$;
revoke all on function vppsone.school_certificate_request_owner(uuid,vppsone.school_certificate_requests,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_owner(uuid,vppsone.school_certificate_requests,boolean) to service_role;

create function vppsone.school_certificate_request_create(p_actor uuid,p_student uuid,p_session text,p_kind text,p_command uuid,
 p_purpose text default null,p_extras jsonb default '{}'::jsonb,p_note text default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare e vppsone.enrolments; r vppsone.school_certificate_requests; extra record;
 v_purpose text:=nullif(btrim(coalesce(p_purpose,'')),''); v_note text:=nullif(btrim(coalesce(p_note,'')),''); v_extras jsonb:=coalesce(p_extras,'{}'::jsonb);
begin
 if p_kind not in ('study','character','dob') then raise exception 'certificate_request:invalid_kind'; end if;
 if v_purpose is not null and (length(v_purpose)<2 or length(v_purpose)>80 or v_purpose ~ '[{}<>]') then raise exception 'certificate_request:invalid_purpose'; end if;
 if v_note is not null and (length(v_note)>300 or v_note ~ '[{}<>]') then raise exception 'certificate_request:invalid_note'; end if;
 if jsonb_typeof(v_extras)<>'object' then raise exception 'certificate_request:invalid_extras'; end if;
 for extra in select key,value from jsonb_each(v_extras) loop
   if extra.key<>'conduct' or jsonb_typeof(extra.value)<>'string'
     or (extra.value#>>'{}') not in ('excellent','very_good','good','satisfactory') then raise exception 'certificate_request:invalid_extras'; end if;
 end loop;
 if p_kind='character' and not (v_extras ? 'conduct') then raise exception 'certificate_request:conduct_required'; end if;
 if p_kind<>'character' and v_extras<>'{}'::jsonb then raise exception 'certificate_request:invalid_extras'; end if;
 if p_session is null or p_session !~ '^(TEST-)?[0-9]{4}-[0-9]{2}$' or (p_confined and not vppsone.is_test_session(p_session)) then
   raise exception 'certificate_request:forbidden';
 end if;
 select * into e from vppsone.enrolments where student_id=p_student and session_label=p_session
   and status::text='enrolled' and left_on is null order by created_at desc limit 1;
 if not found then raise exception 'certificate_request:not_enrolled'; end if;
 if not vppsone.school_certificate_requester_allowed(p_actor,p_session,e.class_id,p_confined) then raise exception 'certificate_request:forbidden'; end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-request-command:'||p_command::text,0));
 select * into r from vppsone.school_certificate_requests where command_id=p_command;
 if found then
   if r.requested_by<>p_actor or r.student_id<>p_student or r.session_label<>p_session or r.kind<>p_kind
     or r.purpose is distinct from v_purpose or r.extras<>v_extras or r.note is distinct from v_note then raise exception 'certificate_request:command_reused'; end if;
   return jsonb_build_object('request',to_jsonb(r),'existing',true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('school-certificate-request:'||p_student::text||':'||p_session||':'||p_kind,0));
 select * into r from vppsone.school_certificate_requests where student_id=p_student and session_label=p_session and kind=p_kind and state='waiting';
 if found then return jsonb_build_object('request',to_jsonb(r),'existing',true); end if;
 insert into vppsone.school_certificate_requests(student_id,session_label,class_id,kind,purpose,extras,note,requested_by,command_id)
   values(p_student,p_session,e.class_id,p_kind,v_purpose,v_extras,v_note,p_actor,p_command) returning * into r;
 return jsonb_build_object('request',to_jsonb(r),'existing',false);
end;
$$;
revoke all on function vppsone.school_certificate_request_create(uuid,uuid,text,text,uuid,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_create(uuid,uuid,text,text,uuid,text,jsonb,text,boolean) to service_role;

create function vppsone.school_certificate_request_withdraw(p_actor uuid,p_request uuid,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r vppsone.school_certificate_requests;
begin
 select * into r from vppsone.school_certificate_requests where id=p_request for update;
 if not found or not vppsone.school_certificate_request_owner(p_actor,r,p_confined) then raise exception 'certificate_request:forbidden'; end if;
 if r.state='withdrawn' then return to_jsonb(r); end if;
 if r.state<>'waiting' then raise exception 'certificate_request:decided'; end if;
 update vppsone.school_certificate_requests set state='withdrawn',decided_by=p_actor,decided_at=clock_timestamp() where id=r.id returning * into r;
 return to_jsonb(r);
end;
$$;
revoke all on function vppsone.school_certificate_request_withdraw(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_withdraw(uuid,uuid,boolean) to service_role;

create function vppsone.school_certificate_request_decline(p_actor uuid,p_request uuid,p_reason text,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r vppsone.school_certificate_requests; v_reason text:=btrim(coalesce(p_reason,''));
begin
 select * into r from vppsone.school_certificate_requests where id=p_request for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'certificates:approve',r.session_label,p_confined) then raise exception 'certificate_request:forbidden'; end if;
 if r.state='declined' and r.decided_by=p_actor and r.decline_reason=v_reason then return to_jsonb(r); end if;
 if r.state<>'waiting' then raise exception 'certificate_request:decided'; end if;
 if length(v_reason)<3 or length(v_reason)>300 or v_reason ~ '[{}<>]' then raise exception 'certificate_request:reason_required'; end if;
 update vppsone.school_certificate_requests set state='declined',decided_by=p_actor,decided_at=clock_timestamp(),decline_reason=v_reason
   where id=r.id returning * into r;
 return to_jsonb(r);
end;
$$;
revoke all on function vppsone.school_certificate_request_decline(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_decline(uuid,uuid,text,boolean) to service_role;

-- Approval links the request to the document the approver has just issued:
-- same child, session, document, purpose and conduct, issued by this approver,
-- current and stored. Issuing itself stays in school_certificate_reserve_v2.
create function vppsone.school_certificate_request_approve(p_actor uuid,p_request uuid,p_issue uuid,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r vppsone.school_certificate_requests; i vppsone.school_certificate_issues;
begin
 select * into r from vppsone.school_certificate_requests where id=p_request for update;
 if not found or not vppsone.school_office_actor_allowed(p_actor,'certificates:approve',r.session_label,p_confined)
   or not vppsone.school_office_actor_allowed(p_actor,'certificates:issue',r.session_label,p_confined) then raise exception 'certificate_request:forbidden'; end if;
 if r.state='approved' and r.issue_id=p_issue then return to_jsonb(r); end if;
 if r.state<>'waiting' then raise exception 'certificate_request:decided'; end if;
 select * into i from vppsone.school_certificate_issues where id=p_issue;
 if not found or i.student_id<>r.student_id or i.session_label<>r.session_label or i.kind<>r.kind or i.issued_by<>p_actor
   or i.status not in ('prepared','issued') or i.artifact_state<>'ready'
   or (i.snapshot->>'purpose') is distinct from r.purpose or coalesce(i.snapshot->'extras','{}'::jsonb)<>r.extras then
   raise exception 'certificate_request:issue_mismatch';
 end if;
 update vppsone.school_certificate_requests set state='approved',decided_by=p_actor,decided_at=clock_timestamp(),issue_id=p_issue
   where id=r.id returning * into r;
 return to_jsonb(r);
end;
$$;
revoke all on function vppsone.school_certificate_request_approve(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_approve(uuid,uuid,uuid,boolean) to service_role;

-- The stored original behind an approved request, for the person who asked or
-- an approver. A corrected copy stands in for one the office superseded; a
-- cancelled one is gone. With a command it records the download in the
-- certificate's history first (idempotent); without one it only reads.
create function vppsone.school_certificate_request_document(p_actor uuid,p_request uuid,p_command uuid default null,p_confined boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare r vppsone.school_certificate_requests; i vppsone.school_certificate_issues; replacement vppsone.school_certificate_issues; prior vppsone.school_certificate_events;
begin
 select * into r from vppsone.school_certificate_requests where id=p_request;
 if not found or not (vppsone.school_certificate_request_owner(p_actor,r,p_confined)
   or vppsone.school_office_actor_allowed(p_actor,'certificates:approve',r.session_label,p_confined)) then raise exception 'certificate_request:forbidden'; end if;
 if r.state<>'approved' then raise exception 'certificate_request:not_ready'; end if;
 select * into i from vppsone.school_certificate_issues where id=r.issue_id;
 if i.status='superseded' then
   select * into replacement from vppsone.school_certificate_issues where supersedes=i.id and status in ('prepared','issued') and artifact_state='ready' limit 1;
   if found then i:=replacement; end if;
 end if;
 if i.status not in ('prepared','issued') or i.artifact_state<>'ready' or i.storage_path is null then raise exception 'certificate_request:not_ready'; end if;
 if p_command is not null then
   select * into prior from vppsone.school_certificate_events where command_id=p_command;
   if found then
     if prior.actor_id<>p_actor or prior.issue_id<>i.id or prior.kind<>'download_requested' then raise exception 'certificate_request:command_reused'; end if;
   else
     insert into vppsone.school_certificate_events(issue_id,actor_id,kind,reason,command_id) values(i.id,p_actor,'download_requested','Through a teacher request',p_command);
   end if;
 end if;
 return jsonb_build_object('issueId',i.id,'serial',i.serial,'storagePath',i.storage_path,'sha256',i.artifact_sha256);
end;
$$;
revoke all on function vppsone.school_certificate_request_document(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_request_document(uuid,uuid,uuid,boolean) to service_role;

-- Requests as each screen needs them: 'mine' for the person who asked,
-- 'student' for anyone who may ask for that child, 'approver' for the queue.
-- Father's name and date of birth go only to an approver, who checks them
-- before signing.
create function vppsone.school_certificate_requests_list(p_actor uuid,p_session text,p_scope text,p_student uuid default null,p_confined boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare approver boolean; e vppsone.enrolments;
begin
 if p_scope not in ('mine','student','approver') or p_session is null or p_session !~ '^(TEST-)?[0-9]{4}-[0-9]{2}$' then raise exception 'certificate_request:invalid_scope'; end if;
 if p_confined and not vppsone.is_test_session(p_session) then raise exception 'certificate_request:forbidden'; end if;
 approver:=vppsone.school_office_actor_allowed(p_actor,'certificates:approve',p_session,p_confined);
 if p_scope='approver' and not approver then raise exception 'certificate_request:forbidden'; end if;
 if p_scope='student' then
   if p_student is null then raise exception 'certificate_request:invalid_scope'; end if;
   select * into e from vppsone.enrolments where student_id=p_student and session_label=p_session order by created_at desc limit 1;
   if not approver and (e.id is null or not vppsone.school_certificate_requester_allowed(p_actor,p_session,e.class_id,p_confined)) then
     raise exception 'certificate_request:forbidden';
   end if;
 end if;
 if p_scope='mine' and not exists(select 1 from vppsone.staff_profiles sp where sp.id=p_actor and sp.is_active) then raise exception 'certificate_request:forbidden'; end if;
 return coalesce((select jsonb_agg(x.item order by x.waiting desc, x.at desc) from (
   select r.state='waiting' as waiting, coalesce(r.decided_at,r.requested_at) as at, jsonb_build_object(
     'id',r.id,'studentId',r.student_id,'sessionLabel',r.session_label,'classId',r.class_id,'kind',r.kind,'purpose',r.purpose,'extras',r.extras,'note',r.note,
     'requestedBy',r.requested_by,'requestedByName',coalesce(nullif(rq.short_name,''),rq.display_name),'requestedAt',r.requested_at,
     'state',r.state,'decidedByName',coalesce(nullif(dc.short_name,''),dc.display_name),'decidedAt',r.decided_at,'declineReason',r.decline_reason,
     'issueId',d.id,'serial',d.serial,'issueStatus',d.status,
     'issueReady',coalesce(d.artifact_state='ready' and d.status in ('prepared','issued'),false),
     'signed',coalesce(d.snapshot->'school'->>'signaturePolicy'='facsimile'
       and (d.snapshot->'school' ? 'signatureAsset' or nullif(d.snapshot->'school'->>'signature','') is not null),false),
     'studentName',coalesce(s.full_name,''),'admissionNo',coalesce(s.admission_no,''),'classLabel',concat_ws(' ',c.class_name,nullif(c.section,'')),
     'mine',r.requested_by=p_actor,
     'fatherName',case when approver then s.father_name end,'dateOfBirth',case when approver then s.date_of_birth end) as item
   from vppsone.school_certificate_requests r
   join vppsone.staff_profiles rq on rq.id=r.requested_by
   left join vppsone.staff_profiles dc on dc.id=r.decided_by
   left join vppsone.school_certificate_issues i on i.id=r.issue_id
   left join lateral (select x.* from vppsone.school_certificate_issues x where x.id=coalesce(
       (select n.id from vppsone.school_certificate_issues n where i.status='superseded' and n.supersedes=i.id and n.status in ('prepared','issued') limit 1), i.id)) d on true
   left join lateral (select * from vppsone.fees_identity_students fs where fs.id=r.student_id limit 1) s on true
   left join lateral (select * from vppsone.fees_identity_classes fc where fc.id=r.class_id and fc.session_label=r.session_label limit 1) c on true
   where r.session_label=p_session and case p_scope
     when 'mine' then r.requested_by=p_actor and r.state<>'withdrawn' and (r.state='waiting' or coalesce(r.decided_at,r.requested_at)>=clock_timestamp()-interval '30 days')
     when 'student' then r.student_id=p_student and r.state<>'withdrawn'
     else r.state='waiting' or (r.state in ('approved','declined') and r.decided_at>=clock_timestamp()-interval '2 days') end
   order by r.state='waiting' desc, coalesce(r.decided_at,r.requested_at) desc
   limit case when p_scope='approver' then 100 else 20 end
 ) x),'[]'::jsonb);
end;
$$;
revoke all on function vppsone.school_certificate_requests_list(uuid,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.school_certificate_requests_list(uuid,text,text,uuid,boolean) to service_role;

notify pgrst,'reload schema';
commit;
