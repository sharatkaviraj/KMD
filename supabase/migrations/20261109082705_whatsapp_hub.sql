-- One talks to the school's WhatsApp hub (D-566, after D-562).
--
-- The hub (https://vpps-whatsapp-hub.raj-39e.workers.dev, repo
-- veerpatta/vpps-whatsapp-hub) owns +91 83022 07823 on Meta's Cloud API. One
-- sends through it with Meta's own JSON and its own key (WHATSAPP_HUB_KEY,
-- server-only). The fees app keeps its AiSensy number (+91 80 4713 6289) and
-- nothing here touches it.
--
-- What this adds, all in `vppsone`:
--
--  * `whatsapp_templates.quality` and `.submitted_at`: the hub's quality
--    rating for an approved template, and when One handed a template to Meta
--    for review (Settings -> WhatsApp -> Send for approval). A row sent from
--    here and not yet in the hub's list reads `pending`, not `not_submitted`.
--  * `whatsapp_messages.status_polls` and `.status_polled_at`: the hub's
--    webhook is best-effort, so the queue job also asks the hub
--    (`GET /v1/status/{wamid}`) about messages it has not heard back on. Each
--    message is asked at most four times, ten minutes, an hour, four hours and
--    sixteen hours after it went, and never after two days.
--  * `whatsapp_poll_is_due` (the rule) and `whatsapp_take_pollable` (the
--    lease, like `whatsapp_take_due`).
--  * The queue's timer now also wakes One when a message is due a poll.
--  * 22 `_v8` registry rows: the `_v7` fee reminders with Pay now, word for
--    word, under new names for the hub's account. `_v7` was submitted on
--    AiSensy's account for the fees number, which One never uses. Every row
--    starts `not_submitted`; only the hub's list can make one `approved`.
--
-- Rollback (nothing else depends on these):
--   select cron.schedule('whatsapp-queue', '*/5 * * * *', <the command from 20261109062459>);
--   drop function vppsone.whatsapp_take_pollable(integer), vppsone.whatsapp_poll_is_due(vppsone.whatsapp_messages);
--   drop index vppsone.whatsapp_messages_pollable_idx;
--   alter table vppsone.whatsapp_messages drop column status_polls, drop column status_polled_at;
--   alter table vppsone.whatsapp_templates drop column quality, drop column submitted_at;
--   delete from vppsone.whatsapp_templates where key like '%\_v8' and status = 'not_submitted';

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- --------------------------------------------------------------- registry

alter table vppsone.whatsapp_templates
  add column quality text,
  add column submitted_at timestamptz;

comment on column vppsone.whatsapp_templates.quality is
  'D-566: the hub''s quality rating for this template (GREEN / YELLOW / RED / UNKNOWN), from GET /v1/templates.';
comment on column vppsone.whatsapp_templates.submitted_at is
  'D-566: when One sent this template to Meta for review through the hub (POST /v1/templates). Null when it was never sent from One.';

comment on table vppsone.whatsapp_templates is
  'D-562/D-566: templates on the school''s own WhatsApp account (+91 83022 07823). A message goes out only under a row whose status is approved, and only the hub''s template list (Settings -> WhatsApp -> Check templates) makes a row approved. Nobody marks one by hand.';

-- ------------------------------------------------------------- status poll

alter table vppsone.whatsapp_messages
  add column status_polls integer not null default 0,
  add column status_polled_at timestamptz,
  add constraint whatsapp_messages_status_polls_range check (status_polls between 0 and 10);

create index whatsapp_messages_pollable_idx
  on vppsone.whatsapp_messages (created_at)
  where provider = 'hub' and status in ('accepted', 'sent') and provider_message_id is not null;

/*
 * Is this message due a question to the hub? Only the hub's own messages
 * that have gone and not been delivered, read or failed; at most four times,
 * ten minutes, an hour, four hours and sixteen hours after the send; never
 * after two days (a phone that has been off that long is not news).
 */
create function vppsone.whatsapp_poll_is_due(m vppsone.whatsapp_messages)
returns boolean
language sql
stable
set search_path = ''
as $$
  select m.provider = 'hub'
     and m.status in ('accepted', 'sent')
     and m.provider_message_id is not null
     and m.status_polls < 4
     and coalesce(m.last_attempt_at, m.created_at) > now() - interval '48 hours'
     and coalesce(m.last_attempt_at, m.created_at)
         + case m.status_polls
             when 0 then interval '10 minutes'
             when 1 then interval '1 hour'
             when 2 then interval '4 hours'
             else interval '16 hours'
           end <= now();
$$;

revoke all on function vppsone.whatsapp_poll_is_due(vppsone.whatsapp_messages) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_poll_is_due(vppsone.whatsapp_messages) to service_role;

/*
 * The queue job's poll lease: up to `p_limit` messages due a question, each
 * counted as asked in the same statement, so two runs at once never ask
 * about the same message and a hub that never answers costs four questions.
 */
