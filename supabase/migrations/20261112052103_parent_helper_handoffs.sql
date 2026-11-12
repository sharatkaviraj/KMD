-- Veer Patta AI, step 2: a hand-off reaches a person, and their answer
-- reaches the parent (D-578).
--
-- Step 1 (20261112041158) put a parent's message in One's Messages inbox
-- (`parent_replies`). Now the person it is for is told on WhatsApp, between
-- 6 am and 9 pm in India only: the child's class teacher, the accountant
-- with an admin for fees, an admin for the principal, the office for the
-- office. They answer by swiping right on that message and typing, and the
-- answer goes to the parent from the school's number. Unanswered after
-- 3 hours: one reminder. A complaint still unanswered a day later goes up to
-- an admin (the owner, 12 Nov 2026).
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `parent_helper_handoffs`: one row per hand-off the helper made (one per
--    `parent_replies` row): who it is for, how far it has gone, and what is
--    due next (`next_action`, `next_action_at`), which the job below reads.
--  * `parent_helper_alerts`: each WhatsApp message that told a person, with
--    its message id. A swiped reply quotes that id, which is how One knows a
--    reply is an answer, and to which parent it goes.
--  * `parent_helper_deliveries`: each answer's way to the parent. Inside the
--    parent's 24 hours it goes as it is; outside them a short approved note
--    says it is ready and the answer waits (`waiting`) until the parent
--    replies. The answer's words stay in `parent_reply_answers`, where every
--    answer from One's Messages already goes.
--  * `parent_helper_take_due(limit)`: the hand-offs whose next step is due,
--    each held for ten minutes so two runs never act on one twice.
--  * Four registry rows, `not_submitted`: the staff alert and the parent's
--    "your answer is ready" note, Hindi and English. The hourly template
--    check sends each to Meta once by itself; nothing is sent to anyone.
--  * pg_cron job `parent-helper`, every five minutes, and only when a step is
--    due, calling /api/jobs/parent-helper with the WhatsApp queue's secret.
--
-- Nothing here sends to a real person while practice mode is on or real
-- recipients are off: every message still passes `checkWhatsAppSend`.
--
-- Rollback:
--   select cron.unschedule('parent-helper');
--   delete from vppsone.whatsapp_templates where key in ('vpps_staff_parent_question_hi_v1',
--     'vpps_staff_parent_question_en_v1', 'vpps_parent_answer_ready_hi_v1', 'vpps_parent_answer_ready_en_v1')
--     and status = 'not_submitted';
--   drop function if exists vppsone.parent_helper_take_due(integer);
--   drop table if exists vppsone.parent_helper_deliveries;
--   drop table if exists vppsone.parent_helper_alerts;
--   drop table if exists vppsone.parent_helper_handoffs;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.parent_helper_handoffs (
  id uuid primary key default gen_random_uuid(),
  parent_reply_id uuid not null unique references vppsone.parent_replies(id) on delete cascade,
  parent_e164 text not null check (parent_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  language text not null check (language in ('hi', 'hx', 'en')),
  target text not null check (target in ('class_teacher', 'accounts', 'office', 'principal')),
  topic text not null check (topic ~ '^[a-z_]{2,30}$'),
  complaint boolean not null default false,
  practice boolean not null default false,
  class_teacher_id uuid references vppsone.staff_profiles(id) on delete set null,
  -- The child's first name, or the parent's own name when no child was named.
  about_name text not null check (char_length(about_name) between 1 and 80),
  level smallint not null default 0 check (level between 0 and 1),
  reminders smallint not null default 0 check (reminders between 0 and 5),
  level_alerted_at timestamptz,
  next_action text check (next_action is null or next_action in ('alert', 'remind', 'pass_up')),
  next_action_at timestamptz,
  answered_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_helper_handoffs_next_together check ((next_action is null) = (next_action_at is null))
);

comment on table vppsone.parent_helper_handoffs is
  'Veer Patta AI (D-578): one row per hand-off. Who it is for, how far it has gone, and the next step (alert, reminder, passing up to an admin) with when it is due.';

create index parent_helper_handoffs_due on vppsone.parent_helper_handoffs (next_action_at)
  where next_action_at is not null and answered_at is null and closed_at is null;
create index parent_helper_handoffs_parent on vppsone.parent_helper_handoffs (parent_e164, created_at desc);

create table vppsone.parent_helper_alerts (
  id uuid primary key default gen_random_uuid(),
  handoff_id uuid not null references vppsone.parent_helper_handoffs(id) on delete cascade,
  staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  to_e164 text check (to_e164 is null or to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('alert', 'reminder', 'passed_up')),
  via text check (via is null or via in ('text', 'template')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 120),
  message_id text unique,
  created_at timestamptz not null default now()
);

comment on table vppsone.parent_helper_alerts is
  'Veer Patta AI (D-578): each WhatsApp message that told a person about a hand-off. A swiped reply quotes message_id, which ties the answer to the parent.';

create index parent_helper_alerts_handoff on vppsone.parent_helper_alerts (handoff_id, created_at);

create table vppsone.parent_helper_deliveries (
  answer_id uuid primary key references vppsone.parent_reply_answers(id) on delete restrict,
  handoff_id uuid not null references vppsone.parent_helper_handoffs(id) on delete cascade,
  status text not null check (status in ('sent', 'waiting', 'failed')),
  via text check (via is null or via in ('text', 'template')),
  -- Who answered, as the parent reads it: the class teacher by name, else the office they speak for.
  answerer_kind text not null check (answerer_kind in ('class_teacher', 'accounts', 'principal', 'office')),
  answerer_name text check (answerer_name is null or char_length(answerer_name) <= 80),
  note_message_id text,
  message_id text,
  reason text check (reason is null or char_length(reason) <= 120),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table vppsone.parent_helper_deliveries is
  'Veer Patta AI (D-578): each answer''s way to the parent. sent, or waiting for the parent to reply to the approved "your answer is ready" note, or failed. The words stay in parent_reply_answers.';

create index parent_helper_deliveries_waiting on vppsone.parent_helper_deliveries (handoff_id) where status = 'waiting';

alter table vppsone.parent_helper_handoffs enable row level security;
alter table vppsone.parent_helper_alerts enable row level security;
alter table vppsone.parent_helper_deliveries enable row level security;

revoke all on vppsone.parent_helper_handoffs, vppsone.parent_helper_alerts, vppsone.parent_helper_deliveries from anon, authenticated;
grant all on vppsone.parent_helper_handoffs, vppsone.parent_helper_alerts, vppsone.parent_helper_deliveries to service_role;

create function vppsone.parent_helper_take_due(p_limit integer)
returns setof uuid
language sql
volatile
set search_path = ''
as $$
  update vppsone.parent_helper_handoffs h
     set next_action_at = now() + interval '10 minutes',
         updated_at = now()
   where h.id in (
     select d.id
       from vppsone.parent_helper_handoffs d
      where d.next_action_at is not null
        and d.next_action_at <= now()
        and d.answered_at is null
        and d.closed_at is null
      order by d.next_action_at
      limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked
   )
  returning h.id;
$$;

comment on function vppsone.parent_helper_take_due(integer) is
  'Veer Patta AI (D-578): the hand-offs whose next step is due, each pushed ten minutes on so another run leaves it alone. The job sets the real next time once the step is done.';

revoke all on function vppsone.parent_helper_take_due(integer) from public, anon, authenticated;
grant execute on function vppsone.parent_helper_take_due(integer) to service_role;

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_staff_parent_question_hi_v1', 'vpps_staff_parent_question_hi_v1', 'hi', 'parent_helper', 4, array['name', 'student', 'about', 'message']::text[], 'none', false, 'A parent''s message for a teacher, on the hub (hi)', 'अभिभावक का संदेश'),
  ('vpps_staff_parent_question_en_v1', 'vpps_staff_parent_question_en_v1', 'en', 'parent_helper', 4, array['name', 'student', 'about', 'message']::text[], 'none', false, 'A parent''s message for a teacher, on the hub (en)', 'अभिभावक का संदेश'),
  ('vpps_parent_answer_ready_hi_v1', 'vpps_parent_answer_ready_hi_v1', 'hi', 'parent_helper', 2, array['who', 'child']::text[], 'none', false, 'Your answer is ready, on the hub (hi)', 'आपका जवाब तैयार है'),
  ('vpps_parent_answer_ready_en_v1', 'vpps_parent_answer_ready_en_v1', 'en', 'parent_helper', 2, array['who', 'child']::text[], 'none', false, 'Your answer is ready, on the hub (en)', 'आपका जवाब तैयार है')
on conflict (key) do nothing;

select cron.schedule(
  'parent-helper',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/parent-helper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from vppsone.parent_helper_handoffs h
     where h.next_action_at is not null and h.next_action_at <= now()
       and h.answered_at is null and h.closed_at is null
  );
  $job$
);

commit;
