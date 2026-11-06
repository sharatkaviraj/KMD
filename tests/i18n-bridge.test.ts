import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { feeLocaleFor } from "@/platform/i18n/bridge";
import { languages, type Language } from "@/platform/i18n/language";
import { supportedLocales, type AppLocale } from "@/platform/i18n/locales";

/**
 * One language column, two catalogues.
 *
 * `vppsone.staff_profiles.preferred_language` is the only stored preference.
 * The fee screens speak next-intl out of three JSON files; this app speaks
 * Hindi/English pairs out of `src/messages/index.ts`. Nothing stores a second
 * choice, so every fee screen's language is derived here.
 */
const expectedLocale: Record<Language, AppLocale> = {
  hi: "hi",
  en: "en",

  /*
   * The cookie and the formatting stay Hindi; the words on the page are
   * built bilingual for this reader by `i18n/request.ts` (A-23).
   */
  both: "hi",
};

describe("the language bridge", () => {
  it("answers for every language an account can hold", () => {
    for (const language of languages) {
      expect(feeLocaleFor(language), language).toBe(expectedLocale[language]);
    }
  });

  it("only ever answers with a locale the fee catalogues exist for", () => {
    for (const language of languages) {
      expect(supportedLocales as readonly string[]).toContain(
        feeLocaleFor(language),
      );
    }
  });

  it("never leaves a reader on English by accident", () => {
    // `en` is next-intl's DEFAULT_LOCALE. A bridge that fell through would
    // return it, and the failure would look like a preference that simply did
    // not take — the quietest possible wrong answer, on the screens where the
    // reader is least likely to be an English speaker.
    expect(feeLocaleFor("hi")).not.toBe("en");
    expect(feeLocaleFor("both")).not.toBe("en");
  });

  it("has a catalogue on disk for every locale it can return", () => {
    for (const language of languages) {
      const locale = feeLocaleFor(language);
      const file = path.join(process.cwd(), "src", "messages", `${locale}.json`);
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;

      expect(parsed, `${file} is not an object`).toBeTypeOf("object");
      expect(
        Object.keys(parsed as Record<string, unknown>).length,
        `${file} is empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("leaves Hinglish reachable, but not by preference", () => {
    // `hi-en` is romanised Hindi ("Bhugtan counter"), fully translated and in
    // use. No VPPS One language maps onto it, so it stays reachable only
    // through the fee app's own switcher and the cookie it writes — which is
    // what `i18n/request.ts` falls back to for a reader with no account.
    expect(supportedLocales).toContain("hi-en");
    expect(languages.map(feeLocaleFor)).not.toContain("hi-en");
  });
});
