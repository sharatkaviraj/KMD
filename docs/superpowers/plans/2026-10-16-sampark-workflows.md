# Sampark Teacher Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** One simple scoped teacher task from the student's record or Needs you, completed via login or WhatsApp link with trustworthy review and delivery states.

**Architecture:** Extend existing collection requests and canonical marks/attendance writers. Task orchestration references their canonical records and computes completion from them; it must not introduce a second marks, attendance or student ledger. Reuse the existing message provider and durable outbox patterns. Additive schema changes are authored and locally tested but never applied remotely without exact-target approval.

**Tech Stack:** Existing Next.js 16.3.5, React 19, TypeScript, Tailwind 3, Supabase `vppsone` schema, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-sampark-workflows.md`

## Global Constraints

- Keep current UI and navigation; bilingual strings and current permission/client boundaries.
- Use synthetic/local fixtures and mocked transport only. No live school data or token mutations.
- Original repositories stay unchanged. Work on `codex/sampark-teacher-workflows`, baseline `dd1e9a5`.
- Code publication/deployment authorized; database migration execution needs separate approval.
- Worker model GPT-6 Astra with extra-high reasoning. No worker-spawned subagents.

## Review Focus

- Interrupted and repeated create/save/send resumes the same operation, including lost responses.
- A changed teacher assignment, inactive staff or revoked token denies stale read and write paths.
- A partially missing class/house/route/subject assignment never drops or broadens selected students silently.
- Pending/rejected detail or photo proposals never replace the official record/portrait; stale approvals refuse.
- Provider acceptance is not delivery or completion; unknown attempts are never blindly retried.

### Task 1: Shared tasks, assignment and teacher entry points

**Files:** Create `src/modules/teacher-tasks/{domain,data,ui}/`, task routes under `/teach/tasks` and a scoped public route as needed, additive task migration and `tests/teacher-tasks*.test.ts`; modify existing Students, student profile, Needs you and teacher menu entry points.

**Interfaces:** Consume existing collection requests/members/submissions, marks writer and register writer. Produce typed task summaries and scope planning APIs in `modules/teacher-tasks`; record their final signatures in the task report for photos and messaging. A collection task references one existing collection request; marks/attendance task references its canonical paper/register scope. Completion is derived from source records, not an independent editable status.

- [x] Write and run failing tests for selected/common and class/house/route/subject partitioning, missing/ambiguous responsibility, scoped current assignment, cross-entry completion and idempotent creation.
- [x] Implement server-validated previews, durable duplicate prevention and current-authority checks. Create compact Needs you groups with assignment sheet, selected Students/filter and profile actions, and unified teacher work entry. Public and login save paths call the same canonical handlers.
- [x] Exercise revoked/inactive/reassigned links, approval separation and direct audited marks/attendance saves with synthetic tests. Run scoped unit tests, typecheck and lint. Expected: changed paths pass, no external mutation.
- [x] Record interfaces, migration scope, evidence and concerns in `docs/evidence/sampark-workflows/task-1-report.md`; commit only task files.

### Task 2: Approved portraits, staff photo controls and authentic logo

**Files:** Extend collection photo data/UI and approval paths; add shared photo editing controls, account/staff photo actions and additive schema where required. Modify existing profile avatar, Students layouts, Teachers list/profile and shell/sign-in/icon. Add `tests/profile-photo*.test.ts` and synthetic UI fixtures.

**Interfaces:** Use Task 1's collection task identifiers and authorization to allow photo proposals from the same task through either entry. Expose only approved student photos to existing official-avatar readers. Reuse `place_student_photo` and retain prior-photo history. Staff-own-photo follows established policy; document any necessary conservative decision.

- [x] Verify source School Fees compression behavior and authentic logo asset, and write failing tests for validation, cancel/save, stale review, unauthorized staff and pending-photo visibility.
- [x] Implement preview, camera/file/drop, compression, explicit Save/Cancel and consistent approved-avatar readers. Wire teacher photo task and admin review; wire current-role staff editing and logo.
- [x] Run scoped unit/type/lint and synthetic desktop/mobile photo tests. Expected: official image changes only at authorized save/approval and cancellation is inert.
- [x] Record exact migration scope, policy choice, source asset and evidence in task-2-report; commit only task files.

### Task 3: AiSensy task dispatch and follow-up

**Files:** Extend existing staff-notices/collection messaging seams and migration RPCs as needed; wire task preview send/remind/status UI; add `tests/teacher-task-delivery*.test.ts`.

**Interfaces:** Consume Task 1 task IDs, current recipients, canonical completion and scoped URL. Reuse claim/stamp/finish semantics and existing AiSensy response classifier. Unknown prevents retries until reconciliation; reminders only when canonical work remains pending.

- [x] Write failing mock tests for double taps/concurrent claim, accepted/no receipt/timeout/429/5xx, completed-before-send and recipient/token changes after preview.
- [x] Implement reviewed enqueue/dispatch, stale-preview revalidation and honest delivery/opened/submitted/approved summaries. Keep real provider disabled under tests; do not inspect credentials.
- [x] Run scoped tests/type/lint; document deployment variable/template names without values and any provider gate remaining. Expected: no duplicate or ambiguous retry.
- [x] Record evidence in task-3-report and commit only task files.

### Task 4: Integrated verification and authorized release

**Files:** Synthetic Playwright fixtures/tests and screenshots under `docs/evidence/sampark-workflows`; update PROGRESS/DECISIONS and release evidence.

**Interfaces:** Exercise the integrated flows from Tasks 1–3. Inspect exact target/migration scope before asking for DB approval through parent; deployment must not make required missing schema break existing screens.

- [x] Run appropriate complete lint/type/unit/build and meaningful mobile/desktop interrupted/repeated flow tests. Inspect screenshots.
- [ ] Dispatch independent review with GPT-6 Astra extra-high; fix important findings and verify regressions.
- [ ] Prepare exact migration approval request if required. Publish PR only after local reviewable implementation; attach it to task. Follow CI and existing merge workflow only when required checks and deployment dependencies are satisfied.
- [ ] Verify deployed exact commit and safe read-only relevant routes. Record passed/failed/not-run checks and all unresolved approvals/configuration. Do not claim blocked functions live.


16 October 10:31 UTC release steering: AiSensy campaigns/templates are deliberately pending in existing Integrations. Truthful automation-unavailable status and usable reviewed manual task sharing are part of Task 4. This configuration deferral does not block the remaining release after exact-target DB approval, independent review and CI; no provider setup or real messages are authorized by this plan.

16 October 11:27:28 UTC approval checkpoint: the user approved the exact three-migration packet for `schoolfees-dev` `wtgxcptmucjerhufzjcf`. Approved, not applied at this worker checkpoint. Controller rechecks hashes/target and owns application after checks and independent review. PR/CI/deployment boxes remain incomplete.
