-- The school's own WhatsApp number replaces AiSensy in VPPS One (D-562).
--
-- One sends from +91 83022 07823 ("Veer Patta School") through the school's
-- own WhatsApp server, or straight to Meta's Cloud API, behind one service
-- (src/platform/whatsapp). The fees app keeps its own AiSensy number
-- (+91 80 4713 6289) and nothing here touches it; One refuses that number as
-- a sender and as a recipient.
--
-- What this adds, all in `vppsone`:
--
--  * `whatsapp_templates`: the template registry. Which templates exist on the
--    school's account, under which name and language, how many `{{n}}` each
--    takes, and whether Meta has APPROVED it. Nothing goes out under a
--    template whose row is not `approved`. Every row starts `not_submitted`:
--    templates are approved per WhatsApp Business Account, so nothing approved
--    on AiSensy's account carries over. Seeded from the app's descriptors
--    (scripts/whatsapp-template-catalog.mjs) and from One's own
--    `message_templates`.
--  * `whatsapp_messages`: one row per message, ever. It is the log AND the
--    queue: `queued` / `retry_wait` rows are sent by the queue job, the rest
--    are history. Written only by the service role.
--  * `whatsapp_message_events`: append-only. Every send attempt, status
--    report (sent, delivered, read, failed with Meta's code), retry and
--    "paid" mark.
--  * `whatsapp_inbound`: parents' replies.
--  * Six switches in `runtime_flags`, every one of them CLOSED:
--      whatsapp_dry_run           ON  -> written to the log, never sent
--      whatsapp_features          every feature false
--      whatsapp_real_recipients   OFF -> only the owner's test number
--      whatsapp_owner_test_number empty -> with real recipients off, nobody
--      whatsapp_daily_limit       250 a day (a new number's Meta tier)
--      whatsapp_month_plan_cap    replaces aisensy_month_plan_cap (same value)
--  * `whatsapp_claim_send`, `whatsapp_take_due`, `whatsapp_record_status`:
--    the three writes that must be atomic (daily limit, queue lease,
--    never-backwards status).
--  * The queue's timer: pg_cron every five minutes, which calls One ONLY when
--    a row is due, with a Vault secret checked in Postgres
--    (`whatsapp_queue_secret_matches`), so no copy lives in Vercel.
--  * Staff notices may record the transport `whatsapp`; the month's staff
--    count and ops health read both the old `aisensy` rows and the new ones.
--
-- Rollback (nothing else depends on these):
--   select cron.unschedule('whatsapp-queue');
--   delete from vault.secrets where name = 'WHATSAPP_QUEUE_CRON_SECRET';
--   drop function vppsone.whatsapp_queue_secret_matches(text), vppsone.whatsapp_record_status(text,text,timestamptz,text,text,jsonb),
--     vppsone.whatsapp_take_due(integer), vppsone.whatsapp_claim_send(jsonb,text,integer);
--   drop table vppsone.whatsapp_inbound, vppsone.whatsapp_message_events, vppsone.whatsapp_messages, vppsone.whatsapp_templates;
--   delete from vppsone.runtime_flags where key like 'whatsapp_%';
--   (and restore runtime_flags_key_known, staff_notice_attempts_transport_known,
--    staff_whatsapp_month_sent and ops_health_counts from 20261031125856.)

begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- --------------------------------------------------------------- registry

create table vppsone.whatsapp_templates (
  key text primary key,
  provider_name text not null,
  language_code text not null,
  feature text not null,
  category text not null default 'utility',
  body_params integer not null default 0,
  param_names text[] not null default '{}',
  header text not null default 'none',
  url_button boolean not null default false,
  status text not null default 'not_submitted',
  status_reason text,
  status_checked_at timestamptz,
  label_en text,
  label_hi text,
  updated_at timestamptz not null default now(),
  updated_by uuid references vppsone.staff_profiles (id) on delete set null,
  constraint whatsapp_templates_status_known check (status in ('not_submitted', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  constraint whatsapp_templates_header_known check (header in ('none', 'document', 'image', 'text')),
  constraint whatsapp_templates_category_known check (category in ('utility', 'marketing', 'authentication')),
  constraint whatsapp_templates_params_range check (body_params between 0 and 20),
  constraint whatsapp_templates_language_shape check (language_code ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  constraint whatsapp_templates_name_shape check (provider_name ~ '^[a-z0-9_]+$' and length(provider_name) <= 512),
  -- `_v6` Pay now buttons point at the fees app's host (parent-send-gate.ts).
  constraint whatsapp_templates_never_v6 check (key !~* '_v6$' and provider_name !~* '_v6$')
);

comment on table vppsone.whatsapp_templates is
  'D-562: templates on the school''s own WhatsApp account (+91 83022 07823). A message goes out only under a row whose status is approved. Status is read from the WhatsApp server / Meta (Settings -> WhatsApp -> Check templates) or set by an admin.';

alter table vppsone.whatsapp_templates enable row level security;
revoke all on vppsone.whatsapp_templates from anon, authenticated;
grant all on vppsone.whatsapp_templates to service_role;

-- ---------------------------------------------------------------- the log

create table vppsone.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  feature text not null,
  kind text not null,
  template_key text,
  provider_template_name text,
  language_code text,
  to_e164 text not null,
  to_name text,
  body_params jsonb not null default '[]'::jsonb,
  header jsonb,
  button_params jsonb not null default '[]'::jsonb,
  text_body text,
  session_label text,
  source_table text,
  source_id text,
  requested_by uuid,
  status text not null,
  dry_run boolean not null default false,
  provider text,
  provider_message_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  error_code text,
  error_title text,
  error_detail text,
  http_status integer,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  pay_code text,
  paid_at timestamptz,
  paid_receipt_id uuid,
  idempotency_key text,
  retry_of uuid references vppsone.whatsapp_messages (id) on delete set null,
  retried_at timestamptz,
  retried_by uuid,
  constraint whatsapp_messages_kind_known check (kind in ('template', 'text')),
  constraint whatsapp_messages_status_known check (status in (
    'dry_run', 'held', 'queued', 'sending', 'retry_wait',
    'accepted', 'sent', 'delivered', 'read', 'failed', 'unknown', 'cancelled'
  )),
  constraint whatsapp_messages_template_has_key check ((kind = 'template') = (template_key is not null)),
  constraint whatsapp_messages_text_has_body check ((kind = 'text') = (text_body is not null)),
  constraint whatsapp_messages_e164 check (to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- The fees app's AiSensy number is never a recipient of One's.
  constraint whatsapp_messages_never_fees_number check (to_e164 <> '+918047136289'),
  constraint whatsapp_messages_attempts_range check (attempts >= 0 and max_attempts between 1 and 5),
  constraint whatsapp_messages_queue_has_time check (status not in ('queued', 'retry_wait') or next_attempt_at is not null)
);

comment on table vppsone.whatsapp_messages is
  'D-562: every WhatsApp message One sends or would have sent (dry run), one row each. The log and the queue: queued/retry_wait rows are sent by /api/jobs/whatsapp-queue. Service role only.';

create unique index whatsapp_messages_provider_id_key
  on vppsone.whatsapp_messages (provider_message_id) where provider_message_id is not null;
create unique index whatsapp_messages_idempotency_key
  on vppsone.whatsapp_messages (idempotency_key) where idempotency_key is not null;
create index whatsapp_messages_due_idx
  on vppsone.whatsapp_messages (next_attempt_at) where status in ('queued', 'retry_wait');
create index whatsapp_messages_created_idx on vppsone.whatsapp_messages (created_at desc);
create index whatsapp_messages_problem_idx
  on vppsone.whatsapp_messages (created_at desc) where status in ('failed', 'unknown', 'held');
create index whatsapp_messages_source_idx on vppsone.whatsapp_messages (source_table, source_id);
create index whatsapp_messages_pay_code_idx on vppsone.whatsapp_messages (pay_code) where pay_code is not null;

alter table vppsone.whatsapp_messages enable row level security;
revoke all on vppsone.whatsapp_messages from anon, authenticated;
grant all on vppsone.whatsapp_messages to service_role;

create table vppsone.whatsapp_message_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  message_id uuid references vppsone.whatsapp_messages (id) on delete set null,
  provider_message_id text,
  event text not null,
  status text,
  error_code text,
  error_title text,
  occurred_at timestamptz,
  detail jsonb,
  constraint whatsapp_message_events_event_known check (event in ('send', 'status', 'retry', 'paid', 'note'))
);

comment on table vppsone.whatsapp_message_events is
  'D-562: append-only history of every WhatsApp send attempt, status report, retry and paid mark. Service role only.';

create index whatsapp_message_events_message_idx on vppsone.whatsapp_message_events (message_id, id);
create index whatsapp_message_events_provider_idx on vppsone.whatsapp_message_events (provider_message_id);

alter table vppsone.whatsapp_message_events enable row level security;
revoke all on vppsone.whatsapp_message_events from anon, authenticated;
grant all on vppsone.whatsapp_message_events to service_role;

create table vppsone.whatsapp_inbound (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  from_e164 text not null,
  from_name text,
  message_type text not null,
  text_body text,
  reply_to_provider_id text,
  reply_to_message_id uuid references vppsone.whatsapp_messages (id) on delete set null,
  received_at timestamptz not null,
  stored_at timestamptz not null default now(),
  payload jsonb,
  seen_by uuid references vppsone.staff_profiles (id) on delete set null,
  seen_at timestamptz
);

comment on table vppsone.whatsapp_inbound is
  'D-562: replies parents send to the school''s WhatsApp number, from the status webhook. Service role only.';

create index whatsapp_inbound_received_idx on vppsone.whatsapp_inbound (received_at desc);

alter table vppsone.whatsapp_inbound enable row level security;
revoke all on vppsone.whatsapp_inbound from anon, authenticated;
grant all on vppsone.whatsapp_inbound to service_role;

-- ------------------------------------------------------------- switches

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
    'whatsapp_month_plan_cap'
  )
);

insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('whatsapp_dry_run', true, null,
   'On = every WhatsApp One would send is written to the message log and nothing is sent. Turned off by an admin in Settings -> WhatsApp.'),
  ('whatsapp_features', true,
   '{"fee_reminder": false, "receipt": false, "reversal": false, "fee_statement": false, "school_notice": false, "absent_notice": false, "collection_request": false, "report_delivery": false, "general": false, "staff_notice": false, "teacher_task": false}'::jsonb,
   'Which features may send through the school''s own WhatsApp. Every one false until an admin switches it on.'),
  ('whatsapp_real_recipients', false, null,
   'Off = One may message ONLY the owner''s test number (whatsapp_owner_test_number), whoever it is meant for. On only with the owner''s written approval; no screen turns it on.'),
  ('whatsapp_owner_test_number', false, null,
   'The owner''s own WhatsApp number, E.164 in value. The only recipient while whatsapp_real_recipients is off.'),
  ('whatsapp_daily_limit', true, '250'::jsonb,
   'Most WhatsApp messages One may send in one school day (IST). 250 is Meta''s first tier for a new number.')
on conflict (key) do nothing;

insert into vppsone.runtime_flags (key, enabled, value, note)
select 'whatsapp_month_plan_cap', f.enabled, f.value,
       'The month''s allowance on the school''s WhatsApp plan, for ops health (was aisensy_month_plan_cap).'
from vppsone.runtime_flags f where f.key = 'aisensy_month_plan_cap'
on conflict (key) do nothing;
insert into vppsone.runtime_flags (key, enabled, value, note) values
  ('whatsapp_month_plan_cap', false, null,
   'The month''s allowance on the school''s WhatsApp plan, for ops health (was aisensy_month_plan_cap).')
on conflict (key) do nothing;

-- ------------------------------------------------------- atomic writes

/*
 * Write one message's row, under the school day's limit.
 *
 * `p_status` is what the row starts as: `sending` (sent now), `queued` (the
 * queue job sends it), or `dry_run` / `held` (never sent; logged so the office
 * can see what WOULD have gone). Only `sending` and `queued` count against
 * the limit and take its lock, so two senders at once cannot both take the
 * last slot. A repeat of an idempotency key answers the first row.
 */
create function vppsone.whatsapp_claim_send(p_message jsonb, p_status text, p_daily_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(p_message ->> 'idempotency_key', '');
  v_found_id uuid;
  v_found_status text;
  v_found_provider_id text;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_used integer := 0;
  v_status text := p_status;
  v_error_code text := nullif(p_message ->> 'error_code', '');
  v_new_id uuid;
begin
  if p_status not in ('sending', 'queued', 'dry_run', 'held') then
    raise exception 'whatsapp_claim:status';
  end if;

  if v_key is not null then
    select m.id, m.status, m.provider_message_id
      into v_found_id, v_found_status, v_found_provider_id
      from vppsone.whatsapp_messages m
     where m.idempotency_key = v_key;
    if v_found_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'duplicate', 'id', v_found_id,
        'status', v_found_status, 'provider_message_id', v_found_provider_id);
    end if;
  end if;

  if p_status in ('sending', 'queued') then
    perform pg_advisory_xact_lock(hashtext('vppsone.whatsapp_daily_limit'));
    select count(*)::integer into v_used
      from vppsone.whatsapp_messages m
     where m.created_at >= v_day_start
       and m.status in ('sending', 'queued', 'retry_wait', 'accepted', 'sent', 'delivered', 'read', 'unknown');
    if p_daily_limit is null or p_daily_limit < 0 or v_used >= p_daily_limit then
      v_status := 'held';
      v_error_code := 'daily_limit';
    end if;
  end if;

  insert into vppsone.whatsapp_messages (
    feature, kind, template_key, provider_template_name, language_code, to_e164, to_name,
    body_params, header, button_params, text_body, session_label, source_table, source_id,
    requested_by, status, dry_run, provider, max_attempts, next_attempt_at, error_code,
    error_title, pay_code, idempotency_key, retry_of
  ) values (
    p_message ->> 'feature',
    p_message ->> 'kind',
    nullif(p_message ->> 'template_key', ''),
    nullif(p_message ->> 'provider_template_name', ''),
    nullif(p_message ->> 'language_code', ''),
    p_message ->> 'to_e164',
    nullif(p_message ->> 'to_name', ''),
    coalesce(p_message -> 'body_params', '[]'::jsonb),
    p_message -> 'header',
    coalesce(p_message -> 'button_params', '[]'::jsonb),
    p_message ->> 'text_body',
    nullif(p_message ->> 'session_label', ''),
    nullif(p_message ->> 'source_table', ''),
    nullif(p_message ->> 'source_id', ''),
    nullif(p_message ->> 'requested_by', '')::uuid,
    v_status,
    v_status = 'dry_run',
    nullif(p_message ->> 'provider', ''),
    coalesce(nullif(p_message ->> 'max_attempts', '')::integer, 1),
    case when v_status = 'queued' then coalesce(nullif(p_message ->> 'next_attempt_at', '')::timestamptz, now()) end,
    v_error_code,
    nullif(p_message ->> 'error_title', ''),
    nullif(p_message ->> 'pay_code', ''),
    -- A row that never reached the provider does not hold its key: the next
    -- try (tomorrow, after a switch) must be able to claim it.
    case when v_status in ('sending', 'queued') then v_key end,
    nullif(p_message ->> 'retry_of', '')::uuid
  )
  returning id into v_new_id;

  insert into vppsone.whatsapp_message_events (message_id, event, status, error_code, detail)
  values (v_new_id, 'send', v_status, v_error_code,
          jsonb_build_object('feature', p_message ->> 'feature', 'used_today', v_used, 'limit', p_daily_limit));

  if v_status = 'held' and p_status in ('sending', 'queued') then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'id', v_new_id, 'used', v_used, 'limit', p_daily_limit);
  end if;
  return jsonb_build_object('ok', true, 'id', v_new_id, 'status', v_status, 'used', v_used);
end;
$$;

revoke all on function vppsone.whatsapp_claim_send(jsonb, text, integer) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_claim_send(jsonb, text, integer) to service_role;

/*
 * The queue job's lease: up to `p_limit` due rows, moved to `sending` in the
 * same statement, so two runs at once never take the same row.
 */
create function vppsone.whatsapp_take_due(p_limit integer)
returns setof vppsone.whatsapp_messages
language sql
security definer
set search_path = ''
as $$
  update vppsone.whatsapp_messages m
     set status = 'sending', updated_at = now()
   where m.id in (
     select d.id from vppsone.whatsapp_messages d
      where d.status in ('queued', 'retry_wait') and d.next_attempt_at <= now()
      order by d.next_attempt_at, d.id
      limit greatest(1, least(coalesce(p_limit, 10), 50))
      for update skip locked
   )
  returning m.*;
$$;

revoke all on function vppsone.whatsapp_take_due(integer) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_take_due(integer) to service_role;

/*
 * A status report from the WhatsApp server or Meta. Never backwards:
 * accepted < sent < delivered < read, and a report that arrives late (a
 * "sent" after a "read") changes nothing. `failed` overrides accepted and
 * sent, never delivered or read. Every report is kept as an event, matched or
 * not.
 */
create function vppsone.whatsapp_record_status(
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

  if v_id is not null then
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
  end if;

  insert into vppsone.whatsapp_message_events (message_id, provider_message_id, event, status, error_code, error_title, occurred_at, detail)
  values (v_id, p_provider_message_id, 'status', p_status, p_error_code, p_error_title, v_at, p_detail);

  return jsonb_build_object('matched', v_id is not null, 'changed', v_changed, 'id', v_id,
    'previous', v_current, 'source_table', v_source_table, 'source_id', v_source_id);
end;
$$;

revoke all on function vppsone.whatsapp_record_status(text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_record_status(text, text, timestamptz, text, text, jsonb) to service_role;

-- ------------------------------------------------------------ the timer

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'WHATSAPP_QUEUE_CRON_SECRET',
  'D-562: pg_cron -> /api/jobs/whatsapp-queue. Checked by vppsone.whatsapp_queue_secret_matches; never copied to Vercel.')
where not exists (select 1 from vault.secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET');

create function vppsone.whatsapp_queue_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.decrypted_secret = p_secret and length(p_secret) = 64
       from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET'),
    false)
$$;

revoke all on function vppsone.whatsapp_queue_secret_matches(text) from public, anon, authenticated;
grant execute on function vppsone.whatsapp_queue_secret_matches(text) to service_role;

-- Every five minutes, and only when something is due: an empty queue costs
-- one indexed read and no request to One.
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
  );
  $job$
);

