/**
 * The person's own switches for feedback on THIS device (D-497): sounds,
 * vibration and reading confirmations aloud. Per device on purpose: the
 * same teacher may want the chime on her phone and silence on the office PC.
 *
 * Kept in localStorage; a private window or blocked storage reads as the
 * defaults and a change simply does not stick. Pure enough to test: no React
 * here, the hook is in `./use-feedback-prefs`.
 */

export type FeedbackPrefs = {
  /** Short synthesized chimes for saved, done, error, listening. */
  sound: boolean;
  /** Android vibration. iPhones cannot vibrate from a web page. */
  vibrate: boolean;
  /** Read each confirmation aloud in the reader's language. Off until chosen. */
  speak: boolean;
};

export const FEEDBACK_DEFAULTS: FeedbackPrefs = { sound: true, vibrate: true, speak: false };

export const FEEDBACK_KEY = "vx.feedback.v1";
export const FEEDBACK_EVENT = "vx:feedback-prefs";

/** Read a stored value; anything unreadable falls back to the defaults, key by key. */
export function parseFeedbackPrefs(raw: string | null | undefined): FeedbackPrefs {
  if (!raw) return FEEDBACK_DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof FeedbackPrefs, unknown>> | null;
    if (!value || typeof value !== "object") return FEEDBACK_DEFAULTS;
    return {
      sound: typeof value.sound === "boolean" ? value.sound : FEEDBACK_DEFAULTS.sound,
      vibrate: typeof value.vibrate === "boolean" ? value.vibrate : FEEDBACK_DEFAULTS.vibrate,
      speak: typeof value.speak === "boolean" ? value.speak : FEEDBACK_DEFAULTS.speak,
    };
  } catch {
    return FEEDBACK_DEFAULTS;
  }
}

export function readFeedbackRaw(): string {
  try {
    return window.localStorage.getItem(FEEDBACK_KEY) ?? "";
  } catch {
    return "";
  }
}

let cachedRaw: string | null = null;
let cached: FeedbackPrefs = FEEDBACK_DEFAULTS;

/** The current switches. Cached by the stored string, so it is cheap to call on every cue. */
export function readFeedbackPrefs(): FeedbackPrefs {
  if (typeof window === "undefined") return FEEDBACK_DEFAULTS;
  const raw = readFeedbackRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseFeedbackPrefs(raw);
  }
  return cached;
}

export function writeFeedbackPrefs(patch: Partial<FeedbackPrefs>) {
  const next = { ...readFeedbackPrefs(), ...patch };
  try {
    window.localStorage.setItem(FEEDBACK_KEY, JSON.stringify(next));
  } catch {
    // Private mode: the switch stays as it was.
  }
  try {
    window.dispatchEvent(new Event(FEEDBACK_EVENT));
  } catch {
    // No window events in this environment.
  }
}

export function subscribeFeedbackPrefs(onChange: () => void): () => void {
  window.addEventListener(FEEDBACK_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(FEEDBACK_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
