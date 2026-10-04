import { isAbsentAt, type AbsenceIndex } from "@/modules/substitutions/domain/engine";
import type { PlanSlot } from "@/modules/substitutions/domain/plan";

/**
 * The lessons that actually happen in a room, rebuilt from the flat timetable.
 *
 * `timetable_slots` is one row per teacher × class × period. That is the right
 * shape for a class's timetable and the wrong one for cover, and three kinds of
 * lesson show why (PLAN P2, §6):
 *
 *  - **a joint lesson** — one teacher, one subject, several classes at once
 *    (11 Science/Commerce/Arts Hindi). Three rows; one room; one lesson. One
 *    absent teacher is one cover, not three, and the substitute has to be
 *    somebody who can stand in front of *every* one of those classes.
 *  - **a parallel cohort** — "Biology / Maths (X / Y)": one class split in two,
 *    each half with its own teacher. Two rows, two lessons. If both teachers
 *    are away, two cohorts need somebody, not one class.
 *  - **a team block** — ELGA: several teachers sharing several classes. Who
 *    supervises which children is not in the sheet, so whether four of five
 *    teachers are enough is a school rule, not something the rows can say.
 *    Until the school states it, any absence from a team is shown to a person
 *    rather than arranged by the app — Timetable Studio made the same call for
 *    the same reason (`team_block` gets no automatic candidates there).
 *
 * The grouping is derived from facts that force it, never from coincidence:
 * a joint lesson is one *teacher* in several classes in one period — a person
 * cannot be in two rooms, so either it is one room or the timetable is wrong,
 * and the second case is reported as a clash. Two different teachers teaching
 * the same subject at the same time are two lessons, always.
 *
 * Pure, and imports only types plus one engine helper whose module imports
 * nothing — `scripts/seed-scenarios.mjs` loads this tree under Node's type
 * stripping (see `plan.ts`).
 */

export type TeachingEventKind = "ordinary" | "joint" | "parallel_cohort" | "team_block";

export type EventClass = { id: string; label: string };

export type TeachingEvent = {
  /**
   * Stable across reloads and timetable versions for as long as the same
   * arrangement stands: day, period, kind, subject, classes and teachers.
   * Duties and notices hang off it.
   */
  key: string;
  day: string;
  period: number;
  kind: TeachingEventKind;
  /** Every class in the room, in label order. */
  classes: EventClass[];
  subjectCode: string;
  /** Who teaches it. Exactly one, except for a team block. */
  staffIds: string[];
  /** The timetable rows it was built from, as `class|teacher` — provenance. */
  sources: string[];
};

export type TimetableClash = {
  day: string;
  period: number;
  staffId: string;
  /** Two or more different lessons one person is timetabled for at once. */
  eventKeys: string[];
};

const byLabel = (a: EventClass, b: EventClass) =>
  a.label.localeCompare(b.label, "en", { numeric: true }) || a.id.localeCompare(b.id);

function eventKey(event: Omit<TeachingEvent, "key" | "sources">): string {
  return [
    event.day,
    `P${event.period}`,
    event.kind,
    event.subjectCode,
    event.classes.map((entry) => entry.id).join("+"),
    [...event.staffIds].sort().join("+"),
  ].join("|");
}

