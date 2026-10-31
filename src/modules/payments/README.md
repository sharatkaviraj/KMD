# payments

The Payment Desk. The only place in this application that posts money.

| | |
|---|---|
| Route | /protected/payments · /protected/payments/bulk |
| Files | 17 domain · 2 data · 25 ui |

## Owns

- Student search and the desk's read model
- Allocation preview and posting
- Late-fee waiver, undo, and the bulk-entry sub-surface

## Invariants

- **Posting goes through `post_student_payment_with_adjustments`** — idempotency key, per-student advisory lock, receipt linkage, counter-side discount and waiver. `/protected/payments/bulk` is not an alternate path: every row goes through the same RPC.
- **Allocate against `total_pending`**, not `pending_amount`. Fees-only would refuse to let a cashier take a late fee the ledger is still asking for.
- **Call the permission-gated RPCs with the user-JWT client**, never the service-role one: `has_permission` needs `auth.uid()`, which is null under a service-role JWT, so every call raises.
- Reference number is optional for every payment mode.
- **`online` is UPI, never Cash.** Every mode switch that ends in a Cash default must handle `online` first. Online money is a UPI payment through Razorpay, and Cash is the figure reconciled against the drawer. `tests/fees/unit/online-mode-never-cash.test.ts` lists every such switch: add yours to it — One's own vx screens (`src/vx/`, `src/modules/receipts/vx/`) included. (Ported from fees 63ba81df.)

## Never

- Add a second posting path. Rule 5 exists because a second path is a second set of guards to forget.

## Layout

`domain/` is pure rules — no Supabase client, no `fetch`. `data/` does the IO.
`ui/` is this module's components and belongs to it alone: another module may
import this one's `domain/` and `data/`, never its `ui/`.
`npm run quality:architecture` holds that, and only lets the count fall.
