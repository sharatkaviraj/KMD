-- U03 (19 Oct assessment brief): a rejected photograph carries the reason the
-- teacher sees ("Changes requested: ..."). Additive: one nullable column, a
-- four-argument review that records it, and the three-argument review kept
-- as a wrapper so nothing calling it changes. Same locks, checks and grants as
-- 20261016080000_profile_photos.sql; the official photograph still changes
-- only on approval. Rollback: drop the 4-arg function, restore the 3-arg body
-- from 20261016080000, drop the column.

alter table vppsone.photo_proposals
  add column if not exists decision_note text
  check (decision_note is null or char_length(decision_note) between 1 and 300);

create or replace function vppsone.review_student_photo(p_actor uuid,p_proposal uuid,p_accept boolean,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare proposal vppsone.photo_proposals%rowtype; t vppsone.teacher_tasks%rowtype;
  answer vppsone.collection_submissions%rowtype; result jsonb; request uuid;
  note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if not exists(select 1 from vppsone.staff_profiles where id=p_actor and is_active and role='admin') then raise exception 'photos:admin_required'; end if;
  if note is not null and char_length(note)>300 then raise exception 'photos:bad_request'; end if;
  select request_id into request from vppsone.photo_proposals where command_id=p_proposal;
  select * into t from vppsone.teacher_tasks where request_id=request for update;
  if found and not vppsone.teacher_task_access(t.id,t.assigned_staff_id,null) then raise exception 'photos:not_permitted'; end if;
  perform 1 from vppsone.collection_requests where id=request and status='open' and archived_at is null for update;
  if not found then raise exception 'photos:not_permitted'; end if;
  select * into proposal from vppsone.photo_proposals where command_id=p_proposal for update;
  if not found then raise exception 'photos:not_found'; end if;
  select * into answer from vppsone.collection_submissions where request_id=request and student_id=proposal.student_id and field_id=proposal.field_id for update;
  if answer.value is distinct from p_proposal::text then raise exception 'photos:stale'; end if;
  if proposal.decision<>'pending' then
    if (proposal.decision='accepted')=p_accept then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'photos:decided';
  end if;
  if p_accept then
    result := vppsone.place_student_photo(proposal.payload||jsonb_build_object('actor_staff_id',p_actor,
      'payload_hash',md5(proposal.payload::text),'expected_current',proposal.expected_current));
    if result->>'ok' is distinct from 'true' then return result; end if;
  end if;
  update vppsone.photo_proposals set decision=case when p_accept then 'accepted' else 'rejected' end,decided_by=p_actor,
    decision_note=case when p_accept then null else note end
    where command_id=p_proposal;
  update vppsone.collection_submissions set status=(case when p_accept then 'accepted' else 'rejected' end)::vppsone.submission_status,
    decided_by=p_actor,decided_at=now() where id=answer.id;
  return jsonb_build_object('ok',true,'replayed',false);
end; $$;

create or replace function vppsone.review_student_photo(p_actor uuid,p_proposal uuid,p_accept boolean) returns jsonb
language sql security definer set search_path='' as $$
  select vppsone.review_student_photo(p_actor,p_proposal,p_accept,null::text);
$$;

revoke all on function vppsone.review_student_photo(uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function vppsone.review_student_photo(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function vppsone.review_student_photo(uuid,uuid,boolean,text) to service_role;
grant execute on function vppsone.review_student_photo(uuid,uuid,boolean) to service_role;
