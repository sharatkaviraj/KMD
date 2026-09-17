import type { Localized } from "@/platform/i18n/language";

/**
 * What a teacher-workspace action hands back.
 *
 * In its own module because a `"use server"` file may only export async
 * functions — the resting constant cannot live beside the actions.
 */
export type TeachState = {
  status: "idle" | "saved" | "error";
  message: Localized | null;
};

export const idleTeachState: TeachState = { status: "idle", message: null };
