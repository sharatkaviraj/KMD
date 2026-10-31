#!/usr/bin/env node
/**
 * Load an extract into One's database `public` (plan §2.3, §2.4; critique0
 * #2, #3, #7, #18, #27, #28; owner override T1).
 *
 *   node scripts/migrate/load-snapshot.mjs [--run <id>]            # dry run (default)
 *   node scripts/migrate/load-snapshot.mjs --run <id> --apply      # write
 *   node scripts/migrate/load-snapshot.mjs --run <id> --rollback-only  # rehearse every write, then roll back
 *     --first-load          also copy TEST-session rows from live (once, T1)
 *     --allow-dev-target    a rehearsal on a target not marked production
 *     --purge-secrets       only delete the run's sealed auth rows, then exit
 * --apply and --rollback-only need an explicit --run (never "the latest").
 *
 * Target: One's main project only, through lib/one-db.mjs (which refuses the
 * fees ref by name). The source is the run folder; this script never opens
 * the fees database.
 *
 * DRY RUN (default) is read-only: one `READ ONLY` transaction reads One's
 * catalog and rows and prints what --apply would do — counts per table,
 * blocked deletes, re-pointed children, predicted foreign-key orphans and
 * unique conflicts, live data One cannot hold, the auth plan, and the guard
 * verdict. No migration_runs row, no staging table.
 *
 * APPLY, in ONE transaction:
 *   1. locks first — vppsone.migration_runs, vppsone.deployment,
 *      public.app_settings and every loaded table (EXCLUSIVE: reads go on) —
 *      THEN the guards (lib/guards.mjs), so nothing they read can change
 *      under the load: refuses after a cutover row, while
 *      vppsone.fee_writes_open() is not false, on a target not marked
 *      production (unless --allow-dev-target), a repeated --first-load, and
 *      while public sign-ups are on (lib/auth-settings.mjs, plan §6 Q21);
 *   2. auth users upserted by id; an email clash refuses (lib/auth-import.mjs);
 *   3. One's rows read and the plan made INSIDE the transaction, so it cannot
 *      be stale;
 *   4. the plan refuses on any predicted orphan, unique conflict, missing auth
 *      parent, re-pointed row that cannot be detached, live table with rows
 *      or live column that One lacks (NOT_MIGRATED aside), or auth rows
 *      without identities;
 *   5. every source row staged into `import_stage.<t>` (created `LIKE
 *      public.<t>`), so the writes below are set-based from staging;
 *   6. the NAMED user triggers of each loaded table disabled
 *      (`ALTER TABLE … DISABLE TRIGGER "name"`) — never
 *      session_replication_role, which would also switch off foreign keys;
 *   7. refuses if a delete would reach a row outside `public`; re-pointed
 *      children detached (FK nulled); deletes children-first, inserts and
 *      updates parents-first, cyclic foreign-key columns in a second pass;
 *   8. triggers re-enabled; written counts must equal the plan's, table by
 *      table (a cascade would otherwise lose rows silently); staging tables
 *      dropped; an orphan count per foreign-key constraint in pg_constraint
 *      (any orphan aborts); matviews refreshed in dependency order and the
 *      refresh queue told so; owned sequences setval'd (bigint identities to
 *      at least ONE_IDENTITY_FLOOR); watermarks written;
 * then a `migration_runs` row records the counts, and the run's sealed auth
 * rows are deleted (critique0 #28).
 *
 * --rollback-only runs all of APPLY and then rolls the transaction back:
 * proof the SQL path works, nothing persisted (no run row either). It lifts
 * the environment and fee-writes guards, never the cutover guard.
 *
 * Never touched: protected rows (TEST-D- shells, migration_id_map targets and
 * everything keyed on them), One-owned settings, and — except on --first-load
 * — TEST-session rows on either side. Never touched at all: SKIP_TABLES.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { applyAuthImport, oneRoleForFeeRole, planAuthImport, remapUserReferences, shortNameFor } from "./lib/auth-import.mjs";
import { matviewOrder, MATVIEW_ORDER_SQL, readCatalog } from "./lib/catalog.mjs";
import { planLoad, summarizePlan } from "./lib/diff.mjs";
import { isMain, latestRunId, loadOneEnv, parseArgs, runDir } from "./lib/env.mjs";
import { readSignupDisabled } from "./lib/auth-settings.mjs";
import { decideLoadGuard, readGuardState } from "./lib/guards.mjs";
import { unmigratedSourceData } from "./lib/import-rules.mjs";
import { readRunTables } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { ident, prepareTransaction, readIdMap, readOneOwned, readPublicTables } from "./lib/one-target.mjs";
import { purgeSecrets, readSecretJson } from "./lib/secrets-box.mjs";
import { FEES_SOURCE_PROJECT_REF, ONE_MAIN_PROJECT_REF } from "../target-guard.mjs";

const CHUNK = 500;

function chunks(list, size = CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** `x.a = k.a and x.b = k.b` over the primary key. */
function pkJoin(pk, left, right) {
  return pk.map((c) => `${left}.${ident(c)} = ${right}.${ident(c)}`).join(" and ");
}

