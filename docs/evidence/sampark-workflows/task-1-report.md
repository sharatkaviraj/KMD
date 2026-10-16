# Task 1 — shared teacher work

Date: 16 October 2026. Branch: `codex/sampark-teacher-workflows`.
Baseline: reconciled `dd1e9a5`, controller plan/review base `c095324`.
Status: implemented locally; independent review and Task 4 browser acceptance remain with the controller. Migration is authored and **unapplied**.

## Delivered behavior

- Needs you has compact task groups and the shared assignment sheet. The sheet supports a selected common list and class, house, route or subject responsibility, editable recipients, a due date, missing-field/No photo filters, selected children, and a server-saved preview. Ambiguous, missing and invalid ownership blocks creation.
- Students exposes missing-field/No photo filters and requests for selected rows or all filter matches. The normal directory retains its existing behavior. Student profiles open contextual detail requests (missing scalar fields preselected) and subject-paper requests. No directory row animation wrappers were changed; PR97's animation timing changes remain straightforward to reconcile.
- Teacher More links to `/teach/tasks`. The hub joins existing assigned collections, open subject papers and today's class registers with managed tasks, deduplicating canonical sources. A paper/register is never copied into a second source of marks or attendance.
- `/teach/tasks/[id]` and `/t/tasks/[token]` load the same task work and use shared save handlers. Collection uses the existing request form and durable drafts. Academic work uses draft/submit/correction controls and explicit review before save. Unknown academic outcomes retain the exact command for an intentional retry.
- Collection answers are proposals. Only an active admin can decide new task-backed proposals. The new database trigger also protects the existing collection review and inbox acceptance paths. Non-admin inbox bulk decisions exclude these proposals; the review screen hides their decision controls and explains the admin requirement. Legacy review policy is otherwise retained.
- Collection progress distinguishes waiting, awaiting review, and reviewed completion. Rejections count as reviewed, **not approved**, and the hub displays a separate rejected-answer count. Missing-detail filters use accepted `student_records`/canonical fee-held values, never pending or rejected proposals.
- Needs you offers copy link, revoke, reassign with token rotation, and **Request details again and revoke old links**. The last action atomically creates a fresh request and snapshot of official values, retains all old decisions, revokes old capabilities, bypasses legacy-request adoption and clears the old due date. If the old scope no longer matches current membership, it refuses without closing the previous request; the office can create an updated selection through Assign work.
- Active-task dedupe is durable, with a bounded collection selection digest. Repeating a completed request normally reuses the existing task. A deliberate new round uses the above action or revoke followed by a new assignment. Reuse refuses `recipient_changed` if the task's current teacher differs from the teacher in the reviewed preview; it cannot change recipients after confirmation. The creation receipt identifies the actual recipient and any reuse.

## Authority and data boundaries

- Preview/create are `collection:manage` operations, forbidden while viewing as another role. Previews are immutable rows bound to the actor, digest and 30-minute expiry. Create consumes only preview id/digest and stores its receipt for replay.
- Assignees must be active teaching staff (`is_teaching` or teacher role). Explicit common collection delegation may include children outside their ordinary class. Automatic scopes recheck current primary class-teacher dates, subject assignment, house or route responsibility. Marks/attendance also require their existing write permission and exact canonical paper/register roster. The editable UI never grants that authority.
- Every managed read and save rechecks current assignment, active staff, revocation and (for collection) current member eligibility. A stale or moved child blocks the frozen automatic request rather than disclosing a newly changed scope. No-login pages expose no peer list or unrelated task navigation.
- New public tokens are service-only capabilities, following the existing collection token pattern. They are not returned with task summaries. Revocation/reassignment rotates both the managed token and its canonical collection request token. Public routes use the existing rate-limit budgets and no-index metadata.
- Marks call `vppsone.save_marks(jsonb)`; attendance calls `vppsone.save_attendance_register(jsonb)`. The wrapper forces the assigned actor and exact source, excludes office-only reopen/correction-approval payloads, and leaves revision, roster, lock and audit enforcement with those writers.
- Student ids in HTTP filters are chunked, source lists and many-field answers are paged, and task summaries use bounded concurrency. Creation caps previews at 60 groups and 2,000 distinct children per group; collection answers cap at 40,000 entries. The SQL joins never serialize a school-sized roster into a REST filter.
- No photo proposal/upload implementation or provider sends are included here. No photo is a selection filter. Task 2 extends the collection work; Task 3 consumes the task scope and source progress for delivery/reminders.

## Exact migration scope for separate approval

File: `supabase/migrations/20261016070000_teacher_tasks.sql`.

