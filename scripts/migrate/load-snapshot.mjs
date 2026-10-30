#!/usr/bin/env node
/**
 * Load an extract into One's database `public` (plan §2.3, §2.4; critique0
 * #2, #3, #7, #18, #27, #28; owner override T1).
 *
 *   node scripts/migrate/load-snapshot.mjs [--run <id>]            # dry run (default)
 *   node scripts/migrate/load-snapshot.mjs --run <id> --apply      # write
 *     --first-load          also copy TEST-session rows from live (once, T1)
 *     --allow-dev-target    a rehearsal on a target not marked production
 *     --purge-secrets       only delete the run's sealed auth rows, then exit
 *
 * Target: One's main project only, through lib/one-db.mjs (which refuses the
 * fees ref by name). The source is the run folder; this script never opens
 * the fees database.
 *
 * DRY RUN (default) is read-only: one `READ ONLY` transaction reads One's
 * catalog and rows and prints what --apply would do — counts per table,
 * blocked deletes, predicted foreign-key orphans and unique conflicts, the
 * auth plan, and the guard verdict. No migration_runs row, no staging table.
 *
 * APPLY, in ONE transaction:
 *   1. guards (lib/guards.mjs): refuses after a cutover row, while
 *      fee_writes_enabled='true', on a target not marked production (unless
 *      --allow-dev-target), and a repeated --first-load;
 *   2. auth users upserted by id; an email clash refuses (lib/auth-import.mjs);
 *   3. the loaded tables locked (EXCLUSIVE: reads go on), One's rows read and
 *      the plan made INSIDE the transaction, so it cannot be stale;
 *   4. the plan refuses on any predicted orphan, unique conflict or missing
 *      auth parent;
 *   5. every source row staged into `import_stage.<t>` (created `LIKE
 *      public.<t>`), so the writes below are set-based from staging;
 *   6. the NAMED user triggers of each loaded table disabled
 *      (`ALTER TABLE … DISABLE TRIGGER "name"`) — never
 *      session_replication_role, which would also switch off foreign keys;
 *   7. deletes children-first, inserts and updates parents-first, cyclic
 *      foreign-key columns written in a second pass;
 *   8. triggers re-enabled; an orphan count per foreign-key constraint in
 *      pg_constraint (any orphan aborts); matviews refreshed in dependency
 *      order; owned sequences setval'd; watermarks written;
 * then a `migration_runs` row records the counts, and the run's sealed auth
 * rows are deleted (critique0 #28).
 *
 * Never touched: protected rows (TEST-D- shells, migration_id_map targets and
 * everything keyed on them), One-owned settings, and — except on --first-load
 * — TEST-session rows on either side. Never touched at all: SKIP_TABLES.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { applyAuthImport, planAuthImport } from "./lib/auth-import.mjs";
import { matviewOrder, MATVIEW_ORDER_SQL, readCatalog } from "./lib/catalog.mjs";
import { planLoad, summarizePlan } from "./lib/diff.mjs";
import { isMain, latestRunId, loadOneEnv, parseArgs, runDir } from "./lib/env.mjs";
import { decideLoadGuard, readGuardState } from "./lib/guards.mjs";
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
  const plan = planLoad({ meta, source, target, idMap, oneOwned, firstLoad, feesRef: FEES_SOURCE_PROJECT_REF });

  const targetAuth = await tx`select id::text, email from auth.users`;
  const authPlan = planAuthImport(authUsers ?? [], targetAuth);
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
  return { meta, plan, authPlan, externalMissingRefs, drift };
}

function report({ plan, authPlan, externalMissingRefs, drift }, guard) {
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
  if (summary.skipped.length) console.log(`  never loaded: ${summary.skipped.join(", ")}`);
  if (Object.keys(drift).length) console.log(`  column drift: ${JSON.stringify(drift)}`);
  console.log(`  deferred FK columns: ${JSON.stringify(summary.deferred)}`);
  console.log(`  auth users: insert ${authPlan.insert.length}, update ${authPlan.update.length}, email clashes ${authPlan.clashes.length}`);
  console.log(`  blocked deletes ${summary.blockedDeletes}; predicted orphans ${summary.predictedOrphans.length}; unique conflicts ${summary.uniqueConflicts.length}; missing auth parents ${externalMissingRefs.length}`);
  for (const o of summary.predictedOrphans) console.log(`    orphan ${o.constraint}: ${o.count}`);
  for (const u of summary.uniqueConflicts) console.log(`    unique ${u.table}(${u.columns.join(",")}): ${u.duplicates}`);
  for (const m of externalMissingRefs) console.log(`    missing parent ${m.constraint}: ${m.count ?? m.note}`);
  console.log(`  guard: ${guard.ok ? "--apply would be allowed" : `--apply refuses: ${guard.reasons.join(" ")}`}`);
  return summary;
}

/** Any of these stops --apply. Pure. */
export function blockers({ plan, authPlan, externalMissingRefs }) {
  const out = [];
  if (plan.orphans.length) out.push(`${plan.orphans.length} foreign key(s) would be left with orphans`);
  if (plan.uniqueConflicts.length) out.push(`${plan.uniqueConflicts.length} unique key(s) would collide`);
  if (externalMissingRefs.length) out.push(`${externalMissingRefs.length} foreign key(s) point at auth users that do not exist`);
  if (authPlan.clashes.length) out.push(`${authPlan.clashes.length} fees user(s) share an email with a different One user`);
  return out;
}

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
  // Break cycles on rows about to go, then delete children-first.
  for (const table of [...touched].reverse()) {
    const p = plan.tables[table];
    const pk = meta.tables[table].pk;
    counts[table] = { deleted: 0, inserted: 0, updated: 0 };
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
    }
  }

  // Second pass: the cyclic FK columns, now every parent exists.
  for (const table of touched) {
    const columns = plan.deferred[table] ?? [];
    if (!columns.length) continue;
    const p = plan.tables[table];
    const pk = meta.tables[table].pk;
    const set = columns.map((c) => `${ident(c)} = s.${ident(c)}`).join(", ");
    for (const part of chunks(keyObjects([...p.insert, ...p.update], p.rows, pk))) {
      await tx.unsafe(
        `update public.${ident(table)} x set ${set}
         from import_stage.${ident(table)} s
         join jsonb_populate_recordset(null::import_stage.${ident(table)}, $1::jsonb) k on ${pkJoin(pk, "s", "k")}
         where ${pkJoin(pk, "x", "s")}`,
        [JSON.stringify(part)],
      );
    }
  }

  for (const table of touched) {
    for (const trigger of meta.tables[table].triggers) {
      await tx.unsafe(`alter table public.${ident(table)} enable trigger ${ident(trigger)}`);
    }
  }
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

