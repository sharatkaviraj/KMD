import type { Localized } from "@/platform/i18n/language";

/**
 * The shape every assessments action returns.
 *
 * A plain module, not the `"use server"` file that uses it: such a file may
 * export only async functions, and a state constant there fails the build at
 * "Collecting page data" rather than at typecheck.
 */
export type AssessmentState = {
  status: "idle" | "saved" | "error";
  message: Localized | null;
  /** How many cells a grid save actually changed, for the line underneath. */
  changed?: number;
};

export const idleAssessmentState: AssessmentState = {
  status: "idle",
  message: null,
};
