-- UI P9 seed: the exam office on schoolfees-dev.
--
-- Fake data only. Nothing here names a person: papers, marks and plans are
-- worked out from the classes, enrolments and teaching assignments already
-- in dev, and every mark is a deterministic hash of ids, so running this
-- twice changes nothing.
--
-- Applied to wtgxcptmucjerhufzjcf only. Never to the live fee database.

-- A small stable number from any text: 0 … 65535.
create or replace function pg_temp.h(t text) returns integer language sql immutable as $$
  select get_byte(decode(md5(t), 'hex'), 0) * 256 + get_byte(decode(md5(t), 'hex'), 1)
$$;

-- ---------------------------------------------------------------------------
-- 1. Term 1's report scheme, approved, so cards can be issued
-- ---------------------------------------------------------------------------

insert into vppsone.report_schemes (
  session_label, term, revision, status, grade_bands, percent_decimals, pass_percent,
  attendance_from, attendance_to, header_en, header_hi, signatories, approved_by, approved_at
)
select '2026-27', 'Term 1', 1, 'approved',
  '[{"from":91,"label":"A1","hi":"उत्कृष्ट","en":"Outstanding"},
    {"from":81,"label":"A2","hi":"बहुत अच्छा","en":"Excellent"},
    {"from":71,"label":"B1","hi":"अच्छा","en":"Very good"},
    {"from":61,"label":"B2","hi":"संतोषजनक","en":"Good"},
    {"from":51,"label":"C1","hi":"ठीक","en":"Fair"},
    {"from":41,"label":"C2","hi":"सुधार आवश्यक","en":"Needs improvement"},
    {"from":33,"label":"D","hi":"न्यूनतम","en":"Just passing"},
    {"from":0,"label":"E","hi":"पुनः प्रयास","en":"Needs much more work"}]'::jsonb,
  1, 33, '2026-07-01', '2026-09-30',
  'Half-yearly report card', 'अर्धवार्षिक प्रगति पत्र',
  '[{"en":"Class teacher","hi":"कक्षा अध्यापक"},{"en":"Exam coordinator","hi":"परीक्षा प्रभारी"},{"en":"Principal","hi":"प्रधानाचार्य"}]'::jsonb,
  (select id from vppsone.staff_profiles where role = 'exam_coordinator' and is_active order by created_at limit 1),
  now()
where not exists (select 1 from vppsone.report_schemes where session_label = '2026-27' and term = 'Term 1');

-- ---------------------------------------------------------------------------
-- 2. Half-yearly sat 23 Sep – 3 Oct. Dev's enrolments are dated 22 Sep (the
--    day the replica was made), and a paper's roll is the class during its
--    exam, so the exam has to fall after that for anyone to have sat it.
-- ---------------------------------------------------------------------------

update vppsone.assessments set starts_on = '2026-09-23', ends_on = '2026-10-03'
where code = 'SA1' and session_label = '2026-27' and starts_on = '2026-09-08';

-- ---------------------------------------------------------------------------
-- 2b. Half-yearly papers for every class the timetable teaches
-- ---------------------------------------------------------------------------

insert into vppsone.assessment_subjects (
  assessment_id, class_id, class_label, subject_id, subject_code, max_marks, pass_marks, sort_order, mark_step, allow_exempt
)
select distinct on (ta.class_id, ta.subject_id)
  a.id, ta.class_id, c.class_name, ta.subject_id, s.code, 80, 26, s.sort_order, 1, false
from vppsone.teaching_assignments ta
join vppsone.assessments a on a.session_label = ta.session_label and a.code = 'SA1'
join public.classes c on c.id = ta.class_id
join vppsone.subjects s on s.id = ta.subject_id
where ta.session_label = '2026-27'
  and s.code not in ('NoteBook Checking', 'Self Study', 'Robotics', 'CCS', 'Sports')
