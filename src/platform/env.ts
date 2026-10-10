/**
 * Environment access, trimmed down from the fee app's `src/platform/env.ts`.
 *
 * What is kept: the required-variable list, the placeholder guard, the
 * `hasRequiredEnvVars` flag the middleware uses to stay out of the way on a
 * misconfigured deploy, and `sanitizeRedirectPath`.
 *
 * `APP_MODE` is back. It was dropped when VPPS One owned exactly one schema
 * (D-4); now that the fee app is folded in, this deployment addresses two,
 * and `getFeeSchema()` below is where the second one is decided — with the
 * two environment declarations forced to agree rather than trusted.
 */

import { assertPermittedTarget } from "@/platform/supabase/target-guard";

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

/**
 * The schema School Fees owns.
 *
 * This used to say "SELECT only, from here, forever". It is not read-only
 * any more: the fee app is being folded into this one and retired, so VPPS
 * One writes here now. What replaced rule 2 is narrower and enforced —
 * fee writes go through `src/modules/fees/platform/supabase/*` and nowhere
 * else, and `tests/architecture.test.ts` checks that every file which uses
 * that client also checks a permission in the same file.
 */
export const FEE_SCHEMA = "public" as const;

/**
 * The fee schema to address, with the two environment declarations forced
 * to agree.
 *
 * The fee app picks its schema from `APP_MODE` alone (unset means `public`,
 * which is live). Carrying that here would make a single unset variable on
 * a preview deployment the whole distance between test data and the school's
 * real money. So the schema is only answered when `VPPSONE_ENV` and
 * `APP_MODE` say the same thing, and a disagreement throws rather than
 * picking one.
 *
 *   VPPSONE_ENV=dev   → APP_MODE must be "test" or unset  → `public` on the
 *                        dev project, which is the dev twin of the fee data
 *   VPPSONE_ENV=live  → APP_MODE must be "production"
 */
export function getFeeSchema(): typeof FEE_SCHEMA {
  const environment = getVppsOneEnvironment();
  const appMode = getOptionalEnvVar("APP_MODE")?.toLowerCase();

  if (environment === "live" && appMode !== "production") {
    throw new Error(
      'VPPSONE_ENV=live needs APP_MODE=production. Refusing to guess which ' +
        'fee data this deployment is allowed to touch.',
    );
  }

  if (environment === "dev" && appMode === "production") {
    throw new Error(
      'APP_MODE=production on a VPPSONE_ENV=dev deployment. One of the two ' +
        'is wrong, and the expensive way to find out which is in production.',
    );
  }

  return FEE_SCHEMA;
}

const vppsOneEnvironments = ["dev", "live"] as const;

export type VppsOneEnvironment = (typeof vppsOneEnvironments)[number];

function isPlaceholderValue(value: string) {
  const normalized = value.trim().toUpperCase();
  return placeholderPatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Each public variable read by its literal name. Next inlines
 * `process.env.NEXT_PUBLIC_*` into browser bundles only when written out like
 * this; `process.env[name]` is empty in the browser, so a browser client built
 * from it threw "Missing environment variable" and took the whole signed-in
 * layout down with it.
 */
function readRequiredEnvVar(name: RequiredEnvVar): string | undefined {
  switch (name) {
    case "NEXT_PUBLIC_SUPABASE_URL":
      return process.env.NEXT_PUBLIC_SUPABASE_URL;
    case "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY":
      return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
}

export function getRequiredEnvVar(name: RequiredEnvVar): string {
  const value = readRequiredEnvVar(name)?.trim();

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

/**
 * The Supabase URL for a **server-side** client, refused before any request is
 * made if it is not a permitted target (see `target-guard.ts`).
 *
 * The browser client does not call this: `VPPSONE_ENV` never reaches the
 * browser, so it would read every deployment as dev and refuse the cutover.
 * It does not need to — no page reaches the browser without a server render
 * that has already been through this check.
 */
export function getServerSupabaseUrl(): string {
  return assertPermittedTarget(getRequiredEnvVar("NEXT_PUBLIC_SUPABASE_URL"));
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

/* ===================================================================== */
/* Ported from School Fees' `env.ts`, for the fee screens that read them. */
/* ===================================================================== */

const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

function withHttpsIfNeeded(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function hasExplicitSiteUrl() {
  return Boolean(getOptionalEnvVar("NEXT_PUBLIC_SITE_URL"));
}

export function isConfiguredSiteUrlSecure() {
  const configured = getOptionalEnvVar("NEXT_PUBLIC_SITE_URL");
  return configured ? withHttpsIfNeeded(configured).startsWith("https://") : false;
}

/**
 * The in-app language switcher (English / Hindi / Hinglish).
 *
 * Opt-out: unset or truthy means on, and only an explicit falsy value turns it
 * off. This is the one route to Hinglish, which no VPPS One language maps to.
 */
export function isLocaleSwitcherEnabled() {
  const value = getOptionalEnvVar("LOCALE_SWITCHER_ENABLED");
  return value ? truthyEnvValues.has(value.toLowerCase()) : true;
}

/**
 * Which fee data this deployment addresses, in the fee app's own vocabulary.
 *
 * Read only through `getFeeSchema()` above, which refuses to answer unless
 * this and `VPPSONE_ENV` agree. On its own it is exactly the single variable
 * that could point a preview deployment at the school's real money.
 */
export function getAppMode(): "production" | "test" {
  return getOptionalEnvVar("APP_MODE")?.toLowerCase() === "test"
    ? "test"
    : "production";
}

/**
 * Creating a monthly EMI repayment plan. Reads ship everywhere; only
 * activation, reschedule and cancel sit behind this.
 */
export function isRepaymentPlanCreationEnabled() {
  const value = getOptionalEnvVar("REPAYMENT_PLANS");

  if (value) {
    return truthyEnvValues.has(value.toLowerCase());
  }

  return getOptionalEnvVar("VERCEL_ENV") === "preview" || getAppMode() === "test";
}

export function isVercelProductionEnvironment() {
  return getOptionalEnvVar("VERCEL_ENV") === "production";
}

export function getRuntimeEnvironmentLabel() {
  const vercelEnvironment = getOptionalEnvVar("VERCEL_ENV");
  if (vercelEnvironment) return vercelEnvironment;
  if (process.env.NODE_ENV === "development") return "local/development";
  return process.env.NODE_ENV ?? "local";
}

/**
 * Where this deployment lives, for a link that has to work outside the app —
 * a receipt QR code, a WhatsApp message, a PDF footer.
 *
 * Falls through the Vercel variables so a preview deployment links to itself
 * rather than to production. `localhost` last, so a forgotten variable in
 * production is a wrong host rather than an unroutable one.
 */
export function getSiteUrl() {
  const configured = getOptionalEnvVar("NEXT_PUBLIC_SITE_URL");
  if (configured) return withHttpsIfNeeded(configured);

  const vercelProduction = getOptionalEnvVar("VERCEL_PROJECT_PRODUCTION_URL");
  if (vercelProduction) return withHttpsIfNeeded(vercelProduction);

  const vercel = getOptionalEnvVar("VERCEL_URL");
  if (vercel) return withHttpsIfNeeded(vercel);

  return "http://localhost:3000";
}

/** The fee app distinguishes these two; here they are the same answer. */
export const getPublicSiteUrl = getSiteUrl;

export function createAbsoluteUrl(path: string, baseUrl = getSiteUrl()) {
  return new URL(path, `${baseUrl}/`).toString();
}
