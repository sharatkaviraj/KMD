# School Office Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deploy school study certificates, source-aware record readiness, auditable government reference/return work and separate official examination records in One's existing UX.

**Architecture:** One-owned records live in `vppsone`; existing canonical identity readers provide student facts, and Fees remains financial authority. Server-authorized commands create immutable certificate snapshots and private stored PDFs. Government formats are explicitly versioned; unverified destinations produce manual reference sheets only. Existing profiles, inbox and Exam Office link to the new records rather than duplicating them.

**Tech Stack:** Existing Next.js 16.4.3, React 19, TypeScript, VX UI, Supabase, react-pdf, SheetJS and Vitest; no new dependency.

**Spec:** `docs/plans/2026-11-01-school-operations-ui-ux-plan.md`. The owner approved implementation/live deployment and selected manual signature, existing letterhead and `VPPS/STUDY/<session>/0001` on 1 November 2026.

## Global Constraints

- All work on D:. Preserve unrelated source-tree edits; work from `c3c05f1` on `feat/school-office-operations`.
- New application database objects belong to `vppsone`; no Fees ledger/provider writes or real messages.
- UI uses existing VX tokens, components, en/hi/both helpers and mobile/desktop compositions.
- Current canonical student/session identity, TEST confinement and view-as checks apply before writes and private reads.
- Number allocation is atomic and command replay idempotent. Reprints retain original bytes and never imply a physical signature.
- No current PSP upload contract is established. Reference sheets say manual entry; compatible adapters require verified specimens.
- Official outcomes never replace internal assessment marks. Unknown/missing results remain pending, not zero/fail.
- Live deployment is authorized; real certificate issuance, portal submission and test sends are not part of release verification.

## Review Focus

- A network retry after serial reservation recovers one issue and one stored artifact (Tasks 1-2).
- Historical or quarantined identity cannot be described as current enrolment (Tasks 1-2).
- Hindi, long names and script changes remain readable without changing old PDFs (Tasks 1-2).
- A completed download cannot imply portal acceptance or a signed document (Tasks 1, 4).
- A stale import preview cannot overwrite a human correction or protected source fact (Task 4).

### Task 1: Certificate rules and persistent command model

**Files:** Create `src/modules/certificates/domain/certificate.ts`, `tests/school-office-certificate.test.ts`, and an additive certificate migration; modify `src/platform/auth/permissions.ts`.

**Interfaces:** `CertificateTemplate`, `CertificateFacts`, `CertificateSnapshot`, `certificatePreflight(facts, template)`, `renderCertificateBody(snapshot, language)`, `certificateSerial(prefix, session, number, test)`. Database commands reserve/finish a certificate using server-provided facts, actor, template revision and command ID; arbitrary browser bodies are refused.

- [x] Write tests for missing minimal fields, unrelated optional fields, historical wording, unknown template placeholders, manual signature labeling, serial/date boundaries and permission separation. Assert `certificateSerial('VPPS/STUDY','2026-27',1,false) === 'VPPS/STUDY/2026-27/0001'`.
- [x] Run `npm test -- tests/school-office-certificate.test.ts`; expect missing-module failure first.
- [x] Implement pure schemas/rules, minimal capability grants, immutable template/issue/artifact/event tables, locked series and idempotent commands. Seed the owner-approved manual-signature template; TEST has a separate number series.
- [x] Run the focused tests and read-only catalog/transactional synthetic database checks. Expect serial and replay invariants with denied cross-scope access.
- [x] Commit only the task's files and record tests in the ledger.

### Task 2: Authorized issuance, private PDF and recovery

**Files:** Create `src/modules/certificates/data/{repo,issue}.ts`, `src/modules/certificates/ui/certificate-pdf.tsx`, certificate actions and private issue/PDF routes under `src/app/(app)/school-office/`, plus `tests/school-office-issue.test.ts` and route tests.

**Interfaces:** `issueStudyCertificate({studentId,sessionLabel,commandId,newIssue?,supersedes?,reason?})`, `certificateForViewer(id)`, `renderStudyCertificatePdf(snapshot)`, `ensureCertificateArtifact(issue)` and typed issue/result data consumed by Task 3.

- [x] Write failing orchestration tests for replay, storage/render failure, unavailable source, private download denial, exact stored-byte reuse and signature-required reprint.
- [x] Implement authoritative minimal fact reads, existing scope guards and version checks; freeze school identity, template and facts. Render bilingual/script-aware PDFs without loading the signature image. Store bytes privately with content hash, then acknowledge readiness; retries reuse the reserved issue.
- [x] Add correction/cancellation commands with reason, immutable history and distinct signature/document states. Reprints never allocate a serial.
- [x] Run focused domain/orchestration/route tests. Generate synthetic long-name English/Hindi/bilingual PDFs and visually inspect them. Expect no clipped text and no signature image.
- [x] Commit and record verification.

