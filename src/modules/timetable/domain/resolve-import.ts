import { t, type Localized } from "@/platform/i18n/language";

import type { ParsedTimetable, ParseProblem } from "@/modules/timetable/domain/parse-timetable";

/**
 * The import dry run: resolve every class label, teacher short name and
 * subject in a parsed sheet against the master data Phase 1 built.
 *
 * Nothing here writes. Its whole job is to answer "can this sheet be
 * published, and if not, what is missing" — and to group what is missing
 * **by the screen that fixes it**, because "Anjana is not a teacher" is not
 * actionable and "add Anjana on the Staff screen" is.
 */

/** Master data, as this module needs to see it. */
export type ResolveContext = {
  /** `timetable_label` (lower-cased) -> fee class id. */
  classesByLabel: Map<string, string>;
  /** `short_name` (lower-cased) -> staff profile id. Active teaching staff. */
  teachersByShortName: Map<string, string>;
  /** Subject `code` (lower-cased) -> subject id. Active subjects. */
  subjectsByCode: Map<string, string>;
};

export type MissingKind = "class" | "teacher" | "subject";

export type Missing = {
  kind: MissingKind;
  /** Exactly as the sheet writes it — what the school has to search for. */
  name: string;
  /** How many cells depend on it. Ordering by this puts the worst first. */
  cells: number;
  /** A couple of places it appears, so the school can find it on the sheet. */
  examples: string[];
};

/** Where each kind of missing thing gets fixed. */
export const FIX_SCREEN: Record<MissingKind, { href: string; label: Localized }> = {
  class: {
    href: "/academics/classes",
    label: t("कक्षा के नाम", "Class labels"),
  },
  teacher: {
    href: "/staff",
    label: t("स्टाफ़", "Staff"),
  },
  subject: {
    href: "/academics/subjects",
    label: t("विषय", "Subjects"),
  },
};

export const MISSING_HINT: Record<MissingKind, Localized> = {
  class: t(
    "इन कक्षाओं का समय-सारिणी वाला नाम तय नहीं है।",
    "These class labels are not mapped to a class yet.",
  ),
  teacher: t(
    "ये अध्यापक स्टाफ़ सूची में नहीं हैं, या उनका संक्षिप्त नाम अलग है।",
    "These teachers are not in the staff list, or their short name differs.",
  ),
  subject: t(
    "ये विषय सूची में नहीं हैं।",
    "These subjects are not in the subject list.",
  ),
};

/** One resolved cell, ready to become a `timetable_slots` row. */
export type ResolvedSlot = {
  day: string;
  /** 0-based. */
  period: number;
  classLabel: string;
  classId: string;
  subjectCode: string;
  subjectId: string;
  teacherShortName: string;
  staffProfileId: string;
  parallel: boolean;
  shared: boolean;
};

export type ImportReport = {
  /** Everything that resolved, ready to write. */
  slots: ResolvedSlot[];
  /** Grouped by kind, worst first within each. */
  missing: Missing[];
  /** Problems the parser found in the sheet itself. */
  problems: ParseProblem[];
  counts: {
    cells: number;
    free: number;
    resolved: number;
    unresolved: number;
  };
  /** Nothing missing and nothing malformed. */
  canPublish: boolean;
};

function addMissing(
  into: Map<string, Missing>,
  kind: MissingKind,
  name: string,
  where: string,
) {
  const key = `${kind}:${name.toLowerCase()}`;
  const existing = into.get(key);

  if (existing) {
    existing.cells += 1;
    if (existing.examples.length < 3 && !existing.examples.includes(where)) {
      existing.examples.push(where);
    }
    return;
  }

  into.set(key, { kind, name, cells: 1, examples: [where] });
}

/**
 * Resolve a parsed sheet against master data.
 *
 * Every cell is attempted even after something is missing: a dry run that
 * stopped at the first unknown teacher would make the school fix one name,
 * re-upload, and find the next — nineteen times.
 */
