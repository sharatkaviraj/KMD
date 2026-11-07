"use client";

import { useCallback } from "react";

import { cue, type CueKind } from "@/ui/feedback/cue";
import { readFeedbackPrefs } from "@/ui/feedback/prefs";

/**
 * Named haptic patterns. Using names rather than raw arrays keeps the physical
 * vocabulary consistent across surfaces — "success" must feel identical
 * whether it fires on the Payment Desk or anywhere else.
 *
 * Since D-497 the names go through `cue()` (`@/ui/feedback/cue`), the app's
 * one feedback vocabulary: they respect the person's Sounds and Vibration
 * switches, never fire before the first touch, and carry the matching chime.
 * The patterns are kept for callers that read them.
 */
export const hapticPatterns = {
  /** Payment posted / irreversible action completed. */
  success: [50, 30, 80],
  /** Duplicate or blocked action — deliberately stuttering. */
  warning: [20, 40, 20, 40, 20],
  /** Something failed. */
  error: [40, 60, 40],
  /** Lightweight confirmation of a tap on a control. */
  tap: 10,
} as const satisfies Record<string, VibratePattern>;

export type HapticPattern = keyof typeof hapticPatterns;

/** The fee desk's names in the app's cue vocabulary. A posted payment is a finished job. */
const AS_CUE: Record<HapticPattern, CueKind> = {
  success: "done",
  warning: "warn",
  error: "error",
  tap: "tap",
};

/** Fire-and-forget: haptics are a nicety and must never break a flow. */
export function triggerHaptic(pattern: HapticPattern | VibratePattern) {
  try {
    if (typeof pattern === "string") {
      cue(AS_CUE[pattern]);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    if (!readFeedbackPrefs().vibrate) return;
    navigator.vibrate(pattern);
  } catch {
    // Best-effort only — unsupported, blocked, or user-disabled.
  }
}

export function useHaptics() {
  return useCallback(
    (pattern: HapticPattern | VibratePattern) => triggerHaptic(pattern),
    [],
  );
}