Two new tables, both in `vppsone`, RLS enabled, no anonymous/authenticated grants:

1. `teacher_tasks`: canonical source reference, assignment/scope, title/deadline, private token, opened/revoked metadata. Unique request and token constraints, assignee lookup index, and a partial unique active source index. Collection `source_key` is `collection:<session>:<md5(sorted UUID selection + fields)>`, bounded independently of roster size. Actual members remain in `collection_request_members`; the digest is not authorization.
2. `teacher_task_previews`: actor-bound immutable payload, generated digest, expiry, replay result and creation time.

Nine new functions (all security definer with empty search path):

| Function | Effect |
| --- | --- |
| `teacher_task_owner(uuid,text,jsonb,text)` | Current active teacher, permission and scope predicate |
| `teacher_task_access(uuid,uuid,text)` | Current credential, owner, revocation and collection member predicate |
| `prepare_teacher_tasks(uuid,jsonb)` | Persist immutable authorized preview |
| `create_teacher_tasks(uuid,uuid,text)` | Lock preview, serialize per-session create, revalidate, adopt exact legacy request or create canonical collection source, and save idempotent receipt |
| `guard_teacher_task_review()` | Trigger helper enforcing admin decisions, current task authority and protection of decided proposals |
| `save_teacher_task(uuid,uuid,text,jsonb)` | Recheck and dispatch to existing audited academic writer |
| `record_collection_answers(uuid,text,jsonb)` | Atomic scoped pending-proposal upsert; decided rows remain immutable |
| `manage_teacher_task(uuid,uuid,uuid)` | Reassign/revoke and rotate associated capabilities |
| `restart_teacher_task(uuid,uuid)` | Atomic explicit fresh collection round, preserving previous decisions |

One new `BEFORE INSERT OR UPDATE` trigger, `teacher_task_review_admin`, on existing `vppsone.collection_submissions`. The eight callable functions are service-role-only; the trigger helper is not granted to ordinary clients. No existing canonical writer is replaced. No new public-schema objects, public-table writes, storage changes or provider configuration. SQL reads existing `public.students` only to validate membership and freeze held values. At execution time the functions write task/preview rows and existing `vppsone` collection source rows; academic writes remain delegated.

Controller verified the deployment's non-secret database project ref as `wtgxcptmucjerhufzjcf` (`schoolfees-dev`). **No remote migration application is authorized or performed.** The final combined migration approval packet remains a controller step.

## Typed integration surfaces

- `domain/tasks.ts`: `TaskKind`, `AssignmentMode`, `TaskScope`, `TaskStudent`, `TaskOwner`, `TaskGroup`, `TaskPlan`, `TaskSummary`; `planTasks(students, owners, input)`, `ownsScope(owner, scope)`, `taskProgress(source)`, `mergeTaskSummaries(rows)`.
- `data/assignment.ts`: `AssignmentInput` validated by `assignmentSchema`; `AssignmentContext`; `AssignmentPreview` with `previewId`, `digest`, exact groups/children/fields/deadline; `assignmentContext()` and `previewAssignment(raw)`.
- `data/repo.ts`: `TaskRow`, `AcademicWork`, `TaskWork`; `resolveTask(auth)`, `resolveTaskToken(token)`, `loadTaskWork(auth)`, `listTeacherTasks(office = false)`. `TaskWork.collection` exposes the existing request/roll; photo work should attach to that canonical request, not copy the task into another workflow.
- `data/save.ts`: `TaskCredential = { id; staffId?; token? }`; `TaskSaveResult`; `saveTaskAcademicWork(auth, { kind, session?, payload })`. Credentials are resolved by trusted route/action code; SQL remains authoritative.
- `data/collection-save.ts`: `submitCollectionPayload(request, payload)` shared by existing `/r`, signed-in tasks and public task POST. It validates the entire scoped batch, uses frozen previous values and calls the canonical proposal handler.
- `data/identity.ts`: `collectionTaskSourceKey(session, studentIds, fieldIds)` matches the SQL digest for downstream idempotency. It is not a permission check.
- Server actions in `/teach/tasks/actions.ts`: context, preview, create (returns `{ id, reused, teacherId }[]`), manage, restart (returns new task id), link, academic save and collection save. Task 3 should consume source progress and current credentials; it must not persist an independent editable completion flag.
- Task summary states: `to-assign`, `waiting`, `to-approve`, `complete`, `revoked`; optional `rejected` count distinguishes review outcome. A completed rejected round is not a target for reminders: the explicit restart creates the new outstanding round.

## Migration absence behavior

