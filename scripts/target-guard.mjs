/**
 * The scripts' half of `src/platform/supabase/target-guard.ts`, and the one
 * place a script asks "may I write here, and what?".
 *
 * Two projects exist, and they are no longer "dev" and "live" (D-338, D-346):
 *
 *  - ONE_MAIN_PROJECT_REF (`wtgxcptmucjerhufzjcf`) is One's own database. It
 *    is production from go-live on AND the only test bed — there is no
 *    separate dev database, ever. Testing happens in it, under TEST-2026-27.
 *  - FEES_SOURCE_PROJECT_REF (`vgqyilgstjvgohrsiwkb`) is the fees app's live
 *    database. One copies from it and never writes to it. Every script here
 *    refuses it as a target; only `scripts/migrate/*` may read it, and only
 *    through a sealed select-only client.
 *
 * Because the main project is production, "is the URL the dev ref?" can no
 * longer tell a seeding script whether it may write. The database says so
 * itself: `vppsone.deployment.environment` is 'dev' today and 'production'
 * from go-live. `toolScope()` reads it (fail closed: unreadable = production)
 * and gives each script one of three answers:
 *
 *   mode 'read-only'   — the script writes nothing: runs anywhere on the main
 *                        project.
 *   mode 'test-scoped' — the script has been confined: on EVERY marker (since
 *                        Phase 3, when the QA accounts became test accounts)
 *                        it writes only TEST-2026-27 data and test accounts,
 *                        and refuses anything else itself. It is told
 *                        `confined: true` and the session to use.
 *   mode 'dev-only'    — the script writes real-session data or has not been
 *                        confined yet: it refuses to run on production.
 *
 * Hostnames are compared exactly. `url.includes(ref)` — the scripts' old
 * check — passes `https://elsewhere.example/?wtgxcptmucjerhufzjcf`. Plain
 * JavaScript because half the scripts run without the alias hook;
 * `tests/target-guard.test.ts` keeps the constants here and in the
 * TypeScript module the same.
 */

export const ONE_MAIN_PROJECT_REF = "wtgxcptmucjerhufzjcf";
export const FEES_SOURCE_PROJECT_REF = "vgqyilgstjvgohrsiwkb";

/** The rehearsal session every confined tool writes into on production. */
export const TEST_SESSION_LABEL = "TEST-2026-27";

/** The project ref a Supabase URL addresses, or null if it is not one. */
export function projectRefOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const match = /^([a-z]{20})\.supabase\.(co|in)$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** True only for a URL whose host is exactly One's main project. */
export function isOneMainProjectUrl(url) {
  return projectRefOf(url ?? "") === ONE_MAIN_PROJECT_REF;
}

/** The reason a script may not target this URL, or null if it may. */
export function targetRefusal(url) {
  const ref = projectRefOf(url ?? "");
  if (ref === FEES_SOURCE_PROJECT_REF) {
    return "that is the fees app's live database, which One only ever reads (D-339)";
  }
  if (ref !== ONE_MAIN_PROJECT_REF) {
    return `.env.local is not One's main project (${ONE_MAIN_PROJECT_REF})`;
  }
  return null;
}

/** Exit before any client is made unless `url` is One's main project. */
export function assertOneMainTarget(url, label = "this script") {
  const why = targetRefusal(url);
  if (!why) return;
  console.error(`Refusing to run ${label}: ${why}.`);
  process.exit(1);
}

/**
 * What `vppsone.deployment` says, read with the service role over REST.
 *
 * Fail closed: no key, a network error, an error status, no row or an
 * unexpected value all read as 'production'. A tool that cannot tell whether
 * it is on production behaves as if it is.
 */
