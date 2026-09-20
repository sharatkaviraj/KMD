import type { Language } from "@/platform/i18n/language";
import { DEFAULT_LOCALE, type AppLocale } from "@/platform/i18n/locales";

/**
 * One language column, two catalogues.
 *
 * This app says every string as a Hindi/English pair in `src/messages/index.ts`
 * and renders it with `primary()`/`secondary()` against `hi`, `en` or `both`.
 * The ported fee screens say their strings through next-intl, out of three
 * JSON catalogues. Neither was rewritten — 2,094 keys on one side and 750
 * pairs on the other — so this is the seam.
 *
 * `vppsone.staff_profiles.preferred_language` is the single source of truth.
 * The fee locale is derived from it; nothing stores a second preference.
 *
 * **`both` maps to `hi`, and that is a real decision rather than a rounding.**
 * There is no bilingual fee catalogue. Synthesising one would mean 2,094
 * strings of the shape "हिन्दी · English" printed onto money tables the fee
 * app deliberately designed as single-line — its own v2 design retreated from
 * bilingual labels for exactly that reason. `primary()` already leads with
 * Hindi for a `both` reader, so a fee screen and an academic screen agree on
 * the lead line; what a `both` reader loses is the English under it, on the
 * fee screens only.
 *
 * Hinglish has no VPPS One equivalent and is not reachable from a language
 * preference. It stays available through the fee app's own locale switcher,
 * which writes the cookie `request.ts` reads.
 */
export function feeLocaleFor(language: Language): AppLocale {
  switch (language) {
    case "hi":
      return "hi";
    case "en":
      return "en";
    case "both":
      return "hi";
  }
}

export { DEFAULT_LOCALE };
