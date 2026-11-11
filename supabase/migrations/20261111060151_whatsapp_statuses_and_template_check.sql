-- One keeps only statuses for its own messages, and checks the hub's templates
-- hourly (owner, 11 Nov 2026: "yes, fix them" for the gaps found in the review
-- of the school's WhatsApp hub). D-571, D-572.
--
--  * `whatsapp_record_status` no longer writes an event for a message One did
--    not send (the hub forwards every status on the school's number; the
--    hub's own dashboard, bot and broadcasts are not One's business).
--  * `whatsapp-templates`: pg_cron reads the hub's template list through One
--    once an hour (minute 17), so an approval whose webhook was lost still
--    reaches One. Same Vault secret as the queue.
--
-- Rollback:
--   select cron.unschedule('whatsapp-templates');
--   (restore whatsapp_record_status from 20261109062459.)

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create or replace function vppsone.whatsapp_record_status(
  p_provider_message_id text,
  p_status text,
  p_at timestamptz,
  p_error_code text,
  p_error_title text,
  p_detail jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_current text;
  v_source_table text;
  v_source_id text;
  v_at timestamptz := coalesce(p_at, now());
  v_changed boolean := false;
  v_rank_new integer;
  v_rank_current integer;
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'whatsapp_status:unknown';
  end if;

  select m.id, m.status, m.source_table, m.source_id
    into v_id, v_current, v_source_table, v_source_id
    from vppsone.whatsapp_messages m
   where m.provider_message_id = p_provider_message_id
   for update;

  -- Not a message One sent: nothing to write, and no trace kept.
  if v_id is null then
    return jsonb_build_object('matched', false, 'changed', false, 'id', null,
      'previous', null, 'source_table', null, 'source_id', null);
  end if;

  v_rank_new := case p_status when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;
  v_rank_current := case v_current when 'accepted' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;

  if p_status = 'failed' then
    if v_current in ('accepted', 'sent', 'unknown', 'sending') then
      update vppsone.whatsapp_messages m
         set status = 'failed', failed_at = v_at, error_code = p_error_code,
             error_title = p_error_title, updated_at = now()
       where m.id = v_id;
      v_changed := true;
    end if;
  elsif v_current <> 'failed' and v_rank_new > v_rank_current then
    update vppsone.whatsapp_messages m
       set status = p_status,
           sent_at = coalesce(m.sent_at, v_at),
           delivered_at = case when p_status in ('delivered', 'read') then coalesce(m.delivered_at, v_at) else m.delivered_at end,
           read_at = case when p_status = 'read' then coalesce(m.read_at, v_at) else m.read_at end,
           updated_at = now()
     where m.id = v_id;
    v_changed := true;
  end if;

  insert into vppsone.whatsapp_message_events (message_id, provider_message_id, event, status, error_code, error_title, occurred_at, detail)
  values (v_id, p_provider_message_id, 'status', p_status, p_error_code, p_error_title, v_at, p_detail);

  return jsonb_build_object('matched', true, 'changed', v_changed, 'id', v_id,
    'previous', v_current, 'source_table', v_source_table, 'source_id', v_source_id);
end;
$$;

revoke all on function vppsone.whatsapp_record_status(text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_record_status(text, text, timestamptz, text, text, jsonb) to service_role;

select cron.schedule(
  'whatsapp-templates',
  '17 * * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/whatsapp-templates',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

commit;