/** pk strings (lib/rows.mjs pkKey) back to key objects. */
export function deleteKeyRows(keys, pk) {
  return keys.map((k) => (pk.length === 1 ? { [pk[0]]: k } : Object.fromEntries(pk.map((c, i) => [c, JSON.parse(k)[i]]))));
}

function keyObjects(keys, rowsByPk, pk) {
  return keys.map((key) => Object.fromEntries(pk.map((c) => [c, rowsByPk.get(key)?.[c] ?? null])));
}

async function externalMissing(tx, plan, authPlanIds) {
  const missing = [];
  for (const ref of plan.external) {
    if (ref.parent !== "auth.users" || ref.parentCols.length !== 1) {
      missing.push({ constraint: ref.constraint, note: `unchecked parent ${ref.parent}` });
      continue;
    }
    const ids = [...ref.tuples].map((t) => JSON.parse(t)[0]);
    let count = 0;
    for (const part of chunks(ids, 1000)) {
      const found = await tx`select id::text from auth.users where id = any(${part}::uuid[])`;
      const have = new Set(found.map((r) => r.id));
      count += part.filter((id) => !have.has(String(id)) && !authPlanIds.has(String(id))).length;
    }
    if (count) missing.push({ constraint: ref.constraint, child: ref.child, count });
  }
  return missing;
}

async function buildPlan(tx, { manifest, source, authUsers, firstLoad }) {
  const meta = await readCatalog(tx);
  const tables = manifest.tables.map((t) => t.name);
  const target = await readPublicTables(tx, meta, tables);
  // Parents a loaded table points at but the extract does not carry.
  for (const fk of meta.fks) {
    if ((fk.parentSchema ?? "public") === "public" && !target.has(fk.parent) && meta.tables[fk.parent]) {
      target.set(fk.parent, (await readPublicTables(tx, meta, [fk.parent])).get(fk.parent));
    }
  }
  const idMap = await readIdMap(tx);
  const oneOwned = await readOneOwned(tx);

  // D-350: a fees user who already has a One account (same email) is the same
  // person — remapped onto One's id, never inserted twice — and every One
  // account's public.users row is derived from its staff profile, so the
  // mirror leaves it alone.
  const targetAuth = await tx`select id::text, email from auth.users`;
  const authPlan = planAuthImport(authUsers ?? [], targetAuth, authIdMap(idMap));
  const profiles = await tx`select user_id::text, role::text, is_test_account from vppsone.staff_profiles where user_id is not null`;
  const derivedUserIds = new Set(profiles.map((row) => row.user_id));
  const remapped = remapUserReferences(source, authPlan.remap);
  const plan = planLoad({ meta, source: remapped, target, idMap, oneOwned, firstLoad, feesRef: FEES_SOURCE_PROJECT_REF, derivedUserIds });
  const unmigrated = unmigratedSourceData(manifest.tables, meta);
  const feeUsers = feeUserMapping({ authUsers: authUsers ?? [], feeUserRows: source.get("users") ?? [], authPlan, profiles });

  const authIds = new Set([...authPlan.insert, ...authPlan.update]);
  const externalMissingRefs = await externalMissing(tx, plan, authIds);

  // Column drift between the extract and One's schema, names only.
  const drift = {};
  for (const t of manifest.tables) {
    const one = meta.tables[t.name];
    if (!one) continue;
    const oneCols = new Set(one.columns.map((c) => c.name));
    const srcCols = new Set(t.columns);
    const onlySource = [...srcCols].filter((c) => !oneCols.has(c));
    const onlyOne = [...oneCols].filter((c) => !srcCols.has(c));
    if (onlySource.length || onlyOne.length) drift[t.name] = { onlySource, onlyOne };
  }
  return { meta, plan, authPlan, externalMissingRefs, drift, unmigrated, feeUsers, authAudit: authCompleteness(manifest, authUsers) };
}

/** fees id -> One id from migration_id_map rows for auth.users. Pure. */
export function authIdMap(idMap = []) {
  return new Map(
    idMap
      .filter((row) => row.source_project === FEES_SOURCE_PROJECT_REF && row.source_table === "auth.users")
      .map((row) => [String(row.source_id), String(row.target_id)]),
  );
}

/**
 * Plan §1.4: each fees user, by role only — whether a One account takes them
 * (same email, remapped) and with which One role, or they arrive as a new One
 * account with the role oneRoleForFeeRole gives. Counts, no names. Pure.
 */