-- ------------------------------------------------- staff notices + health

alter table vppsone.staff_notice_attempts drop constraint if exists staff_notice_attempts_transport_known;
alter table vppsone.staff_notice_attempts add constraint staff_notice_attempts_transport_known
  check (transport in ('mock', 'aisensy', 'whatsapp', 'disabled'));

-- The month's staff sends: AiSensy's (history) and the school number's.
create or replace function vppsone.staff_whatsapp_month_sent()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' as month_start
  )
  select (
    (select count(*) from vppsone.staff_notice_attempts a, bounds b
     where a.transport in ('aisensy', 'whatsapp') and a.state in ('sending', 'accepted', 'unknown')
       and a.started_at >= b.month_start)
    +
    (select count(*) from vppsone.message_sends m
       cross join lateral jsonb_array_elements(m.task_history) e, bounds b
     where m.task_id is not null and m.task_transport in ('aisensy', 'whatsapp')
       and e ->> 'event' = 'claim' and e ->> 'transport' in ('aisensy', 'whatsapp')
       and (e ->> 'at')::timestamptz >= b.month_start)
  )::integer
$$;

-- Ops health: the month's total is the school WhatsApp's now. Patched in
-- place, so the rest of the function stays byte-for-byte what was reviewed.
do $patch$
declare
  v_def text := pg_get_functiondef('vppsone.ops_health_counts(integer)'::regprocedure);
