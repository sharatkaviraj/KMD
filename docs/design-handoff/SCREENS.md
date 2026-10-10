# SCREENS — every module, route, state and frame

Each module below is ONE responsive design file (`design/src/<Module>.dc.html`, built copy in `design/project/`).
Wider than 900 px = sidebar layout; narrower = phone layout (top bar + bottom bar + bottom sheets).
`start` states are the screens/states the design can open at; every one is reachable by clicking from the first.
Screenshots: `screenshots/<page>/<frame>.webp` (desktop 1440×900, phone 390×844). Suggested routes are suggestions —
keep the repo's existing URLs where a feature already exists.

## Admin prototypes (the original phone + desktop admin app)

| Design | Start states | Frames |
|---|---|---|
| `App.dc.html` (phone 390 px) | today, students, student, student-fees, student-attendance, student-marks, student-family, student-info, collect, collect-done, inbox, actions, search, attendance, mark, menu | `App.dc.html`, `F01-Today.dc.html`, `F02-NeedsYou.dc.html`, `F03-QuickActions.dc.html`, `F04-Search.dc.html`, `F05-Students.dc.html`, `F06-Student360.dc.html`, `F07-Student360-Fees.dc.html`, `F08-Student360-Family.dc.html`, `F09-Collect.dc.html`, `F10-CollectDone.dc.html`, `F11-Attendance.dc.html`, `F12-MarkAttendance.dc.html`, `F13-Menu.dc.html`, `F14-TodayDark.dc.html` |
| `Desktop.dc.html` (desktop, fluid) | today, students, student, student-fees, inbox, attendance, collect, collect-done, palette, new | `D01-Students.dc.html`, `D02-Student360.dc.html`, `D03-NeedsYou.dc.html`, `D04-Attendance.dc.html`, `D05-Collect.dc.html`, `D06-Receipt.dc.html`, `D07-Search.dc.html`, `D08-TodayDark.dc.html`, `D09-Laptop.dc.html`, `D10-Tablet.dc.html`, `Desktop.dc.html` |

Admin routes to build from these: `/` (role home → Today), `/inbox` (Needs you), `/students`, `/students/[id]` (Student 360 tabs: overview · fees · attendance · marks · family · info · notes), `/attendance`, `/attendance/[class]` (mark), quick-actions sheet (+), search / command palette (Ctrl K), `/menu` (phone).
Note: in these prototypes "Collect fee" now opens the Payment Desk (frames F09/F10/D05/D06 show it).

## Money

### Receipts & day close — `Fees`

- **Route (suggested):** `/receipts` — Receipts list + receipt detail `/receipts/[no]` + `/receipts/close-day`.
- **Who uses it:** admin, accountant
- **What it covers:** Receipts list (by day, mode, staff) · receipt beside the list · bilingual receipt · send / print / PDF · reverse with reason + Undo · reversed stamp · close the day: count cash by note, UPI check, short/over note · day closed · empty filter state.
- **Start states (7):** `list`, `receipt`, `reverse`, `reversed`, `close`, `closed`, `empty`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Fees.dc.html` — desktop, default start → `screenshots/money/Fees.webp`
  - `DX-Fees-Receipt.dc.html` — desktop, start receipt → `screenshots/money/DX-Fees-Receipt.webp`
  - `DX-Fees-Close.dc.html` — desktop, start close → `screenshots/money/DX-Fees-Close.webp`
  - `M-Fees.dc.html` — phone, start list → `screenshots/money/M-Fees.webp`
  - `M-Fees-Receipt.dc.html` — phone, start receipt → `screenshots/money/M-Fees-Receipt.webp`
  - `M-Fees-Reverse.dc.html` — phone, start reverse → `screenshots/money/M-Fees-Reverse.webp`
  - `M-Fees-Close.dc.html` — phone, start close → `screenshots/money/M-Fees-Close.webp`

### Dues & calls — `Dues`

- **Route (suggested):** `/dues` — Call list, family panel, promises, aging, EMI plan, left owing.
- **Who uses it:** admin, accountant
- **What it covers:** Call list by family (pending today, late fee apart) · family panel with installments + contact history · log a call → promise date + amount · promises (today / broken / upcoming) · aging buckets + class heat table · EMI plan + saved · left owing · write-off request.
- **Start states (9):** `list`, `family`, `call`, `promises`, `aging`, `plan`, `plan-done`, `left`, `writeoff`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Dues.dc.html` — desktop, default start → `screenshots/money/Dues.webp`
  - `DX-Dues-Family.dc.html` — desktop, start family → `screenshots/money/DX-Dues-Family.webp`
  - `DX-Dues-Plan.dc.html` — desktop, start plan → `screenshots/money/DX-Dues-Plan.webp`
  - `DX-Dues-Aging.dc.html` — desktop, start aging, dark → `screenshots/money/DX-Dues-Aging.webp`
  - `M-Dues.dc.html` — phone, start list → `screenshots/money/M-Dues.webp`
  - `M-Dues-Family.dc.html` — phone, start family → `screenshots/money/M-Dues-Family.webp`
  - `M-Dues-Call.dc.html` — phone, start call → `screenshots/money/M-Dues-Call.webp`
  - `M-Dues-Promises.dc.html` — phone, start promises → `screenshots/money/M-Dues-Promises.webp`
  - `M-Dues-Writeoff.dc.html` — phone, start writeoff → `screenshots/money/M-Dues-Writeoff.webp`

### Fee reminders on WhatsApp — `Reminders`

