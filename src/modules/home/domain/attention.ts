import { m } from "@/messages";
import type { StaffRole } from "@/platform/auth/permissions";
import type { Localized } from "@/platform/i18n/language";

/**
 * What needs attention, who it belongs to, and where to go about it.
 *
 * PLAN §3 asks the admin home for "exceptions with counts and owners" and the
 * office home for "actionable queues with owners". The owner is the part worth
 * insisting on: a number with no name beside it is somebody else's problem to
 * everybody who reads it, and the register that has not come in belongs to a
 * teacher, not to whoever happens to have the dashboard open.
 *
 * Pure: it takes counts somebody else read and decides what each role sees. No
 * database, so every rule below is testable and none of them is hidden in a
 * query.
 */

export type AttentionKey =
  | "registers"
  | "absences"
  | "review"
  | "jobs";

export type AttentionFacts = {
  /** Classes whose daily register has not been submitted today. */
  registersOutstanding: number;
  /**
   * Whether the school is open today at all.
   *
   * A closed day has no register to take, so `registersOutstanding` is 0 —
   * and the row has to say *why* it is 0, or "0 of 19, whose work: teachers"
   * reads as nineteen teachers who have already finished.
   */
  schoolOpenToday: boolean;
  /** Classes the school has, so "3 of 19" can be said rather than "3". */
  classesTotal: number;
  /** Staff marked away today. */
  absencesToday: number;
  /** Collection answers waiting for a decision. */
  pendingSubmissions: number;
  /** Scheduled jobs whose most recent attempt failed. */
  failedJobs: number;
  /**
   * Null when a count could not be read at all.
   *
   * **Unavailable is not zero.** A failed query that renders as 0 tells an
   * administrator the school has nothing outstanding, which is the one wrong
   * answer a dashboard can give (D-93).
   */
  unavailable?: readonly AttentionKey[];
};

export type AttentionItem = {
  key: AttentionKey;
  label: Localized;
  /** Null renders as "—", never as 0. */
  count: number | null;
  /** Context for the figure — "of 19", "today". */
  detail: Localized | null;
  /** Whose work this is. */
  owner: Localized;
  href: string;
  tone: "warning" | "neutral";
};

/** Which items each role is shown, in the order PLAN §3 puts them. */
const FOR_ROLE: Record<StaffRole, readonly AttentionKey[]> = {
  // "Attendance gaps, uncovered periods, review/marks backlog, failed jobs."
  admin: ["registers", "absences", "review", "jobs"],
  // "Changes to review, request batches, attendance on behalf."
  office: ["review", "registers", "absences"],
  // The fee desk's exceptions are dues and defaulters, and those live on the
  // fee screens where the figures actually are. A register backlog is not
  // this person's work and putting it here would only be noise they cannot
  // act on.
  accountant: [],
  fee_collector: [],
  // "Uncovered periods, timetable changes, absent staff, class attendance gaps."
  academic_coordinator: ["absences", "registers"],
  // "Exams in progress, incomplete papers, report readiness" — none of which
  // has a cheap count yet, so this role gets no queue rather than a wrong one.
  exam_coordinator: [],
  // A teacher's home is `/teach`, not this one. Her exceptions are her own
  // register and her own cover, and they are already the top of that screen;
  // a second list of the school's would be somebody else's work on her phone.
  teacher: [],
  // "Read-only information": figures, not a work queue.
  view_only: [],
};

export function attentionFor(
  role: StaffRole,
  facts: AttentionFacts,
  options: { canMarkOnBehalf: boolean },
): AttentionItem[] {
  const unavailable = new Set(facts.unavailable ?? []);
  const count = (key: AttentionKey, value: number) =>
    unavailable.has(key) ? null : value;

  const all: Record<AttentionKey, AttentionItem> = {
    registers: {
      key: "registers",
      label: m.homeRegistersOutstanding,
      count: count("registers", facts.registersOutstanding),
      detail: unavailable.has("registers")
        ? null
        : facts.schoolOpenToday
          ? countOfClasses(facts.registersOutstanding, facts.classesTotal)
          // "0 of 19" on a Sunday reads as nineteen teachers who have
          // already finished. They have not; there was nothing to do.
          : m.homeSchoolClosedToday,
      owner: m.homeOwnerTeachers,
      // Somebody who may mark on behalf is sent where they can do something
      // about it; everybody else to the register they can read.
      href: options.canMarkOnBehalf ? "/teach/attendance" : "/teach/register",
      tone: facts.registersOutstanding > 0 ? "warning" : "neutral",
    },
    absences: {
      key: "absences",
      label: m.homeStaffAway,
      count: count("absences", facts.absencesToday),
      detail: m.homeToday,
      owner: m.homeOwnerCoordinator,
      href: "/substitutions",
      tone: facts.absencesToday > 0 ? "warning" : "neutral",
    },
    review: {
      key: "review",
      label: m.homeChangesToReview,
      count: count("review", facts.pendingSubmissions),
      detail: null,
      owner: m.homeOwnerOffice,
      href: "/collection/review",
      tone: facts.pendingSubmissions > 0 ? "warning" : "neutral",
    },
    jobs: {
      key: "jobs",
      label: m.homeJobsFailed,
      count: count("jobs", facts.failedJobs),
      detail: null,
      owner: m.homeOwnerAdmin,
      href: "/jobs",
      tone: facts.failedJobs > 0 ? "warning" : "neutral",
    },
  };

  return FOR_ROLE[role].map((key) => all[key]);
}

/**
 * Whether anything on this list actually wants doing.
 *
 * A queue of five noughts is not an empty queue — it is five pieces of good
 * news, and the screen should say so once rather than five times.
 */
export function needsAttention(items: readonly AttentionItem[]): boolean {
  return items.some((item) => item.count === null || item.count > 0);
}

/**
 * "of 19", so a figure has a denominator.
 *
 * Three registers outstanding out of nineteen classes and three out of four are
 * different mornings, and the number on its own does not say which.
 */
function countOfClasses(outstanding: number, total: number): Localized | null {
  if (total <= 0) return null;

  return {
    hi: `${total} में से`,
    en: `of ${total}`,
  };
}
