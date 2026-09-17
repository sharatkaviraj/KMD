# SamPark and School Fees — workflow parity register

2026-09-17 baseline. Source inspection is not a live functional test. Complete
this inventory in R0.1 and update it as implementation changes. `Native partial`
means there is related code, not equivalent end-to-end behavior. `Link pending`
means the original workflow exists in source but VPPS One has no verified handoff.

Sources: `C:\Users\AnandKumari\Projects\sampark` at `830548c`,
`C:\Users\AnandKumari\Projects\schoolfees` at `48beb9a6`;
VPPS One baseline `0712de6`. Keep original repositories/deployments intact.

## SamPark

Paths below are relative to the SamPark source repo unless noted. VPPS One's
native entry is `/collection`; the visible name should become SamPark.

| ID | Workflow and source evidence | VPPS One now | Required destination / acceptance | Phase |
|---|---|---|---|---|
| S-01 critical | Token `/r/[token]`, `/t/[token]`, `/w/[token]`; `src/lib/auth/token.ts`, `requests.ts` | Native basic links and per-class request | Preserve no-login, scoped roster/fields, resume, confirm/correct, closed/unknown handling; existing original links stay available | R3 |
| S-02 critical | Frozen membership and values; `src/lib/requests.ts`, `snapshots.ts` | Request roll is rebuilt from current `enrolments` and current records | Immutable issue-time members and compared values; moving a pupil later cannot change what was asked | R3.1 |
| S-03 critical | Class/house/route audiences and filtered gaps; `requests.ts`, `ownership.ts`, bulk request route | Native request has required single `classId`; no equivalent audience builder found | Purpose + audience preview; exact same resolver for board and batch; explicit reasons | R3.1–R3.2 |
| S-04 critical | Custom Excel ask list; `src/lib/ask-list.ts`, `src/app/(admin)/requests/bulk` | No ask-list import found | ID first, SR fallback, duplicate/ambiguous/unmatched rows, row note and whole-sheet message; no name matching | R3.2 |
| S-05 critical | Bulk teacher round and request batches; `/requests/bulk`, `/requests/batch/[id]` | Individual request creation only | One operation creates teacher groups against frozen membership; retries resume same batch | R3.3 |
| S-06 critical | Master/office link; `src/lib/office.ts`, `/settings/office`, batch page | No equivalent round/master model found | One office recipient plus round master link; correct link-local and round-wide completion | R3.3 |
| S-07 critical | Verify/correct, review and precedence; `submissions.ts`, `precedence.ts`, `/review` | Native confirm/change review and overlay exist | Preserve old/new value, source, reasons, bulk confirmations, no blank erase, human correction precedence; stale review cannot overwrite newer decision | R3.4 |
| S-08 critical | Request progress, reminders and round superseding; `requests.ts`, `answered.ts`, `progress.ts` | Basic completeness; no full round board | Expected = answered + outstanding; master answers count; completed work stays visible; replacement round doesn't corrupt prior one | R3.3–R3.4 |
| S-09 critical | Templates/provider queue/status; `aisensy.ts`, `send-queue.ts`, `templates.ts`, `/settings/whatsapp` | Templates/drafts exist; provider not configured in baseline docs | Preview frozen recipient/reason, mock success/429/failure/retry; no repeated successful sends; no actual messaging for QA | R3.4 |
| S-10 critical | Student directory, details, health, sources; `/students`, `/students/[id]`, `/students/health` | Detail reached through Teach; no general directory | Search/filter, identity mapping, provenance/health and editable approved overlay; distinguish original fee data | R2.3/R4.1 |
| S-11 critical | Photo capture and bulk workflow; `photos.ts`, `photo-store.ts`, `photo-filename.ts`, teacher routes | Generic document upload; photo workflow explicitly not ported in SOURCES | Camera/file selection, retake/replace, owner mapping, progress, missing photo and office batch workflow | R4.2 |
| S-12 | Student import and conflict review; `/students/import`, `excel.ts` | Academic enrolment rebuild is not equivalent | Dry run, ID/SR match, preview, per-row errors and source precedence; original app available until parity | R4.1 |
| S-13 | Workbook/CSV export; `excel.ts`, `student-export.ts`, round exports | Academic CSV only; workbook intentionally not ported | Multi-sheet/photograph workbook where expected; Hindi/zero/blank preservation; preview/count reconciliation | R4.3 |
| S-14 | Marks, subjects, progress, settings/users/audit; `/marks/grid`, `/settings/*` | Assessments/native staff overlap partly | Map every source feature; preserve period/subject semantics through native assessments; maintain source links for remaining settings; no second marks ledger | R0/R4.3/R5 |

