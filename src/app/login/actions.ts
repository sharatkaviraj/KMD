"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { admitSignedInUser } from "@/platform/auth/admit";
import { landingFor } from "@/platform/config/start";
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
  const requested = formData.get("next")?.toString();

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

  /**
   * Where a deep link was aiming, or this account's own start screen.
   *
   * The fallback has to be resolved *after* the profile is known, because the
   * proxy stamps `?next=` from whatever was asked for and a bare visit to `/`
   * produces no `next` at all. A teacher who signs in with nothing in mind
   * should land on her day, not on a card showing her own email address; an
   * accounts member of staff who chose School Fees lands in School Fees.
   *
   * A deep link still wins, and that is the half worth guarding: somebody who
   * followed a link to a particular register is asking for that register, not
   * for their landing page.
   */
  const next = landingFor({
    role: admitted.staff.role,
    preferredStart: admitted.staff.preferredStart,
    requested,
  });

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

/**
 * Sign in as one of the QA test accounts without a password (UI-63): mints a
 * one-time magic-link token with the admin API and verifies it right here,
 * with the same cookie client and the same admission check `/auth/confirm`
 * runs. Refuses unless this deployment is on the dev database, and only knows
 * QA-domain addresses.
 *
 * It used to `redirect()` to `/auth/confirm`. A server action's redirect to an
 * internal path is rendered on the server in the same request, so the route
 * handler spent the one-time token there and its session cookie never reached
 * the browser: every tap landed back on /login (smoke test, 10 Oct 2026).
 */
export async function testSignInAction(formData: FormData): Promise<void> {
  const { testSignInEnabled, TEST_ACCOUNTS } = await import("@/platform/auth/test-accounts");
  const key = formData.get("key");
  if (!testSignInEnabled(key)) redirect("/login");
  const account = TEST_ACCOUNTS.find((entry) => entry.key === formData.get("account"));
  if (!account) redirect("/login");

  const { createAdminClient } = await import("@/platform/supabase/admin");
  const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: account.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) redirect("/login?error=link");

  // Confined, not banned (D-346): on a production database only a test
  // account signs in this way. Checked before the token is spent, so a refused
  // account never gets a session.
  const { toolAccountAccess } = await import("@/platform/deployment/tool-access");
  const access = await toolAccountAccess({ userId: data.user?.id ?? null });
  if (!access.ok) redirect("/login?error=profile");

  const supabase = await createClient();
  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || !verified.data.user) redirect("/login?error=link");

  const admitted = await admitSignedInUser(supabase, verified.data.user.id);
  if (!admitted.ok) redirect("/login?error=profile");

  revalidatePath("/", "layout");
  redirect(landingFor({ role: admitted.staff.role, preferredStart: admitted.staff.preferredStart, requested: undefined }));
}