export function feeUserMapping({ authUsers, feeUserRows, authPlan, profiles }) {
  const feeRole = new Map(feeUserRows.map((row) => [String(row.id), String(row.role ?? "")]));
  const remapTo = new Map((authPlan.remap ?? []).map((r) => [String(r.sourceId), String(r.targetId)]));
  const profileOf = new Map(profiles.map((row) => [String(row.user_id), row]));
  const rows = new Map();
  for (const user of authUsers) {
    const id = String(user.id);
    const role = feeRole.get(id) ?? "(no public.users row)";
    const target = remapTo.get(id) ?? (authPlan.update.includes(id) ? id : null);
    const profile = target ? profileOf.get(target) : null;
    const outcome = authPlan.clashes.includes(id)
      ? "refused: ambiguous email"
      : profile
        ? `existing One account, One role ${profile.role}${profile.is_test_account ? " (test account)" : ""}`
        : target
          ? `existing One auth user without a profile: profile created, One role ${oneRoleForFeeRole(role)}`
          : `new One account, One role ${oneRoleForFeeRole(role)}`;
    const key = `${role} -> ${outcome}`;
    rows.set(key, (rows.get(key) ?? 0) + 1);
  }
  return [...rows.entries()].map(([mapping, count]) => ({ mapping, count })).sort((a, b) => a.mapping.localeCompare(b.mapping));
}

/**
 * The run's sealed auth rows must carry identities: a user loaded without
 * one cannot sign in by email. Run 20261030-a2-first sealed its users before
 * identities were fetched (manifest auth.identities 0). Pure.
 */
export function authCompleteness(manifest, authUsers = []) {
  const users = authUsers.length;
  const identities = authUsers.reduce((n, u) => n + (Array.isArray(u.identities) ? u.identities.length : 0), 0);
  const manifestUsers = manifest?.auth?.users ?? 0;
  const manifestIdentities = manifest?.auth?.identities ?? 0;
  const problems = [];
  if (manifestUsers > 0 && manifestIdentities === 0) problems.push(`the run's manifest records ${manifestUsers} auth user(s) and 0 identities`);
  if (users > 0 && identities === 0) problems.push(`the sealed auth rows hold ${users} user(s) and no identity`);
  if (manifestUsers > 0 && users === 0) problems.push(`the manifest records ${manifestUsers} auth user(s) but the sealed rows are missing (purged?)`);
  return { users, identities, problems };
}

function report({ plan, authPlan, externalMissingRefs, drift, unmigrated, authAudit, feeUsers = [] }, guard) {
  const summary = summarizePlan(plan);
  console.log(`load-snapshot: totals insert ${summary.totals.insert}, update ${summary.totals.update}, delete ${summary.totals.delete}, unchanged ${summary.totals.unchanged}.`);
  for (const [table, c] of Object.entries(summary.perTable)) {
    const extra = Object.entries(c)
      .filter(([k, v]) => !["insert", "update", "delete", "unchanged"].includes(k) && v)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    if (c.insert || c.update || c.delete || extra) {
      console.log(`  ${table}: +${c.insert} ~${c.update} -${c.delete} =${c.unchanged}${extra ? ` (${extra})` : ""}`);
    }
  }
  if (summary.notInOne.length) console.log(`  not in One's public (not loaded): ${summary.notInOne.join(", ")}`);
  for (const t of unmigrated.tables) console.log(`    REFUSES: live table ${t.table} has ${t.rows} row(s) and is neither in One nor on NOT_MIGRATED`);
  for (const c of unmigrated.columns) console.log(`    REFUSES: live ${c.table} has column(s) One lacks: ${c.columns.join(", ")}`);
  if (summary.skipped.length) console.log(`  never loaded: ${summary.skipped.join(", ")}`);
  if (Object.keys(drift).length) console.log(`  column drift: ${JSON.stringify(drift)}`);
  console.log(`  deferred FK columns: ${JSON.stringify(summary.deferred)}`);
  console.log(`  auth users: insert ${authPlan.insert.length}, update ${authPlan.update.length}, remapped onto One accounts by email ${(authPlan.remap ?? []).length}, ambiguous ${authPlan.clashes.length}; identities ${authAudit.identities}`);
  for (const row of feeUsers) console.log(`    fees user ${row.mapping}: ${row.count}`);
  for (const p of authAudit.problems) console.log(`    REFUSES: ${p}`);
  console.log(`  blocked deletes ${summary.blockedDeletes}; re-pointed children ${summary.repointed.reduce((n, r) => n + r.rows, 0)}; predicted orphans ${summary.predictedOrphans.length}; unique conflicts ${summary.uniqueConflicts.length}; missing auth parents ${externalMissingRefs.length}`);
  for (const r of summary.repointed) console.log(`    re-pointed ${r.constraint}: ${r.rows}${r.nullable ? " (FK nulled before the deletes)" : " (NOT NULL: refuses)"}${r.notUpdated ? `, ${r.notUpdated} not updated (refuses)` : ""}`);
  for (const o of summary.predictedOrphans) console.log(`    orphan ${o.constraint}: ${o.count}`);
  for (const u of summary.uniqueConflicts) console.log(`    unique ${u.table}(${u.columns.join(",")}): ${u.duplicates}`);
  for (const m of externalMissingRefs) console.log(`    missing parent ${m.constraint}: ${m.count ?? m.note}`);
  console.log(`  guard: ${guard.ok ? "--apply would be allowed" : `--apply refuses: ${guard.reasons.join(" ")}`}`);
  return summary;
}

