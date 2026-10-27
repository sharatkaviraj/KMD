-- Student documents in a school Google Shared Drive (D-333).
--
-- The bytes may move; the index does not. Every document is still one row in
-- vppsone.student_documents, read through the same scoped policy, and opened
-- only through /documents/<id> after a permission check. What this adds:
--
--  * where the bytes are (`storage_provider`), and for Drive the file id, the
--    sha256 Drive itself reported, a content version, the upload's state and
--    the browser's idempotency key, so a double-tapped Save is one document;
--  * `removed_at` / `removed_by`: removing a Drive document hides the row and
--    keeps the file. Nothing in Drive is deleted or overwritten by the app;
--  * document_upload_sessions: the Drive resumable-upload address for a file
--    in flight. That address is a capability to write one file, so the table
--    is server-only — RLS on, no policies, nothing granted to anon or
--    authenticated;
--  * drive_folders: one Drive folder per academic session, created once. The
--    primary key is what stops two first uploads creating two folders;
--  * file_storage_settings: one row, server-only. Where new documents go
--    (`supabase` until somebody changes it), an optional pilot list of staff
--    whose uploads go to Drive first, and the non-secret identifiers of the
--    Google project, Workload Identity pool, service account and Shared Drive.
--    No key, token or password is stored here or anywhere: the app proves who
--    it is with its Vercel OIDC token (Workload Identity Federation).
--
-- Existing rows keep their meaning: every one is `supabase`, `stored`.
--
-- Rollback (only while no row is 'gdrive'):
--   restore vppsone.archive_object_listing() from 20261004124254 (two buckets);
--   alter table vppsone.student_documents
--     drop constraint student_documents_backup_complete,
--     drop column backed_up_at, drop column backup_key_fingerprint,
--     drop column backup_sha256, drop column backup_path;
--   (the empty bucket vppsone-drive-backups may stay)
--   drop table vppsone.file_storage_settings;
--   drop table vppsone.drive_folders;
--   drop table vppsone.document_upload_sessions;
--   alter table vppsone.student_documents
--     drop constraint student_documents_drive_complete,
--     drop column removed_by, drop column removed_at,
--     drop column client_request_id, drop column upload_state,
--     drop column content_version, drop column content_sha256,
--     drop column drive_file_id, drop column storage_provider;

