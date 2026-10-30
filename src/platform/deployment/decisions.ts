/**
 * The pure decisions behind the production guards (D-345, D-346), kept apart
 * from the reads that feed them so each can be tested as data.
 */

export type DeploymentEnvironment = "dev" | "production";

/**
 * What `vppsone.deployment` said, as PostgREST returned it. Only exactly one
 * row saying `dev` is dev; anything else — no row, an error body, an
 * unexpected value — is production. Fail closed.
 */
export function environmentFromMarkerRows(rows: unknown): DeploymentEnvironment {
  return Array.isArray(rows) &&
    rows.length === 1 &&
    (rows[0] as { environment?: unknown } | null)?.environment === "dev"
    ? "dev"
    : "production";
}

/**
 * The environment the guards act on: production when the database marker
 * says so OR the deployment itself declares production (`declaresProduction`
 * in confinement.ts). Only both saying "not production" is dev.
 */
export function effectiveEnvironment(input: {
  marker: DeploymentEnvironment;
  declaredProduction: boolean;
}): DeploymentEnvironment {
  return input.marker === "dev" && !input.declaredProduction ? "dev" : "production";
}

export type ToolAccess ={ ok: true } | { ok: false; reason: string };

/**
 * May a QA / smoke-lab / day-run tool sign in as (or act for) this account?
 *
 * Confined, not banned: while the marker says production (or could not be
 * read), only a test account. Otherwise anyone the tool already allows.
 */
export function toolAccessDecision(input: {
  environment: DeploymentEnvironment;
  isTestAccount: boolean | null;
}): ToolAccess {
  if (input.environment === "dev") return { ok: true };
  if (input.isTestAccount === true) return { ok: true };
  return {
    ok: false,
    reason:
      "This database is production: test sign-in tools work only for test accounts (D-346).",
  };
}

/**
 * How fee writes stand right now, for the fee client's write guard.
 *
 *   open       every fee write may proceed (the database still checks)
 *   test-only  only writes that touch TEST-session students/rows may proceed
 *
 * The same rule as `vppsone.fee_writes_allowed()` in the database, plus the
 * confined-deployment rule the database cannot see:
 *
 *  - a confined deployment (preview, local) is always test-only (T1);
 *  - `fee_writes_enabled = 'false'` is test-only;
 *  - production with the key anything but `'true'` (unset included) is
 *    test-only;
 *  - otherwise open.
 */
export type FeeWritesMode = "open" | "test-only";

export function feeWritesMode(input: {
  confined: boolean;
  environment: DeploymentEnvironment;
  /** `app_settings.fee_writes_enabled`, or null when unset / unreadable. */
  setting: string | null;
}): FeeWritesMode {
  if (input.confined) return "test-only";
  const setting = input.setting?.trim().toLowerCase() ?? null;
  if (setting === "false") return "test-only";
  if (input.environment !== "dev" && setting !== "true") return "test-only";
  return "open";
}
