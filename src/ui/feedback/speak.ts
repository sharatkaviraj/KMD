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

/** Voices load late on Chrome; wait for them, a little. */
function voicesReady(s: SpeechSynthesis): Promise<Voice[]> {
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      s.removeEventListener?.("voiceschanged", done);
      resolve(s.getVoices());
    };
    s.addEventListener?.("voiceschanged", done);
    setTimeout(done, 1200);
  });
}

/** True when the phone has a voice for this language. */
export async function hasVoice(lang: SpeakLang): Promise<boolean> {
  const s = synth();
  if (!s) return false;
  return pickVoice(await voicesReady(s), lang) !== null;
}

export function stopSpeaking() {
  try {
    synth()?.cancel();
  } catch {
    // Nothing was speaking.
  }
}

let runId = 0;

/**
 * Speak lines one after another. `onLine(i)` fires as line i starts, so a
 * help sheet can light up the step being read. Resolves false when there is
 * no voice for the words; a newer call stops an older one.
 */
export async function speakLines(lines: string[], options: { onLine?: (index: number) => void; onEnd?: () => void } = {}): Promise<boolean> {
  const s = synth();
  if (!s || !canSpeak()) return false;
  stopSpeaking();
  const id = ++runId;
  const voices = await voicesReady(s);
  if (id !== runId) return true;
  const items = lines.map(speakable).filter(Boolean);
  if (!items.length) return false;
  const firstLang = langOf(items[0]);
  if (!pickVoice(voices, firstLang)) return false;
  items.forEach((text, i) => {
    const lang = langOf(text);
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voices, lang);
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    if (voice) u.voice = voice as Voice;
    u.rate = lang === "hi" ? 0.92 : 0.95;
    u.onstart = () => {
      if (id === runId) options.onLine?.(i);
    };
    if (i === items.length - 1) {
      const end = () => {
        if (id === runId) options.onEnd?.();
      };
      u.onend = end;
      u.onerror = end;
    }
    s.speak(u);
  });
  return true;
}

/** Speak one line (a confirmation, when Read aloud is on). */
export function speakLine(text: string) {
  void speakLines([text]);
}
