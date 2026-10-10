# RULES — the school's decisions (these win over any design detail)

## A. Data and safety
- VPPS One builds on **schoolfees-dev (`wtgxcptmucjerhufzjcf`)** with test data. The live fee database (`vgqyilgstjvgohrsiwkb`) and the `veerpatta/schoolfees` repo are never written to. Reading the fee app's local code as a reference is fine.
- All design data is made up. Seeds and tests use fake children and fake phone numbers only. Never paste real student data into code, tests or docs.
- Payments, receipts, adjustments, refunds and audit logs are **append-only**. Corrections are reversal or adjustment rows. A reversed receipt stays visible, marked "REVERSED".
- Every change to money, marks, attendance, roles or settings writes an activity-log row (who, what, when, before → after).
- Single school, single tenant. There is no parent login; parents only receive WhatsApp messages.

## B. Money (same as the live fee app)
- **Payment Desk is the only place money is posted**, one student at a time. Brothers and sisters are only quick links; there is no family pay-together.
- The accountant **types the amount the parent actually paid**; any amount is allowed. Nothing is pre-ticked. Helper chips only fill the amount box.
- The amount is split **oldest first**: old balance (carry-forward, which never gets a late fee) → Installment 1 → 2 → 3 → 4. Extra money flows into later installments ("paid ahead"). Beyond the whole year it becomes credit for the student.
- Entered with every payment:
  - payment date (today by default; can be back-dated, and the late fee is worked out for that date);
  - mode: cash / UPI / bank transfer / cheque;
  - optional reference (UTR / UPI ref), or cheque no. + bank + cheque date;
  - optional notes;
  - received by (filled in automatically).
- Saving is idempotent:
  - after a save, the form locks and shows a drawn tick;
  - a duplicate guard warns when the same student, amount and mode were saved in the last 10 minutes;
  - the admin may remove an accidental entry within 10 minutes, which writes a reversal.
- Receipt numbers are generated on the server in the fee app's format (e.g. `SVP20261008-0015`) and never reused. Each receipt freezes the "balance after" at the moment of posting.
- **Fees and late fees are always separate numbers.** "Pending today" (overdue fees), "Not due yet" (future installments) and "Late fee" are three numbers. "Can take today" = pending today + late fee, and is labelled that way. A family whose only debt is a late fee is not a defaulter.
- Late fee:
  - Use the rule actually stored in Fee Setup and implemented in the fee app. The policy shows a flat ₹1,000. The design shows it per overdue installment; if the fee app's code applies it once, follow the code and log it in DECISIONS.md.
  - Waiving needs the `payments:waive_late_fee` permission. A user without it sends a waiver request to the admin.
- Installment dates, amounts, classes, routes and discounts **always come from Fee Setup data**. Designs are illustrative. The live setup has 4 installments due on the 20th of April, July, October and January; classes Nursery, JKG, SKG, Class 1–10, 11/12 Arts/Commerce/Science; and the discounts RTE, Staff Child and 3rd Child.
- Students who left owing money stay in dues and recovery, marked "Left", and do not count in headcount.
- Fee Setup changes go through preview → publish. Rows that are paid, partly paid, adjusted or kept for review are never silently rewritten.

## C. Attendance
- Marked once a day per class, by the class teacher, in VPPS One.
- The teacher's list opens with **everyone Present**; the teacher taps only the exceptions. "Same as yesterday" pre-marks yesterday's absentees in one tap.
- Statuses, as decided by the school: **Present / Absent / Half-day**. The design's third state, "Leave", becomes **Half-day** unless Settings adds Leave as an extra status. Keep the list configurable.
- **Until the teacher presses Save, the office sees the class as "Not marked"**, and "Not marked" is never counted as present.
- The teacher may change attendance for 30 minutes after saving. After that, a correction request goes to the coordinator or admin for approval. It is traceable and never silent.
- A WhatsApp reminder goes to class teachers who haven't marked after Period 1. An optional absent alert goes to parents at 10 am, previewed and counted.
- The monthly register can be printed.
- Saving works offline: the save is queued and the "Waiting to sync" chip shows until the server confirms.

## D. Marks and exams
- Sampark links stay the main way subject teachers enter marks ("Your marks links"). In-app entry is also allowed. Both write to the same marks table.
- Teachers may change marks after submitting, without approval, until the exam coordinator **locks** the results. Every change is logged.
- The exam coordinator plans the exam (date sheet, seating, duties, papers), tracks marks entry and reminds late teachers, then runs results: moderation, the grace rule, lock, report-card PDFs, publish and re-check requests.
- Parents get report cards and progress reports on WhatsApp, sent by a person (human-sent), with a preview and the count and cost shown first.

## E. Notes on children
- Any class or subject teacher, the coordinators and the admin can write or **speak** a note about a child.
- Each note has tags (Studies, Behaviour, Health, Family, Talent, Attendance), a type (Just noting / Needs follow-up, with a date and an owner), a status (Open → Working on it → Done) and visibility (Teachers & office, or Only me). It can carry an optional message to the parents (preview first) and an optional support plan with steps.
- A subject teacher's note automatically reaches the class teacher. The coordinator and admin see the board.

## F. Roles and what each sees
- **Admin:** everything, plus "See the app as" each role.
- **Accountant:** Payment Desk, receipts and day close, dues and calls, reminders, cheques/UPI/refunds, reports, and Fee Setup (view only). Waivers, reversals and refunds go to the admin as requests.
- **Class teacher:** their own class in full (attendance, every subject's marks, notes, parents' contacts), but **no money ever**. **Subject teacher:** only their own class-subjects (marks, notes).
- **Academic coordinator:** marks, progress, attendance oversight and notes across classes; reminders to teachers.
- **Exam coordinator:** the exams office (plan, marks tracker, results, notices).
- Roles and permissions are configurable by the admin (Staff → Roles). The same matrix drives the nav, page guards and RLS.

## G. Design rules for non-technical users (teachers above all)
- Phone first:
  - base text 16 px on phone;
  - main buttons at least 52 px tall, full width, in the thumb zone;
  - one main job per screen.
- Always show icon + word. Key labels are English with Hindi underneath, plus an EN | हि switch.
- Say what will happen before it happens. Afterwards, show a drawn tick and one friendly sentence. Offer Undo where the rules allow.
- Show progress in words plus a bar ("12 of 27 done"). No codes, IDs or jargon.
- Colours keep one meaning everywhere: Present = green, Absent = red, Half-day/Leave = amber, Not marked = grey.
- Forms auto-save drafts. A "?" on every screen opens 3 picture steps.
- Motion: transform and opacity only, and respect reduced motion.

## H. Messaging
- WhatsApp goes through AiSensy approved templates, from shared server code inside each workflow; there is no separate messaging app.
- Hindi first, English below.
- Always show the recipient count and the approximate cost before sending.

## I. Branding
- Keep the name and branding VPPS One already uses (its login says "Veer Patta Public School"; receipts in the fee app say "Shri Veer Patta Senior Secondary School"). Ask nothing: keep what the repo and receipts use today, and note it in DECISIONS.md.
- Brand colours: primary #0B4F79, accent #0E717C, nav #082F49.
