/**
 * P12 / Prompt 8: the fee app's contracts are exactly as they were — proved
 * from the catalogue of the dev copy, never by calling live fees.
 *
 *   npm run verify:fee-parity                      # exit 1 on any broken promise
 *   npm run verify:fee-parity -- --write-baseline  # record today's fingerprints (only after a reviewed change)
 *   npm run verify:fee-parity -- --json            # and write docs/evidence/P12-fee-parity-<date>.json
 *
 * Two kinds of check:
 *
 *   * **The guards the plan names are present**: request-key idempotency on
 *     receipts, the serialising lock on posting, append-only receipts and
 *     payments, the protected money columns, a capped late-fee waiver that
 *     keeps owed-versus-collected provenance, and locked reversals.
 *   * **Nothing moved**: every function, trigger and index in `public` and
 *     `private` is fingerprinted (md5 of its definition) and compared with
 *     `docs/evidence/fee-contract-baseline.json`. A difference names what
 *     changed. Pair with the architecture test that no migration in this repo
 *     writes or replaces a fee object except D-191's.
 *
 * Read-only: `vppsone.fee_contract_fingerprints()` reads definitions, not
 * data. Rule 3: dev only.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
const writeBaseline = process.argv.includes("--write-baseline");
const baselinePath = path.join(repoRoot, "docs", "evidence", "fee-contract-baseline.json");

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

// Rule 3 / D-346: One's main project only, and on production it only reads.
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-fee-parity", mode: "read-only" });

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const { data: rows, error } = await db.rpc("fee_contract_fingerprints");
if (error) throw new Error(error.message);
const byName = new Map(rows.map((row) => [row.name, row]));
const find = (prefix) => rows.find((row) => row.name.startsWith(prefix));

console.log("\nP12 — the fee app's contracts, from the catalogue of the dev copy\n");

const index = byName.get("public.receipts_student_client_request_id_unique");
check(
  "1. a repeated post is idempotent: receipts are unique per student and client_request_id, where one is given",
  Boolean(index) && /UNIQUE/i.test(index.definition) && /client_request_id/.test(index.definition) && /WHERE/i.test(index.definition),
);

const post = find("public.post_student_payment(");
check(
  "2. posting serialises receipt numbering with an advisory lock and carries client_request_id",
  Boolean(post) && /pg_advisory_xact_lock/.test(post.definition) && /client_request_id/.test(post.definition),
);

const receiptsAppendOnly = byName.get("public.receipts:receipts_are_append_only");
const paymentsAppendOnly = byName.get("public.payments:payments_are_append_only");
const appendFn = find("private.prevent_append_only_mutation(") ?? find("public.prevent_append_only_mutation(");
check(
  "3. receipts and payments are append-only: a delete is refused",
  Boolean(receiptsAppendOnly && paymentsAppendOnly && appendFn) && /DELETE/i.test(appendFn.definition),
);

const protect = find("private.protect_receipt_money_columns(");
check("4. a receipt's money columns are protected", Boolean(protect) && /RAISE/i.test(protect.definition));

const waive = find("public.waive_late_fee(");
check(
  "5. a late-fee waiver is locked, capped, idempotent and keeps owed-versus-collected provenance",
  Boolean(waive) &&
    /pg_advisory_xact_lock/.test(waive.definition) &&
    /least\(/i.test(waive.definition) &&
    /client_request_id/.test(waive.definition) &&
    /manual_collected/.test(waive.definition),
);

const reverse = find("public.reverse_receipt_admin(");
const voidWaiver = find("public.void_late_fee_waiver(");
check(
  "6. a reversal and a voided waiver are serialised",
  Boolean(reverse && voidWaiver) && /pg_advisory_xact_lock/.test(reverse.definition) && /pg_advisory_xact_lock/.test(voidWaiver.definition),
);

const fingerprints = Object.fromEntries(rows.map((row) => [row.name, row.md5]));

// One-only preambles (supabase/fee-migrations/README.md) are inserted between
// `-- [vppsone:<name>]` and `-- [/vppsone]` lines. With those blocks removed a
// function is byte for byte the fees app's, so its md5 then is the
// "fees-identical" fingerprint plan §8.3 compares against the fees catalogue
// to tell fees drift from One's own changes.
const ONE_ONLY_BLOCK = /  -- \[vppsone:[a-z0-9-]+\]\n[\s\S]*?  -- \[\/vppsone\]\n/g;
const feesIdentical = Object.fromEntries(
  rows
    .filter((row) => /  -- \[vppsone:[a-z0-9-]+\]\n/.test(row.definition ?? ""))
    .map((row) => [row.name, createHash("md5").update(row.definition.replace(ONE_ONLY_BLOCK, ""), "utf8").digest("hex")]),
);

if (writeBaseline || !existsSync(baselinePath)) {
  mkdirSync(path.dirname(baselinePath), { recursive: true });
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ recordedAt: new Date().toISOString(), count: rows.length, fingerprints, feesIdentical }, null, 2)}\n`,
  );
  console.log(`  · baseline written: ${path.relative(repoRoot, baselinePath)} (${rows.length} objects)`);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).fingerprints;
const changed = Object.keys(baseline).filter((name) => fingerprints[name] !== undefined && fingerprints[name] !== baseline[name]);
const removed = Object.keys(baseline).filter((name) => fingerprints[name] === undefined);
const added = Object.keys(fingerprints).filter((name) => baseline[name] === undefined);
check(
  "7. no fee function, trigger or index changed, appeared or disappeared since the baseline",
  changed.length === 0 && removed.length === 0 && added.length === 0,
  [changed.length ? `changed: ${changed.join(", ")}` : "", removed.length ? `removed: ${removed.join(", ")}` : "", added.length ? `added: ${added.join(", ")}` : ""]
    .filter(Boolean)
    .join("; ") || `${rows.length} objects match`,
);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P12-fee-parity-${day}.json`);
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

// Not process.exit(): on Windows it can abort inside libuv while the HTTP
// client is still closing its sockets, which turns a pass into exit 127.
process.exitCode = failed.length > 0 ? 1 : 0;
