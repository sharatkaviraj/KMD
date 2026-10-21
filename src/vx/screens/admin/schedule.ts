/**
 * "Scheduled now" on the admin's Today: which class has which subject with
 * which teacher in the period running and the one after it, from the
 * published timetable with today's cover laid over it.
 *
 * Scheduled, not taught. Nothing records that a lesson was delivered, so this
 * says what the timetable and the cover board say should be happening.
 *
 * Pure — no database, no React, no clock of its own: the caller passes the
 * bells, the slots and "now" in school minutes. Unit-tested in
 * `tests/vx-admin-schedule.test.ts`.
 */

import { periodPhases } from "@/vx/screens/teach/domain/teach";

/** One row of `timetable_slots` for today's day block. One teacher, one class, one period. */
export type ScheduleSlot = {
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string;
  staffProfileId: string;
  teacherShortName: string;
  shared: boolean;
  parallel: boolean;
};

export type ScheduleBell = { index: number; starts: string; ends: string };

/** The parts of a cover duty this card reads. Cancelled and superseded duties are ignored. */
export type ScheduleDuty = {
  period: number;
  classIds: readonly string[];
  absentStaffIds: readonly string[];
  status: "assigned" | "needs_help" | "cancelled" | "superseded";
  coveringStaffId: string | null;
};

/** An absence; an empty period list is the whole day, as the cover engine reads it. */
export type ScheduleAbsence = { staffProfileId: string; periods: readonly number[] };

/**
 * A teacher's standing in one period. `null` is in school and teaching;
 * "away" is marked absent with no cover duty on record (the cover board may
 * not need one, for instance when a co-teacher of a shared lesson is in).
 */
export type TeacherCover = { state: "covered"; by: string } | { state: "needed" } | { state: "away" } | null;

export type ScheduledTeacher = { id: string; name: string; subjectCode: string; cover: TeacherCover };

/**
 * single   — one class, one subject, one teacher
 * combined — one teacher with several classes at once (ELGA, games)
 * shared   — one lesson taught by several teachers together
 * parallel — one class split across subjects, each with its own teacher
 */
export type ActivityKind = "single" | "combined" | "shared" | "parallel";

export type ScheduledActivity = {
  key: string;
  kind: ActivityKind;
  classes: { id: string; label: string }[];
  subjects: string[];
  teachers: ScheduledTeacher[];
};

export type ScheduledPeriod = {
  index: number;
  /** 1-based, as the school says it. */
  number: number;
  starts: string;
  ends: string;
  activities: ScheduledActivity[];
  /** Teachers away with a substitute still to find. */
  uncovered: number;
  /** Teachers away with a substitute named. */
  covered: number;
};

export type ScheduleView =
  | { state: "closed" }
  | { state: "no_teaching" }
  | { state: "no_timetable" }
  | { state: "before"; next: ScheduledPeriod }
  | { state: "during"; now: ScheduledPeriod; next: ScheduledPeriod | null }
  | { state: "break"; next: ScheduledPeriod }
  | { state: "after"; lastEnds: string };

/** A cover duty as Today's teaching-exceptions list shows it. */
export type CoverException = {
  period: number;
  time: string | null;
  classes: string;
  subject: string;
  away: string;
  state: "needed" | "covered";
  by: string | null;
};

export type ScheduleInput = {
  bells: readonly ScheduleBell[];
  nowMinutes: number;
  /** The calendar says school is open today. */
  schoolOpen: boolean;
  /** The calendar says the timetable runs today (an exam or event day is open and does not teach). */
  timetableRuns: boolean;
  /** Today's slots from the published version; empty when nothing is published for this weekday. */
  slots: readonly ScheduleSlot[];
  duties: readonly ScheduleDuty[];
  absences: readonly ScheduleAbsence[];
  /** Staff display names by profile id; a slot's short name is the fallback. */
  names: ReadonlyMap<string, string>;
  /** Position of each class in the school's order (Nursery first). */
  classRank: ReadonlyMap<string, number>;
};

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * One period's slots grouped into the activities they are.
 *
 * Several rows in one period are one activity only when the timetable says
 * so — never because two rows happen to look alike:
 *
 * - the same teacher with the same subject in several classes is one
 *   combined lesson (she is in one room, not five);
 * - rows the importer flagged `shared` in one class with one subject are one
 *   lesson with several teachers;
 * - rows flagged `parallel` in one class are one split class.
 *
 * Two teachers with the same subject in two different classes stay two
 * activities, and so do two different subjects in one class that are not
 * flagged parallel — that is a clash, and merging it would hide it.
 */
