# Payment entry parity

Approved by the user through the parent task on 11 October 2026: restore the School Fees selection → entry → receipt workflow, including the missing controls, while retaining genuine review/confirmation and durable interrupted-save recovery. No migration.

Reference source: `veerpatta/schoolfees` main `48beb9a`. Implementation base: `veerpatta/vppsone` main `fefd2a0` (PR 76). `/payments` mounts the VX desk; the ported `/fees/payments` screen contains the proven original workflow but is not the normal entry point.

| Step | Gap on active One desk | Bounded change |
|---|---|---|
| Select | Search capped at 80; long student ledger precedes entry on phones | Search all loaded students; amount form precedes expandable dues on phones |
| Student/dues | EMI context collapsed to a boolean | Carry original monthly, catch-up, remaining, next-date and excluded-dues context |
| Amount | Decimal/text silently rewritten; ordinary shortcuts differ | Preserve invalid input and reject it; reuse original full/next/overdue/late/last/clear and EMI shortcut builders |
| Adjust | Concession absent; collector read-only | Editable whole-rupee concession (unavailable on EMI), received-by initialized from signed-in staff; retain waiver permissions/reason |
| Date/mode | Local late-fee inference; cheque reference mandatory | Read authoritative date-aware preview, block review while unavailable; keep original optional references |
| Review | Genuine review introduced in PR 73 | Preserve explicit confirmation and Back; include collector, concession and notes in review |
| Interrupted save | Request id existed only in a React ref and was cleared on student change | Persist original request and form before sending, scoped to authenticated owner/session; freeze unresolved payload, restore/check and retry same id; refuse a send when recovery storage fails |
| Receipt/next | Static card, stale directory balances | Reuse original paper/stamp/count-up receipt; retain detail/balance card, print and explicit message action; refresh returned list balances and clear only resolved attempts |

The reference's small-Cash `Review Receipt` shortcut can post immediately. It is deliberately not copied: One's first Review never posts. PR 76's awaited financial refresh and explicit-only WhatsApp remain. Partial payments and amounts toward future installments are accepted within net pending dues; this change does not introduce credit beyond dues.

All tests use synthetic records. Protected LIVE School Fees project `vgqyilgstjvgohrsiwkb` and PR 69 DDL/promotion work are excluded. DEV `wtgxcptmucjerhufzjcf` is separately authorized, but these fixtures do not connect to it.
