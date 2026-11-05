# Money stays in One, and a card-by-card Collect flow

**Status: proposal, 5 November 2026. D1 (one ledger) decided the same day. Nothing here is
implemented or deployed.**
Builds on `2026-11-01-fees-one-coexistence-plan.md` (owner-authorised) and
replaces the Payment Desk parts of `2026-10-11-payment-entry-parity-design.md`.

## 1. What was asked, and the rule that shapes the answer

The ask:

1. **No redirects.** Opening payments, receipts or anything else to do with money in One must
   stay in One. One should have its own version of everything the Fees app does.
2. **A new payment entry flow.** Minimal, full and guided: pick the student smartly, then enter
   the payment smartly. One card at a time with smooth animation, and no scrolling anywhere, so
   nothing can be hidden or missed. Proper date entry and a proper cash entry. When the payment
   is saved, a seal stamps down and the receipt prints out.
3. **The same flow on desktop and on the phone.**

**The rule: Fees stays the one ledger** (owner direction, 1 Nov; `CLAUDE.md`). "One's own copy"
therefore means **One's own screens running on the same ledger**, reached through the Fees
bridge (`/api/one/v1`). It does not mean a second set of money tables.

**Why the existing copies can't just be switched on.** One already contains ported copies of
every Fees screen under `src/app/(app)/fees/*`. They read and write One's de-identified replica
(`wtgxcptmucjerhufzjcf`), not the live ledger (`vgqyilgstjvgohrsiwkb`). That is exactly why
`middleware.ts:210` sends real users to `fees.vpps.co.in`. Turning that redirect off as things
stand would cause three problems:

- real cashiers would see replica balances;
- they would post receipts that the Fees app never sees;
- they would start a second receipt series.

The coexistence plan §2 rejects two writable ledgers ("Do not choose"). Each redirect goes away
only once the screen behind it is rewired to the bridge.

## 2. Where One leaves for Fees today

**Routes the middleware redirects** (`delegatedFeesPath`, `src/platform/fees-bridge/policy.ts:57-88`).
These apply whenever `FEES_BRIDGE_ENABLED=true` and the viewer is a real user.

| One path | Goes to Fees | Bridge support today |
|---|---|---|
| `/fees/*` (all ported screens) | `/protected/*` | none (local replica) |
| `/receipts/*` nested: print, reversal, close | `/protected/receipts` | detail, reversal |
| `/receipts` (desk/day book) when office reads are off | `/protected/receipts` | list, today summary |
| `/dues` | `/protected/defaulters` | none |
| `/fee-setup` | `/protected/fee-setup` | none |
| `/reminders` | `/protected/reminders` | none |
| `/reports` | `/protected/reports` | none |
| `/student-tools` | `/protected/students` | students, directory (read) |
| `/admissions/new`, `/admissions/:id` | student new/edit | none |
| `/api/fees/*` (non-GET) | 409 `ONE_CANONICAL_FEES_REQUIRED` | — |

**Hard links that say "Open in Fees":**

| File | What it links to |
|---|---|
| `vx/screens/payments/live-fees-desk.tsx:88,170` | the Fees desk, plus the command-status page |
| `vx/screens/receipts/canonical-receipt.tsx:43,145` | the source receipt and print |
| `vx/screens/receipts/day-book.tsx:29` | the Fees receipts list |
| `vx/screens/accounts/live-finance-hub.tsx:14-19` | receipts, reports, dues, books |
| `vx/shell/ledger-notice.tsx:13` | the Fees dashboard |
| `vx/screens/admin/student360-page.tsx:166` | the photo edit page |
| `modules/dashboard/vx/admin-today.ts:288` | Today items via their `feesPath` |
| `app/rv/[code]/page.tsx:76` | receipt verification, redirected to `fees.vpps.co.in/r/` |
| `platform/config/apps.ts:143-158` | the School Fees app tile |

**Already native on the bridge:**

- student search and standing;
- quote, payment post and lost-response status (`/quote`, `/payments`, `/commands/:id`);
- receipt list, detail and lookup;
- today summary and pending requests;
- reversal, plus refund decide and process.

## 3. The Collect flow

### 3.1 Principles

1. **One card per decision.** A card asks one thing and has one primary action.
2. **Nothing scrolls, ever.** Every card fits a 360×640 phone and a 1366×768 laptop, in English,
   Hindi and both. This is enforced by a test (§3.6), not left as a hope.
