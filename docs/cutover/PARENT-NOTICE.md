# Parent notice — Pay now comes from a new address

Go-live Phase G (plan §6.2, §11 "Training"; critique1 B10, B20). From T0 the
Pay now button in the school's WhatsApp messages opens
**`https://one.vpps.co.in/pay/…`** instead of the fees app's address. A parent
who has learnt to trust one link should hear from the school, before the first
`_v7` message, that the new one is genuine — otherwise the safest parents are
the ones who will not pay.

**When:** at least 3 days before the first `_v7` send (the first manual
reminder run is T+3, so by T-1 at the latest). **Who:** the owner. **To:**
every family on roll, one message per family (the same family rule as
reminders).

## The text

Hindi:

> **श्री वीर पत्ता सीनियर सेकेंडरी स्कूल — फ़ीस भुगतान की नई कड़ी**
>
> प्रिय अभिभावक, {{1}} से स्कूल के WhatsApp संदेशों में "Pay now" बटन
> **one.vpps.co.in** पर खुलेगा। यह स्कूल का अपना नया पता है। भुगतान पहले की
> तरह Razorpay से होगा और रसीद WhatsApp पर आएगी।
>
> स्कूल कभी OTP, PIN या पासवर्ड नहीं माँगता। किसी और पते का लिंक आए तो भुगतान न
> करें और स्कूल कार्यालय से पूछें: {{2}}।

English:

> **Shri Veer Patta Sr. Sec. School — the new fee payment link**
>
> Dear parent, from {{1}} the "Pay now" button in the school's WhatsApp
> messages opens **one.vpps.co.in**. This is the school's own new address.
> Payment is through Razorpay as before, and the receipt comes on WhatsApp.
>
> The school never asks for an OTP, PIN or password. If a link from any other
> address reaches you, do not pay — ask the school office: {{2}}.

Variables: {{1}} the date (T0, e.g. "14 December"), {{2}} the office phone
(`NEXT_PUBLIC_SCHOOL_PHONE`; not written in this repo).

## How to send it — the owner chooses one

None of the four approved school-notice templates (`absent_today`,
`exam_schedule`, `ptm`, `school_closed`) fits, so this needs one of:

1. **A new UTILITY template** submitted by the owner in AiSensy as
   `vpps_school_pay_address_hi_v1` / `_en_v1` with the bodies above, then a
   Live API campaign of the same name, then a new `notice_kind` in One's
   school notices (`src/modules/whatsapp/domain/school-notices.ts`) — an
   engineering change not made in this phase (the database's
   `school_notice_sends.notice_kind` check would need the new kind too, a
   fee-schema change through `supabase/fee-migrations/`).
2. **The AiSensy dashboard's own broadcast**, by the owner, to the parent
   list exported from One (the owner's `vpps-fee-list` workflow) — no code
   change; it is outside One's send gate, so the owner checks the list
   (one number per family) before pressing send.
3. **The class teachers' groups and a printed slip** in the school diary —
   no WhatsApp template at all.

Option 2 or 3 is enough for the go-live; option 1 is only worth it if the
school will send notices like this again.

## Also

- Keep the school's support phone in the Razorpay account (Razorpay
  dashboard → Account → Support details) so the payment page shows it
  (critique1 B20).
- Razorpay must list `one.vpps.co.in` as an approved website for checkout
  before `online_payment_checkout_modal_enabled` is turned on
  (`RAZORPAY.md` §5); until then One uses UPI Payment Links, which need no
  approval.
- Old fees Pay now links keep working until they expire, showing the static
  UPI QR once the fees app's *New payment links* is off (`OLD-PAY-NOW.md`).
  The notice does not need to mention them.
