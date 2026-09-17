# Coding-agent handoff — implement Ledger Calm 2

Version 1.0 · 17 September 2026. This package was built alongside active implementation. Work continued from R1.2 into an R1.3 branch while these designs were authored. **Read current `docs/PROGRESS.md` and Git state; do not restart R0 or overwrite ongoing work.** All package files are under `docs/design/` to avoid conflicting with the implementation agent's existing files.

## Product requirements added by the user

1. An accounts/accountant login should open the **School Fees workspace by default**, on both phone and desktop.
2. A teacher should open **their own class/day** with attendance and requests immediately useful.
3. An administrator should open **a combined overview** of school operations, including appropriate fee information, SamPark, academics, cover and exams.
4. Every role needs a modern, understandable interface for nontechnical staff, with the same visual language across apps.
5. Preserve the original School Fees and SamPark apps and their established workflows/locations. Use the current plan's ownership boundaries.

The first requirement clarifies the desired accounts experience; it **does not mean every office user is an accountant**. Current VPPS One roles are `admin`, `office`, `academic_coordinator`, `exam_coordinator`, `teacher`, `view_only`. The original School Fees role `accountant` is a separate identity/access model. Implement its fee-first home in the original fee app when that app is in scope. VPPS One should offer the verified fee destination, and any unified entry must resolve a real authorized role or explicit user preference without granting new access by inference.

## Source of truth and conflict order

1. Current user instructions and repository instructions.
2. Existing authoritative domain behavior, permissions, app origins and parity requirements.
3. The active `PLAN.md`, `PROGRESS.md`, `PARITY.md`, `QA.md`, and recorded decisions.
4. This design package for layout, role priorities, tokens, components and interaction presentation.

If a screen example conflicts with a domain rule, retain the rule and adapt the presentation. Record the design adjustment. Do not implement synthetic values, hard-coded school counts, query-string roles, mock dialogs or fake save confirmations in production.

## D0 — Align with active implementation

**Dependencies:** read `AGENTS.md`, relevant installed `node_modules/next/dist/docs/`, current branch/worktree status, plan/progress and this folder.

**Work:** identify what R1.2/R1.3 already implemented. Compare the existing shell/navigation/primitives against the atlas. Create a short delta list, map `academic/exam/viewer` preview names to real roles, and decide which repo owns each fee-screen change. Add a link to this package in the active plan/progress from the implementing agent's own branch. Do not rewrite another agent's active files just to add the link.

**Acceptance:** no completed phase is reset; each visual task has an owner and actual target route; teacher fresh-login default and preserved deep links are understood; accountant routing is explicit without equating `office` to `accountant`.

## D1 — Shared visual foundation and navigation

**Work:** extend existing theme/primitives with the token map; build PageHeading, TaskHero, MetricCard, task list, saved/pending/error state, fields and review diff. Complete grouped desktop navigation and the role-priority mobile bar/More hub. Add personal language access without changing role or workspace unexpectedly.

**Acceptance:** representative teacher, accountant-in-fee-app, and admin views match hierarchy and density at 390 and 1440 px. All allowed routes remain discoverable, 360 px and 320 px reflow work, 200% zoom remains usable, and the bottom bar does not cover content/focus. Existing Hindi/authored text behavior is retained.

**Evidence:** screenshots per role/device, component state examples and explicit navigation coverage. No broad dependency migration is required.

## D2 — Role homes with real data

**Work:** teacher class/attendance/tasks/lessons; admin exceptions and combined authorized summaries; office student work; coordinators' scoped priorities; viewer aggregates. Apply original School Fees accountant home separately using its own account/ledger. The home composition must change when the first task is complete, not keep asking for finished work.

**Acceptance:** classless/multi-class teacher, no tasks, stale summary, unavailable fees, view-only and denied destination cases render honestly. Cards drill into the matching filter/scope. A missing fee source is “unavailable” with a valid next step, never ₹0. Core first actions fit the initial phone viewport.

**Evidence:** independent role tests and fresh-login/deep-link walkthroughs, not merely screenshots of fixture-driven HTML.

## D3 — Workflows using the shared language

Implement in small vertical slices aligned to the current R phases:

