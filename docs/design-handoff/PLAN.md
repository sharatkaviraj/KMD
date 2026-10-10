# PLAN — how to fit the approved UI into VPPS One

## Part A — Ideas for a smooth, "perfect" rollout

1. **Redo the UI layer, keep the logic.** VPPS One already has working fee features ported from the fee app. Keep every server action, RPC, permission check and test, and replace only what renders. A screen is "done" when it matches its screenshot and the old tests still pass.
2. **The designs are executable specs.** Each `.dc.html` contains:
   - the exact markup and copy (the template);
   - the state machine (`st()`, `setState`), the handlers and the smart defaults (`renderVals()`);
   - realistic sample data shapes.
   Port the state into `useReducer` hooks, turn the sample data shapes into TypeScript types, and turn the sample data itself into fake seed rows. This removes guesswork.
3. **One design system before any screen.** Build:
   - CSS variables for light and dark (from `design/shared/vx.css`) and `next/font` (Inter, Source Serif 4, Noto Sans Devanagari);
   - `lucide-react` icons, using the map in DESIGN-SYSTEM.md, and one `motion.css` with the keyframes;
   - about 30 primitives in `components/vx/*`.
   Add a hidden `/dev/ui` gallery page that shows every primitive in light/dark at phone and desktop widths. Every later screen is assembled from these, so it stays consistent.
4. **One responsive tree with a 900px container query.** The design flips layout at 900px of the content container, not the window, so the same page works in a narrow window or on a tablet. Use CSS container queries (Tailwind `@container` if the repo uses Tailwind).
5. **One nav config drives everything.** In `lib/nav.ts`, list the items for each role (admin, teacher, accountant, academic coordinator, exam coordinator) exactly as in the design's sidebar and bottom bar. The desktop sidebar, the phone bottom bar, the phone Menu page, the search palette and route guards all read it.
6. **One permission matrix.** Make it a table, editable on Staff → Roles. It feeds the nav visibility, server action guards and Supabase RLS, so the UI can never show something the database would refuse.
7. **"See the app as".** Admin can switch the shell to any role, read-only, to check what each person sees. This gives cheap, continuous QA and is already in the design.
8. **Payment Desk parity first.** The accountant uses it every day. Port the fee app's preview → confirm → post flow and its RPC contract, then add the design's polish:
   - helper chips that only fill the amount;
   - a live "where this money goes" split;
   - a back-dated late fee;
   - a duplicate guard;
   - a locked "Saved" state with a drawn tick;
   - 10-minute removal for the admin;
   - bulk entry.
9. **Undo windows on the server.** Every "Undo" in the design (receipt, attendance save, bulk actions) is a server-side reversal event inside a time window. Nothing is deleted, and the history stays append-only.
10. **Offline-tolerant attendance and notes.** A small IndexedDB queue in the PWA: a teacher can press Save with weak signal and see a "Waiting to sync" chip, and it syncs when back online. The office keeps seeing "Not marked" until the server confirms.
11. **Voice notes.** Use the Web Speech API (`hi-IN` / `en-IN`, works in Chrome on Android) with a fallback to the phone keyboard's mic button. Store the text; storing audio can come later.
12. **WhatsApp stays inside the workflows.** One server module for AiSensy templates. One preview component, Hindi first, always with count and cost before sending. It is reused by reminders, receipts, notices, absent alerts and Sampark links.
13. **Sampark becomes "Your marks links".** Each teacher gets a token link per class-subject. Marks from the link and from in-app entry land in the same marks table. The exam coordinator sees one tracker.
14. **Fast on cheap phones.**
    - Server components for data, skeletons immediately, and route chunks under about 200 KB.
    - Fonts with `display: swap`.
    - Animations limited to transform and opacity.
    - Use the View Transitions API, where supported, for push/pop between screens.
15. **Fake but realistic seed data.** Use the TEST session. A seed script builds the classes, about 430 fake students, 30 staff across all roles, fees, receipts, attendance, marks, notes and announcements, so every screen shows real-looking content for review. It never contains a real child's data.
16. **Visual check without heavy gates.** A Playwright script walks each route per role at 390 and 1440 wide and saves shots. A hidden `/dev/compare?frame=…` page can show the design screenshot next to the live page.
17. **Cutover later, separately.** This plan builds on schoolfees-dev. Moving VPPS One to the live data is a later, separate step: replay the migrations, switch the env and do a smoke check. It is not part of this work.

## Part B — Phases (each ends with a push to `main`)

### P0 — Inventory and ledger
- Read the repo, then `docs/design-handoff/*`.
- Write `docs/ui/INVENTORY.md`, a table of every module in SCREENS.md:
  - status: exists / partial / missing;
  - current route → target route;
  - the data it uses (tables/RPCs), and what is missing;
  - permissions.
