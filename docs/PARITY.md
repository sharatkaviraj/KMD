# SamPark and School Fees — workflow parity register

Completed in **R0.1** on 2026-09-17. Supersedes the 2026-09-17 starting draft;
rows are now mapped to concrete source files, verified destination origins,
destination roles and phase owners. Source inspection is still not a live
functional test — a row only becomes `verified` when the status record at the
bottom of this file is filled in with executed evidence.

`Native partial` means there is related code, not equivalent end-to-end
behaviour. `Link pending` means the original workflow exists and VPPS One has
no verified handoff yet.

Sources inspected at:

| Repo | Path | Commit |
|---|---|---|
| VPPS One | `C:\Users\AnandKumari\Desktop\vppsone` | `1728530` (app code identical to `0712de6`) |
| SamPark | `C:\Users\AnandKumari\Projects\sampark` | `830548c` |
| School Fees | `C:\Users\AnandKumari\Projects\schoolfees` | `48beb9a6` |

## Verified origins — read this before writing any link

Every origin below was resolved from Vercel project metadata under the
`veerpattas-projects` team and then fetched. **Nothing here is remembered from
an older note.** Re-verify with `npm run verify:origins`.

| App | Verified production origin | Identified by | Database |
|---|---|---|---|
| VPPS One | `https://vppsone.vercel.app` | `307 → /login?next=%2F` | schoolfees-dev `wtgxcptmucjerhufzjcf` (`VPPSONE_ENV=dev`) |
| School Fees | `https://vpps-one.vercel.app` | `<title>… \| Fee Admin</title>` | **live** `vgqyilgstjvgohrsiwkb` |
| SamPark | `https://sampark-theta-eight.vercel.app` | `<title>Sign in — Sampark</title>` | **live** Neon (`DATABASE_URL`, Production) |

### Three traps this inventory found

1. **The School Fees app is served at `vpps-one.vercel.app`, not at
   `schoolfees.vercel.app`.** The obvious-looking hostname belongs to an
   unrelated product — `https://schoolfees.vercel.app` answers `200` with
   `<title>Ecolage Desktop</title>` and is not this school's. Linking a staff
   member there would hand a school URL to a stranger's login form.
   `https://sampark.vercel.app` is likewise not ours (it answers `500`).
   The origins table above is the only permitted source of these hostnames.
2. **Both sibling apps are live-data apps; VPPS One is a dev-data app.** There
   is no staff-reachable School Fees or SamPark test origin (see below). So the
   environment badge in VPPS One must never be read as covering a link, and a
   VPPS One **dev** student id must never be interpolated into a **live**
   destination URL — the id will not exist there. Deep links degrade to the
   destination's own search screen unless the environments match (PLAN §2).
3. **School Fees preview deployments exist and do run against schoolfees-dev**
   (`NEXT_PUBLIC_SUPABASE_URL` is `wtgxcptmuc…` for Preview and Development),
   but every preview URL is behind Vercel SSO — probed deployments answer
   `302 → vercel.com/sso-api`. A per-commit URL behind an SSO wall is not a
   staff-usable test destination. This is the R6.2 evidence gap, recorded now
   rather than discovered later.

| Environment question | Answer as of R0.1 | Consequence |
|---|---|---|
| School Fees test origin | None stable and staff-reachable | R6.2 test coverage is blocked on someone creating one; R6.1 links production and labels it |
| SamPark test origin | None (Production Neon only; one preview branch has its own `DATABASE_URL`, no stable alias) | R3 parity is built natively in VPPS One on dev data; the SamPark link is to live |
| VPPS One test origin | `https://vppsone.vercel.app` **is** the test deployment | Badge stays; the badge describes this app only |

## SamPark

VPPS One's native entry is `/collection`; its visible name becomes
**SamPark — Student information** (PLAN §3a). Paths are relative to the SamPark
source repo. SamPark's own IA is six areas: Home, Requests, Review, Marks,
Students, Settings.

