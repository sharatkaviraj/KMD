# whatsapp

Fee reminders and the message templates behind them.

| | |
|---|---|
| Route | /fees/reminders (+ fix, families, ladder, notices, campaigns, runs) · /fees/admin-tools/whatsapp-templates |
| Files | 58 domain · 38 data · 24 ui |

## Owns

- Template storage and rendering, in English and Hindi
- **Who a message goes to** (`domain/audience.ts`), which is a different question
  from **what it says** (`domain/campaigns.ts`)
- Reminder cadence — which families to remind, and how often
- The parent send path (`data/parent-send.ts`): the parent-send gate, then the
  school's own WhatsApp through `src/platform/whatsapp/` and the school's hub
  (D-562, D-566). AiSensy is the Fees app's, never One's
- The hub's `_v8` set (`domain/hub-templates.ts`, `data/hub-templates.ts`): the
  `_v7` fee reminders word for word, sent to Meta for approval through the hub
  and checked word for word when they come back approved. `APPROVED_HUB`
  (`domain/campaign-generation.ts`) is filled only from APPROVED statuses
- Both WhatsApp webhooks (`data/whatsapp-webhook.ts`): Meta's and the hub's
- Veer Patta AI, the helper that answers parents on the school's number,
  and its hand-offs to staff and their answers back
  (`domain/helper-*.ts`, `data/helper-*.ts`, D-574..D-584, D-588..D-590), the
  staff's own helper, which answers each member of staff as their role
  (`domain/staff-*.ts`, `data/staff-*.ts`, D-591, D-607), a school visit
  booked on WhatsApp (`domain/helper-visit.ts`, `data/helper-visit.ts`,
  D-592, D-593), and parents' files and old months of
  chats in the school's Shared Drive (`domain/parent-files.ts`,
  `data/parent-files.ts`, D-594, D-595), a receipt a parent asks for, sent
  as its PDF (`data/helper-receipt.ts`, D-597), and the suggestions a
  parent's message becomes, for a person at school to apply or let go
  (`domain/parent-suggestions.ts`, `data/parent-suggestions.ts`,
  `data/parent-suggestion-views.ts`, D-598..D-600), also from the class
  teacher's WhatsApp alert (`domain/helper-away-note.ts`, D-602); see below
- Sign in with a WhatsApp code (`domain/sign-in-code.ts`, `data/sign-in-codes.ts`,
  D-585..D-587): the code, its hash, the send through the hub. The page is
  `src/app/login/code-form.tsx`; the limits and the one-time check are SQL.
  The code is never stored or logged, and never goes to `whatsapp_messages`
- The fee calendar's read of who is due a reminder today (`domain/installment-calendar.ts`)
- Grouping the audience into families, one message per family: a shared number or linked siblings (`domain/family-grouping.ts`)
- Turning the same audience into paper a teacher can carry (`domain/collection-list.ts`)

## Invariants

- **The template does not decide the audience.** Until 2026-09-08 `situation`
  did both jobs: it picked the campaign AND gated the list through
  `qualifies[situation]`, so "Fee due" meant 92 families, "Overdue final" meant
  299, and "send the overdue wording to those 92" was not expressible. The two
  are now separate — `domain/audience.ts` decides who is on the list, the
  situation decides only what is written and which campaign is billed. Do not
  reintroduce a per-situation branch in `loadReminderAudience`; that is the
  shape this replaced.
- **The audience is the installment tiles.** Inst 1 · 2 · 3 · 4 · Last year,
  in `ui/audience-builder.tsx` on `domain/audience.ts`. Whether a tile is due
  or overdue is the CALENDAR's fact (`describeInstallmentTile`), so the tile
  says it and nothing asks for it as a filter. Two or more tiles bring up
  "owing on all of them" (the default — 187 on 1+2 the day it shipped) or "any
  of them" (345). Until 2026-09-10 the card carried nine audience chips, each
  borrowing a TEMPLATE's old audience as a preset, and twelve controls, most of
  them yes/no/either facts nobody could explain without knowing the rule they
  were extracted from; the owner's words were "very confusing". Everything
  that is left sits under "Narrow down": class, paid so far, a late fee on the
  ledger, a minimum, the promise hold-back, RTE. The two cards are numbered
  **1 What it says** and **2 Who gets it** because they used to be one.
- **Per-tile counts are counted after the hold-backs**, under the same
  narrowing controls and class as the list, so with one tile selected and
  nobody hand-picked that tile's number IS the list. `holdBackFor` was
  extracted from the loop for exactly this: a count the hold-backs then shrink
  is a count the office stops trusting.
- **Overdue is `due_date < today`, and `calendar.passed` is not it.** A tile
  reads "Overdue since …" only once its date has gone; the row due TODAY is
  "Due today" and is not overdue — the ledger, Defaulters, the dashboard and
  the flat ₹1,000 (which starts the day AFTER) all draw the line there, and
  `MONEY_GLOSSARY.overdue` is the canonical wording. `overdueInstallments`,
  `skipOverdue` and the "Overdue since" label read `calendar.overdue`
  (`daysUntilDue < 0`); `defaultInstallmentsFor` reads `passed` (`<= 0`)
  because today's row IS the money being chased today. The boundary is written
  twice — the calendar and `loadAppliedLateFees` — so edit both.
