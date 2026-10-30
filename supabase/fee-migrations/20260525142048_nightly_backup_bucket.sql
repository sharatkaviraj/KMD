-- ============================================================================
-- VPPS One fee-migration: copy of the fees app's supabase/migrations/20260525142048_nightly_backup_bucket.sql
-- (fees main 8a0cd47c), applied to One's main database wtgxcptmucjerhufzjcf
-- through the Supabase MCP (D-338; see supabase/fee-migrations/README.md).
-- Difference from the fees app: none. The body below is byte-for-byte the fees
--   original; only this header is added. Found missing on wtgx by the 30 Oct
--   schema parity check (docs/cutover/SCHEMA-PARITY.md): the bucket was there but
--   its storage.objects policy was not, because the masked replica copied tables
--   and functions and never storage policies (critique1 B1). Both statements are
--   idempotent, so re-running the bucket upsert is harmless.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nightly-backups',
  'nightly-backups',
  false,
  104857600, -- 100 MB ceiling per file
  array['text/csv', 'application/zip', 'application/json']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'nightly_backups: admin read'
  ) then
    create policy "nightly_backups: admin read"
      on storage.objects for select
      using (
        bucket_id = 'nightly-backups' and public.has_permission('settings:write')
      );
  end if;
end
$$;
