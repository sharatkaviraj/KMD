"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertStaff } from "@/platform/auth/current-staff";
import { isLanguage, type Localized } from "@/platform/i18n/language";
import { writeLanguageCookie } from "@/platform/i18n/language-cookie";
import { createAdminClient } from "@/platform/supabase/admin";

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

  // The whole shell reads the language, so every cached screen is now stale.
  revalidatePath("/", "layout");

  return { status: "saved", message: m.saved };
}
