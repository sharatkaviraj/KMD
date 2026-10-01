# Desktop, mobile and installed workspace — 2026-10-01

The requested smoothness and installability work is in [PR 39](https://github.com/veerpatta/vppsone/pull/39),
on `perf/installable-workspace`. The final version integrates current main
`8ff94defe6bd4ac7c307a4230f8d7b071a9705a4`, preserving the newer mobile refresh
and approved native admin overview. That main commit is the comparison baseline.
No schema migration, live fee data write, messaging send or infrastructure purchase
is part of this change.

## Delivered behavior

- Teacher and office/admin homes put permitted overview figures before work queues.
  Existing account start preferences, role destinations and school design tokens remain.
- Desktop student rows select their detail panel locally without navigation or another
  data request. Phones open the existing full record. Contact details are read for one
  50-row page, with paged enrolment scope and bounded 100-ID search requests. The bounded
  query implementation already merged in main is retained.
- Shared shell translations stay at the root; full fee translations load within fee
  routes. Non-finance roles skip finance shell session/pulse/realtime work. Commands
  load on intent; prefetch is limited, staggered and skipped offline/hidden/on slow links.
  Academic session reads deduplicate within a server request. Sticky form bars avoid blur.
- Attendance, marks and public collection answers persist versioned device drafts with
  owner/session/record scope, storage failure feedback, explicit Restore/Discard and
  changed-server review. Public request keys contain a token digest. Legacy unowned
  queues are not replayed. Marks and requests build submission payloads on submit.
- Payment amount/mode drafts use the same scoped storage and manual recovery. The
  phone sheet displays recovery/status controls. Offline Collect is disabled; posting
  still uses the existing authorization, idempotency key and server confirmation.
- The neutral PWA starts at `/`, resolving the saved role-allowed home. Preferences
  supports Chromium installation and iPhone/iPad Safari instructions. The worker
  caches public assets only. Offline cold launch gets a neutral reconnect page.
  Updates wait for deliberate reload after draft writes settle; active sheets,
  pending forms and failed storage block activation.
- Sampled authenticated telemetry keeps fixed metric names, coarse routes, role,
  viewport bucket and installed state. No identifiers, tokens, amounts or full URLs
  are logged. Batches and request size are bounded; no external analytics service.

## Before/after lab evidence

Both runs used a local production Next build, Chromium, the same dev database,
desktop viewport and 20 full warm navigations per route. The final samples ran
sequentially after the builds, workflow suite and role matrix had finished.
The clock covers navigation through visible main heading readiness and load completion;
it includes server/database/network variability. These are lab navigation proxies,
not field LCP/INP, physical-phone results or a promise that every workflow meets a target.
The document measurement is decoded HTML/RSC response bytes, not compressed transfer.

| Role / route | Document bytes | Navigation median | Navigation p95 |
|---|---:|---:|---:|
| teacher `/teach` | 281,265 → 140,633 (-50.0%) | 1153 → 882 ms | 1745 → 1845 ms |
| admin `/dashboard` | 346,245 → 211,828 (-38.8%) | 976 → 903 ms | 1611 → 1092 ms |
| accountant `/fees/payments` | 318,846 → 321,591 (+0.9%) | 560 → 669 ms | 930 → 808 ms |

Teacher/admin documents are about 50%/39% smaller with the scoped shell catalogue.
The fee document is roughly flat (+0.9%). Timings are mixed: teacher median and
admin median/p95 improved, but teacher p95 and payment median increased. This
bounded sample does not establish a causal latency improvement across workflows.
The full-navigation proxy also differs from the aspirational warm-data p95 target.
Representative staff usage is still needed for field p75 LCP/INP/CLS acceptance.

Raw records: `smoothness-browser-before.json` and `smoothness-browser-after.json`.

## Bundle budget

Unique route-referenced client chunks, gzip summed per route from the production
client reference manifest. This includes shared chunks and is a regression proxy;
it is not a measurement of the browser's actual downloaded or executed JavaScript.
Client chunks grew slightly with install/draft support; no JS shrink claim is made.
CI now rejects growth above 10% against the retained pre-change baseline.

| Route | Before KiB | After KiB | Change |
|---|---:|---:|---:|
| `/login` | 127.8 | 131.7 | +3.1% |
| `/teach` | 122.9 | 126.6 | +3.0% |
| `/teach/attendance` | 156.2 | 161.4 | +3.3% |
| `/dashboard` | 122.9 | 126.6 | +3.0% |
| `/students` | 122.9 | 130.4 | +6.1% |
| `/fees/payments` | 133.7 | 138.7 | +3.8% |
| `/fees/transactions` | 163.9 | 169.0 | +3.1% |
| `/preferences` | 126.9 | 133.7 | +5.4% |

Raw records: `smoothness-before.json` and `smoothness-after.json`.

## Executed verification

- Type generation/typecheck, production webpack build, import port check and bundle
  budget passed. Theme parity: 430 tokens. CI: 8,144 Vitest tests in 71 files passed.
  Changed-file ESLint passed; the full lint run retains four existing warnings
  (three PDF alt props, one unused import).
- The final integrated production browser run discovered 50 cases: 49 passed and
  the optional lab sampler was skipped. The sampler then passed in
  separate sequential before/after invocations. No failing workflow is omitted.
- Integration exposed the responsive helper counting a clipped keyboard skip link
  as a visible thumb target. The helper now excludes empty clipping, and an added
  keyboard journey verifies focus reveal, a 44px target and main-content focus.
  An update assertion initially timed out; the test now confirms worker control and
  explicitly awaits reopening before draft recovery. Three repeated isolated runs
  and the complete final workflow suite passed.
- All six install/draft checks passed: offline cold fallback, no protected URLs in
  worker caches, account-scoped attendance recovery/discard, zero-request desktop
  selection, reusable keyboard search, deliberate real-worker update/reload with
  draft survival, payment recovery with an unchanged receipt count, and recovered
  marks saved as exactly one server mark followed by no remaining draft. The unique
  QA assessment and dependent rows are deleted in `finally`. The public collection
  journey recovers an offline answer and verifies the persisted server value.
- The integrated mobile fixture suite passed 68/68: three languages, phone/tablet/
  desktop widths, light/dark themes, enlarged text, axe checks, nested-sheet focus,
  role-filtered More navigation and reduced motion. Actual app responsive checks
  passed at 360/390/430px. Desktop directory and phone payment screenshots were
  inspected locally in ignored `test-results`; no person data is committed as images.
- The final strict role smoke passed all 728 of 728 screen/role combinations across
  eight roles, with zero drift or failures.

Reproduction (PowerShell; own a fresh production server and restart after every build):

```powershell
npm run check
npm run start -- -p 3102
# In a second terminal:
$env:APP_ORIGIN='http://localhost:3102'
npx playwright test
npm run smoke:roles
$env:PERFORMANCE_EVIDENCE='docs/evidence/smoothness-browser-after.json'
npx playwright test tests/e2e/performance-lab.spec.ts
```

Run the lab separately from other browser invocations. Parallel Playwright processes
share the output directory, causing trace collisions and invalidating measurements.
Do not run state-changing workflow fixtures on the live fee database.

## Remaining acceptance

Physical Windows Chrome/Edge install, Android app suspension/relaunch and iPhone
Safari standalone/keyboard checks require the corresponding devices. Chromium phone
emulation is the evidence here. Staff acceptance and representative field telemetry
remain open, as do unrelated R5/R7/R8 parity rows. These limits do not make the
implemented installation, draft and browser-tested behavior a field speed guarantee.

## Release verification

[PR 39](https://github.com/veerpatta/vppsone/pull/39) contains the implementation,
latest-main integration and final verification. Original implementation: `2c9ef2f`;
main integration: `741318f`. The complete workflow and role runs used a fresh
production build including the final keyboard-link classes. CI must pass on the
final PR head before merge; release acceptance checks the deployment API's
`gitSource.sha` against merged main and verifies hosted install/offline behavior.
The delivery message records the actual release URL and verified outcome.