create function vppsone.whatsapp_take_pollable(p_limit integer)
returns setof vppsone.whatsapp_messages
language sql
security definer
set search_path = ''
as $$
  update vppsone.whatsapp_messages m
     set status_polls = m.status_polls + 1, status_polled_at = now()
   where m.id in (
     select d.id from vppsone.whatsapp_messages d
      where d.provider = 'hub' and d.status in ('accepted', 'sent') and d.provider_message_id is not null
        and vppsone.whatsapp_poll_is_due(d)
      order by d.created_at, d.id
      limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked
   )
  returning m.*;
$$;

revoke all on function vppsone.whatsapp_take_pollable(integer) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_take_pollable(integer) to service_role;

-- ------------------------------------------------------------- the timer

-- Same job, same five minutes; it now also wakes One when a message is due
-- a poll. An empty queue still costs two indexed reads and no request.
select cron.schedule(
  'whatsapp-queue',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/whatsapp-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from vppsone.whatsapp_messages m
     where m.status in ('queued', 'retry_wait') and m.next_attempt_at <= now()
  )
  or exists (
    select 1 from vppsone.whatsapp_messages m
     where m.provider = 'hub' and m.status in ('accepted', 'sent') and m.provider_message_id is not null
       and vppsone.whatsapp_poll_is_due(m)
  );
  $job$
);

-- ------------------------------------------------------ the _v8 templates

-- Printed by scripts/whatsapp-template-catalog.mjs; held to the app's own
-- descriptors by tests/whatsapp-template-catalog.test.ts.
insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en) values
  ('vpps_app_upcoming_hi_v8', 'vpps_app_upcoming_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: upcoming (hi)'),
  ('vpps_app_upcoming_en_v8', 'vpps_app_upcoming_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: upcoming (en)'),
  ('vpps_app_upcoming_final_hi_v8', 'vpps_app_upcoming_final_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: upcoming final (hi)'),
  ('vpps_app_upcoming_final_en_v8', 'vpps_app_upcoming_final_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: upcoming final (en)'),
  ('vpps_app_fee_due_hi_v8', 'vpps_app_fee_due_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: fee due (hi)'),
  ('vpps_app_fee_due_en_v8', 'vpps_app_fee_due_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: fee due (en)'),
  ('vpps_app_balance_hi_v8', 'vpps_app_balance_hi_v8', 'hi', 'fee_reminder', 5, array['balance', 'students', 'receivedSoFar', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: balance (hi)'),
  ('vpps_app_balance_en_v8', 'vpps_app_balance_en_v8', 'en', 'fee_reminder', 5, array['balance', 'students', 'receivedSoFar', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: balance (en)'),
  ('vpps_app_overdue_final_hi_v8', 'vpps_app_overdue_final_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: overdue final (hi)'),
  ('vpps_app_overdue_final_en_v8', 'vpps_app_overdue_final_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: overdue final (en)'),
  ('vpps_app_late_fee_waiver_hi_v8', 'vpps_app_late_fee_waiver_hi_v8', 'hi', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: late fee waiver (hi)'),
  ('vpps_app_late_fee_waiver_en_v8', 'vpps_app_late_fee_waiver_en_v8', 'en', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: late fee waiver (en)'),
  ('vpps_app_waiver_last_call_hi_v8', 'vpps_app_waiver_last_call_hi_v8', 'hi', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: waiver last call (hi)'),
  ('vpps_app_waiver_last_call_en_v8', 'vpps_app_waiver_last_call_en_v8', 'en', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: waiver last call (en)'),
  ('vpps_app_promise_due_hi_v8', 'vpps_app_promise_due_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'spokenOn', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: promise due (hi)'),
  ('vpps_app_promise_due_en_v8', 'vpps_app_promise_due_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'spokenOn', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: promise due (en)'),
  ('vpps_app_promise_lapsed_hi_v8', 'vpps_app_promise_lapsed_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'promisedDate', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: promise lapsed (hi)'),
  ('vpps_app_promise_lapsed_en_v8', 'vpps_app_promise_lapsed_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'promisedDate', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: promise lapsed (en)'),
  ('vpps_app_exam_clearance_hi_v8', 'vpps_app_exam_clearance_hi_v8', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: exam clearance (hi)'),
  ('vpps_app_exam_clearance_en_v8', 'vpps_app_exam_clearance_en_v8', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: exam clearance (en)'),
  ('vpps_app_prevyear_hi_v8', 'vpps_app_prevyear_hi_v8', 'hi', 'fee_reminder', 5, array['balance', 'students', 'session', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: prevyear (hi)'),
  ('vpps_app_prevyear_en_v8', 'vpps_app_prevyear_en_v8', 'en', 'fee_reminder', 5, array['balance', 'students', 'session', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now, on the hub: prevyear (en)')
on conflict (key) do nothing;

commit;