/** Any of these stops --apply. Pure. */
/**
 * @param {{ plan: any, authPlan: any, externalMissingRefs: any[], unmigrated?: { tables: any[], columns: any[] }, authAudit?: { problems: string[] } }} built
 * @returns {string[]}
 */
export function blockers({ plan, authPlan, externalMissingRefs, unmigrated = { tables: [], columns: [] }, authAudit = { problems: [] } }) {
  const out = [];
  if (plan.orphans.length) out.push(`${plan.orphans.length} foreign key(s) would be left with orphans`);
  if (plan.uniqueConflicts.length) out.push(`${plan.uniqueConflicts.length} unique key(s) would collide`);
  if (externalMissingRefs.length) out.push(`${externalMissingRefs.length} foreign key(s) point at auth users that do not exist`);
  if (authPlan.clashes.length) out.push(`${authPlan.clashes.length} fees user(s) claim a One account another fees user already maps to`);
  const repointBad = (plan.repoint ?? []).filter((r) => !r.nullable || r.notUpdated);
  if (repointBad.length) out.push(`${repointBad.length} foreign key(s) would lose re-pointed rows to a parent's delete (${repointBad.map((r) => r.constraint).join(", ")})`);
  if (unmigrated.tables.length) out.push(`${unmigrated.tables.length} live table(s) with rows that One has no table for (${unmigrated.tables.map((t) => t.table).join(", ")})`);
  if (unmigrated.columns.length) out.push(`${unmigrated.columns.length} live table(s) with columns One lacks (${unmigrated.columns.map((c) => c.table).join(", ")})`);
  for (const problem of authAudit.problems) out.push(`auth: ${problem}; extract again`);
  return out;
}

/**
 * After the writes, every table's counts must equal the plan's. A missing
 * row (a cascade, a concurrent writer, a key that did not match) is not an
 * orphan and orphanCheck cannot see it, so this is the check. Pure.
 */
export function countMismatches(plan, counts) {
  const out = [];
  for (const [table, p] of Object.entries(plan.tables)) {
    const c = counts[table] ?? { inserted: 0, updated: 0, deleted: 0 };
    if (c.inserted !== p.insert.length) out.push(`${table} inserted ${c.inserted} of ${p.insert.length}`);
    // `updated` is null for a table whose only changed columns are written in
    // the deferred second pass (counted there instead).
    if (c.updated !== null && c.updated !== p.update.length) out.push(`${table} updated ${c.updated} of ${p.update.length}`);
    if (c.deleted !== p.delete.length) out.push(`${table} deleted ${c.deleted} of ${p.delete.length}`);
  }
  return out;
}

/** A row id at or above which One's own identity values start (see refreshAndSetval). */
export const ONE_IDENTITY_FLOOR = 1_000_000_000;

