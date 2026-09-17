# VPPS One — implementation plan, revision 2

Updated 2026-09-17. **Active plan. Start at R0.1 in `PROGRESS.md`.**
The original implementation is recorded as Phases 1–7 in `PROGRESS.md` and its
plan is preserved in `archive/PLAN-v1-2026-09-16.md`. Completed original rows
describe the first delivery, not complete SamPark or School Fees parity.

This revision delivers planning and baseline evidence. **R0–R8 are not yet
implemented.** Read `PARITY.md`, `QA.md`, `QA-BASELINE-2026-09-17.md` and
`prompts/kickoff.md` alongside this document.

## 1. Outcome, scope and success

Teachers should open their day's work immediately. Office staff should find a
student, collect missing information and reach the payment desk without knowing
which technical module owns the task. Administrators should see work needing
attention and who is responsible. Existing SamPark and School Fees workflows
must remain findable and usable while VPPS One improves.

**Working interpretation:** retain both original apps at their existing repos
and deployments, expose them explicitly in VPPS One, and complete the native
SamPark collection experience incrementally. School Fees remains the place for
fee operations. This preserves the existing architecture and the user's request
that the apps remain where they were. It is an assumption, not a recorded reply
to the clarification question. If native fee rebuilding is selected instead,
use the alternative in §9 before implementing fee writes.

| Goal | Proposed release target | Evidence |
|---|---|---|
| Preserve existing work | Every `PARITY.md` row has a native, linked or explicitly deferred destination; critical workflows cannot be deferred | Source/destination walkthrough with exact roles and routes |
| Obvious first action | Teacher reaches today's attendance in ≤2 taps after login; office opens SamPark or School Fees in 1 tap from home | Fresh-login browser traces |
| Role-specific homes | All six existing roles see task priorities appropriate to their work | Independent role expectations, assertions and screenshots |
| Easy routine work | 40-child attendance with 3 absences in <90 seconds; filtered request batch prepared in <2 minutes | Proposed usability targets; timed nontechnical staff trials |
| Trustworthy saves | Editing, saving, saved, queued and failed are distinct; reload/retry does not duplicate effects | Interrupted request, expired login, two-tab and recovery tests |
| Responsive performance | Aim for p75 LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 when sufficient field samples exist | Route/role/device cohorts; repeatable lab proxies until field evidence exists |
| Release quality | Zero open P0/P1 defects; positive, negative and recovery coverage for changed workflows | QA matrix, defect register and release report |

Use current architecture and business logic. Test rows in the configured dev
database may be created, edited and reset for reproducible testing. Keep normal
role/class rules because they define each account's work; do not add an
enterprise security program. Mock provider sends: test student data does not
make recipient phones, messaging providers or payment services test systems.

This revision does not retire original apps, cut over to live data, introduce
parent accounts, require AI for ordinary tasks or rewrite into microservices.
Sibling apps are read-only references in this task. A launcher does not imply
that the linked application's UI has also been redesigned.

## 2. Architecture and ownership

Inspected source: VPPS One `0712de6`, SamPark `830548c`, School Fees `48beb9a6`.
Recheck at kickoff. Installed baseline: Next.js **16.3.5**, React **19.2.8**,
Tailwind **4**, TypeScript, Supabase and Vitest.

| Area | Owner / decision |
|---|---|
| VPPS One | `C:\Users\AnandKumari\Desktop\vppsone`, `veerpatta/vppsone`, Vercel `vppsone.vercel.app` |
| School Fees | `C:\Users\AnandKumari\Projects\schoolfees`; retains original app, fee tables and financial rules |
| SamPark | `C:\Users\AnandKumari\Projects\sampark`; retains original app; source for full collection workflows |
| Test backend | `schoolfees-dev`, ref `wtgxcptmucjerhufzjcf`; new objects in `vppsone` schema |
| Shared data | `public` fee/student/session tables are SELECT-only from VPPS One |
| Collection | Accepted values in `vppsone.student_records`, with source and review history |
| Authentication | Existing Supabase Auth, roles in `vppsone.staff_profiles`; SamPark keeps its separate auth |
| Files | Existing Supabase Storage; port file behavior, not sibling credentials |
| Messaging | Typed provider adapter with success/failure/rate-limit mock; staff initiate sends |

