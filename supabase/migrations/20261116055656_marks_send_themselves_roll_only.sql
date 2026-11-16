-- Marks send themselves (D-651), second step: only the children on the roll
-- decide whether a paper is ready.
--
-- Why: the first live look found a TEST paper with 5 children on its roll and
-- 24 marks on file. The other 19 children have left that class; their old
-- marks stay on the paper (half marks among them, from the Half Yearly
-- import) and the sheet no longer shows them. `marks_paper_ready_to_send`
-- checked every mark on the paper for "out of range or off-step", so those
-- marks held the paper back for good, although a teacher's Send marks would
-- go through: `save_marks` only checks the roll. Now the range and step check
-- reads the roll too, the same as the completeness check. Nothing else
-- changes: the two quiet hours still read every mark, and the job is the same.
--
-- Adds only: one `create or replace`, the grants repeated. Rollback: apply
-- the function body from 20261116055129_marks_send_themselves.sql again.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function vppsone.marks_paper_ready_to_send(p_paper uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with roll as (
    select r.student_id from vppsone.paper_roster(p_paper) as r(student_id)
  )
  select exists (select 1 from roll)
     -- Every child on the roll has a mark, an absence or an exemption.
     and not exists (
       select 1
         from roll
        where not exists (
          select 1 from vppsone.marks m
           where m.assessment_subject_id = p_paper
             and m.student_id = roll.student_id
             and (m.value is not null or m.absent or m.exempt)
        )
     )
     -- Nothing on the roll is out of range, off-step or a refused exemption.
     -- A child who left the class keeps their old mark and never holds it up.
     and not exists (
       select 1
         from vppsone.marks m
         join roll on roll.student_id = m.student_id
         join vppsone.assessment_subjects s on s.id = m.assessment_subject_id
        where m.assessment_subject_id = p_paper
          and (
            (m.value is not null and (m.value < 0 or m.value > s.max_marks or mod(m.value, s.mark_step) <> 0))
            or (m.exempt and not s.allow_exempt)
          )
     )
     -- Nobody has typed in it for two hours.
     and not exists (
       select 1 from vppsone.marks m
        where m.assessment_subject_id = p_paper
          and m.entered_at > now() - interval '2 hours'
     );
$$;

revoke all on function vppsone.marks_paper_ready_to_send(uuid) from public, anon, authenticated;
grant execute on function vppsone.marks_paper_ready_to_send(uuid) to service_role;

commit;
