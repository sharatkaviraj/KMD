# WhatsApp to staff — templates, consent, switches

Go-live Phase F (plan §8, D-344, D-356). Everything One sends to a member of
staff on WhatsApp goes through one outbox, `vppsone.staff_notices`, and one
dispatcher (`src/modules/staff-notices/data/dispatcher.ts`). Nothing in this
phase sent a message: every new kind is switched off, nobody has consented yet,
and the templates below are for the owner to submit.

## 1. What is sent, to whom

| Kind | To | Template | When | Limits |
|---|---|---|---|---|
| `cover_assigned`, `cover_changed`, `cover_cancelled` (incl. late cover) | The covering teacher | `vppsone_cover_*` | After every cover command | **Cover**: any hour, no daily limit, never folded into a digest |
| `cover_escalation` | Coordinator (`substitutions:manage`) | `vppsone_cover_escalation` | A teacher says they cannot cover | Cover |
| `attendance_reminder` | Class teacher | `vppsone_staff_attendance_reminder` | Job at ~09:30, or "Remind" on Academics | Window, 8/day, digest |
| `marks_reminder` | Subject teacher | `vppsone_marks_reminder` | Sunday job, or "Remind" on Academics | Window, 8/day, digest |
| `weekly_summary` | Admins | `vppsone_weekly_summary` | Coordinator presses Send | Window, 8/day, digest |
| `staff_broadcast` | Staff chosen | `vx_staff_notice` | Messages → New notice (staff), timetable publish "tell teachers" | Window, 8/day, digest |
| `online_review` | `fees:accounts` (accountant, admin) | `vx_staff_online_review_v1` | A Razorpay capture could not be posted (`review_required`) | Window, 8/day, digest |
| `online_payment` | `fees:collect` (accountant, admin, collector) | `vx_staff_online_payment_v1` | Every online receipt, while `online_payment_staff_whatsapp_enabled` is on | Window, 8/day, digest |
| `day_collection` | `fees:accounts` | `vx_staff_day_collection_v1` | Job `fee-day-summary`, 19:00 IST, days with receipts | Window, 8/day, digest |
| `day_not_closed` | `fees:accounts` | `vx_staff_day_not_closed_v1` | Job `fee-day-not-closed`, 20:00 IST, when today has receipts and was not closed | 8/day, digest; may go until 21:00 (D-356) |
| `money_request` | `fees:manage` (admin) | `vx_staff_money_request_v1` | A reversal or write-off is requested (`fee_desk_requests`) | Window, 8/day, digest |
| `money_decision` | Whoever asked | `vx_staff_money_decision_v1` | It is approved or declined by someone else | Window, 8/day, digest |
| `leave_requested` | `substitutions:manage` | `vx_staff_leave_requested_v1` | A teacher asks for leave (`teacher_leave`) | Window, 8/day, digest |
| `leave_decided` | The teacher | `vx_staff_leave_decided_v1` | Someone else approves or declines it | Window, 8/day, digest |
| `ops_alert` | Real admins (`settings:manage`) | `vx_staff_ops_alert_v1` | Job `health` (Phase G) finds something to look at: counts only | Window, 8/day, digest |
| (digest) | — | `vx_staff_digest_v1` | More than 3 of one kind for one person within 30 minutes | — |
| `teacher_task` | Teacher | `vppsone_teacher_task_*_v1` | Its own reviewed delivery (unchanged) | Its own (see §7) |

**Never in a staff message:** a parent's phone number (refused when queued and
again when rendered: `assertNoPhoneNumber`), the reason a colleague is away, a
leave note. **A child's name** only while `runtime_flags.staff_notice_student_names`
is on (off by default): otherwise "a student of 5 A". The name is never
stored: a notice's payload names the student by id and class, and the claim
reads the name at the moment it sends, only while the switch is on
(`20261031111241_staff_whatsapp_review_fixes`). The browser cannot read
`staff_notices.payload` or `staff_notice_attempts.params` at all (column
grants); every read of the outbox is server-side with the service role.

The money and leave notices are queued by triggers on `vppsone.fee_desk_requests`
and `vppsone.teacher_leave` in the same transaction as the request; the claim
drops a request that was decided, or a capture that was resolved, before it
went.