### App integration contract

Create a typed registry with stable IDs `vppsone`, `sampark`, `schoolfees`, names,
environment, origin, visibility and validated route builders. Verify original
and test origins from actual project metadata/config before adding them. Do not
turn a remembered live URL into a supposed test destination.

Expose **SamPark** and **School Fees** on eligible homes and an `/apps` hub. Use
normal links with explicit external-app/environment labels and retain familiar
names and original URLs. Default navigation supports browser Back; optionally
offer an explicit new-tab action. Avoid iframes and a reverse proxy for another
Next.js application. Same Supabase accounts do not mean cross-domain cookies
are shared; SamPark uses a different auth stack. Test sign-in and return paths
without promising seamless SSO.

Context links carry supported stable IDs and session context, never auth tokens.
If a test student's ID does not exist in the destination environment, open its
search screen instead of a broken detail link. The VPPS One test badge must not
imply that a linked live app is also test-only. A launcher does not grant a fee
role; the destination still decides access.

### Student identity and data projection

Original data, approved collection corrections and pending proposals need clear
source labels. Build one projection shared by lists, detail, requests and
exports. An approved overlay must not appear to have changed School Fees.
Map SamPark IDs to fee UUIDs explicitly: source ID first, validated SR/admission
number fallback, never silent name matching. Ambiguous/unmatched rows require
visible resolution. Freeze request membership and values when issuing a round.

## 3. Account experiences

Use existing roles; make navigation priority role-specific while deriving
visibility and actions from the permission map. Combined teacher/coordinator
work needs explicit assignment/capability handling, not admin as a workaround.
A multi-role schema is a separate decision if existing assignment logic cannot
support the actual staff roster.

| Account | First screen and primary work | Navigation / supporting content |
|---|---|---|
| Teacher | `/teach` Home: next period, attendance, assigned requests, marks due; one prominent next action | Today, My classes, Timetable, Requests, More. Own classes, cover, due dates and queued saves; no office request builder or fee cards |
| Admin | `/dashboard`: exceptions with counts and owners, student search, SamPark and School Fees shortcuts | Home, Students, SamPark, Apps, More. Attendance gaps, uncovered periods, review/marks backlog, failed jobs; setup below daily work |
| Office | `/dashboard`: student search, changes to review, request batches, documents, attendance on behalf and School Fees | Home, Students, SamPark, Apps, More. Payment Desk opens fee app; completion board and retryable exports |
| Academic coordinator | `/dashboard`: uncovered periods, timetable changes, absent staff and class attendance gaps | Home, Cover, Timetable, Classes, More. Draft/published plan state and explanations for blocked candidates |
| Exam coordinator | `/dashboard`: exams in progress, incomplete papers by teacher, anomalies and report readiness | Home, Exams, Marks, Reports, More. Reminder drafts, lock/unlock history, issued report versions |
| View only | `/dashboard`: school summary, attendance completion and timetable | Home, Timetable, Summary. Read-only information; no editable forms or per-child actions |
| Token-link teacher | Existing `/r`, `/t`, `/w`; no login; requested children/fields only | Purpose, due date, progress, next unfinished child, confirm/correct and requested photo capture; no full app shell |
| Fee accountant/admin | Original School Fees account after handoff | Payment desk, dues, receipts, transactions, reminders and reports in established routes; no new VPPS One accountant role |

New tab names are **proposed destinations**, not existing routes. R1/R2 map and
implement them before revealing navigation. Preserve bookmarks and query state.
There is one Home per role, also used by the school-name link. Desktop gets
grouped sidebar navigation and useful table width rather than the phone's
first-four-items-plus-More limit.

### 3a. Language and design direction

