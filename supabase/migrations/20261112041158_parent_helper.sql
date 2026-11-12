-- Veer Patta AI, the school's WhatsApp helper for parents, step 1 (D-574).
--
-- A parent writes to the school's number (+91 83022 07823). The school's hub
-- forwards the message to One, One asks the hub whether it may answer
-- (`POST /v1/typing`, the hub's claim), and answers from the family's own
-- records: fees, receipts, attendance, results, the class teacher, or a
-- hand-off into One's Messages inbox. Step 1 answers ONLY the owner's test
-- number, for the practice children named below; every other number is left
-- to the hub's own bot and the office.
--
-- What this adds, all in `vppsone`, nothing in `public`:
--
--  * `parent_helper_settings`: one row. The helper's name, kept in one place
--    ("Veer Patta AI", the owner's choice, 12 Nov 2026), and the practice
--    children the owner's number stands for. Seeded with two TEST-2026-27
--    children; `parent_helper_child()` answers for test-year children only,
--    whatever this list says.
--  * `parent_helper_turns`: one row per parent message the helper looked at.
--    Metadata only: what kind of message, what it was taken to ask, how it
--    was answered, by which model, at what cost, and the hand-off it made.
--    The unique message id is what stops a repeated forward from being
--    answered twice. No message text is kept here: the conversation itself
--    stays in the hub, which is the school's WhatsApp inbox.
--  * `parent_helper_chats`: per number, the little the helper must remember
--    between messages: the language the parent writes in, whether it is
--    waiting for a message to pass on ("type your message for the teacher"),
--    and when it last greeted them.
--  * `parent_helper_child(student)`: one child's facts in one read, for a
--    caller with no signed-in person (the webhook). Answers null for any
--    child who is not in a TEST/UAT/DEMO session: a real family's fees come
--    from the Fees app, never from this database's replica. Results only
--    for an exam whose results are released and whose class is locked.
--    Fees never include the late fee, which has its own line; a write-off
--    (`payment_mode = 'discount'`) is never shown as a receipt.
--  * `parent_helper_budget(number, month, day)`: the school's AI spend this
--    month (One's AI helper and Veer Patta AI together, against the one
--    budget in Settings -> AI in One) and this number's answered turns today.
--
-- Rollback:
--   drop function if exists vppsone.parent_helper_budget(text, timestamptz, timestamptz);
--   drop function if exists vppsone.parent_helper_child(uuid);
--   drop table if exists vppsone.parent_helper_turns;
--   drop table if exists vppsone.parent_helper_chats;
--   drop table if exists vppsone.parent_helper_settings;

begin;

set local lock_timeout = '5s';

create table vppsone.parent_helper_settings (
  id smallint primary key default 1 check (id = 1),
  helper_name text not null default 'Veer Patta AI' check (char_length(btrim(helper_name)) between 2 and 40),
  practice_student_ids uuid[] not null default '{}',
  updated_by uuid references vppsone.staff_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table vppsone.parent_helper_settings is
  'Veer Patta AI (D-574): its name, and the practice children the owner''s test number stands for. One row.';

insert into vppsone.parent_helper_settings (id, helper_name, practice_student_ids)
select 1, 'Veer Patta AI', coalesce(array_agg(s.id order by s.admission_no), '{}')
from public.students s
join public.classes c on c.id = s.class_id
where s.admission_no in ('TEST-D-0003', 'TEST-CL2-196')
  and c.session_label ~* '^(TEST|UAT|DEMO)-'
on conflict (id) do nothing;

create table vppsone.parent_helper_chats (
  from_e164 text primary key check (from_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  language text check (language in ('hi', 'hx', 'en')),
  awaiting text check (awaiting is null or awaiting ~ '^(teacher:[a-z0-9]{4,16}|office)$'),
  awaiting_until timestamptz,
  greeted_at timestamptz,
  last_turn_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table vppsone.parent_helper_chats is
  'Veer Patta AI (D-574): per number, the language and what the helper is waiting for. Never the messages themselves.';

create table vppsone.parent_helper_turns (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  from_e164 text not null,
  received_at timestamptz not null,
  kind text not null check (kind in ('text', 'tap', 'voice', 'media')),
  status text not null default 'started' check (status in ('started', 'not_claimed', 'answered', 'failed')),
  reason text check (reason is null or char_length(reason) <= 120),
  intent text check (intent is null or intent ~ '^[a-z_]{2,30}$'),
  route text check (route is null or route in ('rule', 'tap', 'ai', 'ai_careful', 'fallback')),
  model text,
  cost_usd numeric(10, 6) not null default 0 check (cost_usd >= 0),
  handoff text check (handoff is null or handoff in ('class_teacher', 'accounts', 'office', 'principal')),
  parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  reply_message_id text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table vppsone.parent_helper_turns is
  'Veer Patta AI (D-574): one row per parent message looked at. Metadata only, never the text. The unique message id stops a repeated forward being answered twice.';

create index parent_helper_turns_from_created on vppsone.parent_helper_turns (from_e164, created_at desc);
create index parent_helper_turns_created on vppsone.parent_helper_turns (created_at);

alter table vppsone.parent_helper_settings enable row level security;
alter table vppsone.parent_helper_chats enable row level security;
alter table vppsone.parent_helper_turns enable row level security;

revoke all on vppsone.parent_helper_settings, vppsone.parent_helper_chats, vppsone.parent_helper_turns from anon, authenticated;
grant all on vppsone.parent_helper_settings, vppsone.parent_helper_chats, vppsone.parent_helper_turns to service_role;

create function vppsone.parent_helper_child(p_student_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Asia/Kolkata')::date as d
  ),
  kid as (
    select s.id, s.full_name, s.class_id, s.status::text as status,
           c.session_label, c.class_name, c.section, c.stream_name
    from public.students s
    join public.classes c on c.id = s.class_id
    where s.id = p_student_id
      -- Step 1: test-year children only. A real family's fees come from the
      -- Fees app through its own connection, never from this replica.
      and c.session_label ~* '^(TEST|UAT|DEMO)-'
  )
  select case when not exists (select 1 from kid) then null else jsonb_build_object(
    'today', (select d from today),
    'student', (
      select jsonb_build_object(
        'id', k.id, 'full_name', k.full_name, 'class_id', k.class_id, 'status', k.status,
        'session_label', k.session_label, 'class_name', k.class_name, 'section', k.section, 'stream_name', k.stream_name)
      from kid k
    ),
    -- Fees only in `pending`; the late fee is its own column, never added in.
    'installments', coalesce((
      select jsonb_agg(jsonb_build_object(
          'installment_no', b.installment_no, 'due_date', b.due_date, 'pending', b.pending_amount,
          'late_pending', b.late_fee_pending, 'applied', b.applied_amount, 'carry_forward', b.is_carry_forward)
        order by b.due_date, b.installment_no)
      from public.v_workbook_installment_balances b
      join kid k on k.id = b.student_id and b.session_label = k.session_label
    ), '[]'::jsonb),
    -- The five latest receipts. A write-off is not a payment and is left out;
    -- a reversed receipt stays, marked.
    'receipts', coalesce((
      select jsonb_agg(q.r order by q.d desc, q.n desc)
      from (
        select jsonb_build_object(
            'number', r.receipt_number, 'date', r.payment_date, 'amount', r.total_amount,
            'mode', r.payment_mode::text,
            'reversed', r.total_amount > 0 and coalesce(t.reversed_amount, 0) >= r.total_amount) as r,
          r.payment_date as d, r.receipt_number as n
        from public.receipts r
        join kid k on k.id = r.student_id
        left join public.v_receipt_reversal_totals t on t.receipt_id = r.id
        where r.payment_mode::text <> 'discount'
        order by r.payment_date desc, r.receipt_number desc
        limit 5
      ) q
    ), '[]'::jsonb),
    'attendance', (
      select jsonb_build_object(
        'attendance_pct', a.attendance_pct, 'days_counted', a.days_counted,
        'absent_days', a.absent_days, 'late_days', a.late_days)
      from vppsone.v_student_attendance a
      join kid k on k.id = a.student_id and a.session_label = k.session_label
    ),
    -- The daily register's last 30 days, submitted registers only.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.day, 'status', m.status::text) order by g.day desc)
      from vppsone.attendance_marks m
      join vppsone.attendance_registers g on g.id = m.register_id
      join kid k on k.id = m.student_id and g.session_label = k.session_label
      where g.status = 'submitted' and g.period is null and g.day >= (select d from today) - 30
    ), '[]'::jsonb),
    -- What the school has finished: results released, the child's class locked.
    'results', coalesce((
      select jsonb_agg(q.e order by q.s desc nulls last)
      from (
        select jsonb_build_object(
            'label', a.label_en, 'label_hi', a.label_hi, 'term', a.term,
            'subjects', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'name', coalesce(sub.name_en, s2.subject_code), 'name_hi', sub.name_hi, 'max', s2.max_marks,
                  'value', mk.value, 'absent', coalesce(mk.absent, false), 'exempt', coalesce(mk.exempt, false))
                order by s2.sort_order, sub.sort_order)
              from vppsone.assessment_subjects s2
              left join vppsone.subjects sub on sub.id = s2.subject_id
              left join vppsone.marks mk on mk.assessment_subject_id = s2.id and mk.student_id = k.id
              where s2.assessment_id = a.id and s2.class_id = k.class_id
            ), '[]'::jsonb)) as e,
          a.starts_on as s
        from vppsone.assessments a
        join kid k on k.session_label = a.session_label
        join vppsone.exam_class_locks l on l.assessment_id = a.id and l.class_id = k.class_id
        join vppsone.exam_plans p on p.assessment_id = a.id
        where p.results_published_at is not null
           or (p.results_publish_at is not null and p.results_publish_at <= now())
        order by a.starts_on desc nulls last
        limit 3
      ) q
    ), '[]'::jsonb),
    'class_teacher', (
      select jsonb_build_object('staff_id', sp.id, 'name', sp.display_name, 'is_test', coalesce(sp.is_test_account, false))
      from vppsone.class_teachers ct
      join vppsone.staff_profiles sp on sp.id = ct.staff_profile_id
      join kid k on ct.class_id = k.class_id and ct.session_label = k.session_label
      where ct.role = 'class_teacher' and sp.is_active
        and (ct.effective_from is null or ct.effective_from <= (select d from today))
        and (ct.effective_to is null or ct.effective_to >= (select d from today))
      order by ct.effective_from desc nulls last
      limit 1
    ),
    -- The next 30 days of the child's own session calendar.
    'calendar', coalesce((
      select jsonb_agg(jsonb_build_object(
          'date', e.starts_on, 'until', e.ends_on, 'title', e.title, 'title_hi', e.title_hi, 'kind', e.kind)
        order by e.starts_on)
      from vppsone.calendar_events e
      join kid k on e.session_label = k.session_label
      where e.cancelled_at is null
        and coalesce(e.ends_on, e.starts_on) >= (select d from today)
        and e.starts_on <= (select d from today) + 30
        and (e.class_ids is null or cardinality(e.class_ids) = 0 or k.class_id = any(e.class_ids))
    ), '[]'::jsonb)
  ) end;
$$;

create function vppsone.parent_helper_budget(p_from text, p_month_start timestamptz, p_day_start timestamptz)
returns table (spent_usd numeric, helper_usd numeric, turns_today integer)
language sql
stable
set search_path = ''
as $$
  with helper as (
    select coalesce(sum(t.cost_usd), 0) as usd
    from vppsone.parent_helper_turns t
    where t.created_at >= p_month_start
  )
  select
    coalesce((select sum(l.cost_usd) from vppsone.assist_log l where l.created_at >= p_month_start), 0) + (select usd from helper),
    (select usd from helper),
    (select count(*)::integer from vppsone.parent_helper_turns t
       where t.from_e164 = p_from and t.created_at >= p_day_start and t.status = 'answered');
$$;

revoke all on function vppsone.parent_helper_child(uuid) from public, anon, authenticated;
revoke all on function vppsone.parent_helper_budget(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function vppsone.parent_helper_child(uuid) to service_role;
grant execute on function vppsone.parent_helper_budget(text, timestamptz, timestamptz) to service_role;

commit;
