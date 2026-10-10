# DATA-MODEL — what each screen needs, and the proposed additive tables

**First, check what already exists.** VPPS One already has the fee model ported from the fee app, for example:
- core data: `students`, `classes`, `transport_routes`, `installments`, `receipts`, `payments`;
- adjustments: `payment_adjustments`, `receipt_adjustments`, `refund_requests`;
- discount policies: `conventional_discount_policies` and their assignments;
- follow-ups: `defaulter_contacts`, `whatsapp_templates`, `student_collection_flags`, repayment/EMI plans;
- views: `v_student_financial_state`, `v_workbook_*`;
- RPCs: `preview_workbook_payment_allocation`, `post_student_payment*`;
- staff and permissions.

Reuse these. Add only what is missing, as **additive, idempotent migrations** on schoolfees-dev. Names below are proposals; align them with the repo's naming conventions. Every table gets RLS. Financial and audit tables are insert-only (no UPDATE or DELETE grants).

## Shared / platform
- `staff` (exists?), `roles`, `role_permissions` (role × permission key), `staff_roles` (many-to-many), `staff_class_assignments` (class teacher of X; subject teacher of X·subject). These drive the nav, the guards and RLS.
- `activity_log` (actor, entity, entity_id, action, before jsonb, after jsonb, at). Insert-only.
- `approval_requests` (type: waiver / reversal / refund / attendance_correction / write_off / access…, payload jsonb, status, requested_by, decided_by, decided_at). Feeds **Needs you**.
- `announcements` (title, body, audience, pinned, attachments, created_by) and `announcement_acks` (announcement_id, staff_id, seen_at).
- `message_campaigns`, `message_recipients` (status: queued / sent / delivered / read / failed), `wa_templates` (AiSensy name, status, language, body), `parent_replies`. One server module sends via AiSensy.
- `app_settings` (preferences, receipt footer, late-fee display, attendance statuses list, …).

## Money (Payment Desk, Receipts, Dues, Reminders, Books, Fee setup)
- **Payment Desk:** reuse the fee app's preview/post RPCs. Make sure posting accepts payment date, mode, reference, cheque fields, notes and received_by, and is idempotent (client request id). Add:
  - a `payment_removals` reversal path (admin, within 10 minutes);
  - a view for the duplicate guard (same student + amount + mode in the last 10 minutes);
  - `bulk_payment_batches` / `bulk_payment_rows` (validate, then post each row through the same RPC).
- **Day close:** `day_closes` (date, expected by mode, counted denominations jsonb, upi_checked, note, closed_by, reopened_by).
- **Books:** `cheques` (receipt_id, no, bank, date, status received / deposited / cleared / bounced, deposit_slip_id), `deposit_slips`, `upi_statement_lines` + `upi_matches`, and `advances` (credit held per student).
- **Dues:** reuse `defaulter_contacts` (call log), plus `promises` (date, amount, status kept / broken) and the EMI plan table. Add a `v_dues_families` view (pending today, days overdue, late fee apart, last contact).
- **Reminders:** `reminder_rules` (timing, audience, template, quiet hours), `reminder_runs`, linked to `message_campaigns`.
- **Fee setup:** reuse the fee app's publish flow; `fee_setup_versions` for the history screen.

## People
- **Admissions:** `enquiries` (stage: enquiry / visited / form / admitted), `student_documents` (type, received), and withdraw/TC fields on students (`left_on`, `left_reason`, `tc_no`).
- **Student tools:** `promotion_runs` + `promotion_rows`, `import_batches` / `import_rows` (exist in the fee app — reuse), `data_quality_issues` (a view is fine), families (exist).
- **Staff:** logins via Supabase Auth admin API (server only), plus a `staff_logins` view.

## Teaching and academics
- **Attendance:**
  - `attendance_days` (class_id, date, state: not_marked / saved, saved_by, saved_at, edit_until);
  - `attendance_marks` (day_id, student_id, status P / A / H [+ L if enabled]);
  - `attendance_change_requests` (→ approval_requests).
  The office board reads `attendance_days` (realtime). The 10 am parent alert is a queued `message_campaign`.
- **Notes on children:**
  - `student_notes` (student_id, author_id, author_relation, text, source voice / typed, tags text[], kind noting / follow_up, follow_up_on, follow_up_owner, status open / working / done, visibility team / private, tell_parents);
  - `student_note_replies`;
  - `support_plans` (student_id, created_by, status) + `support_plan_steps` (text, owner, due, done_at).
  RLS: class teacher and subject teachers of the student, coordinators and admin; private notes only for their author.
- **Timetable:** `periods`, `timetable_slots` (class, day, period, subject, teacher, room), `teacher_leave` (→ approval_requests), `substitutions` (date, period, absent teacher, cover teacher, notified_at). The data comes from the timetable2025 app's `scripts/data.js`; import it once.
- **Calendar:** `calendar_events` (type holiday / exam / event / PTM / meeting, dates, classes, notify).
- **Exams and marks:**
  - `exams` (name, type, dates, status) and `exam_subjects` (exam, class, subject, max_marks, pass_marks);
  - `marks` (exam_subject, student, marks, absent, entered_by, source app / sampark, updated_at);
  - `marks_locks`, `sampark_links` (teacher, exam_subject(s), token, expires_at, last_opened_at, status);
  - `report_cards` (exam, student, pdf_path, generated_at, sent_at), `grace_rules` + `grace_applications`, `recheck_requests`;
  - exam planning: `date_sheet_slots`, `exam_rooms`, `seat_assignments`, `invigilation_duties`, `question_papers` (status set → received → checked → printed → sealed).
- **Coordinator views:** `v_needs_attention` (attendance < 75%, any subject < 33%, a drop ≥ 15%, ≥ 2 open notes), `v_class_subject_averages`, `v_marks_entry_progress`.

## Seed data (fake, TEST session)
One `supabase/seed/vppsone_demo.sql` (or a TS seed script) that creates:
- 19 classes with fake students (about 430);
- fake staff for every role: Janmejay (admin), an accountant, about 20 teachers with class and subject assignments, an academic coordinator and an exam coordinator;
- fee rows with a mix of paid, partly paid and overdue;
- today's receipts, one week of attendance, Unit Test 1 and Half-yearly marks;
- notes, announcements, a timetable and events.

Use the names and numbers from the design files where possible, so the screens match the screenshots. Never use a real child's data.