/** Union-find over class ids, for team blocks that share a teacher. */
function components(pairs: Array<[string, string]>, nodes: string[]): string[][] {
  const parent = new Map(nodes.map((node) => [node, node]));
  const find = (node: string): string => {
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(node, root);
    return root;
  };
  for (const [a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    const root = find(node);
    groups.set(root, [...(groups.get(root) ?? []), node]);
  }
  return [...groups.values()];
}

/**
 * Every physical lesson on one timetable day, and any clash the rows imply.
 */
export function teachingEventsFor(
  slots: readonly PlanSlot[],
  day: string,
): { events: TeachingEvent[]; clashes: TimetableClash[] } {
  const events: TeachingEvent[] = [];
  const periods = new Map<number, PlanSlot[]>();

  for (const slot of slots) {
    if (slot.day !== day) continue;
    periods.set(slot.period, [...(periods.get(slot.period) ?? []), slot]);
  }

  for (const [period, rows] of [...periods.entries()].sort((a, b) => a[0] - b[0])) {
    /* --------------------------------------------------- team blocks */

    // A shared cell is one subject taught by several. The same team across
    // several classes in the same period is one block: classes are joined
    // when they share any teacher in a shared cell of the same subject.
    const shared = rows.filter((row) => row.shared && !row.parallel);
    const bySubject = new Map<string, PlanSlot[]>();
    for (const row of shared) {
      bySubject.set(row.subjectCode, [...(bySubject.get(row.subjectCode) ?? []), row]);
    }
    for (const [subjectCode, group] of bySubject) {
      const classIds = [...new Set(group.map((row) => row.classId))];
      const byTeacher = new Map<string, string[]>();
      for (const row of group) {
        byTeacher.set(row.staffProfileId, [...(byTeacher.get(row.staffProfileId) ?? []), row.classId]);
      }
      const pairs: Array<[string, string]> = [];
      for (const classes of byTeacher.values()) {
        for (let index = 1; index < classes.length; index += 1) pairs.push([classes[0], classes[index]]);
      }
      for (const component of components(pairs, classIds)) {
        const members = group.filter((row) => component.includes(row.classId));
        const classes = [
          ...new Map(members.map((row) => [row.classId, { id: row.classId, label: row.classLabel }])).values(),
        ].sort(byLabel);
        const staffIds = [...new Set(members.map((row) => row.staffProfileId))].sort();
        const base = { day, period, kind: "team_block" as const, classes, subjectCode, staffIds };
        events.push({
          ...base,
          key: eventKey(base),
          sources: members.map((row) => `${row.classId}|${row.staffProfileId}`).sort(),
        });
      }
    }

    /* ------------------------- lessons with one teacher, joint or not */

    const taught = rows.filter((row) => !(row.shared && !row.parallel));
    const byTeacherSubject = new Map<string, PlanSlot[]>();
    for (const row of taught) {
      const key = `${row.staffProfileId}|${row.subjectCode}`;
      byTeacherSubject.set(key, [...(byTeacherSubject.get(key) ?? []), row]);
    }
    for (const group of byTeacherSubject.values()) {
      const classes = [
        ...new Map(group.map((row) => [row.classId, { id: row.classId, label: row.classLabel }])).values(),
      ].sort(byLabel);
      const kind: TeachingEventKind = group.some((row) => row.parallel)
        ? "parallel_cohort"
        : classes.length > 1
          ? "joint"
          : "ordinary";
      const base = {
        day,
        period,
        kind,
        classes,
        subjectCode: group[0].subjectCode,
        staffIds: [group[0].staffProfileId],
      };
      events.push({
        ...base,
        key: eventKey(base),
        sources: group.map((row) => `${row.classId}|${row.staffProfileId}`).sort(),
      });
    }
  }

  /* -------------------------------------------------------- clashes */

  // One person in two different lessons at once. A team member who also
  // appears in a single-teacher lesson in the same period is a clash too.
  const clashes: TimetableClash[] = [];
  const byStaffPeriod = new Map<string, TeachingEvent[]>();
  for (const event of events) {
    for (const staffId of event.staffIds) {
      const key = `${event.period}|${staffId}`;
      byStaffPeriod.set(key, [...(byStaffPeriod.get(key) ?? []), event]);
    }
  }
  for (const [key, list] of byStaffPeriod) {
    if (list.length < 2) continue;
    const [period, staffId] = key.split("|");
    clashes.push({
      day,
      period: Number(period),
      staffId,
      eventKeys: list.map((event) => event.key).sort(),
    });
  }

  events.sort(
    (a, b) =>
      a.period - b.period ||
      byLabel(a.classes[0], b.classes[0]) ||
      a.key.localeCompare(b.key),
  );

  return { events, clashes };
}

/* ------------------------------------------------------- what needs cover */

/**
 * A school rule for a team block: how many of its teachers must be present
 * for the block to run without help. Keyed by subject — ELGA is ELGA whichever
 * day it falls on. A team block with no rule is "unmapped".
 */
export type TeamSupervisionRule = { subjectCode: string; minimumPresent: number };

export type CoverNeedReason =
  | "teacher_absent"
  | "team_below_minimum"
  | "team_unmapped"
  | "whole_team_absent";

export type CoverNeed = {
  /** The event key plus what is needed — stable, so a duty keeps its identity. */
  key: string;
  event: TeachingEvent;
  reason: CoverNeedReason;
  /** Who is away from this lesson. */
  absentStaffIds: string[];
  /**
   * How many people are needed. Null when nobody can say — an unmapped team
   * with some of it present — which is exactly when a person has to look.
   */
  supervisorsNeeded: number | null;
  /**
   * Whether the app may arrange it. A single-teacher lesson, yes. A team, never
   * — who supervises which children is not something the rows record.
   */
  automatic: boolean;
};

export function coverNeedsFor(
  events: readonly TeachingEvent[],
  absences: AbsenceIndex,
  rules: readonly TeamSupervisionRule[] = [],
): CoverNeed[] {
  const ruleFor = new Map(rules.map((rule) => [rule.subjectCode, rule.minimumPresent]));
  const needs: CoverNeed[] = [];

  for (const event of events) {
    const absent = event.staffIds.filter((staffId) => isAbsentAt(absences, staffId, event.period));
    if (absent.length === 0) continue;

    if (event.kind !== "team_block") {
      needs.push({
        key: `${event.key}#lesson`,
        event,
        reason: "teacher_absent",
        absentStaffIds: absent,
        supervisorsNeeded: 1,
        automatic: true,
      });
      continue;
    }

    const present = event.staffIds.length - absent.length;
    const minimum = ruleFor.get(event.subjectCode);

    if (present === 0) {
      needs.push({
        key: `${event.key}#team`,
        event,
        reason: "whole_team_absent",
        absentStaffIds: absent,
        supervisorsNeeded: minimum ?? 1,
        automatic: false,
      });
    } else if (minimum === undefined) {
      needs.push({
        key: `${event.key}#team`,
        event,
        reason: "team_unmapped",
        absentStaffIds: absent,
        supervisorsNeeded: null,
        automatic: false,
      });
    } else if (present < minimum) {
      needs.push({
        key: `${event.key}#team`,
        event,
        reason: "team_below_minimum",
        absentStaffIds: absent,
        supervisorsNeeded: minimum - present,
        automatic: false,
      });
    }
    // present >= minimum: the team absorbs it, by the school's own rule.
  }

  return needs;
}

/* ------------------------------------------------------ for the rules page */

export type TeamBlockSummary = {
  subjectCode: string;
  /** How many periods a week this team runs. */
  blocks: number;
  smallestTeam: number;
  largestTeam: number;
  classLabels: string[];
};

/**
 * Every team block in the week, by subject, so a coordinator can see what a
 * rule would apply to before writing one. Labels in school order.
 */
export function teamBlockSummary(events: readonly TeachingEvent[]): TeamBlockSummary[] {
  const bySubject = new Map<string, TeachingEvent[]>();
  for (const event of events) {
    if (event.kind !== "team_block") continue;
    bySubject.set(event.subjectCode, [...(bySubject.get(event.subjectCode) ?? []), event]);
  }
  return [...bySubject.entries()]
    .map(([subjectCode, list]) => ({
      subjectCode,
      blocks: list.length,
      smallestTeam: Math.min(...list.map((event) => event.staffIds.length)),
      largestTeam: Math.max(...list.map((event) => event.staffIds.length)),
      classLabels: [
        ...new Map(list.flatMap((event) => event.classes).map((entry) => [entry.id, entry])).values(),
      ]
        .sort(byLabel)
        .map((entry) => entry.label),
    }))
    .sort((a, b) => a.subjectCode.localeCompare(b.subjectCode));
}

export function eventCounts(events: readonly TeachingEvent[]): Record<TeachingEventKind, number> {
  const counts: Record<TeachingEventKind, number> = {
    ordinary: 0,
    joint: 0,
    parallel_cohort: 0,
    team_block: 0,
  };
  for (const event of events) counts[event.kind] += 1;
  return counts;
}
