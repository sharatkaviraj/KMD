import { z } from "zod";

import * as m from "@/messages/pairs";
import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Subjects and the class-alias map — pure rules, no database.
 *
 * Both exist for the same reason: the timetable (Phase 2) names things in the
 * school's shorthand and the fee app names them in full. These are the two
 * translation tables, and only the school knows what belongs in them.
 */

/**
 * A subject code as a timetable cell carries it: "MATHS", "SST", "HIN".
 *
 * Folded to upper case for the same reason a staff short name is — it is a
 * join key, the unique index is case-insensitive, and accepting "maths" costs
 * one fewer error message for the same guarantee.
 *
 * Allows a dot and a hyphen because the school's own sheets use "S.ST" and
 * "G-K"; a space is not allowed, since a cell is split on whitespace.
 */
export const SUBJECT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;

export function normalizeSubjectCode(value: string): string {
  return value.trim().toUpperCase();
}

const subjectCode = z
  .string()
  .trim()
  .transform(normalizeSubjectCode)
  .refine((value) => SUBJECT_CODE_PATTERN.test(value), {
    message: encodeMessage(
      t(
        "1–16 अक्षर या अंक, बिना स्पेस",
        "1–16 letters or digits, no spaces (dots and hyphens are fine)",
      ),
    ),
  });

/**
 * `what` arrives as a pair so the field's own name is in the reader's
 * language too — "हिन्दी नाम ज़रूरी है" rather than "Hindi name ज़रूरी है".
 */
const requiredName = (what: Localized) =>
  z
    .string()
    .trim()
    .min(1, {
      message: encodeMessage(
        t(`${what.hi} ज़रूरी है`, `${what.en} is required`),
      ),
    })
    .max(60, {
      message: encodeMessage(
        t(`${what.hi} बहुत लंबा है`, `${what.en} is too long`),
      ),
    });

export const createSubjectSchema = z.object({
  code: subjectCode,
  nameHi: requiredName(m.nameHindi),
  nameEn: requiredName(m.nameEnglish),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

/** `code` is absent: it is immutable, enforced by a trigger. */
export const updateSubjectSchema = createSubjectSchema.omit({ code: true });

export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

export type Subject = {
  id: string;
  code: string;
  nameHi: string;
  nameEn: string;
  isActive: boolean;
  sortOrder: number;
};

export function compareSubjects(a: Subject, b: Subject): number {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.nameEn.localeCompare(b.nameEn, "en");
}

export function matchesSubjectSearch(subject: Subject, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  return (
    subject.code.toLowerCase().includes(needle) ||
    subject.nameEn.toLowerCase().includes(needle) ||
    subject.nameHi.includes(query.trim())
  );
}

/* ------------------------------------------------------------ class alias */

/**
 * A timetable label: "11-S", "5", "NUR".
 *
 * Kept deliberately loose — the school's timetable is a spreadsheet nobody has
 * normalised, and rejecting a label it actually uses would make the Phase 2.2
 * import impossible to complete. The only rules are: no surrounding space, not
 * empty, and short enough to read in a grid cell.
 */
export const TIMETABLE_LABEL_MAX = 12;

export function normalizeTimetableLabel(value: string): string {
  // Collapse inner runs of whitespace so "11  S" and "11 S" are one label.
  return value.trim().replace(/\s+/g, " ");
}

export const classAliasSchema = z.object({
  classId: z.uuid({
    message: encodeMessage(t("कक्षा चुनें", "Choose a class")),
  }),
  timetableLabel: z
    .string()
    .trim()
    .transform(normalizeTimetableLabel)
    .refine((value) => value.length > 0, {
      message: encodeMessage(
        t("समय-सारिणी का नाम ज़रूरी है", "The timetable label is required"),
      ),
    })
    .refine((value) => value.length <= TIMETABLE_LABEL_MAX, {
      message: encodeMessage(
        t(
          `${TIMETABLE_LABEL_MAX} अक्षर तक`,
          `At most ${TIMETABLE_LABEL_MAX} characters`,
        ),
      ),
    }),
  displayName: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export type ClassAliasInput = z.infer<typeof classAliasSchema>;

/** A class as the fee app holds it. Read-only here, always (rule 2). */
export type FeeClass = {
  id: string;
  className: string;
  section: string | null;
  streamName: string | null;
  sortOrder: number;
  sessionLabel: string;
};

export type ClassAlias = {
  id: string;
  classId: string;
  sessionLabel: string;
  timetableLabel: string;
  displayName: string | null;
  sortOrder: number;
};

/** The fee app's name for a class, assembled the way its own screens do. */
export function feeClassName(feeClass: FeeClass): string {
  return [feeClass.className, feeClass.section].filter(Boolean).join(" ");
}

/**
 * A class paired with its alias, if it has one.
 *
 * The screen's whole job is showing which classes are still unmapped, so the
 * unmapped ones are not filtered out — they are the point.
 */
export type ClassWithAlias = {
  feeClass: FeeClass;
  alias: ClassAlias | null;
};

export function joinClassesToAliases(
  classes: FeeClass[],
  aliases: ClassAlias[],
): ClassWithAlias[] {
  const byClassId = new Map(aliases.map((alias) => [alias.classId, alias]));

  return classes
    .map((feeClass) => ({
      feeClass,
      alias: byClassId.get(feeClass.id) ?? null,
    }))
    .sort((a, b) => {
      // Unmapped first: this screen exists to empty that list.
      const aMapped = a.alias ? 1 : 0;
      const bMapped = b.alias ? 1 : 0;
      if (aMapped !== bMapped) return aMapped - bMapped;
      return a.feeClass.sortOrder - b.feeClass.sortOrder;
    });
}

/**
 * Aliases whose class no longer exists in the fee app.
 *
 * There is no foreign key into `public` — one would be a write into the fee
 * app's schema (rule 2, D-5) — so a deleted or re-sessioned class leaves an
 * alias pointing at nothing. Nothing enforces this; something has to notice
 * it, and this is that something.
 */
export function orphanedAliases(
  classes: FeeClass[],
  aliases: ClassAlias[],
): ClassAlias[] {
  const known = new Set(classes.map((feeClass) => feeClass.id));
  return aliases.filter((alias) => !known.has(alias.classId));
}

export function mappingProgress(rows: ClassWithAlias[]): {
  mapped: number;
  total: number;
  complete: boolean;
} {
  const mapped = rows.filter((row) => row.alias).length;
  return { mapped, total: rows.length, complete: rows.length > 0 && mapped === rows.length };
}
