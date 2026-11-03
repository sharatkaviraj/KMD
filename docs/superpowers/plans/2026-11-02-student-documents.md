# Student Documents Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for native execution, with one fresh whole-branch review. Owner repository rules delegate implementation and release without additional approval gates.

**Goal:** Open, add and remove student documents from a clear, app-native Documents tab.

**Architecture:** A focused client list uses existing authenticated document URLs and a lazy upload sheet using existing upload transports. A small server action checks the document's own student and revalidates both profile entry points. The profile server supplies the staff-specific storage mode and suppresses mutations while previewing.

**Tech Stack:** Next.js 16.4.3, React 19, TypeScript, VX kit, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-student-documents-design.md`

## Global Constraints

- Existing private routes, upload transports, permission checks and TEST isolation remain authoritative.
- No migration or financial/provider writes.
- English/Hindi/bilingual, dark/light, 320px phone and desktop drawer.
- Keep source records private; synthetic fixtures only.

## Review Focus

- Upload failure retains the file, type and retry identity; metadata edits start a new request.
- An unknown storage mode cannot silently select a provider.
- A failed document read never shows an empty/completed claim.
- Removal authorizes the document's actual student; preview/denial cannot remove anything.
- Long names, keyboard file selection and small-screen sheets remain usable.

### Task 1: Implement and verify the complete student documents flow

**Files:**
- Create `src/vx/screens/admin/student-documents.tsx`, `student-document-upload.tsx`, `student-document-actions.ts`, `student-documents.css`.
- Modify `student360.tsx`, `student360-page.tsx` for in-profile composition and server upload-mode selection.
- Extend synthetic profile fixtures and add `tests/mobile-ui/student-documents.spec.ts` plus `tests/student-document-actions.test.ts`.

**Interfaces:** `StudentDocuments({ studentId, documents, canManage, uploadMode, unavailable })` consumes the existing profile document view model; `removeStudentDocument(documentId)` returns `{ ok: boolean }` after permission, preview and actual-student checks.

- [ ] Add failing browser tests for file links, persistent Add, in-profile upload validation/retry, read-only/error states, keyboard and responsive layouts. Add failing action tests for authorization, preview, actual-student scope and failure.
- [ ] Run focused tests and confirm failures match the missing behavior.
- [ ] Implement the list, sheet and guarded action with the existing transports and VX controls. Keep issued certificates below uploads.
- [ ] Run focused tests, full unit suite, typecheck, lint, theme/import checks and production build/bundle checks. Expected: all required gates pass; record pre-existing warnings honestly.
- [ ] Review the complete branch with a fresh reviewer and fix material findings with reproducing tests.
- [ ] Update progress/decisions/evidence, commit, open PR, merge after green CI, and verify the production deployment and live routes.
