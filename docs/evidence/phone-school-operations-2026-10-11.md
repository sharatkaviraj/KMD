# Phone school operations audit — 11 October 2026

Release status: **in progress; not deployed by this task**. The verified starting main is `fefd2a05e9546a1016a4d130b0671667643aed53` (PR 76). Payment changes belong to PR 77 and are being verified separately before integration. This report distinguishes compiled component acceptance, domain tests, authenticated application navigation, and persisted DEV workflows.

## Execution and safety

Six separate role agents own class-teacher, subject-teacher, collector, accountant, admin and academic-coordinator scenarios. Browser tests use separate contexts and synthetic owners. Chromium mobile emulation uses touch, coarse pointer and phone viewports: 360×844, 390×844, 412×844 and useful 844×390 landscape. No physical handset was available. Desktop widths in payment-task evidence do not count as phone acceptance.

Before any fixture writes, Supabase project metadata confirmed `wtgxcptmucjerhufzjcf` as healthy `schoolfees-dev`. The canonical deployed app's public Supabase URL was independently checked against that exact DEV identity. The protected LIVE School Fees project `vgqyilgstjvgohrsiwkb` is excluded. An academic TEST session alone is never used as proof of database isolation. No schema, grant or persistent credential changes are included. Pending PR 69 and original promotion approvals are separate.

Fixtures use unique tags and exact ownership ledgers, synthetic recipients and NULL family phones. Payments are bookkeeping records only. Local DEV configuration explicitly disables staff transport; component fixtures stub all dispatch. The deployed baseline is used only for read-only navigation and permission checks. Auth links, private traces, real student information and service keys are excluded from public artifacts.

## Executable coverage matrix

| Role / school-day stage | Component phone coverage | Authenticated app coverage | Persisted workflow status |
| --- | --- | --- | --- |
| Class teacher: register, corrections, class scope, notes, follow-up | 12 Student360 cases pass; Notes/All notes/Back/Forward/reload, allowed-tab clamping, offline navigation | Teacher and second-teacher route/denial matrix running at all three portrait widths | Attendance and notes runners prepared; local auth/compilation blocked before actions |
| Subject teacher: missing, zero, absent, exempt; submit/edit/retry | 12 cases pass; before/after-commit interruption, exactly-once stub effects, stale drafts, owner/session isolation and landscape | Teacher route matrix includes class and attendance screens | Scoped DEV marks/finalize/reopen runner prepared; not yet executed |
| Fee collector: collect/review/back/receipt/next student | Baseline review flow passed four widths; unresolved-save/reload failed four widths, reproduced before payment fix | Payments, fee list and Accounts plus role denials | Waiting on reviewed PR 77 integration and retest; no real transfer or dispatch |
| Accountant: bank reconciliation, slips, day close | 25 earlier cases pass; final UPI wording extension running | Accounts, Payments, Receipts and Reports | Unique synthetic student/family/membership/installments created and read back; zero receipts and closes; posting/day-close held |
| Admin: student directory/profile/selected actions/approval | 13 cases pass, including filter return, clipping, 44px targets and icon contrast | Dashboard, Students, Admissions, Calendar, Timetable and Reports | Selected-approval/conflict runner blocked before auth; exact cleanup independently verified zero rows across five fixture tables |
| Academic coordinator: timetable/period/absence/cover | 12 cases pass; published-only teacher view, editor pending view, selected cover date, future-day Now suppression and landscape | Academics, Timetable, Calendar and Attendance | No timetable/cover command written to DEV yet |

The source inventory contains 144 page routes. That is an inventory, not 144 executed modules. Student documents/family badges, admissions writes, transport operations, calendar edits, report exports, health/family privacy mutations and family-contact logging remain **not run** unless a later section records specific evidence. There is no promise of every permutation.

## Reproduced bugs and verified fixes

