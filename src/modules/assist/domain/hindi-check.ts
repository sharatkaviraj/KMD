/**
 * A free model's draft that was asked for Hindi and came back in English or
 * Hinglish (D-496). Pure.
 *
 * On 7 Nov 2026 one free model answered a Hindi Today brief in English and
 * tidied a Hindi note into Roman letters; both still fitted the task's
 * schema. Claude and the other paid models are not checked here: they have
 * kept to the language they were asked for. A draft that fails this goes on
 * to the next model, like one that fails the schema.
 *
 * Two checks, on letters only (digits, ₹ and punctuation do not count):
 *  - every string under a key named `hi` is mostly Devanagari;
 *  - when the input asked for `language: "hi"`, the answer as a whole is at
 *    least half Devanagari. Page links, codes such as `next_monday` and
 *    `<<slot>>` names are left out, and English page names inside a Hindi
 *    sentence are allowed for.
 */

const DEVANAGARI = /[ऀ-ॿ]/u;
const LETTER = /\p{L}/u;
const CODE = /^[a-z0-9_.:/-]+$/u;
const SLOT = /<<[a-z_]{1,24}>>|\[\[[A-Za-z0-9_]{1,24}\]\]|\{[a-z_]{1,24}\}/gu;

/** The minimum Devanagari share of the letters in a `hi` field. */
export const HI_FIELD_SHARE = 0.6;
/** The minimum Devanagari share of a whole answer asked for in Hindi. */
export const HI_ANSWER_SHARE = 0.5;

function share(texts: readonly string[]): number | null {
  let letters = 0;
  let devanagari = 0;
  for (const text of texts) {
    for (const ch of text.replace(SLOT, " ")) {
      if (!LETTER.test(ch)) continue;
      letters += 1;
      if (DEVANAGARI.test(ch)) devanagari += 1;
    }
  }
  return letters ? devanagari / letters : null;
}

function collect(value: unknown, hiOnly: boolean, under: string | null, out: string[]): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || CODE.test(text) || /^https?:\/\//u.test(text)) return out;
    if (!hiOnly || under === "hi") out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, hiOnly, under, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      // Links and searches are the app's own paths and words, never prose.
      if (key === "links" || key === "search") continue;
      collect(item, hiOnly, key === "hi" ? "hi" : hiOnly && under === "hi" ? "hi" : key, out);
    }
  }
  return out;
}

export function readsAsHindi(output: unknown, input: unknown): boolean {
  const hiFields = share(collect(output, true, null, []));
  if (hiFields !== null && hiFields < HI_FIELD_SHARE) return false;
  const language = input && typeof input === "object" ? (input as { language?: unknown }).language : undefined;
  if (language === "hi") {
    const whole = share(collect(output, false, null, []));
    if (whole !== null && whole < HI_ANSWER_SHARE) return false;
  }
  return true;
}
