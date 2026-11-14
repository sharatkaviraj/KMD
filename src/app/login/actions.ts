"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { admitSignedInUser } from "@/platform/auth/admit";
import { landingFor } from "@/platform/config/start";
import * as m from "@/messages/pairs";
import type { Localized } from "@/platform/i18n/language";
import { createClient } from "@/platform/supabase/server";
import { endViewAsPerson } from "@/platform/auth/view-as-session";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { VIEW_AS_COOKIE } from "@/vx/view-as";
import {
  maskSignInPhone,
  signInCodeIn,
  signInPhoneKey,
  signInTemplateLanguage,
  SIGN_IN_CODE_MINUTES,
  SIGN_IN_RESEND_SECONDS,
} from "@/modules/whatsapp/domain/sign-in-code";

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
  // An administrator who signs out while seeing One as somebody else ends
  // that view first, so the log says how it ended (D-544), and leaves no
  // preview behind for the next person on this computer.
  await endViewAsPerson("signed_out");
  (await cookies()).delete(VIEW_AS_COOKIE);
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

  // Confined, not banned (D-346): on a production database only a test
  // account signs in this way. Checked before any token is minted, so a
  // refused account never gets one.
  const { toolAccountAccess } = await import("@/platform/deployment/tool-access");
  const access = await toolAccountAccess({ email: account.email });
  if (!access.ok) redirect("/login?error=profile");

  const { createAdminClient } = await import("@/platform/supabase/admin");
  const supabase = await createClient();
  // Supabase keeps only the newest one-time token per user, so two people (or
  // two QA agents) tapping the same account within a few seconds spend each
  // other's token: "One-time token not found" and /login?error=link (smoke
  // test, 6 Nov 2026). A fresh token on a short, jittered retry settles it.
  // Only a refused *verify* is retried: a failure to mint means Auth itself is
  // struggling, and asking again would only add to its load.
  let userId: string | null = null;
  for (let attempt = 0; attempt < 3 && !userId; attempt++) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, 300 + Math.floor(Math.random() * 900) * attempt));
    const { data, error } = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email: account.email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) break;
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!verified.error && verified.data.user) userId = verified.data.user.id;
  }
  if (!userId) redirect("/login?error=link");

  const admitted = await admitSignedInUser(supabase, userId);
  if (!admitted.ok) redirect("/login?error=profile");

  revalidatePath("/", "layout");
  redirect(landingFor({ role: admitted.staff.role, preferredStart: admitted.staff.preferredStart, requested: undefined }));
}

/* ------------------------------------------------ Sign in with a WhatsApp code (D-585) */

/**
 * Which ask the browser is answering: the row id, in a cookie the page's
 * script cannot read, so a code typed here can only ever be checked against
 * the code sent to *this* browser. Ten minutes, like the code.
 */
const SIGN_IN_CHALLENGE_COOKIE = "vx_sign_in_code";

/** Why the code card says what it says. The form has the words. */
export type CodeProblem =
  | "bad_number"
  | "not_yet"
  | "off"
  | "limited"
  | "busy"
  | "unavailable"
  | "type_code"
  | "wrong"
  | "start_again"
  | "not_staff"
  | "admission";

export type CodeActionState = {
  status: "idle" | "sent" | "error";
  problem: CodeProblem | null;
  /** The admission check's own sentence, when that is what refused. */
  message: Localized | null;
  /** `+91 ••••• •3124`: the number the person typed, for "sent to". */
  masked: string | null;
  /** Epoch ms when Send again may be pressed. */
  resendAt: number | null;
  /** Minutes to wait, when a limit refused. */
  waitMinutes: number | null;
  /** Wrong tries left on this code. */
  triesLeft: number | null;
  /** Goes up by one each time a code is asked for, so the form knows a new one went. */
  sends: number;
};

function codeState(previous: CodeActionState, patch: Partial<CodeActionState>): CodeActionState {
  return { status: "error", problem: null, message: null, masked: previous.masked, resendAt: previous.resendAt, waitMinutes: null, triesLeft: null, sends: previous.sends, ...patch };
}

