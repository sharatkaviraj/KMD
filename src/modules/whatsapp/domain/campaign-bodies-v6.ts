import { formatRupeesPlain } from "@/platform/helpers/currency";
import {
  ledgerLateFeePhrase,
  scopePhrase,
  type CampaignDescriptor,
  type NoticeLanguage,
  type NoticeSituation,
  type NoticeValues,
} from "@/modules/whatsapp/domain/campaigns";
import type { LateFeeBasis, LateFeeSource } from "@/modules/whatsapp/domain/late-fee";
import {
  APPROVED_V6,
  APPROVED_V7,
  V7_SITUATIONS,
  v6CampaignName,
  v7CampaignName,
} from "@/modules/whatsapp/domain/campaign-generation";

/**
 * The `_v6` fee notices: amount first, one message per phone, and a Pay now
 * button.
 *
 * Three things changed from `_v4`, each for a reason the office can see:
 *
 * - **The figure is in the first line.** A WhatsApp notification shows the
 *   first line or two of the body. Every earlier template opened with the
 *   school's name, so a parent's lock screen said "Fee Notice — Shri Veer
 *   Patta…" and nothing about money. Now it says "Fee due: Rs. 9,125".
 * - **One template serves one child or several.** `{{2}}` is the students line
 *   — "Aaradhya Gurjar · Class 2", or "Aaradhya Gurjar · Class 2, Bhavya
 *   Gurjar · Class 5" — and the figure is the phone's total. So every one of
 *   the twelve notices now has a family form, which `_v4` never had: a sibling
 *   phone on a waiver or a final notice used to get one child's balance as if
 *   it were the whole debt.
 * - **A Pay now button.** `/pay/[code]` has been minted on every send since
 *   September and nothing linked to it. The button's URL suffix is the send's
 *   own pay code, so the page shows exactly what this message asked for, and
 *   it expires on the message's own date.
 *
 * `late_fee_applied` is the one without Pay now. Its headline is fees PLUS the
 * late fee, and the pay page shows the send's `due_amount`, which is fees only
 * — a late fee is never folded into a fees figure. A button that opened on a
 * different number from the message above it would be worse than none.
 *
 * Nothing here is sold or offered, so every one stays UTILITY: "the late fee is
 * not charged if paid by" is a payment term, worded as one.
 *
 * Every descriptor is `approved: false` until Meta approves the template AND
 * its AiSensy API campaign is Live; until then `activeCampaignFor` hands out the
 * approved `_v2`–`_v4` campaign exactly as before, so this file changes nothing
 * a parent receives until the switch is flipped.
 *
 * BODIES live here, so — like `campaign-bodies.ts` and `campaign-bodies-v3.ts`
 * — no `ui/` or client file may import this module. Only the server renders a
 * v6 preview or sends one.
 */

/** A body button, in the order Meta shows them. */
export type V6Button = "pay_url" | "call_office";

export type V6Descriptor = CampaignDescriptor & {
  /** `v7` is the same template with One's Pay now host (see `V7_CAMPAIGNS`). */
  generation: "v6" | "v7";
  /** Exactly as submitted, `{{n}}` placeholders and all. */
  body: string;
  buttons: readonly V6Button[];
  /** The values typed into AiSensy's sample boxes, in slot order. */
  metaSamples: readonly string[];
  /**
   * The slots for a phone carrying one OR MORE children, spokesperson first.
   * `buildParams` is this with one child.
   */
  buildFamilyParams(members: readonly NoticeValues[], context: V6Context): string[];
};

/** What a family message needs from the run that a child's values do not carry. */
export type V6Context = {
  lateFeeSource: LateFeeSource;
  policyLateFeeAmount: number;
  lateFeeAmount: number;
  lateFeeBasis: LateFeeBasis;
  /** The Last-year tile is on: the amount carries last session's balance. */
  lastYear?: boolean;
};

export const OFFICE_PHONE = "+919352205884";
/**
 * Where a `_v7` Pay now button opens: the URL submitted to Meta, with the
 * send's pay code as its `{{1}}` suffix. The `_v6` buttons open the fees
 * app's host, fixed by Meta, which is why VPPS One never sends `_v6`
 * (go-live plan §6.2, critique0 #31).
 */