- **One sentence describes the list.** `describeAudience` in
  `domain/audience.ts` — headline, claim, notes — rendered once, in the
  builder, under one `aria-live`. It replaced two hand-rolled summaries of the
  same filters that could drift apart. Every constraint that changes who is
  messaged appears in it. Do not add a second.
- **A template is never dimmed for not fitting the audience.** Pointing a
  message at families who cannot fill its slots is the freedom this feature
  exists to give; a greyed chip reads as "unavailable". The ⚠ count says what is
  missing without discouraging it. Only an UNAPPROVED template is held back,
  because Meta really will refuse that one.
- **Every notice states what a parent will read, in one sentence.** The same
  late-fee control means three different things depending on the template —
  typed on nine, taken from the ledger per family on the waiver pair and
  `late_fee_applied`, printed not at all where there is no date slot — and
  nothing on screen used to say which you were looking at. The office must not
  have to work that out from which controls happen to be visible.
- **Every filter applies on every template.** `SITUATION_FILTERS` used to HIDE
  the installment, paid-so-far and minimum controls on a notice whose rule
  ignored them. That was honest while the notice gated the audience and a cage
  the moment it stopped. The table is gone; the audience builder shows them all.
- **There are no presets.** An absent `installments` opens on the calendar's
  passed set (`defaultInstallmentsFor`); every other key opens on
  `DEFAULT_AUDIENCE_FILTERS`. The template supplies nothing about the list.
  Keys from before 2026-09-10 — `maxTotalPaid`, `minTotalPaid`, `overdue`,
  `carryForward`, `quote` — are not in `REMINDER_QUERY_KEYS`, so nothing reads
  them and they vanish on the first navigation; `promise=open|none` falls back
  to `skip_open`. A tile href carries the hand-picked students; the office is
  refining a list, not rebuilding one.
- **The amount is DERIVED from the tiles, never chosen.** `quotedAmountFor` —
  fees still pending on the selected installments, plus the carry-forward
  remainder when Last year is on. The ledger late fee the three account-balance
  notices print is scoped to the same tiles (`lateFeeOnSelected`), so
  "Installment 2 only" for a family late on 1 and 2 quotes installment 2's late
  fee beside installment 2's fees — `loadAppliedLateFees` keeps the figures per
  row for this. Fees only, never fees plus the late fee. It was a six-way
  "quote basis" beside the filters, and before that a `switch` on the
  template; both let the amount and the audience describe different rows.
- **A fact is only "missing" if a SLOT would actually come out empty.**
  `NOTICE_FACTS` listed `next_due` and `overdue` for one day and should not
  have: the courtesy notices render through `feeDueParams` so there is no
  next-installment slot, and the context line names the selected tiles rather
  than the family's rows. Together they reported 89 of 89 families broken on a
  list where nothing was. `missingFactsFor` takes the LATE-FEE MODE and the
  late fee scoped to the tiles — in `custom` the message prints the typed
  amount and never reads the ledger, so a family with no charged fee is not a
  problem that message has. A warning that always fires is one nobody reads.
- **Two different failures hide behind that warning, and the message must tell
  them apart.** A missing late fee or amount renders **₹0** — odd, but
  delivered. A missing promised date or carry-forward session renders an **empty
  template parameter**, and WhatsApp REFUSES those: the message does not go out
  looking strange, it does not go out. `NOTICE_FACT_CONSEQUENCE` carries the
  effect and the fix per fact — each fix naming a control that is actually on
  the screen — and the guard emits one finding per fact.
- **A template pointed at families who cannot fill its slots WARNS, never
  refuses.** `NOTICE_FACTS` says what each message needs from the family reading
  it; `missingFactsFor` counts what is absent, the chips and the rows show it,
  and `notice_fact_gap` is an overridable send guard. The office asked for the
  freedom; the app never lets it happen silently.
- **`upcoming_final`'s three-day window is a guard, not a filter.** It is a fact
  about the RUN, not about a family, so it lives in `evaluateSendGuards` as
  `final_window_closed` where an admin can send early on purpose and the reason
  lands on the run. As an audience gate it emptied the list with no way to say so.
- **A student named by hand joins the list whatever the filters and their
  cadence say** — naming them is the more recent decision. It never gets past
  the three things that mean a family is uncontactable: off the roll having
  never paid, flagged no-call, or no usable number. Include and exclude ride the
  query string, so the send action rebuilds the identical list and the
  collection lists print it.
- **A saved campaign stores no hand-picked students.** It is a standing rule a
  nightly cron replays, and an included student bypasses the cadence, so
  persisting one would message that family every night. `savedAudienceFrom`
  reads every key concretely and has no legacy branch — production held zero
  rows when the tiles shipped on 2026-09-10 — and `savedAudienceParams` emits
  every key, `last_year` in `installments` included, or a Last-year campaign would
  replay on the calendar's default and chase this year's installments under
  last year's wording.
- **One list of query keys** (`REMINDER_QUERY_KEYS`) and one serialiser
  (`reminderQuery`). There were five hand-written copies — three forms, the
  picker's `hrefWith`, the collection-list links — and a key added to four of the
  five is a key that resets the moment somebody presses Apply.
- **Every form on the send screen renders `CarriedFilterFields`** and declares
  only the keys it owns. The send action rebuilds the audience from what the
  form posts, so a key missing there messages a different set of families than
  the office ticked.
