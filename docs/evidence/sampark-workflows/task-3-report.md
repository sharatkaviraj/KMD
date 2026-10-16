# Task 3 — reviewed teacher-task delivery

The initial implementation evidence below is retained as recorded. The appended **Fix round 1** section supersedes its migration hash and records the two Important review fixes.

Implemented locally on `codex/sampark-teacher-workflows`, based on `e4d5c84423fbe3fd4d5389d387dc2ef28968a112`. Commit title: `feat: add reviewed teacher task delivery and reconciliation`. Independent review and integrated Task 4 checks remain with the controller. No remote migration, campaign creation, credential/configuration change, real message, push, PR, merge or deployment was performed. All recipients, capabilities and receipts exercised here were synthetic; transports were mocked.

## Implemented flow and interfaces

The existing collection `message_sends` outbox and `messages-repo.ts` dispatch module own task sends. There is no third queue or sending service. `/inbox?task=<id>` now shows a delivery panel beside the existing task management controls. Task 1 creation/delegation/restart result contracts remain unchanged.

1. `previewTaskDeliveryAction(taskId, initial|reminder)` requires `collection:manage`, rejects role-preview writes, and calls `prepare_teacher_task_delivery`. The preview displays the actual normalized destination, recipient, title, due date and exact recipient-language campaign body. It contains no capability. The stored preview binds actor, digest, expiry, current ownership/scope/roster or fields, task and canonical request credentials, phone/contact version, name, deadline, language and template row checksum.
2. `confirmTaskDeliveryAction(previewId,digest,api|manual)` revalidates the reviewed snapshot in `queue_teacher_task_delivery`. API availability is checked before enqueue. The database reuses one row for the same task, reviewed version and initial/day-reminder round. Changing a relevant authority, contact, language or template value requires a new review.
3. `dispatchTeacherTaskMessage(actorId,messageId)` uses the collection provider seam. `claim_teacher_task_delivery` locks the task, the current actor/recipient staff rows in ID order, then the message; rechecks permission, current task access, reviewed recipient and canonical pending work; and atomically writes the exact attempt marker and unknown state before transport. A competing claim cannot enter transport. `finish_teacher_task_delivery` can finish only that actor/row/attempt while it is unknown. A failed/missing finish returns reconciliation even when the worker has an in-memory receipt.
4. Manual fallback passes the same queue/claim/current-authority gates, records manual provenance and prepares a recipient-specific WhatsApp URL. The UI says the link was prepared and sending is unconfirmed. Preparing or opening a link is not proof of sending, acceptance or delivery. Internal legacy storage uses `status=sent` plus `sent_at` for this terminal handoff; the task-specific state is `manual_opened`, and ordinary authenticated legacy readers cannot see these new task rows.
5. Unknown results block new previews from being enqueued, API/manual claims and new task share-link issuance. `reconcileTaskDeliveryAction(id,attempt,accepted|not_sent,note)` requires management permission and an exact current attempt, and preserves the actor, time, resolution and bounded human note. Human confirmation is labeled separately from an AiSensy receipt. An explicit checked-not-sent resolution permits a later reviewed retry. There is no age-based sweeper or automatic unknown retry.
6. Current pending work comes from canonical collections, marks or attendance. A collection answer awaiting office review is already submitted, including Task 2 portrait proposals; rejected reviewed work is also not outstanding teacher work. The summary reports answered/approved/rejected counts separately, and only offers reminders for pending work.
7. `mark_teacher_task_opened` records authorized public task, signed-in task and canonical `/r` access. It validates current task/canonical credentials and staff access. `collection_requests.opened_at` means the office opened the request for work and is deliberately not treated as teacher access. Opening never marks work submitted or approved.

Server interfaces added: `loadTaskDelivery`, `managedTasksForRequests`, `dispatchTeacherTaskMessage`, the three delivery actions, and typed delivery preview/result/summary contracts. Managed-request lookup chunks ID lists and fails closed on lookup errors. Tokens remain server-side except explicit authorized share/manual/provider handoff paths.

## Existing collection and notice compatibility

