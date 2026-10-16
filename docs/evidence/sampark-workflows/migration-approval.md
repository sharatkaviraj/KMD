# Exact SamPark migration approval scope

Prepared locally 16 October 2026. The controller owns remote application. SQL scope is stable after the legacy review fix; Task 4 local acceptance passes and independent final review remains pending.

Approval checkpoint: at 11:27:28 UTC the parent forwarded the user's “Yes implement changes in the dev” response to this exact three-migration packet for `wtgxcptmucjerhufzjcf`. The exact scope is approved, **not applied** at this worker checkpoint. The controller will reverify hashes/target and apply after local checks and independent review. No provider/message/credential action is included.

## Target

Only `schoolfees-dev`, project `wtgxcptmucjerhufzjcf`, ap-south-1, PostgreSQL 17. Controller read-only metadata freshly at 11:00 UTC verified that the production Vercel public Supabase URL points here, 304 migrations applied, latest `20261011093044_dev_fee_collector_posts_payments`. The controller subsequently confirmed the canonical functions/tables consumed here exist and the four new tables do not. Recheck immediately before approved execution.

Protected live School Fees project `vgqyilgstjvgohrsiwkb` is excluded. No remote migration, data, provider, campaign, credential or configuration change has been performed by Task 4.

Controller's 11:13 UTC read-only preflight found none of the six exact task contract codes in `message_templates`. Public `NEXT_PUBLIC_SITE_URL` is `https://vppsone.vercel.app`, so manual task links use the intended VPPS origin. Only public settings/metadata were read; no credentials or mutations.

## Exact SQL in application order

| File in `supabase/migrations` | SHA256 |
| --- | --- |
| `20261016070000_teacher_tasks.sql` | `9a712c301e4ca0dcfef922f6541cd733ea2cf4300f7f463cb4c6a1eb605e612f` |
| `20261016080000_profile_photos.sql` | `fba3175a0f69e61c56cf90900ac43d61775c879d591982034d53cb8c56bd57ba` |
| `20261016090000_teacher_task_delivery.sql` | `a8567aa9a513db58059084bc73d351533e8ccc2bb013733c18b5c3c0edeb71eb` |

All application objects are in `vppsone`. [migration-catalog.json](migration-catalog.json) records exact function identity arguments, security settings, grants, index definitions, trigger definitions, policy expression, added message columns and the six contract codes, queried after applying these three files together to a disposable synthetic database.

1. Tasks: new `teacher_tasks`, `teacher_task_previews`, their PK/unique/check/FK constraints and indexes `teacher_tasks_assignee`, `teacher_tasks_current_source`. Ten functions: `teacher_task_owner`, `teacher_task_access`, `prepare_teacher_tasks`, `create_teacher_tasks`, `guard_teacher_task_review`, `save_teacher_task`, `record_collection_answers`, `manage_teacher_task`, `delegate_teacher_task_list`, `restart_teacher_task`. Trigger `teacher_task_review_admin` on existing `collection_submissions` enforces active-administrator decisions for **all collection proposals, including legacy teacher /r requests without a task**; decided proposals cannot reopen. Canonical `accept_submissions` remains unchanged; refusal in the trigger rolls back its prior official write/history/command. Unrelated direct office record and photo policy remains unchanged.
2. Photos: new `photo_proposals`, `staff_photos`, their constraints, indexes `photo_proposals_request`, `staff_photos_current`. Five functions: `guard_photo_answer`, `submit_student_photo`, `review_student_photo`, `save_staff_photo`, `ensure_student_photo_task`. Trigger `photo_answer_bound` on `collection_submissions` binds photo answers to immutable proposal bytes and administrator review. Seeds `collection_fields.student_photo` only if absent. Reuses existing canonical `place_student_photo` and private `vppsone-photos` bucket; no new storage policy or bucket.
3. Delivery: six added columns on existing `message_sends`: `task_id` FK, `task_snapshot`, `task_round`, checked `task_delivery_state`, checked `task_transport`, non-null `task_history` default `[]`; partial unique index `message_sends_task_round`; trigger `teacher_task_delivery_guard`. Eleven functions: `guard_teacher_task_delivery`, `teacher_task_has_unknown_delivery`, `teacher_task_delivery_snapshot`, `mark_teacher_task_opened`, `teacher_task_share_link`, `prepare_teacher_task_delivery`, `queue_teacher_task_delivery`, `claim_teacher_task_delivery`, `finish_teacher_task_delivery`, `reconcile_teacher_task_delivery`, `teacher_task_delivery_summary`. Six local template contracts: initial `vppsone_teacher_task_{en,hi,both}_v1` and reminder `vppsone_teacher_task_reminder_{en,hi,both}_v1`; each has teacher/task/due body parameters and one URL-button suffix. These are local contracts, not external approval or campaigns.