export const PAY_URL_PREFIX = "https://one.vpps.co.in/pay/";

export const V6_BUTTON_LABELS: Record<NoticeLanguage, Record<V6Button, string>> = {
  en: { pay_url: "Pay now", call_office: "Call office" },
  hi: { pay_url: "अभी भुगतान करें", call_office: "कार्यालय को कॉल करें" },
};

const SCHOOL_LINE: Record<NoticeLanguage, string> = {
  en: "Shri Veer Patta Sr. Sec. School",
  hi: "श्री वीर पत्ता सी. सै. स्कूल",
};

/* --------------------------------------------------------------- the slots */

const SLOTS_SHARED = ["amount", "students", "context", "date", "lateFeePhrase"] as const;
const SLOTS_BALANCE = ["balance", "students", "receivedSoFar", "date", "lateFeePhrase"] as const;
const SLOTS_PREVYEAR = ["balance", "students", "session", "date", "lateFeePhrase"] as const;
const SLOTS_APPLIED = ["total", "students", "context", "feesPending", "lateFeeApplied"] as const;
const SLOTS_WAIVER = ["feesPending", "students", "context", "lateFeeApplied", "date"] as const;
const SLOTS_PROMISE_LAPSED = ["amount", "students", "promisedDate", "date", "lateFeePhrase"] as const;
const SLOTS_PROMISE_DUE = ["amount", "students", "spokenOn", "date", "lateFeePhrase"] as const;

/**
 * "Aaradhya Gurjar · Class 2", or several of those joined with commas.
 *
 * The class label goes through untouched ("Class 2", "Nursery", "11 Science")
 * because it is a data value the office reads on every other screen, and the
 * line is the same in a Hindi message — the student names are recorded in
 * English either way.
 */
export function studentsLine(members: readonly Pick<NoticeValues, "studentName" | "studentClass">[]): string {
  return members
    .map((member) => {
      const name = String(member.studentName ?? "").trim();
      const label = String(member.studentClass ?? "").trim();
      return label ? `${name} · ${label}` : name;
    })
    .filter(Boolean)
    .join(", ");
}

function money(value: number): string {
  // `formatRupeesPlain` is the one place a rupee figure is rounded.
  return formatRupeesPlain(Math.max(0, value));
}

function sum(members: readonly NoticeValues[], key: keyof NoticeValues): number {
  return members.reduce((total, member) => total + Number(member[key] ?? 0), 0);
}

/** Never empty — WhatsApp refuses an empty parameter. Same fallback as `_v2`. */
function phraseOrFallback(phrase: string | undefined, language: NoticeLanguage): string {
  const text = String(phrase ?? "").trim();
  if (text) return text;
  return language === "hi" ? "इस राशि पर लागू नहीं" : "Not applicable on this amount";
}

/**
 * The late-fee phrase for a whole phone.
 *
 * One child: their own phrase, already composed by `noticeValuesFrom`. Several
 * children in `custom` mode: the typed lever, the same for each. Several in
 * `ledger` mode: the ledger's own figure across them — what the school is
 * actually charging that household — or the policy rate when nothing has
 * accrued, through the same `ledgerLateFeePhrase` the per-child path uses.
 */
function familyLateFeePhrase(
  situation: NoticeSituation,
  language: NoticeLanguage,
  members: readonly NoticeValues[],
  context: V6Context,
): string {
  const first = members[0];
  if (members.length <= 1 || context.lateFeeSource === "custom") {
    return phraseOrFallback(first?.lateFeePhrase, language);
  }
  return phraseOrFallback(
    ledgerLateFeePhrase({
      situation,
      language,
      charged: sum(members, "lateFeeApplied"),
      policyLateFeeAmount: context.policyLateFeeAmount,
      fallbackAmount: context.lateFeeAmount,
      fallbackBasis: context.lateFeeBasis,
    }),
    language,
  );
}

