# Razorpay in One — the cutover sheet

Go-live Phase E (plan §7, D-342, D-354). One takes online fee payments exactly
as the fees app does: the same pay page, the same webhook, the same
reconciler, the same staff screen. This sheet is what the operator and the
owner need on the day. Nothing in it has been switched on: on
`wtgxcptmucjerhufzjcf` every online switch is `false`, and no Razorpay key is
set on any One deployment.

**Never** put a live key (`rzp_live_…`) anywhere but Vercel **Production**
with `VPPSONE_ENV=live`. One refuses it everywhere else (below), but the key
should not be there to refuse.

## 1. What runs where

| Piece | One path | Credential it checks |
|---|---|---|
| Parent's Pay now page | `https://one.vpps.co.in/pay/<code>` | the random pay code (160 bits); fees codes minted before the cutover line open nothing (`payCodeRefused`) |
| Its status poll | `POST /pay/<code>/status` | the same code |
| Razorpay webhook | **`https://one.vpps.co.in/api/webhooks/razorpay`** (also answers at `/api/fees/webhooks/razorpay`) | HMAC of the raw body with `RAZORPAY_WEBHOOK_SECRET`; a 404 until that is set |
| Reconciler (every 10 min) | `GET /api/fees/cron/online-payments` | `Authorization: Bearer` = `CRON_SECRET`, `ONLINE_PAYMENTS_CRON_SECRET`, or the Vault secret `VPPS_ONLINE_PAYMENTS_CRON_SECRET` |
| Staff screen | `/fees/payments/online` (nav: *Online payments*) | signed in, One's `fees:accounts`; posting also `payments:write`, closing a review `finance:approve`, switches `settings:write`; test accounts never flip a switch |

All four public paths are in the middleware's `PUBLIC_PREFIXES`
(`/pay`, `/api/webhooks`, `/api/fees/webhooks`, `/api/fees/cron`).
`tests/public-routes.test.ts` holds every route that checks a secret,
signature or token to being reachable without a session, and sends each a
cold, cookie-less request: 200 from the middleware, never a 307 to `/login`.

## 2. Environment (names only, Vercel **Production** only)

| Name | What | Note |
|---|---|---|
| `RAZORPAY_KEY_ID` | the school's API key id | `rzp_test_…` for rehearsal; `rzp_live_…` only at T0 |
| `RAZORPAY_KEY_SECRET` | its secret | never logged, never sent to a browser |
| `RAZORPAY_WEBHOOK_SECRET` | **a new secret for One's own webhook** | not the fees app's; Razorpay keeps one secret per webhook |
| `RAZORPAY_ACCOUNT_ID` | the merchant id (`acc_…`) | an event signed for any other account is ignored |
| `ONLINE_PAYMENTS_CRON_SECRET` | 64 hex characters, new | what the pg_cron job sends |
| Vault `VPPS_ONLINE_PAYMENTS_CRON_SECRET` | the same value, in **One's** database Vault | read by `online_payments_cron_secret_matches()` |
| `VPPSONE_ENV` | `live` | already set on Production; a live key counts only with it |

**The live-key guard** (`domain/online/key-guard.ts`): a `rzp_live_` key is
treated as no key at all unless the deployment is Vercel production
(`VERCEL_ENV=production`) **and** `VPPSONE_ENV=live`. On Preview, local
`next dev`, or a production deployment that does not yet declare `live`, the
pay page shows the plain UPI panel, no link, order or checkout is opened, the
webhook records events without acting on them, and the reconciler reports
"not configured". It is said once in the logs as
`online.razorpay.live_key_refused`. Test keys work everywhere — and on a
confined deployment (Preview, local) fee writes reach TEST-session families
only, so test keys can only ever pay for a TEST student there.

## 3. The Razorpay dashboard — confirm, do not change

The account is shared with the fees app until it is retired. These are
account-wide settings; the owner **confirms** each and changes nothing:

- [ ] **Post-payment receipts (Razorpay's own e-mail/SMS receipt): off.** The
  school's receipt goes on WhatsApp through AiSensy; a second channel would
  message parents twice.
- [ ] **Payment Link reminders: off.** Each link is created with
  `reminder_enable: false` and `notify: { sms: false, email: false }`, but the
  account default must agree.
- [ ] **Support contact** shown on Razorpay's pages: the school office number.
- [ ] **Settlement account and enabled methods** (UPI, cards, netbanking) as
  they are today.
- [ ] **The fees app's webhook stays** exactly as it is (it points at
  `schoolfees-two.vercel.app`, which must never redirect).

Then **add** (the one dashboard change, made by the owner at C6, live mode):

- [ ] A webhook to `https://one.vpps.co.in/api/webhooks/razorpay` with **One's**
  `RAZORPAY_WEBHOOK_SECRET`, and only these 11 events — the ones One acts on
  (`HANDLED_EVENTS`); anything else is acknowledged and dropped, so trimming
  the list is tidiness, not safety:
  `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`,
  `payment_link.cancelled`, `payment.captured`, `payment.authorized`,
  `payment.failed`, `order.paid`, `refund.created`, `refund.processed`,
  `payment.dispute.created`. (The fees app's webhook subscribes to 55;
  critique1 B16 — confirming, not changing, that one.)

### 3a. Parents, and the limits they meet (critique1 B16)

- [ ] **A notice to families before the first `_v7` send**, so a Pay now
  that opens on `one.vpps.co.in` instead of the old address is not taken for
  a scam: the `school_notice` template (AiSensy, `docs/cutover/AISENSY-TEMPLATES.md`),
  text approved by the owner, sent by the office from One's school-notice
  screen once the parent-send gate allows `school_notice` (D-353). Not before
  the gate is open; never from the fees app.
- [ ] **The HDFC static UPI QR fallback**: on the open UPI panel (Path A —
  more than 4 children, a waiver notice, a code minted by the fees app, or no
  Razorpay key) the owner confirms the payee VPA and name printed under the
  QR (`SCHOOL_UPI_PAYMENT_CONFIG`, `src/modules/payments/domain/upi.ts`) are
  the school's HDFC account, unchanged. Money paid there has no Razorpay
  record and is posted at the desk (§7).
- [ ] **The limits are the fees app's**: `CHECKOUT_MAX_CHILDREN = 4`
  (`domain/online/pay-scope.ts`; more children open Path A) and at most **15
  orders per hour per send** (`public.online_payment_open_order`, fee
  migration `20261029190000`). Unchanged in One; confirm with
  `git diff` against the fees app that nobody changed either in the port.

**Both webhooks receive every event.** That is safe because the two apps never
process each other's payments: One mints `vp1_…` link references and
`vp1_o_…` order receipts, the fees app `vpps_…` / `vpps_o_…`. The fees app
ignores anything not `vpps_`; One refuses `vpps_` in the app
(`processOrderPayment`, `reconcileOpenOrders`, the link pass, `applyCapture`,
`applyOrderCapture`) and in the database (`online_payment_{record,apply}_{order_,}capture`,
fee-migration `20261031120000`). A fees payment event at One's webhook is
written to the inbox and marked `ignored` (`not_ours`); nothing is recorded or
posted.

## 4. Receipt numbers from T0