Preserve `hi`, `en`, `both` and the signed-out language cookie. Add self-service
language choice. Use the existing message catalog and language helpers. Let
user-authored titles/reasons use the author's language with optional translation
and an explicit fallback; routine requests must not require two typed titles.

Use **SamPark — Student information** and **School Fees — Payments and dues**
to distinguish tasks. Prefer verbs: Create request, Review changes, Mark
attendance, Save marks, Try again. Technical schema/job/sync details belong in
diagnostics, not ordinary forms.

Keep the current calm warm-accent palette with light background, white surfaces,
readable dark type, clear spacing and one primary action color. Status uses text
and icon as well as color. Avoid decorative charts, glass effects and hover-only
controls. Modern means understandable and responsive, not more decoration.

- Body/form text around 16px; comfortable Hindi line height; aligned numeric
  columns. Wrap long names and important reasons rather than truncating them.
- Phone: 360/390/430px, single-column tasks, primary targets ≥44px (prefer 48px),
  ≤5 labeled bottom tabs, sticky save with keyboard and safe-area space.
- Desktop: 1280/1440px, useful table density, sticky headings, filters beside
  search, keyboard entry and detail panels only when they reduce navigation.
- Request wizard: purpose → audience → questions → preview. URL-backed filters,
  removable chips, selected count and preserved Back/scroll state.
- Shared student summary: name, class, SR, photo/fallback and task state. Add a
  real searchable directory instead of forcing access through attendance.
- Distinguish no results, holiday, no assignment, completed, unavailable and
  failed-to-load; each gets a suitable next action.
- Retain inputs after errors, focus the first invalid field, announce saves,
  support keyboard/screen readers, 200% zoom and reduced motion. Fixed bars must
  not obscure fields or the final row.

```text
TEACHER / PHONE                 OFFICE / DESKTOP
Today · Thu 17 Sep              Home Students SamPark Apps More
Next: Class 5 English · P2      Find student [name / SR / phone...]
[Mark Class 1 attendance]       [School Fees] [SamPark]
Needs doing                    Needs attention          Owner
  1 attendance register        8 changes to review       Office
  9 request answers            2 overdue requests        Teachers
  1 marks paper                1 failed export           Retry
Today's periods                Recent work / Continue
Saved / waiting to upload      Setup below daily work
```

## 4. Developer techniques and data changes

Keep `src/modules/<feature>/{domain,data,ui}`, existing primitives and server
actions. Read installed Next.js guides in `node_modules/next/dist/docs/` before
changing framework behavior. Add libraries only for a demonstrated need.

| Technique | Use | Verification |
|---|---|---|
| Server Components, small client islands | Server-read summaries; interactive forms/filters on client | Measure route JS; do not ship whole school datasets to every screen |
| Parallel reads and streaming | Independent dashboard widgets and lookup data | Authorize first; loading/error states per section; errors never become zero |
| Request deduplication | Staff, session, shared lookup reads | Inspect existing request cache before adding infrastructure |
| Explicit cache scope/invalidation | Stable subjects/classes/published timetable | Session/visibility keys; revalidate on writes; test role/language changes; no global cached sessions |
| SQL aggregates and pagination | Counts, student search, review queues | Query plans on dev, selected columns, stable ordering; >1,000-row fixtures |
| Lazy large dependencies | Excel parse/export, camera helpers, advanced visualization | Load on relevant task only; compare initial route bundles |
| Progressive forms | Pending/validation/retry; optimistic reversible edits | Zod/server rules remain authoritative; explicit rollback on failure |
| Atomic transitions | Publish timetable/cover, approve corrections/review, save marks | One transaction/RPC for related writes, versions, constraints and idempotency; interruption tests |
| Durable drafts | Attendance first, request answers next | Versioned validated payload; account/session/record keys; visible storage failure and replay rules |
| Background batch work | Imports, photos, exports | Persist job/item outcomes; bounded chunks/concurrency; retry/cancel without restarting successes |
| Typed adapters | Fee read model, app links, provider | Uniform error states, mock provider, no raw schema logic in UI |
| Task diagnostics | Save latency, failed jobs, retries, stale data | Correlation IDs and structured events without tokens; useful admin recovery actions |

