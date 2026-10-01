# Payment draft recovery - 2026-10-01

Host: `CPC-direc-AS0WP`. Branch: `fix/payment-draft-recovery`.
Implementation commit: `d947828619bf3de107cae3064206618f72e91d63`.
Draft PR: [40](https://github.com/veerpatta/vppsone/pull/40).
Base: `f0bbabd3e58bc32b7514027c461110ea1ea3f33c`
(merged PR 39). User approved the focused fix and tests, with no merge or deployment
approval. Work uses an isolated local clone; the original Desktop checkout is preserved.

## Reproduction

The actual `PaymentDeskClient` was rendered with synthetic students A/B/C and
localStorage fallback, using the existing serialized draft store. The first ten
regressions were run against the original source and then the fixed source:
8 failed / 2 passed before; 10 passed after.

- Save A's amount `111`, pre-seed B's draft `222`, select B. Before the fix,
  B's recovered draft is offered in memory but its durable value becomes null.
- Pre-seed A/date 29 September with `333`, enter `111` on today's date, change
  the payment date. Before the fix, the saved `333` becomes `111` while the
  recovery prompt is visible.
- A recovered draft always announces a changed school record before the fix,
  even though payment drafts store no school-record baseline.
- A delayed read permits deletion before recovery. Discard on a date change
  can immediately re-save the carried amount. Both have regression coverage.

These reproduce loss of unposted device drafts. They do not establish corruption
of posted receipts or database records.

## Changes

Readiness is matched to the complete draft key on the render that changes scope.
New-key writes wait for a successful read. Recovery actions require current-key
readiness. Cancelled loads and persistence callbacks cannot update another
selection; discard completions require the same generation and amount edit count.
An owner/session boundary clears the prior in-memory amount. Discard clears the
carried amount, preserving a later user edit. The recovery notice uses the existing
translated neutral review text because no financial baseline comparison exists.

No storage format migration or database change is required. Existing version-1
drafts remain readable. Payment authorization and idempotent posting are unchanged.

## Verification

- Focused rendered-desk suite: 14 tests passed. Covers student/date switches,
  repeated A/B/C/A keys and out-of-order loads, reload, delayed/failed reads,
  visibility/unload, owner/session boundaries including an empty destination,
  amount edits during loading, restore amount/mode, discard/reload, late discard
  completion after a switch or newer edit, deselection, and warning semantics.
- Chromium: phone 390px and desktop 1440px, each against localStorage fallback
  and IndexedDB. Final standalone runner: four journeys passed, exit 0 (1.2
  minutes). It starts only its own fixture server on 3202.
- Full Vitest suite after reconnection: 72 files / 8,158 tests passed, exit 0,
  with `VITEST_MAX_WORKERS=2` (60.44 seconds).
- Type generation/typecheck and lint passed; four existing lint warnings remain
  in `document-kit.tsx` and `sidebar-nav.tsx`, with none in the changed files.
- Theme parity: all 430 tokens match the read-only School Fees reference.
- Port imports: 699 ported files, none left to rewrite.
- Production webpack build, including TypeScript validation: passed, exit 0.
  Compilation took 3.4 minutes with build-only placeholders.
- Route bundle budgets: all eight routes passed, exit 0. Payment desk client
  chunks sum to 138.5 KiB gzip against the retained 133.7 KiB baseline (under
  the 10 percent budget). This is a chunk regression proxy, not browser transfer.

The browser runner uses the actual desk and dynamically loaded phone sheet,
with Next routing/chunk-loading/language adapters and synthetic summary responses.
Both payment/repair actions throw; external requests and non-GET requests are
blocked. Reload does not re-seed storage, so it proves durable recovery.

Commands:

```powershell
node node_modules/vitest/vitest.mjs run tests/payment-draft-recovery.test.tsx
node node_modules/@playwright/test/cli.js test --config payment-draft.playwright.config.ts
# Build-only placeholder env, dev mode, read-only School Fees theme reference:
$env:VITEST_MAX_WORKERS = '2'
npm run check
```

An initial full-suite run alongside Chromium hit the five-second default timeout
in several desk journeys, followed by cascading fixture failures. A focused rerun
passed all 14 tests. The new suite has a bounded 20-second per-journey timeout and
the final full run uses two workers on the shared desktop. A subsequent local
check was interrupted by moving fixture files during lint; the final check runs
against stable file paths. The executor transport then disconnected mid-run;
the user reconnected CPC, and the unverified full test/build stages were resumed
with explicit exit-status files. No continuous `npm run check` exit-0 result
is claimed; its individual required gates are reported separately.

## Limits and release status

No Supabase project was contacted for these regressions. No credentials were
copied or created, no school records/payments were posted, and no migrations,
fixture seeding/reset or destructive cleanup ran. Protected live schoolfees
`vgqyilgstjvgohrsiwkb` was untouched. Existing browsers/processes were preserved;
the runner owns separate headless browsers and a temporary Vite server on 3202.

This is actual component-browser QA, not an authenticated production Next/Supabase
end-to-end receipt workflow, physical-device acceptance, or proof against future
school-record changes. A failed draft read remains blocked from persistence until
the key is reloaded by switching/remounting; there is no new storage-retry UI.
Release remains pending new explicit approval.