## Access changes

RLS enabled on all four new tables, ordinary `anon`/`authenticated` table privileges revoked, `service_role` granted all table privileges. No ordinary-client policies added to those tables. All 26 functions use security definer and an empty search path; PUBLIC/anon/authenticated execution revoked. The 21 callable functions grant execution only to service_role (besides owner); five helpers are owner-only: the three trigger helpers, `teacher_task_has_unknown_delivery`, `teacher_task_delivery_snapshot`.

On existing `message_sends`, restrictive authenticated SELECT policy `message_sends_task_private` requires `task_id IS NULL`, combined with existing permissive policies. Ordinary legacy rows retain their existing policy scope. Managed-request messages and all reserved task campaign codes must use reviewed task-delivery RPCs; old generic claim/sent routes are refused, including pre-adoption ambiguous sends until attributed reconciliation.

## Existing data and dependencies

No public-schema objects or fee-table modifications. No bulk student-record update, deletion, photo upload, task/capability creation, or message send during migration. Existing message rows receive null task fields and logical empty-array history default; existing statuses/receipts/recipients remain. The local field seed uses ON CONFLICT DO NOTHING. The six template seeds are plain INSERT: they do not overwrite existing rows; a preexisting duplicate code causes migration failure. Preflight must confirm those six exact codes are absent before application. Later authorized application actions write scoped tasks, proposals, audit history and reviewed message attempts.

Requires existing collection/academic/staff/enrolment/permission structures and canonical `accept_submissions`, `write_student_value`, `place_student_photo`, `save_marks`, `save_attendance_register`, `paper_roster`, `attendance_roster`, `school_today`. Selected task/photo readers include missing-schema fallbacks; this is not a claim that every older route has been executed without schema. The new task/scoped-link/photo-proposal/staff-photo/delivery workflow cannot be called live without these migrations. Apply approved schema before releasing dependent flows.

## Tests already executed at this checkpoint

`node tests/sql/legacy-teacher-review.mjs`: RED on original SQL (office canonical approval succeeded); GREEN after fix for office accept/reject atomic refusal, unchanged proposal/history/command rows, administrator canonical write/replay, immutable decision and unrelated direct office writer.

`node tests/sql/teacher-tasks.mjs`, `node tests/sql/profile-photos.mjs`, `node tests/sql/teacher-task-delivery.mjs`: passed against actual migrations in disposable PGlite 18.6. `node tests/sql/migration-inventory.mjs`: all three migrations together passed; exact catalog generated. `node tests/sql/teacher-task-canonical-writers.mjs` verifies actual canonical marks/attendance writers and marks lock triggers through the task wrapper. Reproducible pinned PGlite 0.5.10 CI covers these checks. Task 4 reran all twenty observed-lock schedules on fresh loopback-only PostgreSQL 17.10 clusters against the exact final SQL: three task-create/restart, twelve photo-authority and five delivery schedules. All passed; servers stopped, port 5432 released and temporary password files removed. Full local gates and limitations are in [Task 4 evidence](task-4-report.md). This packet does not replace independent review or required CI.

## Rollback and deliberate deferral

Prefer restoring the previous known-good app deployment while retaining additive tasks, proposals, histories and private images. Administrator legacy review remains compatible with canonical review; office legacy review is deliberately refused even under old code. Old generic sends for newly managed requests/reserved campaigns remain blocked. Existing unrelated office direct writes/photos and unmanaged messages remain compatible. An operational pause is to stop new task creation/sharing through the UI and leave provider configuration unavailable; if a schema-level emergency disable is necessary, separately review revoking the affected service RPC grants rather than deleting data. Do not drop populated tables or delete uploaded images: approved portraits may reference proposal paths. Destructive schema/data reversal needs a separately reviewed backup/data-preserving plan.

Per the user's 10:31 UTC steering, AiSensy campaign/template setup is deliberately pending in existing Integrations and is **not a blocker for the remaining release** after DB/review/test gates. Automated task dispatch remains unavailable without explicit provider configuration and six verified contracts. Manual reviewed task-link sharing remains usable; opening WhatsApp is not a provider receipt, send confirmation, teacher opening, submission or approval. This packet does not authorize campaigns, provider configuration, credential changes, or any real message.