- **`installments` carries the tiles, and the token `last_year` IS the
  Last-year tile.** One key, and since 2026-10-28 the two COMBINE:
  `1,2,last_year` chases installments 1 and 2 OR last session's balance, and
  asks for both added (`quotedAmountFor`). The any/all match is among the
  installments only. Slot {{4}} reads "किश्त 1 एवं 2 + पिछले सत्र 2025-26 का
  बकाया" through `scopePhrase` — one composition for a child and for a whole
  phone. It is composed on the SERVER (`scopeLinesFor`, carried as
  `ReminderCandidate.scopeLine`) so the wording never reaches the browser:
  the test panel runs `noticeValuesFrom` client-side on a route whose gzip
  ceiling only ratchets down, and composing it there cost 176 bytes. The
  Balance notice's headline adds the carry-forward too. Last
  year opens ON beside the calendar's installments once one has passed
  (`defaultLastYearFor`). Absent, blank or garbage
  (`0,9,banana`) opens on the calendar's default: zero tiles is not a state,
  because the quoted amount is derived from them and an empty set would quote
  ₹0. `parseInstallmentsValue` is the one reader, for the URL, the posted form
  and a saved campaign alike. The readers still join a repeated key with a
  comma rather than taking the first — `readerFor` and `filtersFromForm` both.

- **One audience resolution, three callers.** `data/reminder-context.ts` is the only place the drain, the policy read and the filter parse happen. The send screen, the collection lists and the lists export all go through it, because two copies of this feature's parsing have already disagreed in production.
- **The collection lists are per STUDENT.** Family grouping is for messages; a class teacher collects from children, and siblings sit in different classes.
- **The send screen gains no client JavaScript.** `/protected/reminders` has ~800 gzip bytes of headroom; every download, share and copy control lives on `/protected/reminders/lists`.
- Cadence decides who is due a reminder. It exists so staff stop unticking the same families by hand every day.
- **The calendar decides the installments, not a constant.** `defaultInstallmentsFor(calendar)` — every installment past its due date, else the next, else 1 — is resolved once, in `parseReminderFilters`, so the filter, the quoted amount and the slot {{4}} phrase cannot disagree. Slot {{4}} names the selected tiles on EVERY notice (the previous session on Last year, added after the installments when both are on); the per-notice `contextInstallments` and `TEMPLATE_INSTALLMENTS` are gone.
- **A late fee is read, never derived.** `late_fee_applied` quotes `v_workbook_installment_balances.late_fee_pending`. The view is the only thing that knows about waivers and the accrual rule at once — recomputing it in TypeScript is the trap `waive_late_fee` fell into from the other side.
- **Fees and the late fee reach the message in separate slots.** `pending_amount` is fees, `late_fee_pending` is the late fee, and only `total_pending` adds them. A message folding the first two together would be the first place "a late fee is not a fee" broke.
- **One family, one message.** A family is every child on the list joined by a shared number OR by the office's sibling link (`student_family_members`), chained. The audience loader draws it once (`familyKeysFor` → each candidate's `familyKey`), and the screen's message count, the budget guard and the sender all group by that key.
  - The message goes to the spokesperson's number, the biggest debt's.
  - A linked sibling's own number is the family's second number for escalation.
  - Until 2026-10-30 only the number counted, so 41 of 96 linked families got one message per number.
  - If the links cannot be read, grouping falls back to the number alone.
- **The audience is derived per student** because the ledger and the send log are keyed that way, but `sendFamily` sends per family. Siblings get `covered_by_sibling` rows carrying the messaged sibling's `provider_message_id`, so the unique index, the cadence gap and the run outcomes all still work per student. Since 2026-09-04 a phone with siblings gets the family template on fee_due, balance and upcoming (`domain/family-notice.ts` decides; `late_fee_applied` stays per-child until its date and total slots have a source), and every row carries the name of the message that went — so "already messaged today" reads BOTH names a notice can log under. `app_settings.whatsapp_one_message_per_family = 'false'` switches the grouping off (one message per child, as before 2026-09-05); both the Send button and the cron read it through `data/reminder-settings.ts`.
- **Language belongs to the family.** The run's language is a default; `student_collection_flags.whatsapp_language` overrides it, and the send row records what actually went out.
- **`approved` is explicit on every descriptor.** `campaignFor` refuses an unapproved campaign, and the picker shows the chip disabled rather than hiding it. All eighteen `_v3` campaigns have been approved and Live since 2026-09-04; the ten `_v4` (waiver window, waiver last call, overdue final, promise due, exam clearance) went Live on 2026-09-08, the day they were submitted. Approval is changed in code and deployed, never from a screen or a settings row.
- **The late fee has TWO MODES, on every notice, and the office picks.**
  `LateFeeSource` in `domain/late-fee.ts`. `ledger` quotes the real number —
  each family's own `late_fee_pending` where the ledger has charged one, the
  school's policy rate where it has not yet, because a forward-looking notice is
  warning about a fee that has not accrued and quoting their own ₹0 would say
  the opposite. `custom` quotes one typed amount to everybody. Which mode you
  got used to be decided by the TEMPLATE, so neither half was reachable from the
  other: the waiver notices could not be made firmer and the fee-due notices
  could not quote the real rate without somebody typing it. An absent
  `lateFeeSource` still means "whatever this template did before", so every
  pre-2026-09-10 link and saved campaign lands on what it always did.
- **Custom mode on the three account-balance notices is warned about in its own
  words.** `late_fee_applied` and the waiver pair say "the late fee on your
  account is ₹X". Everywhere else a typed figure is a lever; there it is a claim
  about the ledger, and the counter will ask for something different.
  `describeLateFeeDrift` takes `statesAccountBalance` for exactly that, and it
  still warns rather than blocks — it is the owner's school and the owner's call.
