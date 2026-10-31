import { t, type Localized } from "@/platform/i18n/language";

/**
 * Every kind of WhatsApp message One sends to a member of staff (go-live
 * Phase F, plan §8.2, D-344). Pure: the outbox's database constraint, the
 * dispatcher, the /preferences toggles and docs/cutover/STAFF-WHATSAPP.md all
 * read this one list.
 *
 * A kind is one AiSensy campaign (`template`), sent to whoever the event names
 * (`to`, documentation only — the queueing code decides). Two flags say which
 * of the staff limits it is exempt from:
 *
 *  - `urgent`: cover. A teacher who must be in a classroom in twenty minutes is
 *    told now, at any hour and however many times today; and a cover notice
 *    is never folded into a digest, because each names a different period.
 *  - `edgeOfWindow`: sent at the moment the send window closes (20:00) about
 *    something that stops mattering overnight — the day that was not closed.
 *    It keeps every other limit (D-356).
 *
 * The teacher-task link (`teacher_task`) is not an outbox kind: it has its own
 * reviewed delivery (`prepare/queue/claim_teacher_task_delivery`), which asks
 * the same consent and allowlist gates before it claims.
 */

export const COVER_KINDS = ["cover_assigned", "cover_changed", "cover_cancelled", "cover_escalation"] as const;

export const OUTBOX_KINDS = [
  ...COVER_KINDS,
  "attendance_reminder",
  "marks_reminder",
  "weekly_summary",
  "staff_broadcast",
  "online_review",
  "online_payment",
  "day_collection",
  "day_not_closed",
  "money_request",
  "money_decision",
  "leave_requested",
  "leave_decided",
] as const;

export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Every kind a person can switch on or off for themselves, the task link included. */
export const STAFF_MESSAGE_KINDS = [...OUTBOX_KINDS, "teacher_task"] as const;
export type StaffMessageKind = (typeof STAFF_MESSAGE_KINDS)[number];

export type KindDefinition = {
  kind: StaffMessageKind;
  /** The AiSensy campaign / Meta template name. */
  template: string;
  label: Localized;
  /** Who receives it, in words (the queueing code is the truth). */
  to: Localized;
  urgent: boolean;
  edgeOfWindow: boolean;
  /** Seeded on in `runtime_flags.staff_notice_kinds_enabled` (existing kinds only). */
  seededOn: boolean;
};

const kind = (
  name: StaffMessageKind,
  template: string,
  label: Localized,
  to: Localized,
  extra: Partial<Pick<KindDefinition, "urgent" | "edgeOfWindow" | "seededOn">> = {},
): KindDefinition => ({
  kind: name,
  template,
  label,
  to,
  urgent: extra.urgent ?? false,
  edgeOfWindow: extra.edgeOfWindow ?? false,
  seededOn: extra.seededOn ?? false,
});

const COVERING = t("व्यवस्था लेने वाले अध्यापक", "The covering teacher");

