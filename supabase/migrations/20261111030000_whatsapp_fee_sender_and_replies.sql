-- One and the Fees app kept apart on WhatsApp, and One keeps only what is its
-- own (owner, 11 Nov 2026: "keep both the apps separate", and "yes, fix them"
-- for the gaps found in the review of the school's WhatsApp hub).
--
--  * `whatsapp_fee_sender` in `runtime_flags`: who sends fee reminders,
--    receipts, reversal notices and fee statements to parents. `fees` = the
--    Fees app, from its own AiSensy number, and One refuses them
--    (platform/whatsapp/policy.ts FEES_APP_FEATURES). Only `one`, written on
--    the owner's word once the Fees app has stopped sending them, lets One.
--  * `whatsapp_record_status` no longer writes an event for a message One did
--    not send (the hub forwards every status on the school's number; the
--    hub's own dashboard, bot and broadcasts are not One's business).
--  * `whatsapp-templates`: pg_cron reads the hub's template list through One
--    once an hour (minute 17), so an approval whose webhook was lost still
--    reaches One. Same Vault secret as the queue.
--  * The copies One had made of messages that were not replies to One, and of
--    statuses for messages One never sent, are removed: the hub keeps the
--    originals in its own inbox.
--
-- Rollback:
--   select cron.unschedule('whatsapp-templates');
--   delete from vppsone.runtime_flags where key = 'whatsapp_fee_sender';
--   (restore runtime_flags_key_known and whatsapp_record_status from 20261109062459.)

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------- who sends what

alter table vppsone.runtime_flags drop constraint if exists runtime_flags_key_known;
alter table vppsone.runtime_flags add constraint runtime_flags_key_known check (
  key in (
    'cover_command',
    'staff_notice_dispatch',
    'fault_injection',
    'parent_dispatch',
    'parent_dispatch_categories',
    'absent_notice_owner',
    'parent_dispatch_test_only',
    'staff_notice_kinds_enabled',
    'staff_whatsapp_month_cap',
    'staff_notice_student_names',
    'aisensy_month_plan_cap',
    'ai_connection',
    'whatsapp_dry_run',
    'whatsapp_features',
    'whatsapp_real_recipients',
    'whatsapp_owner_test_number',
    'whatsapp_daily_limit',
    'whatsapp_month_plan_cap',
    'whatsapp_fee_sender'
  )
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('whatsapp_fee_sender', true, '"fees"'::jsonb,
   'Who sends fee reminders, receipts, reversal notices and fee statements to parents. "fees" = the Fees app from its own number, and One refuses them. "one" only on the owner''s word, once the Fees app has stopped sending them.')
on conflict (key) do nothing;

-- ------------------------------------------- statuses for One's own messages

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

-- --------------------------------------------- only what is One's, kept

delete from vppsone.whatsapp_message_events e
 where e.message_id is null and e.event = 'status';

-- A reply to One quotes a message One sent, or comes within 7 days after One
-- messaged that number (platform/whatsapp/store.ts isReplyToOne).
delete from vppsone.whatsapp_inbound i
 where i.reply_to_message_id is null
   and not exists (
     select 1 from vppsone.whatsapp_messages m
      where m.to_e164 = i.from_e164
        and m.provider_message_id is not null
        and m.created_at <= i.received_at
        and m.created_at >= i.received_at - interval '7 days'
   );

-- ------------------------------------------------------- the hourly check

select cron.unschedule('whatsapp-templates')
 where exists (select 1 from cron.job where jobname = 'whatsapp-templates');

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
