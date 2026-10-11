# Bounded phone operations follow-up — 11 October 2026

Base release: `3d5b767e64cf814f830c95727bd106a1a5db0e3b` (PR77/78). Its 22 released fixes retain their verified status. This second batch began at 16:50:51 UTC on isolated branch `test/phone-operations-followup`. Release gates are pending; this document does not claim deployment.

DEV `wtgxcptmucjerhufzjcf` was independently reconfirmed as `schoolfees-dev`, ACTIVE_HEALTHY. Protected LIVE `vgqyilgstjvgohrsiwkb` remains excluded. Temporary local configuration uses existing DEV keys, creates no credentials and is removed after genuine acceptance. Existing tagged ledgers and unresolved cleanup approval remain untouched. No DDL, grants, money transfers or family/staff notice sends occur here.

## Reproduced changes

| ID | Severity/kind | Steps and expected outcome | Actual before change | Change and focused evidence |
|---|---|---|---|---|
| FU-AC01 | P1 | Two reviewers read the same pending leave. Only the winner of the conditional decision update may arrange cover. | A loser updated zero rows but returned success and still arranged cover; concurrent approvals both reported success. | Require the returned winner ID before cover. Five actual-action checks pass, including an independent conditional-state oracle. No actual recipient-producing cover writes. |
| FU-AC02 | P2 | Approve leave spanning 27 eligible days with automation capped at 14. Report all remaining manual days. | The 13 days beyond the cap disappeared from the result. | Preserve the cap; include capped and failed days in English/Hindi manual counts. Covered in the five focused leave checks. |
| FU-CH01 | P2 improvement | Open Books Add details for a cheque whose original bank/date differ from the payment date. Review before explicit Save. | 390px reproduction showed blank bank and payment date April 3 instead of cheque date April 1. | Conservative suggestions from complete composer-shaped receipt text; canonical metadata wins, raw receipt text remains visible, opening/closing writes nothing. 82 focused checks and eight touch cases pass. |
| FU-CH02 | P2 | At 844×390 scroll to the last Books row and tap Add details normally. | Global bottom navigation intercepted the tap; first full run passed seven of eight. | Books-only bottom clearance includes navigation, gap and safe area. Final eight cases pass, asserting 44px targets, at least 12px clearance, hit ownership and trusted touch. |
| FU-CON01 | P2 | Enter an impossible follow-up date, November 31 or non-leap February 29. Reject before database access. | Parser accepted November 31; initial four checks passed three and failed one. | Exact UTC calendar round trip; eight focused checks pass, including actual-action mocked zero-read/zero-insert controls. No impossible date is claimed persisted in DEV. |
| FU-CON02 | P2, bounded fix | Append a contact then reject its response. Keep the entry and block repeat Save while its outcome is uncertain. | 390px controlled run appended once, then React's boundary replaced the entry form. | Catch the rejected promise, retain entry and warning, refuse pending dismissal and repeat Save across Close/reopen/history refresh. Four touch acceptance cases pass. This is a mounted-view guard, not durable exactly-once protection. |
| FU-CSV01 | P2 | Select a synthetic pupil whose name begins with a formula marker and download Students CSV. Keep strings as literal text and real numbers numeric. | Native 390px download emitted unprotected text; supporting baseline had 15 failures/two controls. | Shared string-only prefix in Students and assessment serializers, retaining quoting/BOM/numbers. 117 focused checks and native downloads at 360/390/412 pass. Other serializers and actual spreadsheet applications are not claimed covered. |
| FU-CT01 | P2 | Save a private note while offline. Keep review text, show truthful failure and permit an explicit retry after reconnect. | 390px rejected action escaped the transition and removed the composer; one attempted action, zero records and no Saved. | Stop known-offline saves before action; retain review on rejected responses and block current-composer repeat Save when outcome is uncertain. Final 16 touch cases pass across four layouts; independent review clean. |

Individual scoped reviews and an independent aggregate product review found no actionable regression. Existing permission, preview, schema and notice behavior are preserved. Leave decision and cover arrangement remain separate existing phases; this patch does not make them a new transaction.

## Executable coverage and evidence levels

All browser results below use Chromium touch/mobile emulation, not a physical handset. Landscape is 844×390 where applicable. Synthetic action/transport ledgers are independent test oracles; they do not establish real SQL, bank-provider or cross-session guarantees.