- **Route (suggested):** `/reminders` — WhatsApp fee reminders (AiSensy).
- **Who uses it:** admin, accountant
- **What it covers:** Campaigns + automatic rules · 3-step new reminder: who (live count + cost) → message (Hindi-first live preview) → check & send · sending ring · results funnel (sent → read → paid), fix numbers, remind unread · rule sheet · first-time screen.
- **Start states (8):** `list`, `audience`, `message`, `review`, `sending`, `results`, `rule`, `empty`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Reminders.dc.html` — desktop, default start → `screenshots/money/Reminders.webp`
  - `DX-Reminders-Message.dc.html` — desktop, start message → `screenshots/money/DX-Reminders-Message.webp`
  - `DX-Reminders-Results.dc.html` — desktop, start results → `screenshots/money/DX-Reminders-Results.webp`
  - `DX-Reminders-Sending.dc.html` — desktop, start sending → `screenshots/money/DX-Reminders-Sending.webp`
  - `M-Reminders.dc.html` — phone, start list → `screenshots/money/M-Reminders.webp`
  - `M-Reminders-Audience.dc.html` — phone, start audience → `screenshots/money/M-Reminders-Audience.webp`
  - `M-Reminders-Review.dc.html` — phone, start review → `screenshots/money/M-Reminders-Review.webp`
  - `M-Reminders-Rule.dc.html` — phone, start rule → `screenshots/money/M-Reminders-Rule.webp`
  - `M-Reminders-Empty.dc.html` — phone, start empty → `screenshots/money/M-Reminders-Empty.webp`

### Fee setup — `FeeSetup`

- **Route (suggested):** `/fee-setup` — Fee structure; publish flow.
- **Who uses it:** admin (edit), accountant (view)
- **What it covers:** Structure by class band · edit a class fee (impact line) · copy last year + % · installments split (must total 100%) · discounts & approvals · add a rule · late-fee rule + calculator (kept separate) · bus routes + stops · review & publish (diff, parent preview, Undo) · version history.
- **Start states (11):** `structure`, `edit`, `copy`, `installments`, `discounts`, `rule`, `latefee`, `transport`, `route`, `review`, `history`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `FeeSetup.dc.html` — desktop, default start → `screenshots/money/FeeSetup.webp`
  - `DX-FeeSetup-Edit.dc.html` — desktop, start edit → `screenshots/money/DX-FeeSetup-Edit.webp`
  - `DX-FeeSetup-Installments.dc.html` — desktop, start installments → `screenshots/money/DX-FeeSetup-Installments.webp`
  - `DX-FeeSetup-Review.dc.html` — desktop, start review → `screenshots/money/DX-FeeSetup-Review.webp`
  - `M-FeeSetup.dc.html` — phone, start structure → `screenshots/money/M-FeeSetup.webp`
  - `M-FeeSetup-Edit.dc.html` — phone, start edit → `screenshots/money/M-FeeSetup-Edit.webp`
  - `M-FeeSetup-LateFee.dc.html` — phone, start latefee → `screenshots/money/M-FeeSetup-LateFee.webp`
  - `M-FeeSetup-Route.dc.html` — phone, start route → `screenshots/money/M-FeeSetup-Route.webp`
  - `M-FeeSetup-Discounts.dc.html` — phone, start discounts, dark → `screenshots/money/M-FeeSetup-Discounts.webp`

### Reports — `Reports`

- **Route (suggested):** `/reports` — Hub + `/reports/[slug]`.
- **Who uses it:** admin, accountant, coordinators (academic reports)
- **What it covers:** Report hub with search + pins · daily collection (bar chart, filters, table) · defaulter list in हिंदी / English (printable) · send to class teachers · pending by class heat table → students · day book · export sheet · scheduled sends + new schedule.
- **Start states (10):** `hub`, `collection`, `defaulters`, `send`, `classwise`, `cell`, `daybook`, `export`, `schedule`, `newsch`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Reports.dc.html` — desktop, default start → `screenshots/money/Reports.webp`
  - `DX-Reports-Collection.dc.html` — desktop, start collection → `screenshots/money/DX-Reports-Collection.webp`
  - `DX-Reports-Defaulters.dc.html` — desktop, start defaulters → `screenshots/money/DX-Reports-Defaulters.webp`
  - `DX-Reports-Cell.dc.html` — desktop, start cell → `screenshots/money/DX-Reports-Cell.webp`
  - `M-Reports.dc.html` — phone, start hub → `screenshots/money/M-Reports.webp`
  - `M-Reports-Collection.dc.html` — phone, start collection → `screenshots/money/M-Reports-Collection.webp`
  - `M-Reports-Send.dc.html` — phone, start send → `screenshots/money/M-Reports-Send.webp`
  - `M-Reports-Export.dc.html` — phone, start export → `screenshots/money/M-Reports-Export.webp`
  - `M-Reports-Schedule.dc.html` — phone, start schedule, dark → `screenshots/money/M-Reports-Schedule.webp`

## People

### Admissions — `Admissions`

- **Route (suggested):** `/admissions` — Pipeline + `/admissions/new` wizard + edit/withdraw from Student 360.
- **Who uses it:** admin
- **What it covers:** Enquiry → visited → form → admitted board · 4-step add student (student, family + sibling link, fees, review) · admitted (collect fee, welcome message) · duplicate warning · link sibling · edit student with history · withdraw + TC (dues move to Left owing).
- **Start states (10):** `list`, `step1`, `step2`, `step3`, `step4`, `done`, `duplicate`, `sibling`, `edit`, `withdraw`
- **Props:** `dark`
- **Frames / screenshots:**
  - `Admissions.dc.html` — desktop, default start → `screenshots/people/Admissions.webp`
  - `DX-Admissions-Fees.dc.html` — desktop, start step3 → `screenshots/people/DX-Admissions-Fees.webp`
  - `DX-Admissions-Duplicate.dc.html` — desktop, start duplicate → `screenshots/people/DX-Admissions-Duplicate.webp`
  - `DX-Admissions-Withdraw.dc.html` — desktop, start withdraw → `screenshots/people/DX-Admissions-Withdraw.webp`
  - `M-Admissions.dc.html` — phone, start list → `screenshots/people/M-Admissions.webp`
  - `M-Admissions-Student.dc.html` — phone, start step1 → `screenshots/people/M-Admissions-Student.webp`
  - `M-Admissions-Sibling.dc.html` — phone, start sibling → `screenshots/people/M-Admissions-Sibling.webp`
  - `M-Admissions-Done.dc.html` — phone, start done → `screenshots/people/M-Admissions-Done.webp`
  - `M-Admissions-Edit.dc.html` — phone, start edit → `screenshots/people/M-Admissions-Edit.webp`
  - `DX-Admissions-Add.dc.html` — desktop, start step1 → `screenshots/people/DX-Admissions-Add.webp`

### Promote, import & data quality — `StudentTools`

- **Route (suggested):** `/student-tools` — Promote, Excel import, data quality, families.
- **Who uses it:** admin
- **What it covers:** Tools hub · year-end promotion (class mapping, hold back, stream choice) → review → done with Undo · Excel import: file → match columns → check rows → imported with Undo · data quality fixes row by row · families · merge two families.
- **Start states (11):** `hub`, `promote`, `promote-review`, `promoted`, `import`, `mapping`, `validate`, `imported`, `quality`, `families`, `merge`
- **Props:** `dark`
- **Frames / screenshots:**
  - `StudentTools.dc.html` — desktop, default start → `screenshots/people/StudentTools.webp`
  - `DX-StudentTools-Promote.dc.html` — desktop, start promote → `screenshots/people/DX-StudentTools-Promote.webp`
  - `DX-StudentTools-Validate.dc.html` — desktop, start validate → `screenshots/people/DX-StudentTools-Validate.webp`
  - `DX-StudentTools-Quality.dc.html` — desktop, start quality → `screenshots/people/DX-StudentTools-Quality.webp`
  - `M-StudentTools.dc.html` — phone, start hub → `screenshots/people/M-StudentTools.webp`
  - `M-StudentTools-Review.dc.html` — phone, start promote-review → `screenshots/people/M-StudentTools-Review.webp`
  - `M-StudentTools-Mapping.dc.html` — phone, start mapping → `screenshots/people/M-StudentTools-Mapping.webp`
  - `M-StudentTools-Families.dc.html` — phone, start families → `screenshots/people/M-StudentTools-Families.webp`
  - `M-StudentTools-Merge.dc.html` — phone, start merge → `screenshots/people/M-StudentTools-Merge.webp`

### Staff, roles & logins — `Staff`