R3 adds collection rounds, frozen membership/value snapshots, recipient groups,
per-child notes and source identity mapping where existing tables cannot model
them. Unique round/request/member keys make retries harmless. R4 adds file
versions/import job outcomes as needed. R5 adds mutation versions and atomic RPCs.

Migration sequence: inspect → write additive migration → apply to dev through
existing Supabase MCP workflow → save actual recorded version in filename →
regenerate types as needed → test constraints/backfill/replay → update docs.
Do not repair shared fee migration history to make `supabase db push` succeed.
Prefer expand/backfill/validate/contract and keep old requests readable.

## 5. Phased execution

Order: **R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8**. Each progress row is
a bounded task, normally one PR. Continue from the current app; do not rebuild
completed foundations. Each phase produces code, fixture coverage, evidence and
an updated progress/parity record before it is called done.

### R0 — reconcile parity and establish trustworthy QA

**Tasks R0.1–R0.3.** Finish source-to-destination inventory in `PARITY.md`, verify
origins, record deliberate deviations and current metrics. Build deterministic
fixtures for all roles, assignments, edge states, large lists and mock provider.
Create independent product-role expectations. Retain `smoke:roles` as an extra
consistency check; make missing fixtures fail, add per-case timeout/timing and
machine-readable results. Automate one teacher and one office workflow first.

**Gate:** critical parity rows mapped; reproducible defect register; fixture
reset and retry verified; expected and executed counts agree. **Recovery:**
fixtures removable by run ID; QA tools revert independently; no sibling changes.

### R1 — app access and navigation

**Tasks R1.1–R1.3.** Implement app registry, `/apps`, validated environment-aware
deep links, familiar names, role home resolver and role-priority navigation.
Put both original apps on office/admin home immediately. Keep `/collection` as
the native SamPark workspace with an explicitly labelled original-app link.
Create directory/preferences entry points and consistent component states.

**Gate:** no orphan/404 links; bookmarks work; six menus pass mobile/desktop;
external sign-in/return paths tested without assuming SSO. **Recovery:** revert
registry/navigation/resolver together; preserve module routes.

### R2 — useful homes and student workspace

**Tasks R2.1–R2.3.** Teacher Today gets real priority counts and assigned requests.
Office/admin get work queues with owner and due state. Academic, exam and viewer
homes get their own priorities. Add shared directory and student summary,
preserving search/session/scroll state. Show fee summaries only to eligible
roles through the authoritative read model and context links.

**Gate:** §1 first-action targets; no invented counts; holiday/no-assignment/
completed/error states differ; role/language switch refreshes correctly.
**Recovery:** revert widgets without removing task pages; retain route aliases.

### R3 — SamPark requests and review parity

**Tasks R3.1–R3.4.** Port class/house/route/filtered/explicit-list audiences,
frozen rounds, requested value snapshots and per-child notes. Excel ask lists
match ID then SR; preview missing/duplicate/ambiguous rows before creation.
Build purpose/audience/fields/preview wizard, one batch across teachers, master
link, office recipient and completion board. Teacher links resume unfinished work.

Keep verify/correct, blank-means-no-change, confirmation versus change, source
precedence and round-wide superseding. Approvals update the VPPS One overlay.
Preserve period/subject scope for marks and one-off questions; use assessments
where appropriate rather than a second marks ledger. Draft sends carry frozen
recipients and reasons; interrupted fan-out resumes without a second round.

**Gate:** critical S-01–S-09 parity; master/teacher totals agree; enrolment edits
after issue cannot silently change membership; Hindi reasons work; duplicate
retry has one effect. **Recovery:** additive schema, legacy adapter and versioned
rounds keep old links readable; pause creation if backfill validation fails.

### R4 — student data, documents, photos and imports

