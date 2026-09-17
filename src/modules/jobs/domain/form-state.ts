import type { Localized } from "@/platform/i18n/language";

/**
 * The action's state, in its own module.
 *
 * A `"use server"` file may export only async functions, so a constant next to
 * the action fails the build — late, and with a message about something else.
 * Every feature in this app keeps its idle state here for that reason.
 */
export type JobActionState = {
  status: "idle" | "ok" | "error" | "already";
  message: Localized | null;
  /** Which job the message is about, so the console shows it in one place. */
  job: string | null;
};

export const idleJobState: JobActionState = {
  status: "idle",
  message: null,
  job: null,
};