/**
 * The figure slot 1 prints, as a number.
 *
 * The send row's `due_amount` and the Pay now scope read THIS, never the
 * rendered slot: a parsed string is one locale change away from a different
 * number, and the pay page must open on exactly what the message said.
 * `paramsFor` formats the same value, so the two cannot disagree.
 */
export function v6HeadlineAmount(
  situation: NoticeSituation,
  members: readonly NoticeValues[],
): number {
  switch (situation) {
    case "balance":
      return sum(members, "balanceDue");
    case "prevyear":
      return sum(members, "prevYearBalance");
    case "late_fee_applied":
      return sum(members, "amountDue") + sum(members, "lateFeeApplied");
    default:
      return sum(members, "amountDue");
  }
}

function paramsFor(
  situation: NoticeSituation,
  language: NoticeLanguage,
  members: readonly NoticeValues[],
  context: V6Context,
): string[] {
  const first = members[0];
  if (!first) return [];
  const line = studentsLine(members);
  const phrase = familyLateFeePhrase(situation, language, members, context);
  // Every installment any child on this phone owes, named once — and last
  // session's balance, once, when the run includes it and any child carries
  // one. It was the first child's line alone, so a sibling behind on an
  // earlier installment (or still owing from last year) went unnamed beside a
  // total that included it. One child: their own line, already composed.
  const owesPrev = (member: NoticeValues) =>
    context.lastYear === true && Number(member.prevYearBalance ?? 0) > 0;
  const installments =
    members.length > 1 &&
    members.every((member) => member.owedInstallments?.length || owesPrev(member))
      ? scopePhrase({
          installments: [...new Set(members.flatMap((member) => member.owedInstallments ?? []))],
          includesPrevYear: members.some(owesPrev),
          prevSessionLabel: members.find(owesPrev)?.prevSessionLabel ?? null,
          language,
        })
      : (first.installmentPhrase ?? "");
  const fees = sum(members, "amountDue");
  const headline = money(v6HeadlineAmount(situation, members));

  switch (situation) {
    case "balance":
      return [headline, line, money(sum(members, "receivedSoFar")), first.lastDate ?? "", phrase];
    case "prevyear":
      return [headline, line, first.prevSessionLabel ?? "", first.lastDate ?? "", phrase];
    case "late_fee_applied": {
      const lateFee = sum(members, "lateFeeApplied");
      // The headline is DERIVED from the two figures printed under it, never
      // read from a stored total, so the three lines a parent reads add up.
      return [headline, line, installments, money(fees), money(lateFee)];
    }
    case "late_fee_waiver":
    case "waiver_last_call":
      return [headline, line, installments, money(sum(members, "lateFeeApplied")), first.lastDate ?? ""];
    case "promise_lapsed":
      return [headline, line, first.promisedDate ?? "", first.lastDate ?? "", phrase];
    case "promise_due":
      // `lastDate` IS the family's own promised date on this notice — see
      // `noticeValuesFrom`.
      return [headline, line, first.promiseRecordedDate ?? "", first.lastDate ?? "", phrase];
    default:
      return [headline, line, installments, first.lastDate ?? "", phrase];
  }
}

/* -------------------------------------------------------------- the bodies */

type BodyParts = {
  title: Record<NoticeLanguage, string>;
  lines: Record<NoticeLanguage, readonly string[]>;
  text: Record<NoticeLanguage, readonly string[]>;
};

const PAY_EN = "Tap Pay now to pay by UPI, or pay at the school fee counter and collect a receipt.";
const PAY_HI = 'UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या स्कूल फीस काउंटर पर जमा कर रसीद लें।';
const IGNORE_EN = "If you have already paid, kindly ignore this message.";
const IGNORE_HI = "यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें।";
const REPORT_CARD_EN =
  "Report cards and examination admit cards are issued only for accounts with no pending fees.";
const REPORT_CARD_HI =
  "रिपोर्ट कार्ड एवं परीक्षा प्रवेश पत्र केवल उन्हीं विद्यार्थियों को दिए जाते हैं जिनकी कोई फीस बकाया नहीं है।";

/* Each body: a bold title carrying {{1}}, the school, the labelled slots,
   then the sentences. Labelled lines on their own, never a bracket beside a
   brace — the AiSensy editor auto-pairs braces and Meta rejects unmatched
   brackets. Never ends on a variable. */