| ID | Workflow and source evidence | VPPS One now | Required destination / acceptance | Phase |
|---|---|---|---|---|
| S-01 critical | Token `/r/[token]`, `/t/[token]`, `/w/[token]`; `src/lib/auth/token.ts`, `requests.ts` | **Native partial** — all three paths exist (`src/app/r,t,w`), one class per link | Preserve no-login, scoped roster/fields, resume, confirm/correct, closed/unknown handling; original links stay live | R3 |
| S-02 **met (R3.1)** | Frozen membership and values; `drizzle/schema.ts` `request_students` (`snapshot jsonb`, `roll_no`, `ask_note`), `src/lib/snapshots.ts` | **Native** — `vppsone.collection_request_members` (`roll_no`, `snapshot jsonb`, `ask_note`), written by `freezeMembers()` at creation and read by `rollForRequest()` | Met, and reproduced in the browser before and after. A request with no members is one made before the migration and still falls back to deriving the roll, so an old link renders rather than emptying. `ask_note` has no writer until the R3.2 ask list | R3.1 — closed |
| S-03 **partly met (R3.2)** | Class / house / route / subject / master audiences and filtered gaps; `requests.ts`, `ownership.ts`, `houses.ts`, `routes.ts` (29 bus routes, "No Transport" is an answer) | **Schema and domain, no screen** — `collection_rounds.audience jsonb`, `audience_kind`/`audience_label` on each link, `audience.ts` (`parseAudience`, `groupCount`, `MASTER_AUDIENCE_LABEL`). `class_id` is no longer required, and a class request still needs one by check constraint | Met for classes and gaps: `resolveAudience()` turns an audience into children, `/collection/rounds/new` previews the count before anything is created, and an uploaded list is matched with per-child notes. Still absent: house and route audiences are resolvable but not offered (B-31, B-32), `search` has no box, and subject audiences are not modelled | R3.3 |
| S-04 critical | Custom Excel ask list; `src/lib/ask-list.ts` (`Children` + `Message` sheets, `matchAskList`, `notesFrom`, `messageFrom`), `/requests/bulk`, `api/export/ask-template.xlsx` | **Absent** | ID first, validated SR fallback, **never name matching**; duplicate / ambiguous / unmatched rows previewed before creation; per-row note and whole-sheet message | R3.2 |
| S-05 critical | Bulk teacher round and batches; `/requests/bulk`, `/requests/batch/[id]`, `src/lib/fanout.ts`, `batches.ts` | **Absent** — one request at a time | One operation creates every group's link against frozen membership; a failed fan-out resumes the same batch (unique `(batch_id, audience_kind, audience_label)`) | R3.3 |
| S-06 critical | Master/office link; `src/lib/office.ts` (`OFFICE_TEACHER_ID`, `MASTER_AUDIENCE_KIND`, constant `OFFICE_AUDIENCE_LABEL`), `/settings/office` | **Absent** | One office recipient row and one master link per round; link-local and round-wide completion both correct; master answers count toward the round | R3.3 |
| S-07 critical | Verify/correct, review and precedence; `submissions.ts`, `precedence.ts` (`mayWrite`, `originOf`, `teacherOrigin`, `officeOrigin`), `/review` | **Native** — confirm/change split, bulk confirmations, blank-means-no-change, human-over-import precedence all present (Phase 5.2/5.3) | Add round awareness: old/new value taken from the **snapshot**, not from today's record; a stale review cannot overwrite a newer decision | R3.4 |
| S-08 critical | Progress, reminders, superseding; `progress.ts`, `answered.ts`, `requests.ts` (`reminded_at`, `reminder_count` rolled up with `max`, "today" in Asia/Kolkata) | **Native partial** — per-request completeness only | Expected = answered + outstanding; completed work stays on the board; a chase is a day's work, not a permanent tick; a replacement round does not corrupt the prior one | R3.3–R3.4 |
| S-09 critical | Templates / provider queue / status; `aisensy.ts`, `send-queue.ts`, `whatsapp-send.ts`, `whatsapp-templates.ts`, `/settings/whatsapp` | **Native partial** — templates and drafts exist; `mayDispatch()` refuses parent-facing rows; no provider key in this repo | Preview the frozen recipient and reason; mock success / 429 / 500 / timeout / duplicate callback and retry; a successful send never repeats; **no real dispatch in QA** | R3.4 |
| S-10 critical | Student directory, detail, health, sources; `/students`, `/students/[id]`, `/students/health`, `student-filters.ts`, `data-health.ts`, `student-provenance.ts`, `student-timeline.ts` | **Native partial (R2.3)** — `/students` searches name, father, SR and phone with class and session scope, URL-backed and paged in Postgres; the card shows each value source and a fee context link | Still absent: identity/source **health**, provenance history and an editable approved overlay. The detail screen also still lives at `/teach/student/[id]` | R2.3 done · R4.1 for the rest |
| S-11 critical | Photo capture and bulk workflow; `photos.ts`, `photo-store.ts`, `photo-filename.ts` (`matchFilename`, `placeFiles`), `photo-health.ts`, `api/r/[token]/photo` | **Absent** — generic document upload only; SOURCES records photos as not ported | Camera/file selection, retake/replace, owner mapping, progress, missing-photo view and office batch placement by filename | R4.2 |
| S-12 | Student import and conflict review; `/students/import`, `students-import.ts` (`suggestColumnMap`, `buildPreview`, `planRows`, `applyPreview`, `matchByIdOrSr`, `parseIndianDate`), `import-plan.ts` | **Not equivalent** — `/enrolments` rebuilds the academic roll from `public.students`; it is not a spreadsheet import | **Required subfeatures:** column mapping suggestion; dry-run preview; ID-then-SR matching; per-row errors; Indian date parsing; source precedence on apply; resumable/committed job record. **Deferred:** creating new students (fee app owns the roster) | R4.1 |
| S-13 | Workbook / CSV export; `excel.ts` (`buildWorkbook`, `safeSheetName`, `uniqueSheetName`, `parseTabularFile`, `looksLikeHtml`, `excelSerialToDate`), `student-export.ts`, `api/export/*` | **Not equivalent** — academic CSV only (Phase 6.5) | **Required subfeatures:** multi-sheet workbook for student and round exports; Hindi text intact; blank vs zero vs "Absent" preserved; leading-zero SR preserved; row count reconciles with the on-screen count; `.xlsx` **and** HTML-table upload accepted on import. **Deferred:** embedding photographs in the workbook (needs S-11 first) | R4.3 |
| S-14 | Marks, subjects, progress, settings/users/audit; `/marks`, `/marks/grid`, `/settings/{fields,subjects,teachers,users,office,whatsapp,audit}`, `marks.ts`, `activity.ts` | **Overlaps** — VPPS One has assessments (Phase 6), staff (1.3), subjects (1.4), collection fields (5.1) | **Required subfeatures:** period/subject-scoped marks collected *through a request* map onto native assessments, never a second ledger; field registry; teacher roster; office recipient; audit/activity feed. **Deferred with a link:** SamPark's own user accounts and its own audit log stay in SamPark | R0 / R4.3 / R5 |