### Task 3: Integrated certificate UX and School Office register

**Files:** Create `src/vx/screens/school-office/{certificates,text,office.css}.tsx` as appropriate, register page/loading/error and configuration UI; modify Student 360, `src/vx/nav.ts`, phone Menu, Settings and role expectations. Tests: `tests/school-office-ui.test.tsx` and navigation/role tests.

**Interfaces:** Task 2's issue command/result and certificate list; contextual `StudyCertificateButton` accepts student/session and current permission, and links to an existing issue on repeat use.

- [x] Write failing view tests for one-click ready issue, inline blockers, unavailable versus empty, retained command on retry, and permission-filtered navigation.
- [x] Implement profile action and School-issued section alongside uploaded documents; register search/session/status filters, issue detail/history, reprint/correct/cancel and versioned template settings. Use existing VX controls/sheets.
- [x] Add one School Office People/Menu/search destination while preserving bottom tabs. Show setup links through actual configuration permission.
- [x] Verify at 390/1280px plus light/dark, hi/en/both and keyboard/Back. Run focused tests and existing navigation/role suites.
- [x] Commit and record verification.

### Task 4: Record readiness and government batch exchange

**Files:** Create `src/modules/government-records/{domain,data}/`, associated School Office screens/routes/tests and additive tables for adapters, batches, rows, external links and receipts. Extend existing Needs you with a scoped summary.

**Interfaces:** `preflightReturn(rows, adapter)`, `prepareReturn(...)`, immutable batch receipt, `stageReturnImport(...)` and `applyReturnImport(...)`. Reference adapter is explicitly `manual_reference`; verified adapter metadata pins headers, field mapping, format, source specimen hash and applicable school/session.

- [x] Write failing tests for leading-zero IDs, Hindi, formulas, duplicates, wrong school/session/version, missing-versus-zero, protected field conflicts, repeated apply, stale revisions and distinct exported/submitted/accepted states.
- [x] Implement destination/session/module selection and purpose-specific source checks. Produce a deterministic stored reference workbook immediately; verified CSV/XLSX formats activate only against an operator-reviewed specimen and supported shape.
- [x] Implement staged supported-file parsing/diffs and idempotent allowed external-ID/status updates. Route protected-source differences for source correction; never update Fees or internal marks. Acknowledgement evidence is required for accepted rows and retained privately.
- [x] Add batch UI/resume/history, adapter setup and exception links. Unsupported format/template remains a clear reference-sheet fallback.
- [x] Run focused tests, synthetic export/import round-trip and access checks; commit and ledger evidence.

### Task 5: Authority-specific readiness, deadlines and official results

**Files:** Create `src/modules/official-results/{domain,data}/`, Exam Office board-readiness/outcomes routes/screens/tests and additive authority-specific records. Extend Calendar with verified linked dates and Exam Office links.

**Interfaces:** Versioned readiness configuration/evidence per authority/session/cohort, external-ID links from Task 4, append-only official-result revisions with verified source, attempt and nullable/pending values.

- [x] Write failing tests separating Class 5/8 from RBSE, attempts and subject sets, unverified/conflicting deadlines, pending results, corrected outcomes and immutable internal marks.
- [x] Implement office-managed applicable checklist/circular source, exception-first student readiness and source-linked deadlines. No guessed annual mandatory requirements.
- [x] Implement official outcome entry/import only from supported verified evidence, supersession and source provenance; display registered/appeared/available/pending denominators with explicit scope.
- [x] Integrate in Exam Office and Calendar without a second editable readiness store. Run focused tests; commit and record evidence.

### Task 6: Whole-release validation, migration and live deployment

**Files:** Required evidence/runbook, `docs/PROGRESS.md` and `docs/DECISIONS.md`.

- [x] Run typecheck, lint, theme/port/architecture, full Vitest, production build and bundle checks; investigate failures and run meaningful browser workflows against synthetic fixtures.
- [x] Run a fresh whole-branch code review; address material findings with reproducing tests.
- [x] Confirm One project identity and deployment environment. Apply only new reviewed additive One migrations, verify privileges/policies and rollback-only synthetic command checks; keep financial/provider flags unchanged.
- [ ] Push branch, open PR, wait for CI, merge when green, and verify the production SHA and live route/asset behavior. Use authorized synthetic TEST journeys; issue no real certificate or portal submission during QA.
- [ ] Record actual coverage and configuration dependencies, update progress and deliver the live URL.