- **A failed send is retried the same day, but only a definite rejection.** `sendOne` takes a `failed` row back to `pending` on the next run (fees 1b932785). In a real session a failure whose fate is unknown — a network error or a 5xx, recorded with the `delivery-unknown:` prefix (`DELIVERY_UNKNOWN_PREFIX` in `data/parent-send.ts`) — stays claimed: WhatsApp may already have accepted it, and one parent missed beats one parent messaged twice. A TEST session retries any row, `sent` included, and its `pay_code` is rotated, which retires the earlier message's link (fees 31e85d27). One differs from the fees app here (D-352).
- **The ledger-quoted notices never take a late fee from the screen.** `late_fee_applied` and the two waiver notices quote `late_fee_pending` per family (`LEDGER_QUOTED_SITUATIONS`); the control is replaced by hidden inputs. `promise_due` prints each family's own promised date (`RUN_DATE_FREE_SITUATIONS`), so the run's date is neither shown nor guarded on it.

- **A reminder profile is an audience filter, never a property of the template.**
  `domain/reminder-profile.ts` — On-time, Standard, Chronic, Hardship, Quiet. An
  unset profile is the ledger's SUGGESTION, recomputed on every load (late fees
  on two passed installments → Chronic, a clean record → On-time, an active
  repayment plan → Hardship); `student_collection_flags.whatsapp_profile` fixes a
  family in place. The run picks which profiles it reaches (`profiles` in the one
  query-key list), Hardship and Quiet are out by default, and a family held out
  is a `profile` hold-back — named on the screen, kept on the collection lists,
  never silently missing. Do not branch a notice on a profile: the reminder plan
  picks profiles per step as a saved audience, which is the only way they meet.
- **The reminder plan is saved campaigns, nothing else.** `domain/reminder-ladder.ts`
  writes the same steps around every installment as ordinary campaigns with a
  schedule (`ladderStep`, `messageDateOffsetDays`), so the due card, the runner
  and every guard treat them like a hand-built campaign. A step's printed date
  moves with its installment; "Set up" creates only what is missing; nothing is
  created by looking.
- **The morning timer is the database's.** pg_cron calls
  `/api/cron/whatsapp-scheduled-runs` at 09:30 IST (`20261026120020`) with Vault's
  `VPPS_WHATSAPP_CRON_SECRET`, which the route checks in Postgres
  (`whatsapp_cron_secret_matches`, `20261027090000`) — one copy, never returned.
  Only campaigns ticked "sends itself" go; without the Vault secret it calls nothing.
- **The workspace gets `WorkspaceCandidate` only** (`ui/workspace-candidate.ts`),
  mapped on the server, because the whole audience used to travel to the phone
  on every tap. Every Reminders link is the shell's `NavLink` (progress bar);
  Narrow down's yes/no questions are one-tap links, not a form.
- **The send screen explains its own number.** Each tile reads "1 of 134" when
  Narrow down hides families; the headline names each filter as a removable chip
  with how many it hides, and "Why N?" splits everyone owing on the tiles by the
  first thing keeping them off. The send bars count billed messages — one per
  phone when siblings are grouped, two once the other parent is escalated to.
- **`_v6` is one template for one child or several, with Pay now.**
  `domain/campaign-bodies-v6.ts` (bodies — server only) and
  `domain/campaign-generation.ts` (names and the approval set — safe anywhere).
  Until a name is in `APPROVED_V6`, every path sends the older generation exactly
  as before. The Pay now button's URL suffix is the send's own `pay_code`.
  `late_fee_applied` has no Pay now: its headline is fees plus late fee, and the
  pay page shows fees only.
- **Pay now opens the one-screen pay page** (`src/app/pay/[code]`) for one to four
  children, and a UPI Payment Link takes the money. Live for every family since
  2026-10-30. A send's `pay_code` is rotated when a test session resends the same
  child the same day, which retires the earlier message's link.
- **School notices are their own lane.** `school_notice_sends`, their own budget,
  their own screen. A fee profile or cadence never stops an absence alert; the
  no-call flag and quiet hours do.

## The failure desk (2026-10-30)

`/protected/reminders/fix` lists every family a fee reminder did not reach, why,
and the one thing that fixes it. `data/fix-desk.ts` reads it, and
`domain/fix-desk.ts` holds the rules.

- **Five lanes.**
  - Refused: `status = 'failed'`, WhatsApp said no.
  - Not delivered: `sent` and `delivery_status = 'failed'`, from the report CSV or the webhook.
  - No answer: still `pending` after 15 minutes.
  - No usable number.
  - Left out: owes on passed installments and has a number, but has not been reached since the latest passed due date.

  The tab's red count is the number of cards: the tab and the page both read `loadFixDesk`, under `cache()`.
- **One cause rule.** `domain/failure-cause.ts` turns the error text, WhatsApp's
  code (131026 …) and the HTTP status into one of nine causes. The sender, the
  report import and the webhook all write `failure_cause` through it. Each
  cause sets the row's words (English and Hindi), its button, and whether
  Resend is allowed (`resendPolicyFor`). Template and account faults are the
  school's, so they show as one banner for the group, not as forty rows.