const BODIES: Record<NoticeSituation, BodyParts> = {
  fee_due: {
    title: { en: "Fee due: Rs. {{1}}", hi: "फीस देय: रु. {{1}}" },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Last date: {{4}}", "Late fee after the last date: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "अंतिम तिथि: {{4}}", "अंतिम तिथि के बाद विलंब शुल्क: {{5}}"],
    },
    text: {
      en: ["Paying on or before the last date avoids the late fee. " + PAY_EN, IGNORE_EN],
      hi: ["अंतिम तिथि तक भुगतान करने पर विलंब शुल्क नहीं लगेगा। " + PAY_HI, IGNORE_HI],
    },
  },
  balance: {
    title: { en: "Fee balance: Rs. {{1}}", hi: "शेष फीस: रु. {{1}}" },
    lines: {
      en: ["For: {{2}}", "Received so far: Rs. {{3}}", "Next date: {{4}}", "Late fee after the next date: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "अब तक प्राप्त: रु. {{3}}", "अगली तिथि: {{4}}", "अगली तिथि के बाद विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "Thank you for the payment received. Clearing the balance by the next date avoids the late fee. Tap Pay now to pay the balance by UPI, or visit the fee counter.",
        "If this differs from your own record, tap Call office.",
      ],
      hi: [
        'प्राप्त भुगतान के लिए धन्यवाद। अगली तिथि तक शेष राशि जमा करने पर विलंब शुल्क नहीं लगेगा। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।',
        'यदि यह आपके रिकॉर्ड से अलग है तो "कार्यालय को कॉल करें" बटन दबाएँ।',
      ],
    },
  },
  prevyear: {
    title: { en: "Previous session balance: Rs. {{1}}", hi: "पिछले सत्र की शेष राशि: रु. {{1}}" },
    lines: {
      en: ["For: {{2}}", "Session: {{3}}", "Settle by: {{4}}", "Late fee: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "सत्र: {{3}}", "जमा करने की तिथि: {{4}}", "विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "This amount is from the previous session and is separate from this year's installments. Tap Pay now to settle it by UPI, or visit the fee counter.",
        "For a full statement, tap Call office.",
      ],
      hi: [
        'यह राशि पिछले सत्र की है और इस वर्ष की किश्तों से अलग है। UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।',
        'पूरे विवरण के लिए "कार्यालय को कॉल करें" बटन दबाएँ।',
      ],
    },
  },
  upcoming: {
    title: { en: "Fee reminder: Rs. {{1}} due soon", hi: "फीस स्मरण: रु. {{1}} जल्द देय" },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Last date: {{4}}", "Late fee after the last date: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "अंतिम तिथि: {{4}}", "अंतिम तिथि के बाद विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "The installment above falls due shortly. Tap Pay now to pay by UPI before the last date, or pay at the school fee counter.",
        IGNORE_EN,
      ],
      hi: [
        'उपरोक्त किश्त जल्द देय है। अंतिम तिथि से पहले UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या स्कूल फीस काउंटर पर जमा करें।',
        IGNORE_HI,
      ],
    },
  },
  upcoming_final: {
    title: { en: "Last few days: Rs. {{1}} payable", hi: "कुछ ही दिन शेष: रु. {{1}} देय" },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Last date: {{4}}", "Late fee from the day after: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "अंतिम तिथि: {{4}}", "अगले दिन से विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "Only a few days remain. From the day after the last date, the late fee is added to this account. Tap Pay now to settle by UPI, or visit the fee counter.",
        "Ignore this message if the amount has already been paid.",
      ],
      hi: [
        'अब कुछ ही दिन शेष हैं। अंतिम तिथि के अगले दिन से इस खाते में विलंब शुल्क जुड़ जाएगा। UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।',
        "यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें।",
      ],
    },
  },
  late_fee_applied: {
    title: { en: "Late fee applied: Rs. {{1}} now payable", hi: "विलंब शुल्क लागू: अब रु. {{1}} देय" },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Fees pending: Rs. {{4}}", "Late fee applied: Rs. {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "शेष फीस: रु. {{4}}", "लागू विलंब शुल्क: रु. {{5}}"],
    },
    text: {
      en: [
        "The last date for the installment above has passed, and the late fee shown is now on this account. The amount at the top is the fees and the late fee together. Please clear it at the school fee counter at the earliest.",
        "If you have already paid, kindly ignore this message. For UPI details, tap Call office.",
      ],
      hi: [
        "उपरोक्त किश्त की अंतिम तिथि निकल चुकी है और दर्शाया गया विलंब शुल्क अब इस खाते में जुड़ गया है। ऊपर की राशि फीस और विलंब शुल्क दोनों मिलाकर है। कृपया शीघ्र स्कूल फीस काउंटर पर जमा करें।",
        'यदि भुगतान हो चुका है तो इस संदेश को अनदेखा करें। UPI विवरण के लिए "कार्यालय को कॉल करें" बटन दबाएँ।',
      ],
    },
  },
  promise_lapsed: {
    title: { en: "Payment follow-up: Rs. {{1}} pending", hi: "भुगतान अनुस्मरण: रु. {{1}} शेष" },
    lines: {
      en: ["For: {{2}}", "Date given: {{3}}", "New date: {{4}}", "Late fee after the new date: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "दी गई तिथि: {{3}}", "नई तिथि: {{4}}", "नई तिथि के बाद विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "Our record shows this payment was expected by the date given and has not reached us. Kindly pay by the new date. Tap Pay now to pay by UPI.",
        "If you have already paid, tap Call office so the record can be corrected.",
      ],
      hi: [
        'हमारे रिकॉर्ड के अनुसार यह भुगतान दी गई तिथि तक अपेक्षित था और अब तक प्राप्त नहीं हुआ है। कृपया नई तिथि तक जमा करें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ।',
        'यदि भुगतान हो चुका है तो रिकॉर्ड सुधार हेतु "कार्यालय को कॉल करें" बटन दबाएँ।',
      ],
    },
  },
  late_fee_waiver: {
    title: { en: "Late fee notice: Rs. {{1}} fees pending", hi: "विलंब शुल्क सूचना: रु. {{1}} फीस शेष" },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Late fee on this account: Rs. {{4}}", "Last date without late fee: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "इस खाते पर विलंब शुल्क: रु. {{4}}", "बिना विलंब शुल्क की अंतिम तिथि: {{5}}"],
    },
    text: {
      en: [
        "The late fee shown will not be charged if the fees pending are received on or before the last date. From the day after, the fees and the late fee are both payable. Tap Pay now to pay by UPI, or visit the fee counter.",
        IGNORE_EN,
      ],
      hi: [
        'यदि शेष फीस अंतिम तिथि तक प्राप्त हो जाती है तो दर्शाया गया विलंब शुल्क नहीं लिया जाएगा। उस तिथि के अगले दिन से फीस और विलंब शुल्क दोनों देय होंगे। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।',
        IGNORE_HI,
      ],
    },
  },
  waiver_last_call: {
    title: {
      en: "Last date without late fee: Rs. {{1}} pending",
      hi: "बिना विलंब शुल्क की अंतिम तिथि: रु. {{1}} शेष",
    },
    lines: {
      en: ["For: {{2}}", "Installment: {{3}}", "Late fee held back: Rs. {{4}}", "Last date: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "किश्त: {{3}}", "रोका गया विलंब शुल्क: रु. {{4}}", "अंतिम तिथि: {{5}}"],
    },
    text: {
      en: [
        `This is the last date on which the fees pending can be received without the late fee. From the day after, the late fee shown is added to this account. ${REPORT_CARD_EN} Tap Pay now to settle by UPI.`,
        "Ignore this message if the amount has already been paid.",
      ],
      hi: [
        `यह वह अंतिम तिथि है जिस तक शेष फीस बिना विलंब शुल्क के जमा की जा सकती है। अगले दिन से दर्शाया गया विलंब शुल्क इस खाते में जुड़ जाएगा। ${REPORT_CARD_HI} UPI से जमा करने के लिए "अभी भुगतान करें" बटन दबाएँ।`,
        "यदि राशि जमा हो चुकी है तो इस संदेश को अनदेखा करें।",
      ],
    },
  },
  overdue_final: {
    title: { en: "Final fee notice: Rs. {{1}} overdue", hi: "अंतिम फीस सूचना: रु. {{1}} बकाया" },
    lines: {
      en: ["For: {{2}}", "Installment overdue: {{3}}", "Final date: {{4}}", "Late fee on this installment: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "बकाया किश्त: {{3}}", "अंतिम तिथि: {{4}}", "इस किश्त पर विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        `The due date for the installment above has passed and the amount remains unpaid. Please clear it by the final date. ${REPORT_CARD_EN} Tap Pay now to pay by UPI, or visit the fee counter.`,
        IGNORE_EN,
      ],
      hi: [
        `उपरोक्त किश्त की देय तिथि निकल चुकी है और राशि अब तक जमा नहीं हुई है। कृपया अंतिम तिथि तक जमा करें। ${REPORT_CARD_HI} UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।`,
        IGNORE_HI,
      ],
    },
  },
  promise_due: {
    title: { en: "Payment date reminder: Rs. {{1}}", hi: "भुगतान तिथि स्मरण: रु. {{1}}" },
    lines: {
      en: ["For: {{2}}", "Spoken on: {{3}}", "Date agreed: {{4}}", "Late fee after the date agreed: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "बातचीत की तिथि: {{3}}", "तय की गई तिथि: {{4}}", "तय तिथि के बाद विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        "On the date above you agreed to pay the amount by the date shown. Kindly pay on or before that date. Tap Pay now to pay by UPI.",
        "If the amount has already been paid, tap Call office so the record can be corrected.",
      ],
      hi: [
        'उपरोक्त बातचीत की तिथि को आपने यह राशि तय की गई तिथि तक जमा करने की सहमति दी थी। कृपया उस तिथि तक जमा कर दें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ।',
        'यदि राशि जमा हो चुकी है तो रिकॉर्ड सुधार हेतु "कार्यालय को कॉल करें" बटन दबाएँ।',
      ],
    },
  },
  exam_clearance: {
    title: { en: "Clear fees before exams: Rs. {{1}} pending", hi: "परीक्षा से पहले फीस जमा करें: रु. {{1}} शेष" },
    lines: {
      en: ["For: {{2}}", "Installments pending: {{3}}", "Clear by: {{4}}", "Late fee on pending installments: {{5}}"],
      hi: ["विद्यार्थी: {{2}}", "शेष किश्तें: {{3}}", "जमा करने की तिथि: {{4}}", "शेष किश्तों पर विलंब शुल्क: {{5}}"],
    },
    text: {
      en: [
        `Examinations are approaching. ${REPORT_CARD_EN} Please clear the amount by the date shown. Tap Pay now to pay by UPI, or visit the fee counter.`,
        IGNORE_EN,
      ],
      hi: [
        `परीक्षाएँ निकट हैं। ${REPORT_CARD_HI} कृपया उपरोक्त राशि दर्शाई गई तिथि तक जमा करें। UPI से भुगतान के लिए "अभी भुगतान करें" बटन दबाएँ, या फीस काउंटर पर आएँ।`,
        IGNORE_HI,
      ],
    },
  },
};