Completing R3 means S-01–S-09 **behave**, not that route names exist. A
deliberate difference needs a recorded reason, a destination and a test.

## School Fees

Default plan: preserve every workflow in the original app and provide verified
access. **No native financial rebuilding is claimed and no fee write is
introduced.** The fee app's own IA is nine tabs
(`src/platform/config/navigation.ts`), and its roles are `admin`,
`accountant`, `teacher`, `fee_collector`, `view_only` — a different set from
VPPS One's six. A launcher never grants a fee role; the destination decides.

Destination origin for every row below: `https://vpps-one.vercel.app`
(production, live fee data). Deep links carry a student id **only** when the
VPPS One environment matches the destination's, which today it does not — so
R6.1 ships tab links plus the fee app's own search, not id-bearing URLs.

| ID | Original route / workflow | Fee tab · permission | Current VPPS One | Required handoff / validation |
|---|---|---|---|---|
| F-01 critical | `/protected/dashboard`; `/protected/students`, `/students/[id]`, `/students/[id]/edit`, `/students/new` | Dashboard · `dashboard:view`; Students · `students:view` | **Home shortcut and `/apps` linked (R1.1)**; fee standing on the teacher student card | Directory/detail context link when ids match; **search fallback otherwise** — the builder exists and is tested, the screen that renders it is R2.3 |
| F-02 critical | `/protected/payments`, `/payments/bulk`, alias `/protected/collections` | Payment Desk · `payments:view` | Link pending | "Payment Desk" entry from office/admin home and `/apps`; sign-in and return path tested; receipt path exercised only in a fee sandbox |
| F-03 critical | `/protected/receipts`, `/receipts/[receiptId]`, `/protected/transactions`, `/protected/ledger` | Transactions · `receipts:view` (aliases `/dues`, `/receipts`, `/ledger`) | Link pending | Receipts/Transactions entries; print, correction/reversal and repeated-submit behaviour **only** in a sandbox |
| F-04 critical | `/protected/dues`, `/protected/defaulters`, `/admin-tools/prev-year-dues` | Transactions (alias) · `receipts:view`; Defaulters · `defaulters:view` | Read-only student summary only | Dues/Defaulters entry with session context; balances reconcile with the fee app's own view; **late-fee-only is not a defaulter** and fees and late fees are never summed |
| F-05 critical | `/protected/fee-setup`, `/fee-setup/generate`, `/fee-setup/time-travel`, `/protected/fee-structure`, `/protected/master-data` | Fee Setup · `fees:view`; School Lists → Admin Tools · `finance:view` | Link pending | Setup/generate/master destinations; staff keep the original workflow and its role checks |
| F-06 critical | Student leave date, concessions, write-offs, installment generator (student detail + `/protected/finance-controls`) | Students · `students:view`; Day Close & Corrections → Admin Tools · `finance:view` | No native writes by design | Student detail handoff; cash vs concession vs write-off stay distinct; **a write-off is not a collection** |
| F-07 critical | `/protected/reminders`, `/reminders/campaigns`, `/reminders/lists`, `/reminders/unreachable`, `/reminders/runs/[runId]`, `/admin-tools/whatsapp` | Reminders · `settings:view`, visible to `admin`+`accountant` only | VPPS One collection messaging is a different thing and must not be presented as fee reminders | Explicit "Fee reminders" entry; audience, family grouping, cadence/snooze/no-call and retry validated against mocks in a sandbox |
| F-08 | `/protected/imports`, `/protected/exports`, `/protected/students/bulk-update` | Exports · `reports:view`; Import History → Admin Tools | Link pending | Data-tools destinations; workbook/CSV round trip only in a fee test environment |
| F-09 | `/protected/reports`, `/reports/ledger/[studentId]/print`, `/students/[id]/statement`, `/students/family/[familyGroupId]/statement` | Reports → Transactions · `receipts:view` | Academic reports are a separate thing | Fee reports/statements links; financial scope and print output verified in a sandbox |
| F-10 | `/protected/master-data`, family groups, `/admin-tools/promotion`, `/admin-tools/promotion/[runId]`, `/admin-tools/session-health` | Admin Tools · `finance:view` | No native fee controls | Explicit grouped paths; session and leave/transport rules stay the fee app's |
| F-11 | `/protected/finance-controls`, `/protected/settings`, `/settings/glossary`, `/protected/staff`, `/protected/password`, `/admin-tools/recovery`, `/admin-tools/activity` | Admin Tools · `finance:view`; staff/settings gated further | VPPS One has its own staff and jobs | Grouped advanced destinations; make it visible that fee accounts are **separate accounts** from VPPS One accounts |
| F-12 | Public `/r/[code]`, `/pay/[code]` | Public, no session | No replacement | Preserve the original links untouched. **Do not** route these to VPPS One's `/r/[token]`, which is a different token space entirely; only routing and test-provider behaviour may be checked, in a sandbox |

