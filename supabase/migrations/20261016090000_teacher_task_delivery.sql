-- Task delivery extends the existing collection outbox. No new sending queue.
-- Depends on teacher_tasks and the existing collection message tables. Unapplied.
alter table vppsone.message_sends
  add column task_id uuid references vppsone.teacher_tasks(id),
  add column task_snapshot jsonb,
  add column task_round text,
  add column task_delivery_state text check (task_delivery_state in ('ready','unknown','rejected','accepted','manual_opened','human_confirmed')),
  add column task_transport text check (task_transport in ('aisensy','manual')),
  add column task_history jsonb not null default '[]';
create unique index message_sends_task_round on vppsone.message_sends(task_id,(task_snapshot->>'version'),task_round) where task_id is not null;
-- Existing screens/RLS must not expose a task's private review or bypass its gates.
create policy message_sends_task_private on vppsone.message_sends as restrictive for select to authenticated using(task_id is null);

-- Each campaign is one exact recipient-language body, independent of the office
-- reader's language. Both render columns deliberately carry that same body.
insert into vppsone.message_templates(code,label_hi,label_en,body_hi,body_en,variables,has_url_button,audience,is_active,sort_order)
select code,label_hi,label_en,body,body,array['teacher','task','due'],true,'staff',true,sort_order from (values
('vppsone_teacher_task_en_v1','शिक्षक कार्य · अंग्रेज़ी','Teacher task · English','{{1}}, task: {{2}}. Due: {{3}}. Use the button to open your work.',80),
('vppsone_teacher_task_hi_v1','शिक्षक कार्य · हिंदी','Teacher task · Hindi','{{1}}, कार्य: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।',81),
('vppsone_teacher_task_both_v1','शिक्षक कार्य · दोनों','Teacher task · Both','{{1}}, कार्य / Task: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.',82),
('vppsone_teacher_task_reminder_en_v1','कार्य याद · अंग्रेज़ी','Task reminder · English','{{1}}, work is still pending: {{2}}. Due: {{3}}. Use the button to open your work.',83),
('vppsone_teacher_task_reminder_hi_v1','कार्य याद · हिंदी','Task reminder · Hindi','{{1}}, कार्य अभी बाकी है: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।',84),
('vppsone_teacher_task_reminder_both_v1','कार्य याद · दोनों','Task reminder · Both','{{1}}, कार्य अभी बाकी है / Work is still pending: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.',85)
) as contracts(code,label_hi,label_en,body,sort_order);

create function vppsone.guard_teacher_task_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.task_id is null and exists(select 1 from vppsone.message_templates where id=new.template_id and code ~ '^[A-Za-z0-9_-]+_teacher_task(_|$)') then
    raise exception 'task_delivery:review_required';
  end if;
  if new.task_id is null and new.request_id is not null
    and current_setting('vppsone.task_delivery',true) is distinct from new.id::text
    and exists(select 1 from vppsone.teacher_tasks where request_id=new.request_id)
    and (new.status='sent' or (new.provider_message_id is not null and (tg_op='INSERT' or new.provider_message_id is distinct from old.provider_message_id))) then
    raise exception 'task_delivery:review_required';
  end if;
  if (new.task_id is not null or (tg_op='UPDATE' and old.task_id is not null))
    and current_setting('vppsone.task_delivery',true) is distinct from new.id::text then
    raise exception 'task_delivery:rpc_required';
  end if;
  return new;
end; $$;
create trigger teacher_task_delivery_guard before insert or update on vppsone.message_sends for each row execute function vppsone.guard_teacher_task_delivery();

-- Legacy requests can be adopted after a send became uncertain. Keep that gate.
create function vppsone.teacher_task_has_unknown_delivery(p_task uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from vppsone.message_sends m join vppsone.teacher_tasks t on (m.task_id=t.id or m.request_id=t.request_id) where t.id=p_task and
    (m.task_delivery_state='unknown' or (m.task_delivery_state is null and m.status='failed' and
      (m.provider_message_id is not null or not (coalesce(m.error,'') like 'Provider rejected this request: %'
        or coalesce(m.error,'') ~ '^The provider refused it \((400|401|403|404|422|429)\)\.$')))));
$$;

