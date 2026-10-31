-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261030190000_whatsapp_failure_desk.sql
-- (fees origin/main b96525ba), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Live (vgqyilgstjvgohrsiwkb) has it applied: load-snapshot refused the first
-- real load over the objects it creates (go-live Phase D).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added. (Its begin/commit were left out of the
--   MCP call only because apply_migration runs in its own transaction.)
-- ============================================================================
-- The failure desk: every reminder that did not reach a family, why, and what
-- was done about it.
--
-- Before this, three different things could go wrong with a reminder and the
-- app recorded only one of them well:
--
-- 1. AiSensy refused the request (`status = 'failed'`). Recorded, with the text.
-- 2. AiSensy accepted it and WhatsApp then could not deliver it
--    (`delivery_status = 'failed'`, from the report CSV). The status landed; the
--    reason and WhatsApp's error code were thrown away, and nothing counted it as
--    a failure.
-- 3. A retry. It updated the row in place, so the earlier attempt — which number,
--    what went wrong — was overwritten.
--
-- This migration adds:
--
-- - a CAUSE on every failed row (decided in TypeScript by
--   `domain/failure-cause.ts`, one rule for the sender, the report import and the
--   webhook), plus the delivery reason and code;
-- - a RESOLUTION, for a person saying "I called them" or "slip sent home";
-- - `whatsapp_send_attempts`, one append-only row per provider answer, delivery
--   result and resolution, written by trigger so no code path can forget it;
-- - `whatsapp_number_health`, keyed by the last ten digits of a number, so a
--   number WhatsApp has said it cannot reach is not paid for again, and the
--   audience can switch the family to the other parent's number.
--
-- Additive throughout. No existing column changes meaning, no row is rewritten
-- except by the triggers on future writes, and the backfill only inserts.

begin;

-- ------------------------------------------------------------- 0. phone key

create schema if not exists private;

-- The last ten digits, or null when there are fewer than ten. `+91 93522 05884`,
-- `919352205884` and `9352205884` are one number; the report CSV, the student
-- record and the send log each write it differently.
create or replace function private.whatsapp_phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(digits) >= 10 then right(digits, 10) end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) as cleaned
$$;

-- --------------------------------------------------------- 1. send columns