async function applyPlan(tx, { meta, plan }) {
  const loaded = plan.order.filter((t) => plan.tables[t]);
  const touched = loaded.filter((t) => {
    const p = plan.tables[t];
    return p.insert.length || p.update.length || p.delete.length;
  });

  // Stage every source row of every touched table.
  await tx.unsafe("create schema if not exists import_stage");
  await tx.unsafe("revoke all on schema import_stage from public, anon, authenticated");
  for (const table of touched) {
    await tx.unsafe(`drop table if exists import_stage.${ident(table)}`);
    await tx.unsafe(`create unlogged table import_stage.${ident(table)} (like public.${ident(table)})`);
    const rows = [...plan.tables[table].rows.values()];
    for (const part of chunks(rows)) {
      await tx.unsafe(
        `insert into import_stage.${ident(table)} select * from jsonb_populate_recordset(null::import_stage.${ident(table)}, $1::jsonb)`,
        [JSON.stringify(part)],
      );
    }
  }

  // Named user triggers off, table by table.
  for (const table of touched) {
    for (const trigger of meta.tables[table].triggers) {
      await tx.unsafe(`alter table public.${ident(table)} disable trigger ${ident(trigger)}`);
    }
  }

  const counts = {};
  for (const table of touched) counts[table] = { deleted: 0, inserted: 0, updated: 0 };

  // A delete must never reach a table outside `public` (One's own vppsone
  // rows keyed on a fee row, through an ON DELETE action): refuse instead.
  for (const fk of meta.allFks ?? []) {
    if (fk.parentSchema !== "public" || fk.childSchema === "public") continue;
    const p = plan.tables[fk.parent];
    if (!p?.delete.length) continue;
    const parentPk = meta.tables[fk.parent].pk;
    const match = fk.childCols.map((c, i) => `p.${ident(fk.parentCols[i])} = c.${ident(c)}`).join(" and ");
    let n = 0;
    for (const part of chunks(deleteKeyRows(p.delete, parentPk))) {
      const [row] = await tx.unsafe(
        `select count(*)::int as n from ${ident(fk.childSchema)}.${ident(fk.child)} c
         where exists (select 1 from public.${ident(fk.parent)} p
           join jsonb_populate_recordset(null::public.${ident(fk.parent)}, $1::jsonb) k on ${pkJoin(parentPk, "p", "k")}
           where ${match})`,
        [JSON.stringify(part)],
      );
      n += row.n;
    }
    if (n) throw new Error(`${n} ${fk.childSchema}.${fk.child} row(s) reference public.${fk.parent} rows the load would delete (${fk.name}).`);
  }

  // Re-pointed children (lib/diff.mjs findRepointedChildren): null their FK
  // before the parent's delete can cascade them away; the UPDATE below writes
  // the final value.
  for (const r of plan.repoint ?? []) {
    if (!r.nullable || r.notUpdated) throw new Error(`${r.constraint}: re-pointed rows cannot be detached first.`);
    const pk = meta.tables[r.child].pk;
    let n = 0;
    for (const part of chunks(deleteKeyRows(r.keys, pk))) {
      const result = await tx.unsafe(
        `update public.${ident(r.child)} x set ${r.columns.map((c) => `${ident(c)} = null`).join(", ")}
         from jsonb_populate_recordset(null::public.${ident(r.child)}, $1::jsonb) k where ${pkJoin(pk, "x", "k")}`,
        [JSON.stringify(part)],
      );
      n += result.count;
    }
    if (n !== r.keys.length) throw new Error(`${r.constraint}: detached ${n} of ${r.keys.length} re-pointed row(s).`);
  }

  // Break cycles on rows about to go, then delete children-first.
  for (const table of [...touched].reverse()) {
    const p = plan.tables[table];
    const pk = meta.tables[table].pk;
    if (!p.delete.length) continue;
    for (const part of chunks(deleteKeyRows(p.delete, pk))) {
      const json = JSON.stringify(part);
      for (const column of plan.deferred[table] ?? []) {
        await tx.unsafe(
          `update public.${ident(table)} x set ${ident(column)} = null from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb) k where ${pkJoin(pk, "x", "k")}`,
          [json],
        );
      }
    }
  }
  for (const table of [...touched].reverse()) {
    const p = plan.tables[table];
    const pk = meta.tables[table].pk;
    if (!p.delete.length) continue;
    for (const part of chunks(deleteKeyRows(p.delete, pk))) {
      const result = await tx.unsafe(
        `delete from public.${ident(table)} x using jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb) k where ${pkJoin(pk, "x", "k")}`,
        [JSON.stringify(part)],
      );
      counts[table].deleted += result.count;
    }
  }

  // Parents first: insert and update from staging.
  for (const table of touched) {
    const p = plan.tables[table];
    const tableMeta = meta.tables[table];
    const pk = tableMeta.pk;
    const deferred = new Set(plan.deferred[table] ?? []);
    const columns = p.columns;
    const identity = tableMeta.columns.some((c) => c.identity && columns.includes(c.name));
    const select = columns.map((c) => (deferred.has(c) ? `null as ${ident(c)}` : `s.${ident(c)}`)).join(", ");
    const setList = columns.filter((c) => !pk.includes(c) && !deferred.has(c)).map((c) => `${ident(c)} = s.${ident(c)}`);

    for (const part of chunks(keyObjects(p.insert, p.rows, pk))) {
      const result = await tx.unsafe(
        `insert into public.${ident(table)} (${columns.map(ident).join(", ")}) ${identity ? "overriding system value" : ""}
         select ${select} from import_stage.${ident(table)} s
         join jsonb_populate_recordset(null::import_stage.${ident(table)}, $1::jsonb) k on ${pkJoin(pk, "s", "k")}`,
        [JSON.stringify(part)],
      );
      counts[table].inserted += result.count;
    }
    if (setList.length) {
      for (const part of chunks(keyObjects(p.update, p.rows, pk))) {
        const result = await tx.unsafe(
          `update public.${ident(table)} x set ${setList.join(", ")}
           from import_stage.${ident(table)} s
           join jsonb_populate_recordset(null::import_stage.${ident(table)}, $1::jsonb) k on ${pkJoin(pk, "s", "k")}
           where ${pkJoin(pk, "x", "s")}`,
          [JSON.stringify(part)],
        );
        counts[table].updated += result.count;
      }
    } else {
      counts[table].updated = null; // only deferred columns change: counted in the second pass
    }
  }

  // Second pass: the cyclic FK columns, now every parent exists.
  for (const table of touched) {
    const columns = plan.deferred[table] ?? [];
    if (!columns.length) continue;
    const p = plan.tables[table];
    const pk = meta.tables[table].pk;
    const set = columns.map((c) => `${ident(c)} = s.${ident(c)}`).join(", ");
    let n = 0;
    const keys = [...p.insert, ...p.update];
    for (const part of chunks(keyObjects(keys, p.rows, pk))) {
      const result = await tx.unsafe(
        `update public.${ident(table)} x set ${set}
         from import_stage.${ident(table)} s
         join jsonb_populate_recordset(null::import_stage.${ident(table)}, $1::jsonb) k on ${pkJoin(pk, "s", "k")}
         where ${pkJoin(pk, "x", "s")}`,
        [JSON.stringify(part)],
      );
      n += result.count;
    }
    if (n !== keys.length) throw new Error(`${table}: second pass wrote ${n} of ${keys.length} row(s).`);
  }

  for (const table of touched) {
    for (const trigger of meta.tables[table].triggers) {
      await tx.unsafe(`alter table public.${ident(table)} enable trigger ${ident(trigger)}`);
    }
  }

  // Every planned row written, no more and no fewer.
  const mismatched = countMismatches(plan, counts);
  if (mismatched.length) throw new Error(`the writes do not match the plan: ${mismatched.join("; ")}`);

  // The staging copies hold personal data: gone before the commit.
  for (const table of touched) await tx.unsafe(`drop table if exists import_stage.${ident(table)}`);
  const [left] = await tx`select count(*)::int as n from pg_class where relnamespace = 'import_stage'::regnamespace`;
  if (left.n === 0) await tx.unsafe("drop schema if exists import_stage");
  return { counts, touched };
}

