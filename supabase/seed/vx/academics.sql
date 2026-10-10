-- Fake data for the academic coordinator's screens and the school calendar
-- (docs/ui, P8 + Calendar). schoolfees-dev only (wtgxcptmucjerhufzjcf).
--
-- Idempotent: every insert skips what is already there, and the attendance
-- fill only touches registers nobody has saved (status open, revision 0, no
-- marks). Children are the masked replica's; nothing here names a real
-- person. Session 2026-27; "today" is 10 Oct 2026, a Saturday.

begin;

-- ------------------------------------------------------------- holidays

insert into vppsone.academic_calendar_days (session_label, day, kind, label_en, label_hi)
select '2026-27', d.day::date, d.kind::vppsone.calendar_day_kind, d.en, d.hi
from (values
  ('2026-08-15', 'holiday', 'Independence Day', 'स्वतंत्रता दिवस'),
  ('2026-08-28', 'holiday', 'Raksha Bandhan', 'रक्षाबंधन'),
  ('2026-09-04', 'holiday', 'Janmashtami', 'जन्माष्टमी'),
  ('2026-10-02', 'holiday', 'Gandhi Jayanti', 'गांधी जयंती'),
  ('2026-10-20', 'holiday', 'Dussehra', 'दशहरा'),
  ('2026-11-07', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-11-08', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-11-09', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-11-10', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-11-11', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-11-12', 'vacation', 'Diwali break', 'दीपावली अवकाश'),
  ('2026-12-25', 'holiday', 'Christmas', 'क्रिसमस'),
  ('2027-01-26', 'holiday', 'Republic Day', 'गणतंत्र दिवस'),
  ('2027-03-22', 'holiday', 'Holi', 'होली')
) as d(day, kind, en, hi)
on conflict (session_label, day) do nothing;

-- -------------------------------------------------------- class teachers

-- Every class gets a class teacher, from the teaching staff already on file,
-- where it has none.
with open_classes as (
  select ca.class_id, row_number() over (order by ca.sort_order) as n
  from vppsone.class_aliases ca
  where ca.session_label = '2026-27'
    and not exists (
      select 1 from vppsone.class_teachers ct
      where ct.class_id = ca.class_id and ct.session_label = '2026-27'
        and ct.role = 'class_teacher' and ct.effective_to is null
    )
),
free_teachers as (
  select sp.id, row_number() over (order by sp.display_name) as n
  from vppsone.staff_profiles sp
  where sp.role = 'teacher' and sp.is_active and sp.is_teaching
    and sp.display_name not like 'QA %' and sp.display_name not like 'Test %'
    and not exists (
      select 1 from vppsone.class_teachers ct
      where ct.staff_profile_id = sp.id and ct.session_label = '2026-27' and ct.effective_to is null
    )
)
insert into vppsone.class_teachers (class_id, session_label, staff_profile_id, role, effective_from)
select oc.class_id, '2026-27', ft.id, 'class_teacher', '2026-07-01'
from open_classes oc join free_teachers ft on ft.n = oc.n
on conflict do nothing;

-- ------------------------------------------------------------ attendance

-- Registers for every school day from 1 Sep to today that nobody has saved.
insert into vppsone.attendance_registers (session_label, class_id, day, period, status, revision)
select '2026-27', ca.class_id, d::date, null, 'open', 0
from vppsone.class_aliases ca
cross join generate_series('2026-09-01'::date, '2026-10-10'::date, interval '1 day') d
where ca.session_label = '2026-27'
  and extract(isodow from d) <> 7
  and not exists (
    select 1 from vppsone.academic_calendar_days c
    where c.session_label = '2026-27' and c.day = d::date and c.kind in ('holiday', 'vacation')
  )
on conflict (session_label, class_id, day) where period is null do nothing;

-- Which registers this seed fills: unsaved and unmarked, except today's for
-- Class 4 and Class 9, which stay "not marked" for the screens to show.
create temporary table seed_targets on commit drop as
select r.id, r.class_id, r.day
from vppsone.attendance_registers r
where r.session_label = '2026-27' and r.period is null
  and r.day between '2026-09-01' and '2026-10-10'
  and r.status = 'open' and r.revision = 0
  and not exists (select 1 from vppsone.attendance_marks m where m.register_id = r.id)
  and not (
    r.day = '2026-10-10' and r.class_id in (
      select class_id from vppsone.class_aliases
      where session_label = '2026-27' and timetable_label in ('Class 4', 'Class 9')
    )
  );

-- A child's absence rate comes from a hash of their id: most are absent ~3%
-- of days, some ~12%, a few ~32% — the ones the below-75% list should find.
insert into vppsone.attendance_marks (register_id, student_id, status)
select t.id, e.student_id,
  (case
     when draw < rate then 'absent'
     when draw < rate + 15 then 'leave'
     when draw < rate + 28 then 'late'
     when draw < rate + 34 then 'half_day'
     else 'present'
   end)::vppsone.attendance_status
from seed_targets t
join vppsone.enrolments e on e.class_id = t.class_id and e.session_label = '2026-27' and e.status = 'enrolled'
cross join lateral (
  select abs(hashtext(e.student_id::text || t.day::text)) % 1000 as draw,
         case
           when abs(hashtext(e.student_id::text)) % 100 < 4 then 320
           when abs(hashtext(e.student_id::text)) % 100 < 11 then 120
           else 30
         end as rate
) x
on conflict do nothing;

update vppsone.attendance_registers r
set status = 'submitted',
    revision = 1,
    submitted_at = (r.day::timestamp + interval '8 hours 10 minutes'
                    + (abs(hashtext(r.id::text)) % 40) * interval '1 minute') at time zone 'Asia/Kolkata',
    taken_by = (
      select ct.staff_profile_id from vppsone.class_teachers ct
      where ct.class_id = r.class_id and ct.session_label = '2026-27'
        and ct.role = 'class_teacher' and ct.effective_to is null
      limit 1
    )
from seed_targets t
where r.id = t.id;

-- ------------------------------------------------------------------ marks

-- Papers for Unit Test (FA1, out of 20) and Half-yearly (SA1, out of 80) in
-- every class and academic subject the timetable gives it; the three
-- kindergarten classes take Hindi, English and Maths.
-- The mark a child gets, as a percentage (see the seed_levels comment).
create or replace function pg_temp.vppsone_seed_pct(student uuid, subject text, exam text)
returns numeric language sql immutable as $$
  select least(98, greatest(5,
    case when abs(hashtext(student::text || 'weak')) % 100 < 3
         then 18 + abs(hashtext(student::text)) % 12
         else 48 + abs(hashtext(student::text)) % 46 end
    + (abs(hashtext(student::text || subject)) % 13) - 6
    + case when exam = 'SA1' then
        case when abs(hashtext(student::text || 'drop')) % 100 < 3
              and abs(hashtext(student::text || subject || 'drop')) % 3 = 0
             then -19 - abs(hashtext(student::text || subject || 'size')) % 6
             else (abs(hashtext(student::text || subject || 'sa')) % 11) - 5 end
      else 0 end
  ))::numeric
$$;

with exam as (
  select id, code from vppsone.assessments
  where session_label = '2026-27' and code in ('FA1', 'SA1')
),
class_subjects as (
  select distinct t.class_id, t.subject_id
  from vppsone.teaching_assignments t
  join vppsone.subjects s on s.id = t.subject_id
  where t.session_label = '2026-27'
    and s.code in ('Hindi', 'English', 'EVS', 'MATHS', 'Science', 'Physics', 'Chemistry', 'Biology',
                   'SST', 'Sanskrit', 'Economics', 'Geography', 'Accountancy', 'Business Studies',
                   'Political Science', 'Eng Lit')
  union
  select ca.class_id, s.id
  from vppsone.class_aliases ca
  cross join vppsone.subjects s
  where ca.session_label = '2026-27' and ca.timetable_label in ('NUR', 'JKG', 'SKG')
    and s.code in ('Hindi', 'English', 'MATHS')
)
insert into vppsone.assessment_subjects (assessment_id, class_id, class_label, subject_id, subject_code, max_marks, pass_marks, sort_order)
select exam.id, cs.class_id, c.class_name, s.id, s.code,
       case exam.code when 'FA1' then 20 else 80 end,
       case exam.code when 'FA1' then 7 else 27 end,
       s.sort_order
from exam
cross join class_subjects cs
join public.classes c on c.id = cs.class_id
join vppsone.subjects s on s.id = cs.subject_id
on conflict (assessment_id, class_id, subject_id) do nothing;

-- A child's level and each subject's lean come from hashes, so the same seed
-- gives the same marks. About one child in thirty is weak across the board
-- (the below-33 list), and about one in thirty falls ~20 points in one
-- subject or so from the Unit Test to the Half-yearly (the dropped list).
create temporary table seed_levels on commit drop as
select s.id as paper_id, a.code as exam, s.max_marks, e.student_id, s.subject_code,
       pg_temp.vppsone_seed_pct(e.student_id, s.subject_code, a.code) as pct,
       abs(hashtext(s.id::text)) % 100 as paper_draw,
       row_number() over (partition by s.id order by e.student_id) as k,
       count(*) over (partition by s.id) as roll
from vppsone.assessment_subjects s
join vppsone.assessments a on a.id = s.assessment_id
join vppsone.enrolments e on e.class_id = s.class_id and e.session_label = '2026-27' and e.status = 'enrolled'
where a.session_label = '2026-27' and a.code in ('FA1', 'SA1')
  and not exists (select 1 from vppsone.marks m where m.assessment_subject_id = s.id);

-- Unit Test: every paper entered. Half-yearly: about two papers in three
-- entered in full, one in six half done, the rest not started.
insert into vppsone.marks (assessment_subject_id, student_id, value, absent)
select paper_id, student_id,
       case when abs(hashtext(student_id::text || paper_id::text)) % 100 = 0 then null
            else round(pct * max_marks / 100.0 * 2) / 2 end,
       abs(hashtext(student_id::text || paper_id::text)) % 100 = 0
from seed_levels
where exam = 'FA1'
   or paper_draw < 66
   or (paper_draw < 82 and k <= roll / 2)
on conflict (assessment_subject_id, student_id) do nothing;

update vppsone.assessment_subjects s
set entry_status = 'submitted', submitted_at = '2026-09-30 10:00+05:30', entry_revision = 1
from vppsone.assessments a
where a.id = s.assessment_id and a.session_label = '2026-27'
  and (a.code = 'FA1' or (a.code = 'SA1' and abs(hashtext(s.id::text)) % 100 < 40))
  and s.entry_status = 'open'
  and exists (select 1 from vppsone.marks m where m.assessment_subject_id = s.id);

-- ------------------------------------------------------------------ notes

-- Two concern notes each for a handful of children, so the "2 or more open
-- notes" rule has somebody to find.
insert into vppsone.notes (session_label, student_id, class_id, kind_id, body, written_by, created_at)
select '2026-27', pick.student_id, pick.class_id, k.id, b.body, pick.teacher,
       now() - (b.n * 3 + pick.n) * interval '1 day'
from (
  select e.student_id, e.class_id,
         row_number() over (order by abs(hashtext(e.student_id::text || 'notes'))) as n,
         (select ct.staff_profile_id from vppsone.class_teachers ct
          where ct.class_id = e.class_id and ct.session_label = '2026-27' and ct.effective_to is null limit 1) as teacher
  from vppsone.enrolments e
  where e.session_label = '2026-27' and e.status = 'enrolled'
) pick
cross join (values
  (1, 'homework', 'Homework missing three days running. Spoke to the child; parents to be told.'),
  (2, 'behaviour', 'Quiet and withdrawn in class this week. Keeping an eye on it.')
) as b(n, code, body)
join vppsone.note_kinds k on k.code = b.code
where pick.n <= 6 and pick.teacher is not null
  and not exists (
    select 1 from vppsone.notes x
    where x.student_id = pick.student_id and x.session_label = '2026-27' and x.body = b.body
  );

-- ------------------------------------------------------- change requests

-- Four waiting requests from class teachers about the last few days.
insert into vppsone.attendance_corrections (register_id, student_id, from_status, to_status, reason, requested_by)
select pick.register_id, pick.student_id, 'absent', reasons.to_status::vppsone.attendance_status, reasons.reason, pick.teacher
from (
  select r.id as register_id, m.student_id, r.taken_by as teacher,
         row_number() over (order by r.day desc, abs(hashtext(m.student_id::text))) as n
  from vppsone.attendance_registers r
  join vppsone.attendance_marks m on m.register_id = r.id and m.status = 'absent'
  where r.session_label = '2026-27' and r.status = 'submitted' and r.taken_by is not null
    and r.day between '2026-10-05' and '2026-10-09'
) pick
join (values
  (1, 'present', 'Came at 10:15 after a doctor''s visit. I had already saved the register before she reached.'),
  (2, 'leave', 'A leave note from the father for a family wedding reached me a day late.'),
  (3, 'leave', 'Was at the district handball trial for the school. This is school-duty leave.'),
  (4, 'present', 'Was in the library helping with the book fair during the register.')
) as reasons(n, to_status, reason) on reasons.n = pick.n
where not exists (
  select 1 from vppsone.attendance_corrections c
  where c.register_id = pick.register_id and c.student_id = pick.student_id
);

-- ---------------------------------------------------------- teacher away

insert into vppsone.teacher_absences (session_label, staff_profile_id, day, periods, reason)
select '2026-27', ct.staff_profile_id, '2026-10-10', array[0,1,2,3,4,5,6,7], 'Leave'
from vppsone.class_teachers ct
join vppsone.class_aliases ca on ca.class_id = ct.class_id and ca.session_label = '2026-27'
where ct.session_label = '2026-27' and ct.effective_to is null and ca.timetable_label = 'Class 9'
  and not exists (
    select 1 from vppsone.teacher_absences ta
    where ta.staff_profile_id = ct.staff_profile_id and ta.day = '2026-10-10'
  )
limit 1;

-- ---------------------------------------------------------------- events

insert into vppsone.calendar_events (session_label, kind, title, title_hi, starts_on, ends_on, all_day, starts_at, ends_at, place, class_ids, details)
select '2026-27', e.kind, e.title, e.title_hi, e.starts_on::date, e.ends_on::date, e.all_day,
       e.starts_at::time, e.ends_at::time, e.place,
       coalesce((select array_agg(ca.class_id) from vppsone.class_aliases ca
                 where ca.session_label = '2026-27' and ca.timetable_label = any (e.classes)), '{}'),
       e.details
from (values
  ('exam', 'Half-yearly exams', 'अर्धवार्षिक परीक्षा', '2026-09-08', '2026-09-14', true, null, null, null, '{}'::text[], 'Date sheet on the notice board.'),
  ('exam', 'Half-yearly marks entry', 'अर्धवार्षिक अंक प्रविष्टि', '2026-10-05', '2026-10-14', true, null, null, null, '{}'::text[], 'Sampark links · subject teachers.'),
  ('exam', 'Board exam forms due', 'बोर्ड परीक्षा फ़ॉर्म', '2026-10-09', '2026-10-09', true, null, null, 'School office', array['Class 10', 'Class 12 Arts', 'Class 12 Commerce', 'Class 12 Science'], 'Forms and fees to the office.'),
  ('meeting', 'Staff meeting · results review', 'स्टाफ़ बैठक', '2026-10-10', '2026-10-10', false, '14:00', '15:30', 'Staff room', '{}'::text[], 'All staff.'),
  ('fee_due', 'Fee reminders · Installment 2', 'फीस रिमाइंडर', '2026-10-12', '2026-10-12', true, null, null, null, '{}'::text[], null),
  ('event', 'Inter-house quiz', 'अंतर-सदन प्रश्नोत्तरी', '2026-10-14', '2026-10-14', false, '11:30', '13:00', 'School hall', array['Class 6', 'Class 7', 'Class 8'], null),
  ('ptm', 'Results PTM · Nursery to Class 5', 'अभिभावक-शिक्षक बैठक', '2026-10-17', '2026-10-17', false, '09:00', '11:00', 'Classrooms', array['NUR', 'JKG', 'SKG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'], 'Report cards go home.'),
  ('ptm', 'PTM · Class 10', 'अभिभावक-शिक्षक बैठक · कक्षा 10', '2026-10-17', '2026-10-17', false, '12:00', '13:30', 'Class 10 room, first floor', array['Class 10'], 'Report cards, the board exam plan, and five minutes with each subject teacher.'),
  ('ptm', 'Results PTM · Classes 6–9', 'अभिभावक-शिक्षक बैठक', '2026-10-17', '2026-10-17', false, '10:00', '12:00', 'Classrooms', array['Class 6', 'Class 7', 'Class 8', 'Class 9'], null),
  ('event', 'District sports trials', 'ज़िला खेल चयन', '2026-10-23', '2026-10-23', true, null, null, 'District stadium', '{}'::text[], null),
  ('event', 'Fire safety drill', 'अग्नि सुरक्षा अभ्यास', '2026-10-28', '2026-10-28', false, '10:00', '10:30', 'Whole school', '{}'::text[], null),
  ('event', 'Sports day', 'खेल दिवस', '2026-10-31', '2026-10-31', true, null, null, 'School ground', '{}'::text[], null),
  ('exam', 'Unit Test 2', 'यूनिट टेस्ट 2', '2026-12-07', '2026-12-12', true, null, null, null, '{}'::text[], null)
) as e(kind, title, title_hi, starts_on, ends_on, all_day, starts_at, ends_at, place, classes, details)
where not exists (
  select 1 from vppsone.calendar_events x
  where x.session_label = '2026-27' and x.title = e.title and x.starts_on = e.starts_on::date
);

-- Notices already asked for: the summer holidays and Gandhi Jayanti were told.
insert into vppsone.calendar_notices (session_label, holiday_day, audience, recipients, cost_paise, rendered_hi, rendered_en, status, requested_by, requested_at)
select '2026-27', h.day::date, 'parents', 507, 507 * 88,
       'प्रिय अभिभावक, ' || h.hi || ' के अवसर पर विद्यालय बंद रहेगा।',
       'Dear parent, school will be closed for ' || h.en || '.',
       'sent',
       (select id from vppsone.staff_profiles where role = 'admin' and is_active order by created_at limit 1),
       h.day::date - 3
from (values
  ('2026-08-15', 'Independence Day', 'स्वतंत्रता दिवस'),
  ('2026-08-28', 'Raksha Bandhan', 'रक्षाबंधन'),
  ('2026-09-04', 'Janmashtami', 'जन्माष्टमी'),
  ('2026-10-02', 'Gandhi Jayanti', 'गांधी जयंती')
) as h(day, en, hi)
where not exists (
  select 1 from vppsone.calendar_notices n where n.session_label = '2026-27' and n.holiday_day = h.day::date
);

commit;
