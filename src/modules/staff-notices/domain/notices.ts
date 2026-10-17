import { t, type Language, type Localized } from "@/platform/i18n/language";

/**
 * What a cover notice says, and what a provider's answer means (P4).
 *
 * Pure. The dispatcher in `data/dispatcher.ts` claims a notice, asks this
 * module what to send and how to read the reply, and records both.
 *
 * Two rules that are easy to break and expensive when broken:
 *
 *  - **No reasons, no children.** A cover notice names the class, the subject,
 *    the period and a link. Never why the colleague is away, never a pupil
 *    (§9: "Sensitive reasons and student names do not belong in cover notices").
 *  - **Only a provider receipt is acceptance.** A timeout, a dropped
 *    connection, a 2xx without an id: the message may have gone. That is
 *    Unknown, and Unknown is never retried by a machine (§9).
 */

export type StaffNoticeKind = "cover_assigned" | "cover_changed" | "cover_cancelled" | "cover_escalation";

export type NoticeFacts = {
  kind: StaffNoticeKind;
  staffName: string;
  language: Language;
  day: string;
  /** 0-based, as stored. */
  period: number;
  periodTime: string | null;
  classLabels: string[];
  subjectCode: string;
  link: string;
};

/** The provider campaign each kind goes out as. Approved wording is verified per account (§9). */
export const NOTICE_TEMPLATES: Record<StaffNoticeKind, string> = {
  cover_assigned: "vppsone_cover_assigned",
  cover_changed: "vppsone_cover_changed",
  cover_cancelled: "vppsone_cover_cancelled",
  cover_escalation: "vppsone_cover_escalation",
};

