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
| 20260917025818 | `create_substitutions` | 4.1–4.4 |
| 20260917033652 | `create_collection` | 5.1–5.4 |
| 20260917033722 | `create_vppsone_documents_bucket` | 5.3 |
| 20260917041039 | `create_assessments` | 6.1–6.5 |

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
| 3.5 | Student card | done | `p3-teacher-workspace` | | Attendance % (late counts as present, approved leave leaves the denominator), notes, and the fee standing read from the fee app's **own** `v_student_directory` — VPPS One does not model fees and must not appear to. Fees and late fees are shown as separate figures and never summed (D-33), and only to `collection:view` (D-56). Marks were the one thing PLAN 3.5 named that was absent — a placeholder would have been a promise the data could not keep (D-60). They arrived in Phase 6.3 as term summaries, built with the same `totalsFor()` the report card uses |
| 3.6 | Monthly register PDF | done | `p3-teacher-workspace` | | The paper sheet, as a value: `buildMonthlySheet()` with tests. Columns are the union of "school was open" and "somebody took a register" — an open day with no register is the gap worth seeing, and a register taken on a closed day is still a fact about the children. A blank cell is *not* an absence. It prints rather than rendering a PDF server-side (D-55); `@media print` is A4 landscape, because a month of columns does not cross portrait |

## Phase 4 — substitutions

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 4.1 | Engine port (tests first) | done | `p4-substitutions` | | Ported whole: the tier ladder, the weights, the min-cost flow, half days, fatigue, load spreading and the merge rules, with the original's tests brought across first. **Dropped deliberately**: `createPlanStore` (plans are rows, so pruning is a query and invalidation is `planIsStale()`), and the `DEFAULT_SHIFTS`/`RESERVE_STAFF`/`DUTY_STAFF` constants, which named real teachers in source — rule 6 forbids that and they are rows now (D-61). Four of the original's 34 tests were about its own `data.js` and `i18n.js`, not the engine, and VPPS One tests those elsewhere |
| 4.2 | Planner UI | done | `p4-substitutions` | | One day at a time, in the order a coordinator works: who is away, what that leaves uncovered, the allocation, then publish. Every row carries the engine's own proposal *and* the names it refused, with the reason on them — hiding a blocked teacher makes the staff room look smaller than it is, which is the moment somebody goes back to the paper chart. Half days are first-class: the period picker leads with "whole day" because most absences are, and a teacher away from P5 is an ordinary candidate for P1 |
| 4.3 | Publish → assignments → notify | done | `p4-substitutions` | | Publishing puts the cover on the covering teacher's own Today card; a draft shows nobody, because a teacher who turned up to a class the coordinator had not finished deciding about is the reason nobody trusts the card again. Notification is in-app, not WhatsApp (D-65). Anything set by hand is pinned by construction and survives regenerating, and the pins are handed to the engine as work already done so it never double-books against one (D-66) |
| 4.4 | Shift policies | done | `p4-substitutions` | | `cover_policies`: the periods somebody is on site for, whether they are a duty-holder or office staff, and their automatic cover cap. Everybody is listed whether or not they have a row — absence of one means full day, ordinary teacher, default cap — and clearing a row deletes it rather than writing the defaults in, because "nobody has said" and "somebody decided" should not look the same |
| 4.5 | Test data and a fixture sweep | done | `p4-substitutions` | | Added because the phase could not otherwise be judged: `seed:timetable` publishes the fixture sheet through the app's own parser, `seed:scenarios` seeds one of every state (four absence shapes, a published day and a hard draft day, four cover policies, a month of registers, three corrections, six note kinds). `tests/substitution-fixture.test.ts` runs the engine over the real 768-cell sheet across 42 day × absence-shape permutations and asserts the invariants hold on every one |
| 4.6 | Fix: PostgREST was truncating the timetable | done | `p4-substitutions` | | Found while seeding: the published timetable is 1038 slots and `listSlots()` had been returning 1000 since Phase 2, with no error — thirty-eight lessons missing from every timetable view and invisible to the planner. Reads that can exceed a thousand rows now page through `fetchAllRows()` (D-62) |