/** Orphans per FK constraint touching public, after the writes. Any > 0 aborts. */
async function orphanCheck(tx, meta) {
  const out = [];
  for (const fk of meta.allFks) {
    const childSchema = fk.childSchema;
    const parentSchema = fk.parentSchema;
    const notNull = fk.childCols.map((c) => `c.${ident(c)} is not null`).join(" and ");
    const match = fk.childCols.map((c, i) => `p.${ident(fk.parentCols[i])} = c.${ident(c)}`).join(" and ");
    const [row] = await tx.unsafe(
      `select count(*)::int as n from ${ident(childSchema)}.${ident(fk.child)} c
       where ${notNull} and not exists (select 1 from ${ident(parentSchema)}.${ident(fk.parent)} p where ${match})`,
    );
    if (row.n) out.push({ constraint: fk.name, count: row.n });
  }
  return out;
}

/**
 * Matviews refreshed, the refresh queue told so (reconcile checks One's
 * matview was refreshed on the as-of day), and owned sequences moved past
 * the loaded rows. A bigint identity is moved to at least
 * ONE_IDENTITY_FLOOR: live keeps numbering from its own small values, so
 * rows One writes (its TEST-session online testing today, everything after
 * cutover) take ids live will never reach and the next load cannot collide
 * with them.
 */
async function refreshAndSetval(tx, meta, touched) {
  const order = matviewOrder(await tx.unsafe(MATVIEW_ORDER_SQL));
  for (const view of order) await tx.unsafe(`refresh materialized view public.${ident(view)}`);
  if (meta.tables.workbook_materialized_view_refresh_queue) {
    await tx.unsafe("update public.workbook_materialized_view_refresh_queue set pending = false, last_refreshed_at = now()");
  }
  for (const table of touched) {
    for (const { column, sequence } of meta.tables[table].sequences) {
      const type = meta.tables[table].columns.find((c) => c.name === column)?.type;
      const floor = type === "bigint" ? ONE_IDENTITY_FLOOR : 1;
      await tx.unsafe(
        `select setval($1::regclass, greatest(coalesce((select max(${ident(column)}) from public.${ident(table)}), 0) + 1, $2::bigint), false)`,
        [sequence, floor],
      );
    }
  }
  return order;
}

/** Thrown at the end of a --rollback-only rehearsal so the transaction rolls back. */
/**
 * After the rows are written (D-350): record every remap in migration_id_map,
 * give each fees user who arrived without a One account a staff profile with
 * the One role their fees role maps to, and re-derive public.users for every
 * One account a fees user was remapped onto — public.users is derived from
 * staff_profiles, never the other way round. A new profile derives its own
 * row through the staff_profiles trigger.
 */
async function settleFeeUsers(tx, { authPlan, feeUserRows, authUsers = [], runRowId }) {
  for (const r of authPlan.remap ?? []) {
    await tx`
      insert into vppsone.migration_id_map (source_project, source_table, source_id, target_id, batch_id)
      values (${FEES_SOURCE_PROJECT_REF}, 'auth.users', ${r.sourceId}, ${r.targetId}, ${runRowId})
      on conflict (source_project, source_table, source_id) do update set target_id = excluded.target_id`;
  }
  const feeRow = new Map(feeUserRows.map((row) => [String(row.id), row]));
  const emailOf = new Map(authUsers.map((user) => [String(user.id), user.email ?? null]));
  // A QA address arrives as a test account, like every QA account (Phase 3).
  const isQaAddress = (email) => typeof email === "string" && email.toLowerCase().endsWith("@qa.vpps.local");
  const taken = new Set((await tx`select short_name from vppsone.staff_profiles`).map((row) => row.short_name));
  let created = 0;
  // [One auth user id, the fees user whose public.users row describes them]:
  // new and same-id users, and One auth users a fees user was remapped onto
  // that have no staff profile yet (a login with no profile is not staff).
  const candidates = [
    ...[...authPlan.insert, ...authPlan.update].map((id) => [id, id]),
    ...(authPlan.remap ?? []).map((r) => [r.targetId, r.sourceId]),
  ];
  for (const [id, feeId] of candidates) {
    const [existing] = await tx`select id from vppsone.staff_profiles where user_id = ${id}`;
    if (existing) continue;
    const row = feeRow.get(feeId);
    if (!row) continue;
    const name = String(row.full_name ?? "").trim() || "Fees user";
    const shortName = shortNameFor(name, taken);
    taken.add(shortName);
    await tx`
      insert into vppsone.staff_profiles (user_id, display_name, short_name, role, is_active, preferred_language, is_test_account)
      values (${id}, ${name}, ${shortName}, ${oneRoleForFeeRole(String(row.role ?? ""))}::vppsone.staff_role, ${row.is_active !== false}, 'hi', ${isQaAddress(emailOf.get(feeId))})`;
    created += 1;
  }
  const targets = [...new Set((authPlan.remap ?? []).map((r) => r.targetId))];
  let rederived = 0;
  if (targets.length) {
    const rows = await tx`select vppsone.sync_fee_user_from_staff_profile(sp.id) from vppsone.staff_profiles sp where sp.user_id = any(${targets}::uuid[])`;
    rederived = rows.length;
  }
  return { remapped: (authPlan.remap ?? []).length, profilesCreated: created, rederived };
}

