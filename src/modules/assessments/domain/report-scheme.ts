import { z } from "zod";

import { GRADE_BANDS } from "@/modules/assessments/domain/assessments";
import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * How one term's report cards are worked out and what they print (P8).
 *
 * A card is issued only against an **approved** scheme, and keeps which one.
 * The scheme holds the rules a family's numbers depend on — the grade bands,
 * how many decimals the percentage is rounded to and that it is rounded
 * *before* it is graded, the attendance period, and the header and signature
 * lines — so a school that changes its bands next term does not move a card
 * already handed out.
 *
 * Nobody at the school has confirmed its bands yet. The default is the
 * CBSE-style set this app has always shown, and the scheme screen says so.
 */

export type GradeBandRule = { from: number; label: string; hi: string; en: string };

export type ReportScheme = {
  id: string;
  sessionLabel: string;
  term: string;
  revision: number;
  status: "draft" | "approved";
  gradeBands: GradeBandRule[];
  percentDecimals: number;
  passPercent: number | null;
  attendanceFrom: string | null;
  attendanceTo: string | null;
  headerEn: string | null;
  headerHi: string | null;
  signatories: { en: string; hi: string }[];
  approvedByName: string | null;
  approvedAt: string | null;
};

export const DEFAULT_GRADE_BANDS: GradeBandRule[] = GRADE_BANDS.map((band) => ({
  from: band.from,
  label: band.label,
  hi: band.description.hi,
  en: band.description.en,
}));

/**
 * Round half up at a fixed number of decimals.
 *
 * Half up, and on the decimal value rather than the binary one: 32.95 to one
 * place is 33.0, because that is what a teacher with a calculator gets — not
 * 32.9, which is what `Math.round(32.95 * 10) / 10` says because 32.95 is
 * stored as 32.9499999….
 */
export function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // Snap away the binary fuzz at a precision far below anything printed.
  const scaled = Math.round(value * factor * 1e6) / 1e6;
  return Math.floor(scaled + 0.5) / factor;
}

/**
 * The percentage a card prints and grades: the unrounded fraction, rounded
 * once, at the school's boundary.
 */
export function schemePercent(ratio: number | null, decimals: number): number | null {
  return ratio === null ? null : roundHalfUp(ratio * 100, decimals);
}

/** The band a rounded percentage falls into: the highest whose floor it reaches. */
export function gradeWith(percent: number | null, bands: GradeBandRule[]): GradeBandRule | null {
  if (percent === null) return null;
  return [...bands].sort((a, b) => b.from - a.from).find((band) => percent >= band.from) ?? null;
}

/* ------------------------------------------------------- the bands as text */

/**
 * Bands as the scheme screen shows them, one per line:
 * `91 A1 Outstanding | उत्कृष्ट`. Plain text because a coordinator types a
 * school's bands from a printed circular, and a table of inputs is slower.
 */
export function bandsToText(bands: GradeBandRule[]): string {
  return [...bands]
    .sort((a, b) => b.from - a.from)
    .map((band) => `${band.from} ${band.label} ${band.en} | ${band.hi}`)
    .join("\n");
}

export type BandsParse = { ok: true; bands: GradeBandRule[] } | { ok: false; line: number; error: Localized };

export function parseBands(text: string): BandsParse {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { ok: false, line: 0, error: t("कम से कम एक श्रेणी लिखें", "Write at least one band") };
  }
  const bands: GradeBandRule[] = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(\d+(?:\.\d+)?)\s+(\S+)\s+([^|]*?)\s*(?:\|\s*(.*))?$/);
    const from = match ? Number(match[1]) : NaN;
    if (!match || !Number.isFinite(from) || from < 0 || from > 100) {
      return {
        ok: false,
        line: index + 1,
        error: t(
          `पंक्ति ${index + 1}: "91 A1 Outstanding | उत्कृष्ट" जैसा लिखें`,
          `Line ${index + 1}: write it like "91 A1 Outstanding | <the Hindi word>"`,
        ),
      };
    }
    bands.push({ from, label: match[2], en: match[3].trim(), hi: (match[4] ?? match[3]).trim() });
  }
  const floors = bands.map((band) => band.from);
  if (new Set(floors).size !== floors.length) {
    return { ok: false, line: 0, error: t("दो श्रेणियों का एक ही आरंभ है", "Two bands start at the same percentage") };
  }
  if (!floors.includes(0)) {
    return {
      ok: false,
      line: 0,
      error: t("सबसे नीचे की श्रेणी 0 से शुरू हो", "The lowest band must start at 0, so every percentage has a grade"),
    };
  }
  return { ok: true, bands: bands.sort((a, b) => b.from - a.from) };
}

/* ------------------------------------------------------------ the form */

const optionalDay = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: encodeMessage(t("तारीख़ ठीक नहीं", "That is not a date")),
  });

export const reportSchemeSchema = z
  .object({
    term: z.string().trim().min(1).max(80),
    bandsText: z.string().max(2000),
    percentDecimals: z.coerce.number().int().min(0).max(2),
    passPercent: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : Number(value)))
      .refine((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 100), {
        message: encodeMessage(t("0 से 100 के बीच", "Between 0 and 100")),
      }),
    attendanceFrom: optionalDay,
    attendanceTo: optionalDay,
    headerEn: z.string().trim().max(200),
    headerHi: z.string().trim().max(200),
    signatoriesText: z.string().max(600),
  })
  .refine(
    (value) => !value.attendanceFrom || !value.attendanceTo || value.attendanceTo >= value.attendanceFrom,
    {
      message: encodeMessage(t("अवधि का अंत आरंभ से पहले है", "The period ends before it starts")),
      path: ["attendanceTo"],
    },
  );

/** "Class teacher | कक्षा अध्यापक", one per line. */
export function parseSignatories(text: string): { en: string; hi: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => {
      const [en, hi] = line.split("|").map((part) => part.trim());
      return { en, hi: hi || en };
    });
}

export function signatoriesToText(list: { en: string; hi: string }[]): string {
  return list.map((entry) => `${entry.en} | ${entry.hi}`).join("\n");
}