## 2. The gate, in order (`src/modules/staff-notices/domain/gates.ts`)

Read by the claim in the transaction that leases the notice; any fact that
cannot be read holds the notice for five minutes, never sends it.

1. `runtime_flags.staff_notice_dispatch` on (the instant kill switch; nothing is
   claimed while off) and `STAFF_NOTICE_TRANSPORT` not `disabled`.
2. The kind is `true` in `runtime_flags.staff_notice_kinds_enabled`.
3. Consent: `staff_profiles.whatsapp_opt_in_at` set and no later opt-out.
4. The person has not switched the kind off (`staff_notice_prefs`).
5. TEST session, test account, or a confined deployment (anything but Vercel
   production): the number must be in `vppsone.message_test_recipients`. A
   confined deployment (Preview, a local `next dev`) also **claims TEST-session
   notices only** (`claim_staff_notice(…, p_test_only)`): it never leases,
   suppresses or sends a real one, which stays for production's dispatcher.
6. The send window 07:00–20:00 IST — the fee reminders' `DEFAULT_QUIET_HOURS`
   shape and end, opening at 07:00 (critique1 C1). Cover is exempt; outside it
   a notice is held until 07:00.
7. At most 8 a day per person (cover exempt).
8. `runtime_flags.staff_whatsapp_month_cap` (1,000) AiSensy sends a month, all
   kinds together — the teacher-task link's AiSensy sends included. One count,
   `vppsone.staff_whatsapp_month_sent()`, is used by the claim, by the
   teacher-task send's gate and by Messages → Staff.
9. More than 3 of one kind for one person in 30 minutes → one digest. The rest
   of the burst is folded into it only once AiSensy took it (accepted, or
   unknown); a refused or rate-limited digest folds nothing, so each notice is
   still there to retry.

And 1 request a second to AiSensy, across every dispatcher running at once
(`vppsone.reserve_staff_send_slot` hands out the seconds from one row). The log
of everything sent, held or dropped, with the month's count and cost (₹0.88 a
message), is **Messages → Staff**.

## 3. Consent procedure

No consent, no message — whatever is switched on.

1. **At training**, hand each member of staff the paper form (text below), in
   their language. They tick, sign and date it. Keep the forms in the office
   file.
2. An admin opens **Staff → the person → WhatsApp consent** and presses
   *Record consent from the form* (or *Record consent given in person* if they
   said yes face to face). The record keeps when, how and who recorded it.
3. Check the number on their profile (*WhatsApp number*, else *Phone*). No
   usable number: nothing is sent and the log says *No number on file*.
4. Anyone can say yes or stop at any time themselves in **Preferences →
   School messages on WhatsApp**, and switch individual kinds off there. *Stop
   WhatsApp* takes effect on the next send. An admin can record a no in /staff.
5. A test account's consent is recorded the same way; its messages go only to
   numbers on the test list.

Form text (print one per person):

> **WhatsApp से स्कूल की सूचनाएँ / School messages on WhatsApp**
>
> मैं सहमत हूँ कि श्री वीर पत्ता सीनियर सेकेंडरी स्कूल का ऐप मेरे काम से जुड़ी
> सूचनाएँ (व्यवस्था, हाज़िरी, अंक, फ़ीस, छुट्टी) मेरे WhatsApp नंबर पर भेजे —
> सुबह 7 से रात 8 के बीच, दिन में 8 से ज़्यादा नहीं (व्यवस्था की सूचना को
> छोड़कर)। मैं ऐप में Preferences से कभी भी बंद कर सकता/सकती हूँ।
>
> I agree that the Shri Veer Patta Sr. Sec. School app may send messages
> about my work (cover, registers, marks, fees, leave) to my WhatsApp number —
> between 07:00 and 20:00, at most 8 a day (cover excepted). I can stop them
> at any time in the app under Preferences.
>
> नाम / Name: ______________  WhatsApp नंबर / number: ______________
>
> हस्ताक्षर / Signature: ______________  दिनांक / Date: ______________

## 4. Switching on (owner, in this order)

1. The owner submits the templates in §6 to AiSensy (category UTILITY, Hindi
   and English under the same name). Nothing is sent until each is approved
   and has a **Live API campaign of the same name**.
