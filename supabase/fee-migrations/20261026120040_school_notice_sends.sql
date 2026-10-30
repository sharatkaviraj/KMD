-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20261026120040_school_notice_sends.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added.
-- ============================================================================
-- School notices on WhatsApp: absence alerts, exam schedules, parent-teacher
-- meetings, closures. The everyday messages a school sends that are NOT about
-- money.
--
-- Their own send log, deliberately NOT `whatsapp_reminder_sends`:
--
--   * That table's rows are the fee-reminder cadence's evidence. An absence
--     alert counted there would push a family's next FEE reminder out by a
--     week for the crime of their child being ill.
--   * Its unique index claims a student's day per fee campaign; an absence
--     alert and a fee notice on the same morning are both legitimate.
--   * Its money columns (due_amount, pay_code) mean nothing here.
--
-- One row per child per notice per day. A phone with siblings on a closure
-- notice gets ONE message naming every child; the siblings get
-- `covered_by_sibling` rows carrying the same provider id, exactly as the fee
-- reminders record them, so "already sent today" still holds per child.

create table if not exists public.school_notice_sends (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null references public.students (id) on delete cascade,
  notice_kind text not null,
  campaign_name text not null,
  sent_on date not null,
  destination text,
  language text,
  template_params jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  -- One press of Send, so the screen can show a batch as one line of history.
  batch_id uuid not null,
  sent_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_notice_sends_kind_check
    check (notice_kind in ('absent_today', 'exam_schedule', 'ptm', 'school_closed')),
  constraint school_notice_sends_status_check
    check (status in ('pending', 'sent', 'failed', 'covered_by_sibling'))
);

comment on table public.school_notice_sends is
  'One row per child per school notice (absence, exam schedule, PTM, closure) per day. '
  'Separate from whatsapp_reminder_sends so a non-fee message never moves a family''s '
  'fee-reminder cadence. Siblings named in one message carry covered_by_sibling rows.';

-- Claimed BEFORE the provider call, like the fee reminders: two staff sending
-- the same absence list collide here and only one message goes.
create unique index if not exists school_notice_sends_one_a_day
  on public.school_notice_sends (session_label, student_id, notice_kind, sent_on);

create index if not exists school_notice_sends_batch_idx
  on public.school_notice_sends (batch_id);

create index if not exists school_notice_sends_month_idx
  on public.school_notice_sends (sent_on);

alter table public.school_notice_sends enable row level security;

-- Staff may read the history; every write goes through the server with the
-- service role, behind the screen's own permission check.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'school_notice_sends'
      and policyname = 'school_notice_sends: staff read'
  ) then
    create policy "school_notice_sends: staff read"
      on public.school_notice_sends for select
      using ((select auth.role()) = 'authenticated');
  end if;
end $$;