- **Resend is not a second send path.** It rebuilds the Send screen's form:
  the run's notice, language and installments, the failed children named by
  hand, plus `withFamily` and `skipNothingDue`. That form goes to
  `sendRemindersAction`. So the resend gets:
  - every guard;
  - the budget;
  - the ledger re-check of every child;
  - the claim. The sender takes a failed row back with an update guarded on its
    status, so two presses at once send ONE message.

  The old run-page retry re-sent stored params with no claim and re-quoted
  one-child Pay now rows only. It now goes through the same path.
- **An undelivered message reached nobody.** `loadSentToday` and `loadLastSentOn`
  skip `delivery_status = 'failed'`, and the sender's reclaim takes such a row
  back, so a family WhatsApp did not deliver to is still due today's reminder.
  The filter is `or(delivery_status.is.null, delivery_status.neq.failed)` —
  `neq` alone drops the NULLs, which is every row no report has touched.
- **A dead number is not paid for twice.** The `whatsapp_number_health` table is
  keyed by the last ten digits and written by trigger. A number is dead while
  its latest word is not_on_whatsapp, invalid_number or opted_out, with nothing
  delivered since. `pickFamilyNumber` (`domain/phone-numbers.ts`) then picks the other
  parent's number, and the audience and the desk share it, so "Resend to
  mother's number" is what the send does. With neither number usable, the
  family is listed on the cannot-reach page with `reason = 'dead'`. Re-typing a
  rejected number in the sheet needs a tick, so the office vouches for it on purpose.
- **History is the database's job.** `whatsapp_send_attempts` gets one append-only
  row for each:
  - provider answer;
  - delivery result;
  - human resolution.

  The `whatsapp_send_after_write` trigger writes it, so no code path can forget.
  `whatsapp_send_before_update` counts a reclaim as the next attempt and clears
  the previous message's delivery result.
- **Delivered-later and paid-since are derived, never stored.** A failure is "sorted itself" when:
  - a later reminder reached the child; or
  - nothing is owed any more on the installments it asked for.

  The ledger and the send log decide, so the desk cannot disagree with them.
  `resolution` stores only what a person says: called, slip_sent, or dismissed
  with a reason.
- **One report import covers the session.** A campaign report (exported
  before D-562, when One sent through AiSensy) spans
  every run that used the template. Rows are matched by message id. The
  phone + day fallback fires only for a report row with NO id: a row whose id
  matches nothing is a message since resent, and matching it by phone would
  mark the resend failed.
- **Numbers are fixed with the staff member's own client.** The
  `audit_students` trigger records who changed what. Siblings who carried the
  same old number change with it when ticked.

## Veer Patta AI (2026-11-12)

The school's WhatsApp helper answers a parent's message from One. The hub
forwards it; `data/whatsapp-webhook.ts` starts `runHelperTurns` at once, beside
its own work, for messages from the hub only.

