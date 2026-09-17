/**
 * Language is a property of the account, not of the app.
 *
 * The school is not one audience. A teacher in the village reads Hindi; the
 * office reads English; some people want both. The app used to show both to
 * everybody, which meant every label was twice as long for every single person
 * and nobody's screen was the one they wanted.
 *
 * So strings are written once as a pair and rendered per reader. This file is
 * the pure half of that — no React, no database — so the choice can be made
 * anywhere, including in a server action's error message.
 */

export const languages = ["hi", "en", "both"] as const;

export type Language = (typeof languages)[number];

/**
 * The language a new profile starts in.
 *
 * Hindi, because most of the teaching staff read Hindi and they are most of
 * the accounts. An admin changes it when they create the profile (D-35).
 */
export const DEFAULT_LANGUAGE: Language = "hi";

/**
 * Signed out, nobody has told us anything yet, so show both. Bilingual is the
 * only choice that never hides a word from anyone — it is noisier, not
 * narrower, and the login screen is the one place where being unreadable means
 * being locked out.
 */
export const SIGNED_OUT_LANGUAGE: Language = "both";

/** A string the school has in both languages. */
export type Localized = {
  hi: string;
  en: string;
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (languages as readonly string[]).includes(value);
}

/**
 * A language value from outside TypeScript's reach — a database column, a
 * cookie — narrowed to one this app knows.
 *
 * Unknown falls back to bilingual rather than to the default: a value nobody
 * recognises means the preference is unknown, and showing both is the reading
 * of "unknown" that cannot hide anything.
 */
export function resolveLanguage(value: unknown): Language {
  return isLanguage(value) ? value : SIGNED_OUT_LANGUAGE;
}

/**
 * The primary line for this reader.
 *
 * `both` leads with Hindi, because the bilingual layout is Hindi with English
 * beneath it — the shape the school already reads.
 */
export function primary(text: Localized, language: Language): string {
  return language === "en" ? text.en : text.hi;
}

/** The secondary line, or null when this reader has asked for one language. */
export function secondary(text: Localized, language: Language): string | null {
  if (language !== "both") return null;

  // A pair whose halves are the same word has no second line. Proper nouns are
  // most of them — a class is "Class 6 A" and a teacher is their name in
  // either language — and rendering "Class 6 A · Class 6 A" makes the app look
  // broken to exactly the readers who chose to see both.
  return text.en === text.hi ? null : text.en;
}

/**
 * Both lines flattened into one string, for somewhere that cannot render two —
 * a `<title>`, an `aria-label`, a `placeholder`.
 */
export function flat(text: Localized, language: Language): string {
  const lead = primary(text, language);
  const trail = secondary(text, language);
  return trail ? `${lead} · ${trail}` : lead;
}

/** Shorthand for writing a pair inline. */
export function t(hi: string, en: string): Localized {
  return { hi, en };
}

/**
 * "9 of 45" — in a word order each language actually uses.
 *
 * English counts up from the part: **9 of 45**. Hindi counts down from the
 * whole: **45 में से 9**. Interpolating the two numbers in one fixed order
 * around a translated "of" makes one of the two languages read backwards, and
 * the two numbers on these screens are a register's progress and a child's
 * attendance — both things somebody acts on.
 *
 * This shipped backwards in Hindi on the attendance register in Phase 3 and
 * was caught on the collection link in Phase 5, on a page that happened to be
 * rendering for a Hindi reader. It is a function rather than a pair because
 * the numbers move, not just the words.
 */
export function countOf(part: number, whole: number, language: Language): string {
  return language === "en" ? `${part} of ${whole}` : `${whole} में से ${part}`;
}

/** The same, as a pair, for a `both` reader or an aria-label. */
export function countOfPair(part: number, whole: number): Localized {
  return t(`${whole} में से ${part}`, `${part} of ${whole}`);
}

/**
 * A count and its noun, agreeing in number.
 *
 * **Both languages inflect, and Hindi is the one that gets forgotten.** "1
 * children" is obviously wrong and somebody fixes it; "1 कक्षाओं में" is
 * equally wrong, reads as slightly broken to every Hindi speaker in the
 * school, and is invisible to everybody reviewing the code in English.
 *
 * A function rather than two message keys, for the reason `countOfPair()` is
 * one: the number moves, the noun changes with it, and a component choosing
 * between two keys by hand is a component that will one day only remember to
 * do it in English.
 *
 * Zero takes the plural in both languages, which is what both actually do —
 * "0 children", "0 कक्षाओं में".
 */
export function counted(count: number, one: Localized, many: Localized): Localized {
  const noun = count === 1 ? one : many;
  // Latin digits in both halves: a test asserts no Devanagari numeral reaches
  // a reader, and the school reads roll numbers in Latin anyway.
  return t(`${count} ${noun.hi}`, `${count} ${noun.en}`);
}

/**
 * Validation messages are produced in the domain, which has no idea who is
 * reading — a schema is parsed in a server action, long before a component
 * exists. Zod carries a `string`, so the pair is encoded as JSON and unpacked
 * at the edge where the language is known.
 *
 * JSON rather than a delimiter: a name or a class label could contain any
 * separator character, and a message that splits in the wrong place is worse
 * than one that is not translated at all.
 */
export function encodeMessage(text: Localized): string {
  return JSON.stringify(text);
}

export function decodeMessage(message: string): Localized {
  try {
    const parsed: unknown = JSON.parse(message);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Localized).hi === "string" &&
      typeof (parsed as Localized).en === "string"
    ) {
      return parsed as Localized;
    }
  } catch {
    // Not one of ours.
  }

  // A message from somewhere else — Zod's own built-ins, a database driver.
  // Showing it in both slots is better than showing nothing.
  return { hi: message, en: message };
}
