# AiSensy templates VPPS One needs: the `_v7` set

For the owner to submit in the AiSensy dashboard (go-live Phase D; plan §6.2,
critique0 #31). Nothing in this file has been submitted; nothing here sends.

## Why a new set

Meta fixes a URL button's host when it approves the template. Every `_v6` Pay
now button opens the fees app's `/pay/` page, so a `_v6` message sent by
VPPS One would take a parent to the old app. **VPPS One never sends `_v6`**:
the parent-send gate refuses any `_v6` name (`src/platform/messaging/parent-send-gate.ts`),
and `approvedV6Campaign()` only ever hands out `_v7`.

`_v7` is the **same eleven notices** that carry Pay now, in Hindi and English —
**22 templates** — with:

- **the body word for word** as `_v6` (generated from
  `src/modules/whatsapp/domain/campaign-bodies-v6.ts`, the same source; copied
  below from it, not retyped);
- **the same slot layout**: five body variables `{{1}}`–`{{5}}`, then the Pay
  now URL suffix. AiSensy numbers that suffix `{{6}}` and VPPS One sends it as
  the **sixth `templateParams` entry** with no `buttons` key — exactly as `_v6`.
  `tests/fees/unit/whatsapp-campaigns-v7.test.ts` pins six params per notice;
  a template submitted with any other count is answered 400 by AiSensy;
- **only the button host changed**: `https://one.vpps.co.in/pay/{{1}}`
  (in Meta's own URL-button editor the variable is `{{1}}`);
- the same **Call office** phone button and the same samples.

`late_fee_applied` has no Pay now button and so no `_v7`: VPPS One sends it
under the earlier text-only template (`vpps_app_late_fee_applied_*_v3`).

## How to submit, and how One switches over

1. In AiSensy → Manage → Template messages, create each template below:
   category **UTILITY**, the language shown, the body exactly as in the code
   block (bold title, blank lines and all), the two buttons, and the samples.
2. When Meta approves a template, create an **API campaign** with the **same
   name** and set it Live.
3. Tell the engineer which names are both approved **and** Live. They are
   added to `APPROVED_V7` in `src/modules/whatsapp/domain/campaign-generation.ts`
   and deployed — nothing on a screen can switch a notice onto an unapproved
   template.
4. Until a notice is listed there, One sends that notice under the earlier
   text-only generation (`_v2`–`_v4`): the same message without a Pay now
   button.
5. Before the first `_v7` send, families are told that Pay now now comes from a
   new address (plan §6.2).

Sending is still behind the parent-send gate: VPPSONE_ENV=live,
`runtime_flags.parent_dispatch` on, and `fee_reminder` listed in
`runtime_flags.parent_dispatch_categories`.

### Test-only sending (owner, 31 Oct)

To verify AiSensy on the owner's approved numbers while parent sending stays
closed, there is a second switch, `runtime_flags.parent_dispatch_test_only`
(migration `20261031084012`, seeded **off**):

| `parent_dispatch` | `parent_dispatch_test_only` | What the gate lets through |
|---|---|---|
| off | off | nothing (the state on 31 Oct) |
| off | **on** | only a number in `vppsone.message_test_recipients` — whatever the session, the sender or the category; `_v6` is still refused, and `VPPSONE_ENV` must still be `live` |
| on | either | the full gate above; the test-only switch is not read |

Every read fails closed: a switch or the list that cannot be read refuses.
The allowlist holds 3 numbers the owner approved (31 Oct); they are never
printed, committed or seeded by a migration.

Test-only mode covers every send that goes through the gate: the fee
reminder screens, their test sends, receipts, reversals, statements, school
notices — and, since the Phase I review, One's own parent queue
(`/collection`, `vppsone.message_sends`): its dispatcher counts test-only
mode as its switch (`parentDispatchMode`), still needs the category's named
automatic exception and nothing stale, and then the gate holds the send to
the allowlist (`tests/collection-test-only-dispatch.test.ts`). Test-only mode
never sends through the mock provider. Screens that show the school's switch
still show it off.

**Switch it on** (the owner or the operator, as postgres in the Supabase SQL
editor for `wtgxcptmucjerhufzjcf`; no screen writes it):

```sql
-- check first: dispatch is off and the allowlist is what you expect (count only)
select key, enabled from vppsone.runtime_flags where key in ('parent_dispatch', 'parent_dispatch_test_only');
select count(*) from vppsone.message_test_recipients;

update vppsone.runtime_flags set enabled = true where key = 'parent_dispatch_test_only';
```

**Switch it off** when the test is done:

```sql
update vppsone.runtime_flags set enabled = false where key = 'parent_dispatch_test_only';
```

Add or remove an approved number the same way (`insert into
vppsone.message_test_recipients (phone_e164, label) values ('+91…', 'owner test 1')`
/ `delete … where phone_e164 = '+91…'`), never in a migration (rule 6).
The switch takes effect on the very next send; nothing is cached.
Nothing in this repo switches it on.

## The 22 templates

| Notice | Hindi | English |
|---|---|---|
| upcoming | `vpps_app_upcoming_hi_v7` | `vpps_app_upcoming_en_v7` |
| upcoming_final | `vpps_app_upcoming_final_hi_v7` | `vpps_app_upcoming_final_en_v7` |
| fee_due | `vpps_app_fee_due_hi_v7` | `vpps_app_fee_due_en_v7` |
| balance | `vpps_app_balance_hi_v7` | `vpps_app_balance_en_v7` |
| overdue_final | `vpps_app_overdue_final_hi_v7` | `vpps_app_overdue_final_en_v7` |
| late_fee_waiver | `vpps_app_late_fee_waiver_hi_v7` | `vpps_app_late_fee_waiver_en_v7` |
| waiver_last_call | `vpps_app_waiver_last_call_hi_v7` | `vpps_app_waiver_last_call_en_v7` |
| promise_due | `vpps_app_promise_due_hi_v7` | `vpps_app_promise_due_en_v7` |
| promise_lapsed | `vpps_app_promise_lapsed_hi_v7` | `vpps_app_promise_lapsed_en_v7` |
| exam_clearance | `vpps_app_exam_clearance_hi_v7` | `vpps_app_exam_clearance_en_v7` |
| prevyear | `vpps_app_prevyear_hi_v7` | `vpps_app_prevyear_en_v7` |

The five-slot contract per notice is the `_v6` one, documented in
`docs/fees/whatsapp-campaign-registry.md` ("The five-slot contracts").

## Bodies, samples and buttons

#### `vpps_app_upcoming_hi_v7`

Category **UTILITY** · language **Hindi** · notice `upcoming` · replaces `vpps_app_upcoming_hi_v6`

```
*फीस स्मरण: रु. {{1}} जल्द देय*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
अंतिम तिथि: {{4}}
अंतिम तिथि के बाद विलंब शुल्क: {{5}}

उपरोक्त किश्त जल्द देय है। अंतिम तिथि से पहले UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या स्कूल फीस काउंटर पर जमा करें।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 4` · `20-01-2027` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_upcoming_en_v7`

Category **UTILITY** · language **English** · notice `upcoming` · replaces `vpps_app_upcoming_en_v6`

```
*Fee reminder: Rs. {{1}} due soon*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Last date: {{4}}
Late fee after the last date: {{5}}

The installment above falls due shortly. Tap Pay now to pay by UPI before the last date, or pay at the school fee counter.

If you have already paid, kindly ignore this message.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 4` · `20-01-2027` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_upcoming_final_hi_v7`

Category **UTILITY** · language **Hindi** · notice `upcoming_final` · replaces `vpps_app_upcoming_final_hi_v6`

```
*कुछ ही दिन शेष: रु. {{1}} देय*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
अंतिम तिथि: {{4}}
अगले दिन से विलंब शुल्क: {{5}}

अब कुछ ही दिन शेष हैं। अंतिम तिथि के अगले दिन से इस खाते में विलंब शुल्क जुड़ जाएगा। UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 4` · `20-01-2027` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_upcoming_final_en_v7`

Category **UTILITY** · language **English** · notice `upcoming_final` · replaces `vpps_app_upcoming_final_en_v6`

```
*Last few days: Rs. {{1}} payable*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Last date: {{4}}
Late fee from the day after: {{5}}

Only a few days remain. From the day after the last date, the late fee is added to this account. Tap Pay now to settle by UPI, or visit the fee counter.

Ignore this message if the amount has already been paid.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 4` · `20-01-2027` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_fee_due_hi_v7`

Category **UTILITY** · language **Hindi** · notice `fee_due` · replaces `vpps_app_fee_due_hi_v6`

```
*फीस देय: रु. {{1}}*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
अंतिम तिथि: {{4}}
अंतिम तिथि के बाद विलंब शुल्क: {{5}}

अंतिम तिथि तक भुगतान करने पर विलंब शुल्क नहीं लगेगा। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या स्कूल फीस काउंटर पर जमा कर रसीद लें।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 3` · `20-10-2026` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_fee_due_en_v7`

Category **UTILITY** · language **English** · notice `fee_due` · replaces `vpps_app_fee_due_en_v6`

```
*Fee due: Rs. {{1}}*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Last date: {{4}}
Late fee after the last date: {{5}}

Paying on or before the last date avoids the late fee. Tap Pay now to pay by UPI, or pay at the school fee counter and collect a receipt.

If you have already paid, kindly ignore this message.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 3` · `20-10-2026` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_balance_hi_v7`

Category **UTILITY** · language **Hindi** · notice `balance` · replaces `vpps_app_balance_hi_v6`

```
*शेष फीस: रु. {{1}}*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
अब तक प्राप्त: रु. {{3}}
अगली तिथि: {{4}}
अगली तिथि के बाद विलंब शुल्क: {{5}}

प्राप्त भुगतान के लिए धन्यवाद। अगली तिथि तक शेष राशि जमा करने पर विलंब शुल्क नहीं लगेगा। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

यदि यह आपके रिकॉर्ड से अलग है तो "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `11,750` · `Aaradhya Gurjar · Class 2` · `6,500` · `20-10-2026` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_balance_en_v7`

Category **UTILITY** · language **English** · notice `balance` · replaces `vpps_app_balance_en_v6`

```
*Fee balance: Rs. {{1}}*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Received so far: Rs. {{3}}
Next date: {{4}}
Late fee after the next date: {{5}}

Thank you for the payment received. Clearing the balance by the next date avoids the late fee. Tap Pay now to pay the balance by UPI, or visit the fee counter.

If this differs from your own record, tap Call office.
```

Samples: `11,750` · `Aaradhya Gurjar · Class 2` · `6,500` · `20-10-2026` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_overdue_final_hi_v7`

Category **UTILITY** · language **Hindi** · notice `overdue_final` · replaces `vpps_app_overdue_final_hi_v6`

```
*अंतिम फीस सूचना: रु. {{1}} बकाया*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
बकाया किश्त: {{3}}
अंतिम तिथि: {{4}}
इस किश्त पर विलंब शुल्क: {{5}}

उपरोक्त किश्त की देय तिथि निकल चुकी है और राशि अब तक जमा नहीं हुई है। कृपया अंतिम तिथि तक जमा करें। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 3` · `10-11-2026` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_overdue_final_en_v7`

Category **UTILITY** · language **English** · notice `overdue_final` · replaces `vpps_app_overdue_final_en_v6`

```
*Final fee notice: Rs. {{1}} overdue*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment overdue: {{3}}
Final date: {{4}}
Late fee on this installment: {{5}}

The due date for the installment above has passed and the amount remains unpaid. Please clear it by the final date. Report cards and examination admit cards are issued only for accounts with no pending fees. Tap Pay now to pay by UPI, or visit the fee counter.

If you have already paid, kindly ignore this message.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 3` · `10-11-2026` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_late_fee_waiver_hi_v7`

Category **UTILITY** · language **Hindi** · notice `late_fee_waiver` · replaces `vpps_app_late_fee_waiver_hi_v6`

```
*विलंब शुल्क सूचना: रु. {{1}} फीस शेष*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
इस खाते पर विलंब शुल्क: रु. {{4}}
बिना विलंब शुल्क की अंतिम तिथि: {{5}}

यदि शेष फीस अंतिम तिथि तक प्राप्त हो जाती है तो दर्शाया गया विलंब शुल्क नहीं लिया जाएगा। उस तिथि के अगले दिन से फीस और विलंब शुल्क दोनों देय होंगे। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 3` · `1,000` · `30-10-2026`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_late_fee_waiver_en_v7`

Category **UTILITY** · language **English** · notice `late_fee_waiver` · replaces `vpps_app_late_fee_waiver_en_v6`

```
*Late fee notice: Rs. {{1}} fees pending*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Late fee on this account: Rs. {{4}}
Last date without late fee: {{5}}

The late fee shown will not be charged if the fees pending are received on or before the last date. From the day after, the fees and the late fee are both payable. Tap Pay now to pay by UPI, or visit the fee counter.

If you have already paid, kindly ignore this message.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 3` · `1,000` · `30-10-2026`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_waiver_last_call_hi_v7`

Category **UTILITY** · language **Hindi** · notice `waiver_last_call` · replaces `vpps_app_waiver_last_call_hi_v6`

```
*बिना विलंब शुल्क की अंतिम तिथि: रु. {{1}} शेष*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
रोका गया विलंब शुल्क: रु. {{4}}
अंतिम तिथि: {{5}}

यह वह अंतिम तिथि है जिस तक शेष फीस बिना विलंब शुल्क के जमा की जा सकती है। अगले दिन से दर्शाया गया विलंब शुल्क इस खाते में जुड़ जाएगा। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है। UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ।

यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `किश्त 3` · `1,000` · `30-10-2026`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_waiver_last_call_en_v7`

Category **UTILITY** · language **English** · notice `waiver_last_call` · replaces `vpps_app_waiver_last_call_en_v6`

```
*Last date without late fee: Rs. {{1}} pending*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Late fee held back: Rs. {{4}}
Last date: {{5}}

This is the last date on which the fees pending can be received without the late fee. From the day after, the late fee shown is added to this account. Report cards and examination admit cards are issued only for accounts with no pending fees. Tap Pay now to settle by UPI.

Ignore this message if the amount has already been paid.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `Installment 3` · `1,000` · `30-10-2026`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_promise_due_hi_v7`

Category **UTILITY** · language **Hindi** · notice `promise_due` · replaces `vpps_app_promise_due_hi_v6`

```
*भुगतान तिथि स्मरण: रु. {{1}}*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
बातचीत की तिथि: {{3}}
तय की गई तिथि: {{4}}
तय तिथि के बाद विलंब शुल्क: {{5}}

उपरोक्त बातचीत की तिथि को आपने यह राशि तय की गई तिथि तक जमा करने की सहमति दी थी। कृपया उस तिथि तक जमा कर दें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ।

यदि राशि जमा हो चुकी है तो रिकॉर्ड सुधार हेतु "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `26-10-2026` · `31-10-2026` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_promise_due_en_v7`

Category **UTILITY** · language **English** · notice `promise_due` · replaces `vpps_app_promise_due_en_v6`

```
*Payment date reminder: Rs. {{1}}*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Spoken on: {{3}}
Date agreed: {{4}}
Late fee after the date agreed: {{5}}

On the date above you agreed to pay the amount by the date shown. Kindly pay on or before that date. Tap Pay now to pay by UPI.

If the amount has already been paid, tap Call office so the record can be corrected.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `26-10-2026` · `31-10-2026` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_promise_lapsed_hi_v7`

Category **UTILITY** · language **Hindi** · notice `promise_lapsed` · replaces `vpps_app_promise_lapsed_hi_v6`

```
*भुगतान अनुस्मरण: रु. {{1}} शेष*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
दी गई तिथि: {{3}}
नई तिथि: {{4}}
नई तिथि के बाद विलंब शुल्क: {{5}}

हमारे रिकॉर्ड के अनुसार यह भुगतान दी गई तिथि तक अपेक्षित था और अब तक प्राप्त नहीं हुआ है। कृपया नई तिथि तक जमा करें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ।

यदि भुगतान हो चुका है तो रिकॉर्ड सुधार हेतु "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `28-10-2026` · `05-11-2026` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_promise_lapsed_en_v7`

Category **UTILITY** · language **English** · notice `promise_lapsed` · replaces `vpps_app_promise_lapsed_en_v6`

```
*Payment follow-up: Rs. {{1}} pending*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Date given: {{3}}
New date: {{4}}
Late fee after the new date: {{5}}

Our record shows this payment was expected by the date given and has not reached us. Kindly pay by the new date. Tap Pay now to pay by UPI.

If you have already paid, tap Call office so the record can be corrected.
```

Samples: `9,125` · `Aaradhya Gurjar · Class 2` · `28-10-2026` · `05-11-2026` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_exam_clearance_hi_v7`

Category **UTILITY** · language **Hindi** · notice `exam_clearance` · replaces `vpps_app_exam_clearance_hi_v6`

```
*परीक्षा से पहले फीस जमा करें: रु. {{1}} शेष*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
शेष किश्तें: {{3}}
जमा करने की तिथि: {{4}}
शेष किश्तों पर विलंब शुल्क: {{5}}

परीक्षाएँ निकट हैं। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है। कृपया उपरोक्त राशि दर्शाई गई तिथि तक जमा करें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।
```

Samples: `18,250` · `Aaradhya Gurjar · Class 2` · `किश्त 3 एवं 4` · `15-02-2027` · `रु. 1,000 प्रति किश्त`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_exam_clearance_en_v7`

Category **UTILITY** · language **English** · notice `exam_clearance` · replaces `vpps_app_exam_clearance_en_v6`

```
*Clear fees before exams: Rs. {{1}} pending*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installments pending: {{3}}
Clear by: {{4}}
Late fee on pending installments: {{5}}

Examinations are approaching. Report cards and examination admit cards are issued only for accounts with no pending fees. Please clear the amount by the date shown. Tap Pay now to pay by UPI, or visit the fee counter.

If you have already paid, kindly ignore this message.
```

Samples: `18,250` · `Aaradhya Gurjar · Class 2` · `Installment 3 and 4` · `15-02-2027` · `Rs. 1,000 per installment`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)

#### `vpps_app_prevyear_hi_v7`

Category **UTILITY** · language **Hindi** · notice `prevyear` · replaces `vpps_app_prevyear_hi_v6`

```
*पिछले सत्र की शेष राशि: रु. {{1}}*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
सत्र: {{3}}
जमा करने की तिथि: {{4}}
विलंब शुल्क: {{5}}

यह राशि पिछले सत्र की है और इस वर्ष की किश्तों से अलग है। UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।

पूरे विवरण के लिए "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `20,000` · `Aaradhya Gurjar · Class 2` · `2025-26` · `30-11-2026` · `इस राशि पर लागू नहीं`

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **कार्यालय को कॉल करें** (phone, +919352205884)

#### `vpps_app_prevyear_en_v7`

Category **UTILITY** · language **English** · notice `prevyear` · replaces `vpps_app_prevyear_en_v6`

```
*Previous session balance: Rs. {{1}}*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Session: {{3}}
Settle by: {{4}}
Late fee: {{5}}

This amount is from the previous session and is separate from this year's installments. Tap Pay now to settle it by UPI, or visit the fee counter.

For a full statement, tap Call office.
```

Samples: `20,000` · `Aaradhya Gurjar · Class 2` · `2025-26` · `30-11-2026` · `Not applicable on this amount`

Buttons: **Pay now** (URL, dynamic — `https://one.vpps.co.in/pay/{{1}}`, sample suffix `pc_sample`; AiSensy numbers it `{{6}}`) · **Call office** (phone, +919352205884)
