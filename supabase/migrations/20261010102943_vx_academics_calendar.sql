-- The academic coordinator's app and the school calendar (docs/design-handoff
-- SCREENS: AcadHome, AcadProgress, AcadAttendance, Calendar). Additive, and
-- in `vppsone` only. Every table has RLS with a read policy for active staff;
-- writes go through server actions that check a permission first and use the
-- service role, like the rest of this schema.

-- ------------------------------------------------------------------ calendar

-- Events that are not a change to whether school is open. Holidays stay in
-- `academic_calendar_days`, which attendance and the timetable already read,
-- so a holiday added here closes the register too.
create table if not exists vppsone.calendar_events (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  kind text not null,
  title text not null,
  title_hi text,
  starts_on date not null,
  ends_on date not null,
  all_day boolean not null default true,
  starts_at time,
  ends_at time,
  place text,
  -- `public.classes.id`, no FK (rule 2). Empty means the whole school.
  class_ids uuid[] not null default '{}',
  details text,
  created_by uuid references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  updated_by uuid references vppsone.staff_profiles (id),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references vppsone.staff_profiles (id),
  constraint calendar_events_kind_known check (kind in ('exam', 'event', 'ptm', 'meeting', 'fee_due')),
  constraint calendar_events_dates_ordered check (ends_on >= starts_on),
  constraint calendar_events_title_present check (length(btrim(title)) between 1 and 120),
  constraint calendar_events_time_when_timed check (all_day or starts_at is not null)
);

comment on table vppsone.calendar_events is
  'School calendar events (exam, event, PTM, meeting, fee due). Holidays are academic_calendar_days rows. Cancelled, never deleted.';

create index if not exists calendar_events_session_dates
  on vppsone.calendar_events (session_label, starts_on, ends_on);

create trigger calendar_events_set_updated_at
  before update on vppsone.calendar_events
  for each row execute function vppsone.set_updated_at();

alter table vppsone.calendar_events enable row level security;
create policy calendar_events_select_active_staff on vppsone.calendar_events
  for select to authenticated using ((select vppsone.is_active_staff()));
grant select on vppsone.calendar_events to authenticated;

-- A notice about an event or a holiday that somebody asked to send. Parent
-- messages are approval-by-default (PLAN §14, parent_message_policies), so a
-- notice is recorded with its text, audience, count and cost, and waits for
-- approval in Messages; nothing here sends.
create table if not exists vppsone.calendar_notices (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  event_id uuid references vppsone.calendar_events (id),
  holiday_day date,
  audience text not null,
  recipients integer not null default 0,
  cost_paise integer not null default 0,
  send_at timestamptz,
  rendered_hi text not null,
  rendered_en text not null,
  status text not null default 'awaiting_approval',
  requested_by uuid not null references vppsone.staff_profiles (id),
  requested_at timestamptz not null default now(),
  constraint calendar_notices_audience_known check (audience in ('parents', 'staff', 'both')),
  constraint calendar_notices_status_known check (status in ('awaiting_approval', 'approved', 'sent', 'cancelled')),
  constraint calendar_notices_names_its_subject check (event_id is not null or holiday_day is not null)
);

comment on table vppsone.calendar_notices is
  'A parent or staff notice about a calendar event or holiday: what it says, to whom, the count and cost. Waits for approval; never sent from here.';

create index if not exists calendar_notices_event on vppsone.calendar_notices (event_id);
create index if not exists calendar_notices_holiday on vppsone.calendar_notices (session_label, holiday_day);

alter table vppsone.calendar_notices enable row level security;
create policy calendar_notices_select_active_staff on vppsone.calendar_notices
  for select to authenticated using ((select vppsone.is_active_staff()));
grant select on vppsone.calendar_notices to authenticated;

-- ------------------------------------------------------------ support plans

create table if not exists vppsone.support_plans (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  -- `public.students.id`, no FK (rule 2).
  student_id uuid not null,
  goal text,
  status text not null default 'draft',
  created_by uuid not null references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  closed_at timestamptz,
  constraint support_plans_status_known check (status in ('draft', 'active', 'done', 'closed'))
);