R6 owns these handoffs. Never report "fees tested" because a login page
returned 200.

## Baseline defect register

Carried forward from `QA-BASELINE-2026-09-17.md` and extended by R0.1. A
`source` finding has not been reproduced at runtime and is not reported as a
failure until it is.

| ID | Sev | Status after R0.1 | Finding | Owner |
|---|---|---|---|---|
| B-01 | P1 | **fixed in R1.1** | No School Fees or SamPark destination anywhere in VPPS One; `navigation.ts` had no app registry. Closed by `src/platform/config/apps.ts`, `/apps`, and the office/admin home shortcuts | R1.1 — closed |
| B-02 | P1 | **partly fixed in R3.1** — schema exists, no screen writes it | `vppsone.collection_rounds`, `round_id`, `audience_kind`/`audience_label` and `collection_request_members` all exist, and `audience.ts` is the domain for them. Every request made today is still a single class: the wizard that creates a round is R3.2 and the fan-out that mints its links is R3.3 | R3.2–R3.3 |
| B-03 | P2 | **fixed in R1.2 and R2.2** | `/dashboard` renders the profile card plus a link list for **all six roles** (`src/app/(app)/dashboard/page.tsx`, 109 lines); no operational priorities anywhere | R1.2 / R2 |
| B-04 | P2 | **fixed in R1.2** | One shared nav order for every role; office-style work reached Collection through More. `NAV_PRIORITY` gives each role PLAN §3's own order | R1.2 — closed |
| B-05 | P2 | **fixed in R1.3** | `requestSchema` makes `titleHi` **and** `titleEn` `.min(1)` — a one-language school cannot create a request without typing both | R1.3 / R3.2 |
| B-06 | P2 | **fixed in R1.3** | Class labels were sorted as text on **four** screens (not five — `/timetable` sorts staff names, which is right): `/collection`, `/assessments/[id]`, `/teach/attendance`, `/teach/register`. All four ignored a `sort_order` that already existed on `public.classes` and `vppsone.class_aliases`. `classLabelMap()` is built in school order now | R1.3 — closed |
| B-07 | P1 | **reproduced and fixed in R3.1** | Confirmed at schema level in R0.1, then reproduced in the browser: with the members deleted, moving a child off a class removed them from an open link and an office correction replaced the value the teacher had been shown. `collection_request_members` freezes both at issue; `tests/e2e/collection-freeze.spec.ts` asserts the fix **and** reproduces the old behaviour as its control | R3.1 — closed |
| B-08 | P1 | **confirmed** | Photo capture and workbook export absent (S-11, S-13) | R4 |
| B-09 | P1 | **confirmed** | `smoke-roles.mjs` reads each page's own guard for the expected answer, so a wrong guard agrees with itself | R0.3 |
| B-10 | P1 | **confirmed** | `fillIds` may return `null`; the loop continues with no failure, so a partial suite can exit 0 | R0.3 |
| B-11 | P2 | **confirmed** | Teacher navigation has no request workspace although `/t/[token]` exists | R2.1 / R3.3 |
| B-12 | P1 | source (unreproduced) | Attendance queue keeps memory only on storage failure; `parseQueue` accepts any object | R5.1 |
| B-13 | P1 | source (unreproduced) | Timetable publish and correction approval are sequential writes with known interruption windows | R5.1 / R5.2 |
| B-14 | P2 | **partly fixed in R1.3** — rendering fixed, the form half is R3.2 | `reasonHi`/`reasonEn` are independent nullable columns with no fallback rule, so a Hindi reader can be shown English silently | R3.2 |
| **B-15** | **P1** | **new in R0.1** | **`https://schoolfees.vercel.app` is not this school's app** (`Ecolage Desktop`) and `https://sampark.vercel.app` errors. Any link written from memory rather than from the verified-origins table above sends staff to a stranger's site | R1.1 |
| **B-16** | **P1** | **new in R0.1** | **No staff-reachable School Fees or SamPark test origin exists.** Fee previews run on schoolfees-dev but sit behind Vercel SSO (`302 → vercel.com/sso-api`). R6.2 cannot be executed as specified | R6.2 (gap) |
| **B-17** | **P1** | **new in R0.1** | **The QA teacher account cannot exercise a teacher's day.** `qa.teacher@qa.vpps.local` has 0 `teaching_assignments` and is class teacher of nothing; the only account holding a class is `raj@vpps.co.in` (admin). There is no second teacher, no inactive account and no unassigned-teacher account | R0.2 |
| **B-18** | **P2** | **new in R0.1** | **Large-list coverage is impossible with current data.** The dev database holds 139 students in 19 classes; `QA.md` requires ≥1,205 rows. `vppsone.enrolments.student_id` has no FK into `public.students` (rule 2), so synthetic rows are creatable — but they will surface on `/enrolments` as "vanished students" unless the fixture marks them | R0.2 |
| **B-19** | **P2** | **new in R0.1** | VPPS One deep links cannot carry a student id to either sibling app, because VPPS One runs on dev data and both siblings run on live data. Recorded before R1.1 designs the registry so the fallback is designed in, not bolted on | R1.1 |
| **B-20** | **P2** | **new in R0.2; fixed in R2.1** | **The teacher Today card listed 20 rows for an eight-period day.** A parallel subject taught to Classes 1–5 at once is one timetable slot per class, so period 3 rendered as five lines and the teacher was told she was in five rooms. `lessonsToday()` groups by period and subject; a combined lesson is one row carrying its classes, and a clash stays two rows | R2.1 — closed |
| **B-25** | **P2** | **new in R2.1; fixed in R2.1** | **`classRoll(classId, sessionLabel)` was two strings in a row**, so passing them the other way round typechecked and failed at Postgres with `invalid input syntax for type uuid`, rendering an error card on the teacher home. It takes a named object now, at all seven call sites | R2.1 — closed |
| **B-22** | **P2** | **new in R0.3; fixed in R1.2** | **`view_only` reached six screens PLAN §3 denies it.** It held `attendance:view`, which guards `/teach`, `/teach/attendance`, `/teach/class/[id]`, `/teach/corrections`, `/teach/register` and `/teach/student/[id]` — editable forms and lists of named children. The permission is removed; `smoke:roles` now runs `--strict` with 0 drift | R1.2 — closed |
| **B-24** | **P2** | **new in R1.3; fixed in R1.3** | **The `PageHeader` back link was a 20px target.** The smallest in the app, on the screen a teacher opens most, reached with a thumb while holding a register. Found by the new phone baseline at 360px; now 44px tall | R1.3 — closed |
| **B-23** | **P3** | **new in R0.3; fixed in R1.3** | The `Section` primitive rendered `<section>` with an `<h2>` inside and no `aria-labelledby`, so every landmark on every screen had no accessible name. It points at its own heading now | R1.3 — closed |
| **B-26** | **P1** | **new in R3.1; fixed in R3.1** | **`/collection` threw for every role.** Adding `sent_by` and `reminded_by` gave `collection_requests` three foreign keys to `staff_profiles`, so PostgREST refused the unnamed embed and the whole select failed. Named in `requests-repo.ts` and `submissions-repo.ts`. `tests/embeds.test.ts` exists to catch exactly this and stayed green, because it read foreign keys out of `create table` blocks only — it reads `alter table` too now | R3.1 — closed |
| **B-27** | **P3** | **new in R3.1; fixed in R3.1** | **A source-scanning test passed in CI and failed locally.** `tests/directory.test.ts` matched within a 600-character window against a file checked out CRLF on Windows, so the same code measured longer here than on the runner. It normalises now, as `embeds.test.ts` already did | R3.1 — closed |
| **B-28** | **P2** | **new in R3.2; fixed in R3.2** | **"1 कक्षाओं में"** — a plural Hindi noun on a singular number, on the count the office reads before deciding whether to send. Obvious to every Hindi speaker in the school and invisible to anybody reviewing in English, which is why it shipped where "1 children" would not have. `counted()` in `language.ts` now agrees the noun with the number in both halves | R3.2 — closed |
| **B-29** | **P2** | **new in R3.2; fixed in R3.2** | **A 16px link on the round builder**, found by the phone baseline — the same defect class as B-24's 20px back link. Removed rather than enlarged: the page already has a 44px back link to the same place, and a second one too small to tap is worse than not having it | R3.2 — closed |
| **B-30** | **P3** | **new in R3.2; fixed in R3.2** | The ask-list match report ran together as text — "पंक्ति 4NOPE-404Somebody Missing" — because the parts were separated by a margin. A margin separates pixels; a screen reader and a copy-paste into the message to whoever fixes the sheet both read the text | R3.2 — closed |
| **B-33** | **P1** | **new in R3.2; fixed in R3.2** | **A gap filter narrowed a frozen list.** A round carrying an explicit `studentIds` list still had the house, route, search and gap filters applied on top of it, so a list frozen from a gap selection and re-resolved days later — after some of those gaps had been filled in — quietly covered a smaller set than the list it was frozen from. Precisely the nondeterminism freezing exists to remove. Found by reviewing the resolver, because nothing would have failed loudly; the journey now builds that exact shape and fails without the fix | R3.2 — closed |
| **B-31** | **P2** | **new in R3.2** | **House and route audiences cannot be demonstrated on dev data.** `public.students.house`, `transport_route_id` and `village_city` all exist and are **empty for all 139 rows**, and rule 2 forbids writing them. The resolver handles both dimensions; the builder offers no chips for them, because a filter that could only ever return nobody is a lie on screen. Same shape as B-18 | R3.3 (gap) |
| **B-32** | **P1** | **new in R3.2** | **Nothing in VPPS One holds house or route ownership.** `vppsone.class_teachers` covers classes; `staff_profiles` has no equivalent columns and there is no scope table, so a house or route round has no recipient to fan out to. SamPark carries `teacher.houses`/`teacher.routes`. A schema decision R3.3 has to take before S-03 can be finished | R3.3 |
| **B-21** | **P2** | **new in R0.2; fixed in R0.2** | **The Today card called a teacher's first lesson "Period 0".** `timetable_slots.period` is 0-based and the badge printed it raw; six other render sites each added one by hand. Shipping since Phase 3.1, unreachable by any test because no teacher account had a period. Fixed with `periodNumber()` and `tests/periods.test.ts` | R0.2 — closed |

