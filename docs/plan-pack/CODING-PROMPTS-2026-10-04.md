# VPPS One coding prompts

## Purpose and execution boundary

Use these prompts in order to improve the existing VPPS One application for Veer Patta Senior Secondary School Amet. The first outcome is one reliable workflow: an operator saves an absence, safe future cover duties are automatically published, assigned staff receive WhatsApp notices, and teachers can acknowledge or report that they cannot cover.

This is an instructions-only planning deliverable. No implementation, migration, test-backend operation, live send, deployment or cutover has been performed by producing it. The pack does not itself authorize a future worker to do those things. Give the worker the relevant prompt, the common contract below and explicit authorization for that working session. A passed gate permits only the actions and targets actually authorized.

The audited baseline is [VPPS One main at 39ea1c8](https://github.com/veerpatta/vppsone/commit/39ea1c8bc6e7d7962aa0db9834854a348d567650), reviewed on 3 October 2026. Repository evidence establishes committed code, not deployed policies, live account settings or current acceptance. Recheck the actual checkout before choosing implementation details. Existing fees are already ported; preserve the native MyFees experience, sign-in, theme, timetable parser and substitution engine. Do not create another app, financial ledger or sign-in system.

Documentation coverage was finalized on 4 October: an independent GitHub review fully read all 70 VPPS Markdown documents, while the completed Desktop review reports 192 eligible first-party Markdown documents across five repositories, with 79 reasoned exclusions and no partial/unread eligible documents. These are overlapping documentation reviews, not additive document counts or a complete source-code audit. Code investigation remains selective; neither review establishes runtime acceptance. The Desktop review preserved an older VPPS checkout and inspected the current-main PR40 delta separately. Reconcile actual HEAD rather than assuming every checkout is at main.

School dates and bell times use Asia/Kolkata. Teachers are very nontechnical, mainly using Android phones with some iPhones. Use English-first labels with optional Hindi help, retaining existing account language preferences. There is no parent login. Parent-message approval remains enabled by default; configurable parent automation is a later, separately bounded feature.

## Common contract for every prompt

Attach this section to every future-worker handoff. Do not rely on an earlier worker having read it.

### Protect the school and its records

1. **Never contact the protected live School Fees Supabase project `vgqyilgstjvgohrsiwkb`.** No reads, SQL, introspection, migrations, scripts, authentication tests, resets, imports, exports, backups, storage operations or provider-linked operations against it. A script named test, a test user or an academic test session does not create isolation.
2. The code-documented VPPS project `hkkrtspkawifcyqfzltx` is **not automatically a permitted test target**. Finalized Desktop evidence separately labels `wtgxcptmucjerhufzjcf` as an untouched test project. Treat these as conflicting source identifiers until resolved; neither is an authorized or verified isolated target, and neither may be silently added to an allowlist. Before any backend execution, establish the actual target, ownership, data isolation and authorization using approved, non-secret evidence. A project name or copied configuration is insufficient. If it contains school records, shares live dependencies or cannot be proved isolated, stop backend execution and continue only safe source/mock work.
3. Do not request credentials in chat, print environment files, log tokens, copy service keys between projects or create persistent access. Use only existing approved secret-handling mechanisms. Report names of missing configuration and redacted target identifiers, never values. Any new account, credential, permission grant or security-setting change needs its own appropriate approval.
4. Preserve append-only financial semantics and all posted receipts, allocations, reversals, waivers, late-fee separation, carry-forward, actor identity and existing idempotency contracts. Financial corrections use the existing audited adjustment/reversal commands, never an overwrite or deletion of posted money facts. No academic operation may rewrite fee fields or imply payment from attendance, enrollment or a message status. No new financial write engine, bulk replacement or destructive financial migration is in scope.
5. New academic objects belong in the owned `vppsone` schema. Do not alter shared `public` or `private` fee contracts by inference. D-191's existing shared role-function exception is not permission for another exception. If role consistency requires a shared-function change, identify the dependency and stop that change for a separately authorized design and target review.
6. Preserve original SamPark URLs and existing `/r`, `/t`, `/w` capability workflows. Do not add parent accounts, invalidate old links or move the independent SamPark application. New sensitive staff duty links authenticate and check current scope; a phone number or URL is not authority.
7. Work locally on the approved branch only. Do not overwrite unrelated changes, reset the checkout, commit, push, merge, deploy, enable a scheduler, change Notion or send messages unless separately authorized. Read repository instructions and relevant checkout skills, but do not treat historical release-autonomy instructions as current permission.

### Preserve the precise existing fee contracts

These are source-grounded compatibility requirements, not permission to modify shared fee schemas, execute financial actions or activate fee notices in this slice. Their deployed state remains unverified.

- **Collected late-fee waiver:** preserve the existing `waive_late_fee` exception with `p_include_collected` default false. The function requires waiver permission and, for the wider collected pool, `fees:write` (or its existing service-role exception). Ordinary accountant behavior retains the pending-late-fee cap; the wider authorized pool is capped at the late fee still charged. An unauthorized wider request is rejected, not silently downgraded. The command records actor/request/reason and separate `manual_collected` provenance for the collected portion, creating credit without changing posted payment/receipt facts. Do not replace this with a blanket paid-late-fees-can-never-be-waived rule, invent a generic financial editor, infer cash-refund authority or expose service role as a user bypass. [Existing authorization and credit semantics](https://github.com/veerpatta/schoolfees/blob/48beb9a6a5e806c17a320f3c65c421827a4ab9ba/supabase/migrations/20260826120000_an_admin_may_waive_a_collected_late_fee.sql#L19)
- **Receipt guard:** preserve the protected-column blocklist and deletion refusal, not a claim that exactly three fields are editable. Protected fields are `id`, `receipt_number`, `student_id`, `payment_date`, `payment_mode`, `total_amount`, `created_by`, `created_at`, `client_request_id` and `family_payment_id`. Descriptive `reference_number`, `notes` and `received_by` exceptions coexist with constrained `write_off_reason` and `write_off_note`: a reason is null or, on discount-mode write-off rows, `left_school`/`other`; a note requires a reason. Preserve the unchanged posting signature, guarded command boundary and noncollection write-off classification. The blocklist is not permission to edit arbitrary future columns. [Receipt protection trigger](https://github.com/veerpatta/schoolfees/blob/48beb9a6a5e806c17a320f3c65c421827a4ab9ba/supabase/migrations/20260817113000_bulk_payment_corrections.sql#L240), [write-off metadata constraints](https://github.com/veerpatta/schoolfees/blob/48beb9a6a5e806c17a320f3c65c421827a4ab9ba/supabase/migrations/20260912120000_a_write_off_says_why.sql#L19)
- **Fee notice identity:** existing receipt-bearing notices use `(receipt_id, notice_kind)` uniqueness. Daily reminder uniqueness applies only when `receipt_id` is null. Two receipts on one day must not suppress each other; one receipt may legitimately have a received notice and later a reversal notice. Preserve business event kind alongside recipient/category/policy checks and frozen attempts. This source contract does not establish approved campaigns, currently enabled receipt sending or exactly-once delivery. [Current partial indexes and notice kinds](https://github.com/veerpatta/schoolfees/blob/48beb9a6a5e806c17a320f3c65c421827a4ab9ba/supabase/migrations/20260912165421_a_second_receipt_deserves_its_own_notice.sql#L23)

### Establish safe defaults before running anything

- Default all new commands and dispatch to disabled outside the explicit test configuration. Use synthetic staff, cohorts and students. No real pupil information, absence medical reasons or fee details in fixtures, ordinary logs, URLs or staff-cover messages
- Read package scripts and test setup before installation, build, test or app startup. They may initialize clients, seed data, run migrations or contact a provider. Until isolation is established, allow only reviewed offline work with remote database/provider access blocked
- Require target checks for browser, cookie/session, admin, worker, RPC, migration, storage, callback and scheduled-job paths. A safe page client does not establish a safe background client
- Never enable fee receipt notices, fee reminder runs, payment posting, day close or a second existing scheduler as a side effect. Keep the fee and academic messaging policies separate
- Scope new notice identities to the changed duty, relevant duty revision, notice category and intended staff identity. Store contact/template versions in attempt snapshots. An unrelated global plan revision must not resend unchanged duties
- Treat transport timeouts and crash-after-call as potentially accepted. Show Unknown and reconcile before an explicitly authorized resend. Do not promise exactly-once WhatsApp delivery

### Finish each prompt with evidence

Return the outcome first, then: actual commit/branch; changed files; target/isolation gate status; passed, failed, skipped and never-run checks; remaining school decisions; known limits; and the next prompt's gate. Test results must correspond to the final code. Historical green reports and regex architecture guards are supporting evidence, not runtime authorization proofs. If a gate fails, identify the exact action, target and missing evidence and stop dependent work.

## Sequence and stop gates

Phase 0 consists of prompts 1–3: establish the baseline and safe test boundary, obtain the school policy fixture, then close scoped authority and direct-read prerequisites. Prompts 4–8 deliver the first absence-to-substitution slice. Physical-event correctness and access correctness are prerequisites to automatic publication; they cannot be deferred until after notices start going out.

- **Gate A:** current checkout and permitted execution boundary verified; protected live access blocked
- **Gate B:** bounded synthetic school policy approved; ambiguous physical teaching obligations explicitly unresolved
- **Gate C:** current staff authority, role transitions and direct database access tested on an isolated target
- **Gate D:** joint, parallel and ELGA duties represented without losing or inventing supervision
- **Gate E:** one atomic, version-checked and idempotent cover command passes fault/race tests
- **Gate F:** mock outbox dispatch, uncertainty and current-context checks pass; no real sends enabled
- **Gate G:** authenticated teacher duty loop and nontechnical phone flow pass
- **Gate H:** pilot readiness and rollback evidence accepted; any real recipient/campaign test separately authorized

Work on independent source-only parts may overlap, but no worker may bypass a failed gate. Prompts 4–7 can begin with offline fixtures while waiting for a permitted database; passing mock tests alone does not pass database or live-provider gates.

## Prompt 1 establish the current baseline and safe test boundary

**Task to give the future worker**

Inspect the existing `veerpatta/vppsone` checkout read-only before making changes. Compare its actual HEAD with the audited baseline, preserve dirty and untracked work, and record any later changes relevant to auth, fees, timetable, cover or messaging. Read `CLAUDE.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/PARITY.md`, package scripts, test setup and relevant checkout skills. Reconcile outdated README/PLAN claims with newer native-fee/eight-role decisions. Do not restart completed phases or reimplement payment-draft recovery: [PR40 is merged](https://github.com/veerpatta/vppsone/pull/40).

Reconcile the competing VPPS target identifiers in the common contract using permitted evidence before any backend execution. Do not choose one because its source calls it test, rename the other into it, infer that they are aliases or change an allowlist to make tests run.

Map every potential database/provider client and execution path without exposing secret values. Produce a redacted execution manifest covering the app, fee cookie and admin clients, workers, jobs, migrations, storage, callbacks and test setup. Identify implicit network use and shared fee dependencies. Do not probe the protected live project to prove the block works.

Design and, only if local code changes are authorized, add a fail-closed test harness that prevents any protected-project or real-provider request. Reject unknown target IDs and non-allowlisted egress. Test this with synthetic URLs/configurations and mock requests, not real requests to the protected project. Establish how the approved test process excludes inherited production configuration. Install or run tools only after reviewing scripts and network behavior.

For backend tests, require a separately authorized local disposable database or independently verified isolated VPPS test target. Obtain evidence of the approved project/ref, resolved application and worker destinations, absence of live data/dependencies, restricted egress and intended migration/seed scope. Do not ask for credentials. If verification requires an external call, first obtain authorization for that particular unprotected target. Stop at source/mock tests when evidence is missing.

**Grounded entry points**

- [Current app authority](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/platform/auth/current-staff.ts)
- [Fee cookie/session bridge](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/fees/platform/session.ts) and [fee admin client](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/fees/platform/supabase/admin.ts)
- [Architecture guards](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/tests/architecture.test.ts#L166-L220), [job runner](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/jobs/data/run-job.ts), [cron configuration](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/vercel.json)

**Acceptance and negative tests**

- Protected ref in any client, worker, migration or storage configuration prevents execution before outbound contact; missing/mismatched target fails closed
- A synthetic test session on a live-style target is rejected; environment names such as preview or test do not override the target check
- Real AiSensy transport cannot initialize in the default test harness; inherited keys cannot turn a mock test into a live send
- No secrets appear in reports or logs; repository work remains preserved; fees and existing schedulers remain unchanged

**Exit:** Gate A, a redacted manifest and exact safe commands for the next worker. If blocked, provide source-only test commands and the smallest missing isolation evidence. No backend execution is an acceptable interim result; it must be labeled never run.

## Prompt 2 define the school policy and physical duty fixture

**Task to give the future worker**

Create a small, reviewable synthetic policy fixture for the first pilot. Reuse existing timetable/substitution concepts and describe school decisions in ordinary language for Raj. Confirm only unresolved policy questions, not the already settled English-first, no-parent-login or automatic valid-cover direction.

The fixture must specify operating calendar, bells and absence intervals; class/cohort membership and actual joint-room arrangement; ELGA team roles and minimum supervision; room capacities and movement buffers; positive class/subject/supervision eligibility; blocking nonteaching duties; shifts; maximum/consecutive cover rules; reserve/duty policy; manual-pin authority; and the response to an unavailable substitute. Distinguish planned teaching eligibility from a generic active staff profile. Unknown eligibility or availability remains unresolved.

Include a simple ordinary lesson, one joint senior lesson, parallel elective cohorts, a shared ELGA team, overlapping rooms and a partial-day absence. Give every event its participating cohorts, teacher-team obligations and time interval. Do not infer one physical event merely from the same subject and period. Preserve source/slot provenance and record what requires reviewed mapping.

Respect Studio's later eight-period-only owner decision: the six-period heatwave profile was removed entirely, not deferred for a future switch. Do not reintroduce it from older analysis; verify the current viewer source and school's actual bell times. Studio's `team_block` absence planner deliberately returns no candidates because teacher-to-class/cohort duties are not represented. Keep uncertain ELGA cover manual and visibly unresolved until actual cohort/supervision mapping and positive eligibility are approved; a generic atomic event does not solve that missing information. Ordinary/joint candidates must qualify for every participating member class. [Eight-period decision](https://github.com/veerpatta/timetablestudio/blob/5de8cd14e19cb968192fce23a80465a4ede6b22c/docs/DECISIONS.md#L189), [manual team-block and every-class eligibility boundary](https://github.com/veerpatta/timetablestudio/blob/5de8cd14e19cb968192fce23a80465a4ede6b22c/src/domain/substitute.ts#L1)

Automatic merge or self-study is disabled unless an explicit approved supervised policy supplies a named responsible teacher and feasible room, capacity and interval rules. A school-approved preference cannot waive physical impossibility. Retain the existing optimizer's preference ranking where valid; class familiarity and fairness never outrank hard validity.

**Grounded entry points**

- [Policy schema/defaults](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/domain/policies.ts#L98-L163)
- [Existing engine candidate rules](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/domain/engine.ts#L50-L170)
- [Joint/shared parser semantics](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/timetable/domain/parse-timetable.ts#L257-L338) and [parser tests](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/tests/parse-timetable.test.ts#L239-L272)

**Acceptance and negative tests**

- Unknown availability, absent school policy, ambiguous rooms, missing cohort membership or inadequate supervision yields explicit unresolved coverage
- A nonteaching active staff member does not become automatically eligible without positive approved supervision eligibility
- Same-subject separate rooms remain separate physical obligations; one teacher cannot cover both simultaneously
- Approved supervised merge is tested at and beyond capacity and with movement/shift limits; unapproved merge/self-study remains unresolved
- Current bell times are verified without restoring the superseded six-period heatwave profile; two automatic covers and three consecutive periods remain source defaults to confirm, not school policy facts
- An ELGA `team_block` without mapped actual cohort/teacher-role supervision remains manual/unresolved even if the overall event can be stored atomically; joint eligibility missing for one member class blocks that candidate

**Exit:** Gate B and an approved bounded fixture with versioned policy assumptions. If approval is missing, retain unresolved markers and stop automatic publication for affected duties. Offline domain tests may proceed against explicitly hypothetical fixtures.

## Prompt 3 establish one scoped staff authority and direct read boundary

**Task to give the future worker**

Implement the approved Phase 0 access slice in the existing app and owned schema, only within the Gate A target boundary. Enumerate the current eight native roles from source. Keep Supabase Auth subject linked to an active `vppsone.staff_profiles` record as app identity; a profile may be schedulable without a login, and a phone is only a contact endpoint. Keep capabilities separate from class, subject and temporary duty scope.

Separate ordinary profile editing from role changes, auth-account linking, activation/deactivation and credential powers. Define allowed role transitions explicitly. Office must not promote another linked profile to admin or deactivate an admin through general staff editing. Preserve at least one active administrator under concurrent operations.

Reconcile `/staff` and `/fees/staff` management deliberately. Current fee management writes a different authority, while the existing fee RPC role function prefers an active `public.users` role before the native profile and falls back even for an inactive public record. Document the approved conflict/deactivation behavior and test it. Preserve allowed fee RPC actor identity and request IDs. Do not silently change shared SQL, grant office accountant powers, mutate real Auth accounts or reset passwords. If the chosen compatibility rule requires a shared-function migration or new access, stop that part for separate authorization.

Replace broad owned-schema direct-read exposure with active-staff capability and row scope. Review actual grants and applied policies only on the authorized isolated target. Protect capability-token columns from generic authenticated reads; preserve narrowly scoped legacy token resolution. Inspect views, functions, storage/download paths and service-role handlers as well as tables. Service-role code needs explicit server-side authorization because ordinary RLS cannot protect its bypass path.

Define effective-date scope using the whole interval and academic session. A class-teacher register scope, subject-teacher marks scope and temporary cover-duty scope are different. Cover alone must not grant pupil history, register ownership or financial access. Re-evaluate role, active status and assignments on every new operation, including an existing logged-in session.

**Grounded entry points**

- [Permission map](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/platform/auth/permissions.ts), [staff action](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/app/%28app%29/staff/actions.ts#L121-L159), `src/modules/staff/domain/staff.ts`, `src/modules/staff/data/staff-repo.ts`
- [Fee role shim](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/platform/auth/fee-roles.ts), [fee staff writer](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/staff-fees/data/queries.ts#L264-L294), [D-191 role precedence](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/supabase/migrations/20260922100000_current_staff_role_reads_vppsone.sql#L62-L89)
- [Existing class helper](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/attendance/data/teaching-repo.ts#L20-L55), [enrollment policy](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/supabase/migrations/20260916205631_create_enrolments.sql#L69-L75), [request-token exposure](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/supabase/migrations/20260917033652_create_collection.sql#L103-L145)

**Acceptance and negative/race tests**

- Test every current native role through page, command and direct API access using ordinary scoped sessions, not only an admin/service key
- A valid Auth account with no VPPS profile, an inactive profile, viewer, wrong-class teacher and expired/future assignment cannot read private pupil records or bearer tokens
- Office promotion/deactivation attacks, forged role inputs, fee/native-role contradictions and inactive legacy-row fallback have explicit allowed/denied outcomes
- Two simultaneous admin removals cannot remove the last active administrator; failed transition leaves the old authority intact
- Revocation/reassignment applies on the next read/save/export/dispatch, even from an already-open tab
- Legacy capability tests still pass without becoming generic private-data access; allowed fee calls retain the real actor and idempotency key

**Exit:** Gate C with a role/scope matrix and isolated integration evidence. Static guard presence alone cannot pass this gate. Roll back code by disabling the new entry points if necessary; do not restore permissive data access as a pilot workaround.

## Prompt 4 preserve physical events and supervision in the current timetable

**Task to give the future worker**

After Gates A–C, extend the current parser/import/storage/cover boundary to preserve actual physical teaching obligations. Keep raw source/version, aliases, parser grammar and existing slot IDs/views. Add an owned-schema normalized projection only where required: event identity, source-slot membership, participating cohorts/classes, teacher-team roles, room/time interval and minimum supervision. New files/tables are proposed additions, not assumed existing paths.

Derive grouping candidates from the parser's existing joint/shared semantics. Use reviewed mapping for ambiguous physical grouping. Bind one physical duty to all participating class views and staff notice context. Represent parallel cohorts separately when obligations differ. Do not retain `classId|period` as the only vacancy identity or treat any remaining ELGA teacher as universally sufficient.

Reuse Studio event concepts selectively. Its experimental Arts option-line/student-group model is dormant: current bundled construction returns the raw whole-class timetable, and persistence normalization always calls `stripElectiveModel` under the 20 June owner decision. Do not enable that experimental model or infer live Arts cohorts from old CUSTOMIZE/C5 text or a stale bundled comment. **Do not reuse `stripElectiveModel` in the new mapped cohort store:** it clears group membership and would erase legitimate physical obligations. Confirm real parallel groups from current school practice, then preserve their mapped IDs independently. Studio `team_block` remains manual until the actual cohort/supervision mapping is established. [Current bundled construction](https://github.com/veerpatta/timetablestudio/blob/5de8cd14e19cb968192fce23a80465a4ede6b22c/src/fixtures/bundled.ts#L77), [normalization behavior](https://github.com/veerpatta/timetablestudio/blob/5de8cd14e19cb968192fce23a80465a4ede6b22c/src/persistence/db.ts#L91), [superseding Arts decision](https://github.com/veerpatta/timetablestudio/blob/5de8cd14e19cb968192fce23a80465a4ede6b22c/docs/DECISIONS.md#L241)

Adapt interval ownership and uniqueness without weakening no-double-booking. A joint cover is one physical duty projected to multiple classes; it is not several independent covers. One teacher's load counts that duty once. Preserve all original team/cohort obligations. A manual pin is tied to an event and becomes invalid when its source mapping or hard constraints change.

Use additive migrations on the verified isolated target only. Do not auto-backfill ambiguous real-shaped rows into supposedly certain events. Provide a dry-run mapping result and unresolved queue; runtime backfill outside synthetic fixtures requires separate permission.

**Grounded entry points**

- [Resolved import currently flattens slots](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/timetable/domain/resolve-import.ts#L82-L98)
- [Current flat timetable storage](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/supabase/migrations/20260916210606_create_timetable_versions_and_slots.sql#L62-L110)
- [Current views/load/clash handling](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/timetable/domain/views.ts#L152-L237)
- [Current vacancy grouping](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/domain/plan.ts#L68-L115), `src/modules/substitutions/data/planning-context.ts`

**Acceptance and negative tests**

- Joint senior event: one absent teacher creates one cover duty visible in every participating class, one load unit and one appropriate notice per intended recipient
- ELGA: one, several and all team members absent; remaining roles/cardinality must meet the approved policy or show missing supervision
- Parallel electives: both absent cohorts remain represented with their distinct subject/supervision needs
- Same subject/time in separate rooms triggers a clash; grouping cannot suppress it
- Partial interval, differing bells, movement buffers, overlapping regular/nonteaching duties and room capacity are enforced
- Import/read/persistence round trip preserves every confirmed cohort and supervision duty; a proposed normalizer that strips mapped membership fails the test
- Dormant Arts option-line modeling remains disabled; synthetic parallel fixtures do not establish that the school uses those groups; ambiguous mapping stays unresolved and ELGA remains manual until mapped
- Existing timetable/parser regressions remain green, with every-member-class eligibility enforced for a joint substitute

**Exit:** Gate D with event/cohort/team fixtures and projection evidence. If schema compatibility cannot safely represent a fixture, stop automatic coverage for it. Rollback disables new event-dependent commands and retains old slots plus the new projection/history; do not erase either.

## Prompt 5 implement one atomic absence and cover command

**Task to give the future worker**

After Gates A–D, replace the priority multi-step operator journey with one server command behind **Save absence & arrange cover**. Preserve existing engine logic where valid, including scarce-candidate whole-batch allocation; add hard validity and final whole-plan validation rather than rebuilding the optimizer.

The command accepts a stable logical submission ID, actor, academic session/date, selected absence intervals, expected published timetable/event/calendar/bell/policy/availability revisions and expected relevant plan revision. Derive server-side scope; never trust submitted class/teacher ownership. Normalize absence identity consistently with session/date and retain audited revisions rather than silently overwriting history.

For all simultaneous absences, derive affected future physical obligations, revalidate existing pins/manual assignments and regular/blocking duties, preserve valid pins and report invalidated pins. Solve the affected set together. Validate the completed batch again for positive eligibility, active/available staff, full interval/movement, workload/consecutive rules, capacity and required team coverage. Unknown inputs produce unresolved obligations, not fabricated availability or unsupervised fallback.

Use one database transaction or equivalent single atomic server boundary on the isolated target to check current input revisions, serialize competing resource ownership, write the absence revision and changed duty facts, reserve intervals, publish the new relevant revision, insert durable notice intents, and store the command receipt. No delete/insert/stamp sequence across separate requests. Explain the locking/conflict strategy, lock ordering and retry bound; a unique teacher-period index alone is insufficient.

Duplicate logical requests with the same normalized payload return the original committed receipt. Reusing an ID with a different payload is rejected. Receipt retrieval rechecks current actor/scope and cannot expose another operator's private result through a guessed request ID. A lost response resolves that ID before another submission is offered. A stale command returns a conflict with recoverable operator context rather than last-write-wins. Safe assignments publish automatically under approved policy; unresolved obligations remain prominently visible.

Handle return-to-work, substitute absence, wrong-teacher correction and timetable/bell/room/policy change by revising and revalidating relevant future duties. Preserve completed-period history. Cancel obsolete unsent notices and prepare changed/cancelled notices for facts already communicated. A historical edit does not send an obsolete cover-now instruction. Provider calls occur only after commit and cannot undo a valid plan.

**Grounded entry points**

- [Current actions](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/app/%28app%29/substitutions/actions.ts), `src/modules/substitutions/data/absences-repo.ts`
- [Current nontransactional plan write/publish](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/data/plans-repo.ts#L184-L344)
- [Engine](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/domain/engine.ts), [existing substitution schema](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/supabase/migrations/20260917025818_create_substitutions.sql#L150-L273)
- [Engine tests](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/tests/substitution-engine.test.ts), [plan tests](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/tests/substitution-plan.test.ts)

**Acceptance and negative/race tests**

- Full-day, half-day/period-specific and simultaneous absences; scarce specialist preserved for the event that requires one; deterministic feasible result
- Invalid manual teacher, newly absent pin, stale timetable/availability/policy, calendar-closed day, started/completed period and no published timetable are handled explicitly
- Construct a batch where individually eligible covers jointly violate the consecutive-run limit; final validation rejects/reallocates it
- Two concurrent operators, generate/manual edit/return races, substitute becomes absent during commit, and overlapping resources across plans cannot double-book or overwrite a newer revision
- Inject failure after each internal write and before receipt: no partial publication/outbox; prior committed plan remains intact
- Double click, parallel duplicate submission, different-payload ID reuse and response lost after commit produce one logical result with recoverable receipt
- Return/reassignment changes only relevant future duties; unaffected duties retain identity/revision and are not renotified
- Fees remain untouched; messaging failure leaves committed coverage and receipt available

**Exit:** Gate E with transaction, conflict and fault-injection evidence. Rollback disables new submissions, preserves committed duty/absence/receipt history and uses explicit compensating revisions for incorrect future duties. Never reset the database to remove a committed command.

## Prompt 6 add a revision aware staff outbox using the existing transport

**Task to give the future worker**

After Gate E, wire committed changed-duty intents to a durable staff-only outbox. Reuse existing AiSensy transport/template knowledge and job infrastructure without reusing fee/run/day-specific tables as an academic message ledger. Keep real provider transport disabled; implement and test against a controlled mock first.

Preserve the existing fee notice identities from the common contract: receipt-bearing events deduplicate by receipt plus notice kind; only null-receipt reminder/statement rows use the daily key. Do not import a universal student/day key into the staff outbox or a universal receipt-only key into fee compatibility logic. These are separate business-event boundaries, and no receipt notices are activated by this work.

Separate notice intent, recipient ownership/contact version, immutable attempt snapshots, lease/dispatch state, provider acceptance evidence and delivery/read evidence. The logical notice key binds the physical duty and relevant duty revision, notice kind and intended staff identity. Actual contact/template/policy versions belong in the attempt. Duplicate jobs or an unrelated global plan revision must not create another intended notice.

Before dispatch, atomically claim an eligible attempt and re-resolve current duty/revision, owner, active profile, approved contact route/opt-out, approved campaign/variable order, permitted language, policy and time. Do not dispatch an obsolete assignment or a past cover instruction. Close the gap between claim and send with a documented last validation/reservation protocol; test cancellation/reassignment during that gap. If cancellation occurs after external submission, retain what was actually sent and issue the required correction under the approved staff policy. Do not pretend an accepted message can be recalled.

Distinguish queued, dispatching, provider accepted, delivered/read where evidenced, failed and Unknown. A successful HTTP response without the verified acceptance contract is not automatically proven acceptance. A timeout/crash after contact is Unknown, not safely retryable failure. Lease expiry must not automatically replay an ambiguous external call. Reconcile by the provider's verified lookup/webhook or an approved manual method. When unresolved, display uncertainty and require explicitly authorized resend with audited risk disclosure.

For definitive retryable failures, use bounded backoff and an atomic retry claim, revalidating current context each time. Parse rate limits/provider errors without exposing secrets. Callback handling must authenticate under the actual provider contract, correlate to immutable attempts and update evidence atomically without regression under replay or out-of-order concurrency. Unsupported callbacks/reconciliation remain explicitly unavailable. A staff notice can still be found through Today when messaging fails.

**Grounded entry points**

- [Current staff provider](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/collection/data/message-provider.ts#L44-L94), [current read-before-send queue](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/collection/data/messages-repo.ts#L184-L342), `src/modules/collection/domain/messages.ts`
- [Fee adapter acceptance contract](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/whatsapp/data/aisensy.ts#L1-L128), [fee initial claim pattern](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/whatsapp/data/run-sender.ts#L599-L676), [fee reconciliation](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/whatsapp/data/delivery-store.ts#L17-L224)
- [SamPark URL-button transport](https://github.com/veerpatta/sampark/blob/830548c87bfb28ba6d7886c1d768301d6e46f5bd/src/lib/aisensy.ts), [campaign templates](https://github.com/veerpatta/sampark/blob/830548c87bfb28ba6d7886c1d768301d6e46f5bd/src/lib/whatsapp-templates.ts#L64-L305)

These are reuse references, not instructions to change those repositories. In particular, do not inherit the staff queue's read-before-send race, fee retry's unclaimed stale snapshot or network-error-to-failed ambiguity. Resolve the `messageId` versus `submitted_message_id` response discrepancy with verified provider evidence later.

**Acceptance and negative/race tests**

- Mock accepted response, malformed/empty success, definite pre-call failure, 429, 5xx, timeout after acceptance, database failure after call and process crash after call
- Parallel workers/retries, stale lease and duplicate trigger produce one intended notice and no blind ambiguous-call replay
- Reassignment, cancellation, deactivation, phone/contact-version change, opt-out, template/policy change and period elapsed before send suppress or replace obsolete unsent attempts
- Unrelated plan edits do not resend unchanged duties; sent destinations/content remain auditable after current phone changes
- Duplicate/forged/unmatched/out-of-order/concurrent callbacks cannot create notice intents, acknowledge a duty or regress delivery evidence
- Unknown remains visible; authorized resend is a new audited attempt, not a claim that the original did not arrive
- Parent sends stay blocked by default and fee cadence/receipt/cron configuration is unchanged

**Exit:** Gate F from mocks and isolated persistence tests. Actual approved staff campaigns, link domains, response/status contracts and costs remain a separate gate. The [AiSensy analytics guide](https://wiki.aisensy.com/en/articles/11501896-whatsapp-broadcast-campaign-analytics) describes dashboard sent/delivered/read/failed metrics; it does not establish this school's usable callback, idempotency or cancellation APIs. The supplied [legacy API reference](https://faq.aisensy.com/api-reference-docs/) was inaccessible during planning, so do not infer its contract.

## Prompt 7 make the operator and teacher duty loop understandable

**Task to give the future worker**

After Gates C–F, extend existing substitutions and Today views without a navigation redesign. The operator chooses teacher, school date and full-day or intervals, reviews the scope, then uses Save absence & arrange cover. Show a durable receipt separating assigned duties, unresolved obligations and notice states. Explain why each unresolved duty needs attention in plain English, with optional Hindi help. Never show a green all-covered outcome for unsupervised self-study or an unresolved team/cohort.

Use the same authenticated current-duty route from Today and WhatsApp. Show current school date/time, class/cohorts, subject, room, assignment version and changed/cancelled status. Preserve the destination through sign-in while validating it. No private data appears before authorization. Old links resolve the current/cancelled duty rather than a stale instruction; forwarded links cannot confer scope.

Provide explicit Acknowledge and Cannot cover actions. Recheck current owner/revision on the server. Duplicate acknowledgement is idempotent. Cannot cover creates a visible coordinator escalation/reassignment need; it does not silently free the teacher or transfer responsibility. Define the school's pending-escalation responsibility rule in the UI. If a schedulable teacher lacks app login, show that delivery/acknowledgement limitation honestly rather than creating an account implicitly.

Keep assignment, acknowledgement, inability/escalation and actual coverage as separate facts. Neither message read nor task-page opening records acknowledgement or coverage. GET, link previews and scanners have no side effects. Teacher duty scope does not grant historical registers or unrelated child records.

Reuse current mobile patterns and account preferences. Provide readable text, at least 48 CSS-pixel touch targets as the school usability target, keyboard-safe actions, focus visibility and no horizontal scrolling. Save errors retain the operator's selections. After uncertain save, show Checking whether this saved and resolve the original logical command before retry. Offline local state is clearly unsubmitted; do not silently replay a command or send. Do not cache private duty/pupil HTML in the public-only service worker.

**Grounded entry points**

- [Existing substitutions UI](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/app/%28app%29/substitutions/page.tsx#L480-L519), [current teacher-duty read path](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/modules/substitutions/data/plans-repo.ts#L349-L429)
- [Language conventions](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/messages/README.md), [public-only PWA boundary](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/public/README.md), [legacy public path boundary](https://github.com/veerpatta/vppsone/blob/39ea1c8bc6e7d7962aa0db9834854a348d567650/src/platform/supabase/middleware.ts#L20-L55)

Inspect the actual Today component before choosing its file target; the audit confirms the feature, not every UI filename. Any new duty route is a proposed addition.

**Acceptance and negative/race tests**

- Operator completes absence-to-receipt without per-period routine approval; teacher opens the same duty from Today or the mocked WhatsApp link
- Login interruption, wrong account, revoked owner, reassigned duty, old cancelled link, expired session, forwarded link and download attempt expose no unauthorized data
- Link preview/GET/refresh creates no state change; double acknowledgement has one effect; acknowledgement racing reassignment cannot confirm an obsolete duty
- Cannot cover reaches the coordinator, preserves explicit pending responsibility and leads to a versioned future reassignment through the same safe command
- Double click, lost response, offline-before-send, Back/Forward, cancel/close, keyboard opening and account switch retain or discard state safely without duplicate commands
- Android/iPhone-sized browser checks pass, with physical device and nontechnical teacher trials separately recorded; lab success is not field acceptance

**Exit:** Gate G with screenshots of synthetic flows and clearly labeled device coverage. Rollback hides new actions while leaving assigned duty/current status and operator recovery access available. Do not erase acknowledgements or issued instructions.

## Prompt 8 verify the complete slice and prepare the bounded pilot

**Task to give the future worker**

Run the full approved safe suite against the final code and verified isolated target, covering Gates A–G end to end. Record exact commit, target, fixtures, commands, counts and failures. Re-run affected tests after every final edit. Include lint, type checks, architecture/aggregate checks and focused tests according to current repository scripts. Never convert skipped or never-run database, device or provider checks into a passing claim.

Demonstrate the operator saving a batch absence, valid cover publication and unresolved exceptions, outbox insertion, mock dispatch, authenticated teacher acknowledgement and inability/reassignment, followed by cancellation/return-to-work. Include fault injection, target denial, direct access denial, resource races, stale input, duplicate/lost response, joint/ELGA/parallel cohorts, Unknown dispatch and old-link behavior.

Protect fee parity with source-boundary assertions and isolated synthetic regression tests only: academic changes cannot alter receipt/ledger paths, actor attribution, request-key behavior, reversals or fee automation. Do not call live fees to prove noninterference. No migration modifies shared fee schemas/functions without separately approved scope. Reconcile documentation with native fees, eight roles, PR40 merge and the implemented messaging scope; preserve residual attendance/marks/SamPark/report/archive work rather than declaring broad ERP parity complete.

Include precise compatibility regressions against source/mocks or an explicitly approved isolated synthetic copy, never the protected live project:

- Default/ordinary late-fee waiver stays capped at pending late fee; an unauthorized collected-pool request is refused. The existing administrator-authorized wider request is capped at still-charged late fee, preserves owed-versus-`manual_collected` provenance and replay/actor/reason evidence, leaves payment/receipt money unchanged and yields the expected credit without a cash refund
- Receipt DELETE and every protected-column change are rejected. Existing descriptive changes and valid write-off reason/note combinations pass only through their guarded command boundary; invalid mode/reason, note without reason and unauthorized metadata change fail. Posting signature and collection/noncollection reporting remain unchanged
- Two same-day receipts have independent notice identities; a receipt and its later reversal coexist; duplicate same-kind receipt intent is rejected; null-receipt daily reminders retain their original deduplication. These tests do not perform sends or enable receipt automation
- Unmapped ELGA remains manual/unresolved; every-class joint eligibility is enforced; mapped physical cohorts survive import, reload and publication without the dormant Arts model or `stripElectiveModel` erasing them

Prepare a small pilot runbook specifying authorized environment, participating staff, approved policy/fixture, current app commit, operator fallback, notice disable switch, command disable switch, escalation owner and rollback checks. Keep real provider dispatch off until its own gate is satisfied.

**Separate provider verification gate**

If the owner explicitly authorizes a provider/account check, verify only the named account, approved staff-cover campaign, exact variables/language, acceptance shape, permitted task-link domain/button configuration, status reconciliation/authentication and actual charging/budget rules. Source templates and dashboard metrics do not prove those account settings. Do not obtain or paste an API key, create persistent access, change a campaign or send during a read-only check.

For a test message, obtain explicit authorization for the staff test recipient/contact data, provider destination, campaign/content/link and test-send scope, including applicable charge limit. Use the approved recipient, synthetic duty and minimal disclosure. Confirm accepted status separately from evidence of delivery/read. If account access, campaign approval, recipient routing or costs are unverified, stop the send and leave the mock-only gate intact. A single authorized test does not authorize recurring staff sends or parent messages; recurring pilot notices need bounded staff audience/category and approved school policy.

**Rollback and recovery gate**

- Disable new submissions and dispatch independently; stop claims/retries, then account for any already in-flight call. It may still be accepted and must remain auditable
- Restore a known compatible app version only after testing it against the additive schema and committed revisions. Keep new tables/history/receipts/attempts readable for recovery
- Correct published future duties with compensating revisions and any required changed/cancelled staff notices. Preserve actual sent content, recipient snapshots and acknowledgement history
- Never restore an old shared database over later fee postings, truncate financial tables, replay money commands or delete evidence to make tests green
- Verify subsequent synthetic fee postings survive the academic rollback drill on the isolated target. Any future backup plan must include object bytes separately: [Supabase documents that database backups exclude Storage objects](https://supabase.com/docs/guides/platform/backups)
- Do not activate dual fee writers or duplicate cron ownership. No protected-live cutover, original-app retirement, hosting migration or Notion change is part of this pilot

**Exit:** Gate H with a concise readiness report: ready for the named bounded pilot, or blocked with exact failed/never-run checks and needed decisions. A mock-complete slice may be ready for a synthetic walkthrough while remaining unready for real automatic WhatsApp. Deployment or live cutover requires separate authorization and is not the automatic next step.

## Completion evidence required from the first slice

The pack's intended future result is complete only when the agreed pilot scope establishes all of these:

1. Protected live access is prevented and all executed tests have verified isolated targets
2. One current staff authority and effective-date scope is enforced through app, command and direct reads
3. Every affected physical cohort/team obligation is safely assigned or explicitly unresolved
4. A single absence command commits revisioned duties, reservations, notices and a recoverable receipt atomically
5. Duplicate requests, stale inputs, concurrency and injected faults cannot leave partial or conflicting coverage
6. Staff dispatch uses current-context checks, atomic attempts and honest Unknown recovery without an exactly-once promise
7. Today and WhatsApp point to the same authenticated duty; acknowledgement and inability are explicit and separate from delivery or physical coverage
8. Nontechnical staff can understand the assigned/unresolved/notice outcomes on the tested devices
9. Rollback preserves committed school instructions, audit evidence and every later fee posting
10. Any real campaign/recipient/pilot dispatch has its own verified capabilities and bounded authorization

Attendance corrections and bell-relative reminders, canonical marks/report revisions, default-approval parent policies, remaining SamPark parity and archives follow after this slice. Their existing work and open acceptance remain visible; none is silently rebuilt or declared complete by finishing cover automation.
