/**
 * Why a reminder did not reach a family, in the office's terms.
 *
 * AiSensy answers in three dialects: its own API errors ("Template params does
 * not match the campaign"), WhatsApp's numeric codes passed through (131026,
 * 131049 …), and whatever the report CSV's "reason" column says that week. The
 * office needs none of that. It needs to know whether the problem is the
 * family's number, the template, the account or the network — because each has
 * a different fix, and only some of them are fixed by pressing Resend.
 *
 * ONE rule, used by the sender, the report import and the webhook, so a failure
 * learned three different ways is still one cause. Pure and browser-safe: the
 * failure desk renders the labels, and the number sheet's warnings read
 * `isDeadNumberCause`.
 *
 * Order matters, and the trap is the same one `delivery-report.ts` documents:
 * a sentence can contain more than one keyword. "Invalid template parameter"
 * mentions neither a phone nor WhatsApp, but "Message undeliverable: invalid
 * WhatsApp number" mentions both "invalid" and "number" — the specific causes
 * are tested before the general ones.
 */

/** What a failure is, once read. Stored in `whatsapp_reminder_sends.failure_cause`. */
export type FailureCause =
  | "invalid_number"
  | "not_on_whatsapp"
  | "opted_out"
  | "whatsapp_limit"
  | "template"
  | "account"
  | "network"
  | "media"
  | "unknown";

/**
 * Every lane the failure desk shows. The stored causes, plus three states that
 * are facts about a family rather than about a provider answer.
 */
export type ProblemCause = FailureCause | "no_number" | "stuck" | "left_out";

export const FAILURE_CAUSES: readonly FailureCause[] = [
  "invalid_number",
  "not_on_whatsapp",
  "opted_out",
  "whatsapp_limit",
  "template",
  "account",
  "network",
  "media",
  "unknown",
];

export function isFailureCause(value: unknown): value is FailureCause {
  return typeof value === "string" && (FAILURE_CAUSES as readonly string[]).includes(value);
}

/**
 * A number WhatsApp has told us it cannot use. Sending to it again costs a
 * message and fails the same way, so the audience switches the family to the
 * other parent's number and the desk asks for a fix instead of offering Resend.
 */
const DEAD_NUMBER_CAUSES: readonly FailureCause[] = [
  "not_on_whatsapp",
  "invalid_number",
  "opted_out",
];

export function isDeadNumberCause(cause: string | null | undefined): boolean {
  return Boolean(cause) && (DEAD_NUMBER_CAUSES as readonly string[]).includes(cause!);
}

/**
 * A cause that is the SCHOOL's problem rather than the family's: every message
 * through that template or that account fails the same way, so the desk shows
 * one banner for all of them rather than forty identical rows.
 */
export function isSystemicCause(cause: string | null | undefined): boolean {
  return cause === "template" || cause === "account";
}

type Rule = { cause: FailureCause; codes?: readonly string[]; words?: readonly string[] };

/**
 * WhatsApp's codes are the strongest signal and are checked first; words are
 * the fallback for AiSensy's own errors and for a report with no code column.
 * Codes are WhatsApp Cloud API error codes, which AiSensy passes through.
 */
