# WhatsApp campaign registry

> Copied from the fees app (`docs/modules/whatsapp-campaign-registry.md` at
> 8a0cd47c) because the ported tests read it. It records the fees app's AiSensy
> account. VPPS One sends `_v7` where this says `_v6` — see
> `docs/cutover/AISENSY-TEMPLATES.md` — and never a `_v6` template.

Thirty-four Meta-approved templates, each with a Live AiSensy API campaign of
the same name: twenty-four per-student notices covering twelve fee situations
in Hindi and English, eight family notices, and two receipt notices. The ten
per-student `_v4` templates — five recovery situations — were submitted and
went Live on 2026-09-08. Every reminder carries a **settable late fee**, because
the late fee is what actually moves a family from "next week" to today — except
the three that quote the ledger's own.

This document is the contract `src/modules/whatsapp/domain/campaigns.ts` and
`src/modules/whatsapp/domain/campaign-bodies-v3.ts` honour: campaign name, slot
order, and what each slot must contain. If the two disagree, this one wins, and
`tests/unit/whatsapp-campaigns.test.ts` fails until they agree again.

**Two sets live here.** The `_v2` six below went Live on 22 Aug 2026. The `_v3`
eighteen further down — eight per-student, eight family, two receipt — were
approved by Meta and set Live in AiSensy on **2026-09-04**. All fourteen
per-student descriptors carry `approved: true` in `campaigns.ts`; the family and
receipt descriptors carry it in `campaign-bodies-v3.ts`. `campaignFor()` hands
out every per-student notice and the picker shows every chip enabled.

## The current set is `_v2`

| Campaign | Language | Situation | Slots |
|---|---|---|---|
| `vpps_app_fee_due_hi_v2` | Hindi | Nothing received for installments 1–2 | 7 |
| `vpps_app_fee_due_en_v2` | English | same | 7 |
| `vpps_app_balance_hi_v2` | Hindi | Part paid, balance outstanding | 7 |
| `vpps_app_balance_en_v2` | English | same | 7 |
| `vpps_app_prevyear_hi_v2` | Hindi | Carry-forward from the previous session | 7 |
| `vpps_app_prevyear_en_v2` | English | same | 7 |

Campaign name equals template name in every case, so one string drives both.
All six are category **UTILITY**.

The six un-suffixed `vpps_app_*` templates from 21 Aug are **superseded** — same
three situations, but no late-fee slot and no settlement date on the prev-year
notice. They and their campaigns are left in place rather than deleted (Meta
blocks reusing a template name for 30 days after deletion, and their campaigns
carry the test-send history). The app must never point at them.

There is no edit path: AiSensy offers star, duplicate and delete on an approved
template, and nothing else. Changing a body means a new name.

## The uniform 7-slot contract

The whole point of the v2 shape is that **every notice has the same slot
skeleton**, so the registry is one table rather than three special cases.

| Slot | Always | fee_due | balance | prevyear |
|---|---|---|---|---|
| `{{1}}` | Parent name | | | |
| `{{2}}` | Student name | | | |
| `{{3}}` | Class, `Class ` prefix stripped | | | |
| `{{4}}` | The context line | installment phrase | received so far | session label |
| `{{5}}` | The money owed | amount due | balance due | balance |
| `{{6}}` | The date it turns on | last date | next date | settle by |
| `{{7}}` | **The late-fee phrase** | | | |

`{{6}}` and `{{7}}` are a pair. A late fee with no date is meaningless, which is
why the prev-year notice gained a settlement date it did not have in v1.

## The late-fee slot

`{{7}}` is **one free-text phrase**, not an amount and a unit. That is what lets
one approved template express every charging model the office might want:

| Intent | What to put in `{{7}}` (en) | Hindi |
|---|---|---|
| Flat, per installment — **what the ledger actually does** | `Rs. 1,000 per installment` | `रु. 1,000 प्रति किश्त` |
| Per day after the date | `Rs. 50 per day` | `रु. 50 प्रति दिन` |
| One flat charge | `Rs. 1,000` | `रु. 1,000` |
| Not charged on this amount | `Not applicable on this amount` | `इस राशि पर लागू नहीं` |

The app should collect this as an **amount plus a basis** (flat / per day / per
installment) and compose the phrase, rather than handing staff a free-text box —
a typo here is a number a parent will hold the school to.

**The phrase must match what the ledger will charge.** `src/platform/config/fee-rules.ts`
sets ₹1,000 flat per installment from the day an installment passes its due
date, and carry-forward rows carry a rate of **0** deliberately. A message that
promises ₹50/day and a receipt that shows ₹1,000 is a conversation at the fee
counter the office will lose. Default `{{7}}` from the real policy and make an
override a deliberate act.

WhatsApp rejects an empty parameter, so `{{7}}` always needs content — hence the
"not applicable" wording rather than a blank.

## Class labels

The templates print `कक्षा: {{3}}` / `Class: {{3}}`. App class labels are
`"Class 2"`, so passing them through yields "Class: Class 2". Strip a leading
`Class ` before filling the slot. `11 Science` and `Nursery` pass through
unchanged and must not be rewritten.

## Amounts

`{{5}}` on the due notice is installment 1 pending + installment 2 pending —
**not** `overdue_base_amount`, which folds in previous-session carry-forward. On
admission 2241 the two differ by ₹20,000. The carry-forward is what
`vpps_app_prevyear_*_v2` is for, and saying it twice would overstate what the
family owes this year.

Format with `formatRupeesPlain` — grouped digits, no symbol. The template
supplies `रु.` / `Rs.` itself. The same goes for the amount inside `{{7}}`.

## Category drift

All six were UTILITY at creation and after review. Meta re-categorises silently:
`vpps_waiver_offer_hinglish` was submitted UTILITY at 10:02 pm on 10 June and
was MARKETING by 10:16 — ₹0.145 to ₹1.09 a message, a 7.5× jump. The trigger was
promotional wording ("Good news", "is mauke ka labh zaroor uthayein").

A late-fee warning is transactional, not promotional, so it should hold. Check
the category before each billing cycle anyway.

## Bodies as approved

Reproduced so a body change is visible in a diff. WhatsApp sends what Meta
approved, not this text.

### `vpps_app_fee_due_en_v2`

```
*Fee Notice — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Amount due: Rs. {{5}}
Last date: {{6}}
Late fee after the last date: {{7}}

Paying on or before the last date avoids the late fee. After that date the late fee above is added to the amount.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 1 and 2` ·
`18,250` · `25-08-2026` · `Rs. 1,000 per installment`

### `vpps_app_fee_due_hi_v2`

```
*फीस सूचना — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
देय राशि: रु. {{5}}
अंतिम तिथि: {{6}}
अंतिम तिथि के बाद विलंब शुल्क: {{7}}

अंतिम तिथि तक फीस जमा करने पर कोई विलंब शुल्क नहीं लगेगा। उसके बाद उपरोक्त दर से विलंब शुल्क जोड़ा जाएगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 1 एवं 2` · `18,250` ·
`25-08-2026` · `रु. 1,000 प्रति किश्त`

