/**
 * The shape a form action hands back, and its resting value.
 *
 * It lives here rather than beside the actions because a `"use server"` module
 * may only export async functions — exporting the constant from there fails
 * the build. Two client components need it, so a shared module beats a copy in
 * each of them.
 */
export type AcademicsFormState = {
  status: "idle" | "error" | "saved";
  /** Field name -> message. Rendered next to the input that is wrong. */
  fieldErrors: Record<string, string>;
  /** Hindi, for a failure that is not about one field. */
  message: string | null;
  messageEn: string | null;
};

export const idleAcademicsState: AcademicsFormState = {
  status: "idle",
  fieldErrors: {},
  message: null,
  messageEn: null,
};
