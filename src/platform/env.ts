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
 * A `?next=` value is attacker-controlled. Anything that is not a plain
 * in-app absolute path — including the protocol-relative `//evil.example`
 * that `startsWith("/")` alone lets through — falls back.
 */
export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard",
) {
  const normalized = (value ?? "").trim();

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

export const hasRequiredEnvVars = requiredEnvVars.every((name) =>
  Boolean(process.env[name]?.trim()),
);
