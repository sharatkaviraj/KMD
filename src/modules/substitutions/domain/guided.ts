import type { DesiredDuty } from "@/modules/substitutions/domain/arrange";
import type { CoverWarning, MatchTier } from "@/modules/substitutions/domain/engine";

/*
 * The guided cover flow, worked out without a database (review C01).
 *
 * A coordinator names who is away and when; the server works out the day the
 * way the cover command would (`planCoverDay`), and these turn that plan into
 * what the screens show and what Confirm must find unchanged:
 *
 *  - which periods the absence covers (whole day, or only the ones chosen);
 *  - which lessons it leaves — in the chosen periods only;
 *  - for each lesson, who could take it, with the conflict that rules a person
 *    out (teaching then, already covering then, away, on leave) and the covers
 *    they already carry today and this week;
 *  - what else on the day the change moves, so the review hides nothing;
 *  - one short fingerprint of the whole plan, so Confirm commits exactly what
 *    was reviewed or says that the day moved.
 *
 * Pure, so the screens, the actions and the tests share one definition.
 */

export const GUIDED_PERIOD_COUNT = 8;

/* ------------------------------------------------------------ the periods */

export type AbsenceSpanChoice = "whole" | "periods";

/**
 * The periods an absence covers. A whole day is every period; otherwise only
 * the ones picked — sorted, once each, and never a period the day does not
 * have. An empty list means nothing was picked yet.
 */
export function absencePeriods(
  choice: AbsenceSpanChoice,
  picked: readonly number[],
  periodCount = GUIDED_PERIOD_COUNT,
): number[] {
  if (choice === "whole") return Array.from({ length: periodCount }, (_, index) => index);
  return [...new Set(picked)]
    .filter((period) => Number.isInteger(period) && period >= 0 && period < periodCount)
    .sort((a, b) => a - b);
}

/** True when the periods are the whole day. */
export function isWholeDay(periods: readonly number[], periodCount = GUIDED_PERIOD_COUNT): boolean {
  return absencePeriods("periods", periods, periodCount).length === periodCount;
}

/**
 * The lessons this absence leaves, in the chosen periods only. A partial-day
 * absence never reaches a period that was not chosen, even when the teacher
 * teaches then; a lesson shared with another absent teacher is still theirs
 * to see.
 */
export function affectedDuties<T extends Pick<DesiredDuty, "need_key" | "period" | "absent_staff_ids">>(
  duties: readonly T[],
  staffId: string,
  periods: readonly number[],
): T[] {
  const chosen = new Set(periods);
  return duties
    .filter((duty) => chosen.has(duty.period) && duty.absent_staff_ids.includes(staffId))
    .sort((a, b) => a.period - b.period || a.need_key.localeCompare(b.need_key));
}

/**
 * Chosen periods the teacher teaches that have already begun: nothing can be
 * arranged for them any more, and the screen says so rather than dropping them.
 */
export function begunLessonPeriods(
  lessonPeriods: readonly number[],
  chosen: readonly number[],
  openPeriods: ReadonlySet<number>,
): number[] {
  const picked = new Set(chosen);
  return [...new Set(lessonPeriods)].filter((period) => picked.has(period) && !openPeriods.has(period)).sort((a, b) => a - b);
}

/* ------------------------------------------------------------- the choices */

