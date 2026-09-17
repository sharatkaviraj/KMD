import {
  isAbsentAt,
  type AbsenceIndex,
  type TeacherDetail,
  type TeacherSchedule,
  type Vacancy,
} from "@/modules/substitutions/domain/engine";
import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";

/**
 * Between the timetable and the engine.
 *
 * The engine knows nothing about this school: it takes profiles, absences and
 * vacancies, and hands back an allocation. Everything that turns
 * `timetable_slots` into those three things lives here, with tests, because it
 * is where the school's own vocabulary — shared blocks, parallel electives,
 * combined sections — decides what counts as a period nobody is teaching.
 *
 * It imports only types and one constant, both from modules that import
 * nothing themselves. That is deliberate: `scripts/seed-scenarios.mjs` loads
 * this straight from source under Node's type stripping, and a `@/` alias
 * pointing at anything with a real dependency would need a bundler to follow.
 * The labels live in `labels.ts` for the same reason.
 */

export { PERIOD_COUNT };

export type PlanSlot = {
  day: string;
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string;
  staffProfileId: string;
  teacherShortName: string;
  parallel: boolean;
  shared: boolean;
};

export type VacancyWithIds = Vacancy & {
  slotId: string;
  classId: string;
  originalStaffId: string | null;
};

/**
 * The periods nobody is left to teach.
 *
 * Two of the school's own cell shapes decide this, and they pull in opposite
 * directions:
 *
 *  - **a shared block is one activity taught by several.** ELGA is five
 *    teachers and one room; if one is away the other four absorb it and the
 *    children are taught. Calling that a vacancy would send a sixth teacher to
 *    a room that already has four.
 *  - **a parallel elective is two lessons side by side**, one cohort each.
 *    "Biology / Maths (X / Y)" is not co-teaching: if the Biology teacher is
 *    away, that cohort has nobody, even though somebody else is standing in
 *    the same room teaching Maths.
 *
 * So: a shared group is a vacancy only when *everyone* is away; a parallel
 * group is a vacancy when *anyone* is.
 *
 * One vacancy per class and period, even when both halves of a parallel cell
 * are away — the room needs one cover teacher, and the database says the same
 * thing with a unique index on (plan, class, period).
 */
export function vacanciesFor(
  slots: PlanSlot[],
  day: string,
  absences: AbsenceIndex,
): VacancyWithIds[] {
  const groups = new Map<string, PlanSlot[]>();

  for (const slot of slots) {
    if (slot.day !== day) continue;
    const key = `${slot.classId}|${slot.period}`;
    const group = groups.get(key) ?? [];
    group.push(slot);
    groups.set(key, group);
  }

  const vacancies: VacancyWithIds[] = [];

  for (const [key, group] of groups) {
    const away = group.filter((slot) =>
      isAbsentAt(absences, slot.staffProfileId, slot.period),
    );
    if (away.length === 0) continue;

    const parallel = group.some((slot) => slot.parallel);
    const everybodyAway = away.length === group.length;

    if (!parallel && !everybodyAway) continue;

    // The first absent teacher names the vacancy: their subject is the one
    // that lost its teacher, which is what a cover sheet has to say.
    const lead = away[0];

    vacancies.push({
      slotId: key,
      classId: lead.classId,
      className: lead.classLabel,
      periodIndex: lead.period,
      subject: lead.subjectCode,
      originalTeacher: lead.staffProfileId,
      originalStaffId: lead.staffProfileId,
    });
  }

  return vacancies.sort(
    (a, b) => a.periodIndex - b.periodIndex || a.className.localeCompare(b.className),
  );
}

/**
 * Every teacher's week, in the shape `buildTeacherProfiles` reads.
 *
 * Keyed by staff profile id rather than by name — the engine treats its keys
 * as opaque, so the whole plan can be computed without a single display name
 * and the result joined back for the screen.
 */
