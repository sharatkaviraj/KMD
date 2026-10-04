# Release report — plan P0–P12, Gate H readiness

4 October 2026. This is the readiness report Prompt 8 asks for. It separates
what passed from what was skipped or never run, and it names the decisions
still needed. **It does not authorize deployment beyond what is already
merged, a real WhatsApp send, a parent message, or a live-fee cutover.**

## Verdict

**Ready for the bounded pilot in `docs/PILOT-RUNBOOK.md`:** one week of
absence → cover → in-app notice → acknowledgement, run by one operator with
two or three volunteer teachers. It runs on the production deployment pointed
at schoolfees-dev, with staff notices on mock or disabled and parent dispatch
off.

**Not ready for:**

- real automatic WhatsApp to staff, which needs the provider gate;
- automatic messages to parents, since the school has named no exception;
- the live-fee cutover, which is separately authorized (PLAN §7);
- retiring the School Fees deployment.

## What shipped

| Slice | Commit | What it is |
|---|---|---|
| P0, P1 | `733e197` (#41) | The live fee project is unreachable from this build; direct reads are scoped like the app |
| P2 | `aa44995` (#42) | Cover sees physical lessons (joint, split, team) and the bells |
| P3, P4, P5 | `0824721` (#43) | One atomic cover command; a revision-aware staff outbox; the teacher's duty loop |
| P6 | `6d19936` (#44) | Attendance is a whole-roll save with revisions, never invented |
| P7 | `12de230` (#45) | Marks: draft, submit, correction with a reason |
| P8 | `c3dfd64` (#46) | SA1 reports: an approved scheme, completeness, immutable issued revisions |
| P9 | `cca20a6` (#47) | Parent messages: approval by default, stale approvals refused, wrong numbers flagged |
| P10a | `f3bb72e` (#48) | Collected values: one writer, kept history, precedence |
| P10b–d, P11, P12 | this release's PR | SamPark workbook import with the identity queue; photographs; workbooks; archives and restore drill; fee-parity checks; this report, the runbook and the hosting inputs |

Every slice from P6 on was merged with green CI and its production deploy
confirmed by commit sha. This release's deploy is confirmed the same way after
merge.

## Gates

| Gate | Status | Evidence |
|---|---|---|
| **A** Live access blocked, isolated target | **Passed** | `assertPermittedTarget()` refuses unknown or live targets outside `VPPSONE_ENV=live` (D-208); every script refuses a non-dev `.env.local`; nothing in this release reached `vgqyilgstjvgohrsiwkb` |
| **B** Bounded school policy | **Passed, with an open policy list** | The bell default was approved by the user (D-211); cover policies on dev; ambiguous team supervision stays unresolved without a rule (D-210). The school's SA1 scheme and its parent exceptions are **not yet decided** (see below) |
| **C** Authority and direct reads | **Passed** | `verify:access`: every account reads exactly its scope (13 kinds of account, now including `student_record_history`); admin-only authority changes (D-205); `smoke:roles` across 8 roles |
| **D** Joint, parallel, ELGA | **Passed (unit level)** | `tests/teaching-events.test.ts`: a joint lesson is one event with one cover; an unmapped team is never arranged and says so. `tests/arrange-cover.test.ts`: an unmapped team is left for a person, with the reason |
| **E** Atomic, version-checked, idempotent command | **Passed** | `verify:cover` 20/20 (fault injection, races, stale input, replay, the operator switch). The same pattern is proved in attendance 22/22, marks 23/23, reports 14/14, records 19/19, SamPark import 17/17, photos 9/9 |
| **F** Mock outbox, uncertainty, current context | **Passed (mock only)** | `verify:outbox` 11/11: Unknown is never retried by the machine; current-context suppression. **No real send was made or enabled** |
| **G** Authenticated duty loop, phone flow | **Passed in emulation; real devices never run** | `tests/e2e/cover-workflow.spec.ts`: absence, hand assignment, acknowledgement, "cannot cover", a stranger refused, back at school, on Playwright's phone profile. No physical phone or tablet was used |
| **H** Pilot readiness, rollback | **Ready for the bounded pilot; rollback partly proved** | Runbook written. Both operator switches tested: `verify:cover` check 20 (a command is refused and nothing committed changes) and `verify:outbox` (nothing is claimed). App rollback is by promoting the previous deployment over an additive schema. **The synthetic fee posting across a rollback drill was not run** (D-239) |

## Executed checks, this release (final code, dev)

| Check | Result |
|---|---|
| `verify:cover` | PASS 20/20 (the operator switch check added in this release) |
| `verify:outbox` | PASS 11/11 |
| `verify:attendance` | PASS 22/22 |
| `verify:marks` | PASS 23/23 |
| `verify:reports` | PASS 14/14 |
| `verify:records` | 19/19 |
| `verify:sampark-import` | 17/17 |
| `verify:photos` | 9/9 |
| `verify:archive` | 10/10 |
| `verify:fee-parity` | 7/7 (505 fee functions, triggers and indexes match the baseline) |
| `verify:parent-policy` | 15/15 |
| `verify:access` | PASS: every account read exactly its scope, `student_record_history` included |
| `smoke:roles` | 784 visits: 770 as expected, 14 timeouts and 0 disagreements. The timeouts were on ported fee screens and `/teach`, slowest 29 s, during the TLS stalls. The three new screens matched the permission map for all 8 roles |
| Unit tests | 9,993 passed (this branch, after the navigation fix) |
| Lint | 0 errors (4 warnings in files this release does not touch) |
| Route bundle budgets | all 8 measured routes within budget |
| Full Playwright suite | see "Browser suites" |

### Browser suites

The test machine's TLS handshakes to Supabase stalled 4–10 s on about half of
new connections all afternoon (DNS and TCP were fast; measured with curl).
Sign-ins and first loads timed out on that, not on the code. So:

- **P10a:** 53 passed on the first pass. The five failed specs (11 tests) then
  all passed on rerun, three only on a retry.
- **P10b/c full run:** 52 passed, 4 flaky, 3 failed (sign-in `fetch failed` and
  timeouts in specs this release does not touch).
- **Final build:** every new journey and every failed or flaky spec, 46 tests:
  44 passed, 1 flaky, and 1 failure that was a real bug (the archive manifest
  comparison), fixed and passing after a rebuild.

Two real bugs were found by the browser journeys and not by the verifiers.
Both are fixed, with tests:

- the archive drill compared a `jsonb`-reordered manifest as text;
- a parent message's snapshot was written after the row.

## Fee parity (Prompt 8)

Proved from the source boundary and the catalogue, never by calling live fees
(D-239):

- An architecture test refuses any migration here that replaces, alters or
  drops a fee function or trigger, or writes `public` rows. Its one exception
  is D-191's `current_staff_role`.
- `verify:fee-parity` asserts the guards the plan names: idempotent receipts by
  request key; the posting lock; append-only receipts and payments; protected
  money columns; a locked, capped, idempotent waiver keeping `manual_collected`
  provenance; and locked reversals. It also fingerprints all 505 fee objects
  against a committed baseline.
- **Not run:**
  - the four behavioural regressions in Prompt 8 (waiver caps against a real
    pending fee, receipt DELETE attempts, same-day receipt notice identities,
    reversal coexistence), as transactions;
  - posting a synthetic payment through a rollback drill.

  Both need synthetic fee postings on the dev ledger replica, which this work
  did not take on its own authority.

## Never run, and why

| Check | Why not | Needs |
|---|---|---|
| Real phones and tablets | No device access from this environment | A person with the school's devices, the runbook's first morning |
| Real WhatsApp to staff | Rule 8: real sends need authorization; provider gate not satisfied | Account, approved campaign, test recipient and cost limit, each authorized |
| Parent automation | No school-named exception; switch off by design | The school's decision per category (D-230) |
| Synthetic fee posting through a rollback | Would write receipts into the dev replica | Approval to post synthetic payments on dev, or a separate synthetic fee project |
| Behavioural fee regressions (Prompt 8's four) | As above | As above |
| A whole-archive restore into a fresh project | No second project | A scratch Supabase project, which costs money (rule 8) |
| Physical staff trial | Not this environment's | The pilot itself |
| Live cutover | Out of scope by design | PLAN §7, separately authorized |

## Decisions the school still owes

1. The SA1 scheme: bands, rounding, pass rule, header and signatories. The
   defaults stand until the exam office approves its own (P8).
2. Any automatic parent-message category. None is set (P9).
3. The pilot's participants and the on-call escalation owner (runbook).
4. The off-site archive destination and its owner (P11).
5. Whether to authorize synthetic fee postings on dev, for the behavioural
   fee-parity regressions and the rollback drill (D-239).
6. The WhatsApp provider gate, if staff notices should leave the app.

## Where to read more

- `docs/PROGRESS.md`: per-slice status.
- `docs/DECISIONS.md`: D-205 to D-239.
- `docs/evidence/`: per-slice evidence and verifier JSON.
- `docs/PILOT-RUNBOOK.md`, `docs/ARCHIVE.md`, `docs/HOSTING-DECISION.md`.