- **Route (suggested):** `/staff` — Staff list, profile, roles × permissions, logins.
- **Who uses it:** admin
- **What it covers:** Staff list (role + login status) · profile beside the list · roles × permissions matrix (Admin locked, changes highlighted, Undo) · create a login → created · reset password · disable login.
- **Start states (8):** `list`, `profile`, `roles`, `changes`, `invite`, `created`, `reset`, `deactivate`
- **Props:** `dark`
- **Frames / screenshots:**
  - `Staff.dc.html` — desktop, default start → `screenshots/people/Staff.webp`
  - `DX-Staff-Profile.dc.html` — desktop, start profile → `screenshots/people/DX-Staff-Profile.webp`
  - `DX-Staff-Roles.dc.html` — desktop, start changes → `screenshots/people/DX-Staff-Roles.webp`
  - `DX-Staff-Disable.dc.html` — desktop, start deactivate → `screenshots/people/DX-Staff-Disable.webp`
  - `M-Staff.dc.html` — phone, start list → `screenshots/people/M-Staff.webp`
  - `M-Staff-Roles.dc.html` — phone, start changes → `screenshots/people/M-Staff-Roles.webp`
  - `M-Staff-Invite.dc.html` — phone, start invite → `screenshots/people/M-Staff-Invite.webp`
  - `M-Staff-Created.dc.html` — phone, start created → `screenshots/people/M-Staff-Created.webp`
  - `M-Staff-Reset.dc.html` — phone, start reset → `screenshots/people/M-Staff-Reset.webp`

### Notes on children (office & coordinator) — `Notes`

- **Route (suggested):** `/notes` — Board + `/students/[id]/notes`.
- **Who uses it:** admin, academic coordinator
- **What it covers:** Every note teachers wrote or spoke about a child, in one place · needs action / follow-ups / support plans · note beside the board with status (Open → Working on it → Done), assign, replies by voice · one child’s timeline (also opened from Student 360) · speak a note · support plan with parent message.
- **Start states (6):** `board`, `student`, `add`, `listening`, `detail`, `plan`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Notes.dc.html` — desktop, default start → `screenshots/people/Notes.webp`
  - `DX-Notes-Detail.dc.html` — desktop, start detail → `screenshots/people/DX-Notes-Detail.webp`
  - `DX-Notes-Student.dc.html` — desktop, start student → `screenshots/people/DX-Notes-Student.webp`
  - `DX-Notes-Plan.dc.html` — desktop, start plan → `screenshots/people/DX-Notes-Plan.webp`
  - `DX-Notes-Listening.dc.html` — desktop, start listening, dark → `screenshots/people/DX-Notes-Listening.webp`
  - `M-Notes.dc.html` — phone, default start → `screenshots/people/M-Notes.webp`
  - `M-Notes-Add.dc.html` — phone, start add → `screenshots/people/M-Notes-Add.webp`
  - `M-Notes-Listening.dc.html` — phone, start listening → `screenshots/people/M-Notes-Listening.webp`
  - `M-Notes-Detail.dc.html` — phone, start detail → `screenshots/people/M-Notes-Detail.webp`
  - `M-Notes-Plan.dc.html` — phone, start plan → `screenshots/people/M-Notes-Plan.webp`
  - `M-Notes-Student.dc.html` — phone, start student → `screenshots/people/M-Notes-Student.webp`

## Academics

### Exams, marks & report cards — `Exams`

- **Route (suggested):** `/exams` — Exams, marks tracker, Sampark links, marks entry, report cards, analysis.
- **Who uses it:** admin, exam coordinator, academic coordinator (results)
- **What it covers:** Session exams timeline · marks tracker grid (class × subject) · cell detail · Sampark links · admin marks entry (max check, AB, autosave) · report cards → bilingual preview · result analysis · create exam · remind late teachers.
- **Start states (10):** `list`, `grid`, `cell`, `sampark`, `entry`, `reportcards`, `preview`, `analysis`, `create`, `remind`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Exams.dc.html` — desktop, default start → `screenshots/academics/Exams.webp`
  - `DX-Exams-Cell.dc.html` — desktop, start cell → `screenshots/academics/DX-Exams-Cell.webp`
  - `DX-Exams-Entry.dc.html` — desktop, start entry → `screenshots/academics/DX-Exams-Entry.webp`
  - `DX-Exams-Preview.dc.html` — desktop, start preview → `screenshots/academics/DX-Exams-Preview.webp`
  - `M-Exams.dc.html` — phone, start list → `screenshots/academics/M-Exams.webp`
  - `M-Exams-Grid.dc.html` — phone, start grid → `screenshots/academics/M-Exams-Grid.webp`
  - `M-Exams-Remind.dc.html` — phone, start remind → `screenshots/academics/M-Exams-Remind.webp`
  - `M-Exams-Entry.dc.html` — phone, start entry → `screenshots/academics/M-Exams-Entry.webp`
  - `M-Exams-Sampark.dc.html` — phone, start sampark → `screenshots/academics/M-Exams-Sampark.webp`
  - `M-Exams-ReportCards.dc.html` — phone, start reportcards → `screenshots/academics/M-Exams-ReportCards.webp`

### Timetable & substitutions — `Timetable`

- **Route (suggested):** `/timetable` — Class/teacher week, substitutions, leave, edit + clash, publish.
- **Who uses it:** admin, academic coordinator
- **What it covers:** Class week grid with live period · teacher week + load · today’s substitutions (3 of 5 covered) · assign a substitute · teacher leave · edit a period · clash check · publish changes to teachers.
- **Start states (8):** `class`, `teacher`, `subs`, `assign`, `leave`, `edit`, `clash`, `publish`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Timetable.dc.html` — desktop, default start → `screenshots/academics/Timetable.webp`
  - `DX-Timetable-Subs.dc.html` — desktop, start subs → `screenshots/academics/DX-Timetable-Subs.webp`
  - `DX-Timetable-Clash.dc.html` — desktop, start clash → `screenshots/academics/DX-Timetable-Clash.webp`
  - `DX-Timetable-Teacher.dc.html` — desktop, start teacher → `screenshots/academics/DX-Timetable-Teacher.webp`
  - `M-Timetable.dc.html` — phone, start class → `screenshots/academics/M-Timetable.webp`
  - `M-Timetable-Subs.dc.html` — phone, start subs → `screenshots/academics/M-Timetable-Subs.webp`
  - `M-Timetable-Assign.dc.html` — phone, start assign → `screenshots/academics/M-Timetable-Assign.webp`
  - `M-Timetable-Leave.dc.html` — phone, start leave → `screenshots/academics/M-Timetable-Leave.webp`
  - `M-Timetable-Publish.dc.html` — phone, start publish, dark → `screenshots/academics/M-Timetable-Publish.webp`

### School calendar — `Calendar`

- **Route (suggested):** `/calendar` — Month, day, event, add, agenda, holidays.
- **Who uses it:** everyone (edit: admin, coordinators)
- **What it covers:** Month view with event bars (Sep–Nov) · day detail (attendance, leave, birthdays, fees) · event detail with read ring · add event + parent notice · agenda (next 30 days) · holidays & working days · holiday notice sheet.
- **Start states (7):** `month`, `day`, `event`, `add`, `agenda`, `holidays`, `notify`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Calendar.dc.html` — desktop, default start → `screenshots/academics/Calendar.webp`
  - `DX-Calendar-Event.dc.html` — desktop, start event → `screenshots/academics/DX-Calendar-Event.webp`
  - `DX-Calendar-Add.dc.html` — desktop, start add → `screenshots/academics/DX-Calendar-Add.webp`
  - `DX-Calendar-Holidays.dc.html` — desktop, start notify → `screenshots/academics/DX-Calendar-Holidays.webp`
  - `M-Calendar.dc.html` — phone, start month → `screenshots/academics/M-Calendar.webp`
  - `M-Calendar-Day.dc.html` — phone, start day → `screenshots/academics/M-Calendar-Day.webp`
  - `M-Calendar-Agenda.dc.html` — phone, start agenda → `screenshots/academics/M-Calendar-Agenda.webp`
  - `M-Calendar-Add.dc.html` — phone, start add → `screenshots/academics/M-Calendar-Add.webp`
  - `M-Calendar-Holidays.dc.html` — phone, start holidays → `screenshots/academics/M-Calendar-Holidays.webp`