## Baseline metrics (R0.1, 2026-09-17)

Repeat before/after measurements with the same command on the same machine.

| Measurement | Value | Command |
|---|---|---|
| Unit suite | 28 files, **1,904 tests passed**, 0 failed, 0 skipped, 22.5 s | `npm run test` |
| Full check | exit 0 (typegen, typecheck, lint, test, production build) | `npm run check` |
| Role × page smoke | see `docs/evidence/` for the dated run | `npm run smoke:roles` |
| Deployed commit | `1728530`, `dpl_aV6JcLjAp3WrQJfN7CEHuQxJCxeu`, alias `vppsone.vercel.app` | `npx vercel inspect https://vppsone.vercel.app` |
| Dev dataset | 139 fee students · 19 classes · 27 staff (7 with logins) · 1,038 timetable slots · 49 registers · 2 assessments · 105 marks · 1 collection request | SQL, `wtgxcptmucjerhufzjcf` |
| Route JS baseline | recorded in `docs/evidence/` from the same build, for the R7.1 ratchet | `npm run build` |

## Required status record for each implemented row

Append a per-row record with: ID/subflow; native/linked/deferred; source commit;
destination path/origin/environment; allowed and denied roles; dataset/run ID;
positive/negative/recovery test IDs; result; evidence path; delivery commit;
remaining gap. Exact live origins are never guessed from older notes — they come
from the verified-origins table, which `npm run verify:origins` re-checks.

Critical parity cannot pass on a placeholder, a hidden button, an unexplained
permission denial, a broken deep link, a duplicate ledger or source-only
inspection.

### Records

| Row | Kind | Destination | Roles allowed / denied | Evidence | Delivery | Gap |
|---|---|---|---|---|---|---|
| F-01 home | linked | `https://vpps-one.vercel.app/protected/dashboard` (live) | admin, office / everyone else refused at `apps:view` | `docs/evidence/R1.1-2026-09-17.md`; browser at 375x812; `npm run verify:origins` | R1.1 | No fee workflow exercised; R6.2 still needs a staff-reachable fee test origin (B-16) |
| S-10 link | linked | `https://sampark-theta-eight.vercel.app/` (live) | admin, office / everyone else refused | same | R1.1 · R3.1 | Search in practice. `vppsone.external_student_ids` and `/students/<id>` exist (R3.1), so a deep link is emitted the moment a mapping row applies to the dataset being read — no row does yet; the matcher is R4.1 |
| F-01 context | built, not yet rendered | `/protected/students?query=...`, or `/protected/students/<uuid>` when the datasets match | n/a | `tests/apps.test.ts` | R1.1 | No screen calls it until the student summary in R2.3 |
