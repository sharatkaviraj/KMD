# VPPS One — progress

**The next task is the first row below that is not `done`.**
An agent updates its row before it stops. Never delete a row; add `N.x-fix` rows
under the task they fix.

Status: `todo` · `in progress` · `pr open` · `done` · `blocked (reason)`

## Phase 0 — setup (done by Janmejay + Claude, 2026-09-16)

| # | What | Status |
|---|---|---|
| 0.1 | Repo `veerpatta/vppsone` created, private | done |
| 0.2 | Next.js 16 app scaffolded, Supabase + zod installed | done |
| 0.3 | Vercel project linked, env vars set to schoolfees-dev | done |
| 0.4 | Plan, rules and sources written | done |

### Applied to schoolfees-dev

Migrations are applied through the Supabase MCP, and the file is named for the
version the MCP recorded (D-22), so this list and
`supabase_migrations.schema_migrations` agree.

| Version | File | Task |
|---|---|---|
| 20260916191746 | `create_vppsone_schema` | 1.1 |
| 20260916191757 | `create_staff_profiles` | 1.1 |
| 20260916191935 | `expose_vppsone_to_postgrest` | 1.1 |
| 20260916201212 | `create_subjects_and_class_aliases` | 1.4 |
| 20260916202429 | `staff_language_allows_bilingual` | 1.7 |
| 20260916204801 | `create_class_teachers_and_calendar` | 1.5 |
| 20260916205631 | `create_enrolments` | 1.6 |
| 20260916210606 | `create_timetable_versions_and_slots` | 2.2–2.3 |
| 20260917021218 | `create_attendance_and_notes` | 3.1–3.6 |

