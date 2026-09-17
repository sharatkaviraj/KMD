import type { Localized } from "@/platform/i18n/language";

/**
 * The shape the public form's action returns.
 *
 * A plain module, not the `"use server"` file that uses it: such a file may
 * export only async functions, and a state constant there fails the build at
 * "Collecting page data" rather than at typecheck.
 */
export type LinkState = {
  status: "idle" | "saved" | "error";
  message: Localized | null;
};

export const idleLinkState: LinkState = { status: "idle", message: null };