3. **Smart defaults, honest confirmation.** Each card arrives already filled in where it can be,
   so a cashier can press Enter through it. Then a review card shows every choice before money
   moves.
4. **The ticket builds up.** Each answered card shrinks into a chip on the "ticket" (a rail on
   desktop, a strip on the phone). You can see at a glance that nothing was skipped, and tapping
   a chip jumps back to that card.
5. **The animation never lies.** The seal and the receipt print only after the Fees ledger
   returns a real receipt number. While the result is uncertain, the screen says so.
6. **Same cards, same order, desktop and phone.** Only the frame around them changes (§3.5).

### 3.2 The cards (revised 5 Nov after the first prototype)

The first prototype had 7 steps. The owner found that too slow and asked for fewer cards, with the
same animations and still no scrolling. The late fee now sits on the dues card, the date sits on the
payment card, and the check card appears only when the payment is unusual.

| # | Card | Shown when | What it holds |
|---|---|---|---|
| 1 | **Who is paying** | always | Smart search; "likely today" list; father's phone opens the family with **Collect for all** |
| 2 | **Dues** | always | Child, year bar, fees and late fee (shown apart), **late fee waive/collect inline**, **siblings to include**, **past receipts listed, never behind a button** |
| 3 | **Amount** | always | Big amount, suggestions, words; for a family, **how it is split and who gets what** |
| 4 | **Payment** | always | Cash · UPI · **Cash + UPI** · Bank · Cheque, with each mode's details, and the **date strip** |
| 5 | **Check** | only when needed (see below) | The full ticket, with the reason it is being checked |
| 6 | **Sealed** | after the ledger confirms | Seal, the printed receipt (one per child), next student or next sibling |

**A plain payment takes 4 cards:** who, dues, amount, then hold to save on the payment card. In the
test, that took about 7 key presses on a desktop. The seal lands on whichever card the cashier saved from.

**The check card appears only when something is unusual,** and it says why ("Checking because: Cash +
UPI · Backdated"):

- the payment is for more than one child;
- it is split between Cash and UPI;
- it is by cheque or bank transfer;
- it is backdated;
- the child already paid earlier today;
- it is more than ₹15,000;
- the late fee is waived for any reason other than the desk default.

Otherwise the hold-to-save button sits on the payment card. A per-desk setting can make the check
card appear every time instead (decision D2).

### 3.3 Card by card

**1. Who is paying.** As before:

- one search box that reads the query's shape (name, SR no, father's phone, class + name, Hindi);
- fuzzy name matching;
- a "likely today" list;
- results capped to what fits.

**New:** typing a father's phone number shows the whole family with a **Collect for all** button,
which opens card 2 with every sibling who owes already ticked.

**2. Dues: the child, and everything about their money, on one card.**

- **Who and what is owed:**
  - photo, name, class, SR and father;
  - the year bar;
  - fees pending and late fee, shown apart and never added together;
  - a warning chip if the child already paid today, or a promise is due.
- **Siblings.** One row per linked sibling who owes, each with a tick box showing that sibling's fees
  and late fee. Ticking a sibling turns this into a family payment. The siblings come from the Fees
  household link; One never guesses siblings from a shared phone number on its own.
- **Late fee, inline.** It is one row and not a separate card:
  - "Late fee ₹200" next to a Waive / Collect switch, waived by default;
  - the reason sits under it ("Reason: Desk default ▾"; tap to change);
  - with siblings ticked, the row shows the family's total late fee and the choice applies to everyone
    ticked;
  - without the waive permission, the row simply says the late fee will be collected.
- **Past receipts, always visible.** Newest first, with receipt number, date, mode and amount. As many
  rows as fit are shown, and the header says "+2 older" when some don't fit. A receipt from today is
  highlighted.

**3. Amount, and the family split.**

- **One child:** as before. A big amount, the on-screen keypad on the phone, up to 4 suggestions, the
  amount in words, and the year bar filling live.