function composeBody(parts: BodyParts, language: NoticeLanguage): string {
  return [
    `*${parts.title[language]}*`,
    SCHOOL_LINE[language],
    "",
    ...parts.lines[language],
    "",
    ...parts.text[language].flatMap((paragraph, index) => (index === 0 ? [paragraph] : ["", paragraph])),
  ].join("\n");
}

/** The body as a parent reads it, every `{{n}}` filled. */
export function fillBody(body: string, params: readonly string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => params[Number(index) - 1] ?? "");
}

/* ------------------------------------------------------------- the samples */

/* What is typed into AiSensy's sample boxes, slot by slot. The figures add
   up the way a reviewer reads them as one account. */
const SAMPLE_STUDENT = "Aaradhya Gurjar · Class 2";
const SAMPLE_FEE = { en: "Rs. 1,000 per installment", hi: "रु. 1,000 प्रति किश्त" }; // @allow-raw-money-format: the literal sample submitted to Meta
const SAMPLE_NONE = { en: "Not applicable on this amount", hi: "इस राशि पर लागू नहीं" };
const SAMPLE_INST = { en: "Installment 3", hi: "किश्त 3" };

const META_SAMPLES: Record<NoticeSituation, Record<NoticeLanguage, readonly string[]>> = {
  fee_due: {
    en: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.en, "20-10-2026", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.hi, "20-10-2026", SAMPLE_FEE.hi],
  },
  balance: {
    en: ["11,750", SAMPLE_STUDENT, "6,500", "20-10-2026", SAMPLE_FEE.en],
    hi: ["11,750", SAMPLE_STUDENT, "6,500", "20-10-2026", SAMPLE_FEE.hi],
  },
  prevyear: {
    en: ["20,000", SAMPLE_STUDENT, "2025-26", "30-11-2026", SAMPLE_NONE.en],
    hi: ["20,000", SAMPLE_STUDENT, "2025-26", "30-11-2026", SAMPLE_NONE.hi],
  },
  upcoming: {
    en: ["9,125", SAMPLE_STUDENT, "Installment 4", "20-01-2027", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, "किश्त 4", "20-01-2027", SAMPLE_FEE.hi],
  },
  upcoming_final: {
    en: ["9,125", SAMPLE_STUDENT, "Installment 4", "20-01-2027", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, "किश्त 4", "20-01-2027", SAMPLE_FEE.hi],
  },
  late_fee_applied: {
    en: ["10,125", SAMPLE_STUDENT, SAMPLE_INST.en, "9,125", "1,000"],
    hi: ["10,125", SAMPLE_STUDENT, SAMPLE_INST.hi, "9,125", "1,000"],
  },
  promise_lapsed: {
    en: ["9,125", SAMPLE_STUDENT, "28-10-2026", "05-11-2026", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, "28-10-2026", "05-11-2026", SAMPLE_FEE.hi],
  },
  late_fee_waiver: {
    en: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.en, "1,000", "30-10-2026"],
    hi: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.hi, "1,000", "30-10-2026"],
  },
  waiver_last_call: {
    en: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.en, "1,000", "30-10-2026"],
    hi: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.hi, "1,000", "30-10-2026"],
  },
  overdue_final: {
    en: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.en, "10-11-2026", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, SAMPLE_INST.hi, "10-11-2026", SAMPLE_FEE.hi],
  },
  promise_due: {
    en: ["9,125", SAMPLE_STUDENT, "26-10-2026", "31-10-2026", SAMPLE_FEE.en],
    hi: ["9,125", SAMPLE_STUDENT, "26-10-2026", "31-10-2026", SAMPLE_FEE.hi],
  },
  exam_clearance: {
    en: ["18,250", SAMPLE_STUDENT, "Installment 3 and 4", "15-02-2027", SAMPLE_FEE.en],
    hi: ["18,250", SAMPLE_STUDENT, "किश्त 3 एवं 4", "15-02-2027", SAMPLE_FEE.hi],
  },
};