create function vppsone.teacher_task_delivery_snapshot(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t vppsone.teacher_tasks%rowtype; s vppsone.staff_profiles%rowtype; phone text; expected int:=0; answered int:=0; approved int:=0; rejected int:=0; pending boolean; opened timestamptz; request_token text; scope_version text;
  student_count int:=0; fields jsonb:='[]'; review_scope jsonb; class_id uuid; subject_id uuid; class_label text; subject jsonb;
begin
  select * into t from vppsone.teacher_tasks where id=p_id;
  if not found or not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null) then return null; end if;
  select * into s from vppsone.staff_profiles where id=t.assigned_staff_id;
  phone:=regexp_replace(coalesce(nullif(trim(s.whatsapp_phone),''),s.phone,''),'[^0-9]','','g');
  if length(phone)=12 and left(phone,2)='91' then phone:=substr(phone,3); end if;
  if length(phone)=11 and left(phone,1)='0' then phone:=substr(phone,2); end if;
  opened:=t.opened_at;
  if t.kind='collection' then
    select count(*)::int into student_count from vppsone.collection_request_members where request_id=t.request_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'hi',f.label_hi,'en',f.label_en) order by f.id),'[]') into fields
      from vppsone.collection_request_fields rf join vppsone.collection_fields f on f.id=rf.field_id where rf.request_id=t.request_id;
    select r.class_label into class_label from vppsone.collection_requests r where r.id=t.request_id;
    select count(*)::int into expected from vppsone.collection_request_members m cross join vppsone.collection_request_fields f where m.request_id=t.request_id and f.request_id=t.request_id;
    select count(*)::int,count(*) filter(where a.status='accepted')::int,count(*) filter(where a.status='rejected')::int into answered,approved,rejected
      from vppsone.collection_submissions a join vppsone.collection_request_members m on m.request_id=a.request_id and m.student_id=a.student_id
      join vppsone.collection_request_fields f on f.request_id=a.request_id and f.field_id=a.field_id where a.request_id=t.request_id;
    -- collection_requests.opened_at is the office's open-for-work timestamp.
    -- Only teacher_tasks.opened_at records authorized teacher access.
    select r.token into request_token from vppsone.collection_requests r where r.id=t.request_id;
    pending:=answered<expected;
    select md5(coalesce((select string_agg(m.student_id::text,',' order by m.student_id) from vppsone.collection_request_members m where m.request_id=t.request_id),'')||':'||coalesce((select string_agg(f.field_id::text,',' order by f.field_id) from vppsone.collection_request_fields f where f.request_id=t.request_id),'')) into scope_version;
  elsif t.kind='marks' then
    select a.entry_status is distinct from 'submitted',a.class_id,a.subject_id into pending,class_id,subject_id from vppsone.assessment_subjects a where a.id=t.paper_id;
    select count(*)::int,md5(string_agg(r::text,',' order by r)) into student_count,scope_version from vppsone.paper_roster(t.paper_id) r;
    select jsonb_build_object('hi',su.name_hi,'en',su.name_en) into subject from vppsone.subjects su where su.id=subject_id;
  else
    pending:=not exists(select 1 from vppsone.attendance_registers a where a.session_label=t.session_label and a.class_id=t.class_id and a.day=t.day and a.period is null and a.revision>0);
    class_id:=t.class_id;
    select count(*)::int,md5(string_agg(r::text,',' order by r)) into student_count,scope_version from vppsone.attendance_roster(t.session_label,t.class_id,t.day) r;
  end if;
  if class_id is not null then
    -- Display metadata only; no public/fee write or schema change.
    select concat_ws(' ',c.class_name,nullif(c.section,''),nullif(c.stream_name,'')) into class_label from public.classes c where c.id=class_id;
  end if;
  review_scope:=jsonb_build_object('session',t.session_label,'classLabel',class_label,'subject',subject,'day',t.day);
  return jsonb_build_object('taskId',t.id,'teacherId',t.assigned_staff_id,'phone',phone,'name',s.display_name,'title',t.title,'due',t.due_date,'language',coalesce(s.preferred_language::text,'both'),
    'studentCount',student_count,'fields',fields,'scope',review_scope,
    'pending',coalesce(pending,false),'expected',expected,'answered',answered,'approved',approved,'rejected',rejected,'openedAt',opened,
    'version',md5(jsonb_build_array(t.token,request_token,t.assigned_staff_id,t.scope,scope_version,t.title,t.due_date,phone,s.updated_at,s.display_name,s.preferred_language,student_count,fields,review_scope,t.kind,t.paper_id,class_id,subject_id)::text));