2. Collect consent (§3).
3. Test on the allowlist: add the owner's own numbers to
   `vppsone.message_test_recipients` (SQL, never in a migration), set
   `STAFF_NOTICE_TRANSPORT=aisensy` on a Preview deployment (confined: only
   those numbers can receive, and only TEST-session notices are claimed),
   consent a test account whose WhatsApp number is on the list, and trigger
   each kind against TEST-2026-27. The two fee-day kinds rehearse too: both
   jobs also run a TEST pass (`fee-day-summary` and `fee-day-not-closed` read
   TEST-2026-27's receipts and queue TEST-session notices), so post a TEST
   receipt and run each job by hand (`/api/jobs/fee-day-summary?token=…`,
   or Jobs → Run) — on a Preview that is the only pass that runs.
4. Turn kinds on by name (service role / SQL editor):

   ```sql
   update vppsone.runtime_flags
   set value = value || '{"money_request": true, "money_decision": true}'::jsonb
   where key = 'staff_notice_kinds_enabled';
   ```

   The `online_payment` kind has a second switch in front of it: the
   online-payments screen's **Tell the office on WhatsApp**
   (`online_payment_staff_whatsapp_enabled`, Payments → Online payments →
   Switches, a real admin). Turn the kind on first, then that switch; off, no
   online receipt is turned into a notice at all.
5. **Required:** schedule the timers — `scripts/ops/schedule-staff-notices-cron.sql`
   (§5). Without it the 07:00 hold, the digest hold and every retry wait for
   the next day's 02:00 UTC cron.
6. On production set `STAFF_NOTICE_TRANSPORT=aisensy` (Vercel env, owner).
7. Names of children, if the owner allows it:
   `update vppsone.runtime_flags set enabled = true where key = 'staff_notice_student_names';`
8. The cap: `update vppsone.runtime_flags set value = '1500'::jsonb where key = 'staff_whatsapp_month_cap';`

Kill switches, fastest first: `staff_notice_dispatch` off (instant), a kind
`false` in the map, `STAFF_NOTICE_TRANSPORT=disabled` (a redeploy).

## 5. The five-minute timer (critique1 A10)

Vercel's cron runs `/api/jobs/staff-notices` once a day (02:00 UTC), which is
not enough for the 07:00 hold, the digest or the kill switch to be prompt. The
timers are a committed operator script, **a required cutover step** (C-step in
`docs/PROGRESS.md`, next to the Razorpay reconciler's timer in `RAZORPAY.md` §5):

1. After the lockdown (`vppsone.deployment.environment = 'production'`), store
   three job tokens in Vault, by name — each `jobTokenFor(JOBS_SECRET, job)`,
   the first 32 hex characters of HMAC-SHA256 (`src/modules/jobs/domain/token.ts`):
   `VPPS_STAFF_NOTICES_JOB_TOKEN` (`staff-notices`),
   `VPPS_FEE_DAY_SUMMARY_JOB_TOKEN` (`fee-day-summary`),
   `VPPS_FEE_DAY_NOT_CLOSED_JOB_TOKEN` (`fee-day-not-closed`).
2. Run `scripts/ops/schedule-staff-notices-cron.sql` as postgres in One's SQL
   editor. It reads the deployment marker first and refuses anything but
   production, refuses if a token is missing, and is idempotent (unschedules a
   job of the same name, then schedules it). It schedules:
   - `staff-notices-dispatch`, every five minutes;
   - `staff-fee-day-summary` at 13:30 UTC (19:00 IST) and
     `staff-fee-day-not-closed` at 14:30 UTC (20:00 IST).
3. Check: `select jobname, schedule, active from cron.job where jobname like 'staff-%';`
   — three rows, active.

The two fee-day jobs are also in `vercel.json`. **The Vercel team's plan could
not be read from here** (the team API does not say); on Hobby a Vercel cron
fires anywhere within its hour, so "day not closed" could go at 20:59. The
pg_cron entries fire on the minute whatever the plan, and running both is
harmless: each notice is keyed by session and day, so the second run queues
nothing. On a confined deployment both jobs read TEST sessions only.

Not scheduled in this phase: no token is in Vault and the marker says `dev`
(the script was run on wtgx and refused, as it should).

## 6. Template bodies (for the owner to submit)

Every body is the single source in `src/modules/staff-notices/domain/templates.ts`;
the app fills exactly these and `tests/staff-notice-templates.test.ts` holds
the two, the migration's `message_templates` rows and this list together. The
links are plain text in the body (no URL button) — except the teacher-task
link's six, at the end, which carry one. `vx_staff_notice` is a
free-text body (`{{1}}`) kept from before Phase F; Meta may refuse a body that
is only a variable — if so, submit it with a fixed opening line and a new
name, and change `KINDS.staff_broadcast.template`.

The three that were "send by hand" until now (`vppsone_marks_reminder`,
`vppsone_weekly_summary`, `vx_staff_notice`) keep their existing bodies and
slots. The register reminder's name is settled as
`vppsone_staff_attendance_reminder` (four slots); the older one-slot
`vppsone_attendance_reminder` row is switched off.

### `vppsone_cover_assigned` — Cover assigned

Variables: {{1}} name · {{2}} day · {{3}} period · {{4}} classes · {{5}} subject · {{6}} link

Hindi:

```text
{{1}} जी, {{2}} को {{3}} में {{4}} ({{5}}) की व्यवस्था आपकी है। देखें और पुष्टि करें: {{6}}
```

English:

```text
{{1}}, you are covering {{4}} ({{5}}) in {{3}} on {{2}}. Open and acknowledge: {{6}}
```

### `vppsone_cover_changed` — Cover changed

Variables: {{1}} name · {{2}} day · {{3}} period · {{4}} classes · {{5}} subject · {{6}} link

Hindi:

```text
{{1}} जी, {{2}} {{3}} की आपकी व्यवस्था बदली है: अब {{4}} ({{5}})। नया विवरण: {{6}}
```

English:

```text
{{1}}, your cover in {{3}} on {{2}} has changed: now {{4}} ({{5}}). Current details: {{6}}
```

### `vppsone_cover_cancelled` — Cover cancelled

Variables: {{1}} name · {{2}} day · {{3}} period · {{4}} classes · {{5}} subject · {{6}} link

Hindi:

```text
{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) की व्यवस्था अब आपकी नहीं है। विवरण: {{6}}
```

English:

```text
{{1}}, you no longer need to cover {{4}} ({{5}}) in {{3}} on {{2}}. Details: {{6}}
```

### `vppsone_cover_escalation` — Cover refused

Variables: {{1}} name · {{2}} day · {{3}} period · {{4}} classes · {{5}} subject · {{6}} link

Hindi:

```text
{{1}} जी, {{2}} {{3}} में {{4}} ({{5}}) के लिए कोई नहीं है — किसी अध्यापक ने कहा वे नहीं ले सकते। देखें: {{6}}
```

English:

```text
{{1}}, {{4}} ({{5}}) in {{3}} on {{2}} needs someone — the assigned teacher cannot cover it. Review: {{6}}
```

### `vppsone_staff_attendance_reminder` — Register not saved

Variables: {{1}} name · {{2}} day · {{3}} class · {{4}} link

Hindi:

```text
{{1}} जी, {{2}} की {{3}} की हाज़िरी अभी दर्ज नहीं हुई है। यहाँ लें: {{4}}
```

English:

```text
{{1}}, {{3}}'s register for {{2}} has not been saved yet. Take it here: {{4}}
```

### `vppsone_marks_reminder` — Marks reminder

Variables: {{1}} Teacher name · {{2}} Which papers

Hindi:

```text
नमस्ते {{1}}, इन पेपरों के अंक अभी बाकी हैं: {{2}}
```

English:

```text
Hello {{1}}, these papers still have marks outstanding: {{2}}
```

### `vppsone_weekly_summary` — Weekly academic summary

Variables: {{1}} name · {{2}} summary · {{3}} from

Hindi:

```text
नमस्ते {{1}}, इस सप्ताह का शैक्षणिक सारांश: {{2}} — {{3}}
```

English:

```text
Hello {{1}}, this week's academic summary: {{2}} — {{3}}
```

### `vx_staff_notice` — Staff notice

Variables: {{1}} text

Hindi:

```text
{{1}}
```

English:

```text
{{1}}
```

### `vx_staff_online_review_v1` — Online payment needs review

Variables: {{1}} name · {{2}} amount · {{3}} student or class · {{4}} link

Hindi:

```text
{{1}} जी, {{3}} का {{2}} का ऑनलाइन भुगतान अपने-आप दर्ज नहीं हो सका। जाँच कर दर्ज करें: {{4}}
```

English:

```text
{{1}}, an online payment of {{2}} for {{3}} could not be posted automatically. Review it here: {{4}}
```

### `vx_staff_online_payment_v1` — Online payment received

Variables: {{1}} name · {{2}} amount · {{3}} student or class · {{4}} receipt · {{5}} link

Hindi:

```text
{{1}} जी, {{3}} की फ़ीस {{2}} ऑनलाइन मिली, रसीद {{4}} बन गई है। {{5}}
```

English:

```text
{{1}}, {{2}} was received online for {{3}}; receipt {{4}} has been posted. {{5}}
```

### `vx_staff_day_collection_v1` — Day's collection

Variables: {{1}} name · {{2}} day · {{3}} total · {{4}} receipts · {{5}} by mode · {{6}} link

Hindi:

```text
{{1}} जी, {{2}} का संग्रह: {{3}}, {{4}} रसीदें ({{5}})। {{6}}
```

English:

```text
{{1}}, collection for {{2}}: {{3}} in {{4}} receipts ({{5}}). {{6}}
```

### `vx_staff_day_not_closed_v1` — Day not closed

Variables: {{1}} name · {{2}} day · {{3}} receipts · {{4}} total · {{5}} link

Hindi:

```text
{{1}} जी, {{2}} का दिन अभी बंद नहीं हुआ है ({{3}} रसीदें, {{4}})। नकद गिनकर दिन बंद करें: {{5}}
```

English:

```text
{{1}}, {{2}} has not been closed yet ({{3}} receipts, {{4}}). Count the cash and close the day: {{5}}
```

### `vx_staff_money_request_v1` — Reversal or write-off requested

Variables: {{1}} name · {{2}} what · {{3}} amount · {{4}} student or class · {{5}} asked by · {{6}} link

Hindi:

```text
{{1}} जी, {{5}} ने {{4}} के लिए {{3}} का {{2}} माँगा है। निर्णय करें: {{6}}
```

English:

```text
{{1}}, {{5}} asked for a {{2}} of {{3}} for {{4}}. Decide here: {{6}}
```

### `vx_staff_money_decision_v1` — Reversal or write-off decided

Variables: {{1}} name · {{2}} what · {{3}} decision · {{4}} amount · {{5}} student or class · {{6}} link

Hindi:

```text
{{1}} जी, {{5}} के {{4}} के {{2}} का आपका अनुरोध {{3}} हुआ। {{6}}
```

English:

```text
{{1}}, your {{2}} request of {{4}} for {{5}} was {{3}}. {{6}}
```

### `vx_staff_leave_requested_v1` — Leave requested

Variables: {{1}} name · {{2}} teacher · {{3}} dates · {{4}} link

Hindi:

```text
{{1}} जी, {{2}} ने {{3}} की छुट्टी माँगी है। देखें: {{4}}
```

English:

```text
{{1}}, {{2}} has asked for leave on {{3}}. Review: {{4}}
```

### `vx_staff_leave_decided_v1` — Leave decided

Variables: {{1}} name · {{2}} dates · {{3}} decision · {{4}} link

Hindi:

```text
{{1}} जी, {{2}} की आपकी छुट्टी {{3}} हुई। {{4}}
```

English:

```text
{{1}}, your leave for {{2}} was {{3}}. {{4}}
```

### `vx_staff_ops_alert_v1` — System check

Added in Phase G (`20261031115621_ops_health_and_alerts`): the health job's
alert to every real admin (`settings:manage`). Off until the owner names it
(`docs/cutover/ADMIN-OPS-SHEET.md`).

Variables: {{1}} name · {{2}} day · {{3}} count · {{4}} what · {{5}} link

Hindi:

```text
{{1}} जी, {{2}} की सिस्टम जाँच में {{3}} बातें देखनी हैं: {{4}}। देखें: {{5}}
```

English:

```text
{{1}}, the system check for {{2}} found {{3}} things to look at: {{4}}. Details: {{5}}
```

### The teacher-task link: `vppsone_teacher_task_*_v1` (six templates)

Sent by the task's own reviewed delivery, not the outbox, but staff templates
all the same — submit them with the rest. Each name is ONE language (the
teacher's choice picks `_en`, `_hi` or `_both`), category UTILITY, with a **URL
button**: link `https://one.vpps.co.in/t/tasks/{{1}}`, where the dynamic suffix
`{{1}}` is the task's token (`buttonSuffix` from `claim_teacher_task_delivery`).
Variables in every one: {{1}} teacher · {{2}} task · {{3}} due. When
`AISENSY_CAMPAIGN_PREFIX` is set, it replaces the leading `vppsone` of the
campaign name. Bodies (`TEACHER_TASK_TEMPLATES` in `templates.ts`, rows from
migration `20261016090000_teacher_task_delivery`):

#### `vppsone_teacher_task_en_v1` — Teacher task · English

```text
{{1}}, task: {{2}}. Due: {{3}}. Use the button to open your work.
```

#### `vppsone_teacher_task_hi_v1` — Teacher task · Hindi

```text
{{1}}, कार्य: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।
```

#### `vppsone_teacher_task_both_v1` — Teacher task · Both

```text
{{1}}, कार्य / Task: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.
```

#### `vppsone_teacher_task_reminder_en_v1` — Task reminder · English

```text
{{1}}, work is still pending: {{2}}. Due: {{3}}. Use the button to open your work.
```

#### `vppsone_teacher_task_reminder_hi_v1` — Task reminder · Hindi

```text
{{1}}, कार्य अभी बाकी है: {{2}}। अंतिम तिथि: {{3}}। काम खोलने के लिए बटन दबाएँ।
```

#### `vppsone_teacher_task_reminder_both_v1` — Task reminder · Both

```text
{{1}}, कार्य अभी बाकी है / Work is still pending: {{2}}। अंतिम तिथि / Due: {{3}}। काम खोलने के लिए बटन दबाएँ / Use the button to open your work.
```

### `vx_staff_digest_v1` — Several messages at once

Variables: {{1}} name · {{2}} count · {{3}} what · {{4}} link

Hindi:

```text
{{1}} जी, आपके लिए {{2}} नए संदेश: {{3}}। सब यहाँ देखें: {{4}}
```

English:

```text
{{1}}, you have {{2}} new messages: {{3}}. See them all here: {{4}}
```

## 7. What else changed

- **Send by hand → outbox (critique1 B13).** Marks reminders (the Sunday job
  and the Academics button), the weekly summary, staff notices from Messages
  and the timetable's "tell teachers" no longer write `message_sends` rows for
  somebody to send from their own WhatsApp; they queue staff notices. Undo /
  Stop still takes back what has not gone. `AISENSY_CAMPAIGN_PREFIX` applies
  only to the teacher-task link, as before.
- **Teacher tasks** keep their own reviewed delivery
  (`prepare/queue/claim_teacher_task_delivery`); their kind is in the switch
  map and in /preferences, and is not folded into this outbox.
- **The fees app's staff payment alerts (plan §8.4).** `staff-alerts.ts` drains
  `staff_payment_alerts`: the WhatsApp half becomes `online_payment` staff
  notices (consent and limits apply; the typed number list
  `online_payment_staff_whatsapp_numbers` is not used), the push half is closed
  as `no_devices` — One has no push sign-up screen and its service worker has
  no `push` handler, so `platform/push/web-push.ts` and the push and
  typed-number actions are not ported. The WhatsApp switch
  (`online_payment_staff_whatsapp_enabled`) is offered with the other online
  switches. The same drain queues `online_review` for captures needing a
  person. A confined deployment claims no alert row and queues review notices
  for TEST captures only.
- **The failure desk's Fix tab** (fees 3cc2de4b + 2c0ada0a) is ported to
  `/fees/reminders/fix`, with One's fences on every action and One's cutover
  line (a reminder the fees app sent before cutover is never re-sent from One).