Legacy collection sends linked to a managed task now route to reviewed task delivery. Request details, message rows and round boards replace ordinary app-issued copy/manual controls with the task route; managed round tokens are omitted from client props. Legacy dispatch refuses these requests before claim/transport, manual/cancel candidates refuse them, and the database guard blocks a stale generic claim/sent stamp even if the caller omitted task metadata. Unrelated collection sends retain the existing claim/finish and manual behavior. Historical legacy rows remain readable.

Pre-adoption legacy unknown attempts for the same canonical request also block task sends/share/manual. They appear in the task's history and use the same attributed reconciliation. A known legacy draft cannot be reconciled; confirmed old provider refusals do not become unknown merely because they have `status=failed`.

The shared staff-notice classifier now rejects a truthy provider `error` in HTTP 200 even when a receipt field is present. Existing staff-notice 5xx classification is retained. The task wrapper treats 5xx as unknown and requires a strict nonempty receipt for acceptance. Unrelated collection HTTP-success/no-ID behavior remains as before. Covering tests include both consumers.

## Exact additive migration inventory

File: `supabase/migrations/20261016090000_teacher_task_delivery.sql`.
Final tested local file SHA256: `327A2F175A77B21D353E6761B120F88A83E4A8F175EA8C95B68D5C4E2461F930`.

All objects are in `vppsone`. No public/fee objects, storage buckets/policies or existing function definitions are modified. No new table or enum is created.

Six columns on existing `message_sends`:

| Column | Definition / old-row effect |
| --- | --- |
| `task_id` | nullable UUID FK to `teacher_tasks(id)`; default PostgreSQL NO ACTION, no cascade; existing rows stay NULL |
| `task_snapshot` | nullable JSONB; existing rows stay NULL |
| `task_round` | nullable text; existing rows stay NULL |
| `task_delivery_state` | nullable text CHECK: ready, unknown, rejected, accepted, manual_opened, human_confirmed; existing rows stay NULL |
| `task_transport` | nullable text CHECK: aisensy, manual; existing rows stay NULL |
| `task_history` | JSONB NOT NULL DEFAULT `[]`; existing rows read an empty history |

`message_sends_task_round` is a partial unique index on `(task_id,(task_snapshot->>'version'),task_round) WHERE task_id IS NOT NULL`. It does not index/dedupe legacy rows. There is no backfill of legacy rows into task rows. New task sends use `task_id`; their `request_id` remains NULL, retaining existing nullable request/recipient FK compatibility and the existing sent/sent_at CHECK.

`message_sends_task_private` is a new **restrictive** authenticated SELECT policy, `USING(task_id IS NULL)`, intersecting the existing permissive SELECT policy. It hides new task review/history rows from ordinary authenticated legacy queries; service-role RPCs can still access them. Historical rows with NULL task_id remain visible. There is no new client write grant.

`teacher_task_delivery_guard` is a BEFORE INSERT OR UPDATE row trigger on `message_sends`, executing `guard_teacher_task_delivery()`. New task rows and updates to existing task rows require the transaction-local exact row authorization set by these RPCs. For task-adopted legacy requests, a generic sent stamp or new provider marker is refused with `task_delivery:review_required`. The guard also catches attempts to remove a task_id. It leaves unrelated collection transitions unchanged. Reconciliation of managed legacy history sets this same exact-row transaction context.

Eleven new functions, all SECURITY DEFINER with empty search_path and qualified relations:

| Function signature | Callable grant |
| --- | --- |
| `guard_teacher_task_delivery()` → trigger | internal trigger helper |
| `teacher_task_has_unknown_delivery(uuid)` → boolean | internal helper |
| `teacher_task_delivery_snapshot(uuid)` → jsonb | internal helper |
| `mark_teacher_task_opened(uuid,uuid,text,text)` → boolean | service_role |
| `teacher_task_share_link(uuid,uuid)` → text | service_role |
| `prepare_teacher_task_delivery(uuid,uuid,text)` → jsonb | service_role |
| `queue_teacher_task_delivery(uuid,uuid,text)` → jsonb | service_role |
| `claim_teacher_task_delivery(uuid,uuid,text,text,boolean)` → jsonb | service_role |
| `finish_teacher_task_delivery(uuid,uuid,text,text,text)` → jsonb | service_role |
| `reconcile_teacher_task_delivery(uuid,uuid,text,text,text)` → boolean | service_role |
| `teacher_task_delivery_summary(uuid,uuid)` → jsonb | service_role |

