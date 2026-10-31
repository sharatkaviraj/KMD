import { t, type Language, type Localized } from "@/platform/i18n/language";

import { COVER_KINDS, DIGEST_TEMPLATE, KINDS, type OutboxKind } from "./kinds";
import { STAFF_TEMPLATES, fillTemplate } from "./templates";

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
      `${facts.staffName} जी, ${when.hi} ${periodLine} में ${classes} (${facts.subjectCode}) की व्यवस्था अब आपकी नहीं है। विवरण: ${facts.link}`,
      `${facts.staffName}, you no longer need to cover ${classes} (${facts.subjectCode}) in ${periodLine} on ${when.en}. Details: ${facts.link}`,
    ),
    cover_escalation: t(
      `${facts.staffName} जी, ${when.hi} ${periodLine} में ${classes} (${facts.subjectCode}) के लिए कोई नहीं है — किसी अध्यापक ने कहा वे नहीं ले सकते। देखें: ${facts.link}`,
      `${facts.staffName}, ${classes} (${facts.subjectCode}) in ${periodLine} on ${when.en} needs someone — the assigned teacher cannot cover it. Review: ${facts.link}`,
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

/* ------------------------------------------- everything else (Phase F) */

/**
 * The kinds that are not about a duty or a register: each carries what it
 * needs in `staff_notices.payload`, written when it was queued, and is
 * rendered here. Same rules as the cover notice, plus two from plan §8.2:
 *
 *  - **No parent's phone number, ever.** Nothing a payload holds is a phone,
 *    and `assertNoPhoneNumber` refuses a rendered message that contains a run
 *    of ten digits, so a phone that slipped into a payload is never sent.
 *  - **A child is named only if the school allows it**
 *    (`runtime_flags.staff_notice_student_names`, off by default): otherwise
 *    the class says who, "a student of 5-A".
 *
 * Parameter {{1}} is the reader's name and the last is the link for every new
 * template; the three that existed before Phase F (marks reminder, weekly
 * summary, staff notice) keep their slots. The bodies in
 * docs/cutover/STAFF-WHATSAPP.md line up with these arrays.
 */

export type PayloadKind = Exclude<OutboxKind, (typeof COVER_KINDS)[number] | "attendance_reminder">;

export type RenderContext = {
  staffName: string;
  language: Language;
  /** The deployment's origin, without a trailing slash. */
  origin: string;
  /** `runtime_flags.staff_notice_student_names`. */
  studentNames: boolean;
};

export type Rendered = { templateCode: string; params: string[]; text: Localized; link: string };

type Payload = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** ₹12,500 — whole rupees, Indian grouping, no Intl dependency in a template. */
export function rupees(amount: unknown): string {
  const n = Math.round(num(amount));
  const digits = String(Math.abs(n));
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}₹${rest ? `${rest},${last3}` : last3}`;
}

/** Who a money message is about: the child's name only when allowed, else the class. */
export function studentLabel(payload: Payload, allowNames: boolean): Localized {
  const name = str(payload.student_name);
  if (allowNames && name) return t(name, name);
  const klass = str(payload.class_label);
  return klass ? t(`${klass} का एक विद्यार्थी`, `a student of ${klass}`) : t("एक विद्यार्थी", "a student");
}

function dayRange(from: unknown, to: unknown): Localized {
  const a = str(from);
  const b = str(to);
  if (!a) return t("—", "—");
  const first = dayText(a);
  if (!b || b === a) return first;
  const last = dayText(b);
  return t(`${first.hi} से ${last.hi}`, `${first.en} to ${last.en}`);
}


/** Where each kind's link opens. */
export const KIND_PATHS: Record<PayloadKind, string> = {
  marks_reminder: "/teach",
  weekly_summary: "/academics",
  staff_broadcast: "/inbox",
  online_review: "/fees/payments/online",
  online_payment: "/fees/payments/online",
  day_collection: "/receipts",
  day_not_closed: "/receipts",
  money_request: "/inbox",
  money_decision: "/inbox",
  leave_requested: "/timetable",
  leave_decided: "/teach",
};

/** A rendered staff message must never carry a phone number (plan §8.2). */
export function assertNoPhoneNumber(rendered: { params: string[]; text: Localized }): void {
  // "98765 43210" and "98765-43210" are phones too: join digits split by one space or hyphen.
  const all = [...rendered.params, rendered.text.hi, rendered.text.en].join("\n").replace(/(\d)[ -](?=\d)/g, "$1");
  if (/(?<!\d)(?:91)?[6-9]\d{9}(?!\d)/.test(all)) {
    throw new Error("A staff message may not contain a phone number");
  }
}

const REQUEST_KIND: Record<string, Localized> = {
  reversal: t("रसीद रद्द", "receipt reversal"),
  write_off: t("बकाया माफ़ी", "write-off"),
};
const DECISION: Record<string, Localized> = {
  approved: t("मंज़ूर", "approved"),
  declined: t("नामंज़ूर", "declined"),
};
const MODE: Record<string, Localized> = {
  cash: t("नकद", "Cash"),
  upi: t("UPI", "UPI"),
  online: t("ऑनलाइन", "Online"),
  cheque: t("चेक", "Cheque"),
  bank: t("बैंक", "Bank"),
};

/** Values in both languages; the template is filled with each, and the reader's set is what goes. */
type Values = { hi: string[]; en: string[] };
const same = (values: string[]): Values => ({ hi: values, en: values });
const both = (parts: Array<string | Localized>): Values => ({
  hi: parts.map((part) => (typeof part === "string" ? part : part.hi)),
  en: parts.map((part) => (typeof part === "string" ? part : part.en)),
});

function fromTemplate(templateCode: string, values: Values, language: Language, link: string): Rendered {
  const body = STAFF_TEMPLATES[templateCode];
  const text = t(fillTemplate(body.hi, values.hi), fillTemplate(body.en, values.en));
  // `both` reads Hindi first, as every bilingual screen does.
  const params = language === "en" ? values.en : values.hi;
  return { templateCode, params, text, link };
}

export function renderPayloadNotice(kind: PayloadKind, payload: Payload, ctx: RenderContext): Rendered {
  const link = `${ctx.origin}${str(payload.link_path) || KIND_PATHS[kind]}`;
  const name = ctx.staffName;
  let values: Values;

  switch (kind) {
    case "marks_reminder":
      // The template's existing two slots (no link): {{1}} name, {{2}} papers.
      values = same([name, str(payload.papers)]);
      break;
    case "weekly_summary":
      // The template's existing three slots: {{1}} name, {{2}} summary, {{3}} from.
      values = same([name, str(payload.summary), str(payload.from)]);
      break;
    case "staff_broadcast": {
      const hi = str(payload.hi) || str(payload.en);
      const en = str(payload.en) || str(payload.hi);
      const said = ctx.language === "both" ? `${hi}\n\n${en}` : ctx.language === "en" ? en : hi;
      values = { hi: [ctx.language === "en" ? hi : said], en: [ctx.language === "en" ? said : en] };
      break;
    }
    case "online_review":
      values = both([name, rupees(payload.amount_rupees), studentLabel(payload, ctx.studentNames), link]);
      break;
    case "online_payment":
      values = both([
        name,
        rupees(payload.amount_rupees),
        studentLabel(payload, ctx.studentNames),
        str(payload.receipt_number) || "—",
        link,
      ]);
      break;
    case "day_collection": {
      const modes = payload.by_mode && typeof payload.by_mode === "object" ? (payload.by_mode as Record<string, unknown>) : {};
      const parts = Object.entries(MODE).filter(([mode]) => num(modes[mode]) > 0);
      const breakdown = t(
        parts.map(([mode, label]) => `${label.hi} ${rupees(modes[mode])}`).join(" · ") || "—",
        parts.map(([mode, label]) => `${label.en} ${rupees(modes[mode])}`).join(" · ") || "—",
      );
      values = both([
        name,
        dayText(str(payload.date) || "1970-01-01"),
        rupees(payload.total_rupees),
        String(Math.round(num(payload.receipts))),
        breakdown,
        link,
      ]);
      break;
    }
    case "day_not_closed":
      values = both([
        name,
        dayText(str(payload.date) || "1970-01-01"),
        String(Math.round(num(payload.receipts))),
        rupees(payload.total_rupees),
        link,
      ]);
      break;
    case "money_request": {
      const what = REQUEST_KIND[str(payload.request_kind)] ?? t("अनुरोध", "request");
      values = both([
        name,
        what,
        rupees(payload.amount),
        studentLabel(payload, ctx.studentNames),
        str(payload.requested_by_name) || "—",
        link,
      ]);
      break;
    }
    case "money_decision": {
      const what = REQUEST_KIND[str(payload.request_kind)] ?? t("अनुरोध", "request");
      const decision = DECISION[str(payload.decision)] ?? t(str(payload.decision) || "—", str(payload.decision) || "—");
      values = both([name, what, decision, rupees(payload.amount), studentLabel(payload, ctx.studentNames), link]);
      break;
    }
    case "leave_requested":
      values = both([name, str(payload.teacher_name) || "—", dayRange(payload.from_day, payload.to_day), link]);
      break;
    case "leave_decided": {
      const decision = DECISION[str(payload.decision)] ?? t(str(payload.decision) || "—", str(payload.decision) || "—");
      values = both([name, dayRange(payload.from_day, payload.to_day), decision, link]);
      break;
    }
  }

  const rendered = fromTemplate(KINDS[kind].template, values, ctx.language, link);
  assertNoPhoneNumber(rendered);
  return rendered;
}

/** Several of one kind, as one message (gates.ts, step 9): {{1}} name, {{2}} count, {{3}} what, {{4}} link. */
export function renderDigest(kind: OutboxKind, count: number, ctx: RenderContext): Rendered {
  const path = kind in KIND_PATHS ? KIND_PATHS[kind as PayloadKind] : "/inbox";
  const link = `${ctx.origin}${path}`;
  return fromTemplate(DIGEST_TEMPLATE, both([ctx.staffName, String(count), KINDS[kind].label, link]), ctx.language, link);
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
