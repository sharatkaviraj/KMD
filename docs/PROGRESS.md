# VPPS One — progress

**Active queue: PLAN revision 2. The next task is R1.2 below.**
Use the first actionable R-row, not the deferred original live-cutover row 7.3.
Phases 0–7 below are historical implementation records and remain intact.
An agent updates its row before it stops. Never delete a row; add `N.x-fix` rows
under the task they fix.

Status: `todo` · `in progress` · `pr open` · `done` · `blocked (reason)`

## Revision 2 — active queue (2026-09-17)

Planning delivery: updated PLAN, parity register, QA protocol, verified baseline,
kickoff and aligned entry documents. Branch `main`; identify this documentation
commit through git history. Baseline application commit `0712de6`. No R-phase
implementation is claimed. See `QA-BASELINE-2026-09-17.md` for executed checks.

| Task | Bounded deliverable | Depends on | Status | Branch / commit / evidence |
|---|---|---|---|---|
| R0.1 | Complete source parity inventory, verify app/test origins and record baseline defects/metrics | Existing source + baseline | done | `r0-1-parity-and-origins` · `docs/evidence/R0.1-2026-09-17.md`, `docs/evidence/R0.1-origins-2026-09-17.json`, `npm run verify:origins` |
| R0.2 | Deterministic six-role + second-teacher fixtures, run-scoped reset and mock provider | R0.1 | done | `r0-2-fixtures` · `npm run qa:seed`/`qa:reset`/`qa:status` · `docs/evidence/R0.2-2026-09-17.md` |
| R0.2-fix | B-21: the teacher's Today card called her first lesson "Period 0" | R0.2 | done | `r0-2-fixtures` · `src/modules/timetable/domain/periods.ts`, `tests/periods.test.ts` |
| R0.3 | Independent access expectations; smoke timeouts/counts/results; first teacher and office browser journeys | R0.2 | done | `r0-3-expectations-and-journeys` · `npm run smoke:workflows` · `docs/evidence/R0.3-2026-09-17.md`, `docs/evidence/R0.3-smoke-roles-2026-09-17.json` |
| R1.1 | App registry, Apps hub, original SamPark/School Fees home shortcuts and verified context links | R0.1 | done | `r1-1-app-registry` · `src/platform/config/apps.ts`, `/apps` · `docs/evidence/R1.1-2026-09-17.md` |
| R1.2 | Role home resolver, role-priority phone nav, grouped desktop sidebar and aliases | R1.1 | todo | — |
| R1.3 | Shared form/state components, language preferences and responsive design baseline | R1.2 | todo | — |
| R2.1 | Teacher Today priorities, assigned requests and class shortcuts | R1.3, R0.3 | todo | — |
| R2.2 | Office/admin, academic/exam coordinator and viewer homes with real queues | R1.3, R0.3 | todo | — |
| R2.3 | Student directory and shared summary, source labels, persistent search/session context | R2.1, R2.2 | todo | — |
| R3.1 | Additive rounds, frozen membership/value snapshots, identity mapping and audience domain | R0, R2.3 | todo | — |
| R3.2 | Audience/fields/preview wizard, gap filters and Excel ask-list matching with notes | R3.1 | todo | — |
| R3.3 | Teacher fan-out, master/office links, completion board and resume | R3.2 | todo | — |
| R3.4 | Round-aware review/precedence/superseding and mock message retry; S-01–S-09 acceptance | R3.3 | todo | — |
| R4.1 | Student source/health tools and resumable import preview/error handling | R3.4 | todo | — |
| R4.2 | Student photo capture/retake/replace, bulk filename matching and office-assisted workflow | R4.1 | todo | — |
| R4.3 | Documents, workbook export and residual S-12–S-14 source parity | R4.2 | todo | — |
| R5.1 | Attendance UX, durable/account-scoped drafts, corrections and atomic save recovery | R2, R0.3 | todo | — |
| R5.2 | Timetable/cover usability, atomic publication and stale/concurrent plan handling | R5.1 | todo | — |
| R5.3 | Marks entry/paste/history, report readiness and print; atomic/versioned saves | R5.2, R4.3 | todo | — |
| R6.1 | Complete all F-row fee destinations and verify authentication/context/environment handoff | R1.1, R2.3 | todo | — |
| R6.2 | Reconcile fee summaries and validate original workflows in verified fee test environment | R6.1 | todo | Record unavailable sandbox as an evidence gap, never use live writes |
| R7.1 | Measure and optimize query/render/bundle/image/save hotspots; before/after evidence | R3–R6 | todo | — |
| R7.2 | Full responsive/language/keyboard/accessibility pass and performance budgets | R7.1 | todo | — |
| R8.1 | Full deep smoke matrix; fix P0/P1 with regression and cleanup evidence | R7.2 | todo | — |
| R8.2 | CI/main/deployment verification, parity closure and rollback report | R8.1 | todo | — |
| R8.3 | Timed teacher/office/admin and physical Android/webview/camera/print acceptance | R8.2 | todo | Code-delivered and staff-accepted are separate if physical evidence unavailable |

