/**
 * P11, against the database and the buckets: an archive copies every table
 * and every document and photograph with a manifest, a restore drill brings
 * them back exactly, and a drill notices when anything has been changed.
 *
 *   npm run verify:archive            # exit 1 on any broken promise
 *   npm run verify:archive -- --json  # and write docs/evidence/P11-archive-<date>.json
 *
 * Runs the app's own engine (`src/modules/archives/data/archive-engine.ts`)
 * through the alias hook, so the archive proved here is the archive the
 * screen builds. Plants one synthetic 1×1 photograph so the object path is
 * exercised, and removes it, the archive's files and its catalogue row at the
 * end. Rule 3: dev only.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { ARCHIVES_BUCKET, buildArchive, drillArchive } from "@/modules/archives/data/archive-engine";

import { toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

// Rule 3 / D-346: One's main project only, and on production it refuses (it writes real-session data).
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-archive", mode: "dev-only" });

const options = { db: { schema: "vppsone" }, auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const adminUser = users.users.find((entry) => entry.email === "qa.admin@qa.vpps.local");
const { data: admin } = await db.from("staff_profiles").select("id").eq("user_id", adminUser.id).single();
const { data: setting } = await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const planted = `qa-archive/${Date.now()}.png`;
await db.storage.from("vppsone-photos").upload(planted, PNG, { contentType: "image/png" });

const { data: row } = await db
  .from("archives")
  .insert({ label: "QA verify-archive", session_label: setting?.value ?? "QA", created_by: admin.id })
  .select("id")
  .single();
const archiveId = row.id;
let manifest = null;

console.log("\nP11 — archives and the restore drill, against the database and the buckets\n");

try {
  const built = await buildArchive(db, { archiveId, label: "QA verify-archive", sessionLabel: setting?.value ?? "QA", appCommit: null });
  await db.from("archives").update({ status: "ready", manifest: built }).eq("id", archiveId);
  // Drill with the catalogue's copy, as the screen does: it comes back from
  // jsonb with its keys reordered, which once made every drill fail there.
  manifest = (await db.from("archives").select("manifest").eq("id", archiveId).single()).data.manifest;

  const { data: tables } = await db.rpc("archive_tables");
  check(
    "1. every VPPS One table is in the archive, each with its rows, digest and checksum",
    manifest.tables.length === tables.length && manifest.tables.every((table) => table.md5 && table.sha256 && table.rows >= 0),
    `${manifest.totals.tables} tables, ${manifest.totals.rows} rows`,
  );

  const { data: listing } = await db.rpc("archive_object_listing");
  const plantedEntry = manifest.objects.find((object) => object.name === planted);
  check(
    "2. every document and photograph is copied, with its checksum",
    manifest.objects.length === listing.length && plantedEntry?.sha256 === createHash("sha256").update(PNG).digest("hex"),
    `${manifest.totals.objects} files`,
  );

  const { data: live } = await db.rpc("archive_table_digest", { p_table: "role_permissions" });
  const archivedRoles = manifest.tables.find((table) => table.name === "role_permissions");
  check("3. a quiet table's archived digest is the live table's", archivedRoles?.md5 === live.md5 && archivedRoles?.rows === Number(live.rows));

  const drill = await drillArchive(db, manifest, randomUUID());
  check(
    "4. the restore drill reloads every table to the same digest and re-hashes every file",
    drill.ok && drill.tables.checked === manifest.tables.length && drill.objects.checked === manifest.objects.length && drill.roundTrip === "ok",
    JSON.stringify({ tables: drill.tables.checked, objects: drill.objects.checked, roundTrip: drill.roundTrip }),
  );

  // A drill must notice when the archive is not what the manifest says.
  const alter = (fn) => {
    const copy = JSON.parse(JSON.stringify(manifest));
    fn(copy);
    return copy;
  };
  const badSha = await drillArchive(db, alter((m) => { m.tables[0].sha256 = "0".repeat(64); }), randomUUID());
  check("5. a file that does not match its checksum fails the drill", !badSha.ok && badSha.tables.failed[0]?.why === "checksum");

  const badMd5 = await drillArchive(db, alter((m) => { m.tables[1].md5 = "0".repeat(32); }), randomUUID());
  check("6. rows that do not reload to the archived digest fail the drill", !badMd5.ok && badMd5.tables.failed[0]?.why === "reload");

  const missing = await drillArchive(db, alter((m) => { m.tables[2].path = `${archiveId}/tables/nothing-here.json`; }), randomUUID());
  check("7. a missing file fails the drill", !missing.ok && missing.tables.failed[0]?.why === "missing");

  const badObject = await drillArchive(db, alter((m) => { m.objects[0].sha256 = "0".repeat(64); }), randomUUID());
  check("8. a photograph whose bytes changed fails the drill", !badObject.ok && badObject.objects.failed[0]?.why === "checksum");

  const anonymous = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const { data: leaked } = await anonymous.storage.from(ARCHIVES_BUCKET).download(`${archiveId}/manifest.json`);
  check("9. the archive bucket is private: no key, no manifest", !leaked);
} finally {
  if (manifest) {
    const paths = [...manifest.tables.map((table) => table.path), ...manifest.objects.map((object) => object.path), `${archiveId}/manifest.json`];
    for (let i = 0; i < paths.length; i += 100) await db.storage.from(ARCHIVES_BUCKET).remove(paths.slice(i, i + 100));
  }
  await db.from("archives").delete().eq("id", archiveId);
  await db.storage.from("vppsone-photos").remove([planted]);
}

const { data: left } = await db.storage.from(ARCHIVES_BUCKET).list(archiveId);
check("10. the archive's files and row are gone afterwards", (left ?? []).length === 0);

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P11-archive-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
