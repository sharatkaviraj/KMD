#!/usr/bin/env node
/**
 * Turn One's main database into production, in place (go-live phase H;
 * runbook step 2; plan §0.1 "Phase 1 becomes turn dev into production";
 * D-341, D-346; owner override T1).
 *
 *   node scripts/migrate/convert-to-production.mjs                  # dry run: preflight + each step's before/after + checklist
 *   node scripts/migrate/convert-to-production.mjs --apply          # every step not yet done, one transaction
 *   node scripts/migrate/convert-to-production.mjs --revert <step>  # undo one step from the last --apply's record
 *
 * Preflight (refuses --apply otherwise):
 *   - a backup-one run from the last 24 h whose manifest is on this machine
 *     and matches its run row (runbook step 1);
 *   - every supabase/migrations file is in the database's ledger (the merged
 *     PRs are applied) — fee-migrations are listed, informational;
 *   - the marker says 'dev' or already 'production' (re-running is a no-op);
 *   - no cutover row.
 *
 * Steps, in order (each idempotent; each records its before-state in the
 * `convert-to-production` migration_runs row, which is what --revert reads):
 *   fee-writes      app_settings.fee_writes_enabled = 'false' (real-session
 *                   fee writes shut until the owner opens them at T0)
 *   test-prefix     TEST-2026-27's receipt prefix 'TST' and its
 *                   one_owned_fee_settings row, if missing (D-346)
 *   marker          vppsone.deployment.environment = 'production'
 *   test-accounts   every profile a QA / smoke / day-run LOGIN uses (a
 *                   @qa.vpps.local user, a smoke_pool auth user, a day-run
 *                   account's user) is_test_account = true — never banned
 *                   (T1: QA tooling is confined, not banned)
 *   test-phones     a test-account profile's phone / WhatsApp number that is
 *                   not on vppsone.message_test_recipients is nulled — the
 *                   masked 99999… numbers are real, reachable mobiles
 *                   (critique0 #17)
 *   smoke-enforce   kept scheduled when vppsone.smoke_enforce() provably
 *                   touches test seats only (its body reaches auth.users /
 *                   auth.sessions only through vppsone.smoke_pool, whose rows
 *                   are all smoke.*@qa.vpps.local logins on test accounts);
 *                   otherwise unscheduled
 *   dispatch-flags  runtime_flags parent_dispatch and staff_notice_dispatch
 *                   off (the owner turns categories on one by one, step 9)
 *
 * Output: counts and settings only — no names, numbers or ids of people.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";
import { isMain, loadOneEnv, newRunId, parseArgs, repoRoot } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { CONVERT_STEPS, smokeEnforceIsConfined, TEST_SESSION } from "./lib/quarantine-rules.mjs";
import { backupState } from "./lib/quarantine-state.mjs";

/** The test-account set: profiles a QA / smoke / day-run login signs in as. */
const LOGIN_PROFILES_SQL = `
  select p.id::text from vppsone.staff_profiles p
  where p.user_id in (
    select u.id from auth.users u where lower(u.email) like '%@qa.vpps.local'
    union select sp.auth_user_id from vppsone.smoke_pool sp where sp.auth_user_id is not null
    union select d.user_id from vppsone.qa_dayrun_accounts d where d.user_id is not null
  )`;

/** Last-10-digit comparison against the allowlist (numbers never leave the database). */
const NOT_ALLOWLISTED = (col) =>
  `(${col} is not null and right(regexp_replace(${col}, '\\D', '', 'g'), 10) not in (select right(regexp_replace(r.phone_e164, '\\D', '', 'g'), 10) from vppsone.message_test_recipients r))`;

/**
 * Each step: read(tx) → { done, before, show }, apply(tx, before), revert(tx, before).
 * `before` is what --revert writes back.
 */