export const KINDS: Record<StaffMessageKind, KindDefinition> = {
  cover_assigned: kind("cover_assigned", "vppsone_cover_assigned", t("व्यवस्था मिली", "Cover assigned"), COVERING, {
    urgent: true,
    seededOn: true,
  }),
  cover_changed: kind("cover_changed", "vppsone_cover_changed", t("व्यवस्था बदली", "Cover changed"), COVERING, {
    urgent: true,
    seededOn: true,
  }),
  cover_cancelled: kind("cover_cancelled", "vppsone_cover_cancelled", t("व्यवस्था रद्द", "Cover cancelled"), COVERING, {
    urgent: true,
    seededOn: true,
  }),
  cover_escalation: kind(
    "cover_escalation",
    "vppsone_cover_escalation",
    t("व्यवस्था नहीं हो सकी", "Cover refused"),
    t("समन्वयक", "The coordinator"),
    { urgent: true, seededOn: true },
  ),
  attendance_reminder: kind(
    "attendance_reminder",
    "vppsone_staff_attendance_reminder",
    t("हाज़िरी की याद", "Register not saved"),
    t("कक्षा-अध्यापक", "The class teacher"),
    { seededOn: true },
  ),
  marks_reminder: kind(
    "marks_reminder",
    "vppsone_marks_reminder",
    t("बाकी अंकों की याद", "Marks outstanding"),
    t("विषय-अध्यापक", "The subject teacher"),
  ),
  weekly_summary: kind(
    "weekly_summary",
    "vppsone_weekly_summary",
    t("साप्ताहिक सारांश", "Weekly summary"),
    t("प्रधानाचार्य", "The principal"),
  ),
  staff_broadcast: kind(
    "staff_broadcast",
    "vx_staff_notice",
    t("स्टाफ़ सूचना", "Staff notice"),
    t("चुने हुए स्टाफ़", "The staff chosen"),
  ),
  online_review: kind(
    "online_review",
    "vx_staff_online_review_v1",
    t("ऑनलाइन भुगतान जाँचें", "Online payment needs review"),
    t("लेखाकार, प्रशासक", "Accountant, admin"),
  ),
  online_payment: kind(
    "online_payment",
    "vx_staff_online_payment_v1",
    t("ऑनलाइन भुगतान आया", "Online payment received"),
    t("फ़ीस लेने वाले स्टाफ़", "Staff who collect fees"),
  ),
  day_collection: kind(
    "day_collection",
    "vx_staff_day_collection_v1",
    t("दिन का संग्रह", "Day's collection"),
    t("लेखाकार, प्रशासक", "Accountant, admin"),
  ),
  day_not_closed: kind(
    "day_not_closed",
    "vx_staff_day_not_closed_v1",
    t("दिन बंद नहीं हुआ", "Day not closed"),
    t("लेखाकार, प्रशासक", "Accountant, admin"),
    { edgeOfWindow: true },
  ),
  money_request: kind(
    "money_request",
    "vx_staff_money_request_v1",
    t("रसीद रद्द / माफ़ी का अनुरोध", "Reversal or write-off requested"),
    t("प्रशासक", "Admin"),
  ),
  money_decision: kind(
    "money_decision",
    "vx_staff_money_decision_v1",
    t("रसीद रद्द / माफ़ी का निर्णय", "Reversal or write-off decided"),
    t("अनुरोध करने वाले", "Whoever asked"),
  ),
  leave_requested: kind(
    "leave_requested",
    "vx_staff_leave_requested_v1",
    t("छुट्टी का अनुरोध", "Leave requested"),
    t("व्यवस्था देखने वाले", "Whoever approves leave"),
  ),
  leave_decided: kind(
    "leave_decided",
    "vx_staff_leave_decided_v1",
    t("छुट्टी का निर्णय", "Leave decided"),
    t("अध्यापक", "The teacher"),
  ),
  teacher_task: kind(
    "teacher_task",
    "vppsone_teacher_task_*_v1",
    t("अध्यापक का काम", "Teacher task"),
    t("अध्यापक", "The teacher"),
    { seededOn: true },
  ),
};

/** One message in place of several of the same kind (`gates.ts`). */
export const DIGEST_TEMPLATE = "vx_staff_digest_v1";

export function isOutboxKind(value: unknown): value is OutboxKind {
  return typeof value === "string" && (OUTBOX_KINDS as readonly string[]).includes(value);
}

export function isStaffMessageKind(value: unknown): value is StaffMessageKind {
  return typeof value === "string" && (STAFF_MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isUrgentKind(value: string): boolean {
  return isStaffMessageKind(value) && KINDS[value].urgent;
}

/** The seed for `runtime_flags.staff_notice_kinds_enabled`: existing kinds on, new ones off until the owner turns them on (Q15). */
export function seededKindsMap(): Record<StaffMessageKind, boolean> {
  return Object.fromEntries(STAFF_MESSAGE_KINDS.map((name) => [name, KINDS[name].seededOn])) as Record<
    StaffMessageKind,
    boolean
  >;
}
