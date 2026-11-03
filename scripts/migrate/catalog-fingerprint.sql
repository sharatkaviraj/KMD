-- Catalog fingerprint of the fee schema, for the schema parity check (plan §1.3/§1.5,
-- critique1 B1). ONE read-only SELECT; it writes nothing and reads no row data.
--
-- Run it on both databases and diff the results:
--   * vgqyilgstjvgohrsiwkb (fees live) — read-only, through the Supabase MCP
--     `execute_sql`; this file is a plain SELECT of catalog tables only.
--   * wtgxcptmucjerhufzjcf (One's main DB) — the same, or `scripts/migrate/catalog-diff.mjs`.
--
-- Output: one row, one column `fingerprint`, a jsonb object
--   { "<kind>": { "<object key>": "<12-char md5 of its definition>" , ... }, ... }
-- Kinds:
--   rel        tables, views, matviews (relkind + ordered column name:type:notnull:default,
--              or the view definition)
--   idx        indexes (pg_get_indexdef)
--   con        constraints (pg_get_constraintdef)
--   fn         functions: md5(prosrc, whitespace collapsed) + security definer flag
--              + md5(proconfig search_path + result type)
--   trg        non-internal triggers on public/private relations
--   pol        RLS policies on public/private (cmd, permissive, roles, qual, with check)
--   rls        relations with row security enabled / forced
--   enum       enum types and their ordered labels
--   grant_rel  table/view privileges per grantee (role name, or PUBLIC)
--   grant_fn   function EXECUTE per grantee (NULL acl expanded to the default)
--   grant_ns   schema USAGE/CREATE per grantee
--   defacl     ALTER DEFAULT PRIVILEGES entries for public/private
--   storage_pol  policies on storage.objects / storage.buckets
--   auth_trg   non-internal triggers on auth.users
--   pub        publication membership (any schema)
--   ext        extensions and their versions
--   bucket     storage bucket definitions (public flag, size limit, mime types)
--
-- Personal data: none. Only object names and md5s of definitions leave the database.
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
             where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
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
k_auth_trg as (
  select t.tgname::text as k, left(md5(pg_get_triggerdef(t.oid) || ':' || t.tgenabled::text), 12) as v
  from pg_trigger t
  where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
),
k_pub as (
  select pubname || ':' || schemaname || '.' || tablename as k, 'member' as v
  from pg_publication_tables
),
k_ext as (
  select extname::text as k, extversion::text as v from pg_extension
),
k_bucket as (
  select id::text as k,
         left(md5(public::text || '|' || coalesce(file_size_limit::text, '') || '|' ||
                  coalesce(array_to_string(allowed_mime_types, ','), '')), 12) as v
  from storage.buckets
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
  'auth_trg',    (select coalesce(jsonb_object_agg(k, v), '{}') from k_auth_trg),
  'pub',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_pub),
  'ext',         (select coalesce(jsonb_object_agg(k, v), '{}') from k_ext),
  'bucket',      (select coalesce(jsonb_object_agg(k, v), '{}') from k_bucket)
) as fingerprint
