/**
 * Turning browser speech results into text without repeating words. Pure: no
 * React and no browser objects, so `tests/vx-speech-text.test.ts` covers it.
 *
 * Why this exists: Chrome on Android, in `continuous` mode, does not hand back
 * one new phrase per final result. It often hands back every phrase so far
 * again ("aaj" → "aaj Riya" → "aaj Riya absent hai"), each marked final, and
 * sometimes repeats a final it already sent after a pause. Appending each
 * final, which the notes screens did, wrote "aaj aaj Riya aaj Riya absent hai".
 * The fix is to rebuild the whole spoken text from every result on each event
 * and merge segments that restate earlier ones.
 */

export type SpeechSegment = { text: string; isFinal: boolean };

const SPACE = /\s+/gu;

/** Lower-cased words for comparison only; the text itself keeps its case and script. */
function words(text: string): string[] {
  const clean = text.replace(SPACE, " ").trim();
  return clean ? clean.split(" ") : [];
}

function key(word: string): string {
  return word.normalize("NFKC").toLocaleLowerCase().replace(/[.,!?।;:"'()]+/gu, "");
}

function startsWithWords(longer: string[], shorter: string[]): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false;
  return shorter.every((word, i) => key(word) === key(longer[i]));
}

function endsWithWords(longer: string[], shorter: string[]): boolean {
  if (shorter.length === 0 || shorter.length > longer.length) return false;
  const offset = longer.length - shorter.length;
  return shorter.every((word, i) => key(word) === key(longer[offset + i]));
}

/**
 * Merge one phrase onto the text heard so far in this listening session.
 * A phrase that restates everything so far (Android's cumulative finals)
 * replaces it; one that restates only the previous phrase replaces that
 * phrase; an exact repeat of the tail is dropped; anything else is new speech.
 */
function mergePhrase(phrases: string[][], next: string[]): string[][] {
  if (next.length === 0) return phrases;
  const all = phrases.flat();
  if (startsWithWords(next, all)) return [next];
  if (next.length >= 2 && endsWithWords(all, next)) return phrases;
  const last = phrases.at(-1);
  if (last && startsWithWords(next, last)) return [...phrases.slice(0, -1), next];
  return [...phrases, next];
}

/**
 * The text of one listening session: the settled part (final results) and the
 * part still being heard (interim results), each with repeats merged away.
 */
export function speechSessionText(segments: readonly SpeechSegment[]): { final: string; interim: string } {
  let finals: string[][] = [];
  const interim: string[] = [];
  for (const segment of segments) {
    if (segment.isFinal) finals = mergePhrase(finals, words(segment.text));
    else interim.push(...words(segment.text));
  }
  const settled = finals.flat();
  // The interim part often restates what just became final: all of it
  // (Android) or its last few words.
  let fresh = interim;
  if (startsWithWords(interim, settled)) fresh = interim.slice(settled.length);
  else {
    for (let n = Math.min(settled.length, interim.length); n >= 2; n -= 1) {
      if (endsWithWords(settled, interim.slice(0, n))) {
        fresh = interim.slice(n);
        break;
      }
    }
  }
  return { final: settled.join(" "), interim: fresh.join(" ") };
}

/**
 * Add spoken text to what is already in the box. Words the box already ends
 * with are not written twice — a recognizer restarting after a pause often
 * begins by repeating the last phrase it sent.
 */
export function appendSpoken(existing: string, spoken: string): string {
  const add = words(spoken);
  if (add.length === 0) return existing;
  const head = existing.replace(/\s+$/u, "");
  if (!head) return add.join(" ");
  const have = words(head);
  for (let n = Math.min(have.length, add.length); n > 0; n -= 1) {
    // Only a run of two or more words counts as a repeat: one word can be
    // said twice on purpose ("dheere dheere", "very very good").
    if (n >= 2 && endsWithWords(have, add.slice(0, n))) {
      const rest = add.slice(n);
      return rest.length ? `${head} ${rest.join(" ")}` : head;
    }
  }
  return `${head} ${add.join(" ")}`;
}