## Phase 5 — collection

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 5.1 | Token links + field registry | done | `p5-collection` | | `/r/<token>` is one request, `/t/` is one teacher's own list, `/w/` is where a WhatsApp button lands — public by design, because the school has forty staff and four accounts (D-68). The token is the whole authorization: ~96 bits, one request and no navigation past it, **every rejection the same 404**, and a guess rate limited in Postgres with its own budget so a teacher never spends a guesser's. The field registry and `validateField()` are ported from Sampark with their bilingual errors — a nine-digit phone number is impossible to *submit*, not something the office cleans up later |
| 5.2 | Submissions + review queue | done | `p5-collection` | | Re-answering replaces on (request, student, field): a correction is not a second submission. The queue **splits changes from confirmations** and accepts confirmations in bulk — "this is already right" is a real answer but not a change, and four hundred of them one at a time is a queue nobody finishes (D-73). A repeated phone number carries a neutral count, never a warning (D-71). **Blank means no change, never erase** (D-72) |
| 5.3 | Student records + documents | done | `p5-collection` | | An accepted answer lands in `vppsone.student_records` and **never in the fee app**: `fee_column` is a comparison, not a destination (rule 2, D-69). An approved human answer outranks every import, forever, in code rather than in an editable row (D-70). Documents live in a private bucket and are served through a signed URL that lasts a minute, minted inside the function that checks the permission, with a path keyed by child and a random id rather than the filename (D-75) |
| 5.4 | WhatsApp templates | done | `p5-collection` | | Templates carry the approved wording beside the name AiSensy knows them by, and a send stores the text **as it will read** because a template can be edited afterwards. `mayDispatch()` refuses a parent-facing row outright — D-10 made executable — so the office opens it in their own WhatsApp and marks it sent. Staff messages may go through the provider and still need an `AISENSY_API_KEY` this repo does not carry (rule 8: sending costs money) (D-76) |
| 5.5 | Fix: "9 of 45" read backwards in Hindi | done | `p5-collection` | | Caught on the collection link, which happened to render for a Hindi reader. English counts up from the part, Hindi counts down from the whole (`45 में से 9`), so two numbers around a translated "of" render backwards in one of them — as the attendance register had been doing since Phase 3. `countOf()` now owns the word order (D-77) |

## Phase 6 — assessments and reports

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 6.1 | Assessments admin | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | An exam is not one max mark, so `assessment_subjects` is a paper per class per subject — a Class 5 English paper and a Class 10 English paper are out of different totals, and a single `max_marks` on the exam would make the whole school sit the same one (D-78). Locking is the state that stops entry, and it is one field a coordinator sets, not a date somebody has to remember |
| 6.2 | Marks grid | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | **Three states per cell, never two** (D-79): blank is nobody has entered it, Absent is a child who did not sit the paper, and a number is a number — including nought. The column saves in one request like the attendance register, and a refusal leaves the whole column unwritten rather than half of it. Every change is logged with both sides of it, and an unchanged save writes nothing (D-80). `inputMode="decimal"`, not `type="number"` — a spinner that scroll-changes a mark somebody is reading past is a silent wrong answer |
| 6.3 | Progress view | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Finished papers stay on the board: dropping them would show a teacher who has entered everything as identical to a teacher nobody asked. Term summaries reach the student card too, using the same `totalsFor()` the report card uses, so two screens about one child cannot disagree about what a missing paper means. **A paper nobody has marked is out of both halves; an absence is a nought it is out of** (D-81) |
| 6.4 | Report card | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | A card is a **snapshot, not a view** — issued cards keep their own copy, because marks change afterwards and recomputing would silently rewrite what a family is holding (D-82). One row per subject, a column per exam. Weight applies to the percentage and never to a printed mark (D-83), and the card says so only when the weights actually differ. `readiness()` says what is missing beside the button rather than refusing. No PDF: the browser's own print is what a school with one printer actually uses, and the grade bands are a **default the school still has to confirm** (D-84) |
| 6.5 | Academic exports | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | CSV built in the browser, with only the log row posted — an export is a copy of the school's records leaving the building, and who took what is the fact worth keeping. Logged *before* the file is handed over, because a log of successful downloads misses the interesting case. BOM and CRLF so Excel opens Hindi correctly, and `marksCsv()` prints "Absent" and "Not entered" as different things rather than both as blank |
| 6.6 | Fix: `weight` was stored, shown and documented but changed no total | done | `p6-assessments` | `820ca5f` ([#11](https://github.com/veerpatta/vppsone/pull/11)) | Found while smoke-testing the seeded card: the form took a weight, the card carried it to every cell, and no arithmetic anywhere used it — a control that did nothing. `totalsFor()` now applies it to the percentage only, and returns `weighted` so a screen can explain a percentage that is not the printed pair divided (D-83). The seed has a child who picked up after the formative, because otherwise every child scores the same share of both papers and the weighting is invisible in the data |

## Phase 7 — automations and cutover

| # | What | Status | Branch | Commit | Notes |
|---|---|---|---|---|---|
| 7.1 | Job platform + console | todo | `p7-1-jobs` | | |
| 7.2 | Scheduled jobs | todo | `p7-2-automations` | | |
| 7.3 | Cutover to live data (PLAN §7) | todo | — | | Janmejay decides when |
