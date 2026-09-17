import { languages, type Language, type Localized } from "@/platform/i18n/language";

/**
 * Text a member of staff typed, rather than text this app ships.
 *
 * Every string in `src/messages/` is a Hindi/English pair because somebody sat
 * down and wrote both halves once. A request's title is not that: the office
 * types it on a Tuesday afternoon for one round, in whichever language they
 * think in, and asking for it twice doubles the work of the most common task
 * in the app to buy a translation nobody asked for.
 *
 * PLAN §3a: "Let user-authored titles/reasons use the author's language with
 * optional translation and an explicit fallback; routine requests must not
 * require two typed titles."
 *
 * So an authored value is **one required half and one optional one**, plus a
 * rule for what a reader sees when their half is missing. The rule has to be
 * explicit, because the alternative — rendering an empty string — is a request
 * with no title, and a title is how the teacher knows what is being asked
 * (B-05, B-14).
 */

export type Authored = {
  hi: string | null;
  en: string | null;
};

/** Which language a value was actually written in, or null when it is empty. */
export function authoredIn(value: Authored): Language | null {
  const hi = value.hi?.trim() ?? "";
  const en = value.en?.trim() ?? "";

  if (hi && en) return "both";
  if (hi) return "hi";
  if (en) return "en";
  return null;
}

export function isAuthoredEmpty(value: Authored): boolean {
  return authoredIn(value) === null;
}

/**
 * What this reader sees, and whether it is in their language.
 *
 * `fellBack` is the honest half. A Hindi reader shown an English title is not
 * broken — it is the only title there is — but the screen should be able to
 * say so rather than pretending the author wrote it that way. Hiding the
 * fallback is how a teacher concludes the app is half-translated and stops
 * trusting the rest of it.
 */
export function readAuthored(
  value: Authored,
  language: Language,
): { text: string; language: Language; fellBack: boolean } | null {
  const hi = value.hi?.trim() ?? "";
  const en = value.en?.trim() ?? "";

  if (!hi && !en) return null;

  // A bilingual reader gets both halves when both exist, and the one that does
  // when only one does — never a blank second line.
  if (language === "both") {
    if (hi && en) return { text: `${hi} · ${en}`, language: "both", fellBack: false };
    return { text: hi || en, language: hi ? "hi" : "en", fellBack: false };
  }

  const wanted = language === "hi" ? hi : en;
  if (wanted) return { text: wanted, language, fellBack: false };

  const other = language === "hi" ? en : hi;
  return { text: other, language: language === "hi" ? "en" : "hi", fellBack: true };
}

/**
 * An authored value as a `Localized`, for the places that render a pair.
 *
 * Both halves are filled in — with the fallback where a half is missing — so
 * that `primary()` and `flat()` cannot produce an empty string. `secondary()`
 * returns null when the two halves are identical, which is exactly what should
 * happen when only one was typed: a bilingual reader sees the title once, not
 * the same words twice.
 */
export function authoredLocalized(value: Authored): Localized | null {
  const read = readAuthored(value, "both");
  if (!read) return null;

  const hi = value.hi?.trim() ?? "";
  const en = value.en?.trim() ?? "";

  return { hi: hi || en, en: en || hi };
}

/**
 * Which half a form should require, given who is typing.
 *
 * A Hindi reader is asked for Hindi and offered English; an English reader the
 * other way round. A bilingual account is asked for whichever it likes and
 * offered the other, because "both" describes how they *read*, not a promise
 * to type twice.
 */
export function requiredHalf(language: Language): "hi" | "en" {
  return language === "en" ? "en" : "hi";
}

export function optionalHalf(language: Language): "hi" | "en" {
  return requiredHalf(language) === "hi" ? "en" : "hi";
}

/** Every language a form may be authored in. Exported for exhaustive tests. */
export const authoringLanguages = languages;