alter table vppsone.student_documents
  add column storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'gdrive')),
  add column drive_file_id text
    check (drive_file_id is null or drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  add column content_sha256 text
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  add column content_version integer not null default 1
    check (content_version >= 1),
  add column upload_state text not null default 'stored'
    check (upload_state in ('uploading', 'stored', 'failed')),
  add column client_request_id uuid,
  add column removed_at timestamptz,
  add column removed_by uuid references vppsone.staff_profiles (id),
  add constraint student_documents_drive_complete check (
    storage_provider <> 'gdrive'
    or upload_state <> 'stored'
    or (drive_file_id is not null and content_sha256 is not null)
  );

comment on column vppsone.student_documents.storage_provider is
  'Where the bytes are: supabase (bucket vppsone-documents, storage_path) or gdrive (drive_file_id in the school Shared Drive).';
comment on column vppsone.student_documents.content_sha256 is
  'sha256 of the stored bytes. For gdrive, the value Drive reported after upload, compared with the one the browser declared.';
comment on column vppsone.student_documents.removed_at is
  'Hidden from staff. For gdrive the file is kept in the Shared Drive; nothing is deleted by the app.';

create unique index student_documents_drive_file_unique
  on vppsone.student_documents (drive_file_id)
  where drive_file_id is not null;

create unique index student_documents_client_request_unique
  on vppsone.student_documents (client_request_id)
  where client_request_id is not null;

create table vppsone.document_upload_sessions (
  document_id uuid primary key
    references vppsone.student_documents (id) on delete cascade,
  drive_session_url text not null
    check (drive_session_url like 'https://www.googleapis.com/upload/drive/v3/%'),
  declared_bytes bigint not null check (declared_bytes between 1 and 10485760),
  declared_sha256 text not null check (declared_sha256 ~ '^[0-9a-f]{64}$'),
  received_bytes bigint not null default 0 check (received_bytes >= 0),
  created_by uuid not null references vppsone.staff_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint document_upload_sessions_progress check (received_bytes <= declared_bytes)
);

comment on table vppsone.document_upload_sessions is
  'A Drive document upload in flight (D-333). The session URL can write one file, so this table is server-only.';

create table vppsone.drive_folders (
  session_label text primary key check (char_length(session_label) between 1 and 40),
  folder_id text not null unique check (folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  created_at timestamptz not null default now()
);

comment on table vppsone.drive_folders is
  'The Shared Drive folder that holds one academic session''s documents (D-333).';

create table vppsone.file_storage_settings (
  id smallint primary key default 1 check (id = 1),
  documents_provider text not null default 'supabase'
    check (documents_provider in ('supabase', 'gdrive')),
  drive_pilot_staff_ids uuid[] not null default '{}',
  shared_drive_id text check (shared_drive_id is null or shared_drive_id ~ '^[A-Za-z0-9_-]{10,100}$'),
  root_folder_id text check (root_folder_id is null or root_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  google_project_number text check (google_project_number is null or google_project_number ~ '^[0-9]{6,20}$'),
  workload_pool_id text check (workload_pool_id is null or workload_pool_id ~ '^[a-z0-9-]{4,32}$'),
  workload_provider_id text check (workload_provider_id is null or workload_provider_id ~ '^[a-z0-9-]{4,32}$'),
  service_account_email text check (
    service_account_email is null
    or service_account_email ~ '^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$'
  ),
  recovery_public_key text check (
    recovery_public_key is null or recovery_public_key like '-----BEGIN PUBLIC KEY-----%'
  ),
  recovery_key_fingerprint text check (
    recovery_key_fingerprint is null or recovery_key_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  last_check_at timestamptz,
  last_check_ok boolean,
  last_check_detail text check (last_check_detail is null or char_length(last_check_detail) <= 300),
  updated_by uuid references vppsone.staff_profiles (id),
  updated_at timestamptz not null default now(),
  constraint file_storage_settings_drive_needs_config check (
    documents_provider <> 'gdrive'
    or (
      shared_drive_id is not null and root_folder_id is not null
      and google_project_number is not null and workload_pool_id is not null
      and workload_provider_id is not null and service_account_email is not null
    )
  ),
  constraint file_storage_settings_recovery_pair check (
    (recovery_public_key is null) = (recovery_key_fingerprint is null)
  )
);

comment on table vppsone.file_storage_settings is
  'Where new student documents are stored (D-333). One row, server-only. Identifiers only: no key, token or secret.';

insert into vppsone.file_storage_settings (id) values (1) on conflict do nothing;

-- The independent copy (D-333). A Drive document is copied, sealed for the
-- school's recovery key, into a private bucket on this project — a different
-- provider from Google, so losing either one leaves the other. The app holds
-- only the public half of the key and cannot read these copies back.
alter table vppsone.student_documents
  add column backup_path text,
  add column backup_sha256 text check (backup_sha256 is null or backup_sha256 ~ '^[0-9a-f]{64}$'),
  add column backup_key_fingerprint text
    check (backup_key_fingerprint is null or backup_key_fingerprint ~ '^[0-9a-f]{64}$'),
  add column backed_up_at timestamptz,
  add constraint student_documents_backup_complete check (
    (backed_up_at is null) = (backup_path is null)
    and (backup_path is null) = (backup_sha256 is null)
    and (backup_path is null) = (backup_key_fingerprint is null)
  );

create index student_documents_backup_pending
  on vppsone.student_documents (created_at)
  where storage_provider = 'gdrive' and upload_state = 'stored' and backed_up_at is null;

insert into storage.buckets (id, name, public, file_size_limit)
values ('vppsone-drive-backups', 'vppsone-drive-backups', false, 16777216)
on conflict (id) do nothing;

-- Year-end archives carry the sealed copies too, byte for byte.
create or replace function vppsone.archive_object_listing()
returns table (bucket text, name text, size bigint, mimetype text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text, coalesce((o.metadata->>'size')::bigint, 0), o.metadata->>'mimetype'
  from storage.objects o
  where o.bucket_id in ('vppsone-documents', 'vppsone-photos', 'vppsone-drive-backups')
  order by o.bucket_id, o.name;
$$;

alter table vppsone.document_upload_sessions enable row level security;
alter table vppsone.drive_folders enable row level security;
alter table vppsone.file_storage_settings enable row level security;

revoke all on vppsone.document_upload_sessions from anon, authenticated;
revoke all on vppsone.drive_folders from anon, authenticated;
revoke all on vppsone.file_storage_settings from anon, authenticated;

grant all on vppsone.document_upload_sessions to service_role;
grant all on vppsone.drive_folders to service_role;
grant all on vppsone.file_storage_settings to service_role;