comment on table vppsone.support_plans is
  'A plan to help one child: a goal and steps with an owner and a date. Draft until started.';

create index if not exists support_plans_student on vppsone.support_plans (session_label, student_id);

create trigger support_plans_set_updated_at
  before update on vppsone.support_plans
  for each row execute function vppsone.set_updated_at();

create table if not exists vppsone.support_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references vppsone.support_plans (id) on delete cascade,
  text text not null,
  owner_staff_id uuid references vppsone.staff_profiles (id),
  due_label text,
  sort_order integer not null default 0,
  done_at timestamptz,
  done_by uuid references vppsone.staff_profiles (id),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint support_plan_steps_text_present check (length(btrim(text)) between 1 and 160)
);

create index if not exists support_plan_steps_plan on vppsone.support_plan_steps (plan_id, sort_order);

alter table vppsone.support_plans enable row level security;
alter table vppsone.support_plan_steps enable row level security;
create policy support_plans_select_scoped on vppsone.support_plans
  for select to authenticated using (
    (select vppsone.staff_can('notes:view'))
    and ((select vppsone.reads_every_class()) or created_by = (select vppsone.current_staff_profile_id()))
  );
create policy support_plan_steps_select_scoped on vppsone.support_plan_steps
  for select to authenticated using (
    exists (select 1 from vppsone.support_plans p where p.id = support_plan_steps.plan_id)
  );
grant select on vppsone.support_plans, vppsone.support_plan_steps to authenticated;

-- ----------------------------------------------- follow-up on children

-- What a coordinator did about a child on the needs-attention or below-75%
-- lists: a call and its outcome, "improving", or a follow-up handed to
-- somebody. Appended; the latest row of a kind is what the list shows.
create table if not exists vppsone.student_followups (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,
  kind text not null,
  outcome text,
  note text,
  owner_staff_id uuid references vppsone.staff_profiles (id),
  created_by uuid not null references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  constraint student_followups_kind_known check (kind in ('call', 'improving', 'follow_up')),
  constraint student_followups_outcome_known check (
    outcome is null or outcome in ('reached', 'no_answer', 'wrong_number', 'will_come', 'visit_school')
  ),
  constraint student_followups_note_length check (note is null or length(note) <= 400)
);

comment on table vppsone.student_followups is
  'Calls to parents, "improving" marks and follow-ups handed to staff, for children on the attention lists. Append-only.';

create index if not exists student_followups_student
  on vppsone.student_followups (session_label, student_id, created_at desc);

alter table vppsone.student_followups enable row level security;
create policy student_followups_select_scoped on vppsone.student_followups
  for select to authenticated using (
    (select vppsone.staff_can('attendance:view')) and (select vppsone.reads_every_class())
  );
grant select on vppsone.student_followups to authenticated;

-- ------------------------------------------------------- needs attention

