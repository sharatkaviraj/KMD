# Phone school operations audit — 11 October 2026

Release: **in progress, not deployed by this task**. Starting main/production is fefd2a05e9546a1016a4d130b0671667643aed53 (PR76). Operations [draft PR78](https://github.com/veerpatta/vppsone/pull/78) has full CI and 79 phone cases green at eda0228554dc8872b243716a51ef4843d4120ef5. Payment [draft PR77](https://github.com/veerpatta/vppsone/pull/77) is ready for combined integration at 439d334d439b46963e0591870cb9d7bb693ba60c; final operations additions are still being verified. Synthetic component results, actual navigation and persisted DEV workflows are separate evidence layers.

## Execution and safety

Six agents own class teacher, subject teacher, fee collector, accountant, admin and academic coordinator scenarios. Separate browser contexts isolate authentication; uniquely tagged fixtures have exact audit ledgers. Chromium emulation uses touch/coarse pointer at 360, 390 and 412 px portrait widths, with viewport heights varying by lane, plus 844 × 390 px landscape. No physical handset was available. Payment desktop evidence does not count as phone acceptance.

Before writes, metadata verified healthy schoolfees-dev, exact Supabase identity wtgxcptmucjerhufzjcf. Production and preview public URLs and server Supabase URL were independently checked against DEV. Protected LIVE School Fees vgqyilgstjvgohrsiwkb was excluded. Academic TEST session alone was never accepted as database isolation. No migration, grant, persistent credential or protected LIVE cutover occurred. PR69 DDL and original promotion approval remain separate.

Financial fixtures use NULL family phones and synthetic email addresses. Posting means bookkeeping only; no money transfer or automatic receipt/family dispatch. Local staff transport is disabled. Attendance family alerts are off and the parent queue stays empty. Private note has tell_parents=false and needs_follow_up=false. Trigger/function checks found no marks/note outbox producer. Actual cover writes remain blocked because its notice path may target staff whose phones are not proven synthetic; local configuration alone cannot isolate outside workers. Global flags were not changed.

Public screenshots and CI use synthetic fixtures. Auth links, keys, real student information and authenticated traces remain private. HTTP 200 alone never establishes a passed workflow.

## Role and device coverage

| Role / school-day stage | Synthetic phone acceptance | Actual DEV result | Remaining |
| --- | --- | --- | --- |
| Class teacher: register, scope, notes | 12 Student360 cases at all four layouts; 17 focused tab tests. Deferred draft overwrite reproduced before fix; 8 focused recovery tests passed | Three registers initially persisted 11 marks and one revision/effect each. Cross-class denial passes. Actual save, reload, tagged correction, revision 2/history and reload passed in 30.5 seconds; retained Aug 27 register now has 2 revisions and parent queue 0. Controlled delayed-draft actual phone check passed 4/4. Private note persists; author reload passes; second teacher cannot read its body | Last optional scope-hardening rerun at four widths pending; the earlier uncertain-save UI attempt exceeded its original time bound |
| Subject teacher: marks, correction, submit, reopen | 12 original cases; duplicate-name labels reproduced, then final 14 cases passed at phone layouts. 43 focused + 17 independent recovery checks passed | Missing refusal, 39-mark submit, required-reason correction/reopen, unassigned denial and concurrent one-success/one-stale pass. Third finalize/lock/unlock check passed in 40.3 seconds: exam role denied finalize, admin locked, exam correction hidden, admin unlocked, exam correction restored. Final readback: 78 marks/9 commands unchanged | Retained fixture; cleanup is not implied |
| Fee collector: review, partial/full/advance/receipt | Baseline review/Back/confirm/next passes four layouts, exactly 1 stub receipt/0 dispatches. Lost-response/switch/reload failed at four layouts before fix; 107 focused + 21 domain assertions pass | Portrait payment/list/account navigation and role denial pass. Seven owned setup rows, due 18,000, receipts/payments 0 | Genuine cash/UPI/PDF/reprint/denial runner prepared/typechecked, held for combined payment integration |
| Accountant: bank import, reconcile, slips, close | 30 phone cases at four layouts; 83 focused + 27 date assertions pass | Portrait account/payment/receipt/report routes pass. Seven owned setup rows; reserved date has 0 receipts and 0 closes | Reviewed five-receipt/CSV/PDF/print/day-close runner held for integration |
| Admin: directory/profile/selected approval | 13 phone + 71 focused pass: context, clipping, 44 px targets and contrast | Selected A applied once; unchecked B remains pending and unchanged; explicit C replacement has one written history; superseded older C is rejected. Separate read-only recovery at 390 px passes reload with identical DB snapshots | Cleanup approval unresolved; retained 3 fields/2 requests/4 submissions/3 records/2 history entries. Complete response-interruption harness retest pending |
| Academic coordinator: timetable/current period/cover | 12 phone + 112 focused pass: published-only teacher, editor drafts, date history, future Now suppressed | Dedicated 360 px coordinator/teacher/date/reload/denial passes with 0 writes. Generic portrait route matrix passes | Dedicated 390 px cold-server matrix incomplete; dedicated actual 412 px/landscape checks not run. Cover landed/unlanded recovery reproduced before fix; fix being verified. Actual cover writes blocked by recipient isolation |

Read-only deployed route matrix: **18 passed**, six roles × three portrait widths, touch/coarse pointer, rendered screen identity, overflow, Back/Forward/reload and denied redirects. Operations eda0228 phone CI: **79 passed**: Student360 12, academic 12, admin 13, accountant 30 and marks 12. The new marks expansion to 14 is not part of that head. These results establish phone emulation only; no physical-device acceptance is claimed.

## Visible module inventory and limits

Source inventory: 144 page routes; this does not mean 144 executed modules.

| Visible area | Status and limit |
| --- | --- |
| Dashboard/Students/profile/Fees list | Passed listed navigation/tab/filter/toolbar; comprehensive badges/family/documents not run |
| Teach/class/attendance/notes | Passed listed persisted saves, correction/reload, privacy/scope and controlled delayed-draft checks; optional four-width scope-hardening rerun pending |
| Exams/marks | Passed missing/zero/absent/exempt/submit/correct/reopen/concurrency/finalize scope/lock/unlock |
| Payments/Receipts/Accounts/Fee reports | Passed read-only and synthetic clients; genuine bookkeeping/reconciliation/close not run yet |
| Timetable/Academics/attendance overview | Passed listed read-only/component cases; actual absence/substitution/cover writes blocked |
| Admissions/Calendar/Reports | Passed rendered read-only navigation; writes/full export not run |
| Collection approval | Passed selected/conflict persisted invariants and read-only recovery; complete response-interruption harness acceptance remains pending |
| Family contact/support/follow-up/health | Private note passed; contact logging/follow-up/health-specific mutations not run |
| Transport/archives/documents/settings/staff/duty/jobs/inbox/messages/reminders/other routes | Not run unless expressly listed. No standalone transport route found; transport operations not implied |

## Reproduced bugs, expected results and fixes

| ID / severity | Reproduction / expected | Baseline actual | Fix / retest |
| --- | --- | --- | --- |
| CT01 P2 | Notes → All notes → Back: URL/tab agree | ?tab=notes rendered Overview | URL/popstate clamping; 12 phone/17 focused pass |
| CT02 P1 | Delay old draft; tap Absent; old Present must not overwrite | Focused regression overwrote tap before fix | Per-child touched guard; 8 focused checks and 4/4 controlled actual phone checks passed; optional four-width scope-hardening rerun pending |
| AD01 P2 | Filter directory → profile → tabs/reload → return: context persists | Breadcrumb/Back lost filters/page/view | Valid local return URL; 13 phone/71 focused pass |
| AD02 P2 | Select fee students at 360 px: actions visible/touchable in redesigned and classic bars | Redesigned Export/Clear and classic Bulk edit clipped; small targets | Scoped wrapping, 44 px minimum and removal of transform conflict; four layouts pass |
| AD03 P2 | Reminder icon readable on selected bar | Contrast approximately 1.03:1 | Contextual foreground; four-layout computed contrast assertions pass |
| ST01 P2 | Paper allows Exempt: phone offers it | Option absent | Permission-aware controls; missing/zero/absent/exempt/clear pass |
| ST02 P1 | Interrupt before/after commit, reload/retry once | Draft/pending ID lost; replay activity risk | Scoped durable immutable commands, unresolved guards/dedup; 12 phone/43 focused/17 independent pass |
| ST03 P2 | Identical pupil names, missing/duplicate rolls: inputs distinct | Actual DEV/two phone REDs found identical accessible names | Original roster row plus optional roll; 14 phone and independent review pass |
| AC01 P1 | Impossible/suffixed import date rejected | February 31/malformed dates normalized | Anchored parser/UTC roundtrip; 83 focused/27 assertions pass |
| AC02 P2 | Close copy describes actual effect | Claimed lock/tomorrow-only | Saved summary/later review wording; phone pass |
| AC03 P2 | Account controls at least 44 px | 34–40 px | Scoped 44 px; phone geometry pass |
| AC04 P2 | Matched bank rows but unseen app UPI: warn | False green bank/app agreement | Unseen receipt singular/plural/zero warning; 30 phone pass |
| AT01 P1 | Teacher pending timetable data remains private | Loader returned editor drafts | Server/client permission gate; 112 focused/12 phone pass |
| AT02 P2 | Selected cover date survives Back/reload | Links lost date | Date navigation preserved; four layouts pass |
| AT03 P2 | Future date has no wall-clock Now | Now displayed on unrelated day | Only actual current day; controlled time pass |
| AT04 P1 | Cover lost response → reload → check/retry original | Two 390 px regressions lack recovery, ledger landed 1/unlanded 0 | Existing check wrapper/scoped client fix under verification; actual notification writes blocked |
| FC01 P1 | Collection lost response → switch/reload → recover | Warning/request ID lost four layouts | PR77 durable scope/locking/storage compatibility; combined retest pending |
| FC02 P2 | Collector mobile bulk action hidden | Link shown canBulk = false | PR77 permission gate; combined retest pending |

Regression constraints: PR75 role scopes, PR73 genuine review before confirm, PR76 manual-only messaging and refresh-before-readback. Collector may post/print, cannot bulk/waive/adjust/reverse/close.

## Verification evidence

[Operations full CI](https://github.com/veerpatta/vppsone/actions/runs/38142826590) at eda0228 passes typecheck/lint/imports/full tests/build/budgets. [Five phone lanes](https://github.com/veerpatta/vppsone/actions/runs/38142826597) pass 79 cases. [Payment full CI](https://github.com/veerpatta/vppsone/actions/runs/38144605923) at 439d334 passes 146 files/12,565 tests/build/budgets; [payment browsers](https://github.com/veerpatta/vppsone/actions/runs/38144605906) pass 30 Chromium/WebKit cases. Final combined head remains a separate release gate.

Local theme check: 430 tokens match unchanged reference. Missing reference plugins were installed only in an ignored copy; original reference untouched. Initial local aggregate: 12,495 passed/9 timeouts/3 worker-start failures under RAM contention; six affected files rerun serially: 165 passed. Clean cloud CI supersedes local timeouts for its exact head.

Safe screenshots: [selected actions at 360 px](phone-operations-screenshots/selected-actions-360.png), [Notes restored at 390 px](phone-operations-screenshots/notes-restored-390.png), [UPI warning at 390 px](phone-operations-screenshots/upi-warning-390.png).

The separate admin recovery check passed 1/1 at 390 × 844 px with touch enabled (case 2.4 minutes; runner 3.3 minutes). Screenshots and traces were off, and every collection/review POST was blocked. Reload showed only unchecked B among the retained run’s pending decision rows; accepted A/C and rejected older C were absent. Exact record, submission and history snapshots were equal before and after reload. This verifies persisted effects and the resulting UI, while the earlier interrupted-response harness error still requires a complete retest. Private artifacts are evidence/admin-readback.json, evidence/admin-readback-results.json and the appended evidence/admin-ledger.json.

Private ledgers contain steps, exact IDs, revisions, effects and snapshots. Marks concurrency yields one success/one stale. Admin A/C each have one written history; B has zero. Attendance initially had one revision per register; the retained Aug 27 register now has two after its verified correction. Persisted assertions are separate from stub-ledger exactly-once checks. Cold RSC streams sometimes took minutes while underlying RPCs took seconds; delayed UI is not mislabeled DB rejection.

## Retention and approval

Admin cleanup hit an action-specific destructive SQL approval gate, then was aborted. It was not completed or resubmitted through another API. Tag `phoneops-20261011-admin-501680c9` retains **3 fields, 2 requests, 4 submissions, 3 student records and 2 history entries**. Deletion would permanently remove audit effects; snapshots allow reconstruction but not identical historical IDs. Exact SQL and recovery details are private in `evidence/admin-cleanup-approval.md`.

Reserved student: `0c9f719c-7c5e-4cf4-a621-bce758236697`; assigned class: `745643d0-aaca-470f-9372-d87397770a77`; session: `2026-27`. The three inactive custom fields are `e9e1f078-d9f1-43de-a6c2-c5279f402430`, `e3f433b4-ad2c-4910-a713-b4c7a1d89d52` and `466b5a01-bd83-464a-ada3-1288f0ae84a2`. The two owned requests are `6f5353e0-d58a-44f0-b7f5-5a9755c2ea0f` and `a96baabb-8283-4cf1-a0d5-484cbed21fcd`.

Cleanup predicates are restricted to those exact IDs, the reserved student and the unique tag; ordinary student fields and other lanes are outside scope. Approval manager `28b8f1e63ef74443a50e69a620e89a66:1` remains unresolved. The mutation harness defaults to preserving fixtures and requires explicit opt-in; no new mutating retry or alternate cleanup path was used.

Attendance registers, private note, current marks fixture and collector/accountant setup are also deliberately retained with ledgers. Two earlier owned marks fixtures were cleaned and independently verified zero before the separate admin gate. Broad test authorization does not imply blanket audit deletion.

## Separate improvement plan and untested permutations

1. Obtain separate approval for atomic day-close/recovery DDL. Disposable fixture reproduced duplicate simultaneous closes; do not bypass PR69.
2. Add bounded school-day runners with recipient checks, exact ownership, action settlement and transactional readback. Keep uncertain identities through delayed/lost responses.
3. Test physical Android/iPhone keyboard/safe areas/background/reconnect/browser lifecycle; emulation does not establish these behaviors.
4. Review source-only leave race/affected-row handling, family sibling context, best-effort marks activity, financial multi-write errors and small chips separately; they are not labeled reproduced here.
5. Add supported sandbox admissions/transport/documents/family contact/health/export coverage. All reversal/waiver/concession/EMI/backdate/mode permutations are not accepted merely by domain tests. No promise of every permutation.

## Release / rollback

No release by this task yet. Starting READY deployment dpl_D2YK9ojRzx4HeACamfkW8J9FhzG2 at exact fefd2a0, alias vppsone.vercel.app, is rollback candidate. Operations preview eda0228 is READY/protected. Final release must record integrated SHA, independent review, exact green CI, merge SHA, READY deployment/alias agreement and nondestructive live role checks. Application rollback does not undo retained DEV fixtures.

Clock checkpoint at 13:58 UTC: approximately 2 hours 18 minutes since the 11:40 request, not completed duration or uninterrupted active-testing time.
