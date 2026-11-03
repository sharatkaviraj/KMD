/**
 * What the phase-H scripts need to know about One's own `vppsone` tables,
 * read from pg_catalog in the caller's transaction: columns, named triggers,
 * primary keys and every foreign key — so the quarantine follows the schema
 * as it is today rather than a list someone keeps by hand. Only the bucket of
 * each table is kept by hand (lib/quarantine-rules.mjs), and a table it does
 * not know stops the run.
 */

import { TABLES } from "./quarantine-rules.mjs";

export async function readVppsoneCatalog(tx) {
  const [row] = await tx`
    select jsonb_build_object(
      'tables', coalesce((
        select jsonb_object_agg(c.relname, jsonb_build_object(
          'columns', (
            select jsonb_agg(jsonb_build_object(
              'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
              'generated', a.attgenerated <> ''
            ) order by a.attnum)
            from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          ),
          'pk', (
            select jsonb_agg(a.attname order by k.ord)
            from pg_constraint con
            cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
            where con.conrelid = c.oid and con.contype = 'p'
          ),
          'triggers', coalesce((
            select jsonb_agg(tg.tgname order by tg.tgname) from pg_trigger tg where tg.tgrelid = c.oid and not tg.tgisinternal
          ), '[]'::jsonb)
        ))
        from pg_class c
        where c.relnamespace = 'vppsone'::regnamespace and c.relkind = 'r'
      ), '{}'::jsonb),
      'fks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'child', cn.nspname || '.' || cc.relname,
          'parent', pn.nspname || '.' || pc.relname,
          'childCols', (select jsonb_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum)
        ) order by con.conname)
        from pg_constraint con
        join pg_class cc on cc.oid = con.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
        join pg_class pc on pc.oid = con.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
        where con.contype = 'f' and (cn.nspname = 'vppsone' or pn.nspname = 'vppsone')
      ), '[]'::jsonb)
    ) as meta`;
  const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
  return describeTables(meta);
}

/**
 * Per table: has a session_label, which columns hold a class / student /
 * staff-profile id (by name, by foreign key, and the no-foreign-key columns
 * TABLES lists: staffRefs, classRefs and the uuid[] arrays), self-references
 * and who points in from outside. Pure.
 */
/**
 * @param {{ tables: Record<string, any>, fks: any[] }} meta
 * @returns {Record<string, any>}
 */
export function describeTables(meta) {
  const out = {};
  for (const [table, t] of Object.entries(meta.tables)) {
    const columns = t.columns.filter((c) => !c.generated);
    const names = new Set(columns.map((c) => c.name));
    const fks = meta.fks.filter((fk) => fk.child === `vppsone.${table}`);
    const spec = TABLES[table] ?? {};
    const listed = (key) => (spec[key] ?? []).filter((c) => names.has(c));
    const staffFk = fks.filter((fk) => fk.parent === "vppsone.staff_profiles" && fk.childCols.length === 1).map((fk) => fk.childCols[0]);
    out[table] = {
      table,
      columns,
      pk: t.pk ?? [],
      triggers: t.triggers ?? [],
      hasSession: names.has("session_label"),
      classCols: [...(names.has("class_id") ? ["class_id"] : []), ...listed("classRefs")],
      studentCols: names.has("student_id") ? ["student_id"] : [],
      staffCols: [...new Set([...staffFk, ...listed("staffRefs")])],
      classArrays: listed("classArrays"),
      studentArrays: listed("studentArrays"),
      staffArrays: listed("staffArrays"),
      authCols: fks.filter((fk) => fk.parent === "auth.users" && fk.childCols.length === 1).map((fk) => fk.childCols[0]),
      fkCols: new Set(fks.flatMap((fk) => fk.childCols)),
      selfRefs: fks.filter((fk) => fk.parent === `vppsone.${table}` && fk.childCols.length === 1).map((fk) => fk.childCols[0]),
      referencedBy: meta.fks.filter((fk) => fk.parent === `vppsone.${table}` && fk.child !== `vppsone.${table}`).map((fk) => fk.child),
      notNull: new Set(columns.filter((c) => c.notNull).map((c) => c.name)),
      columnNames: names,
      // TABLES lists a column the table does not have: the list is stale.
      missingListed: ["staffRefs", "classRefs", "classArrays", "studentArrays", "staffArrays", "sensitiveValues"].flatMap((key) =>
        (spec[key] ?? []).filter((c) => !names.has(c)).map((c) => `${table}.${c}`),
      ),
    };
  }
  return out;
}

/** A column name that reads like a person or class reference. */
export const REFERENCE_NAME = /(^|_)(staff|class|student|profile)_ids?$|_by$|^on_behalf_of$/;

/**
 * Reference-shaped uuid / uuid[] columns of the tables the quarantine owns
 * (bucket B; the TEST rows of A / R tables with a session) that it would NOT
 * re-point: no foreign key, not found by name, not listed in TABLES — plus
 * listed columns the table no longer has. The quarantine refuses while any
 * exist (fail closed: a new `*_staff_id` column must be placed first). Pure.
 */
export function unlistedRefColumns(described) {
  const out = [];
  for (const info of Object.values(described)) {
    const bucket = TABLES[info.table]?.bucket;
    const owned = bucket === "B" || ((bucket === "A" || bucket === "R") && info.hasSession && info.table !== "staff_profiles");
    if (!owned) continue;
    out.push(...info.missingListed);
    const known = new Set([...info.classCols, ...info.studentCols, ...info.staffCols, ...info.classArrays, ...info.studentArrays, ...info.staffArrays, ...info.authCols]);
    for (const c of info.columns) {
      if (!/^uuid(\[\])?$/.test(c.type) || c.name === "id") continue;
      if (!REFERENCE_NAME.test(c.name) || known.has(c.name) || info.fkCols.has(c.name)) continue;
      out.push(`${info.table}.${c.name}`);
    }
  }
  return out.sort();
}