export function resolveImport(
  parsed: ParsedTimetable,
  context: ResolveContext,
): ImportReport {
  const slots: ResolvedSlot[] = [];
  const missing = new Map<string, Missing>();
  let free = 0;
  let unresolved = 0;

  for (const day of parsed.days) {
    for (const className of parsed.classNames) {
      const row = parsed.timetable[day]?.[className];
      if (!row) continue;

      const classId = context.classesByLabel.get(className.toLowerCase());

      row.forEach((cell, period) => {
        const where = `${day} · ${className} · P${period + 1}`;

        if (cell.free) {
          free += 1;
          return;
        }

        if (!classId) {
          // Reported once per cell so the count reflects how much of the
          // sheet is blocked, but collapsed into one entry by name.
          addMissing(missing, "class", className, where);
          unresolved += 1;
          return;
        }

        // A parallel cell is two lessons: each teacher gets their own subject
        // and their own slot. A shared cell is one lesson taught by several,
        // so every teacher gets a slot with the same subject.
        const pairs = cell.parallel
          ? cell.subjects.map((subject, index) => ({
              subject,
              teacher: cell.teachers[index],
            }))
          : cell.teachers.map((teacher) => ({ subject: cell.subject, teacher }));

        if (pairs.length === 0) {
          // A subject with nobody teaching it. The subject still has to exist,
          // and the missing teacher is the parser's problem to report.
          const subjectId = context.subjectsByCode.get(cell.subject.toLowerCase());
          if (!subjectId) addMissing(missing, "subject", cell.subject, where);
          unresolved += 1;
          return;
        }

        for (const pair of pairs) {
          const subjectId = context.subjectsByCode.get(pair.subject.toLowerCase());
          const staffProfileId = pair.teacher
            ? context.teachersByShortName.get(pair.teacher.toLowerCase())
            : undefined;

          if (!subjectId) addMissing(missing, "subject", pair.subject, where);
          if (pair.teacher && !staffProfileId) {
            addMissing(missing, "teacher", pair.teacher, where);
          }

          if (!subjectId || !staffProfileId) {
            unresolved += 1;
            continue;
          }

          slots.push({
            day,
            period,
            classLabel: className,
            classId,
            subjectCode: pair.subject,
            subjectId,
            teacherShortName: pair.teacher,
            staffProfileId,
            parallel: cell.parallel,
            shared: !cell.parallel && cell.teachers.length > 1,
          });
        }
      });
    }
  }

  // Worst first within each kind, and classes before teachers before
  // subjects: an unmapped class blocks a whole row, a missing teacher blocks
  // one cell.
  const order: MissingKind[] = ["class", "teacher", "subject"];
  const sorted = [...missing.values()].sort((a, b) => {
    const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    if (a.cells !== b.cells) return b.cells - a.cells;
    return a.name.localeCompare(b.name, "en");
  });

  return {
    slots,
    missing: sorted,
    problems: parsed.problems,
    counts: {
      cells: parsed.cellCount,
      free,
      resolved: slots.length,
      unresolved,
    },
    canPublish: sorted.length === 0 && parsed.problems.length === 0,
  };
}

/** Missing things grouped by the screen that fixes them. */
export function groupByFixScreen(
  missing: Missing[],
): { kind: MissingKind; items: Missing[] }[] {
  const groups = new Map<MissingKind, Missing[]>();

  for (const item of missing) {
    const list = groups.get(item.kind) ?? [];
    list.push(item);
    groups.set(item.kind, list);
  }

  return (["class", "teacher", "subject"] as MissingKind[])
    .filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, items: groups.get(kind)! }));
}

/**
 * Build the lookup maps from master data rows.
 *
 * Lower-cased keys throughout, because every unique index behind them is
 * case-insensitive and a sheet written "MATHS" must match a subject coded
 * "Maths".
 */
export function buildContext(input: {
  classAliases: { timetableLabel: string; classId: string }[];
  teachers: { shortName: string; id: string }[];
  subjects: { code: string; id: string }[];
}): ResolveContext {
  return {
    classesByLabel: new Map(
      input.classAliases.map((alias) => [
        alias.timetableLabel.toLowerCase(),
        alias.classId,
      ]),
    ),
    teachersByShortName: new Map(
      input.teachers.map((teacher) => [teacher.shortName.toLowerCase(), teacher.id]),
    ),
    subjectsByCode: new Map(
      input.subjects.map((subject) => [subject.code.toLowerCase(), subject.id]),
    ),
  };
}