**Tasks R4.1–R4.3.** Restore identity/source health, photo capture/retake/replace,
ID-aware bulk filename matching, class completion and office-assisted capture.
Imports need preview, row errors, downloadable corrections and resumable jobs.
Restore workbooks where multiple sheets, photos or formatting are expected;
retain CSV for simple data.

**Gate:** required S-10–S-14 parity; correct child/photo association, image
orientation, large files, cancellation/retry, Hindi workbook and ambiguous IDs.
**Recovery:** keep previous file version until new metadata/file pair is proven;
retry failed items without discarding successful work.

### R5 — academic usability and save reliability

**Tasks R5.1–R5.3.** Attendance: mark-all-present then exceptions, search, clear
saved/queued state, on-behalf and corrections. Timetable/cover: current/next
period, filters, clash/block explanations, obvious draft/publish. Marks: quick
entry, paste preview, keyboard support, missing/absent/zero distinction and
history. Reports: useful phone preview and dependable print layout.

Fix multi-step write hazards through atomic transitions. Version submitted
registers, plans and review decisions so stale tabs get recoverable conflicts.
Storage failure must be visible; in-memory data is not safely persisted data.
Validate corrupted drafts and prevent one account replaying another's queue.

**Gate:** interrupted/expired/concurrent flows pass; attendance denominators,
weighted marks and report snapshots remain correct; printable rows stay legible;
no false success. **Recovery:** UI reverts independently; backward-compatible
RPC/schema and clear retry/repair for interrupted operations.

### R6 — complete the School Fees handoff

**Tasks R6.1–R6.2.** Map every F-row to verified launcher/context destinations.
Cover payment desk, receipts, transactions, dues, fee setup, leave/write-offs,
reminders, imports/exports, transport, families, reports and recovery/settings.
Reconcile summaries with the fee app's own view and terminology; unavailable
is not zero, principal and late fee stay distinct, write-offs are not collections.

Full financial workflow testing requires a verified School Fees test deployment
and test backend. If absent, record a test gap and separately scope test setup;
do not report production links as completed test coverage.

**Gate:** critical fee capabilities reachable; authenticated destination/roles
verified; test balances agree; linked versus native coverage explicit.
**Recovery:** bad context link falls back to original search/home; original
operations remain intact. No fee writes are introduced in this plan's default.

### R7 — measured speed and accessibility

**Tasks R7.1–R7.2.** Measure cold/warm route latency, query counts, payloads, JS,
long tasks, images and saves. Optimize worst tasks first using §4. Add indexes
from query-plan evidence. Cache with invalidation tests. Virtualize only when
measured need outweighs normal pagination's simplicity.

Proposed lab budgets: warm server-data p95 ≤800ms, normal save p95 ≤1.5s, tap
feedback ≤100ms, navigation feedback ≤200ms, batch progress visible within 1s.
Use at least 20 representative samples, record hardware/network and separate
cold starts. Ratchet initial route JS against R0 (no unexplained >10% growth).
These are targets, not current measurements or field Core Web Vitals results.

**Gate:** before/after evidence, no stale data after writes, keyboard/200% zoom/
Hindi/bilingual/360px flows pass. WCAG 2.2 AA is the accessibility reference,
with the larger product touch targets in §3a. **Recovery:** caching, index and
UI changes reversible independently; accurate answers take priority over speed.

### R8 — deep smoke, staff walkthrough and release

**Tasks R8.1–R8.3.** Run all of `QA.md` against a production build on test data.
Exercise roles, both sides of transitions, large lists, dropped connections,
conflicting sessions, date/session boundaries and generated files. Fix P0/P1,
rerun affected and cross-module regression cases. Deploy, verify commit and
critical deployed workflows. Obtain teacher/office/admin timed walkthroughs.

**Gate:** parity and automated acceptance complete, zero open P0/P1, explicit
remaining P2/device/provider limitations and actual staff usability evidence.
Physical Android, WhatsApp webview, camera and printer tests remain pending if
unavailable. Code delivery and user acceptance get separate statuses if needed.
**Recovery:** prior verified VPPS One deployment plus forward schema repair;
retain test fixture snapshot and original apps. Never drop a shared schema.