## Messages & system

### Messages & notices — `Messages`

- **Route (suggested):** `/messages` — Notices, delivery, templates, parent replies.
- **Who uses it:** admin, exam coordinator
- **What it covers:** Sent log with read rates and cost · delivery detail (who read, resend failed) · compose notice with live WhatsApp preview · preview & confirm · sending → sent · AiSensy templates · new template · parent replies inbox.
- **Start states (9):** `list`, `detail`, `compose`, `preview`, `sending`, `sent`, `templates`, `template-new`, `replies`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `Messages.dc.html` — desktop, default start → `screenshots/system/Messages.webp`
  - `DX-Messages-Detail.dc.html` — desktop, start detail → `screenshots/system/DX-Messages-Detail.webp`
  - `DX-Messages-Compose.dc.html` — desktop, start compose → `screenshots/system/DX-Messages-Compose.webp`
  - `DX-Messages-Replies.dc.html` — desktop, start replies → `screenshots/system/DX-Messages-Replies.webp`
  - `M-Messages.dc.html` — phone, start list → `screenshots/system/M-Messages.webp`
  - `M-Messages-Compose.dc.html` — phone, start compose → `screenshots/system/M-Messages-Compose.webp`
  - `M-Messages-Preview.dc.html` — phone, start preview → `screenshots/system/M-Messages-Preview.webp`
  - `M-Messages-Sending.dc.html` — phone, start sending → `screenshots/system/M-Messages-Sending.webp`
  - `M-Messages-Templates.dc.html` — phone, start template-new → `screenshots/system/M-Messages-Templates.webp`

### Settings, backups & glossary — `Settings`

- **Route (suggested):** `/settings` — Profile, preferences, session, activity log, backups, master data, integrations, glossary.
- **Who uses it:** admin
- **What it covers:** Settings home · school profile + receipt preview · preferences (theme, large text live) · session & year · activity log (before → after) · backups (Drive + R2) · restore · archive · master data · integrations · glossary in English + Hindi.
- **Start states (11):** `home`, `school`, `prefs`, `session`, `activity`, `backups`, `restore`, `archive`, `master`, `integrations`, `glossary`
- **Props:** `dark`
- **Frames / screenshots:**
  - `Settings.dc.html` — desktop, default start → `screenshots/system/Settings.webp`
  - `DX-Settings-Activity.dc.html` — desktop, start activity → `screenshots/system/DX-Settings-Activity.webp`
  - `DX-Settings-Backups.dc.html` — desktop, start backups → `screenshots/system/DX-Settings-Backups.webp`
  - `DX-Settings-Master.dc.html` — desktop, start master → `screenshots/system/DX-Settings-Master.webp`
  - `M-Settings.dc.html` — phone, start home → `screenshots/system/M-Settings.webp`
  - `M-Settings-Prefs.dc.html` — phone, start prefs, dark → `screenshots/system/M-Settings-Prefs.webp`
  - `M-Settings-Restore.dc.html` — phone, start restore → `screenshots/system/M-Settings-Restore.webp`
  - `M-Settings-Integrations.dc.html` — phone, start integrations → `screenshots/system/M-Settings-Integrations.webp`
  - `M-Settings-Glossary.dc.html` — phone, start glossary → `screenshots/system/M-Settings-Glossary.webp`

### Sign-in & app states — `Auth`

- **Route (suggested):** `/login + app-wide states` — Sign-in, password, session/role picker, offline, 403, 404, loading, expired, update.
- **Who uses it:** everyone
- **What it covers:** Sign in · wrong password · signing in · forgot → ask admin · make your own password (strength meter) · pick session & role (teachers go to the teacher app) · offline (queued receipts) · no access · page not found · loading skeleton · signed out after 8 h · update ready.
- **Start states (12):** `signin`, `error`, `signing`, `forgot`, `password`, `session`, `offline`, `denied`, `notfound`, `loading`, `expired`, `update`
- **Props:** `dark`
- **Frames / screenshots:**
  - `Auth.dc.html` — desktop, default start → `screenshots/system/Auth.webp`
  - `DX-Auth-Offline.dc.html` — desktop, start offline → `screenshots/system/DX-Auth-Offline.webp`
  - `DX-Auth-Denied.dc.html` — desktop, start denied → `screenshots/system/DX-Auth-Denied.webp`
  - `DX-Auth-Expired.dc.html` — desktop, start expired → `screenshots/system/DX-Auth-Expired.webp`
  - `M-Auth.dc.html` — phone, start signin → `screenshots/system/M-Auth.webp`
  - `M-Auth-Error.dc.html` — phone, start error → `screenshots/system/M-Auth-Error.webp`
  - `M-Auth-Password.dc.html` — phone, start password → `screenshots/system/M-Auth-Password.webp`
  - `M-Auth-Session.dc.html` — phone, start session → `screenshots/system/M-Auth-Session.webp`
  - `M-Auth-Update.dc.html` — phone, start update → `screenshots/system/M-Auth-Update.webp`

## Teacher app

### Teacher · Today — `TchHome`

- **Route (suggested):** `/teach` — Teacher Today.
- **Who uses it:** teacher
- **What it covers:** Big “Mark attendance” card · the admin’s announcements with “Got it” · my periods with the live one · substitution: I’ll take it / I can’t · Sampark marks links with progress rings · children who need me today (absent 3 days, birthday wishes, follow-ups) · quick actions · leave sheet (today · full day pre-set) · help · “all set for today”.
- **Start states (8):** `home`, `news`, `subs`, `leave`, `help`, `later`, `link`, `wish`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchHome.dc.html` — desktop, default start → `screenshots/r-teacher/TchHome.webp`
  - `DX-TchHome-Later.dc.html` — desktop, start later → `screenshots/r-teacher/DX-TchHome-Later.webp`
  - `DX-TchHome-Subs.dc.html` — desktop, start subs → `screenshots/r-teacher/DX-TchHome-Subs.webp`
  - `DX-TchHome-News.dc.html` — desktop, start news → `screenshots/r-teacher/DX-TchHome-News.webp`
  - `M-TchHome.dc.html` — phone, start home → `screenshots/r-teacher/M-TchHome.webp`
  - `M-TchHome-Later.dc.html` — phone, start later → `screenshots/r-teacher/M-TchHome-Later.webp`
  - `M-TchHome-Subs.dc.html` — phone, start subs → `screenshots/r-teacher/M-TchHome-Subs.webp`
  - `M-TchHome-Leave.dc.html` — phone, start leave → `screenshots/r-teacher/M-TchHome-Leave.webp`
  - `M-TchHome-Link.dc.html` — phone, start link → `screenshots/r-teacher/M-TchHome-Link.webp`
  - `M-TchHome-Help.dc.html` — phone, start help → `screenshots/r-teacher/M-TchHome-Help.webp`

### Teacher · Attendance — `TchAttend`

- **Route (suggested):** `/teach/attendance` — All present by default; Not marked until Save.
- **Who uses it:** teacher (class teacher)
- **What it covers:** Everyone starts Present — tap only the absent children (tap again = leave) · “same as yesterday” one tap · 3-days-absent hint · save sheet with parent WhatsApp at 10 am · saved with a 30-minute change window · ask the office to change later · month history. Until Save, the office still sees “Not marked”.
- **Start states (7):** `mark`, `marked2`, `save`, `saved`, `change`, `history`, `help`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchAttend.dc.html` — desktop, default start → `screenshots/r-teacher/TchAttend.webp`
  - `DX-TchAttend-Save.dc.html` — desktop, start save → `screenshots/r-teacher/DX-TchAttend-Save.webp`
  - `DX-TchAttend-Saved.dc.html` — desktop, start saved → `screenshots/r-teacher/DX-TchAttend-Saved.webp`
  - `DX-TchAttend-History.dc.html` — desktop, start history → `screenshots/r-teacher/DX-TchAttend-History.webp`
  - `M-TchAttend.dc.html` — phone, start mark → `screenshots/r-teacher/M-TchAttend.webp`
  - `M-TchAttend-Marked2.dc.html` — phone, start marked2 → `screenshots/r-teacher/M-TchAttend-Marked2.webp`
  - `M-TchAttend-Save.dc.html` — phone, start save → `screenshots/r-teacher/M-TchAttend-Save.webp`
  - `M-TchAttend-Saved.dc.html` — phone, start saved → `screenshots/r-teacher/M-TchAttend-Saved.webp`
  - `M-TchAttend-Change.dc.html` — phone, start change → `screenshots/r-teacher/M-TchAttend-Change.webp`
  - `M-TchAttend-History.dc.html` — phone, start history → `screenshots/r-teacher/M-TchAttend-History.webp`

