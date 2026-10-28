-- One central store, and nightly backups into it (D-334).
--
-- The owner (27-28 Oct) chose one administrator-controlled destination: the
-- folder "VPPS One documents" in the school's Shared Drive "Share", where
-- raj@vpps.co.in is the only manager. Every role's uploads go there through
-- the backend's service account; nobody connects their own Google account.
-- The operational database stays the system of record; Drive holds the
-- document bytes and, from this migration on, a nightly encrypted copy of
-- everything else:
--
--  * drive_snapshots: one row per nightly snapshot — every `vppsone` table and
--    every fee (`public`) table as canonical JSON, with counts and Postgres
--    digests, gzipped and sealed for the school's recovery key, plus a
--    plaintext manifest beside it (names, counts, checksums; no rows);
--  * drive_object_copies: a sealed copy in Drive of every object in the
--    buckets that hold people's files (documents, photographs, voice notes,
--    the fee app's photographs), so the bytes are recoverable from Drive too;
--  * backup_public_tables() / backup_public_table_export(): read the fee
--    tables for the snapshot. Read only: nothing here alters, adds to or
--    grants on a fee table;
--  * backup_object_listing(): the objects the copy step looks at;
--  * student_documents.migrated_at: a bucket document copied into Drive. Its
--    `storage_path` still names the bucket original, which is kept;
--  * file_storage_settings.bucket_migration_approved_at: the copy-only
--    migration of bucket documents runs only while this is set;
--  * file_storage_settings_history and a guard: every change to the settings
--    row is recorded, and changing the destination (drive, folder, project,
--    pool, provider or service account) once documents live in Drive is
--    refused unless the same transaction says
--    `set local vppsone.confirm_storage_move = 'yes'`.
--
-- No retention is decided here: the owner chose to keep every backup for
-- now, and the service account cannot delete anything in Drive anyway.
--
-- Rollback (nothing depends on these but the backup job):
--   drop trigger file_storage_settings_guard on vppsone.file_storage_settings;
--   drop trigger file_storage_settings_no_truncate on vppsone.file_storage_settings;
--   drop function vppsone.file_storage_settings_guard();
--   drop function vppsone.backup_schema_export(text);
--   drop table vppsone.file_storage_settings_history;
--   drop function vppsone.backup_object_listing();
--   drop function vppsone.backup_public_table_export(text);
--   drop function vppsone.backup_public_tables();
--   drop table vppsone.drive_object_copies; drop table vppsone.drive_snapshots;
--   alter table vppsone.file_storage_settings drop column bucket_migration_approved_at;
--   alter table vppsone.student_documents drop constraint student_documents_migrated_kept,
--     drop column migration_note, drop column migration_failed_at;
--   (student_documents.migrated_at: first put migrated rows back with
--    update vppsone.student_documents set storage_provider = 'supabase',
--      drive_file_id = null, migrated_at = null where migrated_at is not null;)

alter table vppsone.student_documents
  add column migrated_at timestamptz,
  -- A move that did not match or failed is parked, with why, and not tried
  -- again until somebody clears it: a stuck row must not be re-read and
  -- re-uploaded every night.
  add column migration_failed_at timestamptz,
  add column migration_note text check (migration_note is null or char_length(migration_note) <= 300),
  add constraint student_documents_migrated_kept check (
    migrated_at is null or (storage_provider = 'gdrive' and storage_path not like 'gdrive/%')
  );

comment on column vppsone.student_documents.migrated_at is
  'Copied from the bucket into Drive (D-334). storage_path still names the bucket original, which is kept for rollback.';

alter table vppsone.file_storage_settings
  add column bucket_migration_approved_at timestamptz;

comment on column vppsone.file_storage_settings.bucket_migration_approved_at is
  'When set, the nightly job copies bucket documents into Drive, copy-only (D-334).';

create table vppsone.drive_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bundle_drive_file_id text not null unique check (bundle_drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  manifest_drive_file_id text not null unique check (manifest_drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  sealed_sha256 text not null check (sealed_sha256 ~ '^[0-9a-f]{64}$'),
  plain_sha256 text not null check (plain_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_bytes bigint not null check (sealed_bytes > 0),
  schema_version text,
  app_commit text,
  table_count integer not null check (table_count >= 0),
  row_count bigint not null check (row_count >= 0),
  object_count integer not null check (object_count >= 0)
);

comment on table vppsone.drive_snapshots is
  'Nightly encrypted snapshots of every vppsone and fee table in the school Drive (D-334). The bytes are in Drive; this is the catalogue.';

create table vppsone.drive_object_copies (
  bucket text not null check (bucket in ('vppsone-documents', 'vppsone-photos', 'defaulter-voice-notes', 'student-photos')),
  object_name text not null check (char_length(object_name) between 1 and 1024),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes >= 0),
  drive_file_id text not null unique check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  sealed_sha256 text not null check (sealed_sha256 ~ '^[0-9a-f]{64}$'),
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  copied_at timestamptz not null default now(),
  -- Per key: a new recovery key re-seals every file, and the old copies stay.
  primary key (bucket, object_name, sha256, key_fingerprint)
);

comment on table vppsone.drive_object_copies is
  'A sealed copy in the school Drive of one version of one stored object (D-334).';

create table vppsone.file_storage_settings_history (
  id bigserial primary key,
  changed_at timestamptz not null default now(),
  changed_by text not null default current_user,
  old_row jsonb not null,
  new_row jsonb not null
);

comment on table vppsone.file_storage_settings_history is
  'Every change to file_storage_settings, before and after (D-334). The recovery public key is left out; its fingerprint is kept.';

create or replace function vppsone.backup_public_tables()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select t.table_name::text
  from information_schema.tables t
  where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by 1;
$$;

-- The same shape as archive_table_export, for a fee table: rows as canonical
-- JSON text, their count and their digest, all from one statement.
create or replace function vppsone.backup_public_table_export(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count bigint;
  v_md5 text;
begin
  if p_table not in (select vppsone.backup_public_tables()) then
    raise exception 'not a fee table: %', p_table;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb), count(*), '
    || 'md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from public.%I t',
    p_table
  ) into v_rows, v_count, v_md5;
  return jsonb_build_object('rows', v_rows::text, 'count', v_count, 'md5', v_md5);