const RULES: readonly Rule[] = [
  // The family has stopped messages from the school. Before "not on WhatsApp":
  // "user has blocked" must not read as a dead number to switch away from — it
  // is a decision, and the other parent's handset is still worth trying.
  {
    cause: "opted_out",
    codes: ["131050"],
    // "blocked" alone would also catch "account blocked", which is the
    // school's problem, not the family's — so only the phrasings about a USER.
    words: [
      "opted out",
      "opt-out",
      "opt out",
      "stopped marketing",
      "user has blocked",
      "blocked by user",
      "blocked by the user",
      "blocked the business",
      "unsubscribed",
    ],
  },
  {
    cause: "not_on_whatsapp",
    codes: ["131026", "131021", "1006"],
    words: [
      "not on whatsapp",
      "not a whatsapp",
      "not a valid whatsapp",
      "invalid whatsapp",
      "not registered on whatsapp",
      "no whatsapp",
      "undeliverable",
      "incapable",
      "does not exist on whatsapp",
      "not exist on whatsapp",
      "no whatsapp account",
      "whatsapp account not found",
    ],
  },
  {
    cause: "whatsapp_limit",
    codes: ["131049", "131056", "131048", "130429", "80007", "4", "130472"],
    words: [
      "ecosystem",
      "rate limit",
      "rate-limit",
      "too many",
      "pair rate",
      "spam",
      "frequency cap",
      "limit reached",
      "limit exceeded",
      "experiment",
    ],
  },
  {
    cause: "template",
    codes: ["132000", "132001", "132005", "132007", "132012", "132015", "132016", "131008", "131009"],
    words: [
      "template",
      "params does not match",
      "parameter",
      "campaign does not exist",
      "campaign not found",
      "campaign is not live",
      "campaign not live",
    ],
  },
  {
    cause: "account",
    codes: ["131031", "131042", "131005", "190", "10", "200"],
    words: [
      "aisensy_api_key",
      "api key",
      "apikey",
      "unauthor",
      "forbidden",
      "insufficient",
      "balance",
      "wallet",
      "credit",
      "account",
      "payment",
      "subscription",
    ],
  },
  {
    cause: "media",
    codes: ["131053", "131052"],
    // Not "file": it is inside "profile".
    words: ["media", "document", "attachment", "pdf"],
  },
  {
    cause: "invalid_number",
    words: [
      "invalid destination",
      "invalid phone",
      "invalid number",
      "invalid mobile",
      "invalid recipient",
      "phone number is invalid",
      "destination is invalid",
      "wrong number",
    ],
  },
  {
    cause: "network",
    codes: ["131000", "131016", "1", "2", "500", "502", "503", "504"],
    words: [
      "network",
      "timeout",
      "timed out",
      "econn",
      "fetch failed",
      "socket",
      "service unavailable",
      "temporarily",
      "try again",
      "something went wrong",
      "internal server",
      "bad gateway",
      "could not claim send slot",
    ],
  },
];

/** Every number-looking token in a text, so "(#131026)" and "code: 131026" both read. */
function codesIn(text: string): string[] {
  return text.match(/\b\d{1,6}\b/g) ?? [];
}

/**
 * Read a failure.
 *
 * `code` is an explicit error-code cell or field when there is one; the text is
 * searched for a WhatsApp code too, because AiSensy often folds it into the
 * sentence. `httpStatus` is the status of AiSensy's own reply, 0 when the call
 * never got an answer at all — that alone is a network failure.
 */
export function classifyFailure(input: {
  text?: string | null;
  code?: string | number | null;
  httpStatus?: number | null;
}): FailureCause {
  const text = String(input.text ?? "").trim().toLowerCase();
  const explicitCode = String(input.code ?? "").trim();

  // A six-digit WhatsApp code is unambiguous wherever it appears. Short codes
  // (1, 4, 10 …) only count when they arrive in a code field, never when they
  // are merely a number inside a sentence.
  const longCodes = codesIn(text).filter((token) => token.length >= 5);
  const codes = explicitCode ? [explicitCode, ...longCodes] : longCodes;

  for (const rule of RULES) {
    if (rule.codes && codes.some((code) => rule.codes!.includes(code))) return rule.cause;
  }
  for (const rule of RULES) {
    if (rule.words && rule.words.some((word) => text.includes(word))) return rule.cause;
  }

  const status = Number(input.httpStatus ?? NaN);
  if (status === 0 || status >= 500) return "network";
  if (status === 401 || status === 403) return "account";
  return "unknown";
}

/** What Resend can do about a cause. */
export type ResendPolicy =
  /** Press Resend now. */
  | "now"
  /** Fix the template or the account first, then resend them all together. */
  | "after_fix"
  /** WhatsApp held it back today; tomorrow's resend is fine. */
  | "tomorrow"
  /** Needs a working number first — edit it, or switch to the other parent. */
  | "needs_number"
  /** The family stopped messages. Call, or send a slip. */
  | "never"
  /** Nobody knows whether it went. A person checks the WhatsApp dashboard first. */
  | "check_first"
  /** Through the Send screen, as part of a list. */
  | "send_screen";

