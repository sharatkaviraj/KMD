# Payment entry parity verification

Branch: `fix/payment-entry-parity`, base main `fefd2a05e9546a1016a4d130b0671667643aed53`. Draft PR: https://github.com/veerpatta/vppsone/pull/77.

## Confirmed on f57efc3

- Full CI passed: https://github.com/veerpatta/vppsone/actions/runs/38140338112. Typecheck, lint, ported imports, theme checks, 145 test files / 12,546 tests, production build, and route bundle budgets passed.
- Nine payment domain regressions passed. Invalid amounts reproduced expected failures before the fix; concession and waiver remain distinct, cash follows adjustments, and cheque references are optional.
- Seven real-component scenarios passed: collector/concession edits, Review without posting, Back retaining fields, dropped response followed by student switch/reload and identical request retry, fractional amount rejection, authoritative date preview gating/net cap, storage failure without posting, preview/closed session restrictions, and EMI shortcut/concession behavior.
- Four Chromium browser cases passed at 320, 390, 1180, and 1440 pixels: selection, edited amount/collector/concession, review/back, confirm, receipt, next student, and no horizontal overflow. Run: https://github.com/veerpatta/vppsone/actions/runs/38140338242. Screenshots: https://github.com/veerpatta/vppsone/actions/runs/38140338242/artifacts/11702596661.
- Screenshots inspected at 390 and 1180 show the editable amount before long installment details and a usable desktop form width. Initial receipt screenshots capture the paper animation in progress; the fixture now waits for its completion before capture.
- No automatic WhatsApp call occurred in the save scenario. Existing classic posting, duplicate/waiver authorization, and awaited financial refresh remain intact.
- Provider claim concurrency workflow also passed.

## Final acceptance gates

The additional 390-pixel browser interruption scenario and completed-animation captures need their fresh CI result. Independent code review and the coordinated clean-integration phone retest remain required before release. The test fixture now asserts zero receipts at Review and exactly one after confirmation and records the original payload through recovery.

Run synthetic browser checks with `npx playwright test --config payment-ui.playwright.config.ts`. The independent Vite fixture uses port 3212, synthetic server actions, and an in-browser synthetic ledger. Screenshots are emitted to `test-results`. It provides UI/workflow regression evidence, not database or provider integration evidence.

Windows verification was slowed by npm remote-tarball policy, worker startup timeouts, and memory pressure. Installed dependencies were copied read-only from the matching-lock checkout into this isolated checkout; the lockfile was not changed. Local stalled verification processes were stopped, and CI supplied the successful full checks.

No protected LIVE School Fees, schema/migration, real payment, or message writes occurred. Keep the PR draft until review and coordinated phone acceptance are complete.