const SLOTS: Record<NoticeSituation, readonly string[]> = {
  fee_due: SLOTS_SHARED,
  balance: SLOTS_BALANCE,
  prevyear: SLOTS_PREVYEAR,
  upcoming: SLOTS_SHARED,
  upcoming_final: SLOTS_SHARED,
  late_fee_applied: SLOTS_APPLIED,
  promise_lapsed: SLOTS_PROMISE_LAPSED,
  late_fee_waiver: SLOTS_WAIVER,
  waiver_last_call: SLOTS_WAIVER,
  overdue_final: SLOTS_SHARED,
  promise_due: SLOTS_PROMISE_DUE,
  exam_clearance: SLOTS_SHARED,
};

/** Re-exported for callers that already hold the bodies; the switch itself is in `campaign-generation`. */
export { APPROVED_V6 };

const SITUATION_ORDER: readonly NoticeSituation[] = [
  "upcoming",
  "upcoming_final",
  "fee_due",
  "balance",
  "overdue_final",
  "late_fee_applied",
  "late_fee_waiver",
  "waiver_last_call",
  "promise_due",
  "promise_lapsed",
  "exam_clearance",
  "prevyear",
];

/** The default run context for a single child, where no family phrase is needed. */
const SINGLE_CHILD_CONTEXT: V6Context = {
  lateFeeSource: "custom",
  policyLateFeeAmount: 0,
  lateFeeAmount: 0,
  lateFeeBasis: "per_installment",
};