- **Pure rules in `domain/`, IO in `data/`.** `helper-text` reads the message
  (language, a plain ask, a tap on the helper's own buttons, a voice note).
  `helper-facts` turns the one read (`vppsone.parent_helper_child`) into a
  child's fees, receipts, attendance and results. `helper-replies` writes
  every card in Hindi, Hinglish and English. `helper-plan` decides the turn.
  `helper-ai` holds Claude's prompt and the answer's shape. `helper-messages`
  fits a reply to WhatsApp's limits. `data/helper-turn.ts` runs it,
  `data/helper-store.ts` reads and writes, `data/helper-claude.ts` asks Claude.
- **The claim decides who answers.** Every check before
  `POST /v1/typing` may give up, and then the hub's own bot answers. Once the
  hub hands the message to One, One always answers: Claude's words, a card or
  the menu. `tests/whatsapp-parent-helper-turn.test.ts` holds both halves.
- **Figures come from the cards.** Claude picks the words and names a card
  (`show`); amounts, marks and attendance are always the card's, built from
  the records, with the fees and the late fee apart.
- **Practice only for now.** The helper knows one number, the owner's test
  number, standing for the TEST children in `parent_helper_settings`. Real
  families need a number-to-family read through the Fees bridge first.
- **Words are not kept.** One keeps the language and what the helper waits
  for (`parent_helper_chats`) and how each message was answered
  (`parent_helper_turns`); a hand-off is the one message written down, into
  Messages (`parent_replies`). The hub keeps the conversation.
- **A hand-off reaches a person (step 2, D-578..D-580).** `openHandoff`
  (`data/helper-relay.ts`) writes it to `parent_helper_handoffs` and tells the
  people `peopleFor` names (`domain/helper-handoff.ts`), now in the day or at
  6 am; `nextStep` plans the reminder at 3 hours and, for a complaint, the
  pass up to an admin at a day, always inside 6 am to 9 pm India time. The
  job `/api/jobs/parent-helper` runs what is due (`runDueHandoffs`, pg_cron
  `parent-helper`). An alert is typed while the person's chat is open, else
  the approved template (`domain/helper-hub-templates.ts`), and its message id
  is kept (`parent_helper_alerts`).
- **The answer comes back.** A reply that quotes an alert, from the number it
  went to, is that person's answer (`handleStaffAnswer`, step 1a of the turn);
  an answer typed in Messages to a helper hand-off goes the same way
  (`relayFromMessages`). It goes to the parent while their chat is open, else
  the "your answer is ready" note and the answer waits
  (`parent_helper_deliveries`) until they next write (`deliverWaitingAnswers`,
  before anything else in the turn).
- **Practice.** A practice hand-off tells one person, on the owner's number,
  so the owner can play both sides. Practice mode or the switch off stops the
  hand-off quietly, and Messages answers the old way.
- **Staff link their own WhatsApp (D-582).** "Link my WhatsApp" (My
  profile, Your settings) makes a one-time code (`startStaffLink`,
  `data/staff-link.ts`); the person sends it from their phone, and the turn's
  step 1b (`handleStaffLink`) links the number it came from through
  `vppsone.link_staff_whatsapp`, with their yes (`self`). Linking sends
  nothing; the answer on WhatsApp is the helper's, under its switch and
  practice mode. The card is `vx/ui/link-whatsapp.tsx`.
- **Only staff who said yes are told (D-583).** `reachOf` turns a person with
  a number but no yes into `no_consent`, noted on the alert like a missing
  number. Practice still goes to the owner's number.
- **"Did this answer help?" (D-584).** Once an answer reaches the parent,
  `askRating` (`data/helper-relay.ts`) asks once, on two buttons whose ids
  carry `ratingKey` (twelve letters of the hand-off's id). The tap is a
  `rate` plan (`helper-plan`); `rateAnswer` matches it among the tapping
  number's own hand-offs only and keeps it (`rating`, a "no" may replace a
  "yes", never the other way). A "no" becomes a new message in Messages for
  the office, with the parent's words and the answer (`followUpBody`), and a
  hand-off to the office with topic `not_helped`, a complaint, opened after
  the parent's reply has gone (`composeRating`, `data/helper-turn.ts`). The
  office's answer to it quotes the first question (`quoteOf`) and is never
  rated.
- **A child who will be away (D-588).** Claude reads "Riya bimar hai, aaj
  nahi aayegi" into `absence` (from today or tomorrow, how many school days,
  sick or other); `helper-absence` turns it into the days, in India, Sundays
  skipped, one to seven. It is a hand-off to the class teacher with topic
  `leave`; once that is in Messages, it becomes a suggestion (D-598, below)
  and nothing more. The parent is told which day's register shows it once
  the class teacher has checked it, and only once the suggestion is kept.
  When a person applies it, `decide_parent_suggestions` keeps one row per
  child per day in `parent_absence_notes` (the first note for a day stands)
  with the mark chosen, and stops that day's absent alert still waiting in
  To send. The register reads the notes
  (`modules/attendance/data/parent-notes.ts`): the child starts as Leave or
  Absent, as chosen, with "Parent informed" beside the name, and the save
  queues no absent alert for that child. While nobody has applied it, the
  register shows "Parent says sick" under the child with Leave and Absent
  (D-601, `waitingAbsencesOn` and `registerAskLine`): saving the child as
  Leave or Absent applies it as the teacher (`via = register`), before the
  save works out the absent alerts.
- **Decided from the alert itself (D-602).** The class teacher's alert about
  a note still waiting carries its days and reason and three buttons, Mark
  Leave, Mark Absent and Not now (`domain/helper-away-note.ts`): typed reply
  buttons while their chat is open (ids `vpnote:<choice>:<note id>`), else
  the approved `vpps_staff_away_note_<hi|en>_v1`, whose quick replies carry
  the same ids back (`quickReplies` in `platform/whatsapp/payload.ts`); until
  Meta approves it, or when Meta refuses the buttons, the ordinary alert
  goes. `handleStaffAnswer` reads a tap (`readNoteTap`) before anything else
  and decides only the note the alert's own hand-off came with
  (`readHandoffNote`), through `decide_parent_suggestions` with
  `via = whatsapp`, as the person the alert went to; the reply says what
  became of it (`noteConfirmText`). A decision made anywhere clears its
  hand-off's next reminder (`stopRemindersFor`); the hand-off stays open.
- **Teach it once (D-589).** A general question Claude cannot answer from
  FACTS comes back as `unanswered` (one short English line, or the P key it
  matches). `lessonNoteFor` (`domain/helper-lessons.ts`) keeps it only when
  `cleanQuestion` passes it: no word of the family's names (`familyWords`),
  no long number, phone, @ or link. After the answer is sent, `noteLesson`
  (`data/helper-lessons.ts`, `vppsone.parent_helper_note_lesson`) lists it or
  counts it again by its fingerprint; a school answer Claude used
  (`school_answer`) is counted as used. `readSchoolKnowledge` gives Claude
  only what an admin decided: answered ones as A1…, "a person answers" ones
  as P1…, never a waiting question. The admin's page is
  `src/app/(app)/settings/whatsapp/helper/`; which list it reads and changes
  (`practice`) comes from who is looking, never from the form.
- **The week (D-590).** `weekReport` (`domain/helper-week.ts`) turns the
  week's turns, hand-offs, their first answers, ratings and the still-open
  hand-offs into the numbers on the page's This week tab;
  `readHelperWeek` (`data/helper-week.ts`) reads them, Monday 00:00 India
  time, the practice family's or real families' by `practice`.
