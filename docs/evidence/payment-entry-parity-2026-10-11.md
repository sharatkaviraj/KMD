# Payment entry parity verification

Branch: `fix/payment-entry-parity`, base main `fefd2a05e9546a1016a4d130b0671667643aed53`.

## Confirmed

- Nine domain regressions: invalid amounts reproduced expected failures before the fix, then passed. Concession and waiver remain distinct, cash is allocated after adjustments, cheque references are optional.
- Seven real-component scenarios passed using synthetic server actions: collector/concession edits, Review without a post, Back retaining fields, dropped response → student switch → reload → same original request retry, invalid fractional amount, authoritative date preview gating/net cap, storage failure without a post, read-only preview/closed session, and EMI shortcut/concession behavior.
- No automatic WhatsApp call in the save scenario. Existing classic posting, duplicate/waiver authorization and awaited financial refresh are retained.
- `git diff --check` passed. Latest main fetched during implementation remained `fefd2a0`.

## Remaining verification

Scoped lint, project typecheck/full regression/build gates, and four responsive browser scenarios are still pending. Windows verification was slowed by npm remote-tarball policy, slow downloads, worker startup timeouts and memory pressure. Dependencies were copied read-only from the existing checkout into this isolated checkout; no lockfile change. A first browser run timed out while waiting for the document load, before interacting with the desk, and is not a visual pass.

Run synthetic responsive checks with `npx playwright test --config payment-ui.playwright.config.ts`. The separate Vite fixture uses port 3212 and synthetic-only payment actions. Screenshots are emitted into `test-results`. No database or provider integration claim is made by this fixture.

Do not release until current-head CI and desktop/mobile acceptance are confirmed. No LIVE School Fees, schema/migration, real payment or message writes occurred.