export const V6_CAMPAIGNS: readonly V6Descriptor[] = SITUATION_ORDER.flatMap((situation) =>
  (["hi", "en"] as const).map((language): V6Descriptor => {
    const campaignName = v6CampaignName(situation, language);
    return {
      generation: "v6",
      situation,
      language,
      campaignName,
      slotOrder: SLOTS[situation],
      body: composeBody(BODIES[situation], language),
      buttons: situation === "late_fee_applied" ? ["call_office"] : ["pay_url", "call_office"],
      metaSamples: META_SAMPLES[situation][language],
      // One child: their own composed phrase is already right, so the run
      // context is not consulted.
      buildParams: (values) => paramsFor(situation, language, [values], SINGLE_CHILD_CONTEXT),
      buildFamilyParams: (members, context) => paramsFor(situation, language, members, context),
      sample: {
        parentName: "Ramesh Lal Gurjar",
        studentName: "Aaradhya Gurjar",
        studentClass: "Class 2",
      },
      approved: APPROVED_V6.has(campaignName),
      audience: "family",
    };
  }),
);

/**
 * The `_v7` notices: every `_v6` one that carries Pay now, unchanged — the
 * same body, slot order, samples and buttons — under a `_v7` name, approved
 * only when `APPROVED_V7` lists it. `late_fee_applied` has no Pay now and so
 * no `_v7`. tests/fees/unit/whatsapp-campaigns-v7.test.ts holds the two
 * generations to the same layout, param for param.
 */
