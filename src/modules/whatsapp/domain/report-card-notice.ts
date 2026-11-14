import type { TemplateSubmission } from "@/platform/whatsapp/providers";

import { childKey } from "./helper-facts";
import type { StaffLanguage } from "./helper-handoff";
import { helperId } from "./helper-text";

/**
 * "Results are out", the school's approved message to a parent once a
 * child's report card is issued and the exam released (D-614; the owner, 14
 * Nov 2026: "Yes get it for approval").
 *
 * It names one child, their class and the exam, and carries one quick reply,
 * Get report card. The tap says back `vpai:report_card:<child>` (the same id
 * as "Try again" under a card that could not be sent, D-613), so Veer Patta
 * AI answers it as a result ask for that one child: the card as its PDF with
 * its one line, at once, and only if every exam on it is released. A quick
 * reply that comes back without our payload is still read by its words, which
 * are a result ask in either language.
 *
 * The parent's tap opens the 24 hours, so the card itself is an ordinary
 * typed document; only this notice needs Meta's approval. UTILITY, like the
 * school notices: it names a specific child and says something about that
 * child's school year, never a general announcement.
 *
 * Sent under `report_delivery` (Settings → WhatsApp, "Report cards"), so it
 * passes every check a parent message does: the feature switch, real
 * recipients (off means the owner's number only) and practice mode.
 *
 * Pure: the names, the bodies, the blanks and the button.
 */

export const REPORT_CARD_NOTICE_TEMPLATE: Record<StaffLanguage, string> = {
  hi: "vpps_parent_report_card_hi_v1",
  en: "vpps_parent_report_card_en_v1",
};

const SCHOOL_LINE: Record<StaffLanguage, string> = {
  en: "Shri Veer Patta Sr. Sec. School",
  hi: "श्री वीर पत्ता सी. सै. स्कूल",
};

/** The quick reply's words, which a tap that lost its payload is read by. */
export const REPORT_CARD_BUTTON: Record<StaffLanguage, string> = {
  en: "Get report card",
  hi: "रिपोर्ट कार्ड भेजें",
};

const BODY: Record<StaffLanguage, string> = {
  en: [
    "*Examination result*",
    SCHOOL_LINE.en,
    "",
    "Student: {{1}}",
    "Class: {{2}}",
    "Examination: {{3}}",
    "",
    "The result of the examination above has been declared, and your ward's report card is ready. Tap Get report card below and it will be sent to you here as a PDF.",
  ].join("\n"),
  hi: [
    "*परीक्षा परिणाम*",
    SCHOOL_LINE.hi,
    "",
    "विद्यार्थी: {{1}}",
    "कक्षा: {{2}}",
    "परीक्षा: {{3}}",
    "",
    'उपरोक्त परीक्षा का परिणाम घोषित हो गया है और आपके बच्चे का रिपोर्ट कार्ड तैयार है। नीचे "रिपोर्ट कार्ड भेजें" बटन दबाएँ, रिपोर्ट कार्ड PDF के रूप में यहीं भेज दिया जाएगा।',
  ].join("\n"),
};

const SAMPLES: Record<StaffLanguage, readonly string[]> = {
  en: ["Aarav", "Class 6", "Half-yearly examination"],
  hi: ["आरव", "कक्षा 6", "अर्धवार्षिक परीक्षा"],
};

/** How many blanks it fills, for the registry rows and the send check. */
export const REPORT_CARD_NOTICE_PARAMS = 3;

const LANGUAGES: readonly StaffLanguage[] = ["hi", "en"];

/** Never empty, never more than one line: WhatsApp refuses either. */
function blank(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "-";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The three blanks, in order: the child, the class, the exam. */
export function reportCardNoticeParams(input: { studentName: string; className: string; exam: string }): string[] {
  return [blank(input.studentName, 60), blank(input.className, 40), blank(input.exam, 60)];
}

/** The one quick reply's payload: this child's report card, as "Try again" asks for it. */
export function reportCardNoticePayloads(studentId: string): string[] {
  return [helperId("report_card", childKey(studentId))];
}

/** Hindi and English, as the hub's `POST /v1/templates` takes them. */
export const REPORT_CARD_NOTICE_HUB_SUBMISSIONS: readonly TemplateSubmission[] = LANGUAGES.map((language) => ({
  name: REPORT_CARD_NOTICE_TEMPLATE[language],
  language,
  category: "UTILITY" as const,
  body: BODY[language],
  examples: [...SAMPLES[language]],
  buttons: [{ type: "QUICK_REPLY" as const, text: REPORT_CARD_BUTTON[language] }],
}));

/**
 * Which copy a family gets (D-615): English for a family that writes
 * English, Hindi for everyone else. A family writing Hinglish reads Hindi,
 * only typed in Roman letters; there is no Roman-letter copy at Meta.
 */
export function reportCardNoticeLanguage(chatLanguage: string | null | undefined): StaffLanguage {
  return chatLanguage === "en" ? "en" : "hi";
}

/** The notice as the parent sees it, blanks filled, for the office's preview (D-615). */
export function reportCardNoticeText(language: StaffLanguage, params: readonly string[]): string {
  return BODY[language].replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "-");
}

/**
 * The idempotency key of one notice (D-615): one child, one term, one issued
 * revision, one number. Pressing "Tell parents" twice tells nobody twice; a
 * card reissued after a correction may be told again.
 */
export function reportCardNoticeKey(input: { studentId: string; term: string; revision: number; to: string }): string {
  return `results-out:${input.studentId}:${input.term.replace(/\s+/g, "_").slice(0, 24)}:${input.revision}:${input.to}`;
}
