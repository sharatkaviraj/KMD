/**
 * Environment access, trimmed down from the fee app's `src/platform/env.ts`.
 *
 * What is kept: the required-variable list, the placeholder guard, the
 * `hasRequiredEnvVars` flag the middleware uses to stay out of the way on a
 * misconfigured deploy, and `sanitizeRedirectPath`.
 *
 * What is dropped: `APP_MODE` and `getSupabaseSchemaForAppMode()`. The fee app
 * switches between the `public` and `test` schemas at runtime; VPPS One always
 * owns exactly one schema, so that choice is a constant here (D-4).
 */

const requiredEnvVars = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

type RequiredEnvVar = (typeof requiredEnvVars)[number];

const placeholderPatterns = [
  "YOUR_PROJECT_ID",
  "REPLACE_WITH_REAL",
  "PASTE_",
  "CHANGE_ME",
] as const;

/**
 * The schema VPPS One owns. Every client defaults to it, so `.from("x")` can
 * never accidentally address a fee table; reading fee data is a deliberate
 * `.schema("public")` at the call site (rule 2).
 */
export const VPPSONE_SCHEMA = "vppsone" as const;

/** The fee app's schema. SELECT only, from here, forever. */
export const FEE_SCHEMA = "public" as const;

const vppsOneEnvironments = ["dev", "live"] as const;

export type VppsOneEnvironment = (typeof vppsOneEnvironments)[number];

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toUpperCase();
  return placeholderPatterns.some((pattern) => normalized.includes(pattern));
}

export function getRequiredEnvVar(name: RequiredEnvVar): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Set a real value in .env.local or Vercel Project Settings.`,
    );
  }

  if (isPlaceholderValue(value)) {
    throw new Error(
      `Unsafe placeholder detected for ${name}. Replace it with the real project value before deployment.`,
    );
  }

  return value;
}

export function getOptionalEnvVar(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Which database the app is pointed at, as the deployment declares it.
 *
 * `dev` until the cutover (PLAN §7). Unset is treated as `dev` on purpose: a
 * forgotten variable should show the loud badge, not the quiet one.
 */
export function getVppsOneEnvironment(): VppsOneEnvironment {
  const value = getOptionalEnvVar("VPPSONE_ENV")?.toLowerCase();

  if (!value) {
    return "dev";
  }

  if ((vppsOneEnvironments as readonly string[]).includes(value)) {
    return value as VppsOneEnvironment;
  }

  throw new Error(`Invalid VPPSONE_ENV: ${value}. Expected "dev" or "live".`);
}

export function getSchoolName() {
  return getOptionalEnvVar("NEXT_PUBLIC_SCHOOL_NAME") ?? "Shri Veer Patta Sr. Sec. School";
}

/**
 * Whether a `?next=` value is a path on this site and nothing else.
 *
 * Attacker-controlled, so the check is a whitelist of shapes rather than a
 * list of things to refuse. Three of them get through the obvious
 * `startsWith("/")`:
 *
 *  - `//evil.example` — protocol-relative, a different site;
 *  - `/\evil.example` — **also** protocol-relative, because URL parsing for
 *    http(s) treats a backslash as a slash. This one survived the original
 *    check, and it only failed to be an open redirect because the magic-link
 *    door happened to assign it to `URL.pathname`, which percent-encodes. Any
 *    caller that redirected to the string directly would have sent staff to
 *    somebody else's login form;
 *  - a control character or a newline, which can split a `Location` header.
 *
 * A backslash anywhere is refused rather than only in position two: nothing in
 * this app has a backslash in a route, so there is nothing to lose and one
 * fewer parsing rule to be right about.
 */
export function isSafeInternalPath(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim();

  if (!normalized.startsWith("/")) return false;
  if (normalized.startsWith("//")) return false;
  if (normalized.includes("\\")) return false;
  // Control characters, including the newline that could split a Location
  // header. Checked by code point rather than by a regex, so no invisible
  // byte ends up in this file.
  for (let at = 0; at < normalized.length; at += 1) {
    const code = normalized.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return false;
  }

  return true;
}

/**
 * A `?next=` value is attacker-controlled. Anything that is not a plain
 * in-app absolute path falls back.
 */
export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard",
) {
  const normalized = (value ?? "").trim();

  return isSafeInternalPath(normalized) ? normalized : fallback;
}

export const hasRequiredEnvVars = requiredEnvVars.every((name) =>
  Boolean(process.env[name]?.trim()),
);
