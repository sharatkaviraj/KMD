import type { NoticeLanguage } from "@/modules/whatsapp/domain/campaigns";

/**
 * School notices — the everyday WhatsApp messages that are not about money.
 *
 * An absence alert, an exam schedule, a parent-teacher meeting, a closure.
 * Their own lane, end to end: their own templates, their own send log
 * (`school_notice_sends`), their own monthly count. A fee reminder profile of
 * Quiet, or a fee cadence of Never, does not stop an absence alert — those are
 * decisions about chasing money, and an absent child is not money.
 *
 * What they DO share with the fee lane: quiet hours, the no-call flag (a family
 * who asked not to be contacted is not contacted), the family's own language,
 * and one message per phone where the notice is about the household.
 *
 * Browser-safe: names, fields and approval only. The bodies are in
 * `school-notice-bodies.ts`, which only the server reads.
 */

export type SchoolNoticeKind = "absent_today" | "exam_schedule" | "ptm" | "school_closed";

/** A field the office fills in for the whole batch. */
export type SchoolNoticeField = {
  name: string;
  label: string;
  kind: "date" | "text";
  placeholder?: string;
  /** Kept short: a slot value Meta shows in a labelled line. */
  maxLength?: number;
};

export type SchoolNoticeDefinition = {
  kind: SchoolNoticeKind;
  label: string;
  /** One line on the picker card. */
  hint: string;
  fields: readonly SchoolNoticeField[];
  /**
   * `student` — one message per child (an absence is one child's, a PTM slot
   * is with one child's teacher). `household` — one message per phone naming
   * every child on it (a closure is the same news for all of them).
   */
  addressedTo: "student" | "household";
  /** How recipients are picked: tick children in one class, or whole classes. */
  pick: "roster" | "classes";
};

export const SCHOOL_NOTICES: readonly SchoolNoticeDefinition[] = [
  {
    kind: "absent_today",
    label: "Absent today",
    hint: "Tell parents their child was marked absent.",
    fields: [{ name: "date", label: "Date", kind: "date" }],
    addressedTo: "student",
    pick: "roster",
  },
  {
    kind: "exam_schedule",
    label: "Exam schedule",
    hint: "When the exams start and when to report.",
    fields: [
      { name: "examName", label: "Examination", kind: "text", placeholder: "Half-yearly examination", maxLength: 60 },
      { name: "startsOn", label: "Starts on", kind: "date" },
      { name: "reportingTime", label: "Reporting time", kind: "text", placeholder: "8:00 AM", maxLength: 20 },
    ],
    addressedTo: "student",
    pick: "classes",
  },
  {
    kind: "ptm",
    label: "Parent-teacher meeting",
    hint: "Invite parents to meet the class teacher.",
    fields: [
      { name: "date", label: "Date", kind: "date" },
      { name: "time", label: "Time", kind: "text", placeholder: "10:00 AM to 1:00 PM", maxLength: 30 },
    ],
    addressedTo: "student",
    pick: "classes",
  },
  {
    kind: "school_closed",
    label: "School closed",
    hint: "A holiday or closure, one message per family.",
    fields: [
      { name: "closedOn", label: "Closed on", kind: "date" },
      { name: "reason", label: "Reason", kind: "text", placeholder: "Diwali holidays", maxLength: 60 },
      { name: "reopensOn", label: "Reopens on", kind: "date" },
    ],
    addressedTo: "household",
    pick: "classes",
  },
];

export function isSchoolNoticeKind(value: unknown): value is SchoolNoticeKind {
  return typeof value === "string" && SCHOOL_NOTICES.some((entry) => entry.kind === value);
}

export function schoolNoticeFor(kind: SchoolNoticeKind): SchoolNoticeDefinition {
  return SCHOOL_NOTICES.find((entry) => entry.kind === kind) ?? SCHOOL_NOTICES[0]!;
}

/** The template (and AiSensy campaign) name — the same string drives both. */
export function schoolNoticeCampaignName(kind: SchoolNoticeKind, language: NoticeLanguage): string {
  const stem = kind === "absent_today" ? "absent" : kind === "school_closed" ? "closed" : kind;
  return `vpps_school_${stem}_${language}_v1`;
}

/**
 * Which school-notice templates Meta has approved AND have a Live AiSensy
 * campaign. Listed only once both are true — flipped in code and deployed, like
 * every fee template before it.
 *
 * All eight, approved as UTILITY and set Live on 2026-10-26; one of each kind
 * was test-sent to the office number and delivered. A template later pulled
 * from this list falls back to the other language — see `sendSchoolNotice`.
 */
export const APPROVED_SCHOOL_NOTICES: ReadonlySet<string> = new Set<string>([
  "vpps_school_absent_hi_v1",
  "vpps_school_absent_en_v1",
  "vpps_school_exam_schedule_hi_v1",
  "vpps_school_exam_schedule_en_v1",
  "vpps_school_ptm_hi_v1",
  "vpps_school_ptm_en_v1",
  "vpps_school_closed_hi_v1",
  "vpps_school_closed_en_v1",
]);

export function isSchoolNoticeApproved(kind: SchoolNoticeKind, language: NoticeLanguage): boolean {
  return APPROVED_SCHOOL_NOTICES.has(schoolNoticeCampaignName(kind, language));
}

/**
 * How many school notices a month before the screen asks for a reason.
 *
 * Separate from the fee lane's 4,000, so a busy exam season of notices never
 * eats the budget the fee reminders need — and the other way round.
 */
export const SCHOOL_NOTICE_MONTHLY_BUDGET = 3000;
