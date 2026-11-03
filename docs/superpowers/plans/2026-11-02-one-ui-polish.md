# One UI Polish Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task, with a final independent review.

**Goal:** Make session controls, status notices and common interactions feel native to One, especially on phones, and release the verified change to production.

**Architecture:** Opt-in One styling preserves the existing session switching implementation. A shared workspace toolbar composes independently streamed roster and session controls. Existing One overlays, CSS tokens and navigation pending events supply behavior without new dependencies.

**Tech Stack:** Next.js 16.4, React 19, TypeScript, CSS, Radix, Vitest and Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-one-ui-polish.md`

## Global Constraints

- Preserve session permissions, cookie-first switching, TEST identity and financial/provider/message boundaries.
- All work and evidence live on D:; preserve other checkouts' local changes.
- No new dependencies; use One's tokens and shared components.
- Live verification is read-only; use synthetic fixtures for session switching.

## Review Focus

- A slow session catalogue must preserve the toolbar geometry and current identity.
- TEST and long labels must wrap without clipping, in English and Hindi at 320px.
- A stale/error roster message must remain visible and readable in both themes.
- Closing a sheet must restore focus and scrolling, including reduced motion and Back.
- Shell layout at tablet widths must retain usable content and navigation.

### Task 1: Native session controls and toolbar

**Files:** `src/vx/shell/session-bar.tsx`, `src/vx/shell/shell.tsx`, `src/app/(app)/layout.tsx`, `src/platform/fees-bridge/roster-status.tsx`, `src/ui/shell/{session-pill,mobile-session-pill,shell-session-pill}.tsx`, `src/vx/shell/session-controls.css`.

**Interface:** Switchers accept `appearance?: "default" | "one"`; `VxShell` accepts `rosterStatus?: ReactNode`. Existing session functions and action signatures remain unchanged.

- [ ] Add One appearance, matching placeholder and responsive workspace toolbar; preserve the default ported presentation.
- [ ] Move roster status into the toolbar; provide compact healthy disclosure and complete unhealthy messages.
- [ ] Build a synthetic browser fixture and verify labels, selection, slow/failed lists, safe switching, focus, Back, clipping and themes.

Expected: full current label is visible and exactly one switch action follows a selection; no production access from the fixture.

### Task 2: Today composition and shared motion

**Files:** `src/vx/screens/admin/today.tsx`, `src/app/(app)/page.tsx`, new native ledger notice, `src/vx/vx.css`, `src/vx/ui/{overlays,page,intent-link}.tsx`, navigation tests.

**Interface:** `TodayProps.notice?: ReactNode`; intent links report pending navigation through the existing `NavLink` implementation.

- [ ] Move the native ledger notice below the header/hero and keep both destinations available.
- [ ] Refine common sheet/list/touch motion; dismiss immediately with reduced motion and retain focus/scroll behavior.
- [ ] Wire intent navigation feedback and verify existing prefetch behavior.
- [ ] Verify synthetic layouts at 320/390/768/1024/1440px, English/Hindi, both themes and reduced motion.

Expected: no horizontal document overflow or obscured navigation; mobile starts with a compact toolbar followed by its real header.

### Task 3: Verify, review and release

- [ ] Run `npm.cmd run typecheck`, lint, theme/import checks, unit tests, production build and bundle budget checks; run focused browser acceptance.
- [ ] Request an independent whole-branch review; fix material findings and rerun affected verification.
- [ ] Record exact evidence in `docs/evidence/2026-11-02-one-ui-polish.md`, commit and open a PR.
- [ ] Wait for required CI, merge and inspect production deployment state/SHA/alias.
- [ ] Recheck the shared live browser at mobile and desktop width and restore its temporary viewport override.

Expected: CI passes and `one.vpps.co.in` serves the merged revision; report any unverified scope explicitly.