### Teacher · My class & subjects — `TchClass`

- **Route (suggested):** `/teach/class` — My class (class teacher) and my subjects (subject teacher); child page without money.
- **Who uses it:** teacher
- **What it covers:** Class teacher sees the whole class: attendance, subject averages, children who need attention, timetable, birthdays · roster · a child’s page (parents to call, attendance, marks, notes — no fees) · my subjects across classes · one subject with syllabus tracker and a note for the class teacher.
- **Start states (5):** `class`, `roster`, `student`, `subjects`, `subject`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchClass.dc.html` — desktop, default start → `screenshots/r-teacher/TchClass.webp`
  - `DX-TchClass-Student.dc.html` — desktop, start student → `screenshots/r-teacher/DX-TchClass-Student.webp`
  - `DX-TchClass-Subject.dc.html` — desktop, start subject → `screenshots/r-teacher/DX-TchClass-Subject.webp`
  - `DX-TchClass-Roster.dc.html` — desktop, start roster → `screenshots/r-teacher/DX-TchClass-Roster.webp`
  - `M-TchClass.dc.html` — phone, start class → `screenshots/r-teacher/M-TchClass.webp`
  - `M-TchClass-Roster.dc.html` — phone, start roster → `screenshots/r-teacher/M-TchClass-Roster.webp`
  - `M-TchClass-Student.dc.html` — phone, start student → `screenshots/r-teacher/M-TchClass-Student.webp`
  - `M-TchClass-Subjects.dc.html` — phone, start subjects → `screenshots/r-teacher/M-TchClass-Subjects.webp`
  - `M-TchClass-Subject.dc.html` — phone, start subject → `screenshots/r-teacher/M-TchClass-Subject.webp`

### Teacher · Notes on children — `TchNotes`

- **Route (suggested):** `/teach/notes` — Notes on children with voice input.
- **Who uses it:** teacher
- **What it covers:** Speak or type a note about a child · listening screen with live words · tags, follow-up (next Monday by default), who can see it, tell parents · saved and shared with the class teacher / coordinator · note with status and replies · support plan steps.
- **Start states (7):** `list`, `add`, `listening`, `review`, `saved`, `detail`, `plan`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchNotes.dc.html` — desktop, default start → `screenshots/r-teacher/TchNotes.webp`
  - `DX-TchNotes-Add.dc.html` — desktop, start add → `screenshots/r-teacher/DX-TchNotes-Add.webp`
  - `DX-TchNotes-Listening.dc.html` — desktop, start listening → `screenshots/r-teacher/DX-TchNotes-Listening.webp`
  - `DX-TchNotes-Detail.dc.html` — desktop, start detail → `screenshots/r-teacher/DX-TchNotes-Detail.webp`
  - `DX-TchNotes-Plan.dc.html` — desktop, start plan → `screenshots/r-teacher/DX-TchNotes-Plan.webp`
  - `M-TchNotes.dc.html` — phone, start list → `screenshots/r-teacher/M-TchNotes.webp`
  - `M-TchNotes-Add.dc.html` — phone, start add → `screenshots/r-teacher/M-TchNotes-Add.webp`
  - `M-TchNotes-Listening.dc.html` — phone, start listening → `screenshots/r-teacher/M-TchNotes-Listening.webp`
  - `M-TchNotes-Review.dc.html` — phone, start review → `screenshots/r-teacher/M-TchNotes-Review.webp`
  - `M-TchNotes-Saved.dc.html` — phone, start saved → `screenshots/r-teacher/M-TchNotes-Saved.webp`
  - `M-TchNotes-Detail.dc.html` — phone, start detail → `screenshots/r-teacher/M-TchNotes-Detail.webp`

### Teacher · Marks — `TchMarks`