function dayText(day: string): Localized {
  const date = new Date(`${day}T00:00:00Z`);
  const en = date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const hi = date.toLocaleDateString("hi-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return { hi, en };
}

/**
 * The words, in the reader's language, and the parameters a template takes.
 *
 * Parameters are positional because that is how a WhatsApp template is
 * approved: {{1}} name, {{2}} day, {{3}} period and time, {{4}} classes,
 * {{5}} subject, {{6}} link. The same six for every kind, so one approved
 * shape per kind is enough.
 */
export function renderNotice(facts: NoticeFacts): {
  templateCode: string;
  params: string[];
  text: Localized;
} {
  const when = dayText(facts.day);
  const periodLine = `P${facts.period + 1}${facts.periodTime ? ` (${facts.periodTime})` : ""}`;
  const classes = facts.classLabels.join(", ");
  const params = [
    facts.staffName,
    facts.language === "en" ? when.en : when.hi,
    periodLine,
    classes,
    facts.subjectCode,
    facts.link,
  ];

  const text: Record<StaffNoticeKind, Localized> = {
    cover_assigned: t(
      `${facts.staffName} जी, ${when.hi} को ${periodLine} में ${classes} (${facts.subjectCode}) की व्यवस्था आपकी है। देखें और पुष्टि करें: ${facts.link}`,
      `${facts.staffName}, you are covering ${classes} (${facts.subjectCode}) in ${periodLine} on ${when.en}. Open and acknowledge: ${facts.link}`,
    ),
    cover_changed: t(
      `${facts.staffName} जी, ${when.hi} ${periodLine} की आपकी व्यवस्था बदली है: अब ${classes} (${facts.subjectCode})। नया विवरण: ${facts.link}`,
      `${facts.staffName}, your cover in ${periodLine} on ${when.en} has changed: now ${classes} (${facts.subjectCode}). Current details: ${facts.link}`,
    ),
    cover_cancelled: t(
      `${facts.staffName} जी, ${when.hi} ${periodLine} में ${classes} की व्यवस्था अब आपकी नहीं है। विवरण: ${facts.link}`,
      `${facts.staffName}, you no longer need to cover ${classes} in ${periodLine} on ${when.en}. Details: ${facts.link}`,
    ),
    cover_escalation: t(
      `${when.hi} ${periodLine} में ${classes} (${facts.subjectCode}) के लिए कोई नहीं है — किसी अध्यापक ने कहा वे नहीं ले सकते। देखें: ${facts.link}`,
      `${classes} (${facts.subjectCode}) in ${periodLine} on ${when.en} needs someone — the assigned teacher cannot cover it. Review: ${facts.link}`,
    ),
  };

  return { templateCode: NOTICE_TEMPLATES[facts.kind], params, text: text[facts.kind] };
}

/* ------------------------------------------------- the register reminder */

/**
 * The attendance reminder (P6): a class teacher whose register is still
 * outstanding after the first period. Four parameters — {{1}} name, {{2}}
 * day, {{3}} class, {{4}} link — and no child, no count, nothing about who is
 * away. The link opens the register, which says "Recorded" if it was saved
 * after this was sent.
 */
export const REMINDER_TEMPLATE = "vppsone_staff_attendance_reminder";

export function renderReminder(facts: {
  staffName: string;
  language: Language;
  day: string;
  classLabel: string;
  link: string;
}): { templateCode: string; params: string[]; text: Localized } {
  const when = dayText(facts.day);
  return {
    templateCode: REMINDER_TEMPLATE,
    params: [facts.staffName, facts.language === "en" ? when.en : when.hi, facts.classLabel, facts.link],
    text: t(
      `${facts.staffName} जी, ${when.hi} की ${facts.classLabel} की हाज़िरी अभी दर्ज नहीं हुई है। यहाँ लें: ${facts.link}`,
      `${facts.staffName}, ${facts.classLabel}'s register for ${when.en} has not been saved yet. Take it here: ${facts.link}`,
    ),
  };
}

/* ------------------------------------------------------------ outcomes */

export type TransportOutcome =
  | { outcome: "accepted"; providerMessageId: string; status: number }
  | { outcome: "rejected"; status: number; error: string }
  | { outcome: "rate_limited"; status: number; error: string }
  | { outcome: "unknown"; status: number | null; error: string };

/**
 * A provider's HTTP answer as one of the four things it can mean.
 *
 * The two AiSensy adapters already in this repository read different fields
 * for the receipt — `messageId` (collection) and `submitted_message_id`
 * (fees) — and the school's account has never been checked to say which is
 * real (§9, prompt 6). Either is accepted here; neither present is not
 * acceptance, it is Unknown.
 */
export function classifyResponse(status: number, body: unknown): TransportOutcome {
  if (status === 429) return { outcome: "rate_limited", status, error: "Rate limited by the provider" };
  if (status >= 500) return { outcome: "rejected", status, error: `Provider error ${status}` };
  if (status >= 400) {
    const message =
      body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "";
    return { outcome: "rejected", status, error: message || `Refused (${status})` };
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // AiSensy can refuse a campaign/parameter mismatch inside HTTP 200.
  if (record.error) return { outcome: "rejected", status, error: "The provider refused the campaign request" };
  const id = record.submitted_message_id ?? record.messageId ?? record.message_id;
  if (typeof id === "string" && id.trim()) {
    return { outcome: "accepted", providerMessageId: id.trim(), status };
  }
  return { outcome: "unknown", status, error: "The provider answered without a receipt id" };
}

/** A thrown fetch — a timeout or a dropped connection — after the request may have left. */
export function outcomeOfThrow(error: unknown): TransportOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return { outcome: "unknown", status: null, error: `No answer: ${message}`.slice(0, 300) };
}

/* ---------------------------------------------------------- the mock */

export type MockBehaviour = "accepted" | "slow" | "timeout" | "rate_limited" | "server_error" | "no_receipt" | "refused";

/**
 * What the mock transport does for a number, by its last digit, so every
 * outcome can be produced on purpose with a synthetic phone:
 * 0–4 accepted, 5 slow but accepted, 6 timeout (Unknown), 7 rate limited,
 * 8 provider error, 9 a 2xx with no receipt (Unknown). A number that is not ten
 * digits is refused.
 */
export function mockBehaviourFor(destination: string): MockBehaviour {
  if (!/^\d{10}$/.test(destination)) return "refused";
  const last = Number(destination.at(-1));
  if (last <= 4) return "accepted";
  return (["slow", "timeout", "rate_limited", "server_error", "no_receipt"] as const)[last - 5];
}
