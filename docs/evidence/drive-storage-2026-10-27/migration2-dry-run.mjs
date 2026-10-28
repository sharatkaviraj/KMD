// Dry run of 20261028090000_drive_central_backup.sql (D-334) on PGlite, on top
// of 20261027114837 and synthetic prerequisites shaped like the dev project.
// Nothing remote. Run like migration-dry-run.mjs:
//   node migration2-dry-run.mjs "<path to the vppsone checkout>"
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const repo = process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url));
const migration = async (prefix) => {
  const name = (await readdir(`${repo}/supabase/migrations`)).find((file) => file.endsWith(prefix));
  return readFile(`${repo}/supabase/migrations/${name}`, "utf8");
};
const db = new PGlite();
const results = [];
const run = async (label, sql, expectRefusal = false) => {
  try {
    await db.exec(sql);
    results.push(expectRefusal ? `FAIL (was accepted): ${label}` : `ok accepted: ${label}`);
  } catch (error) {
    const first = String(error.message).split("\n")[0];
    results.push(expectRefusal ? `ok refused: ${label} — ${first.slice(0, 110)}` : `FAIL (refused): ${label} — ${first}`);
  }
};

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema vppsone; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text, name text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz);
    create table vppsone.staff_profiles (id uuid primary key);
    create table vppsone.student_documents (
      id uuid primary key default gen_random_uuid(), session_label text not null, student_id uuid not null,
      kind text not null default 'other', storage_path text not null, file_name text not null, content_type text not null,
      byte_size integer not null, note text, uploaded_by uuid references vppsone.staff_profiles (id),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.receipts (id int primary key, amount numeric(10,2));
    insert into public.receipts values (1, 0.50), (2, 1200.00);
    insert into storage.objects (bucket_id, name, metadata) values
      ('vppsone-photos', 'p.jpg', '{"size": 1608, "mimetype": "image/jpeg"}'),
      ('parent-documents', 'r.pdf', '{"size": 70000}');
  `);
  await db.exec(await migration("_document_storage_providers.sql"));
  await db.exec(await migration("_drive_central_backup.sql"));
  results.push("ok applied: both migrations");

  const listed = (await db.query("select vppsone.backup_public_tables() as t")).rows.map((row) => row.t);
  results.push(`fee tables listed for the snapshot: ${JSON.stringify(listed)}`);
  const exported = (await db.query("select vppsone.backup_public_table_export('receipts') as e")).rows[0].e;
  results.push(`fee export: count=${exported.count}, money kept as text: ${exported.rows.includes("0.50")}`);
  await run("export of something that is not a fee table", "select vppsone.backup_public_table_export('pg_class')", true);
  const objects = (await db.query("select bucket, name from vppsone.backup_object_listing()")).rows;
  results.push(`objects the copy step sees: ${JSON.stringify(objects)} (generated receipts excluded)`);

  await db.exec(`update vppsone.file_storage_settings set shared_drive_id = '0ASyntheticSharedDrive00', root_folder_id = '1SyntheticRootFolder0000' where id = 1`);
  results.push("ok accepted: first setting of the destination (no Drive documents yet)");
  await db.exec(`insert into vppsone.staff_profiles values ('00000000-0000-4000-8000-0000000000a1');
    insert into vppsone.student_documents (session_label, student_id, storage_path, file_name, content_type, byte_size, uploaded_by, storage_provider, upload_state, drive_file_id, content_sha256)
    values ('SYN', gen_random_uuid(), 'gdrive/x', 'f.pdf', 'application/pdf', 100, '00000000-0000-4000-8000-0000000000a1', 'gdrive', 'stored', '1SyntheticDriveFile0001', '${"a".repeat(64)}')`);
  await run("moving the destination once documents live in Drive, unconfirmed",
    "update vppsone.file_storage_settings set root_folder_id = '1SomewhereElse000000000' where id = 1", true);
  await run("the same move, explicitly confirmed in its transaction",
    "begin; set local vppsone.confirm_storage_move = 'yes'; update vppsone.file_storage_settings set root_folder_id = '1SomewhereElse000000000' where id = 1; commit;");
  await run("a routine health-check update, unconfirmed",
    "update vppsone.file_storage_settings set last_check_ok = true, last_check_at = now() where id = 1");
  const history = (await db.query("select count(*)::int as n, bool_and(not (new_row ? 'recovery_public_key')) as no_key from vppsone.file_storage_settings_history")).rows[0];
  results.push(`settings history rows: ${history.n}, recovery key left out of every one: ${history.no_key}`);

  await run("a migrated row whose storage_path no longer names the bucket original",
    "update vppsone.student_documents set migrated_at = now() where storage_path = 'gdrive/x'", true);

  const grants = (await db.query(`select table_name, grantee from information_schema.role_table_grants
    where table_schema = 'vppsone' and table_name in ('drive_snapshots','drive_object_copies','file_storage_settings_history')
      and grantee in ('anon','authenticated')`)).rows;
  results.push(`client grants on the new tables: ${JSON.stringify(grants)}`);
} finally {
  console.log(results.join("\n"));
  await db.close();
}
