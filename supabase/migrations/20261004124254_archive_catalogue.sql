-- P11: an archive the school can find, open and prove it can restore.
--
-- Plan §16 "Archiving is accessible preservation": archives inside the app,
-- access checked before serving bytes; a manifest of counts, schema version
-- and checksums; and "test a synthetic restoration of both records and
-- documents before treating a backup as usable" — because a Supabase database
-- backup does not include Storage objects.
--
-- An archive here is a copy of every `vppsone` table (as canonical JSON, one
-- file per table) and of every object in the documents and photographs
-- buckets, written to the private `vppsone-archives` bucket with a manifest.
-- Nothing is deleted to make room: an archive is a copy. The fee app's tables
-- (`public`) are the fee app's to keep and are not in it.
--
-- A restore drill reloads each archived table into a scratch table of the
-- same shape inside one transaction and compares the reloaded rows' digest
-- with the digest the archive recorded; it re-hashes every archived object
-- and round-trips one through a scratch prefix. The drill writes nothing that
-- outlives it.

insert into storage.buckets (id, name, public, file_size_limit)
values ('vppsone-archives', 'vppsone-archives', false, 52428800)
on conflict (id) do nothing;

create table vppsone.archives (
  id uuid primary key default gen_random_uuid(),
  -- What the school calls it: "2026-27 year end", "before cutover".
  label text not null,
  session_label text not null,
  status text not null default 'building',
  manifest jsonb,
  table_count integer,
  row_count integer,
  object_count integer,
  total_bytes bigint,
  error text,
  created_by uuid not null references vppsone.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint archives_status check (status in ('building', 'ready', 'failed')),
  constraint archives_label_says check (btrim(label) <> '')
);

comment on table vppsone.archives is
  'The archive catalogue: one row per archive, its manifest of tables, rows, objects and checksums. The bytes are in the private vppsone-archives bucket.';

create table vppsone.restore_drills (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references vppsone.archives (id) on delete restrict,
  ok boolean not null,
  report jsonb not null,
  ran_by uuid references vppsone.staff_profiles (id) on delete restrict,
  ran_at timestamptz not null default now()
);

comment on table vppsone.restore_drills is
  'Every restore drill run against an archive and what it found. Kept: an archive is only as good as its last drill.';

alter table vppsone.archives enable row level security;
alter table vppsone.restore_drills enable row level security;
create policy archives_select_admin on vppsone.archives for select to authenticated
  using ((select vppsone.staff_can('jobs:run')));
create policy restore_drills_select_admin on vppsone.restore_drills for select to authenticated
  using ((select vppsone.staff_can('jobs:run')));
grant select on vppsone.archives, vppsone.restore_drills to authenticated;
grant all on vppsone.archives, vppsone.restore_drills to service_role;

-- ---------------------------------------------------------------------------
-- Reading a table canonically
-- ---------------------------------------------------------------------------

-- Every base table in the schema except the ones that are working state, not
-- record: rate-limit counters.
create or replace function vppsone.archive_tables()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select t.table_name::text
  from information_schema.tables t
  where t.table_schema = 'vppsone' and t.table_type = 'BASE TABLE'
    and t.table_name not in ('rate_limits')
  order by 1;
$$;

-- One table's rows as a JSON array — each row as `to_jsonb`, ordered by its
-- own text so the same rows always make the same bytes — with their count and
-- digest, all from one statement and so one snapshot: a write landing between
-- the export and the digest cannot make a sound archive look broken.
create or replace function vppsone.archive_table_export(p_table text)
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
  if p_table not in (select vppsone.archive_tables()) then
    raise exception 'not an archived table: %', p_table;
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb), count(*), '
    || 'md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from vppsone.%I t',
    p_table
  ) into v_rows, v_count, v_md5;
  return jsonb_build_object('rows', v_rows, 'count', v_count, 'md5', v_md5);
end;
$$;

-- The same table's count and digest, computed the way the drill computes it.
create or replace function vppsone.archive_table_digest(p_table text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_md5 text;
begin
  if p_table not in (select vppsone.archive_tables()) then
    raise exception 'not an archived table: %', p_table;
  end if;
  execute format(
    'select count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from vppsone.%I t',
    p_table
  ) into v_count, v_md5;
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

-- ---------------------------------------------------------------------------
-- The drill: reload archived rows into a scratch table and digest them
-- ---------------------------------------------------------------------------

create or replace function vppsone.restore_drill_table(p_table text, p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count bigint;
  v_md5 text;
begin
  if p_table not in (select vppsone.archive_tables()) then
    raise exception 'not an archived table: %', p_table;
  end if;
  -- Same columns and types as the table, none of its constraints, triggers or
  -- defaults; gone at the end of this transaction.
  execute 'drop table if exists pg_temp.restore_drill';
  execute format('create temp table restore_drill (like vppsone.%I) on commit drop', p_table);
  execute format(
    'insert into pg_temp.restore_drill select * from jsonb_populate_recordset(null::vppsone.%I, $1)',
    p_table
  ) using p_rows;
  execute
    'select count(*), md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by to_jsonb(t)::text), '''')) from pg_temp.restore_drill t'
    into v_count, v_md5;
  execute 'drop table pg_temp.restore_drill';
  return jsonb_build_object('rows', v_count, 'md5', v_md5);
end;
$$;

-- The objects an archive copies: every document and photograph.
create or replace function vppsone.archive_object_listing()
returns table (bucket text, name text, size bigint, mimetype text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text, coalesce((o.metadata->>'size')::bigint, 0), o.metadata->>'mimetype'
  from storage.objects o
  where o.bucket_id in ('vppsone-documents', 'vppsone-photos')
  order by o.bucket_id, o.name;
$$;

-- The schema's version: the latest migration applied.
create or replace function vppsone.archive_schema_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select max(version)::text from supabase_migrations.schema_migrations;
$$;

revoke all on function vppsone.archive_tables() from public, anon, authenticated;
revoke all on function vppsone.archive_table_export(text) from public, anon, authenticated;
revoke all on function vppsone.archive_table_digest(text) from public, anon, authenticated;
revoke all on function vppsone.restore_drill_table(text, jsonb) from public, anon, authenticated;
revoke all on function vppsone.archive_object_listing() from public, anon, authenticated;
revoke all on function vppsone.archive_schema_version() from public, anon, authenticated;
grant execute on function vppsone.archive_tables() to service_role;
grant execute on function vppsone.archive_table_export(text) to service_role;
grant execute on function vppsone.archive_table_digest(text) to service_role;
grant execute on function vppsone.restore_drill_table(text, jsonb) to service_role;
grant execute on function vppsone.archive_object_listing() to service_role;
grant execute on function vppsone.archive_schema_version() to service_role;
