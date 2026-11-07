-- Noting a WhatsApp send for a teacher's task failed on live (found on a real
-- phone, 7 Nov 2026): queue_teacher_task_delivery stopped with
--   column reference "snapshot" is ambiguous
-- message_sends gained its own `snapshot` column in 20261004084641
-- (parent message policy), before task delivery was written, and PL/pgSQL
-- refuses a bare name that is both a variable and a column. So no task
-- delivery could ever be queued: the board kept saying "Link not sent".
--
-- The same function, unchanged in what it decides. Its variables are now
-- named through the block label wherever a statement reads a table, so a
-- column added later cannot take their place again. Grants are restated.
create or replace function vppsone.queue_teacher_task_delivery(p_actor uuid,p_preview uuid,p_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
<<q>>
declare preview vppsone.teacher_task_previews%rowtype; snapshot jsonb; task uuid; msg uuid; template vppsone.message_templates%rowtype; params text[]; round text;
begin
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  select * into preview from vppsone.teacher_task_previews where id=p_preview and actor_id=p_actor and digest=p_digest;
  if not found or preview.expires_at<now() or preview.payload->'delivery' is null then return jsonb_build_object('ok',false,'reason','changed'); end if;
  task:=(preview.payload->'delivery'->>'taskId')::uuid;
  -- Every enqueue/claim takes task before message row. Management also locks task.
  perform 1 from vppsone.teacher_tasks where id=q.task for update;
  perform 1 from vppsone.staff_profiles where id in(p_actor,(select assigned_staff_id from vppsone.teacher_tasks where id=q.task)) order by id for share;
  if not exists(select 1 from vppsone.staff_profiles s join vppsone.role_permissions rp on rp.role=s.role where s.id=p_actor and s.is_active and rp.permission='collection:manage') then raise exception 'tasks:not_permitted'; end if;
  snapshot:=vppsone.teacher_task_delivery_snapshot(task);
  if snapshot is null or snapshot->>'version' is distinct from preview.payload->'delivery'->>'authorityVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  if not (snapshot->>'pending')::boolean then return jsonb_build_object('ok',false,'reason','complete'); end if;
  if vppsone.teacher_task_has_unknown_delivery(task) then return jsonb_build_object('ok',false,'reason','reconcile'); end if;
  select * into template from vppsone.message_templates where code='vppsone_teacher_task'||case when preview.payload->>'kind'='reminder' then '_reminder' else '' end||'_'||(q.snapshot->>'language')||'_v1' and is_active and audience='staff';
  if not found or md5(to_jsonb(template)::text) is distinct from preview.payload->'delivery'->>'templateVersion' then return jsonb_build_object('ok',false,'reason','changed'); end if;
  snapshot:=preview.payload->'delivery';
  round:=preview.payload->>'round';
  if preview.payload->>'kind'='reminder' and round is distinct from 'reminder:'||vppsone.school_today()::text then return jsonb_build_object('ok',false,'reason','changed'); end if;
  -- message_sends has its own `snapshot` column (20261004084641), so every
  -- variable read next to a table is named through the block label.
  select m.id into msg from vppsone.message_sends m where m.task_id=q.task and m.task_snapshot->>'version'=q.snapshot->>'version' and m.task_round=q.round;
  if found then
    -- The caller reviewed this exact immutable row again; another office actor
    -- may continue it only through a fresh actor-bound preview.
    perform set_config('vppsone.task_delivery',msg::text,true);
    update vppsone.message_sends set requested_by=p_actor where id=q.msg and task_delivery_state in ('ready','rejected');
    return jsonb_build_object('ok',true,'id',msg);
  end if;
  params:=array[snapshot->>'name',snapshot->>'title',coalesce(snapshot->>'due','—')];
  msg:=gen_random_uuid();perform set_config('vppsone.task_delivery',msg::text,true);
  insert into vppsone.message_sends(id,session_label,template_id,to_phone,to_name,staff_profile_id,variables,rendered_hi,rendered_en,status,requested_by,task_id,task_snapshot,task_round,task_delivery_state)
    select q.msg,t.session_label,q.template.id,q.snapshot->>'phone',q.snapshot->>'name',t.assigned_staff_id,q.params,
      replace(replace(replace(q.template.body_hi,'{{1}}',q.params[1]),'{{2}}',q.params[2]),'{{3}}',q.params[3]),
      replace(replace(replace(q.template.body_en,'{{1}}',q.params[1]),'{{2}}',q.params[2]),'{{3}}',q.params[3]),
      'queued',p_actor,q.task,q.snapshot,q.round,'ready' from vppsone.teacher_tasks t where t.id=q.task;
  return jsonb_build_object('ok',true,'id',msg);
end; $$;

revoke all on function vppsone.queue_teacher_task_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function vppsone.queue_teacher_task_delivery(uuid,uuid,text) to service_role;