### R0.1 — what it found

The parity register is complete: 14 SamPark rows and 12 School Fees rows now
carry source file, current state, destination, roles and owning phase, with
S-12–S-14 subfeatures named and their deferrals recorded.

Three findings change later tasks:

- **The fee app is at `vpps-one.vercel.app`.** `schoolfees.vercel.app` is a
  different company's product answering 200, and `sampark.vercel.app` errors.
  Both are now refused by `tests/app-origins.test.ts`, and the three real
  origins are re-checkable with `npm run verify:origins` (B-15).
- **There is no staff-reachable test origin for either sibling.** School Fees
  previews do run on schoolfees-dev but sit behind Vercel SSO; SamPark has no
  test deployment at all. R6.2 as written cannot be executed until somebody
  creates one — recorded as a gap, not worked around (B-16).
- **The QA teacher holds no class.** `qa.teacher@qa.vpps.local` has zero
  teaching assignments, so every "teacher" row in the 216-combination smoke is
  a result about an empty teacher. R0.2 has to fix the fixtures before any
  teacher workflow can be said to pass (B-17).

Also: B-06 is five screens, not one — `/collection`, `/assessments/[id]`,
`/timetable`, `/teach/attendance` and `/teach/register` all sort class labels
with `localeCompare` and all ignore the `sort_order` column that already
exists. Baseline for the R7.1 ratchet is **1,293.2 KB of client JS in 37 files**.

### R0.2 — what a working teacher fixture found in the first minute

Nine accounts now, from one list the seeder, the role smoke and `dev:login` all
read; three files used to keep their own copy. The two teaching accounts are
bound to teachers the **published timetable already knows**, chosen by rule
rather than by a name in the repository — most periods, ties by short name, and
the second must share no class with the first. On this data that is a primary
teacher (Classes 1–5, now class teacher of Class 1) and a secondary teacher
(Classes 6–12, now class teacher of Class 7).

Every write records its previous value in `vppsone.qa_undo`, so `qa:reset` puts
back rows the fixture did not create — which it has to, because binding a login
to an existing profile is the only way to give it a day. Proved by running it:
11 steps out, 11 steps back, database identical, then 11 steps out again with
the same two teachers.

**B-21, found and fixed the moment a teacher had a period to render.** The
Today card printed `timetable_slots.period` raw, and that column is 0-based —
so a teacher's first lesson of the day read "0" and her last read "7". Six
other screens each remembered to add one; this one, the screen she opens every
morning, did not. It had been shipping since Phase 3.1 and no test could reach
it, because the only teacher account had no periods at all. `periodNumber()` is
now the only place the off-by-one lives, and `tests/periods.test.ts` refuses
both shapes that caused it.

**B-20 raised, not fixed**: the same card lists 20 rows for an eight-period day,
because a parallel subject taught to five classes at once is five slots and
renders as five lines. The teacher is in one room. How a combined period should
read is R2.1's decision, not a patch in passing.

`dispatch()` now goes through a typed provider adapter. `MESSAGE_PROVIDER=mock`
decides from the destination's last digit — 5 slow, 6 timeout, 7 rate-limited,
8 server error, 9 duplicate with a stable id — and is refused on a live
deployment. Mocked sends carry a `mock:` prefix into
`message_sends.provider_message_id` so they can never be read as real ones.