- **The teachers' own helper (D-591).** Step 1c of the turn, after a swipe
  (1a) and a link code (1b): `handleStaffCommand` (`data/staff-helper.ts`).
  A number is staff only when `readLinkedStaff` proves it: an active profile
  whose used link code came from this very number
  (`staff_whatsapp_links.used_from`), with WhatsApp on. A number on a staff
  record that never linked itself is told to link first, and only when it
  uses one of D-591's staff words (`staffCommandIn`) or a staff tap;
  anything else from it, or from anybody else, returns null and the
  parents' helper goes on.
  The reply goes through the same gates as every helper message
  (`checkWhatsAppSend` for `parent_helper`, the hub's claim, the ledger).
  `readStaffDay`, `readStaffAbsent` and `readOpenHandoffsFor` read only that
  person's own slots, cover, class register and hand-offs, in their own year
  (`sessionLabelForStaff`); *questions* re-sends the oldest three as
  `reminder` alerts with their message ids, so a swipe answers them.
- **Each member of staff as their role (D-607).** A proven number is
  answered as its person's role for everything it sends, not only D-591's
  words. `readStaffAsk` (`domain/staff-words.ts`) reads a tap (`vpst:` asks,
  `vpsr:` roles), a command's words, a role ask ("try as accountant",
  "teacher mode", "as parent", "staff") or typed words; `routeStaffMessage`
  (`domain/staff-route.ts`) decides who answers and as whom. The desk
  (`domain/staff-desk.ts`) is the role's menu in the role's order, cut by the
  person's permissions (`can()`) and what they hold: `deskOf`, `deskCommands`,
  `deskMenuReply` (a WhatsApp list), and every answer ends with the desk's
  next two asks and Menu (`deskButtons`). The reads are `data/staff-desk.ts`
  (the school today, staff away, cover, leave asked, Needs you, and fee
  figures through `vppsone.staff_helper_fees`, which answers a TEST session
  only: a real year's money is the Fees app's and the reply points to One).
  Typed words that are none of the desk's go to Claude
  (`data/staff-claude.ts`, the quick model, `staffUnderstandingSchema` in
  `domain/staff-understand.ts`): it chooses one of the desk's asks, or
  "parent" or "unclear", and never writes the answer; with the AI helper off,
  over budget or failing, `keywordCommands` decides. The ledger's route says
  which (`ai`, `fallback` with `ai_<problem>`, `rule`). "as parent" sets the
  chat's `hat` to `parent` and the parents' helper answers that number until
  "staff"; a parent-like message from a staff number is never passed on as a
  parent's by itself. **The owner's test number tries roles** on practice
  records: `hat` is the role being tried (`OWNER_DEFAULT_HAT`, admin, until
  he picks another; null means never answered as a role, so the first answer
  carries `firstHatNote` and saves admin), each role answering as one test
  account (`readPracticeSeat`, `pickPracticeSeat`: holding a class first,
  then the day-run QA account, then a named one). Its buttons carry the role
  (`vpst:dues:accountant`), so an older one answers as its role, and it gets
  `OWNER_TURNS_PER_DAY` (200) answers a day (`dailyTurnCap`). The turn reads
  the switches and settings once, side by side with the staff step, and
  hands the same reads to both (`staffCommand(message, switches)`), so a
  parent's answer waits for nothing new. Nothing on a desk writes: a
  decision is taken in One, and the answers link to its screens. Migration
  `20261113205845_staff_helper_roles.sql`.
- **A school visit (D-592, D-593).** *admission*, the menu row or the
  `vpai:visit` button under Claude's answer about admission starts it. The
  turn reads the family's session calendar (`readVisitCalendar`) only when
  `needsVisitCalendar` says the days may be shown; `visitDays` offers open
  days from tomorrow, three weeks at most, and a tapped day is checked again
  (`canVisitOn`). After morning or afternoon the chat waits 30 minutes for
  the name and class (`awaiting = visit:<yyyymmdd><am|pm>`, allowed by the
  chat table's check); `readVisitChild` reads them and the parent's words go
  with them to the office as a hand-off. Once the hand-off is in Messages
  the visit waits as a suggestion for the office (D-598); Add to Admissions
  puts it on the board (`vppsone.enquiries`, `source = whatsapp`, one per
  hand-off). The reply never says the visit is confirmed: the office calls
  to fix the time.
- **A parent's word is a suggestion, never a change (D-598..D-601).** The
  turn's only write about a child is `addParentSuggestion`
  (`data/parent-suggestions.ts`, `vppsone.add_parent_suggestion`): a child
  who will be away, a school visit, or a detail the parent asks to change
  (`change` in Claude's answer, kept only when `normaliseChange` takes the
  value: five fields, a value the school would hold). The database routes it
  (the class teacher for an absence in a class that has one, the office for
  the rest) and sets when it stops waiting. `decide_parent_suggestions` and
  `undo_parent_suggestion` are the only writers of what a suggestion
  changes, as the member of staff deciding, through the server actions in
  `src/app/(app)/inbox/parent-actions.ts`. Undo keeps every row (D-599): a
  note is withdrawn (`withdrawn_at`, and `parentNotesFor` skips it), an
  enquiry closed, a value put back through the record writer. `inNeedsYou` decides who sees
  which in Needs you; `parentNoteViews` and `parentReaderFor`
  (`data/parent-suggestion-views.ts`) shape them for the screens. Client
  components import `domain/parent-suggestion-words.ts` only.
- **Parents' files and old chats in Drive (D-594, D-595).** The hub keeps a
  file's Meta id only, and Meta keeps the file about a month, so One copies
  it into the Shared Drive through the hub (`platform/whatsapp/hub-files.ts`):
  the webhook starts `copyFilesFromWebhook` for that message's files only,
  and the hourly job (`/api/jobs/parent-files`, `{"part": "files"}`) runs
  `sweepParentFiles` for what was missed, never a file younger than ten
  minutes. `fileScope` (`domain/parent-files.ts`) decides whose: nobody's
  with the helper off, the owner's number into the practice folder while
  real recipients are off. A copy is found by its name (`driveFileName`)
  before one is written, so a retry never makes two; the hub is told the
  Drive id (`saved`), or a problem with the file itself. Once a night
  (`{"part": "archive"}`) `archiveOldChats` moves the month the hub says is
  due into one spreadsheet (`chatsCsv`) and only then lets the hub remove
  it, with the count it read. Google trusts One's production deployment
  only, so this works on production only.
- **A receipt on request (D-597, D-606).** Asked for in words (*receipt
  bhejo*, *pdf*), it goes at once: `receiptAsk` in `domain/helper-plan.ts`
  sends the latest day's receipts, at most three, and the last caption says
  how to ask for another in words. A question, or a receipt named by its
  date, month or amount, is Claude's, which names the receipts by number in
  `receipt_pdf`; they are found among the family's own only, never a
  reversed one. 📄 Send receipt under the receipts card, with more than one
  receipt that can be sent, offers them to pick, a button each up to three
  and a list beyond (`receipt_pdf:<key>`, the key 14 letters from the child
  and the number, `receiptKey` in `domain/helper-facts.ts`, never the
  number). The plan carries the receipts and, as its message, the first
  one's words for when it cannot be sent;
  `prepareHelperReceipt` finds each again by the child AND the number,
  renders the school's own PDF (`renderAndStoreReceipt`, shared with the
  receipt notice) onto the private shelf and signs it for an hour, and the
  turn sends them as documents, the first as the reply and the rest after it, made side
  by side. Practice only: a real year makes nothing. The webhook
  has nobody signed in, so the read runs in `withTestRecordRead`
  (`platform/fees-bridge/test-record-read.ts`), which the roster projection
  lets through for one TEST child's table reads only.