### `vpps_app_balance_en_v2`

```
*Fee Balance — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Received so far: Rs. {{4}}
Balance due: Rs. {{5}}
Next date: {{6}}
Late fee after the next date: {{7}}

Thank you for the payment received. Clearing the balance by the next date avoids the late fee.

Pay at the fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

If this differs from your own record, please call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `6,500` · `11,750` ·
`20-10-2026` · `Rs. 1,000 per installment`

### `vpps_app_balance_hi_v2`

```
*फीस शेष विवरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
अब तक प्राप्त: रु. {{4}}
शेष बकाया: रु. {{5}}
अगली तिथि: {{6}}
अगली तिथि के बाद विलंब शुल्क: {{7}}

प्राप्त भुगतान के लिए धन्यवाद। शेष राशि अगली तिथि तक जमा करने पर कोई विलंब शुल्क नहीं लगेगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

यदि यह विवरण आपके रिकॉर्ड से भिन्न है तो कृपया कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `6,500` · `11,750` ·
`20-10-2026` · `रु. 1,000 प्रति किश्त`

### `vpps_app_prevyear_en_v2`

```
*Previous Session Balance — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Session: {{4}}
Balance: Rs. {{5}}
Settle by: {{6}}
Late fee: {{7}}

This amount is from the previous session and is separate from this year's installments. Please settle it by the date above.

Visit the fee counter or use this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

For a full statement, call the office on 9352205884.
```

Samples: `Pintu Singh Chundawat` · `Bhavydeep Singh Chundawat` · `Nursery` ·
`2025-26` · `20,000` · `30-09-2026` · `Not applicable on this amount`

### `vpps_app_prevyear_hi_v2`

```
*पिछले सत्र का शेष — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
सत्र: {{4}}
शेष राशि: रु. {{5}}
निपटान की अंतिम तिथि: {{6}}
विलंब शुल्क: {{7}}

यह राशि पिछले सत्र की है और इस वर्ष की किश्तों से अलग है। कृपया उपरोक्त तिथि तक निपटान कर दें।

फीस काउंटर पर आएं अथवा इस UPI लिंक का उपयोग करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

पूरा विवरण देखने हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `पिंटू सिंह चुंडावत` · `भव्यदीप सिंह चुंडावत` · `नर्सरी` · `2025-26` ·
`20,000` · `30-09-2026` · `इस राशि पर लागू नहीं`

Note the prev-year label is a bare `विलंब शुल्क:` / `Late fee:` rather than
"after this date", so the same line reads correctly whether the value is an
amount or "not applicable".

## The `_v3` set — approved 2026-09-04

Eight templates covering four new situations in Hindi and English. Submitted to
Meta through AiSensy on 2026-09-04 as category UTILITY, approved the same day,
and each given an API campaign of the same name and set Live. They are in
`campaigns.ts` with `approved: true`, `campaignFor()` hands them out, and the
notice picker renders their chips enabled with an audience count.

The bodies below are what was submitted and approved, verbatim.

| Campaign | Language | Situation | Slots | Skeleton |
|---|---|---|---|---|
| `vpps_app_upcoming_hi_v3` | Hindi | Installment due inside the pre-due window, nothing overdue | 7 | shared |
| `vpps_app_upcoming_en_v3` | English | same | 7 | shared |
| `vpps_app_upcoming_final_hi_v3` | Hindi | Same audience, from T-3 | 7 | shared |
| `vpps_app_upcoming_final_en_v3` | English | same | 7 | shared |
| `vpps_app_late_fee_applied_hi_v3` | Hindi | A due date has passed and the ledger charges a late fee | 7 | **its own** |
| `vpps_app_late_fee_applied_en_v3` | English | same | 7 | **its own** |
| `vpps_app_promise_lapsed_hi_v3` | Hindi | A promised date passed unpaid | 7 | shared |
| `vpps_app_promise_lapsed_en_v3` | English | same | 7 | shared |

All eight are category **UTILITY**. Every line states a fact about this family's
account or what to do about it; nothing is offered, discounted or sold, because
promotional wording is what moved `vpps_waiver_offer_hinglish` to MARKETING in
fourteen minutes.

### Six of the eight keep the v2 skeleton

`upcoming`, `upcoming_final` and `promise_lapsed` reuse the 7-slot shape exactly,
which is why they need no new table:

| Slot | Always | upcoming / upcoming_final | promise_lapsed |
|---|---|---|---|
| `{{1}}` | Parent name | | |
| `{{2}}` | Student name | | |
| `{{3}}` | Class, `Class ` prefix stripped | | |
| `{{4}}` | The context line | installment phrase | **the date the family gave** |
| `{{5}}` | The money owed | amount due | amount pending |
| `{{6}}` | The date it turns on | last date | **the new date** |
| `{{7}}` | The late-fee phrase | | |

### `late_fee_applied` is the one that does not

It is the only notice with three money slots and **no date and no late-fee
phrase**, because the fee has been charged rather than threatened — there is
nothing left to be on time for.

| Slot | Contents |
|---|---|
| `{{1}}` | Parent name |
| `{{2}}` | Student name |
| `{{3}}` | Class |
| `{{4}}` | Installment phrase |
| `{{5}}` | **Fees pending** — `pending_amount`, fees only |
| `{{6}}` | **Late fee applied** — `late_fee_pending`, read from the ledger |
| `{{7}}` | **Total to pay** — `total_pending`, the only figure that is a sum |

Three separate slots, deliberately. `pending_amount` is fees, `late_fee_pending`
is the late fee, and only `total_pending` adds them — that split is why an unpaid
late fee has never made a family a defaulter here, and a message folding the
first two together would be the first place the rule broke.

**The amount on this notice is not editable.** Every other notice's slot 7 is a
lever the office sets, and `describeLateFeeDrift` warns when it disagrees with
the ledger. Here the figure IS the ledger's, per family, so there is nothing to
drift from and the control is disabled. It is never re-derived in TypeScript —
the view is the only thing that knows about waivers and the accrual rule at once,
which is the same trap `waive_late_fee` fell into from the other side.

### Bodies to submit

#### `vpps_app_upcoming_en_v3`

```
*Fee Reminder — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Amount due: Rs. {{5}}
Last date: {{6}}
Late fee after the last date: {{7}}

The installment above falls due shortly. Paying on or before the last date avoids the late fee.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 3` ·
`9,125` · `20-10-2026` · `Rs. 1,000 per installment`

#### `vpps_app_upcoming_hi_v3`

```
*फीस स्मरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
देय राशि: रु. {{5}}
अंतिम तिथि: {{6}}
अंतिम तिथि के बाद विलंब शुल्क: {{7}}