| ID / severity | Steps and expected outcome | Actual baseline evidence | Fix / retest |
| --- | --- | --- | --- |
| CT-01 / P2 | Open student Notes → All notes → browser Back; URL and visible tab should agree | `?tab=notes` rendered Overview | Initialize and restore permitted tab from URL; 12 phone cases and 17 focused tests pass |
| AD-01 / P2 | Filter Students, open profile, navigate tabs/reload, return; filters/page/view should survive | Students breadcrumb and mobile Back dropped directory context | Validate local-only return URL and preserve it through profile links; 13 phone / 71 focused tests pass |
| AD-02 / P2 | Select students in Fees at 360px; every action should remain visible and touchable | Classic and redesigned action bars clipped Export/Clear; small controls | Scoped wrapping and 44px targets; remove fixed-bar animation transform conflict; pass all four widths |
| AD-03 / P2 | Read reminder icon on selected-action bar | Foreground/background contrast measured about 1.03:1 | Explicit contextual foreground; final contrast assertions pass at all four widths |
| ST-01 / P2 | Mark a pupil exempt when paper allows exemption | Exempt option absent at 360/390/412px | Render permission-aware Exempt controls; tested missing/zero/absent/exempt and clear |
| ST-02 / P1 | Interrupt marks save before or after commit, reload and retry | Draft or unresolved command lost; replay could duplicate submission activity | Owner/session/paper-bound durable state, immutable command/revision and unresolved action guards; 12 phone cases, 43 focused tests and 17 independent tests pass with exact stub-ledger effects |
| AC-01 / P1 | Import impossible or suffixed bank date; reject invalid calendar data | Date normalization accepted values such as February 31 | Anchored parsing and UTC calendar round-trip; 83 focused tests and 27 native assertions pass |
| AC-02 / P2 | Read day-close confirmation | Copy claimed receipts were locked and tomorrow-only | Copy accurately describes saved summary and later review; phone checks pass |
| AC-03 / P2 | Use Accounts header, segmented controls, checkbox and Undo | Targets measured 34–40px | Accounts-scoped 44px controls; geometry retests pass |
| AC-04 / P2 | Reconcile imported bank rows while an app UPI receipt is unseen | Green banner falsely said all UPI payments and bank/app agreed | Reproduced on phone; contextual warning fix and final extension are being tested |
| AT-01 / P1 | Ordinary teacher opens timetable while pending edits exist | Loader supplied draft changes without editor permission | Gate draft query and client preview by edit permission; 112 focused / 12 phone cases pass |
| AT-02 / P2 | Choose another cover date, open dialog and use Back/reload | Links lost selected date | Preserve selected date through navigation; all four widths pass |
| AT-03 / P2 | Open future timetable date | Current wall-clock Now marker shown on unrelated date | Render marker only on actual current day; phone test uses controlled school time |
| FC-01 / P1 | Commit collection with lost response, switch student/reload, recover | Unresolved warning and request ID disappeared at all four widths | Sent to PR 77 owner; integration retest pending |
| FC-02 / P2 | Collector opens mobile Payments | Bulk-entry link visible despite `canBulk=false` | Accepted and fixed by PR 77 owner with collector/admin permission regression; integration retest pending |

PR 75 role scopes, PR 73 review-before-confirm and PR 76 manual-only receipt messaging/refresh-before-readback are required regression constraints. A collector can post and print but cannot bulk-enter, waive, adjust, reverse or close the accounting day.

## Verification limits and remaining work

The initial aggregate run passed 12,495 tests but had nine timeout-related failures and three worker startup errors on this constrained host. A fresh serialized run of the six affected files passed all 165 tests. This does **not** substitute for clean full CI on the final combined head. Aggregate typecheck found a test-only browser timer signature issue; its correction and focused rerun are in progress. Full build, bundle budgets, five credential-free phone CI lanes, current payment CI and exact deployed SHA verification remain release gates.

Read-only phone route checks explicitly verify rendered headings, URL, width, coarse pointer, reload/navigation and role-denied redirects. HTTP 200 alone does not establish success. Write runners require persisted row/command revision and resulting UI readback, and maintain exact fixture ledgers. They have not yet met acceptance while local application compilation blocks authentication.

Payment stub effects and marks stub effects demonstrate client behavior; they do not prove real database transaction invariants. Shared/concurrent DEV changes, genuine receipt reprint/reversal, admissions/transport/calendar writes, final day-close reconciliation and physical keyboard/safe-area/device lifecycle remain pending or not run.

## Improvement plan outside this release

1. Obtain the separately required approval for atomic day-close and other pending recovery DDL. A disposable fixture reproduced simultaneous day closes; do not bypass the existing approval boundary.
2. Add a fast, bounded DEV school-day runner with explicit fixture ownership, cold-start warmup and transactional readback. Keep provider stubs and transport-disable checks mandatory.
3. Extend physical Android/iPhone acceptance for keyboard, safe areas, background/reload/offline recovery and installation lifecycle.
4. Review source-only concerns separately: leave-approval race/affected-row handling, family sibling links losing return context, best-effort marks activity feed after a lost first response, broad financial multi-write error handling and remaining small chips. These are not labeled reproduced failures here.
5. Add operational transport/admissions/document/export coverage with supported sandbox fixtures and genuine permission denials before calling the full school-day matrix complete.

## Release / rollback ledger

No new deployment is claimed yet. Starting production READY deployment: `dpl_D2YK9ojRzx4HeACamfkW8J9FhzG2`, exact commit `fefd2a05e9546a1016a4d130b0671667643aed53`, canonical alias `vppsone.vercel.app`. Preserve this immutable deployment as rollback candidate. A final release must record PR, merged SHA, green CI links, READY deployment and alias/SHA agreement, then perform non-destructive role/navigation checks. Rolling back application code does not undo any explicitly retained DEV bookkeeping fixtures.

Actual run duration will be recorded from clock evidence at completion; authorized time is not reported as elapsed time.
