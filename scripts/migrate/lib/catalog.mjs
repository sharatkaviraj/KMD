/**
 * One's own catalog of the fee schema (`public` on wtgxcptmucjerhufzjcf), as
 * the loader and reconcile need it: base tables with columns, primary keys,
 * unique keys, foreign keys, user triggers and owned sequences, and the
 * materialized views in refresh order. One read-only SELECT of catalog
 * tables; no row data.
 *
 * The fees side is never asked for its catalog here: A1 proved the two match
 * (docs/cutover/SCHEMA-PARITY.md), and the extract carries its own column
 * list from PostgREST's OpenAPI document.
 */

export const CATALOG_SQL = `
with t as (
  select c.oid, c.relname
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
)
select jsonb_build_object(
  'tables', coalesce((
    select jsonb_object_agg(t.relname, jsonb_build_object(
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'generated', a.attgenerated <> '',
          'identity', a.attidentity <> ''
        ) order by a.attnum)
        from pg_attribute a
        where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      ),
      'pk', (
        select jsonb_agg(a.attname order by k.ord)
        from pg_constraint con
        cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
        where con.conrelid = t.oid and con.contype = 'p'
      ),
      'uniques', coalesce((
        select jsonb_agg(cols)
        from (
          select (
            select jsonb_agg(a.attname order by k.ord)
            from unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
          ) as cols
          from pg_index i
          where i.indrelid = t.oid and i.indisunique and not i.indisprimary
            and i.indpred is null and i.indexprs is null
        ) u
        where cols is not null
      ), '[]'::jsonb),
      'triggers', coalesce((
        select jsonb_agg(tg.tgname order by tg.tgname)
        from pg_trigger tg
        where tg.tgrelid = t.oid and not tg.tgisinternal
      ), '[]'::jsonb),
      'sequences', coalesce((
        select jsonb_agg(jsonb_build_object('column', a.attname, 'sequence', pg_get_serial_sequence('public.' || quote_ident(t.relname), a.attname)))
        from pg_attribute a
        where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
          and pg_get_serial_sequence('public.' || quote_ident(t.relname), a.attname) is not null
      ), '[]'::jsonb)
    ))
    from t
  ), '{}'::jsonb),
  'fks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname,
      'child', cc.relname,
      'childCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
      'parentSchema', pn.nspname,
      'parent', pc.relname,
      'parentCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum),
      'onDelete', con.confdeltype,
      'nullable', (select bool_and(not a.attnotnull) from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any(con.conkey))
    ) order by con.conname)
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_class pc on pc.oid = con.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
    where con.contype = 'f' and cc.relnamespace = 'public'::regnamespace
  ), '[]'::jsonb),
  'allFks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', con.conname,
      'childSchema', cn.nspname,
      'child', cc.relname,
      'childCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum),
      'parentSchema', pn.nspname,
      'parent', pc.relname,
      'parentCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum)
    ) order by con.conname)
    from pg_constraint con
    join pg_class cc on cc.oid = con.conrelid
    join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = con.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
    where con.contype = 'f' and (cn.nspname = 'public' or pn.nspname = 'public')
  ), '[]'::jsonb),
  'matviews', coalesce((
    select jsonb_agg(c.relname order by c.oid)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'm'
  ), '[]'::jsonb)
) as meta
`;

/** Read the catalog through an open `postgres` connection (or transaction). */
export async function readCatalog(sql) {
  const [row] = await sql.unsafe(CATALOG_SQL);
  const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
  for (const table of Object.values(meta.tables)) {
    table.pk ??= [];
    table.uniques ??= [];
  }
  return meta;
}

/**
 * Matviews in an order that refreshes dependencies first: a matview that
 * reads another one comes after it.
 */
export const MATVIEW_ORDER_SQL = `
with recursive m as (
  select c.oid, c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'm'
),
deps as (
  select distinct m.relname as view, dm.relname as uses
  from m
  join pg_rewrite r on r.ev_class = m.oid
  join pg_depend d on d.objid = r.oid and d.classid = 'pg_rewrite'::regclass
  join m dm on dm.oid = d.refobjid and dm.oid <> m.oid
)
select m.relname, coalesce((select jsonb_agg(uses) from deps where deps.view = m.relname), '[]'::jsonb) as uses
from m order by m.relname
`;

/** Topological order over { view: [uses] }. Pure. */
export function matviewOrder(rows) {
  const deps = new Map(rows.map((r) => [r.relname, new Set(typeof r.uses === "string" ? JSON.parse(r.uses) : r.uses)]));
  const order = [];
  while (deps.size) {
    const ready = [...deps.keys()].filter((v) => [...deps.get(v)].every((u) => !deps.has(u))).sort();
    if (!ready.length) throw new Error("Matviews depend on each other in a cycle.");
    for (const v of ready) {
      order.push(v);
      deps.delete(v);
    }
  }
  return order;
}