उपरोक्त किश्त शीघ्र ही देय है। अंतिम तिथि तक फीस जमा करने पर कोई विलंब शुल्क नहीं लगेगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 3` · `9,125` ·
`20-10-2026` · `रु. 1,000 प्रति किश्त`

#### `vpps_app_upcoming_final_en_v3`

Worded differently throughout rather than being the courtesy body with one line
changed — Meta rejects a body that near-duplicates an approved one.

```
*Final Fee Reminder — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Amount payable: Rs. {{5}}
Last date: {{6}}
Late fee from the day after: {{7}}

Only a few days remain. From the day after the last date shown above, the late fee is added to this account.

Settle at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Kindly mention the student's name with the payment and take a receipt. Ignore this message if the amount has already been paid.

To confirm your record, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 3` ·
`9,125` · `20-10-2026` · `Rs. 1,000 per installment`

#### `vpps_app_upcoming_final_hi_v3`

```
*अंतिम फीस स्मरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
देय राशि: रु. {{5}}
अंतिम तिथि: {{6}}
अगले दिन से विलंब शुल्क: {{7}}

अब कुछ ही दिन शेष हैं। उपरोक्त अंतिम तिथि के अगले दिन से इस खाते में विलंब शुल्क जोड़ दिया जाएगा।

फीस काउंटर पर अथवा इस UPI लिंक से निपटान करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान के साथ विद्यार्थी का नाम अवश्य लिखें तथा रसीद लें। राशि जमा हो चुकी हो तो इस संदेश को अनदेखा करें।

अपना रिकॉर्ड जांचने हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 3` · `9,125` ·
`20-10-2026` · `रु. 1,000 प्रति किश्त`

#### `vpps_app_late_fee_applied_en_v3`

```
*Late Fee Applied — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Fees pending: Rs. {{5}}
Late fee applied: Rs. {{6}}
Total to pay: Rs. {{7}}

The last date for the installment above has passed, and the late fee shown is now on this account. Please clear the total at the earliest.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 2` ·
`9,125` · `1,000` · `10,125`

The three figures must add up in the sample. A reviewer reads them as one
account, and so does a parent.

#### `vpps_app_late_fee_applied_hi_v3`

```
*विलंब शुल्क लागू — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
शेष फीस: रु. {{5}}
लागू विलंब शुल्क: रु. {{6}}
कुल देय: रु. {{7}}

उपरोक्त किश्त की अंतिम तिथि निकल चुकी है तथा दर्शाया गया विलंब शुल्क इस खाते में जुड़ चुका है। कृपया कुल राशि शीघ्र जमा करें।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 2` · `9,125` ·
`1,000` · `10,125`

#### `vpps_app_promise_lapsed_en_v3`

```
*Fee Payment Follow-up — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Date given: {{4}}
Amount pending: Rs. {{5}}
New date: {{6}}
Late fee after the new date: {{7}}

Our record shows this payment was expected by the date given above and has not reached us. Kindly pay by the new date shown.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

If the amount has already been paid, please ignore this message and call the office so the record can be corrected.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `28-08-2026` · `9,125` ·
`10-09-2026` · `Rs. 1,000 per installment`

#### `vpps_app_promise_lapsed_hi_v3`

```
*फीस भुगतान अनुवर्ती सूचना — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
दी गई तिथि: {{4}}
शेष राशि: रु. {{5}}
नई तिथि: {{6}}
नई तिथि के बाद विलंब शुल्क: {{7}}

हमारे रिकॉर्ड के अनुसार यह भुगतान उपरोक्त दी गई तिथि तक अपेक्षित था और अब तक प्राप्त नहीं हुआ है। कृपया दर्शाई गई नई तिथि तक जमा करें।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें तथा रिकॉर्ड सुधार हेतु कार्यालय को सूचित करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `28-08-2026` · `9,125` ·
`10-09-2026` · `रु. 1,000 प्रति किश्त`

### The approval switch

`approved` is a field on `CampaignDescriptor`, explicit on all fourteen rather
than defaulted — adding a fifteenth must not inherit approval by omission.

**There is no switch on screen, and no switch in the database.** Approval is
the `approved` flag on the descriptor — in `campaigns.ts` for the fourteen
per-student notices, in `campaign-bodies-v3.ts` for the family and receipt ones
— changed in code, pinned by `tests/unit/whatsapp-campaigns.test.ts`
(`APPROVED_NAMES`) and `tests/unit/whatsapp-family-grouping.test.ts`, and
deployed. The two "awaiting Meta approval" messages in `campaignFor` and
`send-guards.ts` say exactly that.

An earlier version of this section described a
`whatsapp_campaign_approvals` row in `app_settings` holding a JSON array of
names an admin had confirmed Live. Migration `20260903172053` seeded that row as
`'[]'` and **nothing reads it** — the design was never built, and with all
eighteen `_v3` campaigns approved on 2026-09-04 there is nothing left for it to
switch. The row is harmless and stays.

The one real setting is `whatsapp_receipt_notice_enabled` (`'true'` /
`'false'`, seeded `'false'`), read by `data/receipt-notice.ts`. See "The
receipt notice" below.

## The family notices — one phone, one message

Eight more templates, also `_v3`, **approved and Live since 2026-09-04**. A
parent with three children at the school was receiving three messages within a
few seconds, each quoting one child's balance: three times the cost, and three
times the nagging, for one family who owes one total.

| Campaign | Language | Situation | Slots |
|---|---|---|---|
| `vpps_app_family_fee_due_hi_v3` | Hindi | Nothing received, all children | 5 |
| `vpps_app_family_fee_due_en_v3` | English | same | 5 |
| `vpps_app_family_balance_hi_v3` | Hindi | Part paid, balance across the children | 5 |
| `vpps_app_family_balance_en_v3` | English | same | 5 |
| `vpps_app_family_upcoming_hi_v3` | Hindi | Next installment due soon | 5 |
| `vpps_app_family_upcoming_en_v3` | English | same | 5 |
| `vpps_app_family_late_fee_applied_hi_v3` | Hindi | A date has passed, late fee on the account | 5 |
| `vpps_app_family_late_fee_applied_en_v3` | English | same | 5 |

### Five slots, not seven

| Slot | Contents |
|---|---|
| `{{1}}` | Parent name |
| `{{2}}` | **The children line** — `Aaradhya Gurjar (2), Bhavya Gurjar (5)` |
| `{{3}}` | **The total** — every child's figure, summed |
| `{{4}}` | The date |
| `{{5}}` | The late-fee phrase |

There is no per-child installment phrase and no per-child figure, which is the
whole point: the family owes one total and is asked for it once. Classes in
`{{2}}` are stripped of the `Class ` prefix exactly as `{{3}}` is on the
per-student notices, so the line reads the way the body around it does.

`{{3}}` goes through `formatRupeesPlain` and the body supplies `रु.` / `Rs.`
itself, same as every other money slot here.

### What runs now (since 2026-09-04)

`sendFamily` groups the audience by destination, and `domain/family-notice.ts`
decides what the one message per phone says:

- **Two or more children on `fee_due`, `balance` or `upcoming`** → the family
  template above, in the family's language. The spokesperson's row carries
  `campaign_name = vpps_app_family_*`, `due_amount` = the family total and the
  five params as sent; the siblings get rows with `status = 'covered_by_sibling'`
  under the **same** campaign name and the same `provider_message_id`.
- **A one-child phone** → the ordinary per-child notice. "Students: Aaradhya (2)
  · Total: Rs. 9,125" is the per-child notice with worse wording.
- **Any family on `late_fee_applied`** → the spokesperson's per-child notice,
  even though a family template exists. Its `{{4}}` "date passed" would need the
  latest passed due date from the calendar, which the executor is not handed;
  its `{{3}}` should be Σ(fees + late fee) per child while the grouped total
  sums fees only; and its `{{5}}` should be the ledger's summed late fee, not
  the run's lever. Three changes to the family shape for one notice — deferred,
  and pinned as a decision in `tests/unit/whatsapp-family-notice.test.ts`.

Either way the per-student unique index still holds, `v_whatsapp_run_outcomes`
still joins the siblings' payments to the run, and the screen can say *why* a
sibling was not messaged separately. Because one notice now logs under two
names, "already messaged today" is read for both (`campaignNamesForNotice`) and
the executor skips anyone already logged before grouping.

The `untested_campaign` guard is keyed on the per-child campaign name and asks
once per campaign — a campaign with any `sent` row or any successful test, ever,
is proven. The family templates were each proven with a real send to the
owner's phone before this went live, from `scripts/whatsapp-test-send.mjs`.

The grouping itself is a switch: `app_settings.whatsapp_one_message_per_family`
(on with no row, `'false'` to send every child their own message again). Both
callers of `executeReminderRun` read it — `data/reminder-settings.ts`.

### Bodies to submit

All eight share one skeleton and are worded differently per situation, because
Meta rejects a body that near-duplicates an approved one.

#### `vpps_app_family_fee_due_en_v3`

```
*Fee Notice — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Students: {{2}}
Total amount due: Rs. {{3}}
Last date: {{4}}
Late fee after the last date: {{5}}