export function groupActivities(slots: readonly ScheduleSlot[]): ScheduleSlot[][] {
  const parent = slots.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i];
      const b = slots[j];
      if (a.period !== b.period) continue;
      const sameSubject = sameText(a.subjectCode, b.subjectCode);
      const sameClass = a.classId === b.classId;
      if (sameSubject && a.staffProfileId === b.staffProfileId) join(i, j);
      else if (sameClass && sameSubject && a.shared && b.shared) join(i, j);
      else if (sameClass && a.parallel && b.parallel) join(i, j);
    }
  }

  const groups = new Map<number, ScheduleSlot[]>();
  slots.forEach((slot, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(slot);
    groups.set(root, list);
  });
  return [...groups.values()];
}

function isAway(absences: readonly ScheduleAbsence[], staffId: string, period: number): boolean {
  return absences.some((a) => a.staffProfileId === staffId && (a.periods.length === 0 || a.periods.includes(period)));
}

/** The live duty for this teacher in this period and these classes, if the cover board has one. */
function dutyFor(duties: readonly ScheduleDuty[], staffId: string, period: number, classIds: ReadonlySet<string>): ScheduleDuty | null {
  return (
    duties.find(
      (d) =>
        (d.status === "assigned" || d.status === "needs_help") &&
        d.period === period &&
        d.absentStaffIds.includes(staffId) &&
        d.classIds.some((id) => classIds.has(id)),
    ) ?? null
  );
}

/** One period of the day: its activities in school order, with cover applied. */
export function scheduledPeriod(bell: ScheduleBell, input: Omit<ScheduleInput, "bells" | "nowMinutes" | "schoolOpen" | "timetableRuns">): ScheduledPeriod {
  const inPeriod = input.slots.filter((slot) => slot.period === bell.index);
  const rank = (id: string) => input.classRank.get(id) ?? 999;

  const activities: ScheduledActivity[] = groupActivities(inPeriod).map((group) => {
    const classes: { id: string; label: string }[] = [];
    for (const slot of group) if (!classes.some((c) => c.id === slot.classId)) classes.push({ id: slot.classId, label: slot.classLabel });
    classes.sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label, "en", { numeric: true }));
    const classIds = new Set(classes.map((c) => c.id));

    const subjects: string[] = [];
    for (const slot of group) if (!subjects.some((s) => sameText(s, slot.subjectCode))) subjects.push(slot.subjectCode);

    const teachers: ScheduledTeacher[] = [];
    for (const slot of group) {
      if (teachers.some((t) => t.id === slot.staffProfileId)) continue;
      const duty = dutyFor(input.duties, slot.staffProfileId, bell.index, classIds);
      const cover: TeacherCover = duty
        ? duty.status === "assigned"
          ? { state: "covered", by: duty.coveringStaffId ? (input.names.get(duty.coveringStaffId) ?? "—") : "—" }
          : { state: "needed" }
        : isAway(input.absences, slot.staffProfileId, bell.index)
          ? { state: "away" }
          : null;
      teachers.push({
        id: slot.staffProfileId,
        name: input.names.get(slot.staffProfileId) ?? slot.teacherShortName,
        subjectCode: slot.subjectCode,
        cover,
      });
    }

    const kind: ActivityKind = group.some((s) => s.parallel)
      ? "parallel"
      : teachers.length > 1
        ? "shared"
        : classes.length > 1
          ? "combined"
          : "single";

    return {
      key: `${bell.index}:${classes.map((c) => c.id).join(",")}:${teachers.map((t) => t.id).join(",")}`,
      kind,
      classes,
      subjects,
      teachers,
    };
  });

  activities.sort((a, b) => {
    const ra = Math.min(...a.classes.map((c) => rank(c.id)));
    const rb = Math.min(...b.classes.map((c) => rank(c.id)));
    return ra - rb || (a.classes[0]?.label ?? "").localeCompare(b.classes[0]?.label ?? "", "en", { numeric: true }) || a.subjects.join().localeCompare(b.subjects.join(), "en");
  });

  const all = activities.flatMap((a) => a.teachers);
  return {
    index: bell.index,
    number: bell.index + 1,
    starts: bell.starts,
    ends: bell.ends,
    activities,
    uncovered: all.filter((t) => t.cover?.state === "needed").length,
    covered: all.filter((t) => t.cover?.state === "covered").length,
  };
}

