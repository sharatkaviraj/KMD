# The school's own WhatsApp in One — setup

Since 9 November 2026 (D-562) One sends WhatsApp from the school's own number,
**+91 83022 07823 ("Veer Patta School")**, and no longer uses AiSensy at all.
The School Fees app is unchanged: it keeps its own AiSensy setup and its own
number, +91 80 4713 6289, which One refuses as a sender and as a recipient.

Everything leaves through one service, `src/platform/whatsapp/`:

| | |
|---|---|
| `sendTemplate(phone, templateName, language, variables, options)` | an approved template message |
| `sendText(phone, text, options)` | a typed reply, only inside the 24 hours after the person last wrote |
| `getStatus(messageId)` | the last status the webhook recorded (sent, delivered, read, failed + Meta's code) |

The message body is **Meta's WhatsApp Cloud API format** in both cases
(`payload.ts`). The service talks either to the school's WhatsApp server or to
Meta directly; which one is decided by the environment alone.

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

A message also needs a template whose registry row
(`vppsone.whatsapp_templates`) reads **approved**, with the same number of
blanks, the same PDF header and the same button. Every row starts
`not_submitted`: approvals on the Fees app's AiSensy account do not carry over.

## Environment variables (Vercel, Production)

Names only; values come from the owner. Unset, nothing is sent and
Settings → WhatsApp says what is missing.

| Name | What |
|---|---|
| `WHATSAPP_SENDER_NUMBER` | **required** — `+918302207823`. Anything else refuses every send; the Fees number above all. |
| `WHATSAPP_PROVIDER` | optional — `school_server` or `meta_cloud`. Unset: the school server if `WHATSAPP_API_URL` is set, else Meta if `WHATSAPP_PHONE_NUMBER_ID` is set. `mock` is refused on a live deployment. |
| `WHATSAPP_API_URL` | the school's WhatsApp server's base URL, `https://` only |
| `WHATSAPP_API_KEY` | the school server's key, sent as `Authorization: Bearer …` |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta only — the number's ID from WhatsApp Manager (digits), not the phone number |
| `WHATSAPP_ACCESS_TOKEN` | Meta only — a system-user token with `whatsapp_business_messaging` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | optional — lets "Check templates" read approvals from Meta |
| `WHATSAPP_GRAPH_VERSION` | optional — default `v21.0` |
| `WHATSAPP_APP_SECRET` | Meta's app secret: verifies Meta's webhook |
| `WHATSAPP_WEBHOOK_SECRET` | the school server's own webhook secret (same signature scheme) |
| `WHATSAPP_VERIFY_TOKEN` | any long random string; typed into Meta's webhook setup |
| `MESSAGE_PROVIDER` | leave unset (the school's WhatsApp). `mock` for local work only. |
| `STAFF_NOTICE_TRANSPORT` | `whatsapp` when staff WhatsApp starts; unset on live = off |

`AISENSY_*` are no longer read by One. Do not set them on the One project.

## The webhook

`https://one.vpps.co.in/api/webhooks/whatsapp`

- `GET` answers Meta's `hub.verify_token` handshake with `WHATSAPP_VERIFY_TOKEN`.
- `POST` takes status updates (sent, delivered, read, failed with Meta's error
  code) and parents' replies. It checks `X-Hub-Signature-256: sha256=<hex>`,
  an HMAC-SHA256 of the raw body under `WHATSAPP_APP_SECRET` or
  `WHATSAPP_WEBHOOK_SECRET`, and answers 401 otherwise. With neither secret set
  it answers 404. Changes for any number but the school's are ignored.
- Each status lands in `vppsone.whatsapp_messages` and, where the message came
  from a fee reminder or a school notice, on that row too, never backwards.
  Replies land in `vppsone.whatsapp_inbound`.

## The queue

A message that met a busy server (Meta's 130429, 131000, 131016, 131057) and
was sent with retries waits in `vppsone.whatsapp_messages` as `retry_wait`.
`pg_cron` calls `POST /api/jobs/whatsapp-queue` every five minutes with a
Bearer secret kept in Vault (`whatsapp_queue_secret_matches`); `CRON_SECRET`
also opens it. A message whose fate is unknown is **never** sent again by
itself: one parent missed beats one parent messaged twice. Settings → WhatsApp
offers "Send again" for those, after a warning.

## Pay now and "Paid"

Fee reminders keep the Razorpay Pay now button (`https://one.vpps.co.in/pay/{{1}}`,
the send's own pay code as a separate button component). When Razorpay's
webhook confirms the payment and One posts it, the message that carried that
pay code is marked **Paid** in the WhatsApp log.

## Settings → WhatsApp

`/settings/whatsapp` (admins, `settings:manage`): the connection and a "Check
connection" button, the safety switches, practice mode, one switch per
feature with its approved-template count, the templates and their approval
(read from the server or marked by an admin), messages that did not arrive in
plain words with "Send again", the recent log and parents' replies. A test
account may look and check the connection, but not change anything.

## What still needs the server's details

The school's server is being built, so One uses a Meta-compatible default for
it (Janmejay, 9 Nov). To confirm or fill in once the server's API is ready:

1. **Base URL** of the server → `WHATSAPP_API_URL`.
2. **API key** and how it is sent → `WHATSAPP_API_KEY`. One sends `Authorization: Bearer <key>`.
3. **Send endpoint**: One posts Meta's message JSON to `{WHATSAPP_API_URL}/messages`
   and expects Meta's answer, `{ "messages": [{ "id": "wamid…" }] }`, or
   Meta's error envelope `{ "error": { "code", "message", "error_data": { "details" } } }`.
   A 5xx or an answer without an id is treated as "unknown".
4. **Templates endpoint**: `GET {WHATSAPP_API_URL}/templates`, answering like
   Meta's `message_templates` list: `{ "data": [{ name, language, status,
   category, components, rejected_reason }], "paging": { "next" } }`.
5. **Health endpoint**: `GET {WHATSAPP_API_URL}/health`, answering at least
   `{ "display_phone_number": "918302207823" }` (optionally `verified_name`,
   `quality_rating`, `messaging_limit_tier`). Any other number fails the check.
6. **Webhook**: the server posts Meta's `whatsapp_business_account` payload to
   `/api/webhooks/whatsapp`, signed with `X-Hub-Signature-256` under
   `WHATSAPP_WEBHOOK_SECRET`.
7. **Meta details** if One should go to Meta directly instead: the number's
   **phone number ID**, a **system-user access token**, the **WhatsApp Business
   Account ID** and the **app secret**.
8. **Template approval**: submit One's templates on the school's account under
   the names in the registry (Settings → WhatsApp → templates). The catalogue
   with each template's blanks is printed by
   `node --conditions=react-server --import ./scripts/alias-hook.mjs scripts/whatsapp-template-catalog.mjs`.
9. **Going live** needs Janmejay's written go-ahead, then: practice mode off,
   one feature switched on, a test to his own number, and only then
   `whatsapp_real_recipients` on, in the database.
