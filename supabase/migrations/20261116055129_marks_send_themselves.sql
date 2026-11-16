-- Marks send themselves (D-651).
--
-- A teacher fills in every child's mark and then forgets to tap Send marks.
-- The paper stays open, the exam office sees it as late, Needs you keeps
-- asking her, and the coordinator chases a teacher whose work is already done.
--
-- The owner's answer (16 Nov): fully entered marks may send themselves. Once
-- an exam's marks due day is over, a paper goes to the exam office by itself
-- when every child on its roll has a mark, an absence or an exemption, every
-- saved mark fits the paper, and nobody has typed in it for two hours. It goes
-- exactly where Send marks takes it: to the exam office, never to parents.
-- Showing marks to parents stays the admin's decision (D-647).
--
-- Nothing else changes. A paper with a blank is left for the teacher and the
-- exam office as before. A class whose results are locked is not touched. The
-- exam office hands a paper back the usual way ("Hand back to teacher").
--
-- What this adds, all in `vppsone`, service role only:
--
--  * `assessment_subjects.sent_itself_at`: when the paper went by itself. It
--    reads "sent by itself" only while it equals `submitted_at`; a hand-back
--    and a person's later Send leave it behind, so nothing has to clear it.
--  * `exam_plans.marks_send_themselves` (on): the switch, per exam.
--  * `marks_paper_ready_to_send(paper)` and `marks_send_themselves(limit)`.
--    Each paper sent gets a line in the exam's activity ("Class 6 Maths went
--    to the exam office by itself").
--  * A pg_cron job, `marks-send-themselves`, at seven minutes past every hour.
--    The first run after a due day is 00:07 school time. It sends no message
--    and calls nothing outside the database.
--
-- Rollback: unschedule `marks-send-themselves`, then remove the two functions
-- and the two columns. Papers it sent stay sent, as if a person had sent them;
-- the exam office hands any of them back as usual.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table vppsone.assessment_subjects
  add column if not exists sent_itself_at timestamptz;

comment on column vppsone.assessment_subjects.sent_itself_at is
  'Marks send themselves (D-651): when this paper went to the exam office by itself after the marks due day. Means "sent by itself" only while it equals submitted_at.';

alter table vppsone.exam_plans
  add column if not exists marks_send_themselves boolean not null default true;

comment on column vppsone.exam_plans.marks_send_themselves is
  'Marks send themselves (D-651): after marks_due_on, a paper with every child''s mark entered goes to the exam office by itself.';

-- Whether a paper may go by itself now: every child on its roll has a mark,
-- an absence or an exemption (a roll of nobody never goes), every saved mark
-- fits the paper as it stands (B03/B04), and nobody has typed in it for two
-- hours, so it is never taken from under a teacher who is still checking.
create or replace function vppsone.marks_paper_ready_to_send(p_paper uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from vppsone.paper_roster(p_paper))
     and not exists (
       select 1
         from vppsone.paper_roster(p_paper) as roll(student_id)
        where not exists (
          select 1 from vppsone.marks m
           where m.assessment_subject_id = p_paper
             and m.student_id = roll.student_id
             and (m.value is not null or m.absent or m.exempt)
        )
     )
     and not exists (
       select 1
         from vppsone.marks m
         join vppsone.assessment_subjects s on s.id = m.assessment_subject_id
        where m.assessment_subject_id = p_paper
          and (
            (m.value is not null and (m.value < 0 or m.value > s.max_marks or mod(m.value, s.mark_step) <> 0))
            or (m.exempt and not s.allow_exempt)
          )
     )
     and not exists (
       select 1 from vppsone.marks m
        where m.assessment_subject_id = p_paper
          and m.entered_at > now() - interval '2 hours'
     );
$$;

comment on function vppsone.marks_paper_ready_to_send(uuid) is
  'Marks send themselves (D-651): every child on the roll has a mark, an absence or an exemption, every saved mark fits the paper, and nobody typed in it for two hours.';

-- The papers whose exam's marks due day is over and which are ready: each is
-- locked, checked again under the lock (a teacher saving right now holds the
-- same row first), sent, and noted in the exam's activity.
create or replace function vppsone.marks_send_themselves(p_limit integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := vppsone.school_today();
  v_now timestamptz := now();
  v_count integer := 0;
  r record;
begin
  for r in
    select s.id, s.assessment_id, s.class_label, s.subject_code
      from vppsone.assessment_subjects s
      join vppsone.assessments a on a.id = s.assessment_id
      join vppsone.exam_plans p on p.assessment_id = s.assessment_id
     where s.entry_status = 'open'
       and a.status = 'open'
       and p.marks_send_themselves
       and p.marks_due_on is not null
       and p.marks_due_on < v_today
       and not exists (
         select 1 from vppsone.exam_class_locks l
          where l.assessment_id = s.assessment_id and l.class_id = s.class_id
       )
       and vppsone.marks_paper_ready_to_send(s.id)
     order by p.marks_due_on, s.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    begin
      perform 1 from vppsone.assessment_subjects
        where id = r.id and entry_status = 'open'
        for update skip locked;
      if not found or not vppsone.marks_paper_ready_to_send(r.id) then
        continue;
      end if;

      update vppsone.assessment_subjects
         set entry_status = 'submitted',
             entry_revision = entry_revision + 1,
             submitted_by = null,
             submitted_at = v_now,
             sent_itself_at = v_now
       where id = r.id
         and entry_status = 'open';

      insert into vppsone.exam_activity (assessment_id, kind, text_en, text_hi, actor_staff_id)
      values (
        r.assessment_id,
        'sent_itself',
        r.class_label || ' ' || r.subject_code || ' went to the exam office by itself: every child had a mark after the due day',
        r.class_label || ' ' || r.subject_code || ' के अंक अपने-आप परीक्षा विभाग को गए: अंतिम दिन के बाद हर बच्चे के अंक भरे थे',
        null
      );
      v_count := v_count + 1;
    exception when others then
      -- A class locked a moment ago, or anything else odd about one paper:
      -- that paper waits for the next hour and the rest still go.
      null;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function vppsone.marks_send_themselves(integer) is
  'Marks send themselves (D-651): after an exam''s marks due day, send to the exam office every open paper that is fully and validly entered and quiet for two hours, and note each in the exam''s activity. Never a locked class; sends no message.';

revoke all on function vppsone.marks_paper_ready_to_send(uuid) from public, anon, authenticated;
revoke all on function vppsone.marks_send_themselves(integer) from public, anon, authenticated;
grant execute on function vppsone.marks_paper_ready_to_send(uuid) to service_role;
grant execute on function vppsone.marks_send_themselves(integer) to service_role;

-- Seven minutes past every hour, inside the database: no request, no WhatsApp.
select cron.schedule(
  'marks-send-themselves',
  '7 * * * *',
  $job$select vppsone.marks_send_themselves(200);$job$
);

commit;
