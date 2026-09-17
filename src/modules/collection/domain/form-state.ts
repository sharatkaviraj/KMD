import type { Localized } from "@/platform/i18n/language";
import type { AskListMiss, AskListRow } from "@/modules/collection/domain/ask-list";

/**
 * The shape every collection action returns.
 *
 * A plain module, not the `"use server"` file that uses it: such a file may
 * export only async functions, and a state constant there fails the build at
 * "Collecting page data" rather than at typecheck.
 */
export type CollectionState = {
  status: "idle" | "saved" | "error";
  message: Localized | null;
};

export const idleCollectionState: CollectionState = {
  status: "idle",
  message: null,
};

/**
 * What the ask-list check hands back to the screen.
 *
 * Here for the same reason as the state above: the action file is
 * `"use server"` and may export only async functions, so a constant there
 * fails the build at "Collecting page data" rather than at typecheck.
 */
export type AskListState = {
  status: "idle" | "matched" | "error";
  message: Localized | null;
  matched: AskListRow[];
  /** Named, never counted away — the office reads these before creating. */
  unmatched: AskListMiss[];
  classCount: number;
};

export const idleAskList: AskListState = {
  status: "idle",
  message: null,
  matched: [],
  unmatched: [],
  classCount: 0,
};
