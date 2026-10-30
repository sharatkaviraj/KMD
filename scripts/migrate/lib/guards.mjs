/**
 * When a migrate tool may write to One's database. Pure decisions, so the
 * refusals are tested without a database (tests/migrate-tooling.test.ts).
 */

/**
 * load-snapshot (plan §2.3; critique0 #7; brief A2):
 *  - never once `vppsone.migration_runs` holds a `cutover` row: after T0 a
 *    stray mirror would delete every receipt One has posted;
 *  - never while `fee_writes_enabled = 'true'`: One is the system of record;
 *  - only on a database marked production — the mirror is the production
 *    load — unless `--allow-dev-target` (a rehearsal on a throwaway target);
 *  - `--first-load` (TEST-session rows copied from live, T1) only if no
 *    earlier applied load exists.
 * A dry run evaluates the same guards and reports them; it writes nothing.
 */
export function decideLoadGuard({ environment, hasCutover, feeWritesEnabled, allowDevTarget = false, firstLoad = false, previousApplied = 0 }) {
  const reasons = [];
  if (hasCutover) reasons.push("vppsone.migration_runs has a cutover row: One is the system of record, the mirror is over (plan §2.3).");
  if (String(feeWritesEnabled ?? "").trim().toLowerCase() === "true") {
    reasons.push("app_settings.fee_writes_enabled is 'true': One is taking fee writes, and a mirror load would overwrite them.");
  }
  if (environment !== "production" && !allowDevTarget) {
    reasons.push(`vppsone.deployment says '${environment ?? "unreadable"}', not 'production'. Pass --allow-dev-target only for a rehearsal on a throwaway target.`);
  }
  if (firstLoad && previousApplied > 0) {
    reasons.push(`--first-load, but ${previousApplied} applied load(s) already ran: TEST-session rows are copied from live once only (T1).`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * tail-sync (plan §7.8, §12.1): only after cutover (the watermark is the
 * cutover load's), and only on production.
 */
export function decideTailGuard({ environment, hasCutover, allowDevTarget = false }) {
  const reasons = [];
  if (!hasCutover) reasons.push("no cutover row in vppsone.migration_runs: before T0 the nightly mirror carries every change, not tail-sync.");
  if (environment !== "production" && !allowDevTarget) reasons.push(`vppsone.deployment says '${environment ?? "unreadable"}', not 'production'.`);
  return { ok: reasons.length === 0, reasons };
}

/** storage-copy --apply: real photos and documents land only on production (or a rehearsal target). */
export function decideStorageGuard({ environment, allowDevTarget = false }) {
  if (environment === "production" || allowDevTarget) return { ok: true, reasons: [] };
  return { ok: false, reasons: [`vppsone.deployment says '${environment ?? "unreadable"}', not 'production'.`] };
}

/** Read the guard inputs over an open `postgres` connection. */
export async function readGuardState(sql) {
  const [row] = await sql`
    select
      (select d.environment from vppsone.deployment d where d.id = 1) as environment,
      exists (select 1 from vppsone.migration_runs r where r.kind = 'cutover') as has_cutover,
      (select a.value from public.app_settings a where a.key = 'fee_writes_enabled') as fee_writes_enabled,
      (select count(*)::int from vppsone.migration_runs r
        where r.script = 'load-snapshot' and r.kind = 'run' and r.status = 'succeeded') as previous_applied
  `;
  return {
    environment: row.environment ?? null,
    hasCutover: row.has_cutover,
    feeWritesEnabled: row.fee_writes_enabled ?? null,
    previousApplied: row.previous_applied,
  };
}