class RehearsalRollback extends Error {
  constructor(outcome) {
    super("rehearsal: rolled back");
    this.outcome = outcome;
  }
}

/**
 * The whole write, inside one transaction. Locks FIRST, then the guard: a
 * cutover row or an owner turning fee writes on between a read and a lock
 * would otherwise go unseen, and the load would overwrite what One wrote
 * after the flip.
 */
async function writeLoad(tx, { args, manifest, source, authUsers, firstLoad, rollbackOnly, runId, insertRunRow, signupDisabled }) {
  await prepareTransaction(tx);
  await tx.unsafe("set local lock_timeout = '60s'");
  const meta0 = await readCatalog(tx);
  // The guard's own inputs first: no cutover row, no marker change, no
  // app_settings write can commit until this transaction ends.
  await tx.unsafe("lock table vppsone.migration_runs in exclusive mode");
  await tx.unsafe("lock table vppsone.deployment in share mode");
  await tx.unsafe("lock table public.app_settings in exclusive mode");
  for (const t of manifest.tables) {
    if (meta0.tables[t.name] && t.name !== "app_settings") await tx.unsafe(`lock table public.${ident(t.name)} in exclusive mode`);
  }
  const inner = decideLoadGuard({ ...(await readGuardState(tx)), signupDisabled, allowDevTarget: Boolean(args["allow-dev-target"]), firstLoad, rollbackOnly });
  if (!inner.ok) throw new Error(inner.reasons.join(" "));
  const runRowId = await insertRunRow(tx);

  const [{ present: syncFn }] = await tx`select to_regprocedure('vppsone.sync_fee_user_from_staff_profile(uuid)') is not null as present`;
  if (!syncFn) throw new Error("vppsone.sync_fee_user_from_staff_profile is missing: apply supabase/fee-migrations/20261031000100_fee_user_from_staff_profile.sql first (D-350).");
  const targetAuth = await tx`select id::text, email from auth.users`;
  const authPlan = planAuthImport(authUsers, targetAuth, authIdMap(await readIdMap(tx)));
  if (authPlan.clashes.length) throw new Error(`${authPlan.clashes.length} fees user(s) claim a One account another fees user already maps to.`);
  const auth = await applyAuthImport(tx, authUsers, authPlan);

  const built = await buildPlan(tx, { manifest, source, authUsers, firstLoad });
  const summary = report(built, inner);
  const stop = blockers(built);
  if (stop.length) throw new Error(`plan refused: ${stop.join("; ")}`);

  const { counts, touched } = await applyPlan(tx, built);
  auth.staff = await settleFeeUsers(tx, { authPlan, feeUserRows: source.get("users") ?? [], authUsers, runRowId });
  const orphans = await orphanCheck(tx, built.meta);
  if (orphans.length) throw new Error(`orphans after apply: ${orphans.map((o) => `${o.constraint} ${o.count}`).join(", ")}`);
  const refreshed = await refreshAndSetval(tx, built.meta, touched);

  for (const t of manifest.tables) {
    await tx`
      insert into vppsone.migration_watermarks (source_project, source_table, snapshot_id, snapshot_at, run_id, row_count, content_md5)
      values (${FEES_SOURCE_PROJECT_REF}, ${`public.${t.name}`}, ${manifest.watermark.snapshotId}, ${manifest.watermark.newestChangeAt},
        ${runRowId}, ${t.rowCount}, ${t.md5})
      on conflict (source_project, source_table) do update set
        snapshot_id = excluded.snapshot_id, snapshot_at = excluded.snapshot_at, run_id = excluded.run_id,
        row_count = excluded.row_count, content_md5 = excluded.content_md5, updated_at = now()`;
  }
  const outcome = { summary, counts, auth, refreshed, runId };
  if (rollbackOnly) throw new RehearsalRollback(outcome);
  return outcome;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = Boolean(args.apply);
  const rollbackOnly = Boolean(args["rollback-only"]);
  // A write never guesses which extract: name it.
  if ((apply || rollbackOnly) && typeof args.run !== "string") throw new Error("--apply and --rollback-only need an explicit --run <id>.");
  if (apply && rollbackOnly) throw new Error("Pass --apply or --rollback-only, not both.");
  const runId = typeof args.run === "string" ? args.run : latestRunId();
  if (!runId) throw new Error("No extract run found; run extract-live.mjs first or pass --run.");
  const run = runDir(runId, { create: false });

  if (args["purge-secrets"]) {
    console.log(`load-snapshot: ${purgeSecrets(run) ? "deleted" : "no"} sealed auth rows for run ${runId}.`);
    return;
  }

  const firstLoad = Boolean(args["first-load"]);
  const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8"));
  if (manifest.sourceProject !== FEES_SOURCE_PROJECT_REF) throw new Error("The run's manifest is not from the fees project.");
  if (manifest.subset && (apply || rollbackOnly)) throw new Error(`Run ${runId} is a --tables subset; a load needs a full extract.`);

  const source = await readRunTables(run, manifest);
  const authUsers = readSecretJson(run, "auth-users") ?? [];
  const mode = rollbackOnly ? "REHEARSAL (every write rolled back)" : apply ? "APPLY" : "dry run";
  console.log(`load-snapshot: run ${runId} (${manifest.tables.length} tables), ${mode}${firstLoad ? ", first load" : ""}, target ${ONE_MAIN_PROJECT_REF}.`);

  const oneEnv = loadOneEnv();
  // Plan §6 Q21: no real load while public sign-ups are on. Read once (a GET
  // of GoTrue's public settings) and fed to both guard checks.
  const signupDisabled = await readSignupDisabled(oneEnv);
  const sql = await openOneDb(oneEnv);
  try {
    const state = await sql.begin("read only", (tx) => readGuardState(tx));
    const guard = decideLoadGuard({ ...state, signupDisabled, allowDevTarget: Boolean(args["allow-dev-target"]), firstLoad, rollbackOnly });

    if (!apply && !rollbackOnly) {
      const built = await sql.begin("read only", async (tx) => {
        await prepareTransaction(tx);
        return buildPlan(tx, { manifest, source, authUsers, firstLoad });
      });
      report(built, guard);
      const stop = blockers(built);
      console.log(`load-snapshot: dry run, nothing written.${stop.length ? ` --apply would stop: ${stop.join("; ")}.` : ""}`);
      return;
    }

    if (!guard.ok) {
      console.error(`load-snapshot: refusing ${rollbackOnly ? "--rollback-only" : "--apply"}. ${guard.reasons.join(" ")}`);
      process.exit(1);
    }

    const runRowValues = (tx) => tx`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, note)
      values ('load-snapshot', 'run', ${FEES_SOURCE_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${manifest.watermark.snapshotId},
        ${manifest.watermark.newestChangeAt}, ${rollbackOnly ? "rehearsal (rolled back)" : firstLoad ? "first load (TEST-session rows copied)" : null})
      returning id`;

    if (rollbackOnly) {
      // The run row lives and dies with the rehearsal's transaction.
      try {
        await sql.begin((tx) =>
          writeLoad(tx, { args, manifest, source, authUsers, firstLoad, rollbackOnly, runId, signupDisabled, insertRunRow: async (t) => (await runRowValues(t))[0].id }),
        );
        throw new Error("rehearsal: the transaction did not roll back");
      } catch (error) {
        if (!(error instanceof RehearsalRollback)) throw error;
        const o = error.outcome;
        console.log(`load-snapshot: REHEARSAL PASSED and rolled back — every write, the orphan check, the matview refresh and setval ran; nothing persisted. Tables written ${Object.keys(o.counts).length}; auth ${JSON.stringify(o.auth)}.`);
        return;
      }
    }

    const [runRow] = await runRowValues(sql);
    try {
      const outcome = await sql.begin((tx) =>
        writeLoad(tx, { args, manifest, source, authUsers, firstLoad, rollbackOnly: false, runId, signupDisabled, insertRunRow: async () => runRow.id }),
      );
      await sql`
        update vppsone.migration_runs set status = 'succeeded', finished_at = now(),
          summary = ${sql.json({ totals: outcome.summary.totals, perTable: outcome.counts, auth: outcome.auth, firstLoad, watermark: { newestChangeAt: manifest.watermark.newestChangeAt, auditMaxCreatedAt: manifest.watermark.auditMaxCreatedAt, auditIdsAtMax: manifest.watermark.auditIdsAtMax } })}
        where id = ${runRow.id}`;
      purgeSecrets(run);
      console.log(`load-snapshot: applied; matviews refreshed (${outcome.refreshed.join(", ")}); sealed auth rows deleted.`);
    } catch (error) {
      await sql`update vppsone.migration_runs set status = 'failed', finished_at = now(), note = ${String(error.message).slice(0, 900)} where id = ${runRow.id}`;
      throw error;
    }
  } finally {
    await sql.end();
  }
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`load-snapshot: ${error.message}`);
    process.exit(1);
  });
}