Still open from this row: a 40-child class and a 1,205-row student list cannot
be fixtured from here, because the roster is the fee app's and rule 2 forbids
writing it (B-18).

### R0.3 — a third reading, and a smoke that can fail

`smoke:roles` was comparing two things that come from the same place: the
permission each page's guard names, and what the map says that implies. A page
asking for the wrong permission agrees with itself.
`tests/fixtures/role-expectations.ts` is the second opinion — 36 routes read
out of PLAN §3 by hand, each with the sentence it comes from. A screen
disagreeing with the map is a failure; the map disagreeing with the plan is a
**drift**, which has to be owned in that file by name or the run fails.

**B-22, found on the first run.** `view_only` holds `attendance:view`, so it
can open the register form, a class's roster, the corrections queue, the
monthly register and a child's card — every one an editable form or a list of
named children, which PLAN §3 gives the viewer neither of. It also puts a Teach
tab on a viewer's bar leading to an empty teacher workspace. Owned by R1.2,
which is where the role navigation lives; `smoke:roles -- --strict` is what
that task turns on when it is resolved.

The runner also fails now, which it could not before: a missing fixture is a
failure rather than a shrug, a hung case has a 20-second deadline, and a run
that executed fewer combinations than it set out to refuses to print a pass.
All three were tried against the broken state before being trusted.

**Two browser journeys** (`npm run smoke:workflows`, Playwright against a
production build). A teacher takes her register — all present, two exceptions,
save, reload, submit again, and the class disappears from Today — with every
step asserted against the rows rather than the toast. The office asks for a
number, finds the draft link answers 404 until it is opened, watches a
nine-digit number leave the Send button disabled with no row written, saves a
real one, re-answers it and sees the replacement in the review queue — the last
part in a browser context with no session at all.

The first teardown was wrong in a way worth keeping: it assumed the register
was the test's own. **A register for today already exists** — the
`open-registers` job opens one per class every morning — so the run left Class
1 submitted and the next one failed with "there is nothing to do today". It
snapshots and restores now.

**B-23 raised**: `Section` renders a bare `<section>` with an `<h2>` inside
and no `aria-labelledby`, so every landmark on every screen is unnamed.

### R1.1 — the way to the other two apps

`src/platform/config/apps.ts` is the registry PLAN §2 asks for: stable ids,
the names staff already use with what each app is *for*, the destination's own
environment, who is offered it, and an allow-list of paths. Two properties do
the work.

**Nothing else in `src/` may write a sibling hostname.** A test scans every
source file outside the two config files for a `vercel.app` host and fails on
a match, because two of the three a reader would guess are wrong and one is a
different company's product (B-15).

**No link carries an id across a dataset boundary.** This app is on
schoolfees-dev and both siblings are on live data, so a student link falls back
to the destination's own search screen instead of a URL that would 404 with a
child's name on it. It flips to a detail link the moment the two sides match,
and a test asserts both halves. SamPark never gets one in either direction: it
keeps its own text ids, and mapping them is R3.1's work (S-10).

`/apps` is guarded on a new `apps:view`, which admin and office hold. Every
card carries **its own** environment badge — both read "live data" while this
app's header reads "test" — because PLAN §2 is explicit that one badge must
not be read as covering all three. Each says a separate sign-in may be needed;
same Supabase project is not a shared cookie and SamPark is a different auth
stack. Ordinary links in the same tab, so Back works.

Both apps also sit on the office and admin home, above the list of screens,
with their hostnames printed.

Still true after this: **`/apps` is not on the office bottom bar.** Office may
open ten screens, the bar holds five, and the shared order leads with Teach and
Cover — which is B-04, and R1.2 owns it. The More hub and the home shortcut
cover it meanwhile.

Dependencies naming a whole phase mean all its required rows. Default order is
the plan sequence; after recording a concrete blocker, independent ready rows
may proceed. Every done row needs branch, delivery commit, evidence and remaining
limitations. Add fix rows rather than deleting historical records.

