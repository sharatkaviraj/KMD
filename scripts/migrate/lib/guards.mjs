/**
 * When a migrate tool may write to One's database. Pure decisions, so the
 * refusals are tested without a database (tests/migrate-tooling.test.ts).
 */

/**
 * load-snapshot (plan §2.3; critique0 #7; brief A2):
 *  - never once `vppsone.migration_runs` holds a `cutover` row: after T0 a
 *    stray mirror would delete every receipt One has posted;
 *  - never while One is open for real fee writes. The DATABASE decides that,
 *    not this file: `vppsone.fee_writes_open()` is true whenever the key is
 *    not 'false' on a target not marked production (a missing key counts as
 *    open there), and only for 'true' on production. The loader refuses
 *    unless that function says false — unreadable counts as open — and also
 *    on the literal 'true' as a second check;
 *  - only on a database marked production — the mirror is the production
 *    load — unless `--allow-dev-target` (a rehearsal on a throwaway target);
 *  - `--first-load` (TEST-session rows copied from live, T1) only if no
 *    earlier applied load exists;
 *  - never while public sign-ups are on (plan §6 Q21, D-355 (1)): twelve
 *    `public` tables let any signed-in user read under the fees app's
 *    policies, so a self-registered account could read the parent data the
 *    load brings. `signupDisabled` comes from lib/auth-settings.mjs; only
 *    `true` passes — unreadable counts as on.
 * `rollbackOnly` (load-snapshot --rollback-only: every write is rolled back)
 * lifts the environment, fee-writes and sign-up guards — nothing it does
 * persists — but never the cutover guard: after T0 its locks would stall
 * real postings.
 * A dry run evaluates the same guards and reports them; it writes nothing.
 */
export function decideLoadGuard({ environment, hasCutover, feeWritesEnabled, feeWritesOpen, signupDisabled, allowDevTarget = false, firstLoad = false, previousApplied = 0, rollbackOnly = false }) {
  const reasons = [];
  if (hasCutover) reasons.push("vppsone.migration_runs has a cutover row: One is the system of record, the mirror is over (plan §2.3).");
  if (!rollbackOnly && String(feeWritesEnabled ?? "").trim().toLowerCase() === "true") {
    reasons.push("app_settings.fee_writes_enabled is 'true': One is taking fee writes, and a mirror load would overwrite them.");
  } else if (!rollbackOnly && feeWritesOpen !== false) {
    reasons.push(
      feeWritesOpen === true
        ? "vppsone.fee_writes_open() is true: One is open for real-session fee writes (on a target not marked production a missing or non-'false' key counts as open), and a mirror load would overwrite them. Set fee_writes_enabled='false' first."
        : "vppsone.fee_writes_open() could not be read; refusing as if fee writes were open.",
    );
  }
  if (environment !== "production" && !allowDevTarget && !rollbackOnly) {
    reasons.push(`vppsone.deployment says '${environment ?? "unreadable"}', not 'production'. Pass --allow-dev-target only for a rehearsal on a throwaway target.`);
  }
  if (!rollbackOnly && signupDisabled !== true) {
    reasons.push(
      signupDisabled === false
        ? "Public sign-ups are on (GoTrue disable_signup is false): a self-registered account could read the parent data this load brings (plan §6 Q21). The owner turns them off first: Dashboard → Authentication → Sign In / Providers → \"Allow new users to sign up\"."
        : "Could not read whether public sign-ups are off (/auth/v1/settings); refusing as if they were on (plan §6 Q21).",
    );
  }
  if (firstLoad && previousApplied > 0) {
    // previousApplied leaves out loads a backup-one --restore undid (readGuardState).
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

/**
 * backup-one --restore (the rollback of cutover steps 3 and 4,
 * CUTOVER-RUNBOOK-2026-27.md): puts One's tables back to a backup.
 *  - never once a `cutover` row exists: after T0 One's own postings are the
 *    record, and a restore would erase them (the way back then is
 *    ROLLBACK-2026-27.md, never a restore) — not even rehearsed, as its locks
 *    would stall real postings;
 *  - only on a database marked production (the restore follows step 2), and
 *    only while `vppsone.fee_writes_open()` is false (unreadable = open), so
 *    nothing is being posted while the tables are emptied and refilled.
 * `rollbackOnly` (--rollback-only: every write rolled back) lifts the last
 * two, as for load-snapshot: nothing it does persists.
 */
export function decideRestoreGuard({ environment, hasCutover, feeWritesOpen, rollbackOnly = false }) {
  const reasons = [];
  if (hasCutover) {
    reasons.push("vppsone.migration_runs has a cutover row: One's postings are the record now; a restore would erase them. Use ROLLBACK-2026-27.md.");
  }
  if (!rollbackOnly && environment !== "production") {
    reasons.push(`vppsone.deployment says '${environment ?? "unreadable"}', not 'production': a restore follows cutover step 2.`);
  }
  if (!rollbackOnly && feeWritesOpen !== false) {
    reasons.push(
      feeWritesOpen === true
        ? "vppsone.fee_writes_open() is true: set fee_writes_enabled='false' first, so nothing is posted while the tables are refilled."
        : "vppsone.fee_writes_open() could not be read; refusing as if fee writes were open.",
    );
  }
  return { ok: reasons.length === 0, reasons };
}

/** Read the guard inputs over an open `postgres` connection. */
export async function readGuardState(sql) {
  const [row] = await sql`
    select
      (select d.environment from vppsone.deployment d where d.id = 1) as environment,
      exists (select 1 from vppsone.migration_runs r where r.kind = 'cutover') as has_cutover,
      (select a.value from public.app_settings a where a.key = 'fee_writes_enabled') as fee_writes_enabled,
      vppsone.fee_writes_open() as fee_writes_open,
      -- A load a later restore undid (backup-one --restore names it in
      -- undid_runs) no longer counts: the next load is a first load again.
      (select count(*)::int from vppsone.migration_runs r
        where r.script = 'load-snapshot' and r.kind = 'run' and r.status = 'succeeded'
          and not exists (
            select 1 from vppsone.migration_runs u
            where u.script = 'backup-one-restore' and u.kind = 'rollback' and u.status = 'succeeded'
              and coalesce(u.summary -> 'undid_runs', '[]'::jsonb) @> to_jsonb(array[r.id::text])
          )) as previous_applied
  `;
  return {
    environment: row.environment ?? null,
    hasCutover: row.has_cutover,
    feeWritesEnabled: row.fee_writes_enabled ?? null,
    // null (not a boolean) is treated as open by decideLoadGuard.
    feeWritesOpen: typeof row.fee_writes_open === "boolean" ? row.fee_writes_open : null,
    previousApplied: row.previous_applied,
  };
}