All eleven explicitly revoke execution from PUBLIC, anon and authenticated. Exactly eight callable RPCs grant execution to service_role. Helpers are invoked from owner-executed functions/trigger. No existing RPC signature or grant changes.

Six `message_templates` rows are inserted, listed below. Each has staff audience, active=true, URL button=true, variables `[teacher,task,due]`, and sort orders 80–85. Both body columns intentionally hold the exact same recipient-language body, so an office account's language does not silently change what is sent. These are local contract definitions, **not evidence of Meta approval or a live AiSensy campaign**.

Unapplied prerequisites: the existing collection/staff/academic/attendance schema and message/provider lifecycle migrations; reviewed Task 1 `20261016070000_teacher_tasks.sql` and its helpers/preview/task tables; reviewed Task 2 migration for the full portrait workflow. Task 3 uses canonical collection answer status and does not add a separate photo status. This report does not authorize applying any migration. Task 1/2/3 remain pending the controller's exact-scope approval packet. Existing app deployments must not start using Task 3 before these prerequisites and this migration are applied in order.

## Provider setup contract and gaps

Variable **names** used: `MESSAGE_PROVIDER`, `AISENSY_API_KEY`, `AISENSY_TASK_CONTRACT`, `AISENSY_TASK_CAMPAIGN_ORIGIN`, optional `AISENSY_CAMPAIGN_PREFIX`; the existing site-origin resolution uses `NEXT_PUBLIC_SITE_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`. No secret or deployment values were read, copied, stored or changed.

Task availability requires the explicit AiSensy selector, a nonempty key, the v1 task contract marker and a declared campaign origin exactly matching the app's resolved origin without trailing slash. A configured mock is explicitly test mode. NODE_ENV test/Vitest always prevents the real task adapter from sending. Missing or mismatched configuration returns unavailable; `VPPSONE_ENV=dev` is not proof of real delivery. The marker/origin are a setup attestation gate, not independent proof of remote approval. A safe deployment must verify all six live campaigns and the correct VPPS host before enabling these settings. Optional prefix replaces only the leading `vppsone` in each name and is limited to letters, digits, underscore and hyphen.

The exact base campaign names and required bodies are:

| Campaign | Body |
| --- | --- |
| `vppsone_teacher_task_en_v1` | `{{1}}, task: {{2}}. Due: {{3}}. Use the button to open your work.` |
| `vppsone_teacher_task_hi_v1` | `{{1}}, कार्य: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।` |
| `vppsone_teacher_task_both_v1` | `{{1}}, कार्य / Task: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.` |
| `vppsone_teacher_task_reminder_en_v1` | `{{1}}, work is still pending: {{2}}. Due: {{3}}. Use the button to open your work.` |
| `vppsone_teacher_task_reminder_hi_v1` | `{{1}}, कार्य अभी बाकी है: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।` |
| `vppsone_teacher_task_reminder_both_v1` | `{{1}}, कार्य अभी बाकी है / Work is still pending: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.` |

The frozen recipient preferred_language selects en/hi/both. Parameters are exactly three body values in order: teacher display name, task title, due date (or `-`). The bilingual bodies use each numbered placeholder once. Every campaign requires one dynamic URL button at index 0, with a fixed verified VPPS base `<campaign-origin>/t/tasks/` and the current task capability as its dynamic suffix. The request's `buttons` shape is `[{type:"button",sub_type:"url",index:0,parameters:[{type:"text",text:<suffix>}]}]`. The suffix is separate from `templateParams`; it is not a fourth body parameter. Button labels can be the approved language-appropriate open-work label; code addresses index 0, not a label. Existing Sampark-host buttons cannot be assumed compatible.

