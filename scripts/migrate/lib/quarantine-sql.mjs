/**
 * The statements the in-place quarantine runs, per table — built from the
 * catalog (lib/vppsone-catalog.mjs), the bucket rules
 * (lib/quarantine-rules.mjs) and the id maps. Pure: the dry run counts with
 * each op's WHERE, the apply runs its UPDATE, and both come from the same op,
 * so the report and the write can never disagree.
 *
 * Every op addresses the table as `t`. Maps go in as two uuid[] parameters
 * (source, target) — Postgres array literals, cast in the statement.
 */

import { scrubNeeded, scrubValue, SENSITIVE_FIELD, TABLES, TEST_SESSION } from "./quarantine-rules.mjs";

const q = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Not a plain identifier: ${name}`);
  return `"${name}"`;
};

/** A JS list of uuids as one Postgres array literal parameter. */
export function uuidArray(ids) {
  for (const id of ids) if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new Error(`Not a uuid: ${id}`);
  return `{${ids.join(",")}}`;
}

/** [sources[], targets[]] of a Map. */
export function mapParams(map) {
  const entries = [...map.entries()].filter(([s, t]) => s !== t);
  return [uuidArray(entries.map(([s]) => s)), uuidArray(entries.map(([, t]) => t))];
}

/** `t.field_id` names a record field that may hold a phone, an identifier or an address. */
export const SENSITIVE_FIELD_SQL =
  `exists (select 1 from vppsone.collection_fields f where f.id = t.field_id ` +
  `and (f.key ~* '${SENSITIVE_FIELD.source}' or coalesce(f.label_en, '') ~* '${SENSITIVE_FIELD.source}' or coalesce(f.input_type::text, '') ~* 'phone|tel|email'))`;

/** Which rows of a table the quarantine owns. null = none. */
export function scopeOf(info) {
  const bucket = TABLES[info.table]?.bucket;
  if (bucket === "B") return "true";
  if ((bucket === "A" || bucket === "R") && info.hasSession && info.table !== "staff_profiles") {
    return "vppsone.is_test_session_label(t.session_label)";
  }
  return null;
}

/**
 * The ops for one table, in order: relabel, class / student / staff
 * re-points, scrubs, terminal states. `maps`: { classMap, studentMap,
 * staffMap } (Map source -> target).
 */
export function planTableOps(info, maps) {
  const spec = TABLES[info.table] ?? {};
  const scope = scopeOf(info);
  if (!scope) return [];
  const ops = [];
  const has = (c) => info.columnNames.has(c);

  if (spec.bucket === "B" && info.hasSession) {
    ops.push({
      kind: "relabel",
      column: "session_label",
      where: `not vppsone.is_test_session_label(t.session_label)`,
      set: `session_label = '${TEST_SESSION}'${spec.relabelSet ? `, ${spec.relabelSet}` : ""}`,
      params: [],
    });
  }

  const repoint = (kind, column, map) => {
    const params = mapParams(map);
    if (params[0] === "{}") return;
    ops.push({ kind, column, map: true, where: `t.${q(column)} = any($1::uuid[]) and (${scope})`, setFrom: `${q(column)} = m.target`, params });
  };
  const repointArray = (kind, column, map) => {
    const params = mapParams(map);
    if (params[0] === "{}") return;
    ops.push({
      kind,
      column,
      where: `t.${q(column)} && $1::uuid[] and (${scope})`,
      set: `${q(column)} = (select array_agg(coalesce(m.target, u.x) order by u.o) from unnest(t.${q(column)}) with ordinality as u(x, o) left join unnest($1::uuid[], $2::uuid[]) as m(source, target) on m.source = u.x)`,
      params,
    });
  };

  // A TEST class teacher moved onto a TEST class that already has a current
  // one of the same role is closed (yesterday, never before it began) rather
  // than refused by class_teachers_one_current_per_class.
  if (info.table === "class_teachers" && maps.classMap.size) {
    const params = mapParams(maps.classMap);
    if (params[0] !== "{}") {
      ops.push({
        kind: "close-duplicate",
        column: "effective_to",
        where:
          `t.class_id = any($1::uuid[]) and (${scope}) and t.effective_to is null and exists (` +
          `select 1 from vppsone.class_teachers x join unnest($1::uuid[], $2::uuid[]) as m(source, target) on m.source = t.class_id ` +
          `where x.class_id = m.target and x.session_label = t.session_label and x.role = t.role and x.effective_to is null and x.id <> t.id)`,
        set: `effective_to = greatest(t.effective_from, vppsone.school_today() - 1)`,
        params,
      });
    }
  }

  // Columns from the catalog: by name, by foreign key, and the no-foreign-key
  // references TABLES lists (lib/vppsone-catalog.mjs describeTables).
  for (const c of info.classCols) repoint("class", c, maps.classMap);
  for (const c of info.classArrays ?? []) repointArray("class", c, maps.classMap);
  for (const c of info.studentCols) repoint("student", c, maps.studentMap);
  for (const c of info.studentArrays ?? []) repointArray("student", c, maps.studentMap);
  for (const c of info.staffCols) repoint("staff", c, maps.staffMap);
  for (const c of info.staffArrays ?? []) repointArray("staff", c, maps.staffMap);

  for (const { column, to } of spec.scrub ?? []) {
    if (!has(column)) continue;
    ops.push({ kind: "scrub", column, where: `${scrubNeeded(column, to)} and (${scope})`, set: `${q(column)} = ${scrubValue(to)}`, params: [] });
  }
  // Record-field answers (collection submissions, student records and their
  // history): a phone / identifier / address field's answer is nulled.
  const sensitive = (spec.sensitiveValues ?? []).filter(has);
  if (sensitive.length && has("field_id")) {
    ops.push({
      kind: "scrub",
      column: sensitive[0],
      where: `(${sensitive.map((c) => `t.${q(c)} is not null`).join(" or ")}) and (${scope}) and ${SENSITIVE_FIELD_SQL}`,
      set: sensitive.map((c) => `${q(c)} = null`).join(", "),
      params: [],
    });
  }
  if (spec.terminal) {
    ops.push({ kind: "terminal", column: "status", where: `(${spec.terminal.where}) and (${scope})`, set: spec.terminal.set, params: [] });
  }
  return ops;
}

/**
 * The general rule alone, for TEST-labelled rows of EVERY table (any bucket):
 * a TEST row never points at a real class. The class part only — used by
 * repoint-test-class-rows.mjs before the quarantine (critique: the two
 * class_teachers rows of 22 Sep) and repeated by the quarantine itself.
 */
export function planTestClassOps(info, classMap) {
  if (!info.hasSession || !info.classCols.length) return [];
  const scope = "vppsone.is_test_session_label(t.session_label)";
  const params = mapParams(classMap);
  if (params[0] === "{}") return [];
  const ops = [];
  if (info.table === "class_teachers") {
    ops.push({
      kind: "close-duplicate",
      column: "effective_to",
      where:
        `t.class_id = any($1::uuid[]) and (${scope}) and t.effective_to is null and exists (` +
        `select 1 from vppsone.class_teachers x join unnest($1::uuid[], $2::uuid[]) as m(source, target) on m.source = t.class_id ` +
        `where x.class_id = m.target and x.session_label = t.session_label and x.role = t.role and x.effective_to is null and x.id <> t.id)`,
      set: `effective_to = greatest(t.effective_from, vppsone.school_today() - 1)`,
      params,
    });
  }
  for (const c of info.classCols) {
    ops.push({ kind: "class", column: c, map: true, where: `t.${q(c)} = any($1::uuid[]) and (${scope})`, setFrom: `${q(c)} = m.target`, params });
  }
  return ops;
}

/** The parameters an op's WHERE alone uses (Postgres refuses an unused, untyped $2). */
export function whereParams(op) {
  if (op.where.includes("$2")) return op.params;
  if (op.where.includes("$1")) return op.params.slice(0, 1);
  return [];
}

/** `select count(*)` for an op against `relation` (a table, or an append-only rewrite's copy). */
export function countSql(op, relation) {
  return `select count(*)::int as n from ${relation} as t where ${op.where}`;
}

/** The UPDATE for an op. */
export function updateSql(op, relation) {
  if (op.map) {
    return `update ${relation} as t set ${op.setFrom} from unnest($1::uuid[], $2::uuid[]) as m(source, target) where t.${q(op.column)} = m.source and ${op.where}`;
  }
  return `update ${relation} as t set ${op.set} where ${op.where}`;
}

/** The ids of the rows an op would change (append-only rewrites copy exactly these). */
export function idsSql(op, relation) {
  return `select t.id::text as id from ${relation} as t where ${op.where}`;
}

export const quoteIdent = q;
