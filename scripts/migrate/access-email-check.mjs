#!/usr/bin/env node
/**
 * Read-only, both databases: for each fees user with no One account (plan Q6,
 * answered 31 Oct — they sign in by password reset / sign-in link at
 * cutover), is the address One would send that email to the address the live
 * fees app has? Run it before ANY access email is sent.
 *
 *   node scripts/migrate/access-email-check.mjs                 # after the load: must print ok
 *   node scripts/migrate/access-email-check.mjs --before-load   # a look before it; clears nothing
 *
 * Prints one line per such user: the fees role and match yes / no / not loaded.
 * No id, name or address is printed; addresses are compared as lowercase
 * SHA-256 hashes in memory (lib/access-email.mjs). Users whose email is
 * already a One account are remapped onto it and keep their One login and
 * password; they are counted, not listed.
 *
 * Exit 2 when any row is "no" or a fees user is ambiguous (two fees users, one
 * One account): no access email goes out until that is resolved by hand.
 * Exit 2 too, as NOT VERIFIED, when any row is "not loaded" — nothing was
 * compared for it — unless --before-load, which says the run is informational
 * only and exits 0. "ok" means every row is "yes" (accessEmailVerdict).
 * This script sends nothing and writes nothing.
 */

import process from "node:process";

import { accessEmailCheck, accessEmailVerdict } from "./lib/access-email.mjs";
import { isMain, loadFeesSecrets, loadOneEnv, parseArgs } from "./lib/env.mjs";
import { openFeesReadOnly } from "./lib/fees-readonly.mjs";
import { readAllRows } from "./lib/live-read.mjs";
import { openOneDb } from "./lib/one-db.mjs";
import { readIdMap } from "./lib/one-target.mjs";
import { authIdMap } from "./load-snapshot.mjs";

async function listAllAuthUsers(fees) {
  const out = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await fees.authAdmin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth list: ${error.message}`);
    out.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < 1000) return out;
  }
  throw new Error("auth list did not end.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fees = openFeesReadOnly(loadFeesSecrets());
  const [sourceAuthUsers, sourceFeeUsers] = await Promise.all([listAllAuthUsers(fees), readAllRows(fees, "users", ["id"])]);

  const sql = await openOneDb(loadOneEnv());
  let targetAuthUsers;
  let idMap;
  try {
    [targetAuthUsers, idMap] = await sql.begin("read only", async (tx) => [
      await tx`select id::text, email from auth.users`,
      await readIdMap(tx),
    ]);
  } finally {
    await sql.end();
  }

  const result = accessEmailCheck({ sourceAuthUsers, sourceFeeUsers, targetAuthUsers, knownMap: authIdMap(idMap) });
  console.log("access-email-check: read-only; nothing is sent or written.");
  console.log(`  fees users with no One account: ${result.rows.length}; remapped onto a One account (keep their One login): ${result.remapped}; ambiguous: ${result.clashes}`);
  for (const row of result.rows) console.log(`    ${row.role}: email matches live ${row.match}`);
  const { verdict, exitCode } = accessEmailVerdict(result, { beforeLoad: Boolean(args["before-load"]) });
  console.log(`access-email-check: ${verdict}.`);
  if (exitCode !== 0) process.exit(exitCode);
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`access-email-check: ${error.message}`);
    process.exit(1);
  });
}
