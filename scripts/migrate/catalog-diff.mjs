#!/usr/bin/env node
/**
 * Diff two catalog fingerprints (scripts/migrate/catalog-fingerprint.sql).
 *
 *   node scripts/migrate/catalog-diff.mjs live.json one.json
 *   node scripts/migrate/catalog-diff.mjs live.json --one-db     # fingerprint One live, over one-db.mjs
 *
 * Each JSON file is what the SQL returned, in any of the shapes a tool hands
 * back: the fingerprint object itself, `{ "fingerprint": {...} }`, or
 * `[ { "fingerprint": {...} } ]`. The fees side is taken through the Supabase
 * MCP `execute_sql` (a plain SELECT of catalog tables); this script never
 * connects to the fees database.
 *
 * Prints counts per kind and the object names that differ — never row data,
 * because there is none in a fingerprint. Exit 1 when anything differs, so
 * it can gate a phase; docs/cutover/SCHEMA-PARITY.md classifies what remains.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fingerprint object out of whatever shape the tool returned. */
export function unwrapFingerprint(value) {
  let current = value;
  if (Array.isArray(current)) current = current[0];
  if (current && typeof current === "object" && "fingerprint" in current) current = current.fingerprint;
  if (typeof current === "string") current = JSON.parse(current);
  if (!current || typeof current !== "object") throw new Error("Not a catalog fingerprint.");
  return current;
}

/** { kind: { changed: [names], onlyLeft: [names], onlyRight: [names] } } for kinds that differ. */
export function diffFingerprints(left, right) {
  const out = {};
  const kinds = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const kind of [...kinds].sort()) {
    const a = left[kind] ?? {};
    const b = right[kind] ?? {};
    const changed = [];
    const onlyLeft = [];
    const onlyRight = [];
    for (const key of Object.keys(a)) {
      if (!(key in b)) onlyLeft.push(key);
      else if (a[key] !== b[key]) changed.push(key);
    }
    for (const key of Object.keys(b)) if (!(key in a)) onlyRight.push(key);
    if (changed.length || onlyLeft.length || onlyRight.length) {
      out[kind] = { changed: changed.sort(), onlyLeft: onlyLeft.sort(), onlyRight: onlyRight.sort() };
    }
  }
  return out;
}

async function fingerprintOneDb() {
  const { openOneDb } = await import("./lib/one-db.mjs");
  const repoRoot = path.resolve(here, "..", "..");
  const env = Object.fromEntries(
    readFileSync(path.join(repoRoot, ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );
  const sql = await openOneDb(env);
  try {
    const query = readFileSync(path.join(here, "catalog-fingerprint.sql"), "utf8");
    const rows = await sql.begin("read only", (tx) => tx.unsafe(query));
    return unwrapFingerprint(rows);
  } finally {
    await sql.end();
  }
}

async function main() {
  const [leftFile, rightArg] = process.argv.slice(2);
  if (!leftFile || !rightArg) {
    console.error("Usage: catalog-diff.mjs <live.json> <one.json | --one-db>");
    process.exit(2);
  }
  const left = unwrapFingerprint(JSON.parse(readFileSync(leftFile, "utf8")));
  const right = rightArg === "--one-db" ? await fingerprintOneDb() : unwrapFingerprint(JSON.parse(readFileSync(rightArg, "utf8")));

  const diff = diffFingerprints(left, right);
  for (const kind of Object.keys({ ...left, ...right }).sort()) {
    const counts = `${Object.keys(left[kind] ?? {}).length} vs ${Object.keys(right[kind] ?? {}).length}`;
    const d = diff[kind];
    console.log(
      `${kind.padEnd(12)} ${counts.padEnd(12)} ${
        d ? `changed ${d.changed.length}, only live ${d.onlyLeft.length}, only One ${d.onlyRight.length}` : "equal"
      }`,
    );
    if (d) {
      for (const name of d.changed) console.log(`    ~ ${name}`);
      for (const name of d.onlyLeft) console.log(`    < ${name}`);
      for (const name of d.onlyRight) console.log(`    > ${name}`);
    }
  }
  process.exit(Object.keys(diff).length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
