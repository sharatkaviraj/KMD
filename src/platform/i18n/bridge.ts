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
 * **`both` maps to `hi` here, and gets both on the page.** There is no
 * bilingual fee catalogue on disk; `i18n/request.ts` builds one for a `both`
 * reader at request time (`bilingual-catalog.ts`, A-23): short labels read
 * "Receipts · रसीदें", sentences and spliced fragments stay English, the way
 * VPPS One's own screens show a `both` reader. The cookie this writes is `hi`
 * so dates and numbers keep the Hindi formatting they had.
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