async function refreshAndSetval(tx, meta, touched) {
  const order = matviewOrder(await tx.unsafe(MATVIEW_ORDER_SQL));
  for (const view of order) await tx.unsafe(`refresh materialized view public.${ident(view)}`);
  for (const table of touched) {
    for (const { column, sequence } of meta.tables[table].sequences) {
      await tx.unsafe(
        `select setval($1::regclass, coalesce((select max(${ident(column)}) from public.${ident(table)}), 0) + 1, false)`,
        [sequence],
      );
    }
  }
  return order;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = typeof args.run === "string" ? args.run : latestRunId();
  if (!runId) throw new Error("No extract run found; run extract-live.mjs first or pass --run.");
  const run = runDir(runId, { create: false });

  if (args["purge-secrets"]) {
    console.log(`load-snapshot: ${purgeSecrets(run) ? "deleted" : "no"} sealed auth rows for run ${runId}.`);
    return;
  }

  const apply = Boolean(args.apply);
  const firstLoad = Boolean(args["first-load"]);
  const manifest = JSON.parse(readFileSync(path.join(run, "manifest.json"), "utf8"));
  if (manifest.sourceProject !== FEES_SOURCE_PROJECT_REF) throw new Error("The run's manifest is not from the fees project.");

  const source = await readRunTables(run, manifest);
  const authUsers = readSecretJson(run, "auth-users") ?? [];
  console.log(`load-snapshot: run ${runId} (${manifest.tables.length} tables), ${apply ? "APPLY" : "dry run"}${firstLoad ? ", first load" : ""}, target ${ONE_MAIN_PROJECT_REF}.`);

  const sql = await openOneDb(loadOneEnv());
  try {
    const state = await sql.begin("read only", (tx) => readGuardState(tx));
    const guard = decideLoadGuard({ ...state, allowDevTarget: Boolean(args["allow-dev-target"]), firstLoad });

    if (!apply) {
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
      console.error(`load-snapshot: refusing --apply. ${guard.reasons.join(" ")}`);
      process.exit(1);
    }

    const [runRow] = await sql`
      insert into vppsone.migration_runs (script, kind, source_project, target_project, snapshot_id, snapshot_at, note)
      values ('load-snapshot', 'run', ${FEES_SOURCE_PROJECT_REF}, ${ONE_MAIN_PROJECT_REF}, ${manifest.watermark.snapshotId},
        ${manifest.watermark.newestChangeAt}, ${firstLoad ? "first load (TEST-session rows copied)" : null})
      returning id`;

    try {
      const outcome = await sql.begin(async (tx) => {
        await prepareTransaction(tx);
        // Re-check inside the write transaction: the state may have moved.
        const inner = decideLoadGuard({ ...(await readGuardState(tx)), allowDevTarget: Boolean(args["allow-dev-target"]), firstLoad });
        if (!inner.ok) throw new Error(inner.reasons.join(" "));

        const targetAuth = await tx`select id::text, email from auth.users`;
        const authPlan = planAuthImport(authUsers, targetAuth);
        if (authPlan.clashes.length) throw new Error(`${authPlan.clashes.length} fees user(s) share an email with a different One user.`);
        const auth = await applyAuthImport(tx, authUsers, authPlan);

        const meta0 = await readCatalog(tx);
        for (const t of manifest.tables) {
          if (meta0.tables[t.name]) await tx.unsafe(`lock table public.${ident(t.name)} in exclusive mode`);
        }
        const built = await buildPlan(tx, { manifest, source, authUsers, firstLoad });
        const summary = report(built, inner);
        const stop = blockers(built);
        if (stop.length) throw new Error(`plan refused: ${stop.join("; ")}`);

        const { counts, touched } = await applyPlan(tx, built);
        const orphans = await orphanCheck(tx, built.meta);
        if (orphans.length) throw new Error(`orphans after apply: ${orphans.map((o) => `${o.constraint} ${o.count}`).join(", ")}`);
        const refreshed = await refreshAndSetval(tx, built.meta, touched);

        for (const t of manifest.tables) {
          await tx`
            insert into vppsone.migration_watermarks (source_project, source_table, snapshot_id, snapshot_at, run_id, row_count, content_md5)
            values (${FEES_SOURCE_PROJECT_REF}, ${`public.${t.name}`}, ${manifest.watermark.snapshotId}, ${manifest.watermark.newestChangeAt},
              ${runRow.id}, ${t.rowCount}, ${t.md5})
            on conflict (source_project, source_table) do update set
              snapshot_id = excluded.snapshot_id, snapshot_at = excluded.snapshot_at, run_id = excluded.run_id,
              row_count = excluded.row_count, content_md5 = excluded.content_md5, updated_at = now()`;
        }
        return { summary, counts, auth, refreshed };
      });

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