| Lane | Planned execution | Current result |
|---|---|---|
| Accountant | Eight Books cheque cases: 360/390/412 portrait, landscape, canonical/fallback/preview controls | 8/8 passed in 25.4s; explicit Save exactly one synthetic effect; opening/closing zero. |
| Directory exports | Actual selected-row CSV download at 360/390/412 | 3/3 passed in 18.3s; literal text, BOM, row count, numeric controls, filename and overflow verified. |
| Subject teacher/contact | Four positive phone cases plus reload, Back and second-tab boundary characterization | Four acceptance cases pass. All three boundary probes completed and reproduced the remaining manual-duplicate risk. Initial seven-case run 58.0s had four acceptance passes, one completed probe and two harness navigation failures; focused two-probe retest passed in 39.7s. |
| Fee collector/admin | 27 selected mode/reference, EMI, advance/concession/waiver, backdate, reversal and offline/recovery cases | Broad corrected run 24 passed/three fixture-portal failures in 161.672s; three reversal cases passed in 20.239s after portal correction. Collector 18 cases, admin nine; accountant stub branch untested. No new genuine financial posts. |
| Class teacher | Four offline attendance/private-note/focus/navigation cases at four layouts | Final 16/16 pass in 41.509s. Attendance zero attempts offline, durable draft after synthetic offline boot, one command/revision/delivery online. Private-note explicit retry and distinct committed lost-answer controls pass. Asset fulfillment is a harness boot, not app offline caching; viewport shrink is not a physical keyboard. |
| Academic coordinator | Eight offline/reconnect/lost-response cover component cases | 8/8 pass in 21.761s; original-ID retry one row; committed lost response one total save. Actual cover writes remain blocked by recipient isolation. |
| Admin | Two genuine 360/390px selected-decision/conflict/committed-response-loss cases on fresh uniquely tagged fixtures | Five interruption-harness checks pass; genuine run pending. See admin-interruption-followup-2026-10-11.md. |

The original admin interruption failure was test-only: removing the active route handler auto-continued it before its later abort. The repaired helper waits for the single forward, abort and browser failure before unroute/reload. Genuine acceptance must independently read back selected A, untouched B and conflict C, plus unchanged history identity after a cached command retry. Original terminal commands are never replayed.

Harness errors remain separate from product findings: omitted sheet portal hosts, duplicate fixture checkbox locators, Bank versus Bank transfer labels, and collapsed/combined receipt text. Failed attempts are retained; corrections keep the financial-effect assertions intact. No forced click substitutes for a phone tap.

## Contact recovery boundary

The warning says the contact may already be saved, asks staff to inspect the latest history and not repeat a listed contact, and requires reload before recording a new contact. Its uncertainty state belongs to the mounted view. **FU-CON03, P2, remains open:** all three 390px touch probes—reload, browser Back and another tab—lost the warning and permitted a manually repeated identical contact. Each first asserted visible original history, one record/one action; manual re-entry then produced two records/two actions, with zero sends. There was no automatic duplication. The shared synthetic effect ledger survives those boundaries, but does not establish real server concurrency or persistence. This is limitation evidence, not positive product acceptance or a full durable fix.

Durable contact command identity, receipt/readback and cross-session idempotency require a separately reviewed persistence design. A one-entry stub and retained dialog do not prove durable exactly-once semantics. The subsequent final-assessment request authorizes that assessment: DEV catalog confirms an existing UUID primary key can identify each attempt without DDL. A scoped exact-payload insert/readback and durable reservation proposal is prepared; unrelated verified fixes proceed separately. FU-CON03 is not counted fixed in this batch.

The note uncertainty guard is also explicitly limited to its mounted composer; no cross-device, storage-loss or note remount idempotency is certified. Its reproduced offline form-loss defect is fixed. Separate deliberate notes remain separate records.

## Remaining dependencies and release gates

Separate PR69 DDL approval, real cover-recipient isolation, physical Android/iPhone behavior and unresolved fixture cleanup remain blocked. Admissions, transport, documents, health/support and all payment permutations are not newly certified by this follow-up. Prior report coverage labels still apply.

Release requires focused and aggregate checks, exact-head browser CI, independent review, a draft PR, authorized merge, exact deployed commit and non-destructive phone verification. Rollback is a code revert or restoration of the preceding READY deployment; no schema/data rollback is needed. Final immutable release identifiers, run window and remaining findings will replace this pending checkpoint.