- [ ] **At C3 (before any posting in One): `receipt_suffix_floor = 5000`.**
  Mandatory whatever the answer to Q8/Q11, until written sign-off.
  ```sql
  insert into public.app_settings (key, value) values ('receipt_suffix_floor', '5000')
  on conflict (key) do update set value = excluded.value;
  ```
  One then issues `SVP<date>-5001`, `-5002`, … (and TEST `TST<date>-5001…`),
  so a receipt the fees app issues in the tail, or on a rollback re-entry, can
  never share a number with One's. A value that is not a whole number from 0
  to 9998 **refuses every posting** (SQLSTATE VPP02) rather than silently
  dropping the band. Removing the key never reaches back below numbers
  already issued (the next is still the day's highest + 1).
- [ ] **Preflight, before C3 and again before C7:**
  `node scripts/migrate/online-preflight.mjs` (read-only). It answers GO only
  when `app_settings.receipt_suffix_floor = '5000'` **and**
  `vppsone.receipt_suffix_floor()` returns 5000, and exits 2 (NO-GO)
  otherwise — then stop; do not post or switch anything on. On 31 Oct it
  answers NO-GO, as it should before T0 (the key is unset).
- Online receipts take the session's own prefix from
  `fee_policy_configs.receipt_prefix` (SVP for 2026-27, TST for TEST-2026-27),
  the same as the desk.

## 5. The seven switches

`/fees/payments/online` → *Switches*, by a real admin (not a test account),
once fee writes are open. All seven are `false` on One's database today
(fee-migration `20261031120200`) and are One's own settings (the mirror never
copies the fees app's).

| Switch (`app_settings` key) | On the screen | Value from C7 |
|---|---|---|
| `online_payment_links_enabled` | New payment links | **on** |
| `online_payment_checkout_enabled` | One-tap checkout page | **on** |
| `online_payment_auto_posting_enabled` | Automatic posting | **on** — only after the `vp1_` filters are deployed (they are, with this phase) and the imported online rows are terminal (the importer's `TERMINAL_RULES`) |
| `online_payment_receipts_enabled` | Receipt on WhatsApp | **on** (the parent-send gate, D-353, must also allow `receipt`) |
| `online_payment_checkout_all_sessions` | One-tap page for every family | **per Q14**: off = TEST sessions only (the pilot); on = every family |
| `online_payment_checkout_modal_enabled` | Razorpay checkout on the page | **off** until Razorpay approves `one.vpps.co.in` for checkout; off = UPI Payment Link with app buttons, which needs no approval |
| `online_payment_waive_late_fees` | Waive late fees on online payment | **on for 2026-27**; on the year-end checklist to turn off |

Not switches, but set at C7:

- `online_payment_order_max_rupees` — keep the fees app's value (100000 today).
- `online_payment_upi_only` — leave unset (UPI Payment Links on).

And the reconciler's timer, in One's database (the fees catch-up had its
`cron.schedule` removed — plan §1.5, critique0 #23), once the Vault secret is
set:

```sql
select cron.schedule('online-payments-reconcile', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://one.vpps.co.in/api/fees/cron/online-payments',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'VPPS_ONLINE_PAYMENTS_CRON_SECRET')),
    timeout_milliseconds := 55000);
$$);
```

Afterwards assert no job calls the fees app:
`select count(*) from cron.job where command ilike '%schoolfees-two%'` = 0.

## 6. The order of switching on (plan §7.7)

1. **Rehearsal, test keys** (`rzp_test_…`, Preview or a production deployment
   without `VPPSONE_ENV=live`): links, checkout and auto-posting on for the
   TEST session only (`checkout_all_sessions` off). Pay a TEST student;
   watch the receipt post as `TST<date>-5001`, the inbox row go `processed`,
   the reconciler's report, and the staff screen's reconciliation row add up.
   Then set the switches back to `false`.
2. **Staging, test keys, TEST session only** — the same, end to end through
   the webhook (Razorpay's test-mode webhook to the staging host).
3. **At T0: the owner pays ₹100 with live keys on a TEST student.** Check the
   receipt, the WhatsApp receipt (allowlisted number), and that the fees app
   recorded nothing (no fees capture or `online_payment_audit` row for it —
   critique0 #32).
4. **An opt-in pilot** of named families.
5. **All families** — `checkout_all_sessions` on (Q14).

## 7. Pay now links the fees app already sent (the tail, plan §7.8, Q8)

| | What happens | Tail after T0 |
|---|---|---|
| **(a) Recommended** | At T0 the **owner** turns off the fees app's `online_payment_links_enabled` and `online_payment_checkout_enabled` on the fees app's own online screen — a settings change made through normal use of the fees app, by the owner, never by tooling. Fees orders already open (two-hour links) still post in the fees app. | about 2 hours |
| (b) No fees change at all | The tail runs to the tail end below. Every tail receipt `tail-sync.mjs` brings lands in One's tail review (`vppsone` `tail_receipts_review`, Phase 2, D-349) and is posted through One's own engine with its fees receipt number; raw `payments` rows are never copied. One's Pay now skips any family with a fees code still payable (below). Overpayments are refunded by hand. | to the tail end (2027-01-31 on the 30 Oct extract) |

**Under option (a) too, fees Path A codes still open the fees page** — with
links and checkout off there it shows its static HDFC UPI QR (and the amount
for a code with one) instead of a Razorpay payment, so the static-QR tail
below applies to every fees code until it expires, not only to option (b).

With either option, money paid to the HDFC static UPI QR is a manual tail
with no end date. `tail-sync.mjs` (Phase 2) brings fees receipts, captures and
events after the watermark, upserting `online_payment_events` on
`provider_event_id` because both webhooks see every event.

### When the tail ends (critique0 #5)

Over the fees app's `whatsapp_reminder_sends` rows that carry a `pay_code`:

    tail end = the later of
      max(IST date of created_at) + 21 days      over Path B sends (pay_scope is set)
      max(pay_code_expires_on)                   over Path A sends
    and "open-ended" while any such send has no pay_code_expires_on.

`scripts/migrate/fees-quiet-check.mjs` computes it at T0 from the fees app,
read-only through the sealed reader (`lib/tail.mjs#tailEnd`), and prints
`TAIL END`. On One's database, against the imported rows (the same rule; run
it read-only at T0 and again on any day of the tail; `<line>` is the cutover
watermark, `vppsone.migration_runs` `kind = 'cutover'`):

```sql
select
  max((created_at at time zone 'Asia/Kolkata')::date + 21) filter (where pay_scope is not null) as path_b_end,
  max(pay_code_expires_on)                                                                     as path_a_end,
  count(*) filter (where pay_code_expires_on is null)                                          as open_ended,
  count(*) filter (where pay_code_expires_on >= (now() at time zone 'Asia/Kolkata')::date
                      or (pay_scope is not null
                          and (created_at at time zone 'Asia/Kolkata')::date + 21 >= (now() at time zone 'Asia/Kolkata')::date)) as still_payable
from public.whatsapp_reminder_sends
where pay_code is not null
  and created_at < '<line>'
  and session_label !~* '^(test|uat|demo)-';
```

**One's Pay now skip** (built, critique0 #4): `executeReminderRun` reads the
same rows (`modules/whatsapp/data/fees-pay-codes.ts`, by the family's
children, the children in each send's `pay_scope`, and the family's phones)
and sends any family that can still pay through a fees code the text-only
notice — no `_v7`, no Pay now — using the rule in
`platform/migration/cutover-watermark.ts#feesPayCodeStillPayable`. If the
line or the sends cannot be read, nobody gets Pay now on that run. TEST
sessions are never held back. A same-day retry of a One send re-uses that
send's own (already checked) template. Note the open-ended codes: a fees
Path A code with no expiry (a `late_fee_applied` notice prints no date) holds
its family to the text-only notice for good, because the fees page would
take money on it for good; the count is `open_ended` above.

## 8. Proof, all rolled back on wtgx (31 Oct)

- `scripts/migrate/verify-online-vp1-and-floor.sql` — `vp1_` minting, every
  `vpps_` refusal in the database, the floor (5001…), the online prefix, the
  switches off.
- `scripts/verify-online-payments-dryrun.mjs` (48 checks),
  `verify-online-orders-dryrun.mjs` (56), `verify-online-late-fee-waiver-dryrun.mjs`
  (34) — the fees app's dry runs, run against One's functions on wtgx in one
  transaction that is thrown away.
- Unit and integration tests under `tests/fees/{unit,integration}/online-*`,
  `tests/fees/integration/online-vp1-ownership.test.ts` (a fees `order_*`
  payment arriving after its order was imported is `not_ours`),
  `tests/fees/ui/interaction/pay-checkout-panel.test.tsx`,
  `tests/public-routes.test.ts`, `tests/fee-write-guard.test.ts` (TEST
  families pay online while fee writes are TEST-only; real ones are refused).