async function browserAddress(): Promise<string> {
  const list = await headers();
  // Vercel sets x-real-ip itself; x-forwarded-for's first hop is the fallback off Vercel.
  return list.get("x-real-ip")?.trim() || (list.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
}

/**
 * Send code. Whether or not the number is on a staff record, the answer is
 * the same "sent" (`requestAnswer`), the cookie is set the same way, and the
 * send itself happens after the answer (`after`), so neither the words nor
 * the time it takes tell anybody whose number is on file. While codes go to
 * the owner's number only, every other number hears "not yet" instead
 * (D-608), which says no more than "this is not the owner's number".
 */
export async function requestCodeAction(previous: CodeActionState, formData: FormData): Promise<CodeActionState> {
  const phone = (formData.get("phone") ?? "").toString();
  const language = signInTemplateLanguage((formData.get("language") ?? "").toString());
  const key = signInPhoneKey(phone);
  if (!key) return codeState(previous, { problem: "bad_number", masked: null });

  const { readSignInMode, requestSignInCode, signInClientKey } = await import("@/modules/whatsapp/data/sign-in-codes");
  const mode = await readSignInMode();
  if (mode === "off") return codeState(previous, { problem: "off" });

  const asked = await requestSignInCode({ phone: key, language, clientKey: signInClientKey(await browserAddress()), mode });
  if (asked.answer === "limited") {
    const seconds = Math.max(1, asked.retryAfterSeconds ?? SIGN_IN_RESEND_SECONDS);
    return codeState(previous, {
      problem: "limited",
      masked: maskSignInPhone(key),
      resendAt: Date.now() + seconds * 1000,
      waitMinutes: Math.ceil(seconds / 60),
    });
  }
  if (asked.answer !== "sent" || !asked.challengeId) {
    return codeState(previous, { problem: asked.answer === "sent" ? "unavailable" : asked.answer });
  }

  (await cookies()).set({
    name: SIGN_IN_CHALLENGE_COOKIE,
    value: asked.challengeId,
    path: "/login",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SIGN_IN_CODE_MINUTES * 60,
  });
  if (asked.deliver) after(asked.deliver);

  return {
    status: "sent",
    problem: null,
    message: null,
    masked: maskSignInPhone(key),
    resendAt: Date.now() + SIGN_IN_RESEND_SECONDS * 1000,
    waitMinutes: null,
    triesLeft: null,
    sends: previous.sends + 1,
  };
}

/**
 * Sign in with the code. The database checks the code once, and checks the
 * person again (still active, still that number). Then the session is made
 * the way the QA door makes one — a one-time magic-link token minted and
 * spent here, with this request's cookie client — and the same admission
 * check every door runs decides, held to the profile the code was for.
 */
export async function verifyCodeAction(last: CodeActionState, formData: FormData): Promise<CodeActionState> {
  // Which send this code belongs to, so the form knows a refusal is about the code on screen.
  const previous: CodeActionState = { ...last, sends: Math.max(0, Math.floor(Number(formData.get("round")) || 0)) };
  const code = signInCodeIn((formData.get("code") ?? "").toString());
  const requested = formData.get("next")?.toString();
  if (!code) return codeState(previous, { status: "sent", problem: "type_code" });

  const store = await cookies();
  const challengeId = store.get(SIGN_IN_CHALLENGE_COOKIE)?.value ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return codeState(previous, { problem: "start_again" });

  const { verifySignInCode } = await import("@/modules/whatsapp/data/sign-in-codes");
  const checked = await verifySignInCode(challengeId, code);
  if (checked.answer === "wrong") return codeState(previous, { status: "sent", problem: "wrong", triesLeft: checked.triesLeft });
  if (checked.answer !== "ok" || !checked.userId || !checked.staffProfileId) {
    if (checked.answer !== "unavailable") store.delete({ name: SIGN_IN_CHALLENGE_COOKIE, path: "/login" });
    return codeState(previous, { problem: checked.answer === "ok" ? "unavailable" : checked.answer });
  }
  store.delete({ name: SIGN_IN_CHALLENGE_COOKIE, path: "/login" });

  const { createAdminClient } = await import("@/platform/supabase/admin");
  const admin = createAdminClient();
  const { data: account } = await admin.auth.admin.getUserById(checked.userId);
  const email = account?.user?.email;
  if (!email) return codeState(previous, { problem: "unavailable" });

  const supabase = await createClient();
  // Supabase keeps only the newest one-time token per user: a short, jittered
  // retry settles two sign-ins for one account at the same moment (as on the QA door).
  let userId: string | null = null;
  for (let attempt = 0; attempt < 3 && !userId; attempt++) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, 300 + Math.floor(Math.random() * 900) * attempt));
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) break;
    const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!verified.error && verified.data.user) userId = verified.data.user.id;
  }
  if (!userId || userId !== checked.userId) return codeState(previous, { problem: "unavailable" });

  const admitted = await admitSignedInUser(supabase, userId, { signOutScope: "local", expectedStaffProfileId: checked.staffProfileId });
  if (!admitted.ok) return codeState(previous, { problem: "admission", message: admitted.message });

  revalidatePath("/", "layout");
  redirect(landingFor({ role: admitted.staff.role, preferredStart: admitted.staff.preferredStart, requested }));
}
