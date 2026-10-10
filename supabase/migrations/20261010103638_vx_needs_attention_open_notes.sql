-- "2 or more open notes" now reads the notes' own status (open, working,
-- done), which the Notes redesign added, instead of standing in with "concern
-- notes in the last 30 days". Praise is never a reason for attention.
-- Same columns, so create or replace keeps every grant and reader.
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
    and n.status in ('open', 'working')
    and k.tone <> 'good'
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
  'Children needing attention: attendance < 75% (5+ days counted), any subject < 33% in the latest paper, a drop of 15+ points since the previous paper, or 2+ notes still open (status open or working, not praise).';

grant select on vppsone.v_needs_attention to authenticated;
