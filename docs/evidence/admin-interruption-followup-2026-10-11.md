# Admin interrupted-response follow-up — 11 October 2026

Status: genuine DEV acceptance completed, 2/2 phone cases passed with independent final readback. The guarded 360px continuation reused the untouched fixture after configuration recovery; 390px used a fresh tagged batch. All owned audit fixtures remain retained and cleanup approval remains separate.

The original private run lasted 183.957 seconds and failed at route.abort with “Route is already handled”. Installed Playwright source establishes the mechanism: removing an active handler automatically continues its intercepted request. The original test removed its handler/reloaded while route.fetch was still completing, so the delayed abort attempted a second terminal action. This is a test-harness failure, not a reproduced application defect.

The repair retains ownership until the forwarded server response, one abort and the matching browser requestfailed event all settle. It disables automatic retries and redirects for the intercepted POST, propagates injection failures, checks server status, and bounds settlement. Reload and handler removal occur only after that barrier. Five deterministic checks passed in 3.23 seconds, including a reproduction of the early-unroute failure. Scoped lint passes with exit 0; discovery lists exactly two phone cases. The genuine runner has no retries and stops after its first failed case. Browser and persisted verification remain separate gates.

The genuine runner uses existing QA accounts and the coordinator-owned local DEV server. Two serialized Chromium touch cases cover 360 × 800 and 390 × 844; this is emulation, not physical-phone testing. Each new fixture has a fresh phoneops-20261011-admin-followup UUID suffix and its own ledger filename; a guarded continuation uses the existing fixture tag and a separate unique resume ledger. The original admin-ledger.json, its terminal commands and unresolved cleanup approval are never reused. Destructive cleanup code has been removed; setting OPS_ADMIN_PRESERVE_FIXTURES=0 fails closed.

The fixture key uses a lowercase prefix plus 16 UUID hex characters and a field suffix, within the existing 41-character schema limit; full audit tags remain in labels. The login helper verifies authentication HTTP success and the settled review route, or the teacher's exact collection:view denial, before interpreting controls. Visible-role heading queries avoid the hidden desktop heading copy.

## Retained attempts and read-only recovery

The first launch-only attempt failed before the test body because the sandbox resolved an empty browser cache (2.873s runner). Its JSON is preserved as admin-interruption-followup-launch-failure-results.json. Pointing to the existing Chromium cache required no download or new credentials.

The next attempt failed at its first field insert because the longer follow-up tag exceeded collection_fields_key_shape (1.7s case, 3.742s runner). No fixture rows were inserted. Its preflight/error ledger is admin-ledger-phoneops-20261011-admin-followup-69c00aa7.json and failure JSON is admin-interruption-followup-key-shape-failure-results.json. The short key correction is test-only.

The schema-valid 360px attempt retained three inactive fields, two requests, three office records and four pending submissions, then stopped at missing bulk controls after 8.6s. No decision tap occurred. Root server logs independently identified /auth/confirm HTTP 500 from a missing temporary publishable-key alias; the coordinator restored the existing DEV key alias, without creating a key or grant. The ledger is admin-ledger-phoneops-20261011-admin-followup-9862c9ee.json; failed results are admin-interruption-followup-bulk-missing-results.json.

An initial read-only probe used the hidden first desktop heading and stopped after 1.7 minutes on the teacher denial page. The oracle was corrected to visible role headings and an explicit known-denial route; failed results remain admin-followup-readonly-hidden-heading-results.json. Final read-only recovery passed in 8.9s (10.2s runner): admin auth 307 reached /collection/review with one visible heading and one bulk form; teacher auth 307 settled at /access-denied for collection:view with no bulk form. Exact before/after persisted data matched: four pending answers, three unchanged office records and zero history. Evidence is admin-followup-readonly-baseline-9862c9ee.json. No mutations occurred in either read-only probe.