- Create `docs/ui/PROGRESS.md` and `docs/ui/DECISIONS.md`.
- Confirm the linked Supabase ref is `wtgxcptmucjerhufzjcf`.
- Commit.

### P1 — Design system
- Tokens (light + dark, `.dark` class and `prefers-color-scheme`), fonts, `motion.css` (all keyframes in DESIGN-SYSTEM.md), container-query helpers, icon map.
- Components in `components/vx/*`:
  - **Layout:** AppShell, Sidebar, TopBar (glass), BottomBar (with centre action and badges).
  - **Surfaces:** Card, KPI tile (value, delta pill, sparkline), Ring, StackedBar, BarChart (grow), HeatGrid.
  - **Controls:** Chip, Segmented control (sliding thumb), Switch, RadioCard, Stepper (+/−), Wizard stepper, Field/Input (error shake), NumberPad.
  - **Overlays and feedback:** Sheet (bottom sheet on phone, centred dialog on desktop), Toast with Undo, Skeleton, EmptyState, SuccessTick (drawn), WhatsAppPreview bubble, VoiceNote widget.
  - **Data display:** DataList (table on desktop, card list on phone, from one definition), Money, DateChip row, HelpSheet, LangSwitch (EN | हि).
- A `/dev/ui` gallery page. Push.

### P2 — App shell and roles
- `lib/nav.ts` per role (copy the items, labels, Hindi sub-labels, badges and order from `design/src/XSide.dc.html` and `XNav.dc.html`).
- Role home redirect: admin → `/`, teacher → `/teach`, accountant → `/accounts`, academic → `/academics`, exam → `/exam-office`.
- Search palette (Ctrl K) and the phone Menu page.
- "See the app as" for admin.
- Dark mode and the EN | हि switch (labels in `lib/labels.ts`).
- The permission matrix table, with RLS helper functions.
- Seed fake staff for every role.
- Push.

### P3 — Payment Desk (`/payments`)
- Port the fee app's preview/post logic and RPC contract.
- Build every state from SCREENS.md, PayDesk section: find, student, amount, advance, backdate, cheque, late fee, confirm, saved, duplicate, bulk.
- The desktop is the counter's two-pane layout; the phone is one thumb-ordered column.
- Wire "Collect fee" from every place (Today, Student 360, Students row, quick actions, menu) to `/payments?student=`.
- Unit-test the allocation, the back-dated late fee and the duplicate guard. Push.

### P4 — Rest of Money
Build Receipts and close the day, Dues and calls, Fee reminders, Fee setup (with a view-only accountant mode), Reports, plus the accountant's Today and Books screens. Push after each module.

### P5 — Admin core
- Today, Needs you (approvals inbox), Students, Student 360 (tabs, including the new Notes tab), Attendance board and mark sheet, quick actions, search.
- Use `design/project/App.dc.html` and `Desktop.dc.html`, plus the F*/D* screenshots.
- Push.

### P6 — Teacher app (`/teach/*`)
Build TchHome, TchAttend, TchClass, TchNotes, TchMarks and TchMore. Then wire them up:
- announcements with "Got it" acknowledgements;
- Sampark links;
- the attendance save → office board;
- WhatsApp absent alerts at 10 am (queued);
- the leave request → admin.

Use big targets and Hindi labels. Push.

### P7 — Notes on children (shared)
- Tables: notes, replies, support plans and plan steps.
- Build the voice widget and the notes board (admin + coordinator).
- Add the Student 360 notes tab and the teacher notes.
- Visibility rules: the team / only me. A subject teacher's note reaches the class teacher.
- Push.

### P8 — Academic coordinator
AcadHome, AcadProgress and AcadAttendance. The needs-attention rules run as a SQL view: below 75% attendance, below 33% in a subject, marks dropped 15% or more, 2 or more open notes. Push.

### P9 — Exam coordinator and marks
- Exams (tracker, Sampark links, entry, report cards, analysis), ExamHome, ExamPlan (date sheet, seating, duties, papers, publish) and ExamResults (pipeline, moderation, grace, lock, report cards, publish, re-checks).
- Generate report-card PDFs on the server.
- Push.

### P10 — Remaining admin modules
Timetable and substitutions (with the AiSensy notice to the substitute), Calendar, Messages, Admissions, Student tools (promote, import, data quality, families), Staff and roles, Settings (activity log, backups status, master data, glossary). Push after each one.

### P11 — System states
Sign-in, change password, session/role picker, offline banner with queued items, no access (403), not found, loading skeletons, session expired, update available. Push.

### P12 — Polish and final check
- Walk every route for every role at both widths and compare with the screenshots.
- Fix the gaps: dark mode, reduced motion, accessibility (labels, focus, contrast), performance budget.
- Complete PROGRESS.md and DECISIONS.md.
- Final push.
