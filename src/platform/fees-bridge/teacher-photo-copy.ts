import { flat, type Language } from "@/platform/i18n/language";

/*
 * The teachers' photo copy behind "Refresh roster now" (D-511), loaded only
 * when an admin taps the button, so no other screen carries it. It asks the
 * server for one batch at a time (`/api/fees-bridge/photos/copy`) until Fees'
 * photo pages are read, and reports the count as it goes.
 */

const W = {
  photos: { en: "Copying photos for teachers… {n} of {t}", hi: "शिक्षकों के लिए फ़ोटो कॉपी हो रहे हैं… {t} में से {n}" },
  done: { en: "Photos copied for teachers: {n}.", hi: "शिक्षकों के लिए {n} फ़ोटो कॉपी हुए।" },
  same: { en: "Teachers' photos are up to date.", hi: "शिक्षकों के फ़ोटो अपडेट हैं।" },
  some: { en: "{n} photos could not be copied. Tap again later.", hi: "{n} फ़ोटो कॉपी नहीं हो सके। बाद में फिर दबाएँ।" },
  stopped: { en: "Photos could not be copied now.", hi: "अभी फ़ोटो कॉपी नहीं हो सके।" },
};

type PhotoBatch = { ok?: boolean; pending?: number; copied?: number; failed?: number; next?: string | null };

/** What the bar shows while the copy runs. */
export type PhotoProgress = { text: string; done: number; of: number };

/** At most this many batches in one tap; the next tap carries on from what is left. */
const MAX_BATCHES = 40;

export async function copyTeacherPhotos(language: Language, onProgress: (progress: PhotoProgress | null) => void): Promise<string> {
  const say = (pair: { en: string; hi: string }, values: Record<string, number> = {}) =>
    Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), flat(pair, language));
  let after: string | null = null;
  let first: number | null = null;
  let copied = 0;
  let failed = 0;
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const response = await fetch("/api/fees-bridge/photos/copy", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after }),
      }).catch(() => null);
      const body = (await response?.json().catch(() => null)) as PhotoBatch | null;
      if (!body?.ok) return copied ? say(W.done, { n: copied }) : say(W.stopped);
      first ??= body.pending ?? 0;
      copied += body.copied ?? 0;
      failed += body.failed ?? 0;
      if (first > 0) {
        const done = Math.min(first, copied + failed);
        onProgress({ text: say(W.photos, { n: done, t: first }), done, of: first });
      }
      if (!body.next) break;
      after = body.next;
    }
  } finally {
    onProgress(null);
  }
  if (!first) return say(W.same);
  return [copied ? say(W.done, { n: copied }) : null, failed ? say(W.some, { n: failed }) : null].filter(Boolean).join(" ");
}