- **Family.** The title becomes "How much, and for whom?" and the card shows:
  - **Family suggestions:** all overdue, everyone up to the next installment, the full year for all.
  - **How to divide it**, as a three-way switch:
    - **Oldest dues first** (default): money goes to the oldest unpaid installment across all the
      children, then the next oldest.
    - **Child by child:** clear the first child fully, then the next.
    - **By hand:** tap a child's row and type that child's amount; the total is the sum.
  - **One row per child**, showing who gets how much, and on desktop which installments it clears:
    "Reyansh · 8A · ₹3,200 · Inst 2 ✓ · leaves ₹6,400". A child who gets ₹0 gets no receipt. Typing
    more than a child owes turns that row red and blocks Next.
  - **On the phone**, the keypad turns into 4 × 3 to make room. The installment detail moves to the
    check card.

**4. Payment: mode, details and date on one card.**

- **Five tiles:** Cash, UPI, **Cash + UPI**, Bank, Cheque. The last mode used is remembered, except
  Cash + UPI, which is rare.
- **Cash:** received-from-parent suggestions, the change to give back, and the notes counter.
- **UPI:** the QR with the amount already in it. No UTR or reference field (owner, 5 Nov).
- **Cash + UPI (new):**
  - type the **cash part**, or pick a round figure; **UPI is the rest**, worked out for you;
  - "Show QR" opens the QR for the UPI part alone;
  - a line confirms "₹4,000 + ₹2,000 = ₹6,000 ✓";
  - if the cash part covers the whole amount, the card suggests choosing Cash instead.
- **Bank** needs nothing extra; there is no reference field. **Cheque** asks for the number, date
  and bank.
- **Paid on:**
  - a 7-day strip (Today selected) and a calendar button for earlier dates, which opens a month grid
    in place;
  - future days and days before the session can't be picked;
  - a backdated date shows a badge, and a note if it changes the late fee;
  - if the amount is now more than is due on that date, the card says so and links back to Amount.

**5. Check (only when needed).** The ticket has:

- one line per child for a family payment;
- the late fee, the payment (for example "Cash ₹4,000 + UPI ₹2,000") and the date;
- the total in figures and words;
- the "this is a new payment, not a repeat" tick when any child paid earlier today.

Tapping a line jumps back to that card and then returns straight here. Saving is the same hold.

**6. Sealed.** The same seal and printer animation as before:

- **A family payment** prints one family slip carrying each child's own receipt number, their
  installments and a subtotal. It has one total, the payment split ("Cash ₹4,000 + UPI ₹2,000") and
  one seal.
- **"Next sibling"** offers any sibling in the household who still owes and didn't get a receipt this
  time.
- **If the save response is lost**, the amber "checking" card still replaces the seal.

### 3.4 Motion system

- **Moving between cards:**
  - Forward: the current card moves left, shrinks to 0.96 and fades as the next one slides in
    from the right. This takes 220 ms on `cubic-bezier(.2,.8,.2,1)`.
  - Back runs the same in reverse.
  - On the phone, swiping right or down goes back.
- **The ticket chip** flies from the card into the rail or strip (a FLIP animation).
- **Numbers roll** between values. **Year-bar segments** fill over 300 ms.
- **CSS and the Web Animations API only, with no new dependency.** The route bundle budget
  (D-229) already fails builds that grow too much. Animate only `transform`, `opacity` and
  `clip-path`, so it stays smooth on the office's low-end Android phones.

### 3.5 Desktop and phone

**Phone** (under 900 px, the same breakpoint as the vx desk today):

- the ticket strip at the top;
- the card filling the screen;
- the primary action at the bottom, under the thumb, clear of the safe area.

**Desktop:**

- a 560 px card in the centre;
- the ticket rail on the left, a vertical list of answered cards, each one clickable;
- from card 2 on, a slim child panel on the right: the year bar, the last 3 receipts and the
  household. It is capped so it never scrolls.

The cards themselves are the same components in both layouts.

### 3.6 The no-scroll guarantee

- **A `CardFrame` component:**
  - lays the card out in a `100dvh` grid;
  - follows `visualViewport` when the phone keyboard is open, so the search card shows 3 results
    instead of 5 at that moment;
  - uses `overflow: hidden`;
  - in development, an overflow detector outlines any card whose content does not fit.
- **Content rules:**
  - lists are capped at 5;
  - installments appear as a bar, never as a table, on the main card;
  - details replace the card rather than expanding it;
  - long names are cut to fit, with the full name in the tooltip and on the review.
