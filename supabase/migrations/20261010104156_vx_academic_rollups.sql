-- Roll-ups the coordinator's screens read (AcadHome, AcadProgress,
-- AcadAttendance, Calendar), so a month of attendance is ~700 register rows
-- rather than ~16,000 marks, and an exam's class-by-subject heat map is one
-- row per paper. Views only, in vppsone, security_invoker: a reader sees what
-- the underlying tables' RLS lets them see.

-- One daily register with its counts. Late counts present (a whole day),
-- leave is not counted, half day is the session's credit — the same rules as
-- modules/attendance/domain/attendance.ts and v_needs_attention.
create or replace view vppsone.v_register_tally
with (security_invoker = true) as
select r.id as register_id,
       r.session_label,
       r.class_id,
       r.day,
       r.status,
       r.submitted_at,
       r.taken_by,
       r.on_behalf_of,
       count(m.student_id)::int as marked,
       count(m.student_id) filter (where m.status = 'present')::int as present,
       count(m.student_id) filter (where m.status = 'absent')::int as absent,
       count(m.student_id) filter (where m.status = 'late')::int as late,
       count(m.student_id) filter (where m.status = 'leave')::int as on_leave,
       count(m.student_id) filter (where m.status = 'half_day')::int as half_day
from vppsone.attendance_registers r
left join vppsone.attendance_marks m on m.register_id = r.id
where r.period is null
group by r.id;

comment on view vppsone.v_register_tally is
  'Each daily register with its present/absent/late/leave/half-day counts.';

-- A child's attendance this session, from submitted daily registers.
create or replace view vppsone.v_student_attendance
with (security_invoker = true) as
select r.session_label,
       m.student_id,
       count(*) filter (where m.status <> 'leave')::int as days_counted,
       sum(case m.status
             when 'present' then 1.0
             when 'late' then 1.0
             when 'half_day' then coalesce(ar.half_day_credit, 0.5)
             when 'absent' then 0.0
             else 0.0
           end) as credit,
       count(*) filter (where m.status = 'absent')::int as absent_days,
       count(*) filter (where m.status = 'late')::int as late_days,
       count(*) filter (where m.status = 'absent' and r.day >= vppsone.school_today() - 7)::int as absent_last_week,
       round(100.0 * sum(case m.status
                           when 'present' then 1.0
                           when 'late' then 1.0
                           when 'half_day' then coalesce(ar.half_day_credit, 0.5)
                           when 'absent' then 0.0
                           else 0.0
                         end) / nullif(count(*) filter (where m.status <> 'leave'), 0), 1) as attendance_pct
from vppsone.attendance_marks m
join vppsone.attendance_registers r on r.id = m.register_id
left join vppsone.attendance_rules ar on ar.session_label = r.session_label
where r.status = 'submitted' and r.period is null
group by r.session_label, m.student_id;

comment on view vppsone.v_student_attendance is
  'Each child''s attendance this session from submitted daily registers (late = present, leave not counted).';

-- One exam paper (class × subject) with how far entry has got and how it went.
create or replace view vppsone.v_paper_stats
with (security_invoker = true) as
select s.id as paper_id,
       s.assessment_id,
       a.session_label,
       a.code as exam_code,
       s.class_id,
       s.class_label,
       s.subject_id,
       s.subject_code,
       s.max_marks,
       s.pass_marks,
       s.entry_status,
       s.submitted_at,
       s.sort_order,
       count(mk.id) filter (where mk.value is not null or mk.absent or mk.exempt)::int as entered,
       count(mk.value)::int as scored,
       round(avg(100.0 * mk.value / nullif(s.max_marks, 0)), 1) as avg_pct,
       count(mk.id) filter (where mk.value >= s.pass_marks)::int as passed
from vppsone.assessment_subjects s
join vppsone.assessments a on a.id = s.assessment_id
left join vppsone.marks mk on mk.assessment_subject_id = s.id
group by s.id, a.id;

comment on view vppsone.v_paper_stats is
  'Each exam paper with marks entered, average percent and passes.';

-- A child's result in one exam across their papers.
create or replace view vppsone.v_student_exam
with (security_invoker = true) as
select a.session_label,
       s.assessment_id,
       mk.student_id,
       s.class_id,
       round(avg(100.0 * mk.value / nullif(s.max_marks, 0)), 1) as avg_pct,
       count(mk.value)::int as papers,
       count(mk.value) filter (where mk.value < s.pass_marks)::int as failed
from vppsone.marks mk
join vppsone.assessment_subjects s on s.id = mk.assessment_subject_id
join vppsone.assessments a on a.id = s.assessment_id
where mk.value is not null and not mk.absent and not mk.exempt
group by a.session_label, s.assessment_id, mk.student_id, s.class_id;

comment on view vppsone.v_student_exam is
  'Each child''s average percent and failed papers in one exam.';

grant select on vppsone.v_register_tally, vppsone.v_student_attendance,
  vppsone.v_paper_stats, vppsone.v_student_exam to authenticated;