export const V7_CAMPAIGNS: readonly V6Descriptor[] = V6_CAMPAIGNS.filter((entry) =>
  V7_SITUATIONS.includes(entry.situation),
).map((entry): V6Descriptor => {
  const campaignName = v7CampaignName(entry.situation, entry.language);
  return { ...entry, generation: "v7", campaignName, approved: APPROVED_V7.has(campaignName) };
});

export function describeV7Campaign(
  situation: NoticeSituation,
  language: NoticeLanguage,
): V6Descriptor | null {
  return (
    V7_CAMPAIGNS.find((entry) => entry.situation === situation && entry.language === language) ??
    null
  );
}

export function describeV6Campaign(
  situation: NoticeSituation,
  language: NoticeLanguage,
): V6Descriptor | null {
  return (
    V6_CAMPAIGNS.find((entry) => entry.situation === situation && entry.language === language) ??
    null
  );
}

/** Does this campaign name carry the Pay now button? Only `_v6` and `_v7` ones do. */
export function hasPayNowButton(campaignName: string): boolean {
  return Boolean(
    [...V6_CAMPAIGNS, ...V7_CAMPAIGNS]
      .find((entry) => entry.campaignName === campaignName)
      ?.buttons.includes("pay_url"),
  );
}

/**
 * The Pay now template this notice goes out under in VPPS One — the `_v7`
 * one, once it is approved and Live — or null, and then the earlier text-only
 * generation goes instead.
 *
 * Named as in the fees app, so its callers (the run sender, the test send, the
 * screen's preview) read exactly as there; in the fees app it hands out
 * `_v6`, which One never sends (plan §6.2). A `_v6` descriptor is never
 * returned here, whatever `APPROVED_V6` says.
 */
export function approvedV6Campaign(
  situation: NoticeSituation,
  language: NoticeLanguage,
): V6Descriptor | null {
  const found = describeV7Campaign(situation, language);
  return found?.approved ? found : null;
}

export { activeCampaignName, activeCampaignNameOrNull } from "@/modules/whatsapp/domain/campaign-generation";
