/**
 * One vocabulary for "it worked", "it didn't" and "I'm listening" (D-497):
 * a short vibration on Android and a short, quiet chime, both behind the
 * person's own switches (`./prefs`). Screens name a cue; they never call
 * `navigator.vibrate` or make sounds of their own, so "saved" feels the same
 * on the register, the desk and the marks sheet.
 *
 * The rules it keeps, so a screen does not have to:
 *  - **Never before the person has touched the page.** Nothing buzzes or
 *    chimes on page load: cues are dropped until the first tap or key press
 *    (`primeFeedback`), and while the tab is hidden.
 *  - **Never twice for one thing.** A save that shows a toast and a save line
 *    cues once: a result within 0.7 s of a stronger or equal one is dropped.
 *  - **Never breaks a flow.** Every browser call is wrapped; a phone without
 *    vibration or audio simply stays quiet.
 */

import { readFeedbackPrefs } from "./prefs";
import { playTone, wakeAudio, type ToneName } from "./tones";

export type CueKind = "tap" | "select" | "success" | "done" | "warn" | "error" | "undo" | "listen" | "stop" | "ready";

/** Vibration per cue, in ms (Android). Short taps for touches, a rhythm for results. */
export const CUE_VIBRATION: Record<CueKind, number | number[]> = {
  tap: 10,
  select: 18,
  success: [24, 60, 36],
  done: [40, 50, 40, 50, 90],
  warn: [20, 40, 20, 40, 20],
  error: [50, 60, 50],
  undo: 14,
  listen: 20,
  stop: [12, 40, 12],
  ready: 16,
};

/** Which cues make a sound. Touches stay silent: a sound on every tap is noise. */
export const CUE_SOUND: Partial<Record<CueKind, ToneName>> = {
  success: "success",
  done: "done",
  warn: "warn",
  error: "error",
  undo: "undo",
  listen: "listen",
  stop: "stop",
  ready: "ready",
};

type Lane = "touch" | "mic" | "result";

const LANE: Record<CueKind, Lane> = {
  tap: "touch",
  select: "touch",
  listen: "mic",
  stop: "mic",
  success: "result",
  done: "result",
  warn: "result",
  error: "result",
  undo: "result",
  ready: "result",
};

/** A stronger result swallows a weaker one that follows it within the window. */
const STRENGTH: Record<CueKind, number> = {
  tap: 0,
  select: 0,
  listen: 0,
  stop: 0,
  ready: 1,
  undo: 2,
  success: 2,
  warn: 3,
  error: 4,
  done: 5,
};

export const RESULT_WINDOW_MS = 700;
const TOUCH_GAP_MS = 40;
const MIC_GAP_MS = 300;

export type CueMemory = { kind: CueKind; at: number } | null;
export type CueHistory = Record<Lane, CueMemory>;

export function emptyCueHistory(): CueHistory {
  return { touch: null, mic: null, result: null };
}

/**
 * Whether a cue should fire, given what fired last in its lane. Pure, so
 * `tests/feedback-cue.test.ts` pins the rules: taps can come quickly (a
 * register marked at speed), the mic's start and stop never collide, and a
 * result never doubles up.
 */
export function shouldCue(kind: CueKind, now: number, history: CueHistory): boolean {
  const lane = LANE[kind];
  const last = history[lane];
  if (!last) return true;
  const gap = now - last.at;
  if (lane === "touch") return gap >= TOUCH_GAP_MS;
  if (lane === "mic") return last.kind !== kind || gap >= MIC_GAP_MS;
  return gap >= RESULT_WINDOW_MS || STRENGTH[kind] > STRENGTH[last.kind];
}

const history: CueHistory = emptyCueHistory();
let primed = false;
let installed = false;

function hasBeenActive(): boolean {
  if (primed) return true;
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua?.hasBeenActive) primed = true;
  } catch {
    // Older browsers: wait for our own listener.
  }
  return primed;
}

/**
 * Listen for the person's first touch, once per page. Each later touch also
 * wakes the audio while sounds are on (iOS starts audio only inside a gesture).
 * The shell calls this; calling it again is harmless.
 */
export function primeFeedback() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const onTouch = (event: Event) => {
    if (!event.isTrusted) return;
    primed = true;
    if (readFeedbackPrefs().sound) wakeAudio();
  };
  window.addEventListener("pointerdown", onTouch, { capture: true, passive: true });
  window.addEventListener("keydown", onTouch, { capture: true, passive: true });
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    // Blocked or unsupported.
  }
}

/** True once the person has touched the page and it is in front: when any cue, or speech, may play. */
export function feedbackReady(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  return hasBeenActive();
}

/** True on a phone that can vibrate from a web page (Android Chrome; never an iPhone). */
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Feel and hear one cue. Fire-and-forget: it never throws and never waits.
 * `force` is for the switches' own preview ("this is how it sounds"), which
 * the person asked for with a tap, so the window does not swallow it.
 */
export function cue(kind: CueKind, options: { force?: boolean } = {}) {
  if (typeof window === "undefined") return;
  try {
    if (!hasBeenActive()) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const now = Date.now();
    if (!options.force && !shouldCue(kind, now, history)) return;
    history[LANE[kind]] = { kind, at: now };
    const prefs = readFeedbackPrefs();
    if (prefs.vibrate) vibrate(CUE_VIBRATION[kind]);
    const tone = CUE_SOUND[kind];
    if (prefs.sound && tone) playTone(tone);
  } catch {
    // A nicety; never in the way of the work.
  }
}

/** Test seam: forget the history and the first touch. */
export function resetCueStateForTests() {
  history.touch = null;
  history.mic = null;
  history.result = null;
  primed = false;
}
