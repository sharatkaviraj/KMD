# The fees app's Pay now at cutover

**Approved in principle by the owner on 31 Oct 2026** (plan §6 Q8, "the fees
Pay-now tail": option (a) of `RAZORPAY.md` §7). At cutover (step C7, plan
§11) the **owner** turns OFF one switch in the fees app. Nothing in this repo
changes the fees app, its settings or its Vercel project; this page says what
that one switch does, what keeps running after it, and how One picks up the
money that still arrives.

Read from fees `origin/main` **a0ed1b1c** (31 Oct): `src/app/protected/payments/online/*`,
`src/app/pay/[code]/*`, `src/app/api/cron/online-payments/route.ts`,
`src/app/api/webhooks/razorpay/route.ts`, `src/modules/payments/data/online/service.ts`
and the SQL in `supabase/migrations/20261028140100_online_payments.sql` and
`20261029190000_online_payment_orders.sql`.

## The switch

| Where | fees app → **Payments → Online payments → Switches** (`/protected/payments/online`) |
|---|---|
| Which | **New payment links** — `app_settings` key `online_payment_links_enabled` |
| Who | an admin: `setOnlineSwitchAction` needs `settings:write` |
| Record | every flip is written to `online_payment_audit` (`action = 'switch_changed'`, `detail = {key, value}`, `actor = staff:<id>`) |
| When | at C7, after One's own online payments are on and the owner's ₹100 test has passed (`RAZORPAY.md` §6) |

That switch alone is enough: the one-tap page needs it as well as its own
switch (`readPayPage`'s `checkout_enabled` is `online_payment_checkout_enabled
AND online_payment_links_enabled`, and `online_payment_open_order` refuses
`switched_off` unless both are on).

## What stops

- **A new Razorpay payment link.** `startOnlinePaymentAction` sends the
  parent back with `?notice=unavailable`, and the database refuses on its own
  (`online_payment_open_intent` → `links_disabled`).
- **A new one-tap order.** `startCheckoutAction` answers "unavailable"
  (`online_payment_open_order` → `switched_off`).
- **The online offer on a Pay now page.** `/pay/<code>` shows the page as it
  was before online payments: the fees app's static HDFC UPI QR (and the
  amount, for a code that has one). Money paid that way is the manual tail
  below.
- **The reminder ledger re-check** (`onlineLedgerRecheck` returns undefined).
  The fees app should send no reminders after T0 anyway; `fees-quiet-check.mjs`
  reports any.

## What keeps working (so no paid rupee is lost)

The cron route says it in its own words: it "runs whatever the three switches
say about NEW links: money that has already been paid is received and
reconciled".

- **The webhook** (`/api/webhooks/razorpay`): every event is recorded in
  `online_payment_events` and processed (`processInboxEventById`); a capture is
  recorded and, with automatic posting on, posted as a receipt in the fees
  database, then the receipt WhatsApp and staff alerts follow.
- **The reconciler** (`/api/cron/online-payments`, every 10 minutes from the
  fees database's own pg_cron): retries the inbox; asks Razorpay about every
  open or recently closed payment link and records any payment it finds
  (including one made after a link expired or was superseded — that one goes
  to review); cancels links the school has moved past; reconciles open
  one-tap orders; posts captures that waited while automatic posting was
  off; drains the receipt outbox.
- **Links and orders already issued.** A payment link stays payable at
  Razorpay until its own expiry (the end of its notice's date in IST, or seven
  days when the notice has none); a one-tap order lives two hours. A parent
  returning to the page after paying is still confirmed
  (`pay_page_return` processes the link's payments before the switch is read;
  `confirmCheckoutAction` has no switch check).
- **Automatic posting and receipt recovery.** `online_payment_auto_posting_enabled`
  stays on, so a late capture becomes a fees receipt by itself; anything the
  database could not apply waits in the fees app's *Needs attention* list,
  which staff can still resolve.

## How One picks the late money up

- `node scripts/migrate/tail-sync.mjs --apply` (`MIGRATION-TOOLS.md`) reads the
  fees app after the cutover watermark: every fees receipt lands in
  **`vppsone.tail_receipts_review`** with its payments, order lines, captures
  and accounted intents as evidence (never raw `receipts`/`payments` rows),
  and `online_payment_events` are upserted on `provider_event_id`. Staff post
  each reviewed tail receipt through One's own engine, with the fees receipt
  number kept as the reference.
- `node scripts/migrate/fees-quiet-check.mjs` (read-only) counts the online
  tail receipts, the captures waiting in the fees review screen, and the open
  pay codes, and prints the **tail end** date.
- One's own Pay now skips any family that can still pay through a fees code
  (`feesPayCodeStillPayable`, `RAZORPAY.md` §7), so no family holds two live
  links at once.
- Money sent to the static HDFC QR has no end date; it is matched by hand from
  the bank statement, as today.

## The other live switches (read only, 31 Oct)

All eight online switches on the **fees** database read `'true'` today (the orchestrator's read-only check, 31 Oct). At
cutover only the first changes:

| fees `app_settings` key | On the fees screen | Live today | At cutover | Why |
|---|---|---|---|---|
| `online_payment_links_enabled` | New payment links | true | **off (owner)** | stops new links and the one-tap page |
| `online_payment_auto_posting_enabled` | Automatic posting | true | keep on | late captures post themselves |
| `online_payment_receipts_enabled` | Receipt on WhatsApp | true | keep on | a tail payer still gets a receipt |
| `online_payment_checkout_enabled` | One-tap checkout page | true | keep (no effect) | needs links on; turning it off too is harmless |
| `online_payment_checkout_all_sessions` | One-tap page for every family | true | keep (no effect) | only matters while links are on |
| `online_payment_checkout_modal_enabled` | Razorpay checkout on the page | true | keep (no effect) | as above |
| `online_payment_waive_late_fees` | Waive late fees on online payment | true | keep on | an order opened before T0 keeps the rule it was quoted under |
| `online_payment_staff_whatsapp_enabled` | WhatsApp the office on each online payment | true | keep on | the office hears of every tail payment |

## One has the same eight, with the same meaning

Checked 31 Oct after Phase E (PR #146): One's `service.ts` reads the same keys
the same way (any value but `'true'` is off; a failed read is off) and differs
from the fees file only in the `vp1_` ownership filters (D-354). On One's
database every one is a One-owned `app_settings` row
(`vppsone.one_owned_fee_settings`, and `isOneOwnedAppSetting` treats every
`online_payment_*` key as One's), so the mirror load never overwrites them.

| Key | One today | One's screen (`/fees/payments/online`) |
|---|---|---|
| the seven above except staff WhatsApp | `false` (fee-migration `20261031120200`) | `ONLINE_SWITCH_KEYS`, a real admin flips them at C7 (`RAZORPAY.md` §5) |
| `online_payment_staff_whatsapp_enabled` | `false` | "Tell the office on WhatsApp", one of `ONLINE_SWITCH_KEYS` (go-live Phase F). Its sender shipped: `staff-alerts.ts` turns each online receipt into `online_payment` staff notices in the consented staff outbox. Turned on after the `online_payment` kind (`STAFF-WHATSAPP.md` §4) |

Nothing was ported for this: Phase E missed none of the eight.