## 6. Sources and reuse

Read `SOURCES.md` and `PARITY.md`. Source files are evidence, not proof of live
behavior. Port helpers with tests, adapt storage/query/auth boundaries and
record deliberate differences.

Technical references checked while drafting:

- Installed Next.js guides: `01-app/01-getting-started/05-server-and-client-components.md`
  and `01-app/02-guides/authentication-with-cache-components.md`; installed
  behavior takes precedence over remembered conventions.
- [Next.js fetching data](https://nextjs.org/docs/app/getting-started/fetching-data):
  independent parallel reads and streaming reduce avoidable waterfalls.
- [Web Vitals](https://web.dev/articles/vitals): field LCP/INP/CLS and percentile
  measurement. Lab/task targets above are proposed product targets.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/),
  [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum),
  [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html):
  accessible controls and fixed chrome that does not obscure keyboard focus.

## 7. Live cutover is outside the active queue

Original 7.3 stays deferred pending an explicit live-cutover request. It must
not block R0–R8 or make an agent stop at the old first unfinished row.
`CUTOVER.md` remains historical preparation and needs revalidation against all
new migrations and ownership decisions before use. Repointing deployment does
not reverse writes already made in another database; none are part of this
revision's live-data scope.

## 8. Coding-agent execution contract

1. Read `AGENTS.md`, `CLAUDE.md`, this plan, progress, parity, QA, latest baseline,
   decisions, sources and relevant setup instructions.
2. Pick the first actionable R-row. Check dirty work, preserve unrelated changes,
   record prerequisites and acceptance. Do not scaffold another platform.
3. Use a bounded branch/PR. Read installed framework docs before code. Resolve
   routine design choices autonomously and document decisions.
4. Deliver a vertical slice: UI, server behavior, migrations if needed, fixtures
   and recovery. No dead controls or hidden unimplemented routes.
5. Run `npm run check`, relevant runtime/role/workflow checks and actual browser
   flows. Record expected/executed/failed/skipped counts. Missing evidence is
   not a pass; tests must verify behavior, not only strings in implementation.
6. Apply required dev migrations, commit, push, open PR, wait for CI and merge
   to main; verify deployed commit and changed paths. No extra permission for
   routine authorized test work.
7. Update progress/parity/evidence in the same change. Record task branch and
   release commits from git history; do not invent a self-referential hash.
8. Continue next actionable task when kickoff requests continued work. If a
   session ends, leave exact next steps. A blocked optional integration must
   not prevent independent UI/test progress.

## 9. Alternatives and later ideas

| Idea | Decision | Revisit trigger |
|---|---|---|
| Native full School Fees module | Not selected by working interpretation; changes read-only ownership and financial scope | Explicit user choice: first inventory and port existing module/tests, define schema ownership, isolated test target, transaction semantics, reconciliation and rollback; update CLAUDE/SOURCES/architecture tests before writes |
| Shared SSO | Validate launcher journeys first; cross-domain cookies and SamPark auth need a real integration design | Repeated login is a measured staff problem |
| Full PWA/offline | Durable drafts for loaded tasks first; no promised offline cold start without service-worker/auth/update tests | Physical corridor tests demonstrate need |
| Command palette | Optional desktop enhancement after obvious normal navigation | Frequent keyboard users benefit |
| Smart task priorities | Deterministic ownership/deadlines first | Staff trust underlying counts |
| AI/OCR assistance | Suggestions with review only; never silent student/marks matching | Reliable manual workflow and labelled test corpus exist |
| Redesign original apps directly | Separate changes/releases in their respective repos | Explicit follow-up scope; links alone cannot redesign those screens |

R0 resolves original/test origins, student mapping, combined staff duties, new
source workflows since this audit and available devices. These are inventory
tasks, not reasons to restart architecture. The scope assumption in §1 is the
one material product choice that could change the fee implementation path.
