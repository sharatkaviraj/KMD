# Test-data smoke and performance release

Code PRs: [#52](https://github.com/veerpatta/vppsone/pull/52), [#54](https://github.com/veerpatta/vppsone/pull/54) and [#55](https://github.com/veerpatta/vppsone/pull/55). Production: <https://vppsone.vercel.app>.

## Changes

- The shared fee-session adapter checks native fee access before handing over the ported role. Next can render a page while its layout redirects, so excluded native roles previously still started fee queries and a background refresh. Runtime logs found this even though the page-level role matrix passed. Twenty-two adapter regressions cover all eight roles and both permission guards; seventeen fail against the old code. Existing fine-grained fee permissions remain in place.
- Promise counters refresh under native staff permissions. The office role's native fee access disagreed with the legacy SQL permission map, so its refresh was refused. A guarded function in `vppsone` keeps the existing fee objects intact. Background refreshes capture their request client before `after` and return the promise so the host waits for completion.
- The export log now labels the existing `students` and `round` database kinds in Hindi and English. Workbook exports previously crashed this page by looking up missing labels.
- Attendance correction lists and pending counts now use the selected academic session. Two temporary registers reproduced the cross-session leak; save/reload checks confirm the filter.
- Attendance status taps use brief color/transform feedback, respect reduced motion, and keep rows fixed. The first locally saved draft previously shifted the controls down by 7px; the draft badge now reserves its space.
- Loading feedback stays active across overlapping links and URL commits. Idle links cannot cancel it, old dismissal timers cannot hide new work, and idle pages no longer run a hidden infinite animation. Six regression cases cover these transitions.
- Teacher Home reads independent data concurrently. Directory query chunks run with a limit of four, preserving ordered results/errors and stopping new work after a thrown request.
- Vercel functions move from `iad1` to `bom1`, alongside the dev Supabase database in `ap-south-1`.
- Screen smoke resolves fee and duty fixtures, follows internal streamed aliases, catches streamed error frames, refuses missing dynamic fixtures, and stops at external handoffs without forwarding QA cookies. Unused translated error messages inside scripts do not count as rendered failures. `smoke:screens` creates only a cancelled duty and a finished zero-recipient reminder-run record, then verifies exact-ID cleanup.
- The service-worker update fixture generates a fresh cache version; its former hardcoded version had become a no-op.

## Validation

- Final code CI passed **10,074 tests across 94 files**, typecheck, lint, theme parity, port checks, build and bundle budgets ([run 37416664135](https://github.com/veerpatta/vppsone/actions/runs/37416664135), `78902fd`). Local architecture and native fee-session verification passed 3,703 cases, including preservation of the migration-time fee write guard. Fresh local suites and targeted regressions also passed; the URL-commit and native fee-session regressions reproduced their failures before the fixes.
- All 12 rule verification commands passed: access matrix across 12 account types plus 167 named assertions for cover, outbox, attendance, marks, reports, parent policy, records, imports, photos, archive and fee parity. Dated JSON is in `docs/evidence/P*-2026-10-05.json`.
- Full production-build browser sweep: 74/76 passed initially. The two findings were the attendance row shift and outdated service-worker fixture described above. All nine focused checks then passed on the fresh `1bc00ae` build: both failed cases, attendance save/correction/recovery, session isolation and the register at all three phone widths. All 76 workflows are covered.
- All 68 mobile UI cases covered, including two stable-fixture reruns. Responsive workflows cover 360px, 390px and 430px; branding also covers 1440px.
- Origin checks passed for VPPS One, School Fees and SamPark. The fee schema fingerprint still matches 505 objects.
- Production build, changed-file lint and all eight route bundle budgets passed. The isolated `fd36842` build passed all 784 strict role checks and 991 account/screen checks with no missing fixture or broken screen. The fresh `808ade7` production build opened Defaulters for all four fee roles with no recovery/cookie errors in its server log.
- Native recovery verification passed 17 API assertions, including all 11 QA accounts, anonymous refusal, the promised-date boundary, repeated-refresh idempotency and verified cleanup. The public fee schema fingerprint still matches all 505 baseline objects after the migration. No advisor finding names the new function.
- The final live sweep at **`8c5dbe5` passed 784/784 strict role checks and 991 account/screen checks**, with zero drift, broken screens or missing fixtures. Both inert metadata fixtures were removed and their absence verified. The production evidence files record the exact deployment and commit; deep timings include the complete response body.
- The first live sweep at `1a7509a` passed page access checks but exposed background recovery refusals in runtime logs from excluded roles. D-247 / #55 corrects the shared adapter. The final deployment has **zero error/fatal logs** in the checked 20-minute window after the full sweep (`runtime-smoke-2026-10-06.json`); the prior deployment logged ten requests containing the recovery refusal.
- Five final live Chromium checks passed: attendance row geometry and reduced motion, the three-role timing lab, desktop/Android PWA installation metadata and offline launch, and iPhone installation guidance. Evidence: `live-browser-2026-10-06.json`. Device coverage here is browser emulation.

## Performance and deployment

The live baseline is `docs/evidence/performance-live-before-2026-10-05.json` at `e5c35fe`. The final comparison is `performance-live-after-2026-10-06.json` at `8c5dbe5`. Both use the same public origin and browser harness with 20 navigations per route.

| Role / route | p50 before → after | p50 reduction | p95 before → after |
|---|---:|---:|---:|
| teacher `/teach` | 3127 → 573 ms | 82% | 4620 → 891 ms |
| admin `/dashboard` | 2048 → 585 ms | 71% | 2747 → 838 ms |
| accountant `/fees/payments` | 2427 → 791 ms | 67% | 5475 → 4505 ms |

Production deployment `dpl_FNZ7LGixXKh8HGrhcy8L6mUSXFqr` is READY at `8c5dbe5574927093473348a867390efbea1b3f1a`, region `bom1`; the public alias was verified against this commit before the final sweep.

These are unthrottled Chromium lab samples against test data, not field Core Web Vitals or physical-device acceptance. `docs/evidence/performance-local-after-2026-10-06.json` records the intermediate local build separately.

Latency spikes remain in the lab: payment entry's p95 is 4.5s. The screen sweep also saw isolated 11.7s office fee-dashboard and 14.6s admin session-health responses. Three immediate serial full-response rechecks returned 296–1578ms and 722–1028ms respectively (`performance-outliers-2026-10-06.json`); those two spikes did not recur. This release does not close field CWV or physical-device acceptance.

`docs/evidence/round-trips-after-2026-10-06.json` records five warmed full-document samples on 12 common routes from an intermediate local app build (`808ade7`, build `2k1n9P63trsa5DPpPoRJm`). Teacher Home took a median 306ms with 15 Supabase calls and a critical depth of six; attendance took 146ms, the admin dashboard 249ms and payment entry 113ms. These local measurements identify remaining waterfalls; they are not a comparison with the deployed baseline.

The application remains on `schoolfees-dev`, as required by `CLAUDE.md`; deploying the public app does not perform the separate fee-database cutover. Migration `20261006043431_native_defaulter_recovery_refresh.sql` is applied on dev and recorded under the same version locally and remotely. It adds one guarded function in `vppsone`; the public fee schema is unchanged. No real provider messages or real payments are part of acceptance.
