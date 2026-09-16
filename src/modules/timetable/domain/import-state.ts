import type { Localized } from "@/platform/i18n/language";
import type { ImportReport } from "@/modules/timetable/domain/resolve-import";

/**
 * What the import form hands back, and its resting value.
 *
 * Here rather than beside the actions because a `"use server"` module may only
 * export async functions — exporting the constant from there fails the build.
 */
export type ImportState = {
  status: "idle" | "checked" | "error";
  report: ImportReport | null;
  /** Echoed back so the textarea survives a failed check. */
  sheet: string;
  label: string;
  message: Localized | null;
};

export const idleImportState: ImportState = {
  status: "idle",
  report: null,
  sheet: "",
  label: "",
  message: null,
};
