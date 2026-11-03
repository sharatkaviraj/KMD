# Review and implementation plan (3 November 2026): how One delivers it

Source: Raj's "VPPS One App — Review and implementation plan", 3 Nov 2026
(17 pages, IDs T01–M03). That PDF is planning only; this file records what was
found in the code and what was built, per requirement ID. Owner choices
(3 Nov, in chat): Phases 1–3 now, MCP after; Fees repo changes for reads **and**
writes; the late-fee waiver shown only when relevant; Save Photo for anyone who
can already see the photo.

## The common cause behind Phase 1

When the live Fees connection (`FEES_BRIDGE_ENABLED`) was switched on for the
real session, several readers were left on the local fee tables. Under the
connection, `createProjectionFetch` refuses those tables
(`ONE_CANONICAL_FEES_REQUIRED`), and each caller turned the refusal into an
empty result: "Nothing matches", "All clear", or "could not be read" for a read
that was never attempted. TEST accounts and TEST sessions take the old local
path, which is why QA did not see it.

## Phase 1 — trust (branch `fix/review-trust-phase1`)

| ID | Found in the code | Built | Evidence |
|---|---|---|---|
| S01 search | `searchEverythingAction` read `getStudents`/`getReceiptsList` (local tables, refused) and `.catch(() => [])`; the palette had no error state | Real session: the Fees `/directory` for fee readers (parents, phones, money; active first, then all), One's roster for roster-only readers; phone queries reduced to ten digits; a "why it matched" line (father / mother / phone ••••1234); receipt links carry `receiptId` + `session`; a failed part shows "Could not search … Try again", never "Nothing matches" | `tests/vx-search-actions.test.ts` (6 new bridge cases), `tests/student-search-query.test.ts` |
| T02 Today money | `page.tsx` skipped the money read under the connection but still passed `moneyFailed = money === null` | No false failure: under the connection Today shows the existing Fees-ledger notice instead of "could not be read"; the figures themselves come from Fees `/summary/today` once that read is live (below) | — |
| T03 Inbox | Inbox and the badge read `refund_requests` (refused) inside one `Promise.all`, which also dropped One's own desk and accounts requests; eight places turned a failed source into 0 / "All clear" | Money requests settle per part (`PartialReadError`); under the connection only One's desk/accounts requests are read; Today's Needs you, the desk rail, the AI brief fact, the approvals tile, the exceptions card and the Needs you page show "Could not read this just now. It may not be empty." with Try again (`router.refresh`, no reset) | `tests/mobile-ui/today-honest-states.spec.ts` (390/1280px) |
| N03 Assign Work | Production log `student_missing` (4×, `/inbox`, `/students`): one enrolled child absent from `fees_action_students` threw for the whole sheet | Such children are left out and counted on the sheet; the error state has Try again | Vercel runtime errors, 2–3 Nov |
| F02 receipt 404 | Canonical receipt page called `notFound()` for number-only links, refused/missing receipts and an undecoded number | Explained states (`missing_link`, `unreadable`, `access`, `error`) with Open in Fees / Back / Try again; refused and missing share one message so existence is not revealed; number compared decoded | `tests/fees-bridge-native-receipt.test.tsx` |
| T01 logo | Phone Today hero (and 7 other screens) hard-coded "VP" | The shared `Crest` (school logo) everywhere | — |
| P03 header | Fees always fills `transportRouteLabel` ("No transport" when none) | `shownTransportLabel` hides the placeholder; custom transport (no route id) still shows | — |
| F01 waiver | Waive late fee shown ticked before any child was chosen | Shown only for a chosen child with a pending late fee (amount shown), ticked by default; Review waits for that read; a failed read keeps the old box | `tests/fees-bridge-live-desk.test.tsx` |

## Phase 2 — daily speed and clarity (branch `feat/review-daily-phase2`)

| ID | Found | Built | Evidence |
|---|---|---|---|
| P01 | Suspense fallback and resolved view were two cards; the swap rebuilt the profile; the portrait switched thumb → full | One mounted card updated in place (`useSettled`); ring keeps the thumbnail | Same-DOM-node regression test; Student 360 stream and documents browser specs |
| P02 | One large uncached workspace read per profile | Unchanged here: P01 removes the visible double paint; trimming the payload needs a Fees-side split | — |
| P04 | Portrait not interactive | Full-screen viewer, zoom/pan, Save through the same authorised address | Unit tests for zoom maths and filename; open/close test |
| P05 | Long definition list of every setting, "—" for unset | Applicable concessions with effect and reason; every setting folded under "How this fee is worked out" | `tests/student360-compact.test.ts`; harness screenshot |
| P06 | Long contact record, empty history boxes, one shared parent phone, masking broken | Compact contact cards; histories folded with counts; restrictions visible; per-parent numbers; masking fixed | Harness screenshots |
| S02 | Old list and total stayed with no indicator | "Updating results…" in the count; stale rows dimmed and not tappable | Directory tests |
| S03 | Horizontal quick pills | One Filters button (phone and desk), grouped sheet incl. enrolment, removable chips | Admin-mobile browser spec (390/412/844) |

## Phase 3 — native workflows (branch `feat/review-native-phase3`)

| ID | Built | Evidence |
|---|---|---|
| F03 | Fees receipt template in One; Print; Download PDF (`/api/fees-bridge/receipts/:id/pdf`, `receipts:print`) | `tests/bridge-receipt-print.test.ts` |
| F02 (cont.) | Number-only links resolve through Fees' lookup (behind the switch) | `tests/fees-bridge-native-receipt.test.tsx` |
| T02/T03 (cont.) | Today shows Fees' Dashboard figures; Fees refund requests in Needs you (behind the switch) | `tests/fees-office-reads.test.ts` |
| N01/N02 | "Decide several": grouped, reviewed, confirmed per item, retry failed only with the same command | `tests/inbox-batch.test.tsx` |
| A01 | Reminder reasons and class-teacher link; "queued" wording | `tests/vx-attendance-why.test.ts` |
| C01 | First-step button, dash for nothing to cover, named halves, classic link explained | e2e wording updated |

## Fees source reads (schoolfees `feat/one-bridge-office-reads`)

Narrow `/api/one/v1` reads requested: `/summary/today`, `/requests/pending`,
`/receipts/lookup`, `/receipts` (day book), and a consistent visibility rule for
`receipts/:id/detail` on receipts that span sessions. Each reuses the Fees
screen's own calculation. Status is recorded in `docs/PROGRESS.md`.

## Later phases

Phase 2 (S02, S03, P01–P07, U01), Phase 3 (F03 receipt print in One from the
ported template, N01/N02 batch decisions, A01, C01) and the Fees-side writes
(reversal, refund, day close through One) follow in their own branches. MCP
(M01–M03) starts after Phase 3 with a provider feasibility and permission
design; nothing in this plan builds a one-tap connection or a write tool before
that gate.
