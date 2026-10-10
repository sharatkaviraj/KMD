-- Messages (design `Messages`): queue a notice and every recipient row in one
-- transaction, idempotent on the campaign's client_request_id. Rows are only
-- ever queued here; nothing in this function sends, and parent rows still stop
-- at the queue behind vppsone.runtime_flags.parent_dispatch (D-10).

create or replace function vppsone.queue_message_campaign(
  p_campaign jsonb,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = vppsone, pg_temp
as $$
declare
  v_id uuid;
  v_request uuid := (p_campaign->>'client_request_id')::uuid;
  v_count integer;
begin
  if v_request is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select id into v_id from vppsone.message_campaigns where client_request_id = v_request;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'campaign_id', v_id, 'duplicate', true);
  end if;

  v_count := jsonb_array_length(p_rows);

  insert into vppsone.message_campaigns (
    session_label, kind, title, body_hi, body_en, language, audience, class_ids,
    audience_label, recipient_count, cost_paise, status, client_request_id, created_by
  ) values (
    p_campaign->>'session_label',
    p_campaign->>'kind',
    p_campaign->>'title',
    p_campaign->>'body_hi',
    p_campaign->>'body_en',
    coalesce(p_campaign->>'language', 'both'),
    p_campaign->>'audience',
    coalesce(array(select jsonb_array_elements_text(p_campaign->'class_ids'))::uuid[], '{}'::uuid[]),
    p_campaign->>'audience_label',
    v_count,
    v_count * 88,
    'queued',
    v_request,
    (p_campaign->>'created_by')::uuid
  )
  on conflict (client_request_id) do nothing
  returning id into v_id;

  if v_id is null then
    -- A concurrent post with the same request id won the race.
    select id into v_id from vppsone.message_campaigns where client_request_id = v_request;
    return jsonb_build_object('ok', true, 'campaign_id', v_id, 'duplicate', true);
  end if;

  insert into vppsone.message_sends (
    session_label, template_id, to_phone, to_name, student_id, staff_profile_id,
    variables, rendered_hi, rendered_en, status, requested_by, category, snapshot, campaign_id
  )
  select
    p_campaign->>'session_label',
    (r->>'template_id')::uuid,
    r->>'to_phone',
    r->>'to_name',
    nullif(r->>'student_id', '')::uuid,
    nullif(r->>'staff_profile_id', '')::uuid,
    coalesce(array(select jsonb_array_elements_text(r->'variables')), '{}'::text[]),
    coalesce(r->>'rendered_hi', ''),
    coalesce(r->>'rendered_en', ''),
    'queued',
    (p_campaign->>'created_by')::uuid,
    coalesce(r->>'category', 'general'),
    r->'snapshot',
    v_id
  from jsonb_array_elements(p_rows) as r;

  return jsonb_build_object('ok', true, 'campaign_id', v_id, 'duplicate', false, 'count', v_count);
end;
$$;

revoke all on function vppsone.queue_message_campaign(jsonb, jsonb) from public, anon, authenticated;
grant execute on function vppsone.queue_message_campaign(jsonb, jsonb) to service_role;
