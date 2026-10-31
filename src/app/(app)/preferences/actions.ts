"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertStaff } from "@/platform/auth/current-staff";
import { isLanguage, type Localized } from "@/platform/i18n/language";
import { writeLanguageCookie } from "@/platform/i18n/language-cookie";
import { feeLocaleFor } from "@/platform/i18n/bridge";
import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
} from "@/platform/i18n/locales";
import { resolveStart } from "@/platform/config/start";
import { createAdminClient } from "@/platform/supabase/admin";
import { staffWhatsappMessages } from "@/messages/setup";
import { writeNoticePrefs, writeStaffConsent } from "@/modules/staff-notices/data/consent";
import { STAFF_MESSAGE_KINDS } from "@/modules/staff-notices/domain/kinds";
import { assertNotPreviewing } from "@/vx/view-as";

export type PreferencesState = {
  status: "idle" | "saved" | "error";
  message: Localized | null;
};

/**
 * A member of staff choosing the language they read the app in.
 *
 * PLAN §3a asks for self-service language choice, and until now the only way
 * to change it was an admin opening your staff profile — so the one setting
 * that decides whether you can read the screen at all needed somebody else.
 *
 * **No permission beyond being staff.** This writes one column on the row that
 * belongs to the person making the request, found by their own `user_id`
 * rather than by an id from the form: there is no id to tamper with, so there
 * is nothing to check. Every other field on the profile stays where it was,
 * and changing your language cannot grant you anything.
 *
 * The device cookie is written too, because the login screen has no profile to
 * read and would otherwise go back to the previous language next time (D-36).
 */
export async function saveLanguageAction(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const staff = await assertStaff();
  const chosen = (formData.get("language") ?? "").toString();

  if (!isLanguage(chosen)) {
    return { status: "error", message: m.notSaved };
  }

  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({ preferred_language: chosen })
    .eq("id", staff.id);

  if (error) {
    return { status: "error", message: m.notSaved };
  }

  await writeLanguageCookie(chosen);

  /*
   * And the fee screens' cookie, which is the read path `i18n/request.ts`
   * resolves them from.
   *
   * Without this, choosing Hindi here left a stale `vpps_locale` behind and
   * the fee desk went on rendering in English — two switchers disagreeing
   * about one person's language, with no screen admitting it. The fee
   * switcher keeps this in step from its own side.
   */
  (await cookies()).set({
    name: LOCALE_COOKIE_NAME,
    value: feeLocaleFor(chosen),
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
  });

  // The whole shell reads the language, so every cached screen is now stale.
  revalidatePath("/", "layout");

  return { status: "saved", message: m.saved };
}

/**
 * A member of staff choosing which screen opens when they sign in.
 *
 * The same shape as the language action and for the same reason: it writes one
 * column on the row belonging to whoever is asking, found by their own id, so
 * there is no id to tamper with.
 *
 * **What it cannot do is grant anything.** The posted value has to be one of
 * the permission map, so an account can only choose a start screen it could already
 * open, and a value typed into the form by hand is refused rather than stored.
 * Legacy values are normalized to native routes before storage.
 */
export async function saveStartAction(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const staff = await assertStaff();
  const chosen = (formData.get("start") ?? "").toString().trim();

  // "" is the role's own Home, which is stored as NULL — the absence of a
  // choice rather than a choice of the default, so a role change moves it.
  const resolved = chosen === "" ? null : resolveStart(staff.role, chosen);
  const value = resolved?.value ?? null;

  if (chosen !== "" && !resolved) {
    return { status: "error", message: m.notSaved };
  }

  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({ preferred_start: value })
    .eq("id", staff.id);

  if (error) {
    return { status: "error", message: m.notSaved };
  }

  // `/` and the sign-in doors read it, and the preferences screen shows it
  // back. Layout scope because the shell caches per-route.
  revalidatePath("/", "layout");

  return { status: "saved", message: m.saved };
}

/**
 * Agreeing to, or stopping, WhatsApp from the school app (go-live Phase F,
 * plan §8.3). The same shape as the two above: the row of whoever is asking,
 * found by their own id, so there is nothing to tamper with. A yes is
 * recorded as `self`; a no ends every staff WhatsApp to them at the next send.
 */
export async function saveWhatsappConsentAction(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const staff = await assertStaff();
  await assertNotPreviewing();
  const choice = (formData.get("whatsapp") ?? "").toString();
  if (choice !== "yes" && choice !== "no") return { status: "error", message: staffWhatsappMessages.notSaved };
  try {
    await writeStaffConsent({ staffId: staff.id, optIn: choice === "yes", source: "self", recordedBy: staff.id });
  } catch {
    return { status: "error", message: staffWhatsappMessages.notSaved };
  }
  revalidatePath("/preferences");
  return { status: "saved", message: staffWhatsappMessages.saved };
}

/** Their own on/off for each kind. Every kind not ticked is off; unknown names are ignored. */
export async function saveNoticePrefsAction(
  _previous: PreferencesState,
  formData: FormData,
): Promise<PreferencesState> {
  const staff = await assertStaff();
  await assertNotPreviewing();
  const ticked = new Set(formData.getAll("kind").map(String));
  const prefs = Object.fromEntries(STAFF_MESSAGE_KINDS.map((kind) => [kind, ticked.has(kind)]));
  try {
    await writeNoticePrefs(staff.id, prefs);
  } catch {
    return { status: "error", message: staffWhatsappMessages.notSaved };
  }
  revalidatePath("/preferences");
  return { status: "saved", message: staffWhatsappMessages.saved };
}