-- The coordinator's list, built by the database from the same facts every
-- screen reads (docs/design-handoff DATA-MODEL "v_needs_attention"):
--
--   attendance below 75%      submitted daily registers this session; late is
--                             a whole day, half day is the session's credit,
--                             leave is out of both halves (domain/attendance)
--   below 33% in a subject    the child's latest paper in that subject
--   marks dropped 15%+        latest paper vs the one before, same subject,
--                             in percentage points
--   2 or more open notes      notes of a concern kind in the last 30 days
--
-- One row per child with at least one reason. security_invoker, so a reader
-- sees only the rows the underlying tables' RLS lets them see.
create or replace view vppsone.v_needs_attention
with (security_invoker = true) as
with credit as (
  select r.session_label,
         m.student_id,
         r.class_id,
         case m.status
           when 'present' then 1.0
           when 'late' then 1.0
           when 'half_day' then coalesce(ar.half_day_credit, 0.5)
           when 'absent' then 0.0
           else null
         end as credit
  from vppsone.attendance_marks m
  join vppsone.attendance_registers r on r.id = m.register_id
  left join vppsone.attendance_rules ar on ar.session_label = r.session_label
  where r.status = 'submitted' and r.period is null
),
att as (
  select session_label, student_id,
         count(credit) as days_counted,
         round(100.0 * sum(credit) / nullif(count(credit), 0), 1) as attendance_pct
  from credit
  group by session_label, student_id
),
papers as (
  select a.session_label,
         mk.student_id,
         s.class_id,
         s.subject_id,
         s.subject_code,
         round(100.0 * mk.value / nullif(s.max_marks, 0), 1) as pct,
         row_number() over (
           partition by a.session_label, mk.student_id, s.subject_id
           order by coalesce(a.starts_on, a.ends_on, a.created_at::date) desc, a.created_at desc
         ) as recency
  from vppsone.marks mk
  join vppsone.assessment_subjects s on s.id = mk.assessment_subject_id
  join vppsone.assessments a on a.id = s.assessment_id
  where mk.value is not null and not mk.absent and not mk.exempt
),
latest as (
  select l.session_label, l.student_id, l.subject_code, l.pct, p.pct as previous_pct
  from papers l
  left join papers p
    on p.session_label = l.session_label and p.student_id = l.student_id
   and p.subject_id = l.subject_id and p.recency = 2
  where l.recency = 1
),
marks_flags as (
  select session_label, student_id,
         array_agg(subject_code order by pct) filter (where pct < 33) as below_33_subjects,
         max(previous_pct - pct) filter (where previous_pct - pct >= 15) as drop_points,
         (array_agg(subject_code order by previous_pct - pct desc nulls last)
            filter (where previous_pct - pct >= 15))[1] as drop_subject
  from latest
  group by session_label, student_id
),
open_notes as (
  select n.session_label, n.student_id, count(*)::int as open_notes
  from vppsone.notes n
  join vppsone.note_kinds k on k.id = n.kind_id
  where n.student_id is not null
    and k.tone = 'concern'
    and n.created_at >= now() - interval '30 days'
  group by n.session_label, n.student_id
),
children as (
  select session_label, student_id from att
  union select session_label, student_id from marks_flags
  union select session_label, student_id from open_notes
)
select c.session_label,
       c.student_id,
       e.class_id,
       att.attendance_pct,
       coalesce(att.days_counted, 0) as days_counted,
       coalesce(mf.below_33_subjects, '{}') as below_33_subjects,
       mf.drop_points,
       mf.drop_subject,
       coalesce(o.open_notes, 0) as open_notes,
       array_remove(array[
         case when att.attendance_pct < 75 and att.days_counted >= 5 then 'attendance' end,
         case when coalesce(cardinality(mf.below_33_subjects), 0) > 0 then 'below_33' end,
         case when mf.drop_points is not null then 'dropped' end,
         case when coalesce(o.open_notes, 0) >= 2 then 'notes' end
       ], null) as reasons
from children c
join vppsone.enrolments e
  on e.student_id = c.student_id and e.session_label = c.session_label and e.status = 'enrolled'
left join att on att.session_label = c.session_label and att.student_id = c.student_id
left join marks_flags mf on mf.session_label = c.session_label and mf.student_id = c.student_id
left join open_notes o on o.session_label = c.session_label and o.student_id = c.student_id
where (att.attendance_pct < 75 and att.days_counted >= 5)
   or coalesce(cardinality(mf.below_33_subjects), 0) > 0
   or mf.drop_points is not null
   or coalesce(o.open_notes, 0) >= 2;

comment on view vppsone.v_needs_attention is
  'Children needing attention: attendance < 75% (5+ days counted), any subject < 33% in the latest paper, a drop of 15+ points since the previous paper, or 2+ concern notes in 30 days.';

grant select on vppsone.v_needs_attention to authenticated;

-- ---------------------------------------------------- weekly summary

insert into vppsone.message_templates (code, label_hi, label_en, body_hi, body_en, variables, audience, sort_order)
values (
  'vppsone_weekly_summary',
  'साप्ताहिक शैक्षणिक सारांश',
  'Weekly academic summary',
  'नमस्ते {{1}}, इस सप्ताह का शैक्षणिक सारांश: {{2}} — {{3}}',
  'Hello {{1}}, this week''s academic summary: {{2}} — {{3}}',
  array['name', 'summary', 'from'],
  'staff',
  40
)
on conflict (code) do nothing;