end;
$$;

-- Every table of one schema in ONE statement, so all of them come from the
-- same moment: a STABLE function's queries share the calling query's
-- snapshot. Ordinary tables only (relkind 'r'), so a partitioned table is
-- exported once, through its partitions. The per-table export above stays as
-- the fallback if this one call is ever too big or too slow.
create or replace function vppsone.backup_schema_export(p_schema text)
returns table (table_name text, row_count bigint, md5 text, rows text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_table text;
begin
  if p_schema not in ('vppsone', 'public') then
    raise exception 'not a backed-up schema: %', p_schema;
  end if;
  for v_table in
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema and c.relkind = 'r'
      and not (p_schema = 'vppsone' and c.relname = 'rate_limits')
    order by 1
  loop
    return query execute format(
      'select %L::text, count(*), '
      || 'md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')), '
      || 'coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb)::text '
      || 'from %I.%I t',
      v_table, p_schema, v_table
    );
  end loop;
end;
$$;

create or replace function vppsone.backup_object_listing()
returns table (bucket text, name text, size bigint, mimetype text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text, coalesce((o.metadata->>'size')::bigint, 0), o.metadata->>'mimetype',
         coalesce(o.updated_at, o.created_at)
  from storage.objects o
  where o.bucket_id in ('vppsone-documents', 'vppsone-photos', 'defaulter-voice-notes', 'student-photos')
  order by o.bucket_id, o.name;
$$;

-- Not SECURITY DEFINER: it must record who ran the change, and every writer
-- of this table already holds the grants it uses.
create or replace function vppsone.file_storage_settings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'The document storage settings row is never deleted (D-334); change its values instead.';
  end if;

  if (
    (old.shared_drive_id is not null and new.shared_drive_id is distinct from old.shared_drive_id)
    or (old.root_folder_id is not null and new.root_folder_id is distinct from old.root_folder_id)
    or (old.google_project_number is not null and new.google_project_number is distinct from old.google_project_number)
    or (old.workload_pool_id is not null and new.workload_pool_id is distinct from old.workload_pool_id)
    or (old.workload_provider_id is not null and new.workload_provider_id is distinct from old.workload_provider_id)
    or (old.service_account_email is not null and new.service_account_email is distinct from old.service_account_email)
  )
  and exists (select 1 from vppsone.student_documents where storage_provider = 'gdrive')
  and coalesce(current_setting('vppsone.confirm_storage_move', true), '') <> 'yes'
  then
    raise exception 'Changing the document storage destination needs explicit confirmation (D-334): copy every Drive document first, then, in one transaction, set local vppsone.confirm_storage_move = ''yes'', change the row and delete from vppsone.drive_folders (its folders belong to the old destination).';
  end if;

  new.updated_at := now();
  insert into vppsone.file_storage_settings_history (changed_by, old_row, new_row)
  values (
    -- Bracketed: `||` and `->>` share a precedence, and unbracketed this
    -- read ' as ' as JSON and refused every update (found by the dry run).
    session_user || coalesce(' as ' || ((nullif(current_setting('request.jwt.claims', true), ''))::jsonb ->> 'role'), ''),
    to_jsonb(old) - 'recovery_public_key',
    to_jsonb(new) - 'recovery_public_key'
  );
  return new;
end;
$$;

create trigger file_storage_settings_guard
  before update or delete on vppsone.file_storage_settings
  for each row execute function vppsone.file_storage_settings_guard();

create trigger file_storage_settings_no_truncate
  before truncate on vppsone.file_storage_settings
  for each statement execute function vppsone.file_storage_settings_guard();

alter table vppsone.drive_snapshots enable row level security;
alter table vppsone.drive_object_copies enable row level security;
alter table vppsone.file_storage_settings_history enable row level security;

revoke all on vppsone.drive_snapshots from anon, authenticated;
revoke all on vppsone.drive_object_copies from anon, authenticated;
revoke all on vppsone.file_storage_settings_history from anon, authenticated;
revoke all on sequence vppsone.file_storage_settings_history_id_seq from anon, authenticated;

grant all on vppsone.drive_snapshots to service_role;
grant all on vppsone.drive_object_copies to service_role;
grant all on vppsone.file_storage_settings_history to service_role;
grant usage on sequence vppsone.file_storage_settings_history_id_seq to service_role;

revoke all on function vppsone.backup_public_tables() from public, anon, authenticated;
revoke all on function vppsone.backup_public_table_export(text) from public, anon, authenticated;
revoke all on function vppsone.backup_object_listing() from public, anon, authenticated;
revoke all on function vppsone.backup_schema_export(text) from public, anon, authenticated;
grant execute on function vppsone.backup_schema_export(text) to service_role;
revoke all on function vppsone.file_storage_settings_guard() from public, anon, authenticated;
grant execute on function vppsone.backup_public_tables() to service_role;
grant execute on function vppsone.backup_public_table_export(text) to service_role;
grant execute on function vppsone.backup_object_listing() to service_role;