begin
  v_def := replace(v_def, $q$coalesce(m.task_transport, 'aisensy') = 'aisensy'$q$, $q$coalesce(m.task_transport, 'aisensy') in ('aisensy', 'whatsapp')$q$);
  v_def := replace(v_def, $q$'aisensy_month_total'$q$, $q$'whatsapp_month_total'$q$);
  v_def := replace(v_def, $q$'aisensy_month_plan_cap'$q$, $q$'whatsapp_month_plan_cap'$q$);
  v_def := replace(v_def, $q$'aisensy_plan_cap'$q$, $q$'whatsapp_plan_cap'$q$);
  if v_def ~ 'aisensy_' or v_def !~ 'whatsapp_month_total' then
    raise exception 'ops_health_counts was not patched as expected';
  end if;
  execute v_def;
end;
$patch$;

-- ---------------------------------------------------------------- seed

-- One's own staff and collection templates, as they are defined today.
insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, category, body_params, param_names, header, url_button, label_en, label_hi)
select
  mt.code,
  mt.code,
  case when mt.code ~ '_hi(_|$)' then 'hi' else 'en' end,
  case
    when mt.code like 'vppsone_teacher_task_%' then 'teacher_task'
    when mt.audience = 'parent' then 'general'
    when mt.code = 'vppsone_collection_link' then 'collection_request'
    else 'staff_notice'
  end,
  case when mt.wa_category in ('utility', 'marketing', 'authentication') then mt.wa_category else 'utility' end,
  coalesce(array_length(mt.variables, 1), 0),
  mt.variables,
  'none',
  mt.has_url_button,
  mt.label_en,
  mt.label_hi