## Never

- Put a `situation` branch back into `loadReminderAudience`. It is the shape
  the audience/template split removed, and it is how the two grow back together.
- Import `domain/campaign-bodies` or `domain/campaign-bodies-v3` from `ui/` or from a client file under `src/app`. They hold every template body — per-student, family and receipt — and only the server renders one: the page's preview is a server-rendered prop and the test panel asks `previewNoticeAction`. Every byte of them in the client bundle is unreachable text against a ceiling that only ratchets down. `tests/ui/whatsapp-reminders-screen.test.ts` enforces it.
- Send to a family that has asked not to be called. Respect the no-call flag.
- Let Veer Patta AI answer before the hub hands it the message, or let a
  message from Meta's own webhook start it: the hub's bot would answer too.
- Write the helper's replies to `whatsapp_messages`. `isReplyToOne` would then
  take the parent's next week of messages for replies to One and copy them
  into `whatsapp_inbound`. The helper's own ledger has the reply ids.
- Let Claude, or any model but Anthropic's, write a figure a parent reads, or
  give a free model a child's record.
- Send a receipt that is not one of the asking family's own, or a reversed
  one, whatever Claude names, or open `withTestRecordRead` anywhere but
  `data/helper-receipt.ts`: it is the one read with nobody signed in, and it
  is TEST-only by construction.
- Tell a parent to tap, press or pick something to get what the helper can
  send them itself (D-606).
- Take a number from a link message other than the one WhatsApp says it came
  from, or let a test account link a number that is not on the test list.
- Message a member of staff about a hand-off on a number alone: they must
  have said yes and not stopped it (`reachOf`).
- Rate a hand-off from a tap without matching its key among the tapping
  number's own hand-offs (`readRecentHandoffs`), ask about the office's answer
  to a "no", or tell a parent a "no" was passed on before Messages holds it.
- Change a child's record, the register's notes, an enquiry or anything else
  of the school's on a parent's word: the helper only adds a suggestion, and
  a person applies it (D-598). Keep a parent's words in a suggestion or in
  `parent_absence_notes`, suggest for a child the helper could not name, or
  tell the parent anything has changed. A note never decides attendance:
  the teacher's mark does.
- Put a waiting lesson's question into Claude's prompt, list a question
  `cleanQuestion` refused, or let the form say which list (`practice`) an
  admin's button changes: a practice account must never reach what real
  parents are told.
- Pass a tap on Mark Leave, Mark Absent or Not now to the parent as words,
  or let it decide any note but the one its alert's hand-off came with.
  Buttons go only on the class teacher's alert, while the note waits.
- Take a reply for a staff answer unless it quotes one of the helper's sent
  alerts and comes from the number that alert went to, or tell staff outside
  6 am to 9 pm India time: `nextAlertMoment` is asked again when a step runs,
  whatever time was planned.
- Keep a parent's file, its name, the chat or the parent's words in One's
  database, or put them in a log: the file passes through memory into Drive
  and the hub keeps the link (D-576).
- Tell the hub a month is done before its spreadsheet is in Drive and
  checked, or with a count other than the one read. The hub deletes that
  month for good.
- Insert into `student_collection_flags` without passing `no_call: false` explicitly. Its default is TRUE, so a row written to record a cadence or a language would silently drop the family out of the call queue.

## Layout

`domain/` is pure rules — no Supabase client, no `fetch`. `data/` does the IO.
`ui/` is this module's components and belongs to it alone: another module may
import this one's `domain/` and `data/`, never its `ui/`.
`npm run quality:architecture` holds that, and only lets the count fall.