Completing R3 means the S-01–S-09 behaviors work, not just that route names
exist. A deliberate difference needs a documented reason, destination and test.
Mark required noncritical S-12–S-14 subfeatures during R0; do not quietly discard
them because their parent row lacks the word critical.

## School Fees

Default plan: preserve all these workflows in the original app and provide
verified access. **No native financial rebuilding is claimed.** Relative routes
must be checked against the original deployment and its account permissions.

| ID | Original route/workflow | Current VPPS One | Required handoff / validation |
|---|---|---|---|
| F-01 critical | `/protected/dashboard`, `/protected/students`, student detail/edit/new | Fee standing on student card only; no app link | Home shortcut; directory/detail context link where ID/environment matches; original search fallback |
| F-02 critical | `/protected/payments`, `/protected/payments/bulk`, alias `/protected/collections` | Link pending | Payment Desk entry; correct account, student, year and receipt path in fee test app |
| F-03 critical | `/protected/receipts`, receipt detail, `/protected/transactions`, ledger/statement routes | Link pending | Receipts/Transactions links; print, correction/reversal and repeated-submit behavior tested in fee sandbox |
| F-04 critical | `/protected/dues`, `/protected/defaulters`, previous-year dues | Read-only student summary only | Dues entry, session/filter context; source balance reconciliation; late-fee-only case not mislabelled |
| F-05 critical | `/protected/fee-setup`, `/fee-setup/generate`, `/fee-structure`, `/master-data` | Link pending | Setup/generate/master destinations; school staff retain original workflow and role checks |
| F-06 critical | Student leave date, concessions, write-offs, installment generator | No native writes by design | Student detail handoff; preserve cash vs concession/write-off and protected/reversed history behavior |
| F-07 critical | `/protected/reminders`, campaigns/lists/unreachable/runs; admin WhatsApp tools | Collection messaging is not fee reminders | Explicit Fee reminders entry; audience, family grouping, cadence/snooze/no-call and retry validated against mocks |
| F-08 | `/protected/imports`, `/protected/exports`, `/students/bulk-update` | Link pending | Data tools destinations and workbook/CSV round-trip in fee test environment |
| F-09 | `/protected/reports`, ledger print, family and student statements | Academic reports are separate | Fee reports/statements links, correct financial scope and print output |
| F-10 | Transport/master data, family groups, promotion/session-health | No native fee controls | Explicit paths/context in fee app; session and leave/transport rules preserved |
| F-11 | `/protected/finance-controls`, settings, staff, password, recovery/activity | VPPS One has independent staff/jobs | Grouped advanced destinations, original account permissions; distinguish account administration across apps |
| F-12 | Public `/r/[code]`, `/pay/[code]` | No replacement | Preserve original links; only verify routing/test provider behavior in a real sandbox; do not redirect to unrelated VPPS One token paths |

R6 owns these handoffs. R0 records exact source file, destination origin,
account role, test fixture and evidence for each subflow. Never report all fees
tested simply because a login page returned HTTP 200.

## Required status record for each implemented row

Append a per-row record with: ID/subflow; native/linked/deferred; source commit;
destination path/origin/environment; allowed and denied roles; dataset/run ID;
positive/negative/recovery test IDs; result; evidence path; delivery commit;
remaining gap. Exact live origins are intentionally not guessed from older notes.

Critical parity cannot pass on a placeholder, hidden button, unexplained
permission denial, broken deep link, duplicate ledger or source-only inspection.