on conflict (assessment_id, class_id, subject_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Marks: about half the papers finished, a third under way, the rest not
--    started. A child's level is stable across subjects; a few are absent.
-- ---------------------------------------------------------------------------

with papers as (
  select s.id, s.class_id, s.max_marks, a.session_label,
         pg_temp.h(s.id::text || 'progress') % 100 as roll_dice
  from vppsone.assessment_subjects s
  join vppsone.assessments a on a.id = s.assessment_id
  where a.code = 'SA1' and a.session_label = '2026-27'
    and not exists (select 1 from vppsone.marks m where m.assessment_subject_id = s.id)
),
share as (
  select id, class_id, max_marks, session_label,
         case when roll_dice < 50 then 100 when roll_dice < 80 then 30 + roll_dice % 60 else 0 end as pct
  from papers
),
roster as (
  select sh.id as paper_id, sh.max_marks, sh.pct, e.student_id,
         row_number() over (partition by sh.id order by pg_temp.h(e.student_id::text || sh.id::text)) as n,
         count(*) over (partition by sh.id) as total
  from share sh
  join vppsone.enrolments e on e.class_id = sh.class_id and e.session_label = sh.session_label and e.status = 'enrolled'
)
insert into vppsone.marks (assessment_subject_id, student_id, value, absent, exempt, entered_by, entered_at)
select r.paper_id, r.student_id,
  case when pg_temp.h(r.student_id::text || r.paper_id::text || 'abs') % 40 = 0 then null
       else least(r.max_marks, greatest(0,
         round(r.max_marks * (0.22 + 0.7 * (pg_temp.h(r.student_id::text) % 100) / 100.0)
               + (pg_temp.h(r.paper_id::text || r.student_id::text) % 13) - 6)))
  end,
  pg_temp.h(r.student_id::text || r.paper_id::text || 'abs') % 40 = 0,
  false,
  (select ta.staff_profile_id from vppsone.teaching_assignments ta
     join vppsone.assessment_subjects s on s.class_id = ta.class_id and s.subject_id = ta.subject_id
    where s.id = r.paper_id and ta.session_label = '2026-27' limit 1),
  timestamptz '2026-09-20 10:00+05:30' + (pg_temp.h(r.paper_id::text) % 400) * interval '1 hour'
from roster r
where r.n <= ceil(r.total * r.pct / 100.0);

-- Finished papers are submitted by their teacher.
update vppsone.assessment_subjects s
set entry_status = 'submitted',
    entry_revision = greatest(s.entry_revision, 1) + 1,
    submitted_by = (select ta.staff_profile_id from vppsone.teaching_assignments ta
                    where ta.class_id = s.class_id and ta.subject_id = s.subject_id and ta.session_label = '2026-27' limit 1),
    submitted_at = timestamptz '2026-10-04 16:00+05:30' + (pg_temp.h(s.id::text) % 96) * interval '1 hour'
from vppsone.assessments a
where a.id = s.assessment_id and a.code = 'SA1' and a.session_label = '2026-27'
  and s.entry_status = 'open'
  and not exists (
    select 1 from vppsone.paper_roster(s.id) r
    where not exists (select 1 from vppsone.marks m where m.assessment_subject_id = s.id and m.student_id = r)
  )
  and exists (select 1 from vppsone.paper_roster(s.id))
  and (select ta.staff_profile_id from vppsone.teaching_assignments ta
       where ta.class_id = s.class_id and ta.subject_id = s.subject_id and ta.session_label = '2026-27' limit 1) is not null;

update vppsone.assessment_subjects s
set entry_revision = 1
from vppsone.assessments a
where a.id = s.assessment_id and a.code = 'SA1' and s.entry_status = 'open' and s.entry_revision = 0
  and exists (select 1 from vppsone.marks m where m.assessment_subject_id = s.id);

-- ---------------------------------------------------------------------------
-- 4. Unit Test 2: the next exam, being planned
-- ---------------------------------------------------------------------------

insert into vppsone.assessments (session_label, term, code, label_hi, label_en, kind, starts_on, ends_on, weight, status)
values ('2026-27', 'Term 2', 'UT2', 'इकाई परीक्षा 2', 'Unit Test 2', 'formative', '2026-12-07', '2026-12-12', 1, 'draft')
on conflict (session_label, term, code) do nothing;

insert into vppsone.exam_plans (assessment_id, marks_due_on, results_on, ptm_at, grace_max, grace_subjects, checklist)
select id, '2026-10-14', '2026-10-17', '10:00', 3, 2,
  jsonb_build_object(
    'datesheet', jsonb_build_object('at', '2026-09-01T10:00:00+05:30'),
    'seating', jsonb_build_object('at', '2026-09-05T10:00:00+05:30'),
    'papers', jsonb_build_object('at', '2026-09-06T10:00:00+05:30'),
    'held', jsonb_build_object('at', '2026-09-14T14:00:00+05:30')
  )
from vppsone.assessments where code = 'SA1' and session_label = '2026-27'
on conflict (assessment_id) do nothing;

insert into vppsone.exam_plans (assessment_id, marks_due_on, results_on, ptm_at, copied_from, grace_max, grace_subjects)
select ut.id, '2026-12-16', '2026-12-19', '10:00', fa.id, 2, 1
from vppsone.assessments ut, vppsone.assessments fa
where ut.code = 'UT2' and ut.session_label = '2026-27' and fa.code = 'FA1' and fa.session_label = '2026-27'
on conflict (assessment_id) do nothing;

-- The date sheet, Mon 7 – Sat 12 Dec. Classes 9–10 have Maths and Science
-- on the same Thursday, which is the clash the screen exists to catch.
insert into vppsone.exam_slots (assessment_id, group_key, subject_label, sits_on, starts_at, minutes, sort_order)
select ut.id, v.g, v.subj, v.d::date, v.t::time, v.m, v.o
from vppsone.assessments ut,
(values
  ('pre', 'English', '2026-12-07', '09:00', 45, 1), ('pre', 'Hindi', '2026-12-08', '09:00', 45, 2),
  ('pre', 'Maths', '2026-12-09', '09:00', 45, 3), ('pre', 'EVS', '2026-12-10', '09:00', 45, 4),
  ('pre', 'Drawing', '2026-12-11', '09:00', 45, 5),
  ('c1_5', 'English', '2026-12-07', '08:30', 60, 1), ('c1_5', 'Hindi', '2026-12-08', '08:30', 60, 2),
  ('c1_5', 'Maths', '2026-12-09', '08:30', 60, 3), ('c1_5', 'EVS', '2026-12-10', '08:30', 60, 4),
  ('c1_5', 'Sanskrit', '2026-12-11', '08:30', 60, 5), ('c1_5', 'Computer', '2026-12-12', '08:30', 60, 6),
  ('c6_8', 'Science', '2026-12-07', '08:30', 90, 1), ('c6_8', 'English', '2026-12-08', '08:30', 90, 2),
  ('c6_8', 'Maths', '2026-12-09', '08:30', 90, 3), ('c6_8', 'Hindi', '2026-12-10', '08:30', 90, 4),
  ('c6_8', 'Social Sci.', '2026-12-11', '08:30', 90, 5), ('c6_8', 'Sanskrit', '2026-12-12', '08:30', 90, 6),
  ('c9_10', 'English', '2026-12-07', '08:30', 90, 1), ('c9_10', 'Hindi', '2026-12-08', '08:30', 90, 2),
  ('c9_10', 'Social Sci.', '2026-12-09', '08:30', 90, 3), ('c9_10', 'Maths', '2026-12-10', '08:30', 90, 4),
  ('c9_10', 'Science', '2026-12-10', '11:00', 90, 5), ('c9_10', 'Sanskrit', '2026-12-11', '08:30', 90, 6),
  ('c11_12', 'English', '2026-12-07', '08:30', 90, 1), ('c11_12', 'Physics · Accounts · History', '2026-12-08', '08:30', 90, 2),
  ('c11_12', 'Hindi · Hindi Lit.', '2026-12-09', '08:30', 90, 3),
  ('c11_12', 'Chemistry · Business · Geography', '2026-12-10', '08:30', 90, 4),
  ('c11_12', 'Maths/Bio · Economics · Pol. Sci.', '2026-12-11', '08:30', 90, 5)
) as v(g, subj, d, t, m, o)
where ut.code = 'UT2' and ut.session_label = '2026-27'
  and not exists (select 1 from vppsone.exam_slots x where x.assessment_id = ut.id);

-- ---------------------------------------------------------------------------
-- 5. Rooms
-- ---------------------------------------------------------------------------

insert into vppsone.exam_rooms (name, seats, cols, sort_order)
select 'Room ' || n, case when n <= 6 then 30 else 36 end, case when n <= 6 then 5 else 6 end, n
from generate_series(1, 14) n
on conflict (name) do nothing;
insert into vppsone.exam_rooms (name, seats, cols, sort_order) values ('Hall', 80, 8, 99)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Question papers for Unit Test 2: some in, some checked, a few waiting
-- ---------------------------------------------------------------------------

insert into vppsone.exam_question_papers (slot_id, status)
select sl.id,
  (array['waiting', 'received', 'checked', 'checked', 'printed'])[1 + pg_temp.h(sl.id::text) % 5]
from vppsone.exam_slots sl
join vppsone.assessments ut on ut.id = sl.assessment_id and ut.code = 'UT2'
on conflict (slot_id) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Half-yearly: three recheck requests, and the exam's story so far
-- ---------------------------------------------------------------------------

insert into vppsone.exam_rechecks (paper_id, student_id, asked_by, note, status, old_value, created_by, created_at)
select m.assessment_subject_id, m.student_id,
  (array['Parent at the desk', 'Class teacher', 'Parent by phone'])[x.n],
  (array['Says one answer was not counted', 'Total on the copy looks short by 4', 'Page 3 seems unmarked'])[x.n],
  (array['new', 'with_teacher', 'new'])[x.n],
  m.value,
  (select id from vppsone.staff_profiles where role = 'exam_coordinator' order by created_at limit 1),
  now() - x.n * interval '5 hours'
from (
  select m.*, row_number() over (order by pg_temp.h(m.id::text)) as rn
  from vppsone.marks m
  join vppsone.assessment_subjects s on s.id = m.assessment_subject_id and s.entry_status = 'submitted'
  join vppsone.assessments a on a.id = s.assessment_id and a.code = 'SA1'
  where m.value is not null
) m
join (values (1), (2), (3)) as x(n) on x.n = m.rn
where not exists (select 1 from vppsone.exam_rechecks);

insert into vppsone.exam_activity (assessment_id, kind, text_en, text_hi, created_at)
select a.id, v.k, v.en, v.hi, now() - v.ago * interval '1 hour'
from vppsone.assessments a,
(values
  ('datesheet', 'Date sheet published to staff and parents', 'डेट शीट स्टाफ और अभिभावकों को भेजी गई', 720),
  ('papers', 'All question papers printed and sealed', 'सभी प्रश्न पत्र छपकर सील हुए', 650),
  ('held', 'Half-yearly exams finished', 'अर्धवार्षिक परीक्षा पूरी हुई', 600),
  ('marks', 'First class finished all its marks', 'पहली कक्षा के सभी अंक भरे गए', 200),
  ('recheck', 'A recheck was asked for at the desk', 'काउंटर पर पुनः जाँच माँगी गई', 5)
) as v(k, en, hi, ago)
where a.code = 'SA1' and a.session_label = '2026-27'
  and not exists (select 1 from vppsone.exam_activity x where x.assessment_id = a.id);