The existing endpoint contract is campaign/t1/api/v2 with `campaignName`, `destination` (91 + normalized Indian number), `userName`, `templateParams`, `buttons` and private `apiKey`. Primary provider references were supplied/verified by the controller in the task brief: [API reference](https://wiki.aisensy.com/en/articles/11501889-api-reference-docs), [campaign setup](https://wiki.aisensy.com/en/articles/11501891-how-to-setup-whatsapp-api-campaigns-in-aisensy). Repository references inspected: Sampark `src/lib/aisensy.ts`, request `SharePanel.tsx`, batch `SendQueue.tsx`; only their transport/UI contract informed this implementation.

Current configuration/evidence gap: the controller's decrypt=false deployment-key inspection found no AISENSY/MESSAGE_PROVIDER/STAFF_NOTICE/WHATSAPP key names. No approved/live campaign, dependable provider receipt example, verified callback authentication scheme or actual delivery receipt has been demonstrated. The strict existing receipt-key contract (`submitted_message_id`, `messageId`, `message_id`) is retained, not asserted to be guaranteed by the public provider docs. HTTP 200 without one of those nonempty IDs is unknown; explicit 200 error is refusal; 429 is refusal; timeout/5xx/ambiguous response is unknown. No callback or delivered state is invented. API configuration and real-message verification remain separately authorized future work.

## RED/GREEN and focused checks

Observed RED commands and failures during implementation:

- `node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-provider.test.ts`: initial classifier/configuration tests failed (three failures), including explicit HTTP 200 error overriding a receipt and the missing availability function. The dispatcher test file initially failed because its task extension did not exist; it subsequently passed eight transport/claim tests. The first action/UI runs were missing-module scaffolding failures, not behavior proof.
- `node tests/sql/teacher-task-delivery.mjs`: first failed on the absent prepare RPC. Subsequent concrete regressions failed for fields changing after review, template wording changing after review, canonical office `opened_at` wrongly counted as teacher access, legacy adopted-request bypass, a pre-adoption unknown not blocking enqueue (`expected reconcile`, actual undefined), and SQL NULL allowing reconciliation of a known legacy draft (`true` instead of `false`). Each was corrected before proceeding.
- The final language-map RED from the same SQL command was `actual 'vppsone_teacher_task_v1'`, `expected 'vppsone_teacher_task_en_v1'` at line 28. It now covers all six mappings, en/hi/both language changes before queue and claim, exact body equality and one occurrence of each rendered teacher placeholder.
- `node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-ui.test.tsx`: final preview regression was `expected ... to have a length of 1 but got 2` (one failed, three passed). The office-both UI had duplicated the exact recipient body. After the rendering fix, all four UI tests pass.
- Fresh PostgreSQL cluster-task3-2 run: double-enqueue lock schedule passed, then the concurrent phone-edit schedule failed with `Expected an observed database lock wait, but operation finished`. Added ordered staff SHARE locks and post-wait permission/snapshot rechecks. Subsequent fresh runs passed.

Final GREEN commands and observed results:

```text
node tests/sql/teacher-task-delivery.mjs
PASS: reviewed phone and capability checks, canonical completion, dedupe,
unknown/manual gate, attributed reconciliation, history,
origin-independent opened evidence and SQL access controls.
exit 0

node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-provider.test.ts tests/teacher-task-delivery-dispatch.test.ts tests/teacher-task-delivery-actions.test.ts tests/teacher-task-delivery-ui.test.tsx tests/teacher-task-delivery-legacy.test.ts tests/provider-dispatch-safety.test.ts tests/provider-adapter-recovery.test.ts tests/provider-route-withdrawal.test.ts tests/staff-notices.test.ts tests/message-provider.test.ts
Test Files 10 passed (10); Tests 87 passed (87); exit 0

node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit
exit 0; no diagnostics

$paths = @((git diff --name-only) + (git ls-files --others --exclude-standard)) | Where-Object { $_ -match '\.(ts|tsx|mjs)$' }
node node_modules/eslint/bin/eslint.js @paths
exit 0; no ESLint diagnostics (Git separately printed LF/CRLF notices)
```

Earlier covering run before the final language-only mapping/render changes: 16 files / 5,128 tests passed, 25.86 seconds. It used the ten files above plus `teacher-task-actions.test.ts`, `teacher-task-assignment-recovery.test.tsx`, `teacher-tasks.test.ts`, `teacher-tasks-save.test.ts`, `teacher-tasks-collection.test.ts`, and `architecture.test.ts`. This was a selected covering run, not the full suite. No build/browser/full-suite claim is made; Task 4 owns integrated execution.

PGlite executes the authored delivery migration against a minimal synthetic prior-schema fixture and the actual Task 1 migration. It proves SQL behavior/access/refusals, not multi-connection locking. Fixtures contain no personal data and are not deployment migrations.

## Actual PostgreSQL concurrency evidence

`tests/sql/teacher-task-delivery-locks.py` uses only a fixed disposable `task_delivery_ci` database at 127.0.0.1:5432, requires PostgreSQL 17, refuses an existing schema/public student table, applies the actual unmodified task migrations and synthetic fixtures, and observes `pg_locks` plus `pg_blocking_pids` before releasing blockers. It does not accept an external database URL. CI includes this fixture in `.github/workflows/teacher-task-sql.yml` with an isolated PostgreSQL 17 service; CI has not run remotely.

Local command: `node ../run-task-delivery-local.mjs`. The workspace harness refuses occupied port/existing cluster, initializes a fresh cluster, binds only 127.0.0.1, verifies `data_directory`, runs the fixture, and stops in finally. Portable runtime: PostgreSQL 17.10 and Python 3.12/psycopg. Parent reserved the port before each run.

The initial sandbox attempt started and then cleanly stopped its disposable server when loopback connection returned EACCES; database fixture execution did not begin. A narrowly scoped tool escalation was approved for fresh local-only runs. No denied or uncertain operation was replayed. Cluster-task3-2 was the RED described above and stopped; clusters 3 and 4 passed and stopped. Final cluster-task3-5 ran the exact six-template SQL with the hash above:

```text
Disposable PostgreSQL 17.10; verified workspace data directory; loopback only.
PASS: double enqueue waited on actual task lock and reused one durable row.
PASS: observed staff lock wait, changed reviewed phone refused after commit.
PASS: observed task lock wait, rotated capability refused after commit.
PASS: actor authority rechecked after observed wait.
PASS: one claim wins; interrupted claim/stamp/finish and copy/manual paths stay gated.
Disposable PostgreSQL stopped; no system service installed.
exit 0
```

The schedules respectively prove enqueue serialization/dedupe, phone update commit before final re-read, task-token rotation commit before final re-read, removal of the actor's management permission during the observed wait, and a first uncommitted claim blocking the second until its unknown marker commits. After that commit, retries and new share issuance remain blocked, and a wrong finish attempt is refused. The manual gate itself is additionally executed by the PGlite fixture. Failed finish after a mocked accepted transport is covered by the dispatch test and never reports durable acceptance. The test does not contact AiSensy.

After the final run, `pg_ctl -D ../pg-test-runtime/cluster-task3-5 status` printed `no server running`; the disposable password file was absent. The parent was notified the reserved port was released. Stopped disposable cluster files remain in the local runtime folder for inspection; no service was installed. The harness/runtime files are outside this repository and are not committed.

## Files and self-review

New production files: `src/app/(app)/teach/tasks/delivery-actions.ts`; `src/modules/teacher-tasks/data/delivery.ts`, `delivery-routing.ts`; `src/modules/teacher-tasks/domain/delivery.ts`; `src/modules/teacher-tasks/ui/task-delivery.tsx`; the delivery SQL migration.

Existing production changes: collection `message-provider.ts`, `messages-repo.ts`, `domain/messages.ts`, `ui/round-board.tsx`; staff-notices `domain/notices.ts`; teacher-tasks `data/repo.ts`; `src/messages/setup.ts`; app routes/actions for inbox, teach/tasks, canonical r/token, collection request, messages and rounds. The reviewable diff lists their exact paths. Tests added: five `tests/teacher-task-delivery-*.test.ts[x]` files, plus four `tests/sql/teacher-task-delivery*` fixture/runner files. CI workflow and this report/PROGRESS are updated. Controller's untracked inspection/concurrency reports are preserved and excluded from the commit.

Self-review checked server/client boundaries, actual destination freezing, six language mappings, current permission/phone/credentials, strict provider classification, durable finish uncertainty, historical legacy visibility/refusal, managed manual issuance, pre-adoption unknown, and canonical opened/submitted/approved meanings. Important corrections found in that review are captured in the RED evidence above. UI uses existing card/accent/primary/border tokens and bilingual setup strings. Installed Next.js server-action and route-handler docs were read before affected API changes.

Limits: the guarantee is a single durable claim for one reviewed task/version/round until a known result or attributed reconciliation, not exactly-once delivery outside the database. Different reviewed versions are different rows; reminders have school-day rounds. Database validation linearizes at claim commit; subsequent authority changes cannot recall a transport already authorized or sent. Already copied URLs and external chats cannot be revoked by these issuance controls; current task entry checks still validate credentials. Human not-sent reconciliation can be wrong and is retained as attributed evidence. No actual provider acceptance, delivery callback, live deployment or school acceptance is claimed. Real delivery stays unavailable until separately verified setup, and all migrations remain unapplied.

## Fix round 1 — two Important review findings

Based on `1b2a882f10653da3d2944cf46d9a7d778d596caf` and the saved independent review. Commit title: `fix: reserve task campaigns and show reviewed delivery scope`. The two Minor findings remain with Task 4 as instructed. The user's subsequent steering intentionally leaves AiSensy template/campaign setup pending in Integrations; that setup is not a release blocker for the remaining application work. Reviewed manual sharing remains available without API configuration. No campaign/configuration, external message, migration or release action occurred in this fix round.

**Important 1:** Task campaigns are reserved to the reviewed path. `isTeacherTaskCampaign` reserves the `*_teacher_task` namespace, including names produced by the optional campaign prefix. `isGenericMessageTemplate` excludes them from the Messages page and from the actual `QueueMessageForm` options. `queueMessageAction` refuses a forged generic form; `queueSend` refuses a reserved template directly; ordinary `dispatch` refuses both missing and forged task metadata before claiming or transport. Existing generic queued rows with a task campaign route to Needs you instead of displaying normal send/manual controls. The real adapter also refuses a reserved campaign without a task identity, URL suffix and three body parameters, and refuses a task DTO with an unrelated campaign. Valid task DTOs still require the original task configuration/test-mode gate and authoritative RPC claim.

The existing `guard_teacher_task_delivery()` additionally resolves the template ID and refuses any INSERT/UPDATE using a reserved task campaign with NULL task_id. This protects authoritative queue/claim writes even when a stale caller omitted or misrepresented the template code. The existing exact-row RPC context guard still protects non-NULL task rows. An old queued reserved row cannot claim merely because it predates the new predicate. Historical reads remain possible. Unrelated generic composition/dispatch remains usable, with regression coverage.

**Important 2:** `teacher_task_delivery_snapshot` now returns `studentCount`, `fields:[{id,hi,en}]`, and `scope:{session,classLabel,subject:{hi,en}|null,day}`. Collection studentCount counts members once; the separate expected-answer value remains members × fields. Academic counts use the canonical paper/register roster. Field descriptors come from the requested field records; academic class/subject/date scope comes from the canonical source and display records. The delivery approval renders the actual count, bilingual field labels, session, class, subject and date where applicable, alongside the existing recipient, exact number and due date. These descriptors and counts, plus canonical academic IDs, are part of the review fingerprint and stored preview, so changes before enqueue or claim require a fresh review. No child names or capabilities were added to the preview.

Exact SQL delta: only the bodies of existing new functions `guard_teacher_task_delivery()` and `teacher_task_delivery_snapshot(uuid)` changed in the still-unapplied migration. Counts remain **six columns, one index, one restrictive policy, one trigger, eleven functions/eight service-role callable grants, and six template rows**. No new schema objects, signatures, grants, data backfills, lock statements or lock order. The snapshot adds read-only display lookups of existing `public.classes` (`class_name`, `section`, `stream_name`) and `vppsone.subjects` (`name_hi`, `name_en`), plus existing collection field labels. It does not modify any public/fee object or row. Synthetic test fixtures add their minimal counterparts only inside the disposable test database.

Current migration SHA256: `A8567AA9A513DB58059084BC73D351533E8CCC2BB013733C18B5C3C0EDEB71EB`. This supersedes the initial hash above. PGlite executed this revision. PostgreSQL concurrency was not rerun in this round per the focused instruction: the claim/enqueue locks, durable stamping and finish logic are unchanged. The previous observed-lock runs prove their exact prior SQL revision; they are not represented as a new run of this hash.

RED evidence:

```text
node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-reserved.test.ts tests/teacher-task-delivery-ui.test.tsx
2 files failed; 7 failed / 5 passed
generic FormData action: expected 'saved' to be 'error'
direct queueSend: promise resolved 'synthetic-send' instead of rejecting
old generic queued dispatch: received {ok:true}, expected {ok:false,outcome:'rejected'}
direct adapter: received {ok:true}, expected {ok:false,outcome:'rejected'}
collection preview: did not contain 'Students: 2'
marks and attendance previews: did not contain 'Students: 24'

node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-compose.test.tsx
1 failed: generic selector included all six reserved task campaign options

node tests/sql/teacher-task-delivery.mjs
Missing expected rejection: generic template IDs cannot queue reserved campaigns
```

The expanded academic SQL fixture then caught `record "s" has no field "name_hi"`, a new subject-query alias colliding with the existing staff row variable. The alias was corrected before GREEN. The first typecheck caught incomplete new test DTOs; these were completed rather than weakening the production types.

Final focused checks:

```text
node node_modules/vitest/vitest.mjs run tests/teacher-task-delivery-reserved.test.ts tests/teacher-task-delivery-compose.test.tsx tests/teacher-task-delivery-ui.test.tsx tests/teacher-task-delivery-actions.test.ts tests/teacher-task-delivery-provider.test.ts tests/teacher-task-delivery-dispatch.test.ts tests/teacher-task-delivery-legacy.test.ts tests/provider-dispatch-safety.test.ts tests/provider-adapter-recovery.test.ts tests/provider-route-withdrawal.test.ts tests/staff-notices.test.ts tests/message-provider.test.ts
Test Files 12 passed (12); Tests 103 passed (103); 25.60 seconds; exit 0

node tests/sql/teacher-task-delivery.mjs
PASS: reviewed phone and capability checks, canonical completion, dedupe,
unknown/manual gate, attributed reconciliation, history,
origin-independent opened evidence and SQL access controls.
exit 0

node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit
exit 0; no diagnostics

$paths = @((git diff --name-only) + (git ls-files --others --exclude-standard)) | Where-Object { $_ -match '\.(ts|tsx|mjs)$' }
node node_modules/eslint/bin/eslint.js @paths
exit 0; no ESLint diagnostics

git diff --check
exit 0
```

The SQL fixture also verifies one child with two requested fields has studentCount=1 and expected=2, changed field wording invalidates approval, both academic scope payloads are correct, changed class descriptors block a queued claim, and changed subject/date invalidates enqueue. The generic action tests cover all six campaigns plus a prefixed name with absent task-contract configuration, mocked ordinary AiSensy credentials, and zero fetch calls; an unrelated generic template still queues. The actual composition selector test retains an unrelated template and removes all six reserved options. No real transport was invoked.

Self-review: reservation applies in UI and server/database boundaries; old queued rows do not rely on taskId being present in a browser DTO. Display metadata is frozen and rechecked, while answer totals retain their prior meaning. Existing manual fallback, strict task provider semantics and legacy unrelated behavior pass covering tests. No full suite or real PostgreSQL server was started in this round. Controller-owned untracked files are preserved. Independent re-review and Task 4 remain; AiSensy setup is intentionally pending, not a release prerequisite for manual workflows.
