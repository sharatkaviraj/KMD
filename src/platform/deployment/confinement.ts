/**
 * Is this deployment CONFINED? (D-346, owner override T1, 30 Oct 2026)
 *
 * One has one database, `wtgxcptmucjerhufzjcf`, and it is production. Vercel
 * Preview deployments and a local `next dev` point at that same database —
 * there is no other one to point them at. So a deployment that is not Vercel
 * production must not be able to touch real data:
 *
 *  - every signed-in user is treated as a test account (sees and writes only
 *    TEST sessions, even an admin) — wired into auth/session in Phase 3;
 *  - fee writes are allowed only for TEST-session students — wired into the
 *    fee client's write guard (`modules/fees/platform/supabase/write-guard.ts`);
 *  - parent and staff messages go only to the test-recipient allowlist, and
 *    job/cron/webhook routes refuse to act on real data — Phases 6–8.
 *
 * This function is the single definition; nothing else may re-derive it from
 * `VERCEL_ENV`. Only an explicit `VERCEL_ENV=production` is unconfined: unset
 * (local development, scripts, tests) and `preview` / `development` are
 * confined. Fail closed — a forgotten variable confines, it never frees.
 *
 * Pure and safe in any runtime: it reads one variable and holds no secret.
 */
export function isConfinedDeployment(
  env: { readonly [name: string]: string | undefined } = process.env,
): boolean {
  return env.VERCEL_ENV?.trim() !== "production";
}

/**
 * Does this deployment declare itself production, whatever the database
 * marker says? (D-346; review of PR #141)
 *
 * The marker (`vppsone.deployment`) is flipped to 'production' by the
 * orchestrator at go-live. A Vercel production deployment, or one declared
 * `VPPSONE_ENV=live`, that goes out before that flip must not run QA sign-in
 * or open fee writes as if it were a dev box. So the guards treat either
 * declaration as production too (`effectiveEnvironment`). Fail closed: this
 * can only make a guard stricter, never looser.
 */
export function declaresProduction(
  env: { readonly [name: string]: string | undefined } = process.env,
): boolean {
  return !isConfinedDeployment(env) || env.VPPSONE_ENV?.trim().toLowerCase() === "live";
}
