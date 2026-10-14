# Design fidelity — "same to same"

The owner's call (13 Oct): **the design wins everywhere.** Every screen's look
follows the approved canvas (`docs/design-handoff/`). Where a later change
altered a screen's look, the screen goes back to the design. Business rules
(`docs/design-handoff/RULES.md`, CLAUDE.md), fixes, permission checks, server
actions and real data stay. A screen is done when it and its design frame are
the same picture at 1440 and 390 px, in light and (where drawn) dark.

## Where the design is

| What | Where |
|---|---|
| Readable source per module (template, `renderVals()` logic, sample data, copy) | `docs/design-handoff/design/src/<Module>.dc.html` |
| Built copy with every style inlined (exact px, colours, radii) | `docs/design-handoff/design/project/<Module>.dc.html` |
| Frames → module, start state, size | `docs/design-handoff/canvas-index.json`, `docs/design-handoff/SCREENS.md` |
| Screenshots of every frame | `docs/design-handoff/screenshots/<page>/<frame>.webp` |
| Tokens, type, motion, components | `docs/design-handoff/DESIGN-SYSTEM.md`, `src/vx/vx.css` |
| Rules that beat the pictures | `docs/design-handoff/RULES.md` |

A frame file such as `M-Fees-Receipt.dc.html` is a wrapper: it mounts the
module (`<dc-import name="Fees" start="receipt">`). The module's
`st()`/`data()` give the state and the sample records drawn in the frame.

## The loop

1. **Fixture.** Add `tests/mobile-ui/design/<module>.fixture.tsx` exporting
   `views: Record<string, DesignView>` (type in `tests/mobile-ui/design.fixture.tsx`),
   one view per frame, keyed by the frame's name without `.dc.html`. Render the
   production screen component with synthetic props that copy the frame's
   sample data. Server actions are stubbed by the fixture's Vite plugin; no
   database, no sign-in.
2. **Serve.** `npx vite --config tests/mobile-ui/design.vite.config.ts`
   (port 3202; set `FIXTURE_PORT` to run several at once).
   `http://127.0.0.1:3202/design.html` lists every view.
3. **Compare.**
   `node scripts/design-compare.mjs <out> "<name>|view=<view>|<page>/<frame>.webp|1440|900"`
   writes `<out>/<name>.png`, design left and app right. Phone frames are
   `390|844`. Add `&theme=dark` for dark frames, `&menu=teacher` etc. for a
   role's shell. On Windows set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the
   installed Chromium if Playwright asks for a newer build.
4. **Fix** the screen until the pictures agree: layout, order, sizes, type,
   colour, radius, copy, icons, empty and error states. Keep every rule,
   permission check, action and data contract. Do not invent data the app does
   not have: draw the design's layout with what is real and record the gap.
5. **Check.** `npm run typecheck`, `npx eslint <changed files>`, `npx vitest run`.

## Log

| Area | Modules | Frames | Status | What remains different, and why |
|---|---|---|---|---|
| Older screens | 85 classic routes | — | done (#84) | Design top bar and kit geometry; content keeps its old layout (UI-73) |
| Admin core | Student 360 (F06–F08, D02), shell, kit | 4 + kit | done | Marks card titles the term ("Half-yearly"), not "Half-yearly · September"; note lines carry no subject role; sibling money is "left this year" (UI-77) |
| Payment Desk | PayDesk, F09/F10, D05/D06 | 18 | done | Late fee is take-or-waive (UI-15), so a ₹7,000 payment settles Installment 2's late fee first; accountant has no waiver or bulk request flow; no receipt verify URL |
| Receipts & Dues | Fees, Dues | 20 | done | Receipt keeps the school's real name (UI-9); Close keeps "receipts not locked" (UI-38); no daily call target, week-on-week %, letter channel or plan message queue |
| Reminders, Fee setup, Reports | Reminders, FeeSetup, Reports | 33 | done | Nothing sends (UI-42/67/71); no AiSensy balance, rule next-run or per-class read/paid; fee model has no extra heads, per-installment split, per-day late fee or route stops (UI-31); some Reports inner strings still English-only |
| Accountant | AccHome, AccBooks | 19 | done | Follow-ups are call-back dates, not promises; no admin name on waiting requests; cheques are not pre-ticked; no seen step, auto-match actor, slip account number |
| People | Admissions, StudentTools, Staff | 28 | done | Logins are email + one-time password (UI-43); one role per person; no photo capture at admission, per-installment admission fee, per-row import fix |
| Notes | Notes, TchNotes | 24 | done | "Needs action" is the app's rule; "Just noting" has no status of its own; nothing is sent to parents (queued, UI-33); three follow-up dates, not four |
| Exams, Timetable, Calendar | Exams, Timetable, Calendar | 38 | done | Marks lock a whole class (UI-54); bands follow the papers classes sit; no rooms; no read receipts or staff birthdays; Hindi date lines in "both" only (UI-6) |
| Messages, Settings, Sign-in | Messages, Settings, Auth | 29 | done | Real school name and logo (RULES I); email sign-in (UI-51); To send and Queue (UI-71); no session dates, read %, attachments or scheduling |
| Teacher app | TchHome, TchAttend, TchClass, TchMarks, TchMore | 50 | done | No rooms, leave balances or syllabus tracker; Leave shown as half day (RULES C); no 30-minute change window (D-248) |
| Needs you, Attendance | App inbox/attendance/mark, Desktop inbox/attendance (F02, D03, F11, F12, D04) | 5 | done | No attendance-correction item (D-248) and no duplicate-record check, so the Students item is a parent's answer; no "Remind me at 2 pm" snooze (Open substitutions sits there); cover facts say "3 · 10:40 – 11:20" / "Mr. Meena" without subjects, as the loader builds them; a new register opens with everyone present (28 of 28, UI-22) where the frame shows 14 of 28 half-marked; times read 08:36 (kit `clock`); the phone keeps the bottom bar on Attendance (UI-78) |