export function resendPolicyFor(cause: ProblemCause): ResendPolicy {
  switch (cause) {
    case "network":
    case "media":
    case "unknown":
      return "now";
    case "template":
    case "account":
      return "after_fix";
    case "whatsapp_limit":
      return "tomorrow";
    case "invalid_number":
    case "not_on_whatsapp":
    case "no_number":
      return "needs_number";
    case "opted_out":
      return "never";
    case "stuck":
      return "check_first";
    case "left_out":
      return "send_screen";
  }
}

export type CauseCopy = {
  /** The chip. Two or three words. */
  label: string;
  /** The same thing in Hindi, for the office staff who read it first. */
  hindi: string;
  /** One sentence: what happened, in the family's terms. */
  explanation: string;
  /** Visual weight on the desk. */
  tone: "danger" | "warning" | "neutral" | "info";
};

export const CAUSE_COPY: Record<ProblemCause, CauseCopy> = {
  no_number: {
    label: "No number",
    hindi: "नंबर दर्ज नहीं है",
    explanation: "There is no phone number on the student's record.",
    tone: "neutral",
  },
  invalid_number: {
    label: "Not a mobile",
    hindi: "नंबर सही नहीं है — 10 अंक का मोबाइल चाहिए",
    explanation: "The number on record is not a 10-digit Indian mobile, or WhatsApp rejected it.",
    tone: "neutral",
  },
  not_on_whatsapp: {
    label: "Not on WhatsApp",
    hindi: "इस नंबर पर WhatsApp नहीं है",
    explanation: "WhatsApp could not deliver to this number. It is not on WhatsApp, or is switched off for good.",
    tone: "danger",
  },
  opted_out: {
    label: "Stopped messages",
    hindi: "परिवार ने स्कूल के संदेश बंद किए हैं",
    explanation: "The family has blocked or stopped messages from the school. Call them instead.",
    tone: "danger",
  },
  whatsapp_limit: {
    label: "WhatsApp limit",
    hindi: "WhatsApp ने आज संदेश रोका — कल दोबारा भेजें",
    explanation: "WhatsApp held the message back today. It usually goes through the next day.",
    tone: "warning",
  },
  template: {
    label: "Template problem",
    hindi: "टेम्पलेट की गड़बड़ — सबके लिए एक बार ठीक करें",
    explanation: "The message template was refused. This is not the family's fault: fix the template once, then resend them all.",
    tone: "danger",
  },
  account: {
    label: "WhatsApp account",
    hindi: "WhatsApp खाते की समस्या",
    explanation: "WhatsApp refused the request: the key, the account's payment, or the template is not live. Settings → WhatsApp shows which; fix it there, then resend.",
    tone: "danger",
  },
  network: {
    label: "No reply",
    hindi: "WhatsApp से जवाब नहीं आया",
    explanation: "WhatsApp did not answer in time. Nothing is wrong with the family; resend.",
    tone: "warning",
  },
  media: {
    label: "PDF missing",
    hindi: "संलग्न PDF नहीं मिली",
    explanation: "The attached document could not be sent. Resending makes a fresh one.",
    tone: "warning",
  },
  unknown: {
    label: "Other error",
    hindi: "कोई और समस्या",
    explanation: "WhatsApp gave a reason this app does not recognise. It is shown in full below.",
    tone: "warning",
  },
  stuck: {
    label: "No answer",
    hindi: "भेजा या नहीं, पता नहीं",
    explanation: "The send started and never heard back. It may or may not have gone. Check the school’s WhatsApp dashboard before resending.",
    tone: "warning",
  },
  left_out: {
    label: "Left out",
    hindi: "इस बार की सूची में नहीं था",
    explanation: "Owes overdue fees and has a number, but has not been messaged since the latest installment fell due.",
    tone: "info",
  },
};

/** Pull a WhatsApp error code out of a reason sentence, when no code column exists. */
export function errorCodeIn(text: string | null | undefined): string | null {
  const match = String(text ?? "").match(/\b(13\d{4})\b/);
  return match ? match[1]! : null;
}
