"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { getCurrentStaff, assertStaff } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  isSupportedLocale,
  type AppLocale,
} from "@/platform/i18n/locales";

/**
 * The fee screens' language switcher.
 *
 * **Rewritten on the way in from School Fees, because the ported version would
 * have done nothing visible.** There it wrote a cookie and
 * `public.users.preferred_locale`; here the language a staff member reads the
 * app in lives in `vppsone.staff_profiles.preferred_language`, and
 * `i18n/request.ts` resolves the fee locale from it. A switcher writing a
 * column nothing reads is a control that appears to work and does not — the
 * worst of the three possible behaviours.
 *
 * So this writes both halves:
 *
 *  - the `vpps_locale` cookie, which is the read path and is per device;
 *  - `preferred_language`, when the chosen locale has an equivalent — so
 *    picking Hindi here and opening `/preferences` shows Hindi, rather than
 *    two switchers disagreeing about one person's language.
 *
 * **Hinglish has no equivalent** and is cookie-only. It is romanised Hindi
 * (`"Bhugtan counter"`), fully translated, and nothing in this app's own
 * catalogue speaks it — so a reader who picks it gets it on the fee screens
 * and Hindi everywhere else. That is the honest outcome of two catalogues, and
 * it is why the cookie wins over the account in `request.ts` rather than the
 * other way round.
 *
 * No permission check beyond being staff, for the same reason
 * `saveLanguageAction` needs none: it writes one column on the row belonging
 * to the person making the request, found by their own session rather than by
 * an id from the form. There is no id to tamper with, and changing your own
 * language cannot grant you anything.
 */
export async function setLocaleAction(locale: AppLocale | string) {
  if (!isSupportedLocale(locale)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: LOCALE_COOKIE_NAME,
    value: locale,
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });

  // Signed out — the login screen has no profile to write to, and the cookie
  // above already carries the choice for this device (D-36).
  const current = await getCurrentStaff();
  if (!current) {
    return;
  }

  // `hi-en` deliberately absent: there is nothing to mirror it to.
  const language = locale === "en" ? "en" : locale === "hi" ? "hi" : null;
  if (!language) {
    return;
  }

  const staff = await assertStaff();

  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({ preferred_language: language })
    .eq("id", staff.id);

  if (error) {
    // The cookie is already set, so the fee screens follow. Only the
    // cross-device half is lost, and a language switch must never be the
    // thing that shows somebody an error page.
    return;
  }

  // The shell renders every label in this language, so every cached screen is
  // now stale — including the ones that are not fee screens.
  revalidatePath("/", "layout");
}