## Original implementation history

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
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |
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
| 20260917051014 | `create_jobs` | 7.1 |
| 20260917051208 | `create_job_message_templates` | 7.2 |
| 20260917093746 | `create_qa_fixture_runs` | R0.2 |

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
| 7.0 | Passwordless test sign-in, and the two bugs it found | done | `p7-0-sign-in` | | Phases 3–6 all shipped without anybody looking at a signed-in screen. `/auth/confirm` accepts a link Supabase minted, both doors share `admitSignedInUser()`, and `npm run dev:login` issues a one-time link for a `@qa.vpps.local` account — dev only, any other address refused (D-86, D-87). The first pass through it found that the Teach card told every teacher on a good connection that she had no internet (D-88), and that saving a column wrote a "not entered → not entered" log row and an empty marks row for every child the teacher had not reached yet (D-89). Neither was reachable by a probe |
| 7.0b | Fix: `/collection/messages` threw on every load | done | `p7-messages-embed` | | Found by the same sweep as 7.0. `message_sends` points at `staff_profiles` twice — `requested_by` and `staff_profile_id` — so an unqualified embed has no answer and PostgREST refuses the whole select. The screen had been an error card since Phase 5 merged (D-95). `tests/embeds.test.ts` reads the foreign keys out of the migrations and the selects out of the repos and compares them, so the next one is caught before it ships. It was written, seen to pass against the bug, found to be matching nothing because of CRLF, and only then trusted (D-96) |
| 7.1 | Job platform + console | done | `p7-jobs` | | `runJob()` is everything every job has in common, so a job is only the work. **One run at a time is a partial unique index, not a flag** — a lock in memory does not exist when the app is two instances, which on Vercel it always is (D-90). A run that died leaves a `running` row holding that index forever, so stale rows are closed as failures before every attempt. Twice in a day is a skip, not work; the console's button forces it, and only on the second press, after it has told you why (D-91). Two doors in: Vercel's `CRON_SECRET` bearer, or a per-job token that is `HMAC(JOBS_SECRET, job)` — four different tokens, none of them the secret, and a deploy with neither variable set runs nothing at all rather than anything at all (D-92). Every refusal is the same 404 |
| 7.2 | Scheduled jobs | done | `p7-jobs` | | Open today's registers, chase an unsubmitted one, nudge outstanding marks, write the day down. **The two reminders prepare messages and send nothing** — `draft`, staff audience, for the office to send by hand, which is where Phase 5 left every message this app produces (D-10, D-76). Building them turned up that a job which swallows a query error reports a confident zero: "19 classes have no class teacher" was a wrong column name, not a finding, and a second wrong table name was hiding behind the same silence (D-93). Every read now fails loudly. The dedupe is per template, because a teacher nudged about marks has not thereby been asked about her register |
| 7.4 | Production job secrets, and a deep smoke test across every role | done | `p7-smoke` | | `CRON_SECRET` and `JOBS_SECRET` set on Vercel production through the CLI and the deployment redeployed to pick them up — `/api/jobs/*` answers 404 without them and runs the job with them, both verified live. `npm run smoke:roles` opens all 36 screens as all 6 roles and reads the expected answer out of each screen's own guard: **216 combinations, all correct, none throwing** (D-98). Its first run said every role could open everything, which was the test not knowing that a guard firing mid-stream emits a meta refresh rather than a 307 (D-97). `tests/action-guards.test.ts` covers the other door — a Server Action is reachable without its page (D-99). Two real bugs: a Sunday reported 19 registers outstanding (D-101), and a skipped run wrote nothing, so the console could not tell a cron that fired and skipped from one that never fired (D-100) |
| 7.3 | Cutover to live data (PLAN §7) | blocked (Janmejay's call — rule 8) | — | | **Prepared, not done.** It writes to the live fee project and repoints production, which rule 8 makes somebody else's decision. `docs/CUTOVER.md` is the runbook: the six steps, what `expose_vppsone_to_postgrest` does if you skip it, and what rollback does and does not undo. `npm run cutover:check` reads **dev only** and refuses the live ref — it confirms all 34 tables the 15 migrations create exist, that no migration creates anything in `public`, and what master data step 3 has to reproduce for real. Currently green |
