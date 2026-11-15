-- Chats with parents in One (D-616; the owner, 15 Nov 2026: "build an in-app
-- chat ... organised, with the idea of whom parents are talking and whose
-- parents are talking", "the WhatsApp message just shares the link of the
-- chat, so on one tap the chat section is open").
--
-- Until now a parent's question that Veer Patta AI could not answer reached a
-- teacher as a WhatsApp message on the teacher's own phone, and the teacher
-- answered by swiping on it (D-578). With several parents at once nobody could
-- tell which answer was going to whom. Now each family has one chat per desk
-- in One, and the conversation happens there:
--
--  * the class desk: the child's class teacher (one chat per class teacher);
--  * the accounts desk: fees, read by the accountants;
--  * the admin desk: the principal, complaints, "I want to talk to the admin".
--
-- An admin sees every chat, filtered by teacher, accounts, dues or student,
-- and may take one over. The parent keeps using WhatsApp: a staff reply goes
-- from the school's number through the hub, a photo or file too.
--
-- What this adds, all in `vppsone`, service role only (the app checks the
-- reader's permission and desk before every read and write):
--
--  * `parent_chats`: one row per family per desk (parent's number, desk,
--    class teacher for the class desk, practice or real). Its status says
--    whether the parent is waiting for the school, and `next_nudge_at` when
--    the person it is for gets a WhatsApp nudge with a one-tap link.
--  * `parent_chat_messages`: what was said, both ways, with WhatsApp's ticks.
--    A parent's photo or file is shown from the hub (`media.media_id`); a
--    staff member's from the private bucket below (`media.path`).
--  * `parent_chat_reads`: when each person last read each chat (unread dots,
--    and a nudge is not sent to someone who has already seen it).
--  * `parent_chat_nudges`: each WhatsApp nudge sent to a member of staff.
--  * `go_links`: short codes for one-tap links into One (`/go/<code>`), any
--    page of One, never a sign-in: the person still signs in as themselves.
--  * `parent_chat_settings`: one row; chats on or off, nudges on or off, how
--    long a chat stays "live" after a staff reply (30 minutes).
--  * Functions: open a chat, add a message (and move the chat's state),
--    record a WhatsApp tick, take the chats whose nudge is due, count unread,
--    and open a go link.
--  * Storage bucket `parent-chat-files`, private: what staff send. Uploaded
--    straight from the phone with a signed upload link and fetched by Meta
--    once, through a link signed for an hour.
--  * `chats:reply` for every role that can be a class teacher or works the
--    fee desk, and `chats:all` for the admin (Staff -> Roles can change both).
--  * Four registry rows, `not_submitted`: the staff nudge with an "Open in
--    One" button, and the parent's "the school has sent you a message" note,
--    Hindi and English. The hourly template check sends them to Meta once.
--  * pg_cron job `parent-chats`, every two minutes and only when a nudge is
--    due, calling /api/jobs/parent-chats with the WhatsApp queue's secret.
--
-- Parents' words are kept here, which D-576 kept out of One: a chat is only
-- useful if the next person can read what was said. A parent's message still
-- never changes a child's or the school's record (the owner, 12 Nov 2026):
-- anything it asks for stays a suggestion a person approves. Nothing here
-- sends to anyone: every message still passes `checkWhatsAppSend` (real
-- recipients are off, which leaves only the owner's number).
--
-- Rollback, in this order: unschedule the cron job 'parent-chats'; take the
-- four template rows out while they read `not_submitted`; take the
-- `chats:*` rows out of `role_permissions`; remove the bucket's policy and
-- the bucket once it is empty; then the six functions and the six tables
-- above (messages, reads and nudges before chats).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table vppsone.parent_chats (
  id uuid primary key default gen_random_uuid(),
  parent_e164 text not null check (parent_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  desk text not null check (desk in ('class', 'accounts', 'admin')),
  class_teacher_id uuid references vppsone.staff_profiles(id) on delete set null,
  practice boolean not null default false,
  session_label text not null check (char_length(session_label) between 4 and 40),
  from_name text not null default 'Parent' check (char_length(from_name) between 1 and 120),
  student_ids uuid[] not null default '{}'::uuid[] check (cardinality(student_ids) <= 8),
  student_label text check (student_label is null or char_length(student_label) <= 200),
  language text not null default 'hi' check (language in ('hi', 'hx', 'en')),
  status text not null default 'open' check (status in ('waiting', 'open', 'done')),
  waiting_since timestamptz,
  topic text check (topic is null or topic ~ '^[a-z_]{2,30}$'),
  complaint boolean not null default false,
  wants_admin boolean not null default false,
  taken_by uuid references vppsone.staff_profiles(id) on delete set null,
  taken_at timestamptz,
  live_until timestamptz,
  last_parent_at timestamptz,
  last_staff_at timestamptz,
  last_message_at timestamptz not null default now(),
  last_preview text check (last_preview is null or char_length(last_preview) <= 160),
  last_direction text check (last_direction is null or last_direction in ('in', 'out', 'ai', 'note')),
  nudge_step text check (nudge_step is null or nudge_step in ('first', 'remind', 'pass_up')),
  next_nudge_at timestamptz,
  nudged_at timestamptz,
  reminded_at timestamptz,
  passed_up_at timestamptz,
  done_at timestamptz,
  done_by uuid references vppsone.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parent_chats_class_teacher_on_class_desk check (desk = 'class' or class_teacher_id is null),
  constraint parent_chats_waiting_together check ((status = 'waiting') = (waiting_since is not null)),
  constraint parent_chats_nudge_together check ((nudge_step is null) = (next_nudge_at is null))
);

comment on table vppsone.parent_chats is
  'Chats with parents (D-616): one per family per desk (class teacher, accounts, admin), practice or real. Service role only; the app checks the reader''s desk.';

create unique index parent_chats_one_per_desk
  on vppsone.parent_chats (parent_e164, desk, class_teacher_id, practice) nulls not distinct;
create index parent_chats_recent on vppsone.parent_chats (practice, last_message_at desc);
create index parent_chats_waiting on vppsone.parent_chats (waiting_since) where status = 'waiting';
create index parent_chats_class_teacher on vppsone.parent_chats (class_teacher_id) where desk = 'class';
create index parent_chats_nudge_due on vppsone.parent_chats (next_nudge_at) where next_nudge_at is not null;

create table vppsone.parent_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references vppsone.parent_chats(id) on delete cascade,
  direction text not null check (direction in ('in', 'out', 'ai', 'note')),
  kind text not null default 'text' check (kind in (
    'text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'tap', 'other', 'suggestion', 'event'
  )),
  body text check (body is null or char_length(body) <= 4096),
  media jsonb check (media is null or jsonb_typeof(media) = 'object'),
  meta jsonb check (meta is null or jsonb_typeof(meta) = 'object'),
  wamid text unique check (wamid is null or char_length(wamid) between 8 and 256),
  note_wamid text check (note_wamid is null or char_length(note_wamid) between 8 and 256),
  reply_to_wamid text check (reply_to_wamid is null or char_length(reply_to_wamid) between 8 and 256),
  client_ref uuid unique,
  staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  staff_name text check (staff_name is null or char_length(staff_name) <= 80),
  status text not null default 'received' check (status in ('received', 'sending', 'sent', 'delivered', 'read', 'failed', 'waiting')),
  error text check (error is null or char_length(error) <= 200),
  handoff_id uuid references vppsone.parent_helper_handoffs(id) on delete set null,
  parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  at timestamptz not null default now(),
  status_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table vppsone.parent_chat_messages is
  'What was said in a chat with parents (D-616): in = the parent, out = the school, ai = Veer Patta AI, note = an event only staff see. Service role only.';

create index parent_chat_messages_by_chat on vppsone.parent_chat_messages (chat_id, at, id);
create index parent_chat_messages_waiting on vppsone.parent_chat_messages (chat_id) where status = 'waiting';
create index parent_chat_messages_note on vppsone.parent_chat_messages (note_wamid) where note_wamid is not null;
create index parent_chat_messages_handoff on vppsone.parent_chat_messages (handoff_id) where handoff_id is not null;

create table vppsone.parent_chat_reads (
  chat_id uuid not null references vppsone.parent_chats(id) on delete cascade,
  staff_id uuid not null references vppsone.staff_profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (chat_id, staff_id)
);

create table vppsone.parent_chat_nudges (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  to_e164 text not null check (to_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  kind text not null check (kind in ('first', 'remind', 'pass_up')),
  chat_ids uuid[] not null default '{}'::uuid[],
  waiting integer not null default 0 check (waiting >= 0),
  via text not null check (via in ('text', 'template', 'none')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  reason text check (reason is null or char_length(reason) <= 120),
  message_id text check (message_id is null or char_length(message_id) <= 256),
  practice boolean not null default false,
  created_at timestamptz not null default now()
);

create index parent_chat_nudges_to on vppsone.parent_chat_nudges (to_e164, created_at desc);
create index parent_chat_nudges_staff on vppsone.parent_chat_nudges (staff_id, created_at desc);

create table vppsone.go_links (
  code text primary key check (code ~ '^[A-Za-z0-9]{8,16}$'),
  path text not null check (path ~ '^/[^/]' and char_length(path) <= 300 and path !~ '[[:space:]]' and strpos(path, chr(92)) = 0),
  session_label text check (session_label is null or char_length(session_label) between 4 and 40),
  staff_id uuid references vppsone.staff_profiles(id) on delete set null,
  purpose text not null check (purpose ~ '^[a-z_]{2,40}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  uses integer not null default 0 check (uses >= 0),
  last_used_at timestamptz,
  constraint go_links_expire_after_creation check (expires_at > created_at)
);

comment on table vppsone.go_links is
  'One-tap links into One (D-616): https://one.vpps.co.in/go/<code> opens `path` after the person signs in as themselves. Never a sign-in.';

create index go_links_staff on vppsone.go_links (staff_id, created_at desc);

create table vppsone.parent_chat_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  nudges boolean not null default true,
  live_minutes integer not null default 30 check (live_minutes between 5 and 240),
  first_nudge_minutes integer not null default 2 check (first_nudge_minutes between 0 and 60),
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into vppsone.parent_chat_settings (id) values (1) on conflict (id) do nothing;

alter table vppsone.parent_chats enable row level security;
alter table vppsone.parent_chat_messages enable row level security;
alter table vppsone.parent_chat_reads enable row level security;
alter table vppsone.parent_chat_nudges enable row level security;
alter table vppsone.go_links enable row level security;
alter table vppsone.parent_chat_settings enable row level security;

revoke all on vppsone.parent_chats, vppsone.parent_chat_messages, vppsone.parent_chat_reads,
  vppsone.parent_chat_nudges, vppsone.go_links, vppsone.parent_chat_settings from anon, authenticated;
grant all on vppsone.parent_chats, vppsone.parent_chat_messages, vppsone.parent_chat_reads,
  vppsone.parent_chat_nudges, vppsone.go_links, vppsone.parent_chat_settings to service_role;

-- Find a family's chat at one desk, or start it. A second child, a better name
-- or the parent's language joins the existing chat rather than starting another.
create or replace function vppsone.parent_chat_open(
  p_parent text,
  p_desk text,
  p_class_teacher uuid,
  p_practice boolean,
  p_session text,
  p_from_name text,
  p_student_ids uuid[],
  p_student_label text,
  p_language text
)
returns uuid
language sql
volatile
set search_path = ''
as $$
  insert into vppsone.parent_chats as c (
    parent_e164, desk, class_teacher_id, practice, session_label, from_name, student_ids, student_label, language
  ) values (
    p_parent,
    p_desk,
    case when p_desk = 'class' then p_class_teacher end,
    coalesce(p_practice, false),
    p_session,
    coalesce(nullif(btrim(left(coalesce(p_from_name, ''), 120)), ''), 'Parent'),
    coalesce(p_student_ids[1:8], '{}'::uuid[]),
    nullif(btrim(left(coalesce(p_student_label, ''), 200)), ''),
    coalesce(p_language, 'hi')
  )
  on conflict (parent_e164, desk, class_teacher_id, practice) do update set
    from_name = case when excluded.from_name <> 'Parent' then excluded.from_name else c.from_name end,
    student_ids = (
      select coalesce(array_agg(s.id order by s.first_at), '{}'::uuid[])
        from (
          select u.id, min(u.n) as first_at
            from unnest(c.student_ids || excluded.student_ids) with ordinality as u(id, n)
           group by u.id
           order by min(u.n)
           limit 8
        ) s
    ),
    student_label = coalesce(excluded.student_label, c.student_label),
    language = excluded.language,
    session_label = excluded.session_label,
    updated_at = now()
  returning c.id;
$$;

comment on function vppsone.parent_chat_open(text, text, uuid, boolean, text, text, uuid[], text, text) is
  'Chats with parents (D-616): the family''s chat at one desk, started if it is new. Returns its id.';

-- Add one message and move the chat along with it. The parent writing makes the
-- chat wait for the school (and plans the first nudge); a staff reply ends the
-- wait and keeps the chat live for a while, so the parent''s next words come
-- here rather than to Veer Patta AI. A WhatsApp id or a client reference seen
-- before adds nothing: `duplicate` is true.
create or replace function vppsone.parent_chat_append(p jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_chat uuid := (p->>'chat_id')::uuid;
  v_direction text := p->>'direction';
  v_at timestamptz := coalesce((p->>'at')::timestamptz, now());
  v_body text := nullif(left(coalesce(p->>'body', ''), 4096), '');
  v_preview text;
  v_id uuid;
  v_live integer;
  v_first integer;
begin
  if v_chat is null or v_direction is null then
    raise exception 'parent_chat_append: chat_id and direction are required' using errcode = '22023';
  end if;

  insert into vppsone.parent_chat_messages (
    chat_id, direction, kind, body, media, meta, wamid, note_wamid, reply_to_wamid, client_ref,
    staff_id, staff_name, status, error, handoff_id, parent_reply_id, at, status_at
  ) values (
    v_chat,
    v_direction,
    coalesce(p->>'kind', 'text'),
    v_body,
    case when jsonb_typeof(p->'media') = 'object' then p->'media' end,
    case when jsonb_typeof(p->'meta') = 'object' then p->'meta' end,
    nullif(p->>'wamid', ''),
    nullif(p->>'note_wamid', ''),
    nullif(p->>'reply_to_wamid', ''),
    (p->>'client_ref')::uuid,
    (p->>'staff_id')::uuid,
    nullif(left(coalesce(p->>'staff_name', ''), 80), ''),
    coalesce(p->>'status', case when v_direction = 'in' then 'received' else 'sent' end),
    nullif(left(coalesce(p->>'error', ''), 200), ''),
    (p->>'handoff_id')::uuid,
    (p->>'parent_reply_id')::uuid,
    v_at,
    case when coalesce(p->>'status', '') in ('sent', 'delivered', 'read', 'failed') then v_at end
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('id', null, 'duplicate', true);
  end if;

  v_preview := left(coalesce(nullif(p->>'preview', ''), v_body, ''), 160);

  if v_direction = 'in' then
    select s.first_nudge_minutes into v_first from vppsone.parent_chat_settings s where s.id = 1;
    update vppsone.parent_chats c set
      waiting_since = case when c.status = 'waiting' then c.waiting_since else v_at end,
      nudge_step = case when c.status = 'waiting' then c.nudge_step else 'first' end,
      next_nudge_at = case
        when c.status = 'waiting' then c.next_nudge_at
        else coalesce((p->>'nudge_at')::timestamptz, v_at + make_interval(mins => coalesce(v_first, 2)))
      end,
      nudged_at = case when c.status = 'waiting' then c.nudged_at end,
      reminded_at = case when c.status = 'waiting' then c.reminded_at end,
      passed_up_at = case when c.status = 'waiting' then c.passed_up_at end,
      status = 'waiting',
      done_at = null,
      done_by = null,
      last_parent_at = greatest(coalesce(c.last_parent_at, v_at), v_at),
      last_message_at = greatest(c.last_message_at, v_at),
      last_preview = v_preview,
      last_direction = 'in',
      updated_at = now()
    where c.id = v_chat;
  elsif v_direction = 'out' then
    select s.live_minutes into v_live from vppsone.parent_chat_settings s where s.id = 1;
    update vppsone.parent_chats c set
      status = 'open',
      waiting_since = null,
      nudge_step = null,
      next_nudge_at = null,
      done_at = null,
      done_by = null,
      last_staff_at = greatest(coalesce(c.last_staff_at, v_at), v_at),
      live_until = greatest(coalesce(c.live_until, v_at), v_at + make_interval(mins => coalesce(v_live, 30))),
      last_message_at = greatest(c.last_message_at, v_at),
      last_preview = v_preview,
      last_direction = 'out',
      updated_at = now()
    where c.id = v_chat;
  elsif v_direction = 'ai' then
    update vppsone.parent_chats c set
      last_message_at = greatest(c.last_message_at, v_at),
      last_preview = v_preview,
      last_direction = 'ai',
      updated_at = now()
    where c.id = v_chat;
  else
    update vppsone.parent_chats c set updated_at = now() where c.id = v_chat;
  end if;

  return jsonb_build_object('id', v_id, 'duplicate', false);
end;
$$;

comment on function vppsone.parent_chat_append(jsonb) is
  'Chats with parents (D-616): add one message and move its chat (waiting, live, last line). A WhatsApp id or client reference seen before adds nothing.';

-- WhatsApp's ticks on a staff message, forward only: sent, then delivered,
-- then read. A failure can only replace "sending" or "sent".
create or replace function vppsone.parent_chat_status(p_wamid text, p_status text, p_at timestamptz, p_error text)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with ranked as (
    select m.id
      from vppsone.parent_chat_messages m
     where m.wamid = p_wamid
       and m.direction = 'out'
       and (
         (p_status = 'failed' and m.status in ('sending', 'sent'))
         or (p_status <> 'failed'
             and (case m.status when 'sending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 9 end)
               < (case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else -1 end))
       )
  ), moved as (
    update vppsone.parent_chat_messages m
       set status = p_status,
           status_at = coalesce(p_at, now()),
           error = case when p_status = 'failed' then nullif(left(coalesce(p_error, ''), 200), '') else m.error end
      from ranked r
     where m.id = r.id
    returning m.id
  )
  select exists (select 1 from moved);
$$;

comment on function vppsone.parent_chat_status(text, text, timestamptz, text) is
  'Chats with parents (D-616): a WhatsApp tick on a school message, forward only. True when it moved.';

-- The chats whose nudge is due, each held for ten minutes so two runs never
-- nudge for it twice. The job sets the real next time once it has acted.
create or replace function vppsone.parent_chat_take_due(p_limit integer)
returns setof uuid
language sql
volatile
set search_path = ''
as $$
  update vppsone.parent_chats c
     set next_nudge_at = now() + interval '10 minutes',
         updated_at = now()
   where c.id in (
     select d.id
       from vppsone.parent_chats d
      where d.next_nudge_at is not null
        and d.next_nudge_at <= now()
        and d.status = 'waiting'
      order by d.next_nudge_at
      limit greatest(1, least(coalesce(p_limit, 40), 100))
      for update skip locked
   )
  returning c.id;
$$;

comment on function vppsone.parent_chat_take_due(integer) is
  'Chats with parents (D-616): the waiting chats whose WhatsApp nudge is due, each pushed ten minutes on so another run leaves it alone.';

-- How many of the parent's messages each chat has that this person has not read.
create or replace function vppsone.parent_chat_unread(p_staff uuid, p_chats uuid[])
returns table (chat_id uuid, unread integer)
language sql
stable
set search_path = ''
as $$
  select c.id,
         (select count(*)::integer
            from vppsone.parent_chat_messages m
           where m.chat_id = c.id
             and m.direction = 'in'
             and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz))
    from unnest(coalesce(p_chats, '{}'::uuid[])) as c(id)
    left join vppsone.parent_chat_reads r on r.chat_id = c.id and r.staff_id = p_staff;
$$;

comment on function vppsone.parent_chat_unread(uuid, uuid[]) is
  'Chats with parents (D-616): the parent''s messages each chat has that this person has not read yet.';

-- Open a one-tap link: where it goes, counted. An expired code opens nothing.
create or replace function vppsone.go_link_open(p_code text)
returns table (path text, session_label text, staff_id uuid, purpose text)
language sql
volatile
set search_path = ''
as $$
  update vppsone.go_links g
     set uses = g.uses + 1,
         last_used_at = now()
   where g.code = p_code
     and g.expires_at > now()
  returning g.path, g.session_label, g.staff_id, g.purpose;
$$;

comment on function vppsone.go_link_open(text) is
  'One-tap links (D-616): where an unexpired code goes, with its use counted.';

revoke all on function vppsone.parent_chat_open(text, text, uuid, boolean, text, text, uuid[], text, text) from public, anon, authenticated;
revoke all on function vppsone.parent_chat_append(jsonb) from public, anon, authenticated;
revoke all on function vppsone.parent_chat_status(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function vppsone.parent_chat_take_due(integer) from public, anon, authenticated;
revoke all on function vppsone.parent_chat_unread(uuid, uuid[]) from public, anon, authenticated;
revoke all on function vppsone.go_link_open(text) from public, anon, authenticated;
grant execute on function vppsone.parent_chat_open(text, text, uuid, boolean, text, text, uuid[], text, text) to service_role;
grant execute on function vppsone.parent_chat_append(jsonb) to service_role;
grant execute on function vppsone.parent_chat_status(text, text, timestamptz, text) to service_role;
grant execute on function vppsone.parent_chat_take_due(integer) to service_role;
grant execute on function vppsone.parent_chat_unread(uuid, uuid[]) to service_role;
grant execute on function vppsone.go_link_open(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'parent-chat-files', 'parent-chat-files', false, 16777216,
  array[
    'image/jpeg', 'image/png', 'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- Restrictive so an unrelated, broad permissive storage policy cannot expose
-- this bucket. The service role bypasses RLS, including for signed uploads.
create policy parent_chat_files_server_only on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'parent-chat-files') with check (bucket_id <> 'parent-chat-files');

insert into vppsone.role_permissions (role, permission) values
  ('admin', 'chats:reply'),
  ('admin', 'chats:all'),
  ('office', 'chats:reply'),
  ('accountant', 'chats:reply'),
  ('fee_collector', 'chats:reply'),
  ('academic_coordinator', 'chats:reply'),
  ('exam_coordinator', 'chats:reply'),
  ('teacher', 'chats:reply')
on conflict (role, permission) do nothing;

insert into vppsone.whatsapp_templates (key, provider_name, language_code, feature, body_params, param_names, header, url_button, label_en, label_hi) values
  ('vpps_staff_open_one_hi_v1', 'vpps_staff_open_one_hi_v1', 'hi', 'parent_helper', 2, array['name', 'waiting']::text[], 'none', true, 'Waiting for you in One, with an Open in One button (hi)', 'One में आपके लिए, One में खोलें बटन के साथ'),
  ('vpps_staff_open_one_en_v1', 'vpps_staff_open_one_en_v1', 'en', 'parent_helper', 2, array['name', 'waiting']::text[], 'none', true, 'Waiting for you in One, with an Open in One button (en)', 'One में आपके लिए, One में खोलें बटन के साथ'),
  ('vpps_parent_school_message_hi_v1', 'vpps_parent_school_message_hi_v1', 'hi', 'parent_helper', 2, array['who', 'child']::text[], 'none', false, 'The school has sent you a message (hi)', 'विद्यालय ने आपको संदेश भेजा है'),
  ('vpps_parent_school_message_en_v1', 'vpps_parent_school_message_en_v1', 'en', 'parent_helper', 2, array['who', 'child']::text[], 'none', false, 'The school has sent you a message (en)', 'विद्यालय ने आपको संदेश भेजा है')
on conflict (key) do nothing;

select cron.schedule(
  'parent-chats',
  '*/2 * * * *',
  $job$
  select net.http_post(
    url := 'https://one.vpps.co.in/api/jobs/parent-chats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'WHATSAPP_QUEUE_CRON_SECRET')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (
    select 1 from vppsone.parent_chats c
     where c.next_nudge_at is not null and c.next_nudge_at <= now() and c.status = 'waiting'
  );
  $job$
);

commit;