alter table public.whatsapp_reminder_sends
  add column if not exists failure_cause text,
  add column if not exists delivery_error_code text,
  add column if not exists delivery_error text,
  add column if not exists resolution text,
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_reminder_sends'::regclass
      and conname = 'whatsapp_reminder_sends_failure_cause_check'
  ) then
    alter table public.whatsapp_reminder_sends
      add constraint whatsapp_reminder_sends_failure_cause_check
      check (
        failure_cause is null
        or failure_cause in (
          'invalid_number', 'not_on_whatsapp', 'opted_out', 'whatsapp_limit',
          'template', 'account', 'network', 'media', 'unknown'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_reminder_sends'::regclass
      and conname = 'whatsapp_reminder_sends_resolution_check'
  ) then
    alter table public.whatsapp_reminder_sends
      add constraint whatsapp_reminder_sends_resolution_check
      check (resolution is null or resolution in ('called', 'slip_sent', 'dismissed'));
  end if;
end $$;

comment on column public.whatsapp_reminder_sends.failure_cause is
  'Why this row failed, in the office''s terms — set by domain/failure-cause.ts '
  'from the provider''s text and code, wherever the failure was learned (the send, '
  'the report CSV, the webhook). Null on a row that has not failed. Never set on '
  'a covered_by_sibling row.';

comment on column public.whatsapp_reminder_sends.delivery_error is
  'The reason AiSensy''s report or webhook gave for a delivery failure, verbatim. '
  'Kept apart from last_error, which is what the SEND was told.';

comment on column public.whatsapp_reminder_sends.resolution is
  'A person''s decision that this failure needs nothing more from WhatsApp: '
  'called = rang the family; slip_sent = paper went home; dismissed = not '
  'chasing, with resolution_note saying why. Delivered-later and paid-since are '
  'NOT stored here: both are read from the ledger and the send log, so they can '
  'never disagree with them.';

create index if not exists whatsapp_reminder_sends_open_problems_idx
  on public.whatsapp_reminder_sends (session_label, sent_on desc)
  where resolution is null
    and (status in ('failed', 'pending') or delivery_status = 'failed');

-- ------------------------------------------------------ 2. number health

create table if not exists public.whatsapp_number_health (
  phone_key text primary key check (phone_key ~ '^[0-9]{10}$'),
  last_delivered_at timestamptz,
  last_failed_at timestamptz,
  last_cause text,
  failures_in_a_row integer not null default 0,
  -- A person saying "try this number again" or "this number does not work".
  marked_by uuid,
  marked_at timestamptz,
  marked_note text,
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_number_health is
  'What WhatsApp has said about each number, by its last ten digits. A number '
  'is DEAD while failures_in_a_row > 0 and last_cause is not_on_whatsapp, '
  'invalid_number or opted_out: the audience then uses the other parent''s '
  'number, or lists the family as unreachable. One delivery resets it. Shared by '
  'siblings, because the number is.';

alter table public.whatsapp_number_health enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'whatsapp_number_health'
      and policyname = 'whatsapp_number_health: staff read'
  ) then
    create policy "whatsapp_number_health: staff read"
      on public.whatsapp_number_health for select
      using ((select auth.role()) = 'authenticated');
  end if;
end $$;

revoke all on public.whatsapp_number_health from anon;
grant select on public.whatsapp_number_health to authenticated;

create or replace function private.whatsapp_mark_number(
  p_phone_key text,
  p_delivered boolean,
  p_cause text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_phone_key is null then
    return;
  end if;

  insert into public.whatsapp_number_health as health (
    phone_key, last_delivered_at, last_failed_at, last_cause, failures_in_a_row, updated_at
  )
  values (
    p_phone_key,
    case when p_delivered then now() end,
    case when p_delivered then null else now() end,
    case when p_delivered then null else p_cause end,
    case when p_delivered then 0 else 1 end,
    now()
  )
  on conflict (phone_key) do update set
    last_delivered_at = case when p_delivered then now() else health.last_delivered_at end,
    last_failed_at = case when p_delivered then health.last_failed_at else now() end,
    last_cause = case when p_delivered then health.last_cause else p_cause end,
    failures_in_a_row = case when p_delivered then 0 else health.failures_in_a_row + 1 end,
    updated_at = now();
end;
$$;

revoke all on function private.whatsapp_mark_number(text, boolean, text) from public, anon, authenticated;

-- --------------------------------------------------------- 3. attempts log

create table if not exists public.whatsapp_send_attempts (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.whatsapp_reminder_sends (id) on delete cascade,
  student_id uuid not null,
  session_label text not null,
  -- accepted / refused: what AiSensy said to the send.
  -- submitted / delivered / read / failed: what the report or webhook said later.
  -- resolved: a person closed the failure (called, slip sent, dismissed).
  result text not null check (
    result in ('accepted', 'refused', 'submitted', 'delivered', 'read', 'failed', 'resolved')
  ),
  destination text,
  destination_role text,
  provider_message_id text,
  error_code text,
  error_text text,
  cause text,
  source text not null check (source in ('send', 'report', 'resolution', 'backfill')),
  staff_id uuid,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_send_attempts is
  'Append-only history of every reminder: each provider answer, each delivery '
  'result, each human resolution. Written by trigger on whatsapp_reminder_sends, '
  'which keeps ONE row per family per notice per day (the unique index) and '
  'updates it in place on a resend — this is where the earlier attempts survive. '
  'Rows before 2026-10-30 are a one-line backfill per send; their earlier '
  'retries were never recorded.';

create index if not exists whatsapp_send_attempts_send_idx
  on public.whatsapp_send_attempts (send_id, created_at);
create index if not exists whatsapp_send_attempts_student_idx
  on public.whatsapp_send_attempts (student_id, created_at desc);
create index if not exists whatsapp_send_attempts_session_idx
  on public.whatsapp_send_attempts (session_label, created_at desc);

alter table public.whatsapp_send_attempts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'whatsapp_send_attempts'
      and policyname = 'whatsapp_send_attempts: staff read'
  ) then
    create policy "whatsapp_send_attempts: staff read"
      on public.whatsapp_send_attempts for select
      using ((select auth.role()) = 'authenticated');
  end if;
end $$;

revoke all on public.whatsapp_send_attempts from anon;
grant select on public.whatsapp_send_attempts to authenticated;

-- History does not change. Deletes are allowed only so the ≤30-day empty-session
-- delete can still cascade through the send log.
create or replace function private.whatsapp_send_attempts_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'whatsapp_send_attempts is append-only';
end;
$$;

drop trigger if exists whatsapp_send_attempts_append_only on public.whatsapp_send_attempts;
create trigger whatsapp_send_attempts_append_only
  before update on public.whatsapp_send_attempts
  for each row execute function private.whatsapp_send_attempts_are_append_only();

-- ------------------------------------------------------------- 4. triggers

-- A row taken back to `pending` is the next attempt at the same message. The
-- counter, and the clearing of the PREVIOUS message's delivery result, happen
-- here so every path that reclaims a row — the run sender, a resend from the
-- failure desk — gets them without having to remember.
create or replace function private.whatsapp_send_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'pending' and old.status in ('failed', 'sent') then
    new.attempts := coalesce(old.attempts, 1) + 1;
    new.last_attempt_at := now();
    new.delivery_status := null;
    new.delivered_at := null;
    new.read_at := null;
    new.delivery_error := null;
    new.delivery_error_code := null;
    new.failure_cause := null;
    new.resolution := null;
    new.resolution_note := null;
    new.resolved_by := null;
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_send_before_update on public.whatsapp_reminder_sends;
create trigger whatsapp_send_before_update
  before update on public.whatsapp_reminder_sends
  for each row execute function private.whatsapp_send_before_update();

create or replace function private.whatsapp_send_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := private.whatsapp_phone_key(new.destination);
  v_dead text[] := array['not_on_whatsapp', 'invalid_number', 'opted_out'];
begin
  -- The provider answered the send.
  if new.status in ('sent', 'failed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.whatsapp_send_attempts (
      send_id, student_id, session_label, result, destination, destination_role,
      provider_message_id, error_text, cause, source, staff_id
    ) values (
      new.id, new.student_id, new.session_label,
      case when new.status = 'sent' then 'accepted' else 'refused' end,
      new.destination, new.destination_role, new.provider_message_id,
      case when new.status = 'failed' then coalesce(new.last_error, new.error_message) end,
      case when new.status = 'failed' then new.failure_cause end,
      'send', new.sent_by
    );

    if new.status = 'failed' and new.failure_cause = any (v_dead) then
      perform private.whatsapp_mark_number(v_key, false, new.failure_cause);
    end if;
  end if;

  -- A delivery result arrived, from the report CSV or the webhook.
  if tg_op = 'UPDATE'
     and new.status = 'sent'
     and new.delivery_status is not null
     and new.delivery_status is distinct from old.delivery_status then
    insert into public.whatsapp_send_attempts (
      send_id, student_id, session_label, result, destination, destination_role,
      provider_message_id, error_code, error_text, cause, source
    ) values (
      new.id, new.student_id, new.session_label, new.delivery_status,
      new.destination, new.destination_role, new.provider_message_id,
      new.delivery_error_code, new.delivery_error,
      case when new.delivery_status = 'failed' then new.failure_cause end,
      'report'
    );

    if new.delivery_status in ('delivered', 'read') then
      perform private.whatsapp_mark_number(v_key, true, null);
    elsif new.delivery_status = 'failed' and new.failure_cause = any (v_dead) then
      perform private.whatsapp_mark_number(v_key, false, new.failure_cause);
    end if;
  end if;

  -- A person closed the failure.
  if tg_op = 'UPDATE'
     and new.resolution is not null
     and new.resolution is distinct from old.resolution then
    insert into public.whatsapp_send_attempts (
      send_id, student_id, session_label, result, destination, destination_role,
      source, staff_id, note
    ) values (
      new.id, new.student_id, new.session_label, 'resolved',
      new.destination, new.destination_role, 'resolution', new.resolved_by,
      new.resolution || coalesce(': ' || nullif(new.resolution_note, ''), '')
    );
  end if;

  return null;
end;
$$;

revoke all on function private.whatsapp_send_after_write() from public, anon, authenticated;

drop trigger if exists whatsapp_send_after_write on public.whatsapp_reminder_sends;
create trigger whatsapp_send_after_write
  after insert or update on public.whatsapp_reminder_sends
  for each row execute function private.whatsapp_send_after_write();

-- -------------------------------------------------------------- 5. backfill

-- One line per existing send, so every family's timeline starts somewhere. The
-- retries that happened before today overwrote their own history and cannot be
-- recovered; the line says what the row says now.
insert into public.whatsapp_send_attempts (
  send_id, student_id, session_label, result, destination, destination_role,
  provider_message_id, error_text, source, staff_id, created_at
)
select
  s.id, s.student_id, s.session_label,
  case when s.status = 'sent' then 'accepted' else 'refused' end,
  s.destination, s.destination_role, s.provider_message_id,
  case when s.status = 'failed' then coalesce(s.last_error, s.error_message) end,
  'backfill', s.sent_by,
  coalesce(s.last_attempt_at, s.created_at)
from public.whatsapp_reminder_sends s
where s.status in ('sent', 'failed')
  and not exists (
    select 1 from public.whatsapp_send_attempts a where a.send_id = s.id
  );

commit;