The amount above covers all the students named. Paying on or before the last date avoids the late fee.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the students' names with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar (2), Bhavya Gurjar (5)` ·
`22,375` · `20-10-2026` · `Rs. 1,000 per installment`

#### `vpps_app_family_fee_due_hi_v3`

```
*फीस सूचना — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कुल देय राशि: रु. {{3}}
अंतिम तिथि: {{4}}
अंतिम तिथि के बाद विलंब शुल्क: {{5}}

उपरोक्त राशि सभी दर्शाए गए विद्यार्थियों की है। अंतिम तिथि तक जमा करने पर कोई विलंब शुल्क नहीं लगेगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थियों के नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर (2), भव्या गुर्जर (5)` · `22,375` ·
`20-10-2026` · `रु. 1,000 प्रति किश्त`

#### `vpps_app_family_balance_en_v3`

```
*Fee Balance — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Students: {{2}}
Balance due in total: Rs. {{3}}
Next date: {{4}}
Late fee after the next date: {{5}}

Thank you for the payments received. The balance above is what remains across the students named, and clearing it by the next date avoids the late fee.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the students' names with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: as above, with `20-10-2026` as the next date.

#### `vpps_app_family_balance_hi_v3`

```
*फीस शेष विवरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कुल शेष बकाया: रु. {{3}}
अगली तिथि: {{4}}
अगली तिथि के बाद विलंब शुल्क: {{5}}

प्राप्त भुगतान के लिए धन्यवाद। उपरोक्त शेष राशि दर्शाए गए सभी विद्यार्थियों की है। अगली तिथि तक जमा करने पर कोई विलंब शुल्क नहीं लगेगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थियों के नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

#### `vpps_app_family_upcoming_en_v3`

```
*Fee Reminder — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Students: {{2}}
Amount due in total: Rs. {{3}}
Last date: {{4}}
Late fee after the last date: {{5}}

The next installment for the students named falls due shortly. Settling the total on or before the last date avoids the late fee.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the students' names with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

#### `vpps_app_family_upcoming_hi_v3`

```
*फीस स्मरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कुल देय राशि: रु. {{3}}
अंतिम तिथि: {{4}}
अंतिम तिथि के बाद विलंब शुल्क: {{5}}

दर्शाए गए विद्यार्थियों की अगली किश्त शीघ्र ही देय है। अंतिम तिथि तक कुल राशि जमा करने पर कोई विलंब शुल्क नहीं लगेगा।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थियों के नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

#### `vpps_app_family_late_fee_applied_en_v3`

Note `{{5}}` here is the late fee **already included** in `{{3}}`, not a warning
about one to come — the family variant quotes one total, so the split into three
figures that the per-student `late_fee_applied` notice makes is not available.
The label says so.

```
*Late Fee Applied — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Students: {{2}}
Total to pay: Rs. {{3}}
Date passed: {{4}}
Late fee included above: {{5}}

The last date shown has passed and the late fee is now on this account. The total above covers all the students named.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the students' names with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

#### `vpps_app_family_late_fee_applied_hi_v3`

```
*विलंब शुल्क लागू — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कुल देय: रु. {{3}}
निकल चुकी तिथि: {{4}}
उपरोक्त राशि में सम्मिलित विलंब शुल्क: {{5}}

दर्शाई गई अंतिम तिथि निकल चुकी है तथा विलंब शुल्क इस खाते में जुड़ चुका है। उपरोक्त कुल राशि सभी दर्शाए गए विद्यार्थियों की है।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थियों के नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

## The receipt notice

Two more templates, `vpps_app_receipt_hi_v3` and `vpps_app_receipt_en_v3`.
**Approved 2026-09-04, and switched off.** `data/receipt-notice.ts` sends one
only when `app_settings.whatsapp_receipt_notice_enabled` is `'true'`, and
migration `20260903172053` seeded it `'false'`; `tests/unit/whatsapp-family-grouping.test.ts`
pins both the flag and that seed. Turning it on is the owner's call and a
separate step — from then on **every posted payment messages the parent**:

```sql
update public.app_settings
set value = 'true'
where key = 'whatsapp_receipt_notice_enabled';
```

Run it in the Supabase SQL editor (or the read-write MCP); `'false'` reverses
it, no deploy either way. Two things to know before enabling: prove it first on
`TEST-2026-27` with a posting against a `TEST-` student whose number is the
owner's; and `loadLastSentOn` counts every `status = 'sent'` row regardless of
campaign, so a receipt notice pushes that family's next reminder out by their
cadence gap and counts toward second-number escalation. That is arguably right
— they were just messaged — but it is a change in when reminders arrive.

The office's most common inbound WhatsApp is a parent asking whether the money
arrived. This answers it before it is asked, and it is the only message in this
system a family is pleased to receive.