- **`tests/playwright/collect-no-scroll.spec.ts`** asserts `scrollHeight <= clientHeight` for
  every card and the page:
  - **viewports:** 360×640, 390×844, 412×915, 768×1024, 1366×768, 1920×1080;
  - **languages:** `en`, `hi`, `both`;
  - **difficult states:** longest name, most installments, EMI, late fee, duplicate warning,
    cheque fields, keyboard open.

### 3.7 Safety carried over (from both desks, unchanged)

- **One command id per attempt**, stored in `sessionStorage` before dispatch (the
  `live-fees-desk.tsx:118` pattern). It survives a reload, and "Resume payment" never blocks the
  counter (UI-88).
- **The quote hash is sent with the post.** A `quote_changed` reply re-opens card 3 (Amount) showing what
  changed. It is never silently re-posted.
- **Permissions are checked server-side on every action:**
  - `fees:collect` to post;
  - `payments:waive_late_fee` for the waiver;
  - `payments:adjust` for overrides.
- The bridge re-checks actor grants.
- **TEST isolation stays as it is.** Test accounts and preview deployments use the local adapter
  (§5) against `TEST-2026-27` and never the bridge.

## 4. Native money screens: one per redirect

Each row means three things: a One screen running on bridge operations, the Fees-side operations
the screen needs (in `schoolfees`, under `/api/one/v1`, additive, as the owner allowed on 1 Nov),
and the removal of the redirect and every link to it.

| Screen | One route | Bridge already has | Fees-side work needed | Phase |
|---|---|---|---|---|
| Payment entry | `/payments` → **Collect** | quote, post, status, duplicate acknowledgements | refuse future dates; cheque fields (number, bank, date); a "likely today" read; **household siblings read**; **family payment** (one command, one transaction, one receipt per child, grouped by the existing unused `family_payment_id`); **Cash + UPI tenders** on one payment (D7) | 1 |
| Receipt view and print | `/receipts/[no]` | detail | a complete receipt document payload; One renders the PDF (`@react-pdf` is already here) from canonical facts | 1 |
| Day book and receipt desk | `/receipts` | list, today summary | switch on `FEES_BRIDGE_OFFICE_READS` after migration 20261103170000 | 2 |
| Receipt verification | `/rv/[code]` | — | `GET /receipts/verify` with minimal disclosure | 2 |
| Reversal | `/receipts/[no]/reverse` | `POST /reversals` | — | 2 |
| Undo recent payment | Sealed card | — | `POST /payments/:id/undo` around `undo_recent_payment` | 2 |
| Dues / defaulters | `/dues` | — | a dues list read (class, overdue, late fee kept apart) | 3 |
| Reports and exports | `/reports` | — | report reads and export files | 3 |
| Books / finance controls | `/accounts` | pending requests | books read; day-close **request** (the Fees scheduler still owns the close) | 3 |
| Bulk payments | `/payments/bulk` | — | bridge bulk import (upload, summary, commit), with stored command ids | 4 |
| Student new/edit, photo, household | `/admissions/*`, Student360 | student reads | version-checked student and household commands | 4 |
| Reminders | `/reminders` | — | a request through the existing Fees outbox (**stop and ask**: parent messages) | 4 |
| Fee setup | `/fee-setup` | — | fee-setup reads and commands (admin only, highest risk) | 4 |

**Finishing:** remove `NATIVE_FINANCE_ROUTES` and the `/fees/*` branch from `delegatedFeesPath`
for real users. Point the "School Fees" app tile, the finance hub and the `ledger-notice` at One's
own screens. Add an architecture test that fails on any `FEES_ORIGIN` href in UI code. The ported
`/fees/*` screens stay reachable for TEST rehearsal only.

## 5. Architecture

```
src/modules/collect/
  domain/flow.ts          pure state machine: cards, guards, skip rules, ticket. Unit-tested.
  domain/search.ts        query-shape detection, transliteration, fuzzy match, ranking
  domain/cash.ts          change and notes counter
  data/money-port.ts      interface: directory, likelyToday, quote, post, status, receipt
  data/bridge-adapter.ts  real users, through platform/fees-bridge/client.ts
  data/local-adapter.ts   TEST accounts, through the existing vx payment actions
src/vx/screens/collect/
  collect.tsx, card-frame.tsx, ticket.tsx, cards/*.tsx, motion/*.ts, seal.svg
```