export const STEPS = {
  "fee-writes": {
    what: "app_settings.fee_writes_enabled = 'false'",
    async read(tx) {
      const [row] = await tx`select value from public.app_settings where key = 'fee_writes_enabled'`;
      const value = row?.value ?? null;
      return { done: value === "false", before: { value }, show: value === null ? "missing" : `'${value}'` };
    },
    async apply(tx) {
      await tx`insert into public.app_settings (key, value) values ('fee_writes_enabled', 'false') on conflict (key) do update set value = 'false'`;
    },
    async revert(tx, before) {
      if (before.value === null) await tx`delete from public.app_settings where key = 'fee_writes_enabled'`;
      else await tx`update public.app_settings set value = ${before.value} where key = 'fee_writes_enabled'`;
    },
  },
  "test-prefix": {
    what: `${TEST_SESSION} receipt prefix 'TST', One-owned`,
    async read(tx) {
      const [p] = await tx`select receipt_prefix from public.fee_policy_configs where academic_session_label = ${TEST_SESSION}`;
      const [o] = await tx`select count(*)::int as n from vppsone.one_owned_fee_settings where source_table = 'fee_policy_configs' and row_key = ${TEST_SESSION} and column_name = 'receipt_prefix'`;
      const prefix = p?.receipt_prefix ?? null;
      return {
        done: !p || (prefix === "TST" && o.n === 1),
        before: { exists: Boolean(p), prefix, owned: o.n === 1 },
        show: p ? `'${prefix}', ${o.n ? "One-owned" : "not One-owned"}` : `no ${TEST_SESSION} policy row (nothing to set)`,
      };
    },
    async apply(tx, before) {
      if (!before.exists) return;
      await tx`update public.fee_policy_configs set receipt_prefix = 'TST' where academic_session_label = ${TEST_SESSION} and receipt_prefix is distinct from 'TST'`;
      await tx`
        insert into vppsone.one_owned_fee_settings (source_table, row_key, column_name, reason)
        values ('fee_policy_configs', ${TEST_SESSION}, 'receipt_prefix',
                'TEST postings are numbered TST so they never consume real SVP numbers (D-346). The fees app still says SVP; the mirror must not copy it back.')
        on conflict do nothing`;
    },
    async revert(tx, before) {
      if (!before.exists) return;
      await tx`update public.fee_policy_configs set receipt_prefix = ${before.prefix} where academic_session_label = ${TEST_SESSION}`;
      if (!before.owned) await tx`delete from vppsone.one_owned_fee_settings where source_table = 'fee_policy_configs' and row_key = ${TEST_SESSION} and column_name = 'receipt_prefix'`;
    },
  },
  marker: {
    what: "vppsone.deployment.environment = 'production'",
    async read(tx) {
      const [row] = await tx`select environment from vppsone.deployment where id = 1`;
      return { done: row?.environment === "production", before: { environment: row?.environment ?? null }, show: `'${row?.environment ?? "missing"}'` };
    },
    async apply(tx) {
      await tx`update vppsone.deployment set environment = 'production' where id = 1`;
    },
    async revert(tx, before) {
      await tx`update vppsone.deployment set environment = ${before.environment ?? "dev"} where id = 1`;
    },
  },
  "test-accounts": {
    what: "every QA / smoke / day-run login's profile is a test account (never banned)",
    async read(tx) {
      const ids = (await tx.unsafe(`${LOGIN_PROFILES_SQL} and not p.is_test_account`)).map((r) => r.id);
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from (${LOGIN_PROFILES_SQL}) x`);
      return { done: ids.length === 0, before: { ids }, show: `${n} login profile(s), ${ids.length} not yet a test account` };
    },
    async apply(tx, before) {
      if (before.ids.length) await tx`update vppsone.staff_profiles set is_test_account = true where id = any(${before.ids}::uuid[])`;
    },
    async revert(tx, before) {
      if (before.ids.length) await tx`update vppsone.staff_profiles set is_test_account = false where id = any(${before.ids}::uuid[])`;
    },
  },
  "test-phones": {
    what: "no test account keeps a number that is not on the test allowlist",
    async read(tx) {
      const rows = await tx.unsafe(`
        select id::text, phone, whatsapp_phone from vppsone.staff_profiles
        where is_test_account and (${NOT_ALLOWLISTED("phone")} or ${NOT_ALLOWLISTED("whatsapp_phone")})`);
      // The before-state stays in the database (the run row), never on the terminal.
      return { done: rows.length === 0, before: { rows }, show: `${rows.length} test profile(s) with a number off the allowlist` };
    },
    async apply(tx, before) {
      for (const r of before.rows) {
        await tx.unsafe(
          `update vppsone.staff_profiles set
             phone = case when ${NOT_ALLOWLISTED("phone")} then null else phone end,
             whatsapp_phone = case when ${NOT_ALLOWLISTED("whatsapp_phone")} then null else whatsapp_phone end
           where id = $1 and is_test_account`,
          [r.id],
        );
      }
    },
    async revert(tx, before) {
      for (const r of before.rows) await tx`update vppsone.staff_profiles set phone = ${r.phone}, whatsapp_phone = ${r.whatsapp_phone} where id = ${r.id}`;
    },
  },
  "smoke-enforce": {
    what: "smoke-enforce cron kept only if it acts on test seats only",
    async read(tx) {
      const [job] = await tx`select jobname, schedule, command, active from cron.job where jobname = 'smoke-enforce'`;
      const [fn] = await tx`select pg_get_functiondef(to_regprocedure('vppsone.smoke_enforce()')) as body`;
      const pool = await tx`
        select sp.email, sp.staff_profile_id::text, p.is_test_account
        from vppsone.smoke_pool sp left join vppsone.staff_profiles p on p.id = sp.staff_profile_id`;
      const verdict = smokeEnforceIsConfined(fn?.body, pool);
      return {
        done: !job || verdict.confined,
        before: job ? { schedule: job.schedule, command: job.command, active: job.active } : null,
        show: job ? `scheduled ${job.schedule}; ${verdict.confined ? "acts on test seats only → kept" : `NOT confined (${verdict.reasons.join("; ")}) → unscheduled`}` : "not scheduled",
        verdict,
      };
    },
    async apply(tx, before, read) {
      if (before && !read.verdict.confined) await tx`select cron.unschedule('smoke-enforce')`;
    },
    async revert(tx, before) {
      if (!before) return;
      const [job] = await tx`select 1 from cron.job where jobname = 'smoke-enforce'`;
      if (!job) await tx`select cron.schedule('smoke-enforce', ${before.schedule}, ${before.command})`;
    },
  },
  "dispatch-flags": {
    what: "runtime_flags parent_dispatch and staff_notice_dispatch off",
    async read(tx) {
      const rows = await tx`select key, enabled from vppsone.runtime_flags where key in ('parent_dispatch', 'staff_notice_dispatch') order by key`;
      return {
        done: rows.length === 2 && rows.every((r) => r.enabled === false),
        before: { flags: Object.fromEntries(rows.map((r) => [r.key, r.enabled])) },
        show: rows.map((r) => `${r.key}=${r.enabled ? "on" : "off"}`).join(", ") || "missing",
      };
    },
    async apply(tx) {
      for (const key of ["parent_dispatch", "staff_notice_dispatch"]) {
        await tx`
          insert into vppsone.runtime_flags (key, enabled, note) values (${key}, false, 'convert-to-production (go-live phase H)')
          on conflict (key) do update set enabled = false, note = 'convert-to-production (go-live phase H)', updated_at = now()`;
      }
    },
    async revert(tx, before) {
      for (const [key, enabled] of Object.entries(before.flags ?? {})) await tx`update vppsone.runtime_flags set enabled = ${enabled}, updated_at = now() where key = ${key}`;
    },
  },
};

/**
 * The local migration files the database's ledger does not have. A
 * supabase/migrations file is applied under its own version (the name may
 * differ: 20261011092957 is `vx_fee_collector_collects`); a fee-migration
 * under the name `fee_<file>` (`_no_cron` when its cron block was
 * stripped). Pure given the lists. ledger: [{ version, name }].
 */
export function missingMigrations(ledger, vppsoneFiles, feeFiles) {
  const names = new Set(ledger.map((r) => r.name));
  const versions = new Set(ledger.map((r) => String(r.version)));
  const strip = (f) => f.replace(/\.sql$/, "");
  const nameOf = (f) => strip(f).replace(/^\d+_/, "");
  const versionOf = (f) => f.match(/^(\d+)_/)[1];
  return {
    vppsone: vppsoneFiles.filter((f) => !versions.has(versionOf(f)) && !names.has(nameOf(f))),
    fee: feeFiles.filter((f) => !names.has(`fee_${strip(f)}`) && !names.has(`fee_${strip(f)}_no_cron`) && !names.has(nameOf(f))),
  };
}

export async function preflight(sql) {
  const backup = await backupState(sql);
  const ledger = await sql`select version, name from supabase_migrations.schema_migrations`;
  const list = (dir) => readdirSync(path.join(repoRoot, "supabase", dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const missing = missingMigrations(ledger, list("migrations"), list("fee-migrations"));
  const [{ environment, has_cutover: hasCutover }] = await sql`
    select (select environment from vppsone.deployment where id = 1) as environment,
           exists (select 1 from vppsone.migration_runs where kind = 'cutover') as has_cutover`;
  const reasons = [];
  if (!backup.ok) reasons.push(`no usable backup: ${backup.reason} (runbook step 1)`);
  if (missing.vppsone.length) reasons.push(`${missing.vppsone.length} supabase/migrations file(s) not in the ledger: ${missing.vppsone.slice(0, 5).join(", ")}${missing.vppsone.length > 5 ? ", …" : ""}`);
  if (!["dev", "production"].includes(environment)) reasons.push(`marker is '${environment ?? "unreadable"}'`);
  if (hasCutover) reasons.push("a cutover row exists: conversion is long over");
  return { ok: reasons.length === 0, reasons, backup, missing, environment };
}

async function readAll(tx, names) {
  const out = {};
  for (const name of names) out[name] = await STEPS[name].read(tx);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = await openOneDb(loadOneEnv());
  try {
    if (args.revert) {
      const step = String(args.revert);
      if (!STEPS[step]) throw new Error(`--revert takes one of: ${CONVERT_STEPS.join(", ")}`);
      const [run] = await sql`
        select id, summary from vppsone.migration_runs
        where script = 'convert-to-production' and kind = 'run' and status = 'succeeded' and summary -> 'steps' ? ${step}
        order by finished_at desc limit 1`;
      if (!run) throw new Error(`No convert-to-production run changed ${step}; nothing to revert.`);
      const summary = typeof run.summary === "string" ? JSON.parse(run.summary) : run.summary;
      await sql.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '10s'");
        await STEPS[step].revert(tx, summary.steps[step].before);
        await tx`
          insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
          values ('convert-to-production', 'rollback', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${String(run.id)}, now(), 'succeeded',
                  ${tx.json({ step })}, ${`Reverted step ${step} of that run.`})`;
      });
      const after = await sql.begin("read only", (tx) => STEPS[step].read(tx));
      console.log(`convert-to-production --revert ${step}: done — now ${after.show}`);
      return;
    }

    const apply = Boolean(args.apply);
    console.log(`convert-to-production: ${apply ? "APPLY" : "dry run"} on ${ONE_MAIN_PROJECT_REF}`);
    const pre = await preflight(sql);
    console.log(`  preflight: backup ${pre.backup.ok ? `ok (${pre.backup.runId})` : `MISSING — ${pre.backup.reason}`}; ` +
      `vppsone migrations not in the ledger: ${pre.missing.vppsone.length}; fee-migrations not in the ledger (information): ${pre.missing.fee.length}${pre.missing.fee.length ? ` (${pre.missing.fee.join(", ")})` : ""}; marker '${pre.environment}'`);

    const before = await sql.begin("read only", (tx) => readAll(tx, CONVERT_STEPS));
    for (const name of CONVERT_STEPS) {
      console.log(`  [${before[name].done ? "x" : " "}] ${name.padEnd(15)} ${STEPS[name].what} — now: ${before[name].show}`);
    }
    if (args["rollback-only"]) {
      // Every step applied, checked, every step reverted, checked equal to
      // the start — then ROLLBACK. Proves the SQL of both directions; nothing
      // persists (other sessions never see the marker move).
      const ROLLBACK = new Error("rehearsal");
      const results = [];
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe("set local lock_timeout = '10s'");
          const reads = {};
          for (const name of CONVERT_STEPS) {
            reads[name] = await STEPS[name].read(tx);
            if (!reads[name].done) await STEPS[name].apply(tx, reads[name].before, reads[name]);
          }
          const applied = await readAll(tx, CONVERT_STEPS);
          const [{ open }] = await tx`select vppsone.fee_writes_open() as open`;
          for (const name of [...CONVERT_STEPS].reverse()) if (!reads[name].done) await STEPS[name].revert(tx, reads[name].before);
          const reverted = await readAll(tx, CONVERT_STEPS);
          for (const name of CONVERT_STEPS) {
            results.push({ name, applied: applied[name].done, reverted: JSON.stringify(reverted[name].before) === JSON.stringify(reads[name].before) });
          }
          results.push({ name: "fee_writes_open() after apply is false", applied: open === false, reverted: true });
          throw ROLLBACK;
        });
      } catch (error) {
        if (error !== ROLLBACK) throw error;
      }
      for (const r of results) console.log(`  rehearsal ${r.name.padEnd(40)} apply ${r.applied ? "ok" : "FAILED"}; revert ${r.reverted ? "ok" : "FAILED"}`);
      const passed = results.every((r) => r.applied && r.reverted);
      console.log(`  ${passed ? "REHEARSAL PASSED" : "REHEARSAL FAILED"} (rolled back; nothing changed)`);
      if (!passed) process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log(`  ${pre.ok ? "preflight passes" : `preflight would refuse --apply: ${pre.reasons.join("; ")}`}`);
      console.log(`  ${CONVERT_STEPS.filter((n) => !before[n].done).length} step(s) to do. Then: select environment from vppsone.deployment; select vppsone.fee_writes_open();`);
      if (!pre.ok) process.exitCode = 1;
      return;
    }
    if (!pre.ok) throw new Error(`refusing: ${pre.reasons.join("; ")}`);

    const runId = `convert-${newRunId()}`;
    const steps = {};
    await sql.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout = '10s'");
      await tx.unsafe("lock table vppsone.deployment, vppsone.migration_runs in exclusive mode");
      for (const name of CONVERT_STEPS) {
        const read = await STEPS[name].read(tx);
        if (read.done) continue;
        await STEPS[name].apply(tx, read.before, read);
        steps[name] = { before: read.before };
      }
      await tx`
        insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, finished_at, status, summary, note)
        values ('convert-to-production', 'run', ${ONE_MAIN_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${runId}, now(), 'succeeded',
                ${tx.json({ steps, backup: pre.backup.runId })},
                ${`Runbook step 2 (phase H). Before-states for --revert. Backup ${pre.backup.runId}.`})`;
    });
    const after = await sql.begin("read only", (tx) => readAll(tx, CONVERT_STEPS));
    console.log(`  APPLIED (${Object.keys(steps).length} step(s) changed); run ${runId}. Checklist:`);
    for (const name of CONVERT_STEPS) console.log(`  [${after[name].done ? "x" : " "}] ${name.padEnd(15)} ${after[name].show}`);
    const [{ open }] = await sql`select vppsone.fee_writes_open() as open`;
    console.log(`  vppsone.fee_writes_open() = ${open} (must be false)`);
    if (open !== false || CONVERT_STEPS.some((n) => !after[n].done)) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`convert-to-production: ${error.message}`);
    process.exitCode = 2;
  });
}
