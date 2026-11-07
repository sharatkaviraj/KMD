"use client";

import { useCallback, useSyncExternalStore } from "react";

import { FEEDBACK_DEFAULTS, readFeedbackPrefs, subscribeFeedbackPrefs, writeFeedbackPrefs, type FeedbackPrefs } from "./prefs";

/** The switches, live across tabs. The server renders the defaults. */
export function useFeedbackPrefs(): [FeedbackPrefs, (patch: Partial<FeedbackPrefs>) => void] {
  const prefs = useSyncExternalStore(subscribeFeedbackPrefs, readFeedbackPrefs, () => FEEDBACK_DEFAULTS);
  const set = useCallback((patch: Partial<FeedbackPrefs>) => writeFeedbackPrefs(patch), []);
  return [prefs, set];
}
