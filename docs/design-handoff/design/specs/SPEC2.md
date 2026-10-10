# VPPS One — role apps addendum (read SPEC.md first, then this)

Everything in `SPEC.md` still applies: format, build/check loop, 80 KB cap, template rules, tokens,
motion, school world, domain rules. This file adds the **role apps**: Teacher, Accountant,
Academic coordinator, Exam coordinator, plus the shared **Notes on children** feature.
Scratchpad root: `/tmp/claude-0/-home-claude/169079ca-89ec-5c96-a646-4a555733067e/scratchpad`

Good references to read before you start (pick the ones close to your brief):
`src/Fees.dc.html` (reference patterns), `src/Dues.dc.html`, `src/Exams.dc.html`, `src/Teacher.dc.html`
(an OLD, simpler teacher view — your work replaces it; reuse ideas, not its chrome),
`src/XSide.dc.html` and `src/XNav.dc.html` (role-aware chrome — read them to see every role's menu).

## 1. Role chrome — always use XSide / XNav with `role`
```
<div class="only-d" style="flex: none; height: 100%"><dc-import name="XSide" active="<key>" role="teacher" dark="{{dark}}" hint-size="248px,100vh"></dc-import></div>
…
<div class="only-m" style="flex: none"><dc-import name="XNav" active="<key>" role="teacher" dark="{{dark}}" hint-size="100%,76px"></dc-import></div>
```
| role | XSide `active` keys | XNav `active` keys | phone "back to menu" link |
|---|---|---|---|
| teacher | home, attendance, class, marks, notes, more | home, class, notes, more (use `none` on TchAttend/TchMarks) | `M-TchMore.dc.html` |
| accountant | home, collect, fees, dues, reminders, books, reports, feesetup | home, fees, dues, menu (`none` on AccCollect) | `M-AccHome-Menu.dc.html` |
| academic | home, progress, attendance, notes, exams, timetable, calendar | home, progress, notes, menu (`none` on AcadAttendance) | `M-AcadHome-Menu.dc.html` |
| exam | home, plan, exams, results, calendar, messages | home, plan, results, menu | `M-ExamHome-Menu.dc.html` |
Exception: the **Notes** module is used by admin AND academic coordinator: give it a `role` prop
(enum admin/academic, default admin), pass `role="{{role}}"` to XSide/XNav, and compute the phone
back link from it (admin → `F13-Menu.dc.html`, academic → `M-AcadHome-Menu.dc.html`).
Desktop sidebar links go to DESKTOP files, the phone bar goes to PHONE files (M-…). Inside your
module, when a link must go to another module, render two anchors: `class="only-d"` → desktop file,
`class="only-m"` → phone file.

## 2. Every file in the role apps (module → required frames). Link only to files listed here or in SPEC.md §8.
Module files (desktop frame = the module itself):
`TchHome, TchAttend, TchClass, TchNotes, TchMarks, TchMore, AccHome, AccCollect, AccBooks, Notes, AcadHome, AcadProgress, AcadAttendance, ExamHome, ExamPlan, ExamResults` (all `.dc.html`).
Frames each owner MUST include in its boards.json (other modules link to them):
* TchHome → `M-TchHome` (start home)
* TchAttend → `M-TchAttend` (start mark)
* TchClass → `M-TchClass` (default start)
* TchNotes → `M-TchNotes` (default), `M-TchNotes-Add` + `DX-TchNotes-Add` (start add)
* TchMarks → `M-TchMarks` (default)
* TchMore → `M-TchMore` (start menu), `M-TchMore-Links` + `DX-TchMore-Links` (start links), `M-TchMore-News` + `DX-TchMore-News` (start news)
* AccHome → `M-AccHome` (start home), `M-AccHome-Menu` (start menu)
* AccCollect → `M-AccCollect` (default)
* AccBooks → `M-AccBooks` (default)
* Notes → `M-Notes` (default), `M-Notes-Add` (start add), `DX-Notes-Student` (start student)
* AcadHome → `M-AcadHome` (start home), `M-AcadHome-Menu` (start menu)
* AcadProgress → `M-AcadProgress` (default), `M-AcadProgress-Student` + `DX-AcadProgress-Student` (start student)
* AcadAttendance → `M-AcadAttendance` (default)
* ExamHome → `M-ExamHome` (start home), `M-ExamHome-Menu` (start menu)
* ExamPlan → `M-ExamPlan` (default)
* ExamResults → `M-ExamResults` (default)
Role versions of existing admin modules (already exist, same screens with the role's chrome):
accountant `AC-Fees, AC-Dues, AC-Reminders, AC-Reports, AC-FeeSetup` (desktop) and
`MAC-Fees, MAC-Dues, MAC-Reminders, MAC-Reports, MAC-FeeSetup` (phone);
academic `AD-Notes, AD-Exams, AD-Timetable, AD-Calendar` / `MAD-Notes, MAD-Exams, MAD-Timetable, MAD-Calendar`;
exam `EX-Exams, EX-Calendar, EX-Messages` / `MEX-Exams, MEX-Calendar, MEX-Messages`.
Also fine: `M-Auth.dc.html` (sign out on phone), `Auth.dc.html`.
The checker flags links to role files that other agents are still building — that is expected;
anything else must be clean. Boards.json: 3–5 desktop + 4–6 phone frames, including the required ones.

## 3. Design for non-technical people (most important for teachers; apply the spirit everywhere)
* Phone first. Base text 16px on phone; main buttons ≥ 52px tall, full width, in the thumb zone
  (sticky bottom bar). One main job per screen. Desktop = the same flow, roomier, two columns.
* Always icon + word. Key labels in English with Hindi under them (e.g. "Attendance" / "हाज़िरी");
  a small `EN | हि` switch in the top bar flips the main labels to Hindi (state in the module).
* Say what happens in plain words before it happens; after it happens show a big drawn tick and
  one friendly sentence ("Saved. The office can see it now."). Undo for anything that changes data.
* Show progress in words + bar ("12 of 27 done"). Never show codes, IDs or jargon. Never show money
  to teachers.
* Fixed colour meaning: Present green (`--ok`), Absent red (`--bad`), Leave amber (`--warn`),
  Not marked / not started grey (`--mut`).
* Nothing is lost: forms auto-save as drafts ("Saved as draft · 2 sec ago").
* Help is one tap away: a "?" in the top bar opens a sheet with 3 picture-steps for that screen.
* Big, friendly empty states with one button.

## 4. Smart defaults (brainstormed — implement the ones that belong to your screens)
* Attendance: the list opens with **everyone Present**. Tap a child once → Absent, again → Leave,
  again → Present. "Same as yesterday" chip pre-marks yesterday's absentees in one tap. Children
  absent 3+ days in a row get a soft "Call parents?" hint. NEW RULE (replaces SPEC §7 wording):
  until the teacher presses **Save attendance**, the class still counts as **Not marked** for the
  office and is never counted as present.
* Marks: the cursor jumps to the next child after 2 digits (or Enter); big number pad on phone;
  "Absent" is one tap; last exam's mark shown faintly beside each box; marks above max gently
  refused; auto-save; "Fill the same mark for all" only for practical/project columns.
* Notes: speak instead of type; ready-made phrases; tags; "needs follow-up" defaults to next Monday.
* Report-card remarks: suggested sentences built from marks + attendance + notes; pick, tweak, or
  "use for all similar children".
* Leave: "Today · full day" pre-selected; reason chips (Unwell, Family function, Personal work).
* Fee collection: the family's pending installments are pre-ticked; amount pre-filled; mode
  pre-set to the family's last mode; cash → "Given ₹ / Change ₹" calculator; WhatsApp receipt ON by
  default; brothers and sisters collected in one go; cheque bank remembered from last time.
* Day close: expected cash pre-filled; notes counted with steppers.
* Coordinators: the "needs attention" list builds itself (attendance below 75%, any subject below
  33%, 2+ open notes, marks dropped 15%+). "Remind all late teachers" is one tap.
* Exams: copy last exam's date sheet; seating auto-filled by roll numbers; invigilation duties
  shared fairly by the app; clash warnings; report cards generate themselves when marks are locked.

## 5. Notes on children (shared feature — same look in TchNotes, TchClass, Notes, AcadProgress)
A note = child, written by (teacher + their relation: class teacher / Science teacher…), date,
text, tags (Studies, Behaviour, Health, Family, Talent, Attendance — each with icon + colour),
"Just noting" or "Needs follow-up" (date + who: Me / Class teacher / Coordinator / Admin), status
(Open → Working on it → Done), who can see (Teachers & office — default / Only me), optional
"Tell parents" (Hindi-first WhatsApp preview, count + cost), replies thread, and an optional
**Support plan** (3–5 checklist steps with owner + date, e.g. "Extra practice sheets twice a week").
A subject teacher's note automatically reaches the class teacher (say so under the Save button).
**Voice note widget** (simulate — never call real speech APIs; Node runs the checker):
1. Big round mic button (64px, `var(--pri)`) labelled "Tap and speak · बोलकर लिखें".
2. Listening: 2 ripple rings (`animation: xRipple 1.6s ease-out infinite`, second delayed .8s),
   7 bars (`xWave .9s ease-in-out infinite`, staggered delays, `transform-origin: center`), a timer,
   language chips हिंदी / English, and the live transcript appearing word by word (setTimeout
   ~220ms per word from a canned sentence) with a blinking caret (`xCaret 1s steps(1) infinite`).
   Buttons: big "Done" and "Cancel".
3. Then the text is editable, with "Speak again" / "Add more", quick-phrase chips, tag chips,
   follow-up toggle, visibility segmented control, Save → the new note card rises into the
   timeline (xRise) + toast with Undo. Footnote: "In the app this uses the phone's own voice typing."
Sample notes (fictional; reuse): Riya Singh (Class 6) · Studies · "Finds fractions hard; started
practice sheets" · follow-up Mon 12 Oct · Ms. Bhati. Om Regar (Class 6) · Attendance/Family ·
"Absent 3 days, father says grandmother is unwell — call again Friday" · Working on it. Kabir
Solanki (Class 6) · Talent · "Excellent at drawing — suggest for district art competition".
Aarav Sharma (Class 7) · Studies · by Ms. Bhati (Science teacher) · "Not submitting lab notebook"
→ reached class teacher Mr. Choudhary · Open. Pari Sen (Class 6) · Behaviour · "Quiet lately, sits
alone at lunch — will talk to her" · Only me. Khushi Sharma (Class 6) · Health · "Headache after
morning assembly twice; parents informed" · Done.

## 6. People and data for the role apps (fictional)
* **Teacher: Ms. Kavita Bhati** — class teacher of **Class 6** (31 students) and Science teacher
  for Classes 6, 7 (27) and 8 (28). 30 periods a week. Today Thu 8 Oct: P1 Class 6 Science (done),
  P2 Class 8 Science (done), P3 Class 7 Science (now, 9:30–10:10), P4 free, P5 Class 9 Physics
  (substitution — Mr. Meena on leave), P6 Class 6 Science (lab), P7–P8 free.
  Class 6 roster (roll · name): 1 Aadhya Jain, 2 Aarav Kumawat, 3 Ananya Vyas, 4 Arjun Gurjar,
  5 Bhavya Paliwal, 6 Chirag Mehta, 7 Divya Rathore, 8 Gaurav Choudhary, 9 Harshita Dave,
  10 Ishaan Purohit, 11 Jiya Kothari (birthday today), 12 Kabir Solanki, 13 Khushi Sharma,
  14 Om Regar (absent 3 days, 68%), 15 Manav Joshi, 16 Naina Chouhan, 17 Nikhil Meena (72%),
  18 Palak Agarwal, 19 Pari Sen, 20 Pranav Rawal, 21 Riya Singh, 22 Rohan Sharma, 23 Saanvi
  Kumawat, 24 Sahil Gurjar, 25 Sneha Vyas, 26 Tanish Jain, 27 Tanya Paliwal, 28 Utkarsh Mehta,
  29 Vani Rathore, 30 Yash Dave, 31 Zoya Khan. Yesterday absent: Om Regar, Pari Sen.
  Half-yearly Science (max 80) entry: Class 6 done 31/31, Class 7 12/27 (in progress), Class 8
  0/28. Deadline Wed 14 Oct.
  **Sampark links** (her marks links, shown as big cards everywhere relevant): one per
  class-subject for Half-yearly, status + count, buttons Open · Share on WhatsApp · Copy, valid
  till 15 Oct. Label: "Your marks links (Sampark)".
  **Announcements from the admin** (Janmejay Singh): "PTM for Classes 9–10 on Sat 17 Oct, 10 am"
  (today, pinned, needs "Got it"); "Enter Half-yearly marks by Wed 14 Oct" (yesterday);
  "Dussehra holiday on Tue 20 Oct" (Mon); "Staff meeting Fri 9 Oct, 3:30 pm, library" (Mon).
  Each has a "Got it" button that turns into "Seen ✓" (the admin sees who has seen it).
* **Accountant: Ms. Neelam Sharma.** Collects fees at the office counter with "Office desk".
  Can collect, print, send receipts, log calls, request reversals/waivers/refunds (admin approves
  in Needs you), close the day. Cannot change fee setup (view only, "Ask admin to change").
* **Academic coordinator: Ms. Asha Purohit.** Watches marks, progress and attendance across
  classes, follows up on notes and support plans, reminds teachers.
* **Exam coordinator: Mr. Hemant Trivedi.** Plans exams (date sheet, seating, invigilation duties,
  question papers), tracks marks entry, runs results (moderation, grace, lock, rank, report cards,
  publish, re-check requests). Next exam: **Unit Test 2, Mon 7 – Sat 12 Dec**. Half-yearly results
  day: **Sat 17 Oct** (PTM); marks deadline Wed 14 Oct; entry 68% done; 7 teachers late.
* Rooms: Rooms 1–14 (35 seats each) + Hall (120 seats). Exams seat two classes per room in
  alternate columns.

## 7. Reply
Same as SPEC §10 (under 250 words): modules, start states, one line per screen, smart defaults you
implemented, icons added inline, anything you could not do.