export async function readDeploymentEnvironment({ url, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  if (!serviceRoleKey || !isOneMainProjectUrl(url)) return "production";
  try {
    const response = await fetchImpl(
      `${new URL(url).origin}/rest/v1/deployment?select=environment&id=eq.1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Accept-Profile": "vppsone",
        },
      },
    );
    if (!response.ok) return "production";
    return environmentFromRows(await response.json());
  } catch {
    return "production";
  }
}

/** The marker rows PostgREST returned -> 'dev' only if they say exactly that. */
export function environmentFromRows(rows) {
  return Array.isArray(rows) && rows.length === 1 && rows[0]?.environment === "dev"
    ? "dev"
    : "production";
}

/**
 * The pure decision behind `toolScope()`: given the marker and the script's
 * mode, may it run, and confined to what?
 */
export function decideToolScope(environment, mode) {
  if (!["read-only", "test-scoped", "dev-only"].includes(mode)) {
    return { ok: false, reason: `unknown tool mode ${mode}` };
  }
  const production = environment !== "dev";
  // A test-scoped tool is CONFINED on every marker, dev included (Phase 3,
  // D-340): the QA, smoke and day-run accounts it drives are test accounts
  // now, and a test account sees TEST-2026-27 only — so data written anywhere
  // else would be invisible to the very accounts that test it. `confined`
  // is what the scripts branch on; `production` still says what the marker is.
  if (mode === "test-scoped") return { ok: true, production, confined: true, sessionLabel: TEST_SESSION_LABEL };
  if (!production) return { ok: true, production: false, confined: false, sessionLabel: null };
  if (mode === "read-only") return { ok: true, production: true, confined: false, sessionLabel: null };
  return {
    ok: false,
    reason:
      "the database marker says production (or could not be read), and this script writes " +
      "real-session data. On production it is confined to TEST-2026-27 and test accounts, " +
      "and it has not been taught to stay inside them, so it refuses (D-346).",
  };
}

/**
 * Is this auth user a test account (`vppsone.staff_profiles.is_test_account`)?
 * Fail closed: no profile, an error or anything but `true` is "no".
 */
export async function isTestAccountUser({ url, serviceRoleKey, userId, fetchImpl = globalThis.fetch }) {
  if (!serviceRoleKey || !isOneMainProjectUrl(url) || !/^[0-9a-f-]{36}$/i.test(userId ?? "")) return false;
  try {
    const response = await fetchImpl(
      `${new URL(url).origin}/rest/v1/staff_profiles?select=is_test_account&user_id=eq.${userId}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Accept-Profile": "vppsone",
        },
      },
    );
    if (!response.ok) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length === 1 && rows[0]?.is_test_account === true;
  } catch {
    return false;
  }
}

/**
 * For a script that signs in as an account: on production, only a test account
 * (D-346). Call it with the user id `generateLink` returned, before using the
 * token. Throws, so a sign-in loop stops at the first refusal.
 */
export async function assertTestAccountUser({ scope, url, serviceRoleKey, userId, email, fetchImpl }) {
  if (!scope?.production && !scope?.confined) return;
  if (await isTestAccountUser({ url, serviceRoleKey, userId, fetchImpl })) return;
  throw new Error(
    `${email ?? userId} is not a test account, and this database is production: ` +
      "QA sign-in is confined to is_test_account staff (D-346).",
  );
}

/**
 * The guard every script that touches the main project calls first.
 *
 * Exits on a wrong target or a refused mode; otherwise returns
 * `{ production, sessionLabel }`. A test-scoped script must use
 * `sessionLabel` (TEST-2026-27) instead of the active session whenever
 * `production` is true, and must touch only `is_test_account` staff.
 */
export async function toolScope({ url, serviceRoleKey, label = "this script", mode, fetchImpl }) {
  assertOneMainTarget(url, label);
  const environment = await readDeploymentEnvironment({ url, serviceRoleKey, fetchImpl });
  const decision = decideToolScope(environment, mode);
  if (!decision.ok) {
    console.error(`Refusing to run ${label}: ${decision.reason}`);
    process.exit(1);
  }
  if (decision.confined) {
    console.log(`${label}: ${decision.production ? "production" : "dev"} database — confined to ${decision.sessionLabel} and test accounts.`);
  } else if (decision.production) {
    console.log(`${label}: production database — read-only.`);
  }
  return { production: decision.production, confined: decision.confined === true, sessionLabel: decision.sessionLabel };
}
