-- D-644 (16 Nov 2026): One's own copy of the Fees app's data.
--
-- Janmejay asked for One to stand on its own (16 Nov, 02:27 UTC) and for a
-- read-only login on the Fees DB to copy the data over (02:47 UTC, msg
-- cmsg_01Nvk8zSb4E4PDfNAFZK3xJJRjTjJLUBC1bkx4nkPLuoRw). The login is
-- vppsone_copy_reader on vgqyilgstjvgohrsiwkb: SELECT on public only, every
-- transaction read-only, no function it may call writes, expires 30 Jun 2027.
-- Its password was generated in this database and lives only in Vault
-- (FEES_COPY_READER_PASSWORD); Fees holds a SCRAM verifier of it.
--
-- This file is the link and a schema comparison. It writes nothing to Fees and
-- cannot: the remote session is read-only and has no write grant anywhere.

create extension if not exists dblink with schema extensions;

create or replace function vppsone.fees_copy_open()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pw text;
begin
  if 'fees_copy' = any(coalesce(extensions.dblink_get_connections(), '{}'::text[])) then
    return;
  end if;
  select s.decrypted_secret into pw from vault.decrypted_secrets s where s.name = 'FEES_COPY_READER_PASSWORD';
  if pw is null then
    raise exception 'fees_copy_unconfigured';
  end if;
  perform extensions.dblink_connect('fees_copy', format(
    'host=%s port=5432 dbname=postgres user=%s password=%s sslmode=require connect_timeout=15 application_name=vppsone_copy',
    'aws-1-ap-south-1.pooler.supabase.com', 'vppsone_copy_reader.vgqyilgstjvgohrsiwkb', pw));
  -- Same rendering of names on both sides: format_type and pg_get_viewdef
  -- qualify by search_path.
  perform extensions.dblink_exec('fees_copy', 'set search_path to ''''');
end
$$;

create or replace function vppsone.fees_copy_close()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if 'fees_copy' = any(coalesce(extensions.dblink_get_connections(), '{}'::text[])) then
    perform extensions.dblink_disconnect('fees_copy');
  end if;
end
$$;

-- The fee schema of both databases, object by object (scripts/migrate/
-- catalog-fingerprint.sql without the auth and storage parts the reader cannot
-- see). Returns only what differs: fees_v null = One only, one_v null = Fees only.
create or replace function vppsone.fees_catalog_diff()
returns table(kind text, key text, fees_v text, one_v text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  fp_sql constant text := $fp$
with
ns as (
  select oid, nspname from pg_namespace where nspname in ('public', 'private')
),
rel as (
  select c.oid, n.nspname, c.relname, c.relkind
  from pg_class c join ns n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    -- extension-owned relations are the extension's, not the schema's
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
),
k_rel as (
  select r.nspname || '.' || r.relname as k,
         left(md5(
           r.relkind::text || '|' ||
           case when r.relkind in ('v', 'm') then coalesce(pg_get_viewdef(r.oid, true), '') else '' end || '|' ||
           coalesce((
             select string_agg(
                      a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' ||
                      a.attnotnull::text || ':' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
                      ',' order by a.attnum)
             from pg_attribute a
             left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
             where a.attrelid = r.oid and a.attnum > 0 and a.atttypid <> 0 -- a removed column has type 0
           ), '')
         ), 12) as v
  from rel r
),
k_idx as (
  select n.nspname || '.' || ic.relname as k, left(md5(pg_get_indexdef(i.indexrelid)), 12) as v
  from pg_index i
  join pg_class ic on ic.oid = i.indexrelid
  join ns n on n.oid = ic.relnamespace
),
k_con as (
  select n.nspname || '.' || coalesce(t.relname, ty.typname, '?') || '.' || co.conname as k,
         left(md5(co.contype::text || pg_get_constraintdef(co.oid)), 12) as v
  from pg_constraint co
  join ns n on n.oid = co.connamespace
  left join pg_class t on t.oid = co.conrelid
  left join pg_type ty on ty.oid = co.contypid
),
fn as (
  select p.oid, n.nspname, p.proname, p.prokind, p.prosrc, p.prosecdef, p.proconfig, p.proowner, p.proacl,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k
  from pg_proc p join ns n on n.oid = p.pronamespace
  where not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
k_fn as (
  -- whitespace collapsed: live's function bodies were written from Windows (CRLF)
  -- and the replica's are LF, which is not a difference in what they do
  select k, left(md5(regexp_replace(coalesce(prosrc, ''), '\s+', ' ', 'g')), 12) || ':' || case when prosecdef then 'definer' else 'invoker' end
            || ':' || left(md5(coalesce(array_to_string(proconfig, ','), '') || pg_get_function_result(oid)), 6) as v
  from fn
),
k_trg as (
  select n.nspname || '.' || c.relname || '.' || t.tgname as k,
         left(md5(pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text), 12) as v
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join ns n on n.oid = c.relnamespace
  where not t.tgisinternal
),
k_pol as (
  select p.schemaname || '.' || p.tablename || '.' || p.policyname as k,
         left(md5(p.permissive || '|' || p.cmd || '|' || array_to_string(p.roles, ',') || '|' ||
                  coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')), 12) as v
  from pg_policies p
  where p.schemaname in ('public', 'private')
),
k_rls as (
  select r.nspname || '.' || r.relname as k,
         case when c.relrowsecurity then 'on' else 'off' end || case when c.relforcerowsecurity then '+force' else '' end as v
  from rel r join pg_class c on c.oid = r.oid
  where c.relrowsecurity or c.relforcerowsecurity
),
k_enum as (
  select n.nspname || '.' || t.typname as k,
         left(md5(string_agg(e.enumlabel, ',' order by e.enumsortorder)), 12) as v
  from pg_type t
  join ns n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
  group by n.nspname, t.typname
),
grantee_name as (
  select 0::oid as oid, 'PUBLIC'::text as name
  union all
  select oid, rolname::text from pg_roles
),
k_grant_rel as (
  select r.nspname || '.' || r.relname || '>' || g.name as k,
         string_agg(a.privilege_type, ',' order by a.privilege_type) as v
  from rel r
  join pg_class c on c.oid = r.oid
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  join grantee_name g on g.oid = a.grantee
  group by r.nspname, r.relname, g.name
),
k_grant_fn as (
  select f.k || '>' || g.name as k, 'EXECUTE' as v
  from fn f
  cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
  join grantee_name g on g.oid = a.grantee
  where a.privilege_type = 'EXECUTE'
),
k_grant_ns as (
  select n.nspname || '>' || g.name as k, string_agg(a.privilege_type, ',' order by a.privilege_type) as v
  from pg_namespace n
  cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
  join grantee_name g on g.oid = a.grantee
  where n.nspname in ('public', 'private')
  group by n.nspname, g.name
),
k_defacl as (
  select coalesce(n.nspname, '*') || '.' || d.defaclobjtype::text || '.' || pg_get_userbyid(d.defaclrole) || '>' || g.name as k,
         string_agg(a.privilege_type, ',' order by a.privilege_type) as v
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  join grantee_name g on g.oid = a.grantee
  where n.nspname in ('public', 'private') or d.defaclnamespace = 0
  group by n.nspname, d.defaclobjtype, d.defaclrole, g.name
),
k_storage_pol as (
  select p.tablename || '.' || p.policyname as k,
         left(md5(p.permissive || '|' || p.cmd || '|' || array_to_string(p.roles, ',') || '|' ||
                  coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')), 12) as v
  from pg_policies p
  where p.schemaname = 'storage' and p.tablename in ('objects', 'buckets')
),
k_pub as (
  select pubname || ':' || schemaname || '.' || tablename as k, 'member' as v
  from pg_publication_tables
),
k_ext as (
  select extname::text as k, extversion::text as v from pg_extension
)
select jsonb_build_object(
  'rel',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_rel),
  'idx',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_idx),
  'con',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_con),
  'fn',          (select coalesce(jsonb_object_agg(k, v), '{}') from k_fn),
  'trg',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_trg),
  'pol',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_pol),
  'rls',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_rls),
  'enum',        (select coalesce(jsonb_object_agg(k, v), '{}') from k_enum),
  'grant_rel',   (select coalesce(jsonb_object_agg(k, v), '{}') from k_grant_rel),
  'grant_fn',    (select coalesce(jsonb_object_agg(k, v), '{}') from k_grant_fn),
  'grant_ns',    (select coalesce(jsonb_object_agg(k, v), '{}') from k_grant_ns),
  'defacl',      (select coalesce(jsonb_object_agg(k, v), '{}') from k_defacl),
  'storage_pol', (select coalesce(jsonb_object_agg(k, v), '{}') from k_storage_pol),
  'pub',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_pub),
  'ext',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_ext)
) as fingerprint
$fp$;
  f jsonb;
  o jsonb;
begin
  perform vppsone.fees_copy_open();
  select x.j into f from extensions.dblink('fees_copy', fp_sql) as x(j jsonb);
  perform vppsone.fees_copy_close();
  execute fp_sql into o;
  return query
    with keys as (
      select kk.key as kind, e.key from jsonb_each(f) kk, jsonb_each(kk.value) e
      union
      select kk.key, e.key from jsonb_each(o) kk, jsonb_each(kk.value) e
    )
    select k.kind, k.key, f -> k.kind ->> k.key, o -> k.kind ->> k.key
    from keys k
    where (f -> k.kind ->> k.key) is distinct from (o -> k.kind ->> k.key);
end
$$;

revoke all on function vppsone.fees_copy_open() from public, anon, authenticated;
revoke all on function vppsone.fees_copy_close() from public, anon, authenticated;
revoke all on function vppsone.fees_catalog_diff() from public, anon, authenticated;