/**
 * The lessons a phone shows before "Show all": every one with a cover change,
 * then the first others in school order, up to `limit`. Folding away a single
 * row saves nothing, so a list at most one longer than the limit shows whole.
 */
export function foldedKeys(activities: readonly ScheduledActivity[], limit: number): ReadonlySet<string> {
  if (activities.length <= limit + 1) return new Set(activities.map((a) => a.key));
  const shown = new Set(activities.filter((a) => a.teachers.some((t) => t.cover !== null)).map((a) => a.key));
  for (const activity of activities) {
    if (shown.size >= limit) break;
    shown.add(activity.key);
  }
  return shown;
}

/**
 * The card's state at `nowMinutes`. A closed day, a day the timetable does
 * not run and a day with nothing published each say so plainly rather than
 * showing an empty list that reads as "nobody is teaching".
 */
export function scheduleNow(input: ScheduleInput): ScheduleView {
  if (!input.schoolOpen) return { state: "closed" };
  if (!input.timetableRuns) return { state: "no_teaching" };
  if (input.slots.length === 0 || input.bells.length === 0) return { state: "no_timetable" };

  const bells = [...input.bells].sort((a, b) => toMin(a.starts) - toMin(b.starts));
  const phases = periodPhases(
    bells.map((b) => ({ period: b.index, starts: b.starts, ends: b.ends })),
    input.nowMinutes,
  );
  const nowAt = phases.indexOf("now");
  const nextAt = phases.indexOf("next");
  const build = (i: number) => scheduledPeriod(bells[i], input);

  if (nowAt >= 0) return { state: "during", now: build(nowAt), next: nextAt >= 0 ? build(nextAt) : null };
  if (nextAt === 0) return { state: "before", next: build(0) };
  if (nextAt > 0) return { state: "break", next: build(nextAt) };
  return { state: "after", lastEnds: bells[bells.length - 1].ends };
}

/**
 * Lessons an absent teacher leaves with no cover duty at all — the ones whose
 * period had begun before cover could be arranged. Today counted only duties,
 * so a teacher away with three such periods read "No cover needed" (admin
 * run, 20 Oct). One per teacher per period; a shared lesson is left out,
 * because its co-teacher is in the room and the cover board makes no duty.
 */
export function uncoveredLessons(
  slots: readonly Pick<ScheduleSlot, "period" | "staffProfileId" | "shared">[],
  duties: readonly Pick<ScheduleDuty, "period" | "absentStaffIds" | "status">[],
  absences: readonly ScheduleAbsence[],
): number {
  const seen = new Set<string>();
  for (const absence of absences) {
    const away = new Set(absence.periods);
    for (const slot of slots) {
      if (slot.staffProfileId !== absence.staffProfileId || slot.shared) continue;
      if (away.size > 0 && !away.has(slot.period)) continue;
      const hasDuty = duties.some(
        (duty) =>
          duty.period === slot.period &&
          (duty.status === "assigned" || duty.status === "needs_help") &&
          duty.absentStaffIds.includes(absence.staffProfileId),
      );
      if (!hasDuty) seen.add(`${absence.staffProfileId}|${slot.period}`);
    }
  }
  return seen.size;
}

/** The away tile's line under the count: what is covered, what is not, never "no cover needed" over a gap. */
export function coverStanding(cover: { needed: number; arranged: number; missed: number }): { short: number; tone: "ok" | "warn" | "none" } {
  const short = Math.max(0, cover.needed - cover.arranged);
  return { short, tone: cover.needed === 0 ? "none" : short > 0 ? "warn" : "ok" };
}

/** Today's cover figures from the live duties, today's slots and the absences. */
export function coverToday(
  duties: readonly Pick<ScheduleDuty, "period" | "absentStaffIds" | "status">[],
  slots: readonly Pick<ScheduleSlot, "period" | "staffProfileId" | "shared">[],
  absences: readonly ScheduleAbsence[],
): { needed: number; arranged: number; missed: number } {
  const missed = uncoveredLessons(slots, duties, absences);
  const live = duties.filter((duty) => duty.status === "assigned" || duty.status === "needs_help");
  return { needed: live.length + missed, arranged: live.filter((duty) => duty.status === "assigned").length, missed };
}