export function teacherDetailsFrom(
  slots: PlanSlot[],
  days: string[],
): Record<string, TeacherDetail> {
  const details: Record<string, TeacherDetail> = {};

  const blank = (): TeacherSchedule =>
    Object.fromEntries(days.map((day) => [day, Array(PERIOD_COUNT).fill(null)]));

  for (const slot of slots) {
    if (!details[slot.staffProfileId]) {
      details[slot.staffProfileId] = {
        subjects: new Set<string>(),
        schedule: blank(),
      };
    }

    const detail = details[slot.staffProfileId];
    (detail.subjects as Set<string>).add(slot.subjectCode);

    const schedule = detail.schedule!;
    if (!schedule[slot.day]) schedule[slot.day] = Array(PERIOD_COUNT).fill(null);

    schedule[slot.day][slot.period] = {
      subject: slot.subjectCode,
      className: slot.classLabel,
    };
  }

  return details;
}

export type Host = {
  className: string;
  classId: string;
  teacher: string | null;
  substituted: boolean;
};

/**
 * Who is still teaching in a period — the hosts a stranded class could join.
 *
 * A class whose own teacher is away and who has been given a substitute is a
 * poorer host than one with its own teacher, and `chooseMergeHost()` knows
 * that; this is where the flag comes from.
 */
export function hostsInPeriod(
  slots: PlanSlot[],
  day: string,
  period: number,
  absences: AbsenceIndex,
  covered: Map<string, string>,
): Host[] {
  const byClass = new Map<string, Host>();

  for (const slot of slots) {
    if (slot.day !== day || slot.period !== period) continue;

    const key = `${slot.classId}|${slot.period}`;
    const cover = covered.get(key);
    const away = isAbsentAt(absences, slot.staffProfileId, period);
    const existing = byClass.get(slot.classId);

    // A class counts as taught if anybody in the group is still there.
    const teacher = cover ?? (away ? (existing?.teacher ?? null) : slot.staffProfileId);

    byClass.set(slot.classId, {
      className: slot.classLabel,
      classId: slot.classId,
      teacher,
      substituted: Boolean(cover) || (existing?.substituted ?? false),
    });
  }

  return [...byClass.values()];
}

/* ------------------------------------------------------------- summaries */

export type PlanCounts = {
  vacancies: number;
  covered: number;
  selfStudy: number;
  merged: number;
  open: number;
  needsReview: number;
};

export function planCounts(
  rows: { kind: string; source: string; coveringStaffId: string | null }[],
  vacancies: number,
): PlanCounts {
  const covered = rows.filter((row) => row.kind === "cover").length;
  const selfStudy = rows.filter((row) => row.kind === "self_study").length;
  const merged = rows.filter((row) => row.kind === "merged").length;

  return {
    vacancies,
    covered,
    selfStudy,
    merged,
    open: Math.max(0, vacancies - rows.length),
    needsReview: rows.filter((row) => row.source === "suggestion").length,
  };
}

/**
 * How many covers each teacher has done lately.
 *
 * Feeds the engine's history penalty, which is what stops the same willing
 * teacher being asked every week. Counted over whatever window the caller
 * queried — the engine caps the penalty anyway, so a long window cannot turn
 * into a permanent demotion.
 */
export function coverHistoryFrom(
  rows: { coveringStaffId: string | null }[],
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (!row.coveringStaffId) continue;
    counts[row.coveringStaffId] = (counts[row.coveringStaffId] ?? 0) + 1;
  }

  return counts;
}

/** Whole-day absence, as the periods the engine wants. */
export const WHOLE_DAY = Array.from({ length: PERIOD_COUNT }, (_, index) => index);

export function isWholeDay(periods: number[]): boolean {
  return periods.length === PERIOD_COUNT;
}

/** "P1–P4" / "P2, P5" — how a half day reads on a screen. */
export function describePeriods(periods: number[]): string {
  if (periods.length === 0) return "—";
  if (isWholeDay(periods)) return "P1–P8";

  const sorted = [...periods].sort((a, b) => a - b);
  const runs: number[][] = [];

  for (const period of sorted) {
    const last = runs[runs.length - 1];
    if (last && period === last[last.length - 1] + 1) last.push(period);
    else runs.push([period]);
  }

  return runs
    .map((run) =>
      run.length === 1 ? `P${run[0] + 1}` : `P${run[0] + 1}–P${run[run.length - 1] + 1}`,
    )
    .join(", ");
}
