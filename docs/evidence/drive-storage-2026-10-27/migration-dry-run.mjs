// Dry run of 20261027114837_document_storage_providers.sql on PGlite, against
// synthetic prerequisites shaped like the dev project. Nothing remote.
//
// PGlite is not a dependency of the app. Run from a folder where it is
// installed (`npm install @electric-sql/pglite@0.3.15`), passing this repo:
//   node migration-dry-run.mjs "<path to the vppsone checkout>"
// Output of the 27 Oct run: migration-dry-run.txt beside this file.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const repo = process.argv[2] ?? fileURLToPath(new URL("../../../", import.meta.url));
const db = new PGlite();
const results = [];
const expectFail = async (label, sql) => {
  try {
    await db.exec(sql);
    results.push(`FAIL (was accepted): ${label}`);
  } catch (error) {
    results.push(`ok refused: ${label} — ${String(error.message).split("\n")[0]}`);
  }
};
const expectOk = async (label, sql) => {
  try {
    await db.exec(sql);
    results.push(`ok accepted: ${label}`);
  } catch (error) {
    results.push(`FAIL (refused): ${label} — ${error.message}`);
  }
};

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema vppsone; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (bucket_id text, name text, metadata jsonb);
    create table vppsone.staff_profiles (id uuid primary key);
    create function vppsone.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table vppsone.student_documents (
      id uuid primary key default gen_random_uuid(), session_label text not null, student_id uuid not null,
      kind text not null default 'other', storage_path text not null, file_name text not null, content_type text not null,
      byte_size integer not null, note text,
      uploaded_by uuid references vppsone.staff_profiles (id) on delete restrict,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      constraint student_documents_size_sane check (byte_size between 1 and 20000000));
    create unique index student_documents_path_unique on vppsone.student_documents (storage_path);
    insert into vppsone.staff_profiles values ('00000000-0000-4000-8000-0000000000a1');
    insert into vppsone.student_documents (session_label, student_id, kind, storage_path, file_name, content_type, byte_size, uploaded_by)
      values ('TEST-2026-27', gen_random_uuid(), 'birth_certificate', 'TEST/x/a.pdf', 'a.pdf', 'application/pdf', 193, '00000000-0000-4000-8000-0000000000a1');
  `);

  const migration = await readFile(`${repo}/supabase/migrations/20261027114837_document_storage_providers.sql`, "utf8");
  await db.exec(migration);
  results.push("ok applied: migration");

  const existing = (await db.query("select storage_provider, upload_state, content_version from vppsone.student_documents")).rows[0];
  results.push(`existing row reads as ${JSON.stringify(existing)}`);

  // Safe to apply before the code ships: the build already deployed embeds
  // staff_profiles(display_name) without naming a key, which PostgREST can do
  // only while student_documents has exactly one key to staff_profiles.
  const keys = (await db.query(`select count(*)::int as n from pg_constraint
     where conrelid = 'vppsone.student_documents'::regclass and contype = 'f'
       and confrelid = 'vppsone.staff_profiles'::regclass`)).rows[0];
  results.push(keys.n === 1 ? "ok: one key to staff_profiles (existing embeds stay unambiguous)" : `FAIL: ${keys.n} keys to staff_profiles`);

  const staff = "00000000-0000-4000-8000-0000000000a1";
  const insert = (id, extra = "", values = "") => `insert into vppsone.student_documents
      (id, session_label, student_id, kind, storage_path, file_name, content_type, byte_size, uploaded_by, storage_provider, upload_state${extra})
      values ('${id}', 'SYN', gen_random_uuid(), 'other', 'gdrive/${id}', 'f.pdf', 'application/pdf', 100, '${staff}', 'gdrive', 'uploading'${values})`;

  await expectOk("a gdrive row while uploading", insert("10000000-0000-4000-8000-000000000001", ", client_request_id", ", '10000000-0000-4000-8000-000000000001'"));
  await expectFail("the same client_request_id twice", insert("10000000-0000-4000-8000-000000000002", ", client_request_id", ", '10000000-0000-4000-8000-000000000001'"));
  await expectFail("a stored gdrive row without its file id and checksum",
    "update vppsone.student_documents set upload_state = 'stored' where id = '10000000-0000-4000-8000-000000000001'");
  await expectOk("a stored gdrive row with file id and checksum",
    `update vppsone.student_documents set upload_state = 'stored', drive_file_id = '1SyntheticDriveFile0001', content_sha256 = '${"a".repeat(64)}' where id = '10000000-0000-4000-8000-000000000001'`);
  await expectFail("an unknown provider", "update vppsone.student_documents set storage_provider = 's3'");
  await expectFail("a Drive id with a slash", "update vppsone.student_documents set drive_file_id = '../../etc/passwd' where storage_provider = 'gdrive'");
  await expectFail("a partial backup record",
    "update vppsone.student_documents set backup_path = 'x/v1.sealed' where storage_provider = 'gdrive'");
  await expectOk("a complete backup record",
    `update vppsone.student_documents set backup_path = 'x/v1.sealed', backup_sha256 = '${"b".repeat(64)}', backup_key_fingerprint = '${"c".repeat(64)}', backed_up_at = now() where storage_provider = 'gdrive'`);

  await expectFail("switching to Drive with nothing configured", "update vppsone.file_storage_settings set documents_provider = 'gdrive'");
  await expectFail("a session URL that is not Drive's",
    `insert into vppsone.document_upload_sessions (document_id, drive_session_url, declared_bytes, declared_sha256, created_by, expires_at)
     values ('10000000-0000-4000-8000-000000000001', 'https://evil.test/upload', 100, '${"a".repeat(64)}', '${staff}', now())`);
  await expectFail("a service account outside gserviceaccount.com",
    "update vppsone.file_storage_settings set service_account_email = 'someone@vpps.co.in'");
  await expectFail("a public key without its fingerprint",
    "update vppsone.file_storage_settings set recovery_public_key = '-----BEGIN PUBLIC KEY-----x'");
  await expectOk("the full configuration, then Drive on",
    `update vppsone.file_storage_settings set shared_drive_id = '0ASyntheticSharedDrive00', root_folder_id = '1SyntheticRootFolder0000',
       google_project_number = '123456789012', workload_pool_id = 'vercel', workload_provider_id = 'vppsone-production',
       service_account_email = 'vppsone-drive@vpps-one-files.iam.gserviceaccount.com', documents_provider = 'gdrive'`);

  const grants = (await db.query(`select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
     from information_schema.role_table_grants where table_schema = 'vppsone'
       and table_name in ('document_upload_sessions', 'drive_folders', 'file_storage_settings')
     group by 1, 2 order by 1, 2`)).rows;
  results.push(`grants: ${JSON.stringify(grants)}`);
  const rls = (await db.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'vppsone' and relname in ('document_upload_sessions', 'drive_folders', 'file_storage_settings') order by 1`)).rows;
  results.push(`rls: ${JSON.stringify(rls)}`);
  const buckets = (await db.query("select id, public, file_size_limit from storage.buckets")).rows;
  results.push(`buckets: ${JSON.stringify(buckets)}`);
} finally {
  console.log(results.join("\n"));
  await db.close();
}
