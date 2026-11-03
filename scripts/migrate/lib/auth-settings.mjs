/**
 * Are public sign-ups off on One's main project? (plan §6 Q21, D-355 (1);
 * the Phase I review made it a precondition of every real load.)
 *
 * Twelve `public` tables — `defaulter_contacts`, `whatsapp_reminder_sends`
 * and others — let any signed-in user read under the fees app's policies.
 * While GoTrue accepts sign-ups, anyone who registers and confirms an email
 * is such a user, so real parent data must not land in `public` until the
 * owner has switched them off (Dashboard → Authentication → Sign In /
 * Providers → "Allow new users to sign up").
 *
 * Reads GoTrue's public `/auth/v1/settings` with the publishable key: a GET,
 * no secret, nothing written. Returns true (sign-ups off), false (on), or
 * null when it cannot tell — which the load guard treats as on.
 */

import { ONE_MAIN_PROJECT_REF } from "../../target-guard.mjs";

/** Only One's main project is asked: any other URL counts as unreadable. */
export function authSettingsUrl(env) {
  const raw = String(env?.NEXT_PUBLIC_SUPABASE_URL ?? env?.SUPABASE_URL ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== `${ONE_MAIN_PROJECT_REF}.supabase.co`) return null;
  return `${url.origin}/auth/v1/settings`;
}

export async function readSignupDisabled(env, { fetchImpl = globalThis.fetch } = {}) {
  const url = authSettingsUrl(env);
  const key = String(env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !key) return null;
  try {
    const res = await fetchImpl(url, { headers: { apikey: key } });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.disable_signup === "boolean" ? body.disable_signup : null;
  } catch {
    return null;
  }
}