Existing Students/profile/menu screens do not query the new task table during their ordinary load. The directory's new filter/context reads existing collections, enrolments and approved photos. Opening assignment can read its context before migration, but preview/create visibly reports unavailable instead of pretending work was assigned.

Needs you and the new teacher task hub render a visible task-unavailable state while the existing inbox remains usable. Existing `/r` collection reads/saves and collection review recognize only an explicit missing `teacher_tasks` table (`42P01`/`PGRST205` naming that table) as the additive-schema fallback. Permission/network/other query failures are not treated as empty task lists. Other failures stay visible or fail closed. New task-only URLs cannot work until the migration is applied.

## Verification evidence

All data was synthetic or mocked, using the isolated checkout and local dependencies. No environment files, school rows, real teacher tokens or provider credentials were read or written by this task.

RED/GREEN sequence:

- Initial scope/academic-save tests failed on missing modules, then passed after implementation (12 + 4 tests). This was a missing-module RED, not an assertion failure.
- Added regression assertions for reviewed rejection and revoked-task dedupe: both failed (`to-approve` instead of complete; old task instead of current), then passed after the progress/dedupe fixes.
- Actual SQL test with an incomplete preview member list initially failed because creation did not reject it. SQL now requires exact preview membership and current scope.
- A final SQL fault-injection test suppressed frozen-member insertion: creation initially accepted the shortened list. A post-insert exact-membership assertion now aborts that transaction. The fixture's initial quoting typo was corrected before observing the intended failing assertion; this is not multi-session race proof.
- Actual SQL recipient-mismatch assertion initially failed because the old implementation reused a different owner. Creation now raises `recipient_changed`; the proof passes.
- SQL proof additionally exercises 600-child source identity, same-preview replay, different-preview dedupe, canonical roster mismatch, inactive/current ownership, moved membership, out-of-scope answers, forced academic actor/source, writer refusal, decided-answer replay, revocation, reassignment and invalid old capabilities, explicit fresh round and official values on the new snapshot. An unauthorized decision after a simulated official write aborts the transaction and leaves no official record.

Checks:

| Check | Result |
| --- | --- |
| Original full `npm test` | 183 files: 181 passed, 2 failed; 13,474 tests passed and 3 failed. Three failures were missing expectations for the two new routes/admin coverage; one suite failed because the profile fixture traversed the new server action import. Both causes fixed. |
| Focused final Vitest run | 9 files, **375 tests passed**: four teacher-task suites, role expectations, Student360 streaming and three inbox suites. |
| `node tests/sql/teacher-tasks.mjs` | **Passed** using controller-provisioned PGlite 0.5.10 / PostgreSQL 18.6 in memory. Executes the actual migration against synthetic prerequisite schema. |
| Type generation | Passed after approved local dependency access. Initial default typecheck then hit Node's 2GB heap limit. |
| `node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit` | Passed after correcting one Supabase nested-join inference error; final repeat passed. |
| ESLint on all changed/new TS, TSX and MJS files | Passed, zero errors/warnings on final run. Earlier single unused import warning fixed. |
| `git diff --check` | Passed; only existing checkout LF/CRLF notices. |

The controller requested no second full-suite run after the focused fixes; the final complete suite is Task 4. Initial testing through the original read-only dependency junction failed with EPERM before tests ran; the controller copied dependencies to the task workspace and replaced the junction. No original checkout was modified.

The SQL runner takes only a local package path and cannot connect to a hosted database. `.github/workflows/teacher-task-sql.yml` installs the pinned disposable runtime and runs the same fixture in CI. It has been authored, not run remotely. The fixture executes the new SQL but uses canonical academic-writer doubles: it proves scope/delegation/refusal and transaction behavior, not the full existing writers' audit/lock implementations. PGlite's single session does **not** prove multi-session race behavior or PostgreSQL 17 hosted integration.

## Remaining checks and handoff

- Independent review, browser phone/desktop flows, Hindi/English acceptance, production build/bundle checks and final full suite are Task 4/controller work; not claimed here.
- New academic task forms support explicit server drafts and safe command retry but do not yet have the existing collection form's durable local-draft recovery. Browser acceptance should exercise navigation/loss/retry behavior.
- Automatic class responsibility selects current primary `class_teacher` assignments. Assistants retain their existing canonical screens; the new automatic assignment preview does not silently choose an assistant as the primary owner.
- Photo proposal storage, image processing, admin photo decisions, logo/template behavior and AiSensy delivery remain Tasks 2/3. The shared types/collection source are the integration boundary.
- No push, merge, deployment, remote migration, school-data write or real send was performed. PR97 was not merged. Controller-owned planning/inspection evidence is excluded from this task's commit.