| Slot | Contents |
|---|---|
| `{{1}}` | Parent name |
| `{{2}}` | Student name |
| `{{3}}` | Class |
| `{{4}}` | Receipt number |
| `{{5}}` | Amount received |
| `{{6}}` | Date |
| `{{7}}` | **Balance remaining** |

Slot 7 is the remaining balance rather than a late-fee phrase, which is the whole
difference between this and every other notice here: a receipt is not a demand,
and a parent who has just paid should be told where that leaves them rather than
what happens if they are late. Zero is a real and welcome value — "nothing
further is due" — so it prints rather than being suppressed.

The balance is read from the ledger AFTER the posting, not computed from the
amount, so a discount or adjustment applied in the same posting is reflected and
the figure agrees with the printed receipt the parent is holding.

### It cannot fail a posting

Sent strictly after `post_student_payment_with_adjustments` returns success,
outside every transaction, inside a `try/catch` that swallows everything. The
money is in the drawer and the receipt is printed whatever happens; a WhatsApp
hiccup must never read as a failed posting at the counter.

It also honours `no_call` and a `whatsapp_cadence` of `never`, because a family
who asked not to be contacted did not ask only about reminders.

### One notice per receipt

`whatsapp_reminder_sends.receipt_id` with a **partial unique index**, claimed
before the provider call exactly as a reminder claims its day. A retried posting
of the same receipt cannot send twice; a second posting for the same family on
the same day is a different receipt and rightly gets its own message. That is why
the receipt index is separate from the day/campaign one rather than folded into
it.

### Bodies to submit

#### `vpps_app_receipt_en_v3`

```
*Payment Received — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Receipt number: {{4}}
Amount received: Rs. {{5}}
Date: {{6}}
Balance remaining: Rs. {{7}}

Thank you. Your payment has been recorded against the student named above. Please keep the printed receipt for your records.

If any detail above does not match your receipt, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `SVP-2026-27-1042` ·
`9,125` · `03-09-2026` · `9,125`

#### `vpps_app_receipt_hi_v3`

```
*भुगतान प्राप्त — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
रसीद संख्या: {{4}}
प्राप्त राशि: रु. {{5}}
दिनांक: {{6}}
शेष राशि: रु. {{7}}

धन्यवाद। आपका भुगतान उपरोक्त विद्यार्थी के खाते में दर्ज कर लिया गया है। कृपया मुद्रित रसीद सुरक्षित रखें।

यदि उपरोक्त विवरण आपकी रसीद से भिन्न है तो कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `SVP-2026-27-1042` ·
`9,125` · `03-09-2026` · `9,125`

Note this body has no UPI link. Nothing is being asked for.

## The `_v4` set — submitted and Live 2026-09-08

Ten more per-student templates covering five recovery situations in Hindi and
English. Written for one job: bringing fees in faster around the late fee. The
office chose, on 2026-09-08, that the waiver is honoured by hand at the counter
(the cashier presses Waive when a family pays inside the window — nothing
automatic touches money), and that three of the bodies may state the school's
report-card rule.

All ten were submitted through the AiSensy dashboard on 2026-09-08 as UTILITY
with a **Call office** button. Meta approved all ten within the hour, every one
still UTILITY, and each has an API campaign of the same name set Live. Every
descriptor carries `approved: true`, pinned by name in
`tests/unit/whatsapp-campaigns.test.ts`. Check the category again before the
next billing cycle — re-categorisation is silent.

| Campaign | Language | Situation | Slots | Skeleton |
|---|---|---|---|---|
| `vpps_app_late_fee_waiver_hi_v4` | Hindi | The ledger charges a late fee; it is set aside if the fees arrive by a date | 7 | **waiver** |
| `vpps_app_late_fee_waiver_en_v4` | English | same | 7 | **waiver** |
| `vpps_app_waiver_last_call_hi_v4` | Hindi | The same families, on the last day the waiver holds | 7 | **waiver** |
| `vpps_app_waiver_last_call_en_v4` | English | same | 7 | **waiver** |
| `vpps_app_overdue_final_hi_v4` | Hindi | Fees still pending on an installment whose date has passed, late fee waived or not | 7 | shared |
| `vpps_app_overdue_final_en_v4` | English | same | 7 | shared |
| `vpps_app_promise_due_hi_v4` | Hindi | The family's own promised date is today or tomorrow | 7 | shared |
| `vpps_app_promise_due_en_v4` | English | same | 7 | shared |
| `vpps_app_exam_clearance_hi_v4` | Hindi | Anything pending on the selected installments, before the examinations | 7 | shared |
| `vpps_app_exam_clearance_en_v4` | English | same | 7 | shared |

All ten are category **UTILITY**, type TEXT, header empty, buttons = **Call
office** `+919352205884` only — matching what actually went Live on 2026-09-04
(the app passes no pay code to AiSensy today, so a dynamic URL button would be
an unfilled variable). Every line states a fact about this family's account or
what to do about it. Nothing is offered, discounted or sold: "the late fee is
not charged if the fees arrive by the date" is a payment term, not a promotion,
and it is worded as one.

### The waiver skeleton

Two of the five do not fit the shared shape. They quote the ledger's late fee
and a date, and have no late-fee *phrase* — the fee is a fact on the account,
not a lever.

| Slot | Contents |
|---|---|
| `{{1}}` | Parent name |
| `{{2}}` | Student name |
| `{{3}}` | Class |
| `{{4}}` | Installment phrase — the installments carrying the late fee, as `late_fee_applied` names them |
| `{{5}}` | **Fees pending** — `pending_amount` on those rows, fees only |
| `{{6}}` | **Late fee on the account** — `late_fee_pending`, read from the ledger |
| `{{7}}` | **The waive-by date** — the office's choice, DD-MM-YYYY |