from vppsone.message_templates mt
where mt.code !~* '_v6$'
on conflict (key) do nothing;

-- The fee-side templates, from scripts/whatsapp-template-catalog.mjs.
insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en) values
  ('vpps_app_fee_due_hi_v2', 'vpps_app_fee_due_hi_v2', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: fee due (hi)'),
  ('vpps_app_fee_due_en_v2', 'vpps_app_fee_due_en_v2', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: fee due (en)'),
  ('vpps_app_balance_hi_v2', 'vpps_app_balance_hi_v2', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: balance (hi)'),
  ('vpps_app_balance_en_v2', 'vpps_app_balance_en_v2', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: balance (en)'),
  ('vpps_app_prevyear_hi_v2', 'vpps_app_prevyear_hi_v2', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: prevyear (hi)'),
  ('vpps_app_prevyear_en_v2', 'vpps_app_prevyear_en_v2', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: prevyear (en)'),
  ('vpps_app_upcoming_hi_v3', 'vpps_app_upcoming_hi_v3', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: upcoming (hi)'),
  ('vpps_app_upcoming_en_v3', 'vpps_app_upcoming_en_v3', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: upcoming (en)'),
  ('vpps_app_upcoming_final_hi_v3', 'vpps_app_upcoming_final_hi_v3', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: upcoming final (hi)'),
  ('vpps_app_upcoming_final_en_v3', 'vpps_app_upcoming_final_en_v3', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: upcoming final (en)'),
  ('vpps_app_late_fee_applied_hi_v3', 'vpps_app_late_fee_applied_hi_v3', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'totalToPay']::text[], 'none', false, 'Fee reminder: late fee applied (hi)'),
  ('vpps_app_late_fee_applied_en_v3', 'vpps_app_late_fee_applied_en_v3', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'totalToPay']::text[], 'none', false, 'Fee reminder: late fee applied (en)'),
  ('vpps_app_promise_lapsed_hi_v3', 'vpps_app_promise_lapsed_hi_v3', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: promise lapsed (hi)'),
  ('vpps_app_promise_lapsed_en_v3', 'vpps_app_promise_lapsed_en_v3', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: promise lapsed (en)'),
  ('vpps_app_late_fee_waiver_hi_v4', 'vpps_app_late_fee_waiver_hi_v4', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'date']::text[], 'none', false, 'Fee reminder: late fee waiver (hi)'),
  ('vpps_app_late_fee_waiver_en_v4', 'vpps_app_late_fee_waiver_en_v4', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'date']::text[], 'none', false, 'Fee reminder: late fee waiver (en)'),
  ('vpps_app_waiver_last_call_hi_v4', 'vpps_app_waiver_last_call_hi_v4', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'date']::text[], 'none', false, 'Fee reminder: waiver last call (hi)'),
  ('vpps_app_waiver_last_call_en_v4', 'vpps_app_waiver_last_call_en_v4', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'feesPending', 'lateFeeApplied', 'date']::text[], 'none', false, 'Fee reminder: waiver last call (en)'),
  ('vpps_app_overdue_final_hi_v4', 'vpps_app_overdue_final_hi_v4', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: overdue final (hi)'),
  ('vpps_app_overdue_final_en_v4', 'vpps_app_overdue_final_en_v4', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: overdue final (en)'),
  ('vpps_app_promise_due_hi_v4', 'vpps_app_promise_due_hi_v4', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: promise due (hi)'),
  ('vpps_app_promise_due_en_v4', 'vpps_app_promise_due_en_v4', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: promise due (en)'),
  ('vpps_app_exam_clearance_hi_v4', 'vpps_app_exam_clearance_hi_v4', 'hi', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: exam clearance (hi)'),
  ('vpps_app_exam_clearance_en_v4', 'vpps_app_exam_clearance_en_v4', 'en', 'fee_reminder', 7, array['parentName', 'studentName', 'studentClass', 'contextLine', 'amount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder: exam clearance (en)'),
  ('vpps_app_family_fee_due_hi_v3', 'vpps_app_family_fee_due_hi_v3', 'hi', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: fee due (hi)'),
  ('vpps_app_family_fee_due_en_v3', 'vpps_app_family_fee_due_en_v3', 'en', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: fee due (en)'),
  ('vpps_app_family_balance_hi_v3', 'vpps_app_family_balance_hi_v3', 'hi', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: balance (hi)'),
  ('vpps_app_family_balance_en_v3', 'vpps_app_family_balance_en_v3', 'en', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: balance (en)'),
  ('vpps_app_family_upcoming_hi_v3', 'vpps_app_family_upcoming_hi_v3', 'hi', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: upcoming (hi)'),
  ('vpps_app_family_upcoming_en_v3', 'vpps_app_family_upcoming_en_v3', 'en', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: upcoming (en)'),
  ('vpps_app_family_late_fee_applied_hi_v3', 'vpps_app_family_late_fee_applied_hi_v3', 'hi', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: late fee applied (hi)'),
  ('vpps_app_family_late_fee_applied_en_v3', 'vpps_app_family_late_fee_applied_en_v3', 'en', 'fee_reminder', 5, array['parentName', 'childrenLine', 'totalAmount', 'date', 'lateFeePhrase']::text[], 'none', false, 'Fee reminder for a family: late fee applied (en)'),
  ('vpps_app_upcoming_hi_v7', 'vpps_app_upcoming_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: upcoming (hi)'),
  ('vpps_app_upcoming_en_v7', 'vpps_app_upcoming_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: upcoming (en)'),
  ('vpps_app_upcoming_final_hi_v7', 'vpps_app_upcoming_final_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: upcoming final (hi)'),
  ('vpps_app_upcoming_final_en_v7', 'vpps_app_upcoming_final_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: upcoming final (en)'),
  ('vpps_app_fee_due_hi_v7', 'vpps_app_fee_due_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: fee due (hi)'),
  ('vpps_app_fee_due_en_v7', 'vpps_app_fee_due_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: fee due (en)'),
  ('vpps_app_balance_hi_v7', 'vpps_app_balance_hi_v7', 'hi', 'fee_reminder', 5, array['balance', 'students', 'receivedSoFar', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: balance (hi)'),
  ('vpps_app_balance_en_v7', 'vpps_app_balance_en_v7', 'en', 'fee_reminder', 5, array['balance', 'students', 'receivedSoFar', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: balance (en)'),
  ('vpps_app_overdue_final_hi_v7', 'vpps_app_overdue_final_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: overdue final (hi)'),
  ('vpps_app_overdue_final_en_v7', 'vpps_app_overdue_final_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: overdue final (en)'),
  ('vpps_app_late_fee_waiver_hi_v7', 'vpps_app_late_fee_waiver_hi_v7', 'hi', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now: late fee waiver (hi)'),
  ('vpps_app_late_fee_waiver_en_v7', 'vpps_app_late_fee_waiver_en_v7', 'en', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now: late fee waiver (en)'),
  ('vpps_app_waiver_last_call_hi_v7', 'vpps_app_waiver_last_call_hi_v7', 'hi', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now: waiver last call (hi)'),
  ('vpps_app_waiver_last_call_en_v7', 'vpps_app_waiver_last_call_en_v7', 'en', 'fee_reminder', 5, array['feesPending', 'students', 'context', 'lateFeeApplied', 'date']::text[], 'none', true, 'Fee reminder with Pay now: waiver last call (en)'),
  ('vpps_app_promise_due_hi_v7', 'vpps_app_promise_due_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'spokenOn', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: promise due (hi)'),
  ('vpps_app_promise_due_en_v7', 'vpps_app_promise_due_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'spokenOn', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: promise due (en)'),
  ('vpps_app_promise_lapsed_hi_v7', 'vpps_app_promise_lapsed_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'promisedDate', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: promise lapsed (hi)'),
  ('vpps_app_promise_lapsed_en_v7', 'vpps_app_promise_lapsed_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'promisedDate', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: promise lapsed (en)'),
  ('vpps_app_exam_clearance_hi_v7', 'vpps_app_exam_clearance_hi_v7', 'hi', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: exam clearance (hi)'),
  ('vpps_app_exam_clearance_en_v7', 'vpps_app_exam_clearance_en_v7', 'en', 'fee_reminder', 5, array['amount', 'students', 'context', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: exam clearance (en)'),
  ('vpps_app_prevyear_hi_v7', 'vpps_app_prevyear_hi_v7', 'hi', 'fee_reminder', 5, array['balance', 'students', 'session', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: prevyear (hi)'),
  ('vpps_app_prevyear_en_v7', 'vpps_app_prevyear_en_v7', 'en', 'fee_reminder', 5, array['balance', 'students', 'session', 'date', 'lateFeePhrase']::text[], 'none', true, 'Fee reminder with Pay now: prevyear (en)'),
  ('vpps_app_receipt_hi_v5', 'vpps_app_receipt_hi_v5', 'hi', 'receipt', 7, array['parentName', 'studentName', 'studentClass', 'receiptNumber', 'amountPaid', 'paymentDate', 'remainingBalance']::text[], 'document', false, 'Receipt with the PDF attached (hi)'),
  ('vpps_app_receipt_en_v5', 'vpps_app_receipt_en_v5', 'en', 'receipt', 7, array['parentName', 'studentName', 'studentClass', 'receiptNumber', 'amountPaid', 'paymentDate', 'remainingBalance']::text[], 'document', false, 'Receipt with the PDF attached (en)'),
  ('vpps_app_receipt_hi_v3', 'vpps_app_receipt_hi_v3', 'hi', 'receipt', 7, array['parentName', 'studentName', 'studentClass', 'receiptNumber', 'amountPaid', 'paymentDate', 'remainingBalance']::text[], 'none', false, 'Receipt, text only (hi)'),
  ('vpps_app_receipt_en_v3', 'vpps_app_receipt_en_v3', 'en', 'receipt', 7, array['parentName', 'studentName', 'studentClass', 'receiptNumber', 'amountPaid', 'paymentDate', 'remainingBalance']::text[], 'none', false, 'Receipt, text only (en)'),
  ('vpps_app_reversal_hi_v1', 'vpps_app_reversal_hi_v1', 'hi', 'reversal', 6, array['parentName', 'studentName', 'receiptNumber', 'amountReversed', 'reversedOn', 'remainingBalance']::text[], 'none', false, 'Receipt cancelled (hi)'),
  ('vpps_app_reversal_en_v1', 'vpps_app_reversal_en_v1', 'en', 'reversal', 6, array['parentName', 'studentName', 'receiptNumber', 'amountReversed', 'reversedOn', 'remainingBalance']::text[], 'none', false, 'Receipt cancelled (en)'),
  ('vpps_app_fee_statement_hi_v1', 'vpps_app_fee_statement_hi_v1', 'hi', 'fee_statement', 5, array['parentName', 'studentName', 'studentClass', 'sessionLabel', 'pendingAmount']::text[], 'document', false, 'Fee statement with the PDF attached (hi)'),
  ('vpps_app_fee_statement_en_v1', 'vpps_app_fee_statement_en_v1', 'en', 'fee_statement', 5, array['parentName', 'studentName', 'studentClass', 'sessionLabel', 'pendingAmount']::text[], 'document', false, 'Fee statement with the PDF attached (en)'),
  ('vpps_school_absent_hi_v1', 'vpps_school_absent_hi_v1', 'hi', 'absent_notice', 3, array['विद्यार्थी', 'कक्षा', 'तिथि']::text[], 'none', false, 'School notice: absent today (hi)'),
  ('vpps_school_absent_en_v1', 'vpps_school_absent_en_v1', 'en', 'absent_notice', 3, array['Student', 'Class', 'Date']::text[], 'none', false, 'School notice: absent today (en)'),
  ('vpps_school_exam_schedule_hi_v1', 'vpps_school_exam_schedule_hi_v1', 'hi', 'school_notice', 5, array['विद्यार्थी', 'कक्षा', 'परीक्षा', 'प्रारंभ तिथि', 'उपस्थिति का समय']::text[], 'none', false, 'School notice: exam schedule (hi)'),
  ('vpps_school_exam_schedule_en_v1', 'vpps_school_exam_schedule_en_v1', 'en', 'school_notice', 5, array['Student', 'Class', 'Examination', 'Starts on', 'Reporting time']::text[], 'none', false, 'School notice: exam schedule (en)'),
  ('vpps_school_ptm_hi_v1', 'vpps_school_ptm_hi_v1', 'hi', 'school_notice', 4, array['विद्यार्थी', 'कक्षा', 'तिथि', 'समय']::text[], 'none', false, 'School notice: ptm (hi)'),
  ('vpps_school_ptm_en_v1', 'vpps_school_ptm_en_v1', 'en', 'school_notice', 4, array['Student', 'Class', 'Date', 'Time']::text[], 'none', false, 'School notice: ptm (en)'),
  ('vpps_school_closed_hi_v1', 'vpps_school_closed_hi_v1', 'hi', 'school_notice', 4, array['विद्यार्थी', 'अवकाश तिथि', 'कारण', 'विद्यालय पुनः खुलने की तिथि']::text[], 'none', false, 'School notice: school closed (hi)'),
  ('vpps_school_closed_en_v1', 'vpps_school_closed_en_v1', 'en', 'school_notice', 4, array['For', 'Closed on', 'Reason', 'School reopens on']::text[], 'none', false, 'School notice: school closed (en)')
on conflict (key) do nothing;

commit;
