import type { Localized } from "@/platform/i18n/language";

/**
 * The shape a form action hands back, and its resting value.
 *
 * It lives here rather than beside the actions because a `"use server"` module
 * may only export async functions — exporting the constant from there fails
 * the build. Two client components need it, so a shared module beats a copy in
 * each of them.
 *
 * Messages are pairs, not strings: the action runs long before a component
 * exists, so it cannot know which language the reader asked for (D-35).
 */
export type AcademicsFormState = {
  status: "idle" | "error" | "saved";
  /** Field name -> message pair. Rendered next to the input that is wrong. */
  fieldErrors: Record<string, Localized>;
  /** For a failure that is not about one field. */
  message: Localized | null;
};

export const idleAcademicsState: AcademicsFormState = {
  status: "idle",
  fieldErrors: {},
  message: null,
};
