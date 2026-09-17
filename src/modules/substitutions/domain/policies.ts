import { z } from "zod";

import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Who may be asked to cover, and when they are in the building.
 *
 * The engine this was ported from shipped both as constants in its source,
 * with a real teacher's part-time hours written into the file. Rule 6 forbids
 * that here, and a school that cannot change its own hours without a deploy is
 * worse off anyway — so these are rows a coordinator edits (task 4.4).
 */

export const coverRoles = ["normal", "duty", "reserve"] as const;
export type CoverRole = (typeof coverRoles)[number];

export const coverRoleLabels: Record<CoverRole, Localized> = {
  normal: t("सामान्य", "Ordinary"),
  duty: t("प्रभारी", "Duty-holder"),
  reserve: t("कार्यालय", "Office / reserve"),
};

export const coverRoleHints: Record<CoverRole, Localized> = {
  normal: t(
    "सामान्य अध्यापक — सामान्य क्रम में सुझाए जाते हैं।",
    "An ordinary teacher, suggested in the usual order.",
  ),
  duty: t(
    "प्रभारी — तभी सुझाए जाते हैं जब और कोई खाली न हो, और अपने आप कभी नहीं।",
    "Suggested only when nobody else is free, and never assigned automatically.",
  ),
  reserve: t(
    "कार्यालय का स्टाफ़ — पूछा जा सकता है, पर कभी सुझाया नहीं जाता।",
    "Can be asked, but is never suggested — they have no timetable, so they read as free all day.",
  ),
};

export type CoverPolicy = {
  id: string;
  staffProfileId: string;
  staffName: string;
  shortName: string;
  allowedPeriods: number[];
  coverRole: CoverRole;
  maxAutoCovers: number;
  note: string | null;
};

const periodList = z
  .array(z.number().int().min(0).max(PERIOD_COUNT - 1))
  .min(1, {
    message: encodeMessage(
      t(
        "कम से कम एक पीरियड चुनें",
        "Choose at least one period — somebody on site for none is simply away",
      ),
    ),
  })
  // Sorted and de-duplicated here rather than in the screen, so the column has
  // one representation of the same window.
  .transform((periods) => [...new Set(periods)].sort((a, b) => a - b));

export const coverPolicySchema = z.object({
  staffProfileId: z.uuid({
    message: encodeMessage(t("अध्यापक चुनें", "Choose a member of staff")),
  }),
  allowedPeriods: periodList,
  coverRole: z.enum(coverRoles),
  maxAutoCovers: z.coerce
    .number()
    .int()
    .min(0)
    .max(PERIOD_COUNT, {
      message: encodeMessage(
        t("दिन में इतने पीरियड नहीं होते", "There are not that many periods in a day"),
      ),
    }),
  note: z
    .string()
    .trim()
    .max(120, {
      message: encodeMessage(t("टिप्पणी बहुत लंबी है", "That note is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export type CoverPolicyInput = z.infer<typeof coverPolicySchema>;

export const absenceSchema = z.object({
  staffProfileId: z.uuid({
    message: encodeMessage(t("अध्यापक चुनें", "Choose a member of staff")),
  }),
  day: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
    }),
  periods: periodList,
  reason: z
    .string()
    .trim()
    .max(200, {
      message: encodeMessage(t("कारण बहुत लंबा है", "That reason is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export type AbsenceInputValue = z.infer<typeof absenceSchema>;

export type TeacherAbsence = {
  id: string;
  staffProfileId: string;
  staffName: string;
  shortName: string;
  day: string;
  periods: number[];
  reason: string | null;
};

/**
 * A policy for everyone, whether or not a row exists.
 *
 * Absence of a row means "full day, ordinary teacher, the default cap" — so
 * the editor can list the whole staff and the planner never has to ask whether
 * somebody has been set up.
 */
export function policyFor(
  policies: CoverPolicy[],
  staffProfileId: string,
): Pick<CoverPolicy, "allowedPeriods" | "coverRole" | "maxAutoCovers"> {
  const found = policies.find((policy) => policy.staffProfileId === staffProfileId);
  if (found) return found;

  return {
    allowedPeriods: Array.from({ length: PERIOD_COUNT }, (_, index) => index),
    coverRole: "normal",
    maxAutoCovers: 2,
  };
}

export function isFullDay(allowedPeriods: number[]): boolean {
  return allowedPeriods.length === PERIOD_COUNT;
}

/** The names the engine wants, split by the role that decides how they rank. */
export function splitByRole(policies: CoverPolicy[]): {
  reserveStaff: string[];
  dutyStaff: string[];
} {
  return {
    reserveStaff: policies
      .filter((policy) => policy.coverRole === "reserve")
      .map((policy) => policy.staffProfileId),
    dutyStaff: policies
      .filter((policy) => policy.coverRole === "duty")
      .map((policy) => policy.staffProfileId),
  };
}