## Phase 1 — foundation

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 1.1 | Supabase clients, Auth, login, middleware, `vppsone` schema, `staff_role`, `staff_profiles`, permissions | done | `p1-1-foundation` | `50f674d` ([#1](https://github.com/veerpatta/vppsone/pull/1)) | Creating the schema was not enough — PostgREST answered `PGRST106 Invalid schema: vppsone` until it was exposed, so that is now its own migration (D-19). A proxy that bounced any signed-in visitor off `/login` looped forever against a session whose profile was deactivated; the login page decides that now, from the profile rather than the JWT (D-23). The env badge and a bare `/dashboard` exist but the shell is 1.2's; `requirePermission()` throws rather than rendering an error screen until 1.2 gives it one |
| 1.2 | App shell: mobile layout, bottom nav, top bar, tokens, env badge | done | `p1-2-shell` | | Ledger Calm tokens ported from the fee app into Tailwind v4 `@theme`. Signed-in screens live under `src/app/(app)/` so the guard is structural. Nav is derived from `can()`, and each item carries a `ready` flag with a test that it matches a real page file — the phase ships over several deploys and a tab without a route is a 404 with the school on it. `requirePermission()` now redirects to `/access-denied`; actions use `assertPermission()`, which throws, because `redirect()` in an action is a thrown signal a try/catch would swallow |
| 1.3 | Master data — staff | done | `p1-3-staff` | | List with client-side search (a few dozen staff, so the whole list ships once and search works in a corridor), create, edit, deactivate. `short_name` is disabled in the edit form, absent from the update schema, and refused by the action — three layers over the database trigger. Phone numbers normalise to ten digits and refuse anything not starting 6–9 rather than guessing. Nobody can deactivate themselves |
| 1.4 | Master data — subjects, class aliases | done | `p1-4-subjects-classes` | | Subjects with an immutable code, and a per-class label editor where each row saves itself (nineteen classes, filled in over more than one sitting). **The fee app.s RLS gates `public.classes` on its own `public.users.role`, so the cookie client reads zero rows and no error** — fee reads now go through the service-role client after `assertPermission`, since rule 2 forbids adding a policy there (D-32). `orphanedAliases()` is what notices a class that has gone, because no FK points into `public` |
| 1.5 | Master data — class teachers, academic calendar | done | `p1-5-class-teachers-calendar` | | Class teachers are replaced, never edited: a handover closes the outgoing row on the day *before* the new one starts, and a partial unique index allows exactly one open row per class. The calendar stores only the days that are not ordinary — a few dozen rows, not 365 — and a range is expanded to one row per day so "is school open on the 14th" stays a lookup. **`exam` and `event` keep school open but stop the timetable**, which is the distinction that decides whether a register is taken (D-39) |
| 1.6 | Enrolments from `public.students` + consistency check | done | `p1-6-enrolments` | | One row per child per session, because `public.students` holds only today and an academic record needs history. No FK can point into `public` (rule 2), so the screen is the enforcement: it reconciles both sides on every load and names five kinds of difference. A vanished student is the one a rebuild will not resolve — their attendance and marks are here — so the row is kept for a person (D-43) |
| 1.7 | Per-account language: Hindi / English / Bilingual | done | `p1-7-language` | | Janmejay's call mid-phase: the app was hard-coded bilingual, which made every label twice as long for everyone and gave nobody the screen they wanted. Strings are now pairs in `src/messages/`, rendered per reader (PLAN §3a, D-35). Validation messages ride through Zod as JSON because the domain cannot know who is reading. The login screen uses a device cookie, since signed out there is no profile (D-36). `raj@vpps.co.in` is `en` |

## Phase 2 — timetable

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 2.1 | Parser port from `timetable2025/scripts/data.js` + fixture tests | done | `p2-1-parser` | | Ported with behaviour intact; every count SOURCES.md pins matched on the first run — 768 cells, 30 parallel, 60 shared, 19 teachers, 23 subjects. Two deliberate changes: the parser now reports *problems* (short row, duplicate class, unclosed bracket, empty brackets) because 2.2 has to show the school what is wrong before anybody publishes, and `SHORT_SUBJECTS` is not ported at all — it belongs at render, and applying it at parse produces labels matching no subject row |
| 2.2 | Import dry run, resolve against master data | done | `p2-1-parser` | | Resolves every cell against the 1.3/1.4 master data and groups what is missing **by the screen that fixes it**. Keeps going after the first unknown name — a run that stopped would make the school fix one, re-upload, and find the next, nineteen times. An unmapped class is reported once rather than also reporting its eight subjects |
| 2.3 | Versions: upload → check → draft → publish | done | `p2-1-parser` | | A partial unique index allows exactly one published version per session; publish archives the old one **first**, because the other order is refused by that index. `teaching_assignments` is regenerated last, so an interruption leaves stale assignments (visible, fixable) rather than assignments for a timetable that is not live |
| 2.4 | Views: class / teacher / day / free | done | `p2-1-parser` | | Four grids, filtered in the browser over the whole published timetable. `freeTeachers()` takes the whole roster rather than deriving it from the timetable — somebody with no periods is the *most* free, which is the bug the old planner needed a hard-coded reserve list to work around. A clash is one teacher in two different *subjects*; a combined class is not a clash |

## Phase 3 — teacher workspace

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 3.1 | `/teach` shell + Today | done | `p3-teacher-workspace` | | The card answers one question above the fold — is there anything I have not done. It names **three kinds of nothing** (school closed, no class of your own, everything already in), because a card that counts rows renders all three as an empty box and only one means "you are finished" (D-59). Today's periods come from the published timetable, matched to the sheet's own day header rather than to `=== "Monday"`: a retyped block would otherwise silently show a teacher a free day |
| 3.2 | Attendance screen | done | `p3-teacher-workspace` | | Four big targets per child, not a dropdown — forty children are marked standing up. Every tap goes straight to `localStorage`; the flush is **one request for the whole register**, so a signal drop cannot half-mark a class; and the upsert on `(register, student)` makes a second submit produce the same rows. Verified against dev: two submits → 1 register, 14 marks. The queue is a `useSyncExternalStore` external store rather than component state (D-57) |
| 3.3 | Corrections + office on-behalf | done | `p3-teacher-workspace` | | A submitted register is a record: changing a mark carries a reason and two names. **Nobody approves their own** — with one approver that means a request can sit, which is the right failure. The mark is rewritten *after* the request is marked approved, so an interruption leaves an approved request with an unchanged mark (visible, fixable) rather than a changed mark nobody signed. `on_behalf_of` names the teacher stood in for, never the person pressing the button (D-54) |
| 3.4 | Notes | done | `p3-teacher-workspace` | | Per student and per class, typed by the six seeded `note_kinds`. Kind first, text second — the order the register margin already uses — so a note is findable by what it was about. Remove is your own only, enforced in the query rather than checked beforehand, so a tampered id cannot reach somebody else's note |
| 3.5 | Student card | done | `p3-teacher-workspace` | | Attendance % (late counts as present, approved leave leaves the denominator), notes, and the fee standing read from the fee app's **own** `v_student_directory` — VPPS One does not model fees and must not appear to. Fees and late fees are shown as separate figures and never summed (D-33), and only to `collection:view` (D-56). Marks are the one thing PLAN 3.5 names that is absent: the assessment tables are Phase 6.1, and a placeholder would be a promise the data cannot keep (D-60) |
| 3.6 | Monthly register PDF | done | `p3-teacher-workspace` | | The paper sheet, as a value: `buildMonthlySheet()` with tests. Columns are the union of "school was open" and "somebody took a register" — an open day with no register is the gap worth seeing, and a register taken on a closed day is still a fact about the children. A blank cell is *not* an absence. It prints rather than rendering a PDF server-side (D-55); `@media print` is A4 landscape, because a month of columns does not cross portrait |

## Phase 4 — substitutions

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Engine port (tests first) | todo | `p4-1-engine` | | |
| 4.2 | Planner UI | todo | `p4-2-planner` | | |
| 4.3 | Publish → assignments → notify | todo | `p4-3-publish` | | |
| 4.4 | Shift policies | todo | `p4-4-shift-policies` | | |

## Phase 5 — collection

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Token links + field registry | todo | `p5-1-token-links` | | |
| 5.2 | Submissions + review queue | todo | `p5-2-review-queue` | | |
| 5.3 | Student records + documents | todo | `p5-3-documents` | | |
| 5.4 | WhatsApp templates | todo | `p5-4-whatsapp` | | |

## Phase 6 — assessments and reports

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Assessments admin | todo | `p6-1-assessments` | | |
| 6.2 | Marks grid | todo | `p6-2-marks` | | |
| 6.3 | Progress view | todo | `p6-3-progress` | | |
| 6.4 | Report card PDF | todo | `p6-4-report-cards` | | |
| 6.5 | Academic exports | todo | `p6-5-exports` | | |

## Phase 7 — automations and cutover

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 7.1 | Job platform + console | todo | `p7-1-jobs` | | |
| 7.2 | Scheduled jobs | todo | `p7-2-automations` | | |
| 7.3 | Cutover to live data (PLAN §7) | todo | — | | Janmejay decides when |
