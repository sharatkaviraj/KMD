# One Student Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make One's app loading, student directory/cards and Student 360 faster and smoother, then release to live.

**Architecture:** Preserve all fresh authorization/data boundaries. Overlap independent server reads and stream informational shell health. Move query draft state into a small shared provider so input updates do not rebuild directory rows.

**Tech Stack:** Next 16.4.3, React 19.2.8, TypeScript, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-one-student-performance-design.md`

## Global Constraints

- One production only: `one.vpps.co.in`, Supabase `wtgxcptmucjerhufzjcf`.
- Fresh permissions, session/visibility/class checks and source financial authority remain.
- No new dependencies or persistent auth, money or private-photo cache.
- Bilingual copy; no real sends, payments, student edits or benchmark permission grants.
- No schema migration absent a measured need.

## Review Focus

- A pending task-field read must not serialize an ordinary directory read; a missing-field filter must still validate before selecting matches.
- Slow attendance must not delay starting portraits; photo failure still falls back safely.
- Hidden/invalid students must not start a portrait read before visibility validation.
- Fast typing, IME, Enter and external filter changes must never restore an obsolete query or lose a URL filter.
- An unavailable bridge banner must not block the shell; fresh authorization remains blocking and data reads enforce readiness.

### Task 1: Overlap authorized server reads

**Files:** `src/app/(app)/students/page.tsx`, `src/vx/screens/admin/student360-page.tsx`, `src/app/(app)/layout.tsx`, `src/platform/fees-bridge/roster-status.tsx`; existing student directory/recovery tests plus a shell-status test.

- [x] Add deferred-promise assertions: main list starts before optional task fields resolve; named missing fields wait; portraits start before attendance/school completion; rejected visibility does not start portraits; shell resolves while bridge status is pending.
- [x] Run targeted tests and observe the serialization failures.
- [x] Start fields beside session/cookies, await fields only for named filter validation and final metadata. Include portraits in the existing enrichment Promise.all. Start Student 360 portraits after the visibility fence beside school/notes. Extract a fresh async bridge-status component into a Suspense boundary.
- [x] Run the targeted student/source/auth recovery tests and preserve failure/unavailable behavior.

### Task 2: Isolate search interaction

**Files:** `src/vx/screens/admin/student-search.tsx`, `src/vx/screens/admin/students.tsx`, `tests/student-search.test.tsx`.

- [x] Add tests for two synchronized search inputs, no sibling rerenders, one navigation after a 250 ms pause, Enter immediately, URL preservation, clearing search, IME composition, filter/query replacement and unmount cleanup.
- [x] Run and observe failure before implementing the provider.
- [x] Implement `StudentSearchProvider({ query, href, children })`, `StudentSearchForm` and `StudentSearchInput`. Keep draft state and transition status local to the provider. Preserve GET form attributes and use the current filtered base URL for router replacement.
- [x] Replace the parent query/timer state and both inputs/forms; rerun targeted tests.

### Task 3: Verify and release

Execution ledger: tasks 1 and 2 complete in `5d54795`; 18,728 unit/component
tests pass, one skipped. All 29 unique synthetic profile/stream/search browser
cases pass across the initial run and corrected desktop-control rerun. Fresh
review identified three search races; each was watched failing then passing and
the reviewer confirmed the fixes. Local disk has under 2 GB free; production
compilation/bundle checks run in required CI and the staged production build.
No new migration; historical timestamp aliases were reconciled by name and
existing schema objects rather than replayed.

Ruling: before final verification, narrow individual marks reads in `assessments-repo.ts` and both individual callers in `reports-repo.ts`. Code tracing found class-wide rows fetched for one pupil. Add scope/chunk tests and a caller assertion; retain default whole-class behavior, RLS and existing calculations.

- [x] Review the diff and regressions; run typecheck, lint, theme/port guards and full tests.
- [ ] Build and check bundle budgets locally if disk allows; otherwise require successful CI and staged production build. Run relevant synthetic responsive tests if browser tooling permits.
- [x] Update `docs/DECISIONS.md` and `docs/PROGRESS.md` with verified outcomes and limitations.
- [ ] Commit, push, create PR, wait for required checks, address review, merge, verify source tree equivalence.
- [ ] Stage production with `--prod --skip-domain`, verify the artifact, promote the same deployment to One aliases, check alias IDs and error logs. Record release evidence under `D:\Codex\scratch\vppsone-performance-20261101`.