| Active work | Design references | Required completion evidence |
|---|---|---|
| R2 directory/teacher UX | `students`, `student`, `attendance`, `timetable` | Own-class scope, search/no matches, full register, corrections, responsive print |
| R3 collection parity | `requests`, `request-link`, `sampark`, `review`, `states` | Frozen membership/issued values, bulk/master rounds, confirm/correct, stale review and resume/retry |
| R4 record/photo parity | `students`, `student`, `documents`, `review` | Actual camera/file preview, matching, invalid/ambiguous rows, batch partial failure and retry |
| R5 academic UX | `academic`, `exam`, `cover`, `marks`, `reports` | Conflicting cover, blank/zero/absent, correct maxima, completeness, review/publication |
| R6 fee integration | `apps`, `accountant`, `payments`, `dues`, `receipts`, `fee-report` | Verified original app handoff; source-owned accounting behavior; correct role/default home |
| R7 performance | All | Repeatable before/after production-build measurement and route-specific evidence |
| R8 acceptance | All | Full role/workflow/device regression plus staff usability evidence |

**Acceptance:** no parity feature disappears because it was omitted from a sample composition. Forms retain data on failure, saves acknowledge the actual server result, repeated actions do not duplicate effects, original apps remain reachable.

## D4 — Deep interaction and visual QA

Use the active repo's real checks (`npm run check`, independent role smoke and workflow suite as documented), plus a production-build browser pass. The atlas's renderer tests the atlas only.

Test at 320, 360, 390, 768, 1024 and 1440 CSS px. Include one short phone height, 200% zoom, Hindi and bilingual copy, long student names, empty/large lists, software keyboard, keyboard-only navigation, visible focus and screen-reader announcements. Compare layouts as well as overflow.

Exercise: negative/zero/too-large values; blank and whitespace; duplicate clicks; save then reload; network failure before/after acknowledgement; expired login; stale two-tab edits; class move after issuance; closed/unknown token; rejected review without reason; missing assignment; busy teacher conflict; incomplete report; photo mismatch/oversize; protected/corrected fee transactions; blocked messaging provider and retries. Keep provider dispatch mocked in test workflows according to the existing plan.

**Acceptance:** critical/high defects resolved, no role-navigation regressions, fresh browser screenshots correspond to the committed implementation, source data rules still reconcile. List physical-device and live-provider evidence separately when not executed. Do not claim live visual parity based on the static PNGs.

## D5 — Document, deliver and preserve rollback

Update phase evidence, design deviations and implementation status in the active plan/progress. Commit only owned changes, run required checks, follow the user's branch/delivery instructions, and verify the resulting deployment when deployment is in scope. Keep an identifiable pre-design commit and use small reversible commits per vertical slice. A visual rollback must not reverse domain migrations or data changes unnecessarily.

## Kickoff prompt

```text
Continue the current VPPS One implementation and adopt docs/design/ as the shared UI reference. Read AGENTS.md, installed Next.js guidance, docs/PLAN.md, PROGRESS.md, PARITY.md and QA.md, then docs/design/README.md, DESIGN-SYSTEM.md, SCREENS.md and HANDOFF.md. Inspect the actual branch and unfinished edits before changing anything. Do not restart completed phases or overwrite another agent's work.

Open docs/design/index.html and compare the desktop/mobile PNGs. Implement Ledger Calm 2 using the existing theme, primitives and shell. Accounts staff should land in the original School Fees workspace; teachers should land on their assigned class/day; administrators should get the combined school overview. Preserve the other role-specific homes, Hindi/bilingual preferences, valid deep links and every existing allowed destination. An office role is not automatically an accountant: respect the separate fee-app role model and use the verified app registry.

Start with a delta audit against the work already completed, then implement D0–D5 in small vertical slices alongside the current R-phase queue. Keep fee writes and accounting behavior in the original School Fees app unless that ownership is explicitly changed. Bind real data and existing actions; never ship mock counts, fake save messages, query-string roles or prototype dialogs. Preserve all SamPark parity requirements even when a sample screen simplifies the flow.

Verify visual hierarchy at 390/1440, responsive behavior at 320/360/768/1024, Hindi wrapping, keyboard/focus and loading/error/empty/conflict states. Run the appropriate existing checks plus deep role/workflow browser smoke tests with test fixtures. Record exact evidence and remaining gaps, update plan/progress/design deviations, and deliver changes according to the user's commit/push instructions. Do not claim production parity from static design images.
```