The executed continuation required explicit OPS_ADMIN_RESUME_LEDGER and independently validated exact inactive field labels, request class/session/title, all four pending answers, office baselines and zero history before any decision. It resumed only the untouched 360px batch, wrote a separate unique resume ledger, and never overwrote its original ledger. The 390px project created a fresh tagged batch only after 360px passed. Any decided or mismatched resume precondition fails closed.

## Completed genuine acceptance

The final runner started at 17:59:46.878 UTC and completed in 95.717s with exit 0: 360px passed in 46.902s and 390px passed in 45.268s. Both were touch/mobile Chromium emulation, not physical devices. Each case verified selected A acceptance with one written effect; unchecked B stayed pending with its original office value and zero history. Older C had no acceptance control and was explicitly rejected. Current conflict C required explicit replacement of the office correction.

Each C action was forwarded once, returned server HTTP 200, then had its browser response deliberately aborted once with net::ERR_FAILED. The barrier settled before reload. Independent persisted checks, rather than HTTP status, established C acceptance and one written history. Reload removed the decided row. A separate cached reviewer retried the supported stale form; the exact original C history ID and content remained unchanged. Final written effects were exactly A plus C.

| Phone width / fixture tag suffix | Fields / requests / answers / records / history | A written ID | C written ID before/after stale retry | Final current answers |
|---|---|---|---|---|
| 360px / 9862c9ee | 3 / 2 / 4 / 3 / 2 | 52 | 53 / 53 | A accepted, B pending, C accepted; older C rejected |
| 390px / 29acbd26 | 3 / 2 / 4 / 3 / 2 | 54 | 55 / 55 | A accepted, B pending, C accepted; older C rejected |

Exact scoped identifiers, baselines, after-state values and interrupted-response evidence remain in private admin-followup-final-readback.json, written by a separate read-only audit (mutation count zero). Each batch's three fields remain inactive. The 360px original source ledger remains its historical pre-decision snapshot, with completed acceptance in admin-resume-ledger-phoneops-20261011-admin-followup-9862c9ee-9236f79e.json. The 390px ledger is admin-ledger-phoneops-20261011-admin-followup-29acbd26.json. Original source ledger files were unchanged during final readback. All earlier failed-result files remain retained; no deletion, replay of a completed fixture, grants, schema change or notice dispatch occurred.

The final browser result is admin-interruption-followup-results.json. Together the completed batches retain six inactive fields, four requests, eight answers, six records and four history rows. This is separate from the original 501680c9 audit and its unresolved cleanup approval; that fixture's IDs and ledger were not reused.

Expected genuine evidence: only selected A changes; unchecked B retains its office value, pending status and zero history. Conflict C requires explicit replace; its response is genuinely dropped after one forward. Persisted C is accepted with the intended value and one written history from its office correction. Reload removes the decided row. A cached reviewer retries only this new fixture's C command, after which its exact history ID/value remains unchanged. Total written effects stay exactly A plus C.

Archived reviewed execution recipe — completed fixtures must not be replayed:

```powershell
$env:OPS_ADMIN_RUN_MUTATIONS = '1'
$env:OPS_ADMIN_PRESERVE_FIXTURES = '1'
$env:OPS_ADMIN_ORIGIN = 'http://localhost:3100'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\AnandKumari\AppData\Local\ms-playwright'
$env:OPS_ADMIN_RESUME_LEDGER = 'C:\Users\AnandKumari\Documents\Codex\2026-10-11\task-3\evidence\admin-ledger-phoneops-20261011-admin-followup-9862c9ee.json'
node node_modules/@playwright/test/cli.js test --config operations-admin-interruption.playwright.config.ts --workers=1
```

Screenshots, traces and video are off. All newly owned inactive fields, requests, submissions, records and history are retained with exact IDs and baselines. No deletion, grants, schema changes, credentials or notice dispatch is part of this runner. Protected LIVE School Fees remains excluded. The service client requires exact DEV wtgxcptmucjerhufzjcf; local origin is restricted to HTTP localhost/127.0.0.1.