- **Reuse, don't rewrite:** `deskChips`, `deskLateDefault`, `deskWaivesLate` and the allocation
  preview from `modules/payments/vx/domain/desk.ts`; the attempt store from
  `modules/payments/vx/attempt.ts`; the bridge client and contracts as they are.
- **One UI, two adapters.** Test accounts rehearse the very flow real cashiers use. Today
  `/payments` shows two different desks (`page.tsx:45`), so what testers check is not what real
  staff get. This closes that gap.
- **Strings** are pairs in `src/messages/index.ts`, plus `setup.ts` for rare screens. This is
  One-native code, so it does not use `next-intl`.
- **Rollout:** while staff compare, `/payments?classic=1` keeps the current desk for two weeks.
  After that, `LiveFeesDesk` and the vx `PaymentDesk` are deleted.

## 6. Phases and how each one is accepted

| Phase | Delivers | Accepted when |
|---|---|---|
| **0. Prototype** (about 1–2 days) | A clickable prototype with the real motion, the seal and the print, on fake data. Version 1 (7 steps) was reviewed on 5 Nov. Version 2 (4 cards for a plain payment, family split, Cash + UPI) is published as the private artifact "VPPS Collect Flow" | The owner and the accountant try it on a phone and a desktop and sign off the card order and copy |
| **1. Collect + receipt print** (about 6–9 days, both repos) | §3 in full; native receipt print; the 3 Fees-side changes; `/payments` redirects and links gone | Unit tests for the flow; the no-scroll suite green; TEST rehearsal through the local adapter; one TEST bridge payment replayed by command id; a timed cash payment of 15 s or less |
| **2. Receipts complete** | day book, verification, reversal, undo | No `/receipts/*` redirect left; reversal tested on TEST |
| **3. Money reads** | dues, reports, books, day-close request | Totals match Fees for the same as-of date (IST) on 3 school days |
| **4. Remaining commands** | bulk, student/household edits, reminders, fee setup | Each one enabled separately once its TEST acceptance passes |
| **5. Clean-up** | redirect table emptied; architecture test; old desks deleted | `FEES_ORIGIN` appears only in `platform/fees-bridge/*` |

**Real collection through One** still needs the owner to switch on `FEES_BRIDGE_WRITES_ENABLED`
and the Fees command gate, after the TEST acceptance and named actor grants. This plan builds up
to that point and does not cross it.

## 7. Decisions needed

1. **D1. One ledger — decided 5 Nov 2026.** One gets its own screens; Fees stays the only book
   of money. A separate One ledger (two receipt series, conflicting payments) is ruled out, as
   the 1 Nov plan had already recommended.
2. **D2. The check card appears only when needed (revised 5 Nov).** A plain payment saves with a
   0.6 s hold on the payment card. The check card appears for the cases listed in §3.2. A per-desk
   setting can make it appear every time.
3. **D3. Cheque and bank details.** Either extend the Fees contract with structured fields
   (recommended), or keep them in remarks.
4. **D4. Cash notes counter.** Include it (stored in One, for the drawer check), or keep only
   received and change.
5. **D5. Defaults.** Sound off; auto-print after the seal off; the late fee waived by default
   (owner, 31 Oct).
6. **D6. Future dates.** Refused in One and in the bridge. The Fees desk itself stays as it is,
   because a Fees default is never changed silently.
7. **D7. Cash + UPI is one receipt with two tender lines — decided 5 Nov.** This needs an additive
   tenders record on the Fees side, so the parent gets one receipt and the day book splits cash and
   UPI correctly.
9. **D9. No UTR or reference for UPI or bank transfer — decided 5 Nov.** The fields are removed and
   nothing is required.
8. **D8. Default family split.** Oldest dues first across the family (recommended). The other choices
   are child by child, and by hand. Siblings come only from the Fees household link.

## 8. Risks

- **Hindi and `both` copy is longer.** The no-scroll suite runs every language for this reason.
- **Bridge latency.** The quote is fetched when card 2 opens and re-fetched, debounced, as the
  amount or date changes. Cards never wait on a spinner when they don't need to.
- **The animation might be read as "saved".** The seal is tied only to a returned receipt number
  (§3.3 card 6).
- **Two desks in two apps.** This is already handled by the ledger's advisory lock, the
  idempotent command id and the quote hash. No change.
- **Bundle budget.** No motion library; the seal is one inline SVG; each card loads lazily after
  the first.
