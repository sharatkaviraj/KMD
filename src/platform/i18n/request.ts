import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { bilingualCatalog } from "@/platform/i18n/bilingual-catalog";
import { feeLocaleFor } from "@/platform/i18n/bridge";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  type AppLocale,
} from "@/platform/i18n/locales";

/**
 * Which language the ported fee screens speak, for this request.
 *
 * The fee app resolved this from its cookie alone. Here the account comes
 * first: a staff member who set their language in `/preferences` should not
 * have to set it again on the fee screens, and `preferred_language` is the one
 * column that decides it.
 *
 * The cookie still wins over the default, and still loses to the account,
 * which keeps the fee app's own locale switcher working within a session —
 * including Hinglish, which no VPPS One language maps to.
 *
 * `getCurrentStaff()` is wrapped in React `cache()` and the layout has already
 * called it, so this costs no extra query. It is wrapped anyway: next-intl
 * runs this outside the normal render path in places, and a throw here would
 * take down every fee screen rather than fall back to a language.
 */
export default getRequestConfig(async () => {
  let locale: AppLocale = DEFAULT_LOCALE;
  let bilingual = false;

  try {
    /*
     * The cookie first, the account second.
     *
     * Both switchers write the cookie — `/preferences` through
     * `feeLocaleFor()`, and the fee screens' own switcher directly — so
     * reading it first does not let the two disagree. What it does allow is
     * Hinglish, which the fee catalogues have and this app's language column
     * cannot express: `hi-en` reaches the fee screens only as a cookie.
     *
     * The account is the fallback, which is what makes a new device right
     * before anybody has touched a switcher on it.
     */
    const cookieValue = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
    const staff = await getCurrentStaff();
    if (isSupportedLocale(cookieValue)) {
      locale = cookieValue;
    } else if (staff) {
      locale = feeLocaleFor(staff.language);
    }
    // A reader of both languages gets both on the fee screens too, unless
    // they picked Hinglish on the fee switcher (A-23). `/preferences` writes
    // `hi` for them, so that cookie is theirs and not a choice of Hindi only.
    bilingual = staff?.language === "both" && locale === "hi";
  } catch {
    // Signed out, or called somewhere cookies() is not available. The default
    // is a language, which is the one thing this must always return.
  }

  const messages = bilingual
    ? bilingualCatalog((await import("../../messages/en.json")).default, (await import("../../messages/hi.json")).default)
    : (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
    // Explicit IST keeps next-intl's date formatting identical on the server
    // and the client. Without it next-intl falls back to the runtime's zone,
    // which on Vercel is UTC and on a laptop is not — and the mismatch shows
    // up as a hydration error on any screen that prints a date.
    timeZone: "Asia/Kolkata",
  };
});
