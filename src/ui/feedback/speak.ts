/**
 * Reading words aloud with the phone's own voice (D-497): Hindi (hi-IN) for
 * Devanagari, Indian English (en-IN) otherwise. Used by the Listen buttons on
 * help sheets, and by toasts when the person has switched Read aloud on.
 * Nothing here plays by itself; a caller starts it from a tap or a switch.
 */

export type SpeakLang = "hi" | "en";

const DEVANAGARI = /[ऀ-ॿ]/u;

/** Hindi when the words are written in Devanagari, English otherwise. */
export function langOf(text: string): SpeakLang {
  return DEVANAGARI.test(text) ? "hi" : "en";
}

/** Strip what a voice would read badly: icons, arrows, the "·" separators. */
export function speakable(text: string): string {
  return text
    .replace(/\s*[·•→←↑↓✓✔✕×]+\s*/gu, ", ")
    .replace(/(,\s*){2,}/gu, ", ")
    .replace(/\s+/gu, " ")
    .replace(/^[,\s]+|[,\s]+$/gu, "");
}

type Voice = SpeechSynthesisVoice;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

export function canSpeak(): boolean {
  return synth() !== null && typeof window.SpeechSynthesisUtterance === "function";
}

/** The best voice for a language: an exact Indian voice, then any of that language. */
export function pickVoice(voices: readonly Pick<Voice, "lang" | "name" | "localService">[], lang: SpeakLang) {
  const norm = (v: { lang: string }) => v.lang.replace("_", "-").toLowerCase();
  const exact = lang === "hi" ? "hi-in" : "en-in";
  const prefix = lang === "hi" ? "hi" : "en";
  return (
    voices.find((v) => norm(v) === exact && v.localService) ??
    voices.find((v) => norm(v) === exact) ??
    voices.find((v) => norm(v).startsWith(prefix)) ??
    null
  );
}

/** How long a tap waits for the voice list before speaking without it. */
export const VOICE_WAIT_MS = 1500;
/** A run that has not started its first line by now is given up as failed. */
export const START_WATCHDOG_MS = 8000;

/**
 * Voices load late on Chrome, and on a phone whose speech engine is still
 * asleep the list can stay empty for seconds (seen on a Galaxy M32: Hindi
 * was there, just not yet). Wait a little, checking often; an empty answer
 * means "not loaded yet", never "no voice".
 */
function voicesReady(s: SpeechSynthesis): Promise<Voice[]> {
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(limit);
      s.removeEventListener?.("voiceschanged", check);
      resolve(s.getVoices());
    };
    const check = () => {
      if (s.getVoices().length) finish();
    };
    s.addEventListener?.("voiceschanged", check);
    const poll = setInterval(check, 200);
    const limit = setTimeout(finish, VOICE_WAIT_MS);
  });
}

/** Errors a stop or a newer run causes; not a sign of a missing voice. */
const STOP_ERRORS = new Set(["canceled", "interrupted"]);

/** True when the phone has a voice for this language. */
export async function hasVoice(lang: SpeakLang): Promise<boolean> {
  const s = synth();
  if (!s) return false;
  return pickVoice(await voicesReady(s), lang) !== null;
}

let runId = 0;

export function stopSpeaking() {
  // A run still waiting for voices must not start after a Stop.
  runId += 1;
  try {
    synth()?.cancel();
  } catch {
    // Nothing was speaking.
  }
}

/**
 * Speak lines one after another. `onLine(i)` fires as line i starts, so a
 * help sheet can light up the step being read. Resolves false when the
 * phone's voice list has loaded and holds no voice for the words; a newer
 * call stops an older one, and the older one's `onEnd` still fires.
 *
 * A list still empty after the wait is spoken anyway, by language, and the
 * phone picks the voice. If the phone then cannot speak it (an error, or
 * nothing starts within START_WATCHDOG_MS), `onFail` fires instead of
 * `onEnd`, so the caller can say there is no voice rather than sit on Stop.
 */
export async function speakLines(
  lines: string[],
  options: { onLine?: (index: number) => void; onEnd?: () => void; onFail?: () => void } = {},
): Promise<boolean> {
  const s = synth();
  if (!s || !canSpeak()) return false;
  stopSpeaking();
  const id = ++runId;
  const voices = await voicesReady(s);
  if (id !== runId) {
    // Stopped or replaced while waiting: tell the caller it is over.
    options.onEnd?.();
    return true;
  }
  const items = lines.map(speakable).filter(Boolean);
  if (!items.length) return false;
  if (voices.length && !pickVoice(voices, langOf(items[0]))) return false;

  let started = false;
  let over = false;
  const finish = (failed: boolean) => {
    clearTimeout(watchdog);
    if (over) return;
    over = true;
    // A run stopped or replaced by a newer one simply ended; only this
    // run's own failure before its first word means "no voice".
    if (failed && !started && id === runId) options.onFail?.();
    else options.onEnd?.();
  };
  /** Settle this run as failed first, then silence it: cancelling fires
   *  "canceled" on the queued lines, which must find the run already over. */
  const fail = () => {
    const mine = id === runId && !over;
    finish(true);
    if (mine) stopSpeaking();
  };
  // Declared after finish and fail, which only read it once speaking has begun.
  const watchdog = setTimeout(() => {
    if (!started) fail();
  }, START_WATCHDOG_MS);

  items.forEach((text, i) => {
    const lang = langOf(text);
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voices, lang);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    if (voice) u.voice = voice as Voice;
    u.rate = lang === "hi" ? 0.92 : 0.95;
    u.onstart = () => {
      if (id !== runId) return;
      started = true;
      options.onLine?.(i);
    };
    u.onerror = (event) => {
      const code = (event as Partial<SpeechSynthesisErrorEvent>)?.error;
      if (code && STOP_ERRORS.has(code)) {
        if (i === items.length - 1) finish(false);
        return;
      }
      fail();
    };
    if (i === items.length - 1) u.onend = () => finish(false);
    s.speak(u);
  });
  return true;
}

/** Speak one line (a confirmation, when Read aloud is on). */
export function speakLine(text: string) {
  void speakLines([text]);
}