export type GuidedChoice = { needKey: string; coveringStaffId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Choices as the server accepts them from a browser: an array of
 * `{ needKey, coveringStaffId }`, a staff id or null ("leave it for a
 * person"). One per need — the last one wins — sorted, so the same choices
 * always hash the same. Anything else is refused whole (null), never guessed.
 */
export function normalizeChoices(raw: unknown, isStaffId: (id: string) => boolean = (id) => UUID.test(id)): GuidedChoice[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const byKey = new Map<string, GuidedChoice>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { needKey, coveringStaffId } = entry as Record<string, unknown>;
    if (typeof needKey !== "string" || needKey.length === 0 || needKey.length > 300) return null;
    if (coveringStaffId !== null && (typeof coveringStaffId !== "string" || !isStaffId(coveringStaffId))) return null;
    byKey.set(needKey, { needKey, coveringStaffId: coveringStaffId as string | null });
  }
  return [...byKey.values()].sort((a, b) => a.needKey.localeCompare(b.needKey));
}

/** Only the choices that still name a lesson this absence leaves. */
export function choicesFor(choices: readonly GuidedChoice[], affectedKeys: ReadonlySet<string>): GuidedChoice[] {
  return choices.filter((choice) => affectedKeys.has(choice.needKey));
}

/** Set, change or clear the choice for one lesson. `undefined` goes back to the proposal. */
export function withChoice(choices: readonly GuidedChoice[], needKey: string, coveringStaffId: string | null | undefined): GuidedChoice[] {
  const rest = choices.filter((choice) => choice.needKey !== needKey);
  if (coveringStaffId === undefined) return rest;
  return [...rest, { needKey, coveringStaffId }].sort((a, b) => a.needKey.localeCompare(b.needKey));
}

/* ----------------------------------------------------- who can take it */

/** Why a person cannot take a period, plainly. Null: they can. */
export type Conflict = "away" | "on_leave" | "teaching" | "covering" | "unavailable";

/**
 * The engine's blocks as one reason a coordinator can act on. Away comes
 * first — a teacher at home is not "teaching" — and approved leave is named
 * as leave whether or not the day already marks them away.
 */
export function conflictOf(blocked: readonly string[], onLeave: boolean): Conflict | null {
  if (onLeave) return "on_leave";
  if (blocked.includes("absent")) return "away";
  if (blocked.includes("regular_class")) return "teaching";
  if (blocked.includes("double_booked")) return "covering";
  if (blocked.length > 0) return "unavailable";
  return null;
}

export type Workload = { today: number; week: number };

/**
 * The covers a teacher already carries: on this day as the plan stands (the
 * lesson being decided left out), and over the school week around it — the
 * days the database already holds plus this day as planned.
 */
export function workloadFor(
  input: {
    duties: readonly Pick<DesiredDuty, "need_key" | "status" | "covering_staff_id">[];
    /** Assigned covers per teacher over the whole week, as the database holds them now. */
    weekAssigned: Readonly<Record<string, number>>;
    /** Of those, the ones on this day — replaced by the plan's own count. */
    dayAssigned: Readonly<Record<string, number>>;
  },
  teacher: string,
  exceptNeedKey?: string,
): Workload {
  const today = input.duties.filter(
    (duty) => duty.status === "assigned" && duty.covering_staff_id === teacher && duty.need_key !== exceptNeedKey,
  ).length;
  const otherDays = Math.max(0, (input.weekAssigned[teacher] ?? 0) - (input.dayAssigned[teacher] ?? 0));
  return { today, week: otherDays + today };
}

export type RankedLike = {
  teacher: string;
  matchTier: MatchTier;
  warnings: readonly CoverWarning[];
  blocked: readonly string[];
  autoEligible: boolean;
};

export type GuidedOption = {
  id: string;
  tier: MatchTier;
  warnings: CoverWarning[];
  conflict: Conflict | null;
  autoEligible: boolean;
  workload: Workload;
  /** The one the plan puts there now. */
  proposed: boolean;
};

/**
 * Everybody who could be put on one lesson: those free then first, in the
 * engine's order (best match first), then everybody who cannot, each with the
 * reason. Office logins are never offered (D-213), and the absent teacher is
 * not offered for their own lesson.
 */
export function optionsFor(
  ranked: readonly RankedLike[],
  context: {
    eligible: ReadonlySet<string>;
    onLeave: ReadonlySet<string>;
    workload: (teacher: string) => Workload;
    proposedId: string | null;
    absentId: string;
  },
): GuidedOption[] {
  const rows = ranked
    .filter((candidate) => context.eligible.has(candidate.teacher) && candidate.teacher !== context.absentId)
    .map((candidate) => ({
      id: candidate.teacher,
      tier: candidate.matchTier,
      warnings: [...candidate.warnings],
      conflict: conflictOf(candidate.blocked, context.onLeave.has(candidate.teacher)),
      autoEligible: candidate.autoEligible && !context.onLeave.has(candidate.teacher),
      workload: context.workload(candidate.teacher),
      proposed: candidate.teacher === context.proposedId,
    }));
  return [...rows.filter((row) => row.conflict === null), ...rows.filter((row) => row.conflict !== null)];
}

/* -------------------------------------------------------- the whole day */

export type DutyLike = {
  needKey: string;
  period: number;
  status: string;
  coveringStaffId: string | null;
  classLabels: string[];
  subjectCode: string;
  reason?: string | null;
  absentStaffIds?: readonly string[];
};

export type OtherChange = {
  needKey: string;
  period: number;
  classLabels: string[];
  subjectCode: string;
  from: string | null;
  to: string | null;
  /** moved: another teacher now; released: nobody now; assigned: somebody now; cancelled: no longer needed. */
  kind: "moved" | "released" | "assigned" | "cancelled";
};

/**
 * What else this change moves on the day — a cover the absent teacher was
 * holding for somebody else, a duty no longer needed — so the review lists
 * every assignment that will change, not only the new ones. Begun periods are
 * history and are never touched.
 */
export function otherChanges(
  live: readonly DutyLike[],
  duties: readonly DesiredDuty[],
  affectedKeys: ReadonlySet<string>,
  openPeriods: ReadonlySet<number>,
): OtherChange[] {
  const desired = new Map(duties.map((duty) => [duty.need_key, duty]));
  const changes: OtherChange[] = [];
  const seen = new Set<string>();
  for (const duty of live) {
    if (duty.status !== "assigned" && duty.status !== "needs_help") continue;
    seen.add(duty.needKey);
    if (affectedKeys.has(duty.needKey) || !openPeriods.has(duty.period)) continue;
    const next = desired.get(duty.needKey);
    const base = { needKey: duty.needKey, period: duty.period, classLabels: duty.classLabels, subjectCode: duty.subjectCode, from: duty.coveringStaffId };
    if (!next) {
      changes.push({ ...base, to: null, kind: "cancelled" });
      continue;
    }
    if (next.status === duty.status && next.covering_staff_id === duty.coveringStaffId) continue;
    const kind = next.status !== "assigned" ? "released" : duty.status === "assigned" ? "moved" : "assigned";
    changes.push({ ...base, to: next.covering_staff_id, kind });
  }
  for (const duty of duties) {
    if (seen.has(duty.need_key) || affectedKeys.has(duty.need_key)) continue;
    changes.push({
      needKey: duty.need_key,
      period: duty.period,
      classLabels: duty.class_labels,
      subjectCode: duty.subject_code,
      from: null,
      to: duty.covering_staff_id,
      kind: duty.status === "assigned" ? "assigned" : "released",
    });
  }
  return changes.sort((a, b) => a.period - b.period || a.needKey.localeCompare(b.needKey));
}

export type NoticeLesson = { needKey: string; period: number; classLabels: string[]; subjectCode: string };

export type NoticePlan = {
  /** One WhatsApp message per lesson: a new cover, or a correction to one they hold. */
  messages: (NoticeLesson & { staffId: string; kind: "assigned" | "updated" })[];
  /**
   * Covers taken away from somebody. They are messaged that it is cancelled
   * only if they had already been told about it; otherwise the waiting
   * message is simply withdrawn.
   */
  withdrawn: (NoticeLesson & { staffId: string })[];
};

/**
 * Who the cover command will message when this plan commits — the database's
 * own rule (`commit_cover_command`), worked out beforehand so the review can
 * say it before Confirm instead of the coordinator assuming it:
 *
 *  - a lesson somebody now covers that they did not before → "assigned";
 *  - the same person, but what they were told changed (who is away, why) →
 *    "updated";
 *  - unchanged in everything they were told → nobody is messaged;
 *  - a cover taken from somebody → "withdrawn" (see `NoticePlan`).
 *
 * Begun periods are history and message nobody.
 */
export function noticePlan(live: readonly DutyLike[], duties: readonly DesiredDuty[], openPeriods: ReadonlySet<number>): NoticePlan {
  const now = new Map(
    live.filter((duty) => duty.status === "assigned" || duty.status === "needs_help").map((duty) => [duty.needKey, duty]),
  );
  const sameAway = (a: readonly string[] | undefined, b: readonly string[]) =>
    a === undefined || [...a].sort().join(",") === [...b].sort().join(",");
  const plan: NoticePlan = { messages: [], withdrawn: [] };
  const lesson = (duty: { need_key: string; period: number; class_labels: string[]; subject_code: string }): NoticeLesson => ({
    needKey: duty.need_key,
    period: duty.period,
    classLabels: duty.class_labels,
    subjectCode: duty.subject_code,
  });
  const wanted = new Map(duties.map((duty) => [duty.need_key, duty]));

  for (const duty of duties) {
    if (!openPeriods.has(duty.period)) continue;
    const before = now.get(duty.need_key);
    if (duty.status === "assigned" && duty.covering_staff_id) {
      if (!before || before.status !== "assigned" || before.coveringStaffId !== duty.covering_staff_id) {
        plan.messages.push({ ...lesson(duty), staffId: duty.covering_staff_id, kind: "assigned" });
      } else if ((before.reason ?? null) !== (duty.reason ?? null) || !sameAway(before.absentStaffIds, duty.absent_staff_ids)) {
        plan.messages.push({ ...lesson(duty), staffId: duty.covering_staff_id, kind: "updated" });
      }
    }
    if (before?.status === "assigned" && before.coveringStaffId && (duty.status !== "assigned" || duty.covering_staff_id !== before.coveringStaffId)) {
      plan.withdrawn.push({ ...lesson(duty), staffId: before.coveringStaffId });
    }
  }
  for (const before of now.values()) {
    if (wanted.has(before.needKey) || !openPeriods.has(before.period)) continue;
    if (before.status === "assigned" && before.coveringStaffId) {
      plan.withdrawn.push({ needKey: before.needKey, period: before.period, classLabels: before.classLabels, subjectCode: before.subjectCode, staffId: before.coveringStaffId });
    }
  }
  const order = (a: NoticeLesson, b: NoticeLesson) => a.period - b.period || a.needKey.localeCompare(b.needKey);
  plan.messages.sort(order);
  plan.withdrawn.sort(order);
  return plan;
}

/** The plan's messages grouped by person, in the order their first lesson comes. */
export function messagesByPerson<T extends { staffId: string }>(messages: readonly T[]): { staffId: string; lessons: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const message of messages) groups.set(message.staffId, [...(groups.get(message.staffId) ?? []), message]);
  return [...groups.entries()].map(([staffId, lessons]) => ({ staffId, lessons }));
}

/** Of the lessons reviewed, how many have a teacher and how many wait for a person. */
export function reviewTally(affected: readonly Pick<DesiredDuty, "status">[]): { assigned: number; needsHelp: number; total: number } {
  const assigned = affected.filter((duty) => duty.status === "assigned").length;
  return { assigned, needsHelp: affected.length - assigned, total: affected.length };
}

/**
 * The whole day's plan as one short string. Preview and Confirm compute it
 * from the same plan; Confirm commits only when it is unchanged, so what is
 * saved is what was reviewed — never a re-run that quietly chose differently.
 */
export function planFingerprint(duties: readonly Pick<DesiredDuty, "need_key" | "status" | "covering_staff_id">[]): string {
  const canonical = duties
    .map((duty) => `${duty.need_key}=${duty.status}:${duty.covering_staff_id ?? ""}`)
    .sort()
    .join("|");
  return `${duties.length}-${hash53(canonical)}`;
}

/** cyrb53: a small, stable, non-cryptographic string hash. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