- **Route (suggested):** `/teach/marks` — Marks entry + report-card remarks.
- **Who uses it:** teacher
- **What it covers:** Pick what to fill · marks list that jumps to the next child, one-tap Absent, last test shown faintly, autosave · phone number pad · check before sending · sent to the exam coordinator with Undo · report-card remarks suggested from marks, attendance and notes.
- **Start states (6):** `pick`, `entry`, `keypad`, `check`, `submitted`, `remarks`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchMarks.dc.html` — desktop, default start → `screenshots/r-teacher/TchMarks.webp`
  - `DX-TchMarks-Entry.dc.html` — desktop, start entry → `screenshots/r-teacher/DX-TchMarks-Entry.webp`
  - `DX-TchMarks-Check.dc.html` — desktop, start check → `screenshots/r-teacher/DX-TchMarks-Check.webp`
  - `DX-TchMarks-Remarks.dc.html` — desktop, start remarks → `screenshots/r-teacher/DX-TchMarks-Remarks.webp`
  - `M-TchMarks.dc.html` — phone, start pick → `screenshots/r-teacher/M-TchMarks.webp`
  - `M-TchMarks-Keypad.dc.html` — phone, start keypad → `screenshots/r-teacher/M-TchMarks-Keypad.webp`
  - `M-TchMarks-Entry.dc.html` — phone, start entry → `screenshots/r-teacher/M-TchMarks-Entry.webp`
  - `M-TchMarks-Check.dc.html` — phone, start check → `screenshots/r-teacher/M-TchMarks-Check.webp`
  - `M-TchMarks-Submitted.dc.html` — phone, start submitted → `screenshots/r-teacher/M-TchMarks-Submitted.webp`
  - `M-TchMarks-Remarks.dc.html` — phone, start remarks → `screenshots/r-teacher/M-TchMarks-Remarks.webp`

### Teacher · Notices, links & more — `TchMore`

- **Route (suggested):** `/teach/more` — Notices, Sampark links, timetable, leave, help, profile.
- **Who uses it:** teacher
- **What it covers:** Phone “More” menu · the admin’s notices with “Got it” · your Sampark marks links (open, share, copy) · my timetable · apply leave · picture help · profile (Hindi, large text, dark mode, sign out).
- **Start states (7):** `menu`, `news`, `links`, `timetable`, `leave`, `help`, `profile`
- **Props:** `dark`
- **Frames / screenshots:**
  - `TchMore.dc.html` — desktop, default start → `screenshots/r-teacher/TchMore.webp`
  - `DX-TchMore-News.dc.html` — desktop, start news → `screenshots/r-teacher/DX-TchMore-News.webp`
  - `DX-TchMore-Links.dc.html` — desktop, start links → `screenshots/r-teacher/DX-TchMore-Links.webp`
  - `DX-TchMore-Timetable.dc.html` — desktop, start timetable → `screenshots/r-teacher/DX-TchMore-Timetable.webp`
  - `DX-TchMore-Profile.dc.html` — desktop, start profile → `screenshots/r-teacher/DX-TchMore-Profile.webp`
  - `M-TchMore.dc.html` — phone, start menu → `screenshots/r-teacher/M-TchMore.webp`
  - `M-TchMore-News.dc.html` — phone, start news → `screenshots/r-teacher/M-TchMore-News.webp`
  - `M-TchMore-Links.dc.html` — phone, start links → `screenshots/r-teacher/M-TchMore-Links.webp`
  - `M-TchMore-Timetable.dc.html` — phone, start timetable → `screenshots/r-teacher/M-TchMore-Timetable.webp`
  - `M-TchMore-Leave.dc.html` — phone, start leave → `screenshots/r-teacher/M-TchMore-Leave.webp`
  - `M-TchMore-Help.dc.html` — phone, start help → `screenshots/r-teacher/M-TchMore-Help.webp`

## Accountant app

### Accountant · Today — `AccHome`

- **Route (suggested):** `/accounts` — Accountant Today + phone menu.
- **Who uses it:** accountant
- **What it covers:** Find any family fast · collected today live · counter queue · promises due, cheques to deposit, UPI to match · waiting for admin · reminders at 4 pm · close the day · phone menu · evening summary.
- **Start states (3):** `home`, `menu`, `evening`
- **Props:** `dark`
- **Frames / screenshots:**
  - `AccHome.dc.html` — desktop, default start → `screenshots/r-accountant/AccHome.webp`
  - `DX-AccHome-Menu.dc.html` — desktop, start menu → `screenshots/r-accountant/DX-AccHome-Menu.webp`
  - `DX-AccHome-Evening.dc.html` — desktop, start evening → `screenshots/r-accountant/DX-AccHome-Evening.webp`
  - `DX-AccHome-Dark.dc.html` — desktop, start home, dark → `screenshots/r-accountant/DX-AccHome-Dark.webp`
  - `M-AccHome.dc.html` — phone, start home → `screenshots/r-accountant/M-AccHome.webp`
  - `M-AccHome-Menu.dc.html` — phone, start menu → `screenshots/r-accountant/M-AccHome-Menu.webp`
  - `M-AccHome-Evening.dc.html` — phone, start evening → `screenshots/r-accountant/M-AccHome-Evening.webp`
  - `M-AccHome-Dark.dc.html` — phone, start home, dark → `screenshots/r-accountant/M-AccHome-Dark.webp`

### Payment Desk — same as the live fee app, polished — `PayDesk`

- **Route (suggested):** `/payments` — One Payment Desk for everyone who collects. `?student=<id>` pre-selects a student. Bulk entry at `/payments/bulk` (admin).
- **Who uses it:** admin, accountant
- **What it covers:** One student at a time · pick class → student or search · dues with old balance, installments 1–4 (20 Apr / Jul / Oct / Jan) and the ₹1,000 late fee kept apart · type ANY amount (helper chips only fill the box) · payment date (back-dating works out the late fee for that day) · mode, UTR / cheque details, notes, received by · live “where this money goes” split, oldest first, paid-ahead and credit · compact confirm · certain save with lock + duplicate guard · bilingual receipt SVP20261008-0015 · remove within 10 min (admin) · bulk entry and Excel upload.
- **Start states (11):** `find`, `student`, `amount`, `advance`, `backdate`, `cheque`, `latefee`, `confirm`, `saved`, `duplicate`, `bulk`
- **Props:** `role`, `dark`
- **Frames / screenshots:**
  - `PayDesk.dc.html` — desktop, default start → `screenshots/r-accountant/PayDesk.webp`
  - `DX-PayDesk-Amount.dc.html` — desktop, start amount → `screenshots/r-accountant/DX-PayDesk-Amount.webp`
  - `DX-PayDesk-Saved.dc.html` — desktop, start saved → `screenshots/r-accountant/DX-PayDesk-Saved.webp`
  - `DX-PayDesk-Bulk.dc.html` — desktop, start bulk → `screenshots/r-accountant/DX-PayDesk-Bulk.webp`
  - `PX-PayDesk.dc.html` — desktop, start find, role admin → `screenshots/money/PX-PayDesk.webp`
  - `PX-PayDesk-Student.dc.html` — desktop, start student, role admin → `screenshots/money/PX-PayDesk-Student.webp`
  - `M-PayDesk.dc.html` — phone, start find → `screenshots/r-accountant/M-PayDesk.webp`
  - `M-PayDesk-Student.dc.html` — phone, start student → `screenshots/r-accountant/M-PayDesk-Student.webp`
  - `M-PayDesk-Amount.dc.html` — phone, start amount → `screenshots/r-accountant/M-PayDesk-Amount.webp`
  - `M-PayDesk-Confirm.dc.html` — phone, start confirm → `screenshots/r-accountant/M-PayDesk-Confirm.webp`
  - `M-PayDesk-Saved.dc.html` — phone, start saved → `screenshots/r-accountant/M-PayDesk-Saved.webp`
  - `M-PayDesk-Duplicate.dc.html` — phone, start duplicate → `screenshots/r-accountant/M-PayDesk-Duplicate.webp`
  - `MPX-PayDesk.dc.html` — phone, start find, role admin → `screenshots/money/MPX-PayDesk.webp`
  - `MPX-PayDesk-Student.dc.html` — phone, start student, role admin → `screenshots/money/MPX-PayDesk-Student.webp`

### Accountant · Cheques, UPI & refunds — `AccBooks`

- **Route (suggested):** `/accounts/books` — Cheques, deposit slip, bounce, UPI matching, refunds, requests.
- **Who uses it:** accountant (admin can view)
- **What it covers:** Cheque register (to deposit → deposited → cleared / bounced) · deposit slip · bounced cheque flow · UPI matching against the bank statement · refunds & advances · my requests to the admin with status.
- **Start states (6):** `cheques`, `deposit`, `bounce`, `upi`, `refunds`, `requests`
- **Props:** `dark`
- **Frames / screenshots:**
  - `AccBooks.dc.html` — desktop, default start → `screenshots/r-accountant/AccBooks.webp`
  - `DX-AccBooks-Deposit.dc.html` — desktop, start deposit → `screenshots/r-accountant/DX-AccBooks-Deposit.webp`
  - `DX-AccBooks-Upi.dc.html` — desktop, start upi → `screenshots/r-accountant/DX-AccBooks-Upi.webp`
  - `DX-AccBooks-Bounce.dc.html` — desktop, start bounce → `screenshots/r-accountant/DX-AccBooks-Bounce.webp`
  - `DX-AccBooks-Requests.dc.html` — desktop, start requests, dark → `screenshots/r-accountant/DX-AccBooks-Requests.webp`
  - `M-AccBooks.dc.html` — phone, default start → `screenshots/r-accountant/M-AccBooks.webp`
  - `M-AccBooks-Deposit.dc.html` — phone, start deposit → `screenshots/r-accountant/M-AccBooks-Deposit.webp`
  - `M-AccBooks-Bounce.dc.html` — phone, start bounce → `screenshots/r-accountant/M-AccBooks-Bounce.webp`
  - `M-AccBooks-Upi.dc.html` — phone, start upi → `screenshots/r-accountant/M-AccBooks-Upi.webp`
  - `M-AccBooks-Refunds.dc.html` — phone, start refunds → `screenshots/r-accountant/M-AccBooks-Refunds.webp`
  - `M-AccBooks-Requests.dc.html` — phone, start requests → `screenshots/r-accountant/M-AccBooks-Requests.webp`

### Admin screens shown with the accountant menu

Same modules as the admin pages, rendered with `role="accountant"` so the sidebar/bottom bar match that person. Frames: `AC-Fees.dc.html` (Fees · default), `AC-Dues.dc.html` (Dues · default), `AC-Reminders.dc.html` (Reminders · default), `AC-Reports.dc.html` (Reports · default), `AC-FeeSetup.dc.html` (FeeSetup · default), `MAC-Fees.dc.html` (Fees · list), `MAC-Dues.dc.html` (Dues · list), `MAC-Reminders.dc.html` (Reminders · list), `MAC-Reports.dc.html` (Reports · hub), `MAC-FeeSetup.dc.html` (FeeSetup · structure)

## Academic coordinator app

### Academic coordinator · Today — `AcadHome`

- **Route (suggested):** `/academics` — Coordinator Today + weekly summary.
- **Who uses it:** academic coordinator
- **What it covers:** Attendance today, marks entry, children needing attention, notes needing action · remind all late teachers in one tap · needs-attention list built by the app · phone menu · weekly summary for the principal.
- **Start states (4):** `home`, `menu`, `remind`, `week`
- **Props:** `dark`
- **Frames / screenshots:**
  - `AcadHome.dc.html` — desktop, default start → `screenshots/r-academic/AcadHome.webp`
  - `DX-AcadHome-Week.dc.html` — desktop, start week → `screenshots/r-academic/DX-AcadHome-Week.webp`
  - `DX-AcadHome-Remind.dc.html` — desktop, start remind → `screenshots/r-academic/DX-AcadHome-Remind.webp`
  - `DX-AcadHome-Dark.dc.html` — desktop, start home, dark → `screenshots/r-academic/DX-AcadHome-Dark.webp`
  - `M-AcadHome.dc.html` — phone, start home → `screenshots/r-academic/M-AcadHome.webp`
  - `M-AcadHome-Menu.dc.html` — phone, start menu → `screenshots/r-academic/M-AcadHome-Menu.webp`
  - `M-AcadHome-Remind.dc.html` — phone, start remind → `screenshots/r-academic/M-AcadHome-Remind.webp`
  - `M-AcadHome-Week.dc.html` — phone, start week → `screenshots/r-academic/M-AcadHome-Week.webp`

### Academic coordinator · Student progress — `AcadProgress`

- **Route (suggested):** `/academics/progress` — Class/subject heat map, class, child progress, compare, needs attention, support plan.
- **Who uses it:** academic coordinator
- **What it covers:** Classes and subjects at a glance (heat map) · one class in depth · one child’s progress lines, attendance, notes and support plan · compare two classes · needs-attention list · support plan editor.
- **Start states (6):** `overview`, `class`, `student`, `compare`, `attention`, `plan`
- **Props:** `dark`
- **Frames / screenshots:**
  - `AcadProgress.dc.html` — desktop, default start → `screenshots/r-academic/AcadProgress.webp`
  - `DX-AcadProgress-Student.dc.html` — desktop, start student → `screenshots/r-academic/DX-AcadProgress-Student.webp`
  - `DX-AcadProgress-Class.dc.html` — desktop, start class → `screenshots/r-academic/DX-AcadProgress-Class.webp`
  - `DX-AcadProgress-Attention.dc.html` — desktop, start attention → `screenshots/r-academic/DX-AcadProgress-Attention.webp`
  - `DX-AcadProgress-Plan.dc.html` — desktop, start plan → `screenshots/r-academic/DX-AcadProgress-Plan.webp`
  - `M-AcadProgress.dc.html` — phone, start overview → `screenshots/r-academic/M-AcadProgress.webp`
  - `M-AcadProgress-Student.dc.html` — phone, start student → `screenshots/r-academic/M-AcadProgress-Student.webp`
  - `M-AcadProgress-Class.dc.html` — phone, start class → `screenshots/r-academic/M-AcadProgress-Class.webp`
  - `M-AcadProgress-Attention.dc.html` — phone, start attention → `screenshots/r-academic/M-AcadProgress-Attention.webp`
  - `M-AcadProgress-Plan.dc.html` — phone, start plan → `screenshots/r-academic/M-AcadProgress-Plan.webp`
  - `M-AcadProgress-Compare.dc.html` — phone, start compare → `screenshots/r-academic/M-AcadProgress-Compare.webp`

### Academic coordinator · Attendance — `AcadAttendance`

- **Route (suggested):** `/academics/attendance` — Today, remind, mark for absent teacher, month, below 75%, change requests, register.
- **Who uses it:** academic coordinator
- **What it covers:** 17 of 19 classes marked · remind teachers · mark for a teacher on leave · month trends · children below 75% with call outcomes · change requests from teachers · class register.
- **Start states (8):** `today`, `remind`, `mark`, `month`, `chronic`, `call`, `corrections`, `register`
- **Props:** `dark`
- **Frames / screenshots:**
  - `AcadAttendance.dc.html` — desktop, default start → `screenshots/r-academic/AcadAttendance.webp`
  - `DX-AcadAttendance-Month.dc.html` — desktop, start month → `screenshots/r-academic/DX-AcadAttendance-Month.webp`
  - `DX-AcadAttendance-Register.dc.html` — desktop, start register → `screenshots/r-academic/DX-AcadAttendance-Register.webp`
  - `DX-AcadAttendance-Corrections.dc.html` — desktop, start corrections → `screenshots/r-academic/DX-AcadAttendance-Corrections.webp`
  - `DX-AcadAttendance-Mark.dc.html` — desktop, start mark → `screenshots/r-academic/DX-AcadAttendance-Mark.webp`
  - `M-AcadAttendance.dc.html` — phone, default start → `screenshots/r-academic/M-AcadAttendance.webp`
  - `M-AcadAttendance-Remind.dc.html` — phone, start remind → `screenshots/r-academic/M-AcadAttendance-Remind.webp`
  - `M-AcadAttendance-Chronic.dc.html` — phone, start chronic → `screenshots/r-academic/M-AcadAttendance-Chronic.webp`
  - `M-AcadAttendance-Corrections.dc.html` — phone, start corrections → `screenshots/r-academic/M-AcadAttendance-Corrections.webp`
  - `M-AcadAttendance-Register.dc.html` — phone, start register → `screenshots/r-academic/M-AcadAttendance-Register.webp`
  - `M-AcadAttendance-Month.dc.html` — phone, start month → `screenshots/r-academic/M-AcadAttendance-Month.webp`

### Admin screens shown with the academic menu

Same modules as the admin pages, rendered with `role="academic"` so the sidebar/bottom bar match that person. Frames: `AD-Notes.dc.html` (Notes · default), `AD-Exams.dc.html` (Exams · analysis), `AD-Timetable.dc.html` (Timetable · default), `AD-Calendar.dc.html` (Calendar · default), `MAD-Notes.dc.html` (Notes · default), `MAD-Exams.dc.html` (Exams · analysis), `MAD-Timetable.dc.html` (Timetable · class), `MAD-Calendar.dc.html` (Calendar · month)

## Exam coordinator app

### Exam coordinator · Today — `ExamHome`

- **Route (suggested):** `/exam-office` — Exam coordinator Today + checklist + late teachers.
- **Who uses it:** exam coordinator
- **What it covers:** Half-yearly results countdown and marks entry · Unit Test 2 setup checklist · late teachers reminded with their Sampark link · exam-year timeline · phone menu.
- **Start states (5):** `home`, `menu`, `checklist`, `late`, `remind`
- **Props:** `dark`
- **Frames / screenshots:**
  - `ExamHome.dc.html` — desktop, default start → `screenshots/r-exam/ExamHome.webp`
  - `DX-ExamHome-Checklist.dc.html` — desktop, start checklist → `screenshots/r-exam/DX-ExamHome-Checklist.webp`
  - `DX-ExamHome-Late.dc.html` — desktop, start late → `screenshots/r-exam/DX-ExamHome-Late.webp`
  - `DX-ExamHome-Dark.dc.html` — desktop, start home, dark → `screenshots/r-exam/DX-ExamHome-Dark.webp`
  - `M-ExamHome.dc.html` — phone, start home → `screenshots/r-exam/M-ExamHome.webp`
  - `M-ExamHome-Menu.dc.html` — phone, start menu → `screenshots/r-exam/M-ExamHome-Menu.webp`
  - `M-ExamHome-Checklist.dc.html` — phone, start checklist → `screenshots/r-exam/M-ExamHome-Checklist.webp`
  - `M-ExamHome-Late.dc.html` — phone, start late → `screenshots/r-exam/M-ExamHome-Late.webp`
  - `M-ExamHome-Remind.dc.html` — phone, start remind → `screenshots/r-exam/M-ExamHome-Remind.webp`

### Exam coordinator · Date sheet, seating, duties — `ExamPlan`

- **Route (suggested):** `/exam-office/plan` — Date sheet, seating, duties, papers, publish.
- **Who uses it:** exam coordinator
- **What it covers:** Date sheet copied from the last exam · edit a paper · clash fixes · auto seating two classes per room · room seat chart · fair invigilation duties · question paper tracker · publish to parents and teachers.
- **Start states (8):** `datesheet`, `slot`, `clash`, `seating`, `room`, `duties`, `papers`, `publish`
- **Props:** `dark`
- **Frames / screenshots:**
  - `ExamPlan.dc.html` — desktop, default start → `screenshots/r-exam/ExamPlan.webp`
  - `DX-ExamPlan-Clash.dc.html` — desktop, start clash → `screenshots/r-exam/DX-ExamPlan-Clash.webp`
  - `DX-ExamPlan-Room.dc.html` — desktop, start room → `screenshots/r-exam/DX-ExamPlan-Room.webp`
  - `DX-ExamPlan-Duties.dc.html` — desktop, start duties → `screenshots/r-exam/DX-ExamPlan-Duties.webp`
  - `DX-ExamPlan-Publish.dc.html` — desktop, start publish → `screenshots/r-exam/DX-ExamPlan-Publish.webp`
  - `M-ExamPlan.dc.html` — phone, start datesheet → `screenshots/r-exam/M-ExamPlan.webp`
  - `M-ExamPlan-Slot.dc.html` — phone, start slot → `screenshots/r-exam/M-ExamPlan-Slot.webp`
  - `M-ExamPlan-Seating.dc.html` — phone, start seating → `screenshots/r-exam/M-ExamPlan-Seating.webp`
  - `M-ExamPlan-Room.dc.html` — phone, start room → `screenshots/r-exam/M-ExamPlan-Room.webp`
  - `M-ExamPlan-Duties.dc.html` — phone, start duties → `screenshots/r-exam/M-ExamPlan-Duties.webp`
  - `M-ExamPlan-Papers.dc.html` — phone, start papers → `screenshots/r-exam/M-ExamPlan-Papers.webp`

### Exam coordinator · Results — `ExamResults`

- **Route (suggested):** `/exam-office/results` — Pipeline, moderation, grace, lock, report cards, publish, re-checks.
- **Who uses it:** exam coordinator
- **What it covers:** Results pipeline (entered → checked → grace → locked → report cards → published) · unusual averages · grace rule with live preview · lock · report cards · publish on results day · re-check requests.
- **Start states (7):** `pipeline`, `moderation`, `grace`, `lock`, `cards`, `publish`, `recheck`
- **Props:** `dark`
- **Frames / screenshots:**
  - `ExamResults.dc.html` — desktop, default start → `screenshots/r-exam/ExamResults.webp`
  - `DX-ExamResults-Moderation.dc.html` — desktop, start moderation → `screenshots/r-exam/DX-ExamResults-Moderation.webp`
  - `DX-ExamResults-Grace.dc.html` — desktop, start grace → `screenshots/r-exam/DX-ExamResults-Grace.webp`
  - `DX-ExamResults-Cards.dc.html` — desktop, start cards → `screenshots/r-exam/DX-ExamResults-Cards.webp`
  - `DX-ExamResults-Recheck.dc.html` — desktop, start recheck → `screenshots/r-exam/DX-ExamResults-Recheck.webp`
  - `M-ExamResults.dc.html` — phone, start pipeline → `screenshots/r-exam/M-ExamResults.webp`
  - `M-ExamResults-Moderation.dc.html` — phone, start moderation → `screenshots/r-exam/M-ExamResults-Moderation.webp`
  - `M-ExamResults-Lock.dc.html` — phone, start lock → `screenshots/r-exam/M-ExamResults-Lock.webp`
  - `M-ExamResults-Publish.dc.html` — phone, start publish → `screenshots/r-exam/M-ExamResults-Publish.webp`
  - `M-ExamResults-Recheck.dc.html` — phone, start recheck → `screenshots/r-exam/M-ExamResults-Recheck.webp`

### Admin screens shown with the exam menu

Same modules as the admin pages, rendered with `role="exam"` so the sidebar/bottom bar match that person. Frames: `EX-Exams.dc.html` (Exams · grid), `EX-Calendar.dc.html` (Calendar · default), `EX-Messages.dc.html` (Messages · default), `MEX-Exams.dc.html` (Exams · grid), `MEX-Calendar.dc.html` (Calendar · month), `MEX-Messages.dc.html` (Messages · list)