end; $$;

create function vppsone.mark_teacher_task_opened(p_id uuid,p_staff uuid default null,p_token text default null,p_request_token text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare task vppsone.teacher_tasks%rowtype;
begin
  select * into task from vppsone.teacher_tasks where id=p_id or request_id=p_id for update;
  if not found then return false; end if;
  perform 1 from vppsone.staff_profiles where id=task.assigned_staff_id for share;
  if p_request_token is not null then
    if not exists(select 1 from vppsone.collection_requests r where r.id=task.request_id and r.token=p_request_token) then return false; end if;
    if not vppsone.teacher_task_access(task.id,task.assigned_staff_id,null) then return false; end if;
  elsif not vppsone.teacher_task_access(task.id,p_staff,p_token) then return false;
  end if;
  update vppsone.teacher_tasks set opened_at=coalesce(opened_at,now()) where id=task.id;
  return true;
end; $$;

create function vppsone.teacher_task_share_link(p_actor uuid,p_task uuid) returns text language plpgsql security definer set search_path='' as $$
declare task vppsone.teacher_tasks%rowtype;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into task from vppsone.teacher_tasks where id=p_task for update;
  perform 1 from vppsone.staff_profiles where id in(p_actor,task.assigned_staff_id) order by id for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  if not found or not vppsone.teacher_task_access(task.id,task.assigned_staff_id,null) then return null; end if;
  if vppsone.teacher_task_has_unknown_delivery(p_task) then return null; end if;
  return '/t/tasks/'||task.token;
end; $$;

create function vppsone.prepare_teacher_task_delivery(p_actor uuid,p_task uuid,p_kind text) returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; preview vppsone.teacher_task_previews%rowtype; template vppsone.message_templates%rowtype; params text[];
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  if p_kind not in ('initial','reminder') or p_kind is null then raise exception 'task_delivery:kind'; end if;
  perform 1 from vppsone.teacher_tasks where id=p_task for update;
  perform 1 from vppsone.staff_profiles where id in(p_actor,(select assigned_staff_id from vppsone.teacher_tasks where id=p_task)) order by id for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  snapshot:=vppsone.teacher_task_delivery_snapshot(p_task);
  if snapshot is null then return jsonb_build_object('ok',false,'reason','changed'); end if;
  if not (snapshot->>'pending')::boolean then return jsonb_build_object('ok',false,'reason','complete'); end if;
  if snapshot->>'phone' !~ '^[6-9][0-9]{9}$' then return jsonb_build_object('ok',false,'reason','phone'); end if;
  select * into template from vppsone.message_templates where code='vppsone_teacher_task'||case when p_kind='reminder' then '_reminder' else '' end||'_'||(snapshot->>'language')||'_v1' and is_active and audience='staff';
  if not found then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  snapshot:=snapshot||jsonb_build_object('authorityVersion',snapshot->>'version','templateVersion',md5(to_jsonb(template)::text),'version',md5((snapshot->>'version')||md5(to_jsonb(template)::text)));
  params:=array[snapshot->>'name',snapshot->>'title',coalesce(snapshot->>'due','—')];
  insert into vppsone.teacher_task_previews(actor_id,payload) values(p_actor,jsonb_build_object('delivery',snapshot,'kind',p_kind,'round',case when p_kind='initial' then 'initial' else 'reminder:'||vppsone.school_today()::text end)) returning * into preview;
  return snapshot - 'version' - 'authorityVersion' - 'templateVersion' || jsonb_build_object('ok',true,'id',preview.id,'digest',preview.digest,'kind',p_kind,
    'textHi',replace(replace(replace(template.body_hi,'{{1}}',params[1]),'{{2}}',params[2]),'{{3}}',params[3]),
    'textEn',replace(replace(replace(template.body_en,'{{1}}',params[1]),'{{2}}',params[2]),'{{3}}',params[3]));
end; $$;

create function vppsone.queue_teacher_task_delivery(p_actor uuid,p_preview uuid,p_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare preview vppsone.teacher_task_previews%rowtype; snapshot jsonb; task uuid; msg uuid; template vppsone.message_templates%rowtype; params text[]; round text;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into preview from vppsone.teacher_task_previews where id=p_preview and actor_id=p_actor and digest=p_digest;
  if not found or preview.expires_at<now() or preview.payload->'delivery' is null then return jsonb_build_object('ok',false,'reason','changed'); end if;
  task:=(preview.payload->'delivery'->>'taskId')::uuid;
  -- Every enqueue/claim takes task before message row. Management also locks task.
  perform 1 from vppsone.teacher_tasks where id=task for update;
  perform 1 from vppsone.staff_profiles where id in(p_actor,(select assigned_staff_id from vppsone.teacher_tasks where id=task)) order by id for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  snapshot:=vppsone.teacher_task_delivery_snapshot(task);
  if snapshot is null or snapshot->>'version' is distinct from preview.payload->'delivery'->>'authorityVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  if not (snapshot->>'pending')::boolean then return jsonb_build_object('ok',false,'reason','complete'); end if;
  if vppsone.teacher_task_has_unknown_delivery(task) then return jsonb_build_object('ok',false,'reason','reconcile'); end if;
  select * into template from vppsone.message_templates where code='vppsone_teacher_task'||case when preview.payload->>'kind'='reminder' then '_reminder' else '' end||'_'||(snapshot->>'language')||'_v1' and is_active and audience='staff';
  if not found or md5(to_jsonb(template)::text) is distinct from preview.payload->'delivery'->>'templateVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  snapshot:=preview.payload->'delivery';
  round:=preview.payload->>'round';
  if preview.payload->>'kind'='reminder' and round is distinct from 'reminder:'||vppsone.school_today()::text then return jsonb_build_object('ok',false,'reason','changed'); end if;
  select id into msg from vppsone.message_sends where task_id=task and task_snapshot->>'version'=snapshot->>'version' and task_round=round;
  if found then
    -- The caller reviewed this exact immutable row again; another office actor
    -- may continue it only through a fresh actor-bound preview.
    perform set_config('vppsone.task_delivery',msg::text,true);
    update vppsone.message_sends set requested_by=p_actor where id=msg and task_delivery_state in ('ready','rejected');
    return jsonb_build_object('ok',true,'id',msg);
  end if;
  params:=array[snapshot->>'name',snapshot->>'title',coalesce(snapshot->>'due','—')];
  msg:=gen_random_uuid();perform set_config('vppsone.task_delivery',msg::text,true);
  insert into vppsone.message_sends(id,session_label,template_id,to_phone,to_name,staff_profile_id,variables,rendered_hi,rendered_en,status,requested_by,task_id,task_snapshot,task_round,task_delivery_state)
    select msg,t.session_label,template.id,snapshot->>'phone',snapshot->>'name',t.assigned_staff_id,params,
      replace(replace(replace(template.body_hi,'{{1}}',params[1]),'{{2}}',params[2]),'{{3}}',params[3]),
      replace(replace(replace(template.body_en,'{{1}}',params[1]),'{{2}}',params[2]),'{{3}}',params[3]),
      'queued',p_actor,task,snapshot,round,'ready' from vppsone.teacher_tasks t where id=task;
  return jsonb_build_object('ok',true,'id',msg);
end; $$;

create function vppsone.claim_teacher_task_delivery(p_actor uuid,p_id uuid,p_attempt text,p_transport text,p_manual boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare msg vppsone.message_sends%rowtype; task uuid; snapshot jsonb; token text; campaign text; template_version text;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  if (p_manual and p_transport<>'manual') or (not p_manual and (p_transport<>'aisensy' or p_attempt not like 'attempt:%')) then raise exception 'task_delivery:transport'; end if;
  select task_id into task from vppsone.message_sends where id=p_id;
  if task is null then return jsonb_build_object('ok',false,'reason','changed'); end if;
  perform 1 from vppsone.teacher_tasks where id=task for update;
  perform 1 from vppsone.staff_profiles where id in(p_actor,(select assigned_staff_id from vppsone.teacher_tasks where id=task)) order by id for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into msg from vppsone.message_sends where id=p_id for update;
  if vppsone.teacher_task_has_unknown_delivery(task) then return jsonb_build_object('ok',false,'reason','reconcile'); end if;
  if msg.task_delivery_state not in ('ready','rejected') then return jsonb_build_object('ok',false,'reason','already_handled'); end if;
  snapshot:=vppsone.teacher_task_delivery_snapshot(task);
  if msg.requested_by is distinct from p_actor or snapshot is null or snapshot->>'version' is distinct from msg.task_snapshot->>'authorityVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  if not (snapshot->>'pending')::boolean then return jsonb_build_object('ok',false,'reason','complete'); end if;
  if msg.task_round like 'reminder:%' and msg.task_round is distinct from 'reminder:'||vppsone.school_today()::text then return jsonb_build_object('ok',false,'reason','changed'); end if;
  select mt.code,md5(to_jsonb(mt)::text) into campaign,template_version from vppsone.message_templates mt where mt.id=msg.template_id and mt.is_active and mt.audience='staff';
  if campaign not in ('vppsone_teacher_task_en_v1','vppsone_teacher_task_hi_v1','vppsone_teacher_task_both_v1','vppsone_teacher_task_reminder_en_v1','vppsone_teacher_task_reminder_hi_v1','vppsone_teacher_task_reminder_both_v1') or campaign is null then return jsonb_build_object('ok',false,'reason','unavailable'); end if;
  if template_version is distinct from msg.task_snapshot->>'templateVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  select t.token into token from vppsone.teacher_tasks t where id=task;
  perform set_config('vppsone.task_delivery',p_id::text,true);
  update vppsone.message_sends set status=case when p_manual then 'sent'::vppsone.send_status else 'failed'::vppsone.send_status end,
    sent_at=case when p_manual then now() else null end,provider_message_id=case when p_manual then null else p_attempt end,
    error=case when p_manual then null else 'Provider result unknown; reconcile before another send.' end,
    task_transport=p_transport,task_delivery_state=case when p_manual then 'manual_opened' else 'unknown' end,
    task_history=task_history||jsonb_build_array(jsonb_build_object('event',case when p_manual then 'manual_opened' else 'claim' end,'attempt',p_attempt,'actor',p_actor,'at',now(),'transport',p_transport)) where id=p_id;
  return jsonb_build_object('ok',true,'taskId',task,'path','/t/tasks/'||token,'buttonSuffix',token,'phone',msg.to_phone,'name',msg.to_name,'campaign',campaign,'params',msg.variables,'text',msg.rendered_en);
end; $$;

create function vppsone.finish_teacher_task_delivery(p_actor uuid,p_id uuid,p_attempt text,p_outcome text,p_receipt text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare msg vppsone.message_sends%rowtype;
begin
  select * into msg from vppsone.message_sends where id=p_id for update;
  if not found or msg.task_id is null or msg.requested_by is distinct from p_actor or msg.provider_message_id is distinct from p_attempt or msg.task_delivery_state<>'unknown' then return jsonb_build_object('ok',false,'reason','reconcile'); end if;
  if p_outcome is null or p_outcome not in ('accepted','rejected','unknown') or (p_outcome='accepted' and (nullif(trim(p_receipt),'') is null or p_receipt like 'mock:%')) then raise exception 'task_delivery:outcome'; end if;
  perform set_config('vppsone.task_delivery',p_id::text,true);
  update vppsone.message_sends set status=case when p_outcome='accepted' then 'sent'::vppsone.send_status else 'failed'::vppsone.send_status end,
    sent_at=case when p_outcome='accepted' then now() else null end,task_delivery_state=p_outcome,
    provider_message_id=case when p_outcome='accepted' then p_receipt when p_outcome='rejected' then null else p_attempt end,
    error=case when p_outcome='accepted' then null when p_outcome='rejected' then 'Provider rejected this request: confirmed refusal' else 'Provider result unknown; reconcile before another send.' end,
    task_history=task_history||jsonb_build_array(jsonb_build_object('event',p_outcome,'attempt',p_attempt,'actor',p_actor,'at',now(),'receipt',p_receipt)) where id=p_id;
  return jsonb_build_object('ok',true);
end; $$;

create function vppsone.reconcile_teacher_task_delivery(p_actor uuid,p_id uuid,p_attempt text,p_resolution text,p_note text) returns boolean language plpgsql security definer set search_path='' as $$
declare msg vppsone.message_sends%rowtype; task uuid;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  if p_resolution is null or p_resolution not in ('accepted','not_sent') or p_note is null or length(trim(p_note)) not between 5 and 500 then raise exception 'task_delivery:evidence'; end if;
  select t.id into task from vppsone.message_sends m join vppsone.teacher_tasks t on(m.task_id=t.id or m.request_id=t.request_id) where m.id=p_id;
  if not found then return false; end if;
  perform 1 from vppsone.teacher_tasks where id=task for update;
  perform 1 from vppsone.staff_profiles where id=p_actor for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into msg from vppsone.message_sends where id=p_id for update;
  if not found or (msg.task_id is null and not exists(select 1 from vppsone.teacher_tasks where request_id=msg.request_id))
    or msg.provider_message_id is distinct from p_attempt or not coalesce((msg.task_delivery_state='unknown' or
      (msg.task_delivery_state is null and msg.status='failed' and (msg.provider_message_id is not null or not
        (coalesce(msg.error,'') like 'Provider rejected this request: %' or coalesce(msg.error,'') ~ '^The provider refused it \((400|401|403|404|422|429)\)\.$')))),false) then return false; end if;
  perform set_config('vppsone.task_delivery',p_id::text,true);
  update vppsone.message_sends set status=case when p_resolution='accepted' then 'sent'::vppsone.send_status else 'failed'::vppsone.send_status end,
    sent_at=case when p_resolution='accepted' then now() else null end,task_delivery_state=case when p_resolution='accepted' then 'human_confirmed' else 'rejected' end,
    provider_message_id=case when p_resolution='accepted' then 'confirmed:'||coalesce(p_attempt,'legacy:'||p_id::text) else null end,
    error=case when p_resolution='accepted' then null else 'Provider rejected this request: human checked not sent' end,
    task_history=task_history||jsonb_build_array(jsonb_build_object('event','reconcile','resolution',p_resolution,'attempt',p_attempt,'actor',p_actor,'at',now(),'note',trim(p_note))) where id=p_id;
  return true;
end; $$;

create function vppsone.teacher_task_delivery_summary(p_actor uuid,p_task uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; deliveries jsonb;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  snapshot:=vppsone.teacher_task_delivery_snapshot(p_task);
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'state',coalesce(m.task_delivery_state,
    case when m.status='failed' and (m.provider_message_id is not null or not (coalesce(m.error,'') like 'Provider rejected this request: %' or coalesce(m.error,'') ~ '^The provider refused it \((400|401|403|404|422|429)\)\.$')) then 'unknown' else 'legacy_recorded' end),
    'transport',m.task_transport,'phone',m.to_phone,'at',m.requested_at,'round',coalesce(m.task_round,'legacy'),'attempt',m.provider_message_id,'history',m.task_history) order by m.requested_at desc,m.id),'[]') into deliveries from vppsone.message_sends m join vppsone.teacher_tasks t on(m.task_id=t.id or m.request_id=t.request_id) where t.id=p_task;
  return coalesce(snapshot-'version','{}')||jsonb_build_object('deliveries',deliveries);
end; $$;

revoke all on function vppsone.guard_teacher_task_delivery(),vppsone.teacher_task_delivery_snapshot(uuid),vppsone.prepare_teacher_task_delivery(uuid,uuid,text),vppsone.queue_teacher_task_delivery(uuid,uuid,text),vppsone.claim_teacher_task_delivery(uuid,uuid,text,text,boolean),vppsone.finish_teacher_task_delivery(uuid,uuid,text,text,text),vppsone.reconcile_teacher_task_delivery(uuid,uuid,text,text,text),vppsone.teacher_task_delivery_summary(uuid,uuid) from public,anon,authenticated;
grant execute on function vppsone.prepare_teacher_task_delivery(uuid,uuid,text),vppsone.queue_teacher_task_delivery(uuid,uuid,text),vppsone.claim_teacher_task_delivery(uuid,uuid,text,text,boolean),vppsone.finish_teacher_task_delivery(uuid,uuid,text,text,text),vppsone.reconcile_teacher_task_delivery(uuid,uuid,text,text,text),vppsone.teacher_task_delivery_summary(uuid,uuid) to service_role;
revoke all on function vppsone.mark_teacher_task_opened(uuid,uuid,text,text),vppsone.teacher_task_share_link(uuid,uuid) from public,anon,authenticated;
grant execute on function vppsone.mark_teacher_task_opened(uuid,uuid,text,text),vppsone.teacher_task_share_link(uuid,uuid) to service_role;
revoke all on function vppsone.teacher_task_has_unknown_delivery(uuid) from public,anon,authenticated;