The two waiver notices share it exactly, as `upcoming` and `upcoming_final`
share theirs, so a test can assert they send identical values with different
wording. The late-fee control on screen is disabled for both (the figure is the
ledger's), and the date guard refuses a date already gone.

### The three on the shared skeleton

| Slot | overdue_final | promise_due | exam_clearance |
|---|---|---|---|
| `{{4}}` | installment phrase — the **passed** installments this family still owes on | **the date the office spoke with the family** (`defaulter_contacts.contacted_at`) | installment phrase — the installments selected on screen |
| `{{5}}` | fees pending on those passed installments | amount pending | fees pending on the selected installments |
| `{{6}}` | the final date | **the date the family gave** — per family, never the run's date | the clear-by date |
| `{{7}}` | the late-fee phrase | the late-fee phrase | the late-fee phrase |

`promise_due` prints no run date at all: slot 6 is each family's own promise,
so the date guard waves it through as it does `late_fee_applied`, and the pay
link expires on the promised date rather than a run-wide one. It is also the
second notice exempt from the promise hold-back — a family inside their promise
window is exactly who it is for.

### The report-card sentence

Three bodies (`waiver_last_call`, `overdue_final`, `exam_clearance`) carry the
school's rule that report cards and examination admit cards are issued only for
accounts with no pending fees. The owner chose it on 2026-09-08. An approved
body cannot be edited, so it has to be true policy on the day it is submitted.

### Bodies to submit

#### `vpps_app_late_fee_waiver_en_v4`

```
*Late Fee Notice — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Fees pending: Rs. {{5}}
Late fee on this account: Rs. {{6}}
Last date without late fee: {{7}}

The late fee shown above will not be charged if the fees pending are received on or before the last date shown. From the day after that date, the fees and the late fee are both payable.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 2` ·
`9,125` · `1,000` · `20-09-2026`

#### `vpps_app_late_fee_waiver_hi_v4`

```
*विलंब शुल्क सूचना — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
शेष फीस: रु. {{5}}
इस खाते पर विलंब शुल्क: रु. {{6}}
बिना विलंब शुल्क की अंतिम तिथि: {{7}}

यदि शेष फीस उपरोक्त अंतिम तिथि तक प्राप्त हो जाती है तो दर्शाया गया विलंब शुल्क नहीं लिया जाएगा। उस तिथि के अगले दिन से फीस और विलंब शुल्क दोनों देय होंगे।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 2` · `9,125` ·
`1,000` · `20-09-2026`

#### `vpps_app_waiver_last_call_en_v4`

```
*Last Date Without Late Fee — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment: {{4}}
Fees pending: Rs. {{5}}
Late fee held back: Rs. {{6}}
Last date: {{7}}

The date above is the last date on which the fees pending can be received without the late fee. From the day after, the late fee shown is added to this account. Report cards and examination admit cards are issued only for accounts with no pending fees.

Settle at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Kindly mention the student's name with the payment and take a receipt. Ignore this message if the amount has already been paid.

To confirm your record, call the office on 9352205884.
```

Samples: as the waiver notice, with `20-09-2026` as the last date.

#### `vpps_app_waiver_last_call_hi_v4`

```
*बिना विलंब शुल्क की अंतिम तिथि — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
किश्त: {{4}}
शेष फीस: रु. {{5}}
रोका गया विलंब शुल्क: रु. {{6}}
अंतिम तिथि: {{7}}

उपरोक्त तिथि शेष फीस को बिना विलंब शुल्क जमा करने की अंतिम तिथि है। उसके अगले दिन से दर्शाया गया विलंब शुल्क इस खाते में जोड़ दिया जाएगा। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है।

फीस काउंटर पर अथवा इस UPI लिंक से निपटान करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान के साथ विद्यार्थी का नाम अवश्य लिखें तथा रसीद लें। राशि जमा हो चुकी हो तो इस संदेश को अनदेखा करें।

अपना रिकॉर्ड जांचने हेतु कार्यालय 9352205884 पर संपर्क करें।
```

#### `vpps_app_overdue_final_en_v4`

```
*Final Fee Notice — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installment overdue: {{4}}
Amount overdue: Rs. {{5}}
Final date: {{6}}
Late fee on this installment: {{7}}

The due date for the installment above has passed and the amount remains unpaid. Please clear it by the final date shown. Report cards and examination admit cards are issued only for accounts with no pending fees.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 2` ·
`9,125` · `20-09-2026` · `Rs. 1,000 per installment`

#### `vpps_app_overdue_final_hi_v4`

```
*अंतिम फीस सूचना — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
बकाया किश्त: {{4}}
बकाया राशि: रु. {{5}}
अंतिम तिथि: {{6}}
इस किश्त पर विलंब शुल्क: {{7}}

उपरोक्त किश्त की देय तिथि निकल चुकी है और राशि अब तक जमा नहीं हुई है। कृपया दर्शाई गई अंतिम तिथि तक जमा करें। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 2` · `9,125` ·
`20-09-2026` · `रु. 1,000 प्रति किश्त`

#### `vpps_app_promise_due_en_v4`

```
*Payment Date Reminder — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Spoken on: {{4}}
Amount pending: Rs. {{5}}
Date agreed: {{6}}
Late fee after the date agreed: {{7}}

Our record shows that on the date above you agreed to pay the amount pending by the date shown. Kindly pay on or before that date.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

If the amount has already been paid, please ignore this message and call the office so the record can be corrected.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `05-09-2026` · `9,125` ·
`10-09-2026` · `Rs. 1,000 per installment`

#### `vpps_app_promise_due_hi_v4`

```
*भुगतान तिथि स्मरण — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
बातचीत की तिथि: {{4}}
शेष राशि: रु. {{5}}
तय की गई तिथि: {{6}}
तय तिथि के बाद विलंब शुल्क: {{7}}

हमारे रिकॉर्ड के अनुसार उपरोक्त बातचीत की तिथि को आपने शेष राशि तय की गई तिथि तक जमा करने की सहमति दी थी। कृपया उस तिथि तक जमा कर दें।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें तथा रिकॉर्ड सुधार हेतु कार्यालय को सूचित करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `05-09-2026` · `9,125` ·
`10-09-2026` · `रु. 1,000 प्रति किश्त`

#### `vpps_app_exam_clearance_en_v4`

```
*Fee Clearance Before Examination — Shri Veer Patta Sr. Sec. School*

Dear {{1}},

Student: {{2}}
Class: {{3}}
Installments pending: {{4}}
Fees pending: Rs. {{5}}
Clear by: {{6}}
Late fee on pending installments: {{7}}

Examinations are approaching. Report cards and examination admit cards are issued only for accounts with no pending fees, so please clear the amount above by the date shown.

Pay at the school fee counter or using this UPI link:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

Please write the student's name with the payment and collect a receipt. If you have already paid, kindly ignore this message.

For any query, call the office on 9352205884.
```

Samples: `Ramesh Lal Gurjar` · `Aaradhya Gurjar` · `2` · `Installment 1 and 2` ·
`9,125` · `15-09-2026` · `Rs. 1,000 per installment`

#### `vpps_app_exam_clearance_hi_v4`

```
*परीक्षा से पूर्व फीस निपटान — श्री वीर पत्ता सी. सै. स्कूल*

प्रिय {{1}},

विद्यार्थी: {{2}}
कक्षा: {{3}}
शेष किश्तें: {{4}}
शेष फीस: रु. {{5}}
निपटान की तिथि: {{6}}
शेष किश्तों पर विलंब शुल्क: {{7}}

परीक्षाएँ निकट हैं। रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है, अतः कृपया उपरोक्त राशि दर्शाई गई तिथि तक जमा करें।

फीस काउंटर पर अथवा इस UPI लिंक से जमा करें:
upi://pay?pa=shriveerpattassecsch.68347408@hdfcbank

भुगतान करते समय विद्यार्थी का नाम अवश्य लिखें तथा रसीद प्राप्त करें। यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।

जानकारी हेतु कार्यालय 9352205884 पर संपर्क करें।
```

Samples: `रमेश लाल गुर्जर` · `आराध्या गुर्जर` · `2` · `किश्त 1 एवं 2` · `9,125` ·
`15-09-2026` · `रु. 1,000 प्रति किश्त`

### Where the bodies live in code

Since 2026-09-08 **no per-student body is in the client bundle.** They all sit
in `src/modules/whatsapp/domain/campaign-bodies.ts`, which no `ui/` or
`src/app` file may import (the same rule as `campaign-bodies-v3.ts`, enforced
by the same test). The send screen's preview was already server-rendered; the
test panel now asks a server action for its preview instead of rendering it in
the browser. That took every existing body out of `/fees/reminders`, which
is what made room for ten more without raising the route's ceiling.

## The two buttons every `_v3` template carries

Slots are unaffected — buttons are configured separately in the AiSensy template
form and do not consume a `{{n}}`.

| Button | Type | Value |
|---|---|---|
| **Pay now** | URL, dynamic | `https://schoolfees-two.vercel.app/pay/{{1}}` |
| **Call office** | Phone number | `+919352205884` |

### Why not the `upi://` link that is already in the body

WhatsApp will not accept `upi://` as a button URL — only `http`/`https`. The raw
link stays in the BODY, where it works on a phone that recognises the scheme and
does nothing at all on one that does not. The button points at `/pay/[code]`,
which builds the same intent and additionally shows the UPI id as selectable
text for a parent whose phone did nothing.

The URL button's variable is its own — numbered from 1 within the button, not
continuing the body's slots. The app fills it with the send row's `pay_code`.

### What is on the other end

`/pay/[code]` shows **an amount, a UPI id, a reference and a date. Nothing
else.** No name, no class, no admission number, no history — deliberately
stricter than `/r/[code]`, which at least confirms a receipt exists. Somebody
who guesses a code learns that somebody owes some money, which is not
information about anybody.

The code is 160 bits from the platform CSPRNG, generated per send, stored in a
partial unique index, and never derived from the student — a code computable
from an admission number would let anyone enumerate what every family owes. It
expires on the notice's own date, because the amount it quotes is what was owed
when the message went out, and a parent paying from a three-week-old link would
pay the wrong figure.

### Counter days and hours

The bodies say to pay "at the school fee counter" without naming its hours,
deliberately. Hours change, a template body cannot be edited once approved
(changing it means a new template name and another review), and a body that
names Monday-Saturday 9-2 becomes wrong the first term that changes and stays
wrong for thirty days after deletion.

The **Call office** button is the answer to "when is it open", and the pay link
works at any hour. If the office later wants hours in the message, they belong
in a slot — not in the fixed text.

## Authoring notes, for whoever adds the eighth

- **The AiSensy body editor auto-pairs braces.** Typing `({{3}})` produces
  `{{{3}}}`, and unmatched brackets are an automatic Meta rejection. Every
  template above is written as a labelled block — `विद्यार्थी: {{2}}` on its own
  line — with no bracket adjacent to a brace. Keep that shape.
- Variables are numbered by order of appearance, and the count must match the
  campaign exactly. Sending the wrong number is rejected with
  `Template params does not match the campaign`.
- Never end the body on a variable — put text after it.
- Meta rejects bodies that near-duplicate an existing approved one, which is why
  the three situations are worded differently rather than parameterised.
- Template Type is TEXT with the header left empty; the title is the first line
  of the body, bolded with asterisks. Interactive Actions: None.
- **Changing the category resets the language and name fields** in the AiSensy
  form. Pick category first.

## What shipped, 22 Aug 2026

- `src/modules/whatsapp/domain/campaigns.ts` maps situation x language onto
  campaign name, one 7-slot skeleton, param builder and preview body.
  `configuredCampaignName()` and `AISENSY_CAMPAIGN` are **gone**, not demoted to
  a fallback: one env var cannot name six campaigns, and a fallback would turn a
  registry miss into a silently wrong template arriving at a parent.
- A notice picker, a language picker and a **late-fee control** (amount + flat /
  per day / per installment), defaulting to the live fee policy and rendered
  into the preview before anything is sent. It WARNS when the phrase contradicts
  what the ledger will charge and sends anyway — the message's late fee is a
  lever for timely payment, not a claim about the ledger, and whether to use it
  is the owner's call.
- Audience rules per situation, sized live on 22 Aug: fee due 146 families,
  balance 171, previous session 51. Two planned templates were cut for having no
  audience at all (EMI: 0 students; left-owing: 2 families).
- The screen moved out of Admin Tools to a top-level **Reminders** section, with
  saved campaigns and per-run outcomes.

All six were confirmed against the live campaigns by posting one param short to
each and reading back `400 Template params does not match the campaign` — which
sends nothing and bills nothing — then one real message per notice to the office
handset.

## The `_v6` set — submitted 2026-10-26

Twenty-four templates, one per notice per language, submitted through the
AiSensy dashboard on 2026-10-26 as UTILITY. The bodies are generated from
`src/modules/whatsapp/domain/campaign-bodies-v6.ts` — that file is the source,
and these are copied from it verbatim.

Three changes from `_v4`, each visible to a parent:

- **The figure is in the first line.** A notification shows the first line or
  two; every earlier body opened with the school's name.
- **One template for one child or several.** `{{2}}` is the students line —
  `Aaradhya Gurjar · Class 2`, or several of those — and the figure is the
  phone's total, so every notice has a family form.
- **A Pay now button.** The URL button's suffix is the send's own `pay_code`.
  AiSensy numbers it `{{6}}` after the five body slots and takes it as the
  **sixth `templateParams` entry**, with no `buttons` key. A five-param send
  with a Meta-style `buttons` entry was refused on 2026-10-26 ("Template params
  does not match the campaign"); six params was delivered with the link intact.
  `aisensyTemplateParams()` in `src/modules/whatsapp/data/aisensy.ts` does the
  folding. `late_fee_applied` has Call office only, so it sends five: its
  headline is fees plus late fee, and the pay page shows fees only.

### The five-slot contracts

| Notice | {{1}} | {{2}} | {{3}} | {{4}} | {{5}} |
|---|---|---|---|---|---|
| fee_due, upcoming, upcoming_final, overdue_final, exam_clearance | fees on the selected tiles (phone total) | students line | installment phrase | the date | late-fee phrase |
| balance | session balance | students line | received so far | next date | late-fee phrase |
| prevyear | carry-forward left | students line | session | settle by | late-fee phrase |
| late_fee_applied | fees + late fee | students line | installment phrase | fees | late fee |
| late_fee_waiver, waiver_last_call | fees | students line | installment phrase | late fee on the account | waive-by date |
| promise_lapsed | amount | students line | date given | new date | late-fee phrase |
| promise_due | amount | students line | spoken on | the family's own date | late-fee phrase |

### Bodies as submitted

#### `vpps_app_upcoming_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_upcoming_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_upcoming_final_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_upcoming_final_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_fee_due_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_fee_due_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_balance_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_balance_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_overdue_final_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_overdue_final_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_late_fee_applied_hi_v6`

```
*विलंब शुल्क लागू: अब रु. {{1}} देय*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{2}}
किश्त: {{3}}
शेष फीस: रु. {{4}}
लागू विलंब शुल्क: रु. {{5}}

उपरोक्त किश्त की अंतिम तिथि निकल चुकी है और दर्शाया गया विलंब शुल्क अब इस खाते में जुड़ गया है। ऊपर की राशि फीस और विलंब शुल्क दोनों मिलाकर है। कृपया शीघ्र स्कूल फीस काउंटर पर जमा करें।

यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें। UPI विवरण के लिए "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `10,125` · `Aaradhya Gurjar · Class 2` · `किश्त 3` · `9,125` · `1,000`

Buttons: **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_late_fee_applied_en_v6`

```
*Late fee applied: Rs. {{1}} now payable*
Shri Veer Patta Sr. Sec. School

For: {{2}}
Installment: {{3}}
Fees pending: Rs. {{4}}
Late fee applied: Rs. {{5}}

The last date for the installment above has passed, and the late fee shown is now on this account. The amount at the top is the fees and the late fee together. Please clear it at the school fee counter at the earliest.

If you have already paid, kindly ignore this message. For UPI details, tap Call office.
```

Samples: `10,125` · `Aaradhya Gurjar · Class 2` · `Installment 3` · `9,125` · `1,000`

Buttons: **Call office** (phone, +91 9352205884)

#### `vpps_app_late_fee_waiver_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_late_fee_waiver_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_waiver_last_call_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_waiver_last_call_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_promise_due_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_promise_due_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_promise_lapsed_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_promise_lapsed_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_exam_clearance_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_exam_clearance_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

#### `vpps_app_prevyear_hi_v6`

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

Buttons: **अभी भुगतान करें** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_app_prevyear_en_v6`

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

Buttons: **Pay now** (URL, dynamic — `https://schoolfees-two.vercel.app/pay/{{6}}` in AiSensy's numbering) · **Call office** (phone, +91 9352205884)

## The school notices — submitted 2026-10-26

Eight templates, `vpps_school_*_v1`, UTILITY, each with a Call office button.
Every one names a child (or, on the closure notice, the household's children)
rather than broadcasting to "all parents", which is the shape Meta re-categorises
as MARKETING. Source: `src/modules/whatsapp/domain/school-notice-bodies.ts`.

#### `vpps_school_absent_hi_v1`

```
*अनुपस्थिति सूचना*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{1}}
कक्षा: {{2}}
तिथि: {{3}}

आपका बच्चा उपरोक्त तिथि को विद्यालय में अनुपस्थित दर्ज किया गया है। यदि यह अपेक्षित नहीं है, या अवकाश की सूचना देनी हो, तो कृपया "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `Aaradhya Gurjar` · `Class 2` · `27-10-2026`

Buttons: **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_school_absent_en_v1`

```
*Absence alert*
Shri Veer Patta Sr. Sec. School

Student: {{1}}
Class: {{2}}
Date: {{3}}

Your ward was marked absent in school on the date above. If this is unexpected, or to inform the school about leave, please tap Call office.
```

Samples: `Aaradhya Gurjar` · `Class 2` · `27-10-2026`

Buttons: **Call office** (phone, +91 9352205884)

#### `vpps_school_exam_schedule_hi_v1`

```
*परीक्षा कार्यक्रम*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{1}}
कक्षा: {{2}}
परीक्षा: {{3}}
प्रारंभ तिथि: {{4}}
उपस्थिति का समय: {{5}}

कृपया सुनिश्चित करें कि आपका बच्चा प्रवेश पत्र और लेखन सामग्री के साथ समय पर विद्यालय पहुँचे। पूरी समय-सारणी कक्षा अध्यापक से प्राप्त की जा सकती है।
```

Samples: `Aaradhya Gurjar` · `Class 2` · `अर्धवार्षिक परीक्षा` · `02-12-2026` · `प्रातः 8:00 बजे`

Buttons: **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_school_exam_schedule_en_v1`

```
*Examination schedule*
Shri Veer Patta Sr. Sec. School

Student: {{1}}
Class: {{2}}
Examination: {{3}}
Starts on: {{4}}
Reporting time: {{5}}

Please make sure your ward reaches school on time with the admit card and stationery. The full timetable is available from the class teacher.
```

Samples: `Aaradhya Gurjar` · `Class 2` · `Half-yearly examination` · `02-12-2026` · `8:00 AM`

Buttons: **Call office** (phone, +91 9352205884)

#### `vpps_school_ptm_hi_v1`

```
*अभिभावक-शिक्षक बैठक*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{1}}
कक्षा: {{2}}
तिथि: {{3}}
समय: {{4}}

आपसे अनुरोध है कि अपने बच्चे की प्रगति पर कक्षा अध्यापक से चर्चा के लिए विद्यालय में अभिभावक-शिक्षक बैठक में अवश्य पधारें।
```

Samples: `Aaradhya Gurjar` · `Class 2` · `14-11-2026` · `प्रातः 10:00 से दोपहर 1:00 बजे`

Buttons: **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_school_ptm_en_v1`

```
*Parent-teacher meeting*
Shri Veer Patta Sr. Sec. School

Student: {{1}}
Class: {{2}}
Date: {{3}}
Time: {{4}}

You are requested to attend the parent-teacher meeting at school to discuss your ward's progress with the class teacher.
```

Samples: `Aaradhya Gurjar` · `Class 2` · `14-11-2026` · `10:00 AM to 1:00 PM`

Buttons: **Call office** (phone, +91 9352205884)

#### `vpps_school_closed_hi_v1`

```
*विद्यालय अवकाश सूचना*
श्री वीर पत्ता सी. सै. स्कूल

विद्यार्थी: {{1}}
अवकाश तिथि: {{2}}
कारण: {{3}}
विद्यालय पुनः खुलने की तिथि: {{4}}

उपरोक्त तिथि को कक्षाएँ नहीं लगेंगी। किसी भी जानकारी हेतु कृपया "कार्यालय को कॉल करें" बटन दबाएँ।
```

Samples: `Aaradhya Gurjar · Class 2` · `09-11-2026` · `दीपावली अवकाश` · `12-11-2026`

Buttons: **कार्यालय को कॉल करें** (phone, +91 9352205884)

#### `vpps_school_closed_en_v1`

```
*School closed notice*
Shri Veer Patta Sr. Sec. School

For: {{1}}
Closed on: {{2}}
Reason: {{3}}
School reopens on: {{4}}

Classes will not be held on the date above. For any query, please tap Call office.
```

Samples: `Aaradhya Gurjar · Class 2` · `09-11-2026` · `Diwali holidays` · `12-11-2026`

Buttons: **Call office** (phone, +91 9352205884)
