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
  return language === "both" ? text.en : null;
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
