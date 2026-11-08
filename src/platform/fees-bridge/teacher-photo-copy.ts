import { flat, type Language } from "@/platform/i18n/language";

/*
 * The teachers' photo copy (D-511): asks the server for one batch at a time
 * (`/api/fees-bridge/photos/copy`) until Fees' photo pages are read. Loaded
 * only when it runs, so no screen carries it.
 *
 * Two things start it: an admin's "Refresh roster now", and an admin simply
 * opening One (`photo-catch-up.tsx`, 8 Nov 2026). The first copy stopped at
 * 279 of 484 children when the admin left the screen after one batch, and
 * nothing ever carried on, so half of every class had no face for its
 * teacher. Now one copy runs at a time in a tab (a tap while the quiet one
 * runs joins it and shows its bar), a batch that fails is asked for once more,
 * and whatever is left is picked up the next time an admin opens One.
 */

const W = {
  photos: { en: "Copying photos for teachers… {n} of {t}", hi: "शिक्षकों के लिए फ़ोटो कॉपी हो रहे हैं… {t} में से {n}" },
  done: { en: "Photos copied for teachers: {n}.", hi: "शिक्षकों के लिए {n} फ़ोटो कॉपी हुए।" },
  same: { en: "Teachers' photos are up to date.", hi: "शिक्षकों के फ़ोटो अपडेट हैं।" },
  some: { en: "{n} photos could not be copied. Tap again later.", hi: "{n} फ़ोटो कॉपी नहीं हो सके। बाद में फिर दबाएँ।" },
  rest: { en: "The rest are copied the next time an admin opens One.", hi: "बाकी फ़ोटो अगली बार किसी प्रशासक के One खोलने पर कॉपी होंगे।" },
  stopped: { en: "Photos could not be copied now.", hi: "अभी फ़ोटो कॉपी नहीं हो सके।" },
};

type PhotoBatch = { ok?: boolean; pending?: number; copied?: number; failed?: number; next?: string | null };

/** What the bar shows while the copy runs. */
export type PhotoProgress = { done: number; of: number };

/** How one run ended. `left` is what is still to copy; `stopped` means a batch failed twice. */
export type PhotoCopyResult = { first: number; copied: number; failed: number; left: boolean; stopped: boolean };

/** At most this many batches in one run; the next run carries on from what is left. */
const MAX_BATCHES = 40;
const RETRY_MS = 2_000;

let running: Promise<PhotoCopyResult> | null = null;
let last: PhotoProgress | null = null;
const watchers = new Set<(progress: PhotoProgress | null) => void>();

function tell(progress: PhotoProgress | null) {
  last = progress;
  for (const watcher of watchers) watcher(progress);
}

async function batch(after: string | null): Promise<PhotoBatch | null> {
  const response = await fetch("/api/fees-bridge/photos/copy", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after }),
  }).catch(() => null);
  const body = (await response?.json().catch(() => null)) as PhotoBatch | null;
  return body?.ok ? body : null;
}

async function run(): Promise<PhotoCopyResult> {
  const result: PhotoCopyResult = { first: 0, copied: 0, failed: 0, left: false, stopped: false };
  let after: string | null = null;
  let seen = false;
  try {
    for (let n = 0; n < MAX_BATCHES; n++) {
      // A batch that failed (a phone that dropped the line, a slow Fees page) is asked for once more.
      const from: string | null = after;
      const body: PhotoBatch | null = (await batch(from)) ?? (await new Promise((done) => setTimeout(done, RETRY_MS)).then(() => batch(from)));
      if (!body) {
        result.stopped = true;
        result.left = !seen || result.first > result.copied + result.failed;
        return result;
      }
      if (!seen) result.first = body.pending ?? 0;
      seen = true;
      result.copied += body.copied ?? 0;
      result.failed += body.failed ?? 0;
      if (result.first > 0) tell({ done: Math.min(result.first, result.copied + result.failed), of: result.first });
      if (!body.next) return result;
      after = body.next;
    }
    result.left = true;
    return result;
  } finally {
    tell(null);
  }
}

/**
 * Run the copy, or join the one already running in this tab. `onProgress`
 * hears the bar until the run ends.
 */
export function runTeacherPhotoCopy(onProgress?: (progress: PhotoProgress | null) => void): Promise<PhotoCopyResult> {
  if (onProgress) {
    watchers.add(onProgress);
    if (last) onProgress(last);
  }
  running ??= run().finally(() => { running = null; });
  return running.finally(() => {
    if (onProgress) watchers.delete(onProgress);
  });
}

/** The copy's result in the admin's words. */
export function photoCopyNote(result: PhotoCopyResult, language: Language): string {
  const say = (pair: { en: string; hi: string }, values: Record<string, number> = {}) =>
    Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), flat(pair, language));
  if (result.stopped && !result.copied) return say(W.stopped);
  if (!result.first && !result.stopped) return say(W.same);
  return [
    result.copied ? say(W.done, { n: result.copied }) : null,
    result.failed ? say(W.some, { n: result.failed }) : null,
    result.left ? say(W.rest) : null,
  ].filter(Boolean).join(" ");
}

/** The bar's words. */
export function photoProgressText(progress: PhotoProgress, language: Language): string {
  return flat(W.photos, language).replace("{n}", String(progress.done)).replace("{t}", String(progress.of));
}

/** "Refresh roster now": run (or join) the copy and say how it went. */
export async function copyTeacherPhotos(language: Language, onProgress: (progress: { text: string; done: number; of: number } | null) => void): Promise<string> {
  const result = await runTeacherPhotoCopy((progress) => onProgress(progress ? { ...progress, text: photoProgressText(progress, language) } : null));
  return photoCopyNote(result, language);
}
