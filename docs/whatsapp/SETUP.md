# The school's own WhatsApp in One — setup

Since 9 November 2026 (D-562, D-566) One sends WhatsApp from the school's own
number, **+91 83022 07823 ("Veer Patta School")**, through the school's own
**WhatsApp hub**, and no longer uses AiSensy at all. The School Fees app is
unchanged: it keeps its own AiSensy setup and its own number,
+91 80 4713 6289, which One refuses as a sender and as a recipient.

The hub is a Cloudflare worker, `https://vpps-whatsapp-hub.raj-39e.workers.dev`
(repo `veerpatta/vpps-whatsapp-hub`). It owns the school's number on Meta's
Cloud API and gives each app its own key: One's is the `one:` value in the
owner's private secrets note on the office PC. That key is never printed, put
in git or put in a browser.

Everything leaves through one service, `src/platform/whatsapp/`:

| | |
|---|---|
| `sendTemplate(phone, templateName, language, variables, options)` | an approved template message |
| `sendText(phone, text, options)` | a typed reply, only inside the 24 hours after the person last wrote |
| `getStatus(messageId, { refresh })` | the last status recorded (sent, delivered, read, failed + Meta's code); with `refresh`, asks the hub first |

The message body is **Meta's WhatsApp Cloud API format** (`payload.ts`), which
the hub passes through unchanged.

## Safety, as it is now

Nothing reaches a real parent until Janmejay says so in writing. In One's
database (`vppsone.runtime_flags`), today:

| Switch | Value | Changed from |
|---|---|---|
| `whatsapp_real_recipients` | **off** — only the owner's test number can receive anything | the database only; no screen can turn it on |
| `whatsapp_owner_test_number` | set (masked on screen) | the database only |
| `whatsapp_dry_run` (practice mode) | **on** — every message is logged, none is sent | Settings → WhatsApp |
| `whatsapp_features` | every feature **off** | Settings → WhatsApp, one switch per feature |
| `whatsapp_daily_limit` | 250 a day, every feature together | the database |

The hub has its own switch on top: it starts in **test mode**, where only the
owner's number receives anything and every other recipient gets
`403 test_mode`, until the owner switches the hub to live.

A message also needs a template whose registry row
(`vppsone.whatsapp_templates`) reads **approved**, with the same number of
blanks, the same PDF header, the same button and, for the `_v8` set, the same
wording. **Only the hub's template list makes a row approved**; nobody marks
one by hand. Every row starts `not_submitted`: approvals on the Fees app's
AiSensy account do not carry over.

## Environment variables (Vercel, Production)

Names only; values come from the owner. Unset, nothing is sent and
Settings → WhatsApp says what is missing.

| Name | What |
|---|---|
| `WHATSAPP_HUB_KEY` | **required** — One's own key on the hub (`one:` in the owner's secrets note). Sent as `Authorization: Bearer …`, and the key the hub signs its webhook with. Server-only, Sensitive. |
| `WHATSAPP_HUB_URL` | optional — defaults to `https://vpps-whatsapp-hub.raj-39e.workers.dev` (`DEFAULT_HUB_URL` in `config.ts`). Set it if the hub moves to its own domain. `https://` only. |
| `WHATSAPP_SENDER_NUMBER` | optional for the hub (it sends from the school's number only); if set, it must be `+918302207823`. Required for Meta direct. The Fees number refuses every send. |
| `WHATSAPP_PROVIDER` | optional — `hub` or `meta_cloud`. Unset: the hub if `WHATSAPP_HUB_KEY` or `WHATSAPP_HUB_URL` is set, else Meta if `WHATSAPP_PHONE_NUMBER_ID` is set. `mock` is refused on a live deployment. |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta direct only — the number's ID from WhatsApp Manager (digits), not the phone number |
| `WHATSAPP_ACCESS_TOKEN` | Meta direct only — a system-user token with `whatsapp_business_messaging` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta direct only — lets "Check templates" read approvals from Meta |
| `WHATSAPP_GRAPH_VERSION` | Meta direct only — default `v21.0` |
| `WHATSAPP_APP_SECRET` | Meta direct only — verifies Meta's own webhook |
| `WHATSAPP_VERIFY_TOKEN` | Meta direct only — any long random string, typed into Meta's webhook setup |
| `MESSAGE_PROVIDER` | leave unset (the school's WhatsApp). `mock` for local work only. |
| `STAFF_NOTICE_TRANSPORT` | `whatsapp` when staff WhatsApp starts; unset on live = off |

`AISENSY_*`, `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` and `WHATSAPP_WEBHOOK_SECRET`
are no longer read by One. Do not set them on the One project.

## What the hub answers

| One calls | The hub answers |
|---|---|
| `POST /v1/messages` (Meta JSON) | Meta's answer, `{ "messages": [{ "id": "wamid…" }] }` |
| `GET /v1/templates` | every template on the hub's account: name, language, category, status, components, rejected_reason, quality |
| `POST /v1/templates` | `{ ok, id, status, category }` for a template sent to Meta for review |
| `GET /v1/status/{wamid}` | `{ wamid, status, error_code, error_title, status_at }`, Meta's own status and code |

A refusal is `{ "error": { "message", "type": "VppsHubError", "code", "hub_code" } }`
with HTTP 400, 403, 409 or 502. One files it under the hub's own reason first,
then Meta's number, and shows it in plain words, Hindi and English
(`errors.ts`), and on the failure desk (`failure-cause.ts`):

| `hub_code` / Meta code | Means | Sent again by itself? |
|---|---|---|
| `sending_off` (403) | the hub's sending switch is off | no |
| `test_mode` (403) | the hub is in test mode and this is not the owner's number | no |
| `window_closed` (409), 131047 | a typed message outside the 24-hour window | no |
| `opted_out` (409), 131050 | the parent replied STOP to marketing | no |
| `not_approved`, 132000, 132001 | the template is not approved, or its blanks do not match | no |
| `bad_number`, 131026 | not a WhatsApp number | no |
| 131049 | Meta's marketing limit for this person | no |
| 131042 | a payment problem on the WhatsApp account | no |
| `bad_api_key` (401) | the hub refused One's key | no |
| 130429, 131000, 131016, 131057 | busy | yes, through the queue |

A 502 carrying Meta's code is Meta's definite no. Any other 5xx, a timeout or
an answer without a message id is "unknown": it may have gone, so it is never
sent again by itself.

## The webhook

**`https://one.vpps.co.in/api/webhooks/whatsapp-hub`** — on the hub's
`APP_WEBHOOKS` as `one:https://one.vpps.co.in/api/webhooks/whatsapp-hub`
(Janmejay set it on 9 Nov).

- The body is Meta's webhook JSON, unchanged: statuses, parents' replies, and
  template events (`message_template_status_update`, `template_category_update`).
- It checks `X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the raw body
  keyed with `WHATSAPP_HUB_KEY`, compared timing-safe, and answers 401
  otherwise. It answers 404 until `WHATSAPP_HUB_KEY` is set.
- Statuses land in `vppsone.whatsapp_messages` and on the fee reminder or
  school notice row that asked for the message, one row per message id and
  never backwards, so a repeat or a late event changes nothing. Replies land in
  `vppsone.whatsapp_inbound`, once per message id.
- A template rejected, paused or disabled is written at once. An approval is
  never taken from the event alone: One reads the hub's list and checks the
  button, the blanks and the wording first.

`/api/webhooks/whatsapp` stays for Meta direct (`WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`); it answers 404 while neither is set.

## The queue, and asking the hub

`pg_cron` calls `POST /api/jobs/whatsapp-queue` every five minutes, only when
something is due, with a Bearer secret kept in Vault
(`whatsapp_queue_secret_matches`); `CRON_SECRET` also opens it. Each run:

1. sends what is due: `queued` messages and busy-server failures
   (`retry_wait`) whose wait is over, each checked against today's switches
   again;
2. asks the hub (`GET /v1/status/{wamid}`) about messages it has not heard
   back on, because the hub's webhook is best-effort. Each message is asked at
   most four times — ten minutes, an hour, four hours and sixteen hours after
   it went — and never after two days (`whatsapp_take_pollable`, migration
   `20261109082705`).

A message whose fate is unknown is **never** sent again by itself: one parent
missed beats one parent messaged twice. Settings → WhatsApp offers "Send again"
for those, after a warning.

## Pay now and "Paid"

Fee reminders keep the Razorpay Pay now button (`https://one.vpps.co.in/pay/{{1}}`,
the send's own pay code as a separate button component). When Razorpay's
webhook confirms the payment and One posts it, the message that carried that
pay code is marked **Paid** in the WhatsApp log.

## The `_v8` templates

The fee reminders with Pay now (`_v7`) were approved on AiSensy's account for
the Fees number, which One never uses. The hub's account needs its own copy, so
the same 22 templates (11 situations × Hindi and English) go to the hub under
`_v8` names, **byte for byte the `_v7` wording**: category UTILITY, five
blanks with the same samples, no footer, buttons Pay now
(`https://one.vpps.co.in/pay/{{1}}`) then Call office. The set is built from
the same descriptors (`modules/whatsapp/domain/hub-templates.ts`), so the two
cannot drift.

1. Settings → WhatsApp → **Fee reminders with Pay now** → **Send for
   approval**. Only rows that are `not_submitted` or `rejected` are sent; they
   then read "Waiting for Meta". Nothing goes to any parent. Three go at a
   time (about half a minute for 22); each row is taken before it is sent,
   so a second press never sends one twice, and a refusal puts the row back
   with the hub's own words. **Done 9 Nov 08:56 UTC by Janmejay: all 22 are
   with Meta.**
2. Meta decides, usually within hours. The webhook writes a rejection at once;
   an approval makes One read the hub's list. **Check with WhatsApp** reads it
   by hand.
3. A row reads approved only when the hub says APPROVED and the button host,
   the blanks and the wording all match what One sends.
4. The fee reminder screens switch a situation to its `_v8` name only once
   `APPROVED_HUB` (`modules/whatsapp/domain/campaign-generation.ts`) lists it.
   It starts empty and is filled only from APPROVED statuses on the hub's list,
   in a reviewed change.

## Settings → WhatsApp

`/settings/whatsapp` (admins, `settings:manage`): the connection and a "Check
connection" button, the safety switches, practice mode, one switch per
feature with its approved-template count, the `_v8` set with Send for
approval, every template and its approval (read from the hub), messages that
did not arrive in plain words with "Send again", the recent log and parents'
replies. A test account may look and check the connection, but not change
anything.

## What is left to fill in

1. ~~`WHATSAPP_HUB_KEY` in Vercel (Production, Sensitive)~~ — Janmejay added
   it on 9 Nov; it takes effect with the next deployment.
2. ~~One's webhook on the hub's `APP_WEBHOOKS`~~ — done by Janmejay on 9 Nov.
3. ~~Send the `_v8` set for approval~~ — Janmejay, 9 Nov; Meta's answers
   are coming in through the webhook.
4. ~~Fill `APPROVED_HUB`~~ — 20 of 22 on 9 Nov (09:16 UTC); the last two,
   `vpps_app_upcoming_hi_v8` and `vpps_app_promise_lapsed_hi_v8`, read
   approved at 08:05 UTC on 10 Nov and were added on 11 Nov. All 22 are in.
5. **Going live** needs Janmejay's written go-ahead, then: practice mode off,
   one feature switched on, a test to his own number, the hub switched to
   live, and only then `whatsapp_real_recipients` on, in the database.
