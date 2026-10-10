# UI inventory — design handoff vs. the app on 10 October 2026

Source: `docs/design-handoff/SCREENS.md` (every module) against the routes,
modules and tables in this repo. "Exists" means the feature works today in the
old UI; "partial" means some of the data or flow exists; "missing" means the
feature has no table or screen yet. Target routes follow SCREENS.md, keeping an
existing URL where the feature already lives.

Old screens are **kept** after a module is rebuilt: they hold proven business
logic and stay reachable from Settings → Classic screens until each one is
retired on purpose.

| Module (design file) | Status | Current route(s) | Target route | Data it uses / what is missing | Who |
|---|---|---|---|---|---|
| Admin Today (`App`, `Desktop`) | partial | `/dashboard` | `/` | fee day totals (`receipts`), attendance registers, absences, cover duties. Missing: approval inbox counts, "today at school" timeline | admin, office |
| Needs you | missing | — (corrections at `/teach/corrections`, cover at `/substitutions`) | `/inbox` | attendance corrections, cover gaps, waiver/refund requests. Missing: `approval_requests` | admin |
| Students | exists | `/students`, `/fees/students` | `/students` | `public.students`, `classes`, `v_student_financial_state` | admin, office |
| Student 360 | partial | `/fees/students/[id]`, `/teach/student/[id]` | `/students/[id]` | fees, attendance marks, marks, family (`family_group_id`), notes. Missing: one tabbed page | admin, office |
| Attendance board + mark | exists | `/teach`, `/teach/attendance`, `/teach/register` | `/attendance`, `/attendance/[class]` | `attendance_registers`, `attendance_marks` | admin, office |
| Payment Desk (`PayDesk`) | exists | `/fees/payments`, `/fees/payments/bulk` | `/payments`, `/payments/bulk` | `preview_workbook_payment_allocation`, `post_student_payment*`, `receipts`, `payments`. Keep the RPC contract | admin, accountant |
| Receipts & day close (`Fees`) | partial | `/fees/receipts`, `/fees/transactions` | `/receipts` | `receipts`, reversal RPCs. Missing: `day_closes` | admin, accountant |
| Dues & calls (`Dues`) | partial | `/fees/defaulters`, `/fees/dues`, `/fees/admin-tools/recovery` | `/dues` | `defaulter_contacts`, repayment plans, `v_student_financial_state`. Missing: promises view | admin, accountant |
| Fee reminders (`Reminders`) | exists | `/fees/reminders/*` | `/reminders` | `whatsapp_templates`, reminder runs | admin, accountant |
| Fee setup (`FeeSetup`) | exists | `/fees/fee-setup`, `/fees/setup`, `/fees/fee-structure` | `/fee-setup` | fee setup publish flow | admin (edit), accountant (view) |
| Reports (`Reports`) | exists | `/fees/reports`, `/fees/exports` | `/reports` | collection, defaulters, day book | admin, accountant |
| Accountant Today (`AccHome`) | missing | `/fees/dashboard` | `/accounts` | receipts today, promises, cheques | accountant |
| Cheques, UPI & refunds (`AccBooks`) | partial | `/fees/finance-controls` | `/accounts/books` | refund requests, receipts by mode. Missing: cheque register, deposit slips, UPI lines | accountant |
| Admissions | partial | `/fees/students/new`, `/enrolments` | `/admissions` | `students`. Missing: `enquiries` | admin |
| Promote & import (`StudentTools`) | exists | `/fees/admin-tools/promotion`, `/fees/imports` | `/student-tools` | promotion runs, import batches | admin |
| Staff & roles | partial | `/staff` | `/staff` | `staff_profiles`, `role_permissions`. Missing: editable matrix, login management | admin |
| Notes on children | partial | `/teach/student/[id]` (notes) | `/notes` | `notes`, `note_kinds`. Missing: tags, follow-up, status, replies, support plans | admin, academic |
| Exams & marks (`Exams`) | exists | `/assessments/*` | `/exams` | `assessments`, `assessment_subjects`, `marks`, `report_card_issues`, Sampark tokens | admin, exam, academic |
| Timetable & substitutions | exists | `/timetable`, `/substitutions` | `/timetable` | `timetable_slots`, cover tables | admin, academic |
| Calendar | exists | `/calendar` | `/calendar` | `academic_calendar_days`. Missing: events with types and notices | everyone |
| Messages | partial | `/collection/messages` | `/messages` | `message_sends`, `message_templates` | admin, exam |
| Settings | partial | `/preferences`, `/fees/settings`, `/archives`, `/jobs` | `/settings` | profile, archives, jobs, activity. Missing: one hub | admin |
| Sign-in & states (`Auth`) | exists | `/login`, `/access-denied` | `/login` + app states | Supabase auth | everyone |
| Teacher Today (`TchHome`) | partial | `/teach` | `/teach` | registers, cover duties, notices | teacher |
| Teacher attendance (`TchAttend`) | exists | `/teach/attendance` | `/teach/attendance` | registers, revisions, corrections | teacher |
| Teacher class (`TchClass`) | partial | `/teach/class/[id]`, `/teach/student/[id]` | `/teach/class` | roster, marks, attendance | teacher |
| Teacher notes (`TchNotes`) | partial | — | `/teach/notes` | `notes` (extended) | teacher |
| Teacher marks (`TchMarks`) | exists | `/assessments/marks/[paperId]` | `/teach/marks` | `marks`, `marks_commands` | teacher |
| Teacher more (`TchMore`) | partial | `/more`, `/preferences` | `/teach/more` | notices, Sampark links, timetable, leave | teacher |
| Academic Today (`AcadHome`) | missing | `/dashboard` | `/academics` | registers, marks progress, notes | academic |
| Student progress (`AcadProgress`) | missing | — | `/academics/progress` | marks, attendance. Missing: needs-attention view | academic |
| Academic attendance (`AcadAttendance`) | partial | `/teach/register`, `/teach/corrections` | `/academics/attendance` | registers, corrections | academic |
| Exam Today (`ExamHome`) | missing | — | `/exam-office` | assessments, marks progress | exam |
| Exam plan (`ExamPlan`) | missing | — | `/exam-office/plan` | Missing: date sheet, rooms, seating, duties, papers | exam |
| Exam results (`ExamResults`) | partial | `/assessments/[id]` (lock), report cards | `/exam-office/results` | marks, locks, report cards. Missing: grace rules, re-checks | exam |

## Roles

The app has eight roles (`vppsone.staff_role`); the design draws five menus.

| App role | Design menu |
|---|---|
| admin, office, view_only | admin (items filtered by permission) |
| accountant, fee_collector | accountant |
| academic_coordinator | academic |
| exam_coordinator | exam |
| teacher | teacher |

## Database

Supabase project checked before every migration: `wtgxcptmucjerhufzjcf`
(schoolfees-dev). New tables go in the `vppsone` schema only (CLAUDE.md rule 1).
