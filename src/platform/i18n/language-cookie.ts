import "server-only";

import { cookies } from "next/headers";

import {
  resolveLanguage,
  SIGNED_OUT_LANGUAGE,
  type Language,
} from "@/platform/i18n/language";

/**
 * The language the login screen is drawn in.
 *
 * Signed out there is no profile to read, so the preference is remembered on
 * the device instead: sign-in writes the account's choice to this cookie, and
 * the next visit to `/login` uses it. Somebody who reads English sees an
 * English login screen on the phone they always use.
 *
 * A first-ever visit has no cookie and gets both languages — bilingual is the
 * only choice that cannot lock anybody out of the one screen they must be able
 * to read (D-36).
 *
 * This is ported from the fee app, which reconciles `preferred_locale` to a
 * cookie at sign-in for the same reason.
 */
export const LANGUAGE_COOKIE = "vppsone_lang";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function readLanguageCookie(): Promise<Language> {
  const store = await cookies();
  const value = store.get(LANGUAGE_COOKIE)?.value;

  // No cookie means nobody has told us anything, which is not the same as an
  // unrecognised value — but both end up bilingual, which is the safe reading.
  return value ? resolveLanguage(value) : SIGNED_OUT_LANGUAGE;
}

/** Called at sign-in, where the account's choice meets a new device. */
export async function writeLanguageCookie(language: Language): Promise<void> {
  const store = await cookies();
  store.set({
    name: LANGUAGE_COOKIE,
    value: language,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    // Not a secret, and the login page needs it before any session exists.
    httpOnly: false,
  });
}
