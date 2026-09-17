"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { admitSignedInUser } from "@/platform/auth/admit";
import { sanitizeRedirectPath } from "@/platform/env";
import { m } from "@/messages";
import type { Localized } from "@/platform/i18n/language";
import { createClient } from "@/platform/supabase/server";

export type LoginActionState = {
  status: "idle" | "error";
  /** The pair; the form renders whichever half the reader asked for. */
  message: Localized | null;
};

function fail(message: Localized): LoginActionState {
  return { status: "error", message };
}

/**
 * Supabase's auth errors arrive in English and are aimed at developers. The
 * three that staff will actually hit get a sentence that says what to do next;
 * anything else falls through to a generic pair, so a new error code cannot
 * produce a blank box.
 */
function translateAuthError(error: { message?: string; code?: string }): LoginActionState {
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return fail(m.loginBadCredentials);
  }

  if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return fail(m.loginNotConfirmed);
  }

  if (code === "over_request_rate_limit" || message.includes("rate limit")) {
    return fail(m.loginRateLimited);
  }

  return fail(m.loginUnavailable);
}

export async function loginAction(
  _previous: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const email = (formData.get("email") ?? "").toString().trim().toLowerCase();
  const password = (formData.get("password") ?? "").toString();
  const next = sanitizeRedirectPath(formData.get("next")?.toString());

  if (!email || !password) {
    return fail(m.loginBothFields);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return translateAuthError(error);
  }

  // The password was right, which only proves this is a Supabase account —
  // the same account pool the fee app uses. `admitSignedInUser()` is what
  // decides whether this is *staff here*, and the magic-link door runs the
  // very same function rather than a second copy of these rules.
  const admitted = await admitSignedInUser(supabase, data.user.id);
  if (!admitted.ok) return fail(admitted.message);

  revalidatePath("/", "layout");

  // Outside the try/catch on purpose: redirect() works by throwing, so
  // catching around it would swallow the navigation.
  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  // The language cookie is deliberately left alone: it is a device preference,
  // not a session, and the next person to open the login page on this phone is
  // almost always the same person.
  redirect("/login");
}
