import { portals, type GovernmentAdapter, type GovernmentBatch, type ReturnField, type ReturnPreflight, type ReturnStudent } from "./exchange";

/*
 * The readiness board: which destinations the school sends returns to, and
 * for each one who is missing what. Pure — the roster, adapters and batches
 * are read by `data/`, and the same preflight decides "ready" here as on the
 * prepare command, so the board cannot promise a count the file will not keep.
 */

export type Portal = GovernmentAdapter["portal"];
/** The purpose a manual reference sheet carries when nobody configured one. */
export const DEFAULT_MODULE = "Student records";

export type Destination = {
  key: string; portal: Portal; module: string; schoolCode: string;
  adapterId: string | null; version: number | null; mode: GovernmentAdapter["mode"];
  /** A verified upload format exists. A manual destination needs no set-up to use. */
  configured: boolean;
};
export type AdapterRecord = { id: string; adapter: GovernmentAdapter; version: number };

/** FNV-1a, 32-bit, as 8 hex digits. A short stable URL token, not a security hash. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}
/** `udise` for the default sheet, `udise-1a2b3c4d` for a named module. */
export function destinationKey(portal: Portal, module: string): string {
  return module === DEFAULT_MODULE ? portal : `${portal}-${fnv(module)}`;
}

/**
 * One card per destination: the latest verified format for each portal and
 * module, any module a manual batch already used, and a default reference
 * sheet for every portal that has neither — so the board is never empty and
 * nothing is typed on it.
 */
export function returnDestinations(adapters: AdapterRecord[], batches: Pick<GovernmentBatch, "portal" | "module" | "adapter">[]): Destination[] {
  const byKey = new Map<string, Destination>();
  for (const row of [...adapters].sort((a, b) => b.version - a.version)) {
    const key = destinationKey(row.adapter.portal, row.adapter.module);
    if (byKey.has(key)) continue;
    byKey.set(key, { key, portal: row.adapter.portal, module: row.adapter.module, schoolCode: row.adapter.schoolCode, adapterId: row.id, version: row.version, mode: "verified_upload", configured: true });
  }
  for (const batch of batches) {
    const portal = batch.portal as Portal;
    if (!(portals as readonly string[]).includes(portal)) continue;
    const key = destinationKey(portal, batch.module);
    if (!byKey.has(key)) byKey.set(key, { key, portal, module: batch.module, schoolCode: "", adapterId: null, version: null, mode: "manual_reference", configured: false });
  }
  for (const portal of portals) {
    if ([...byKey.values()].some((d) => d.portal === portal)) continue;
    byKey.set(portal, { key: portal, portal, module: DEFAULT_MODULE, schoolCode: "", adapterId: null, version: null, mode: "manual_reference", configured: false });
  }
  const order = (d: Destination) => portals.indexOf(d.portal);
  return [...byKey.values()].sort((a, b) => order(a) - order(b) || Number(b.configured) - Number(a.configured) || a.module.localeCompare(b.module));
}

/* ----------------------------------------------------------- readiness */

/** Reasons only the office can settle — identity, session, collisions. Teachers are never asked about these. */
export const CONFLICT_REASONS = new Set(["identity_unverified", "wrong_session", "wrong_school", "duplicate_identity", "ambiguous_identity", "external_id_collision", "unsafe_cell", "invalid_cell"]);
export type ReadinessState = "ready" | "needs_details" | "conflict";
export function readinessState(row: Pick<ReturnPreflight, "state" | "reasons">): ReadinessState {
  if (row.state === "ready") return "ready";
  return row.reasons.some((reason) => CONFLICT_REASONS.has(reason)) ? "conflict" : "needs_details";
}
export type ReadinessCounts = { total: number; ready: number; needsDetails: number; conflict: number };
export function readinessCounts(preflight: Pick<ReturnPreflight, "state" | "reasons">[]): ReadinessCounts {
  const counts = { total: preflight.length, ready: 0, needsDetails: 0, conflict: 0 };
  for (const row of preflight) {
    const state = readinessState(row);
    if (state === "ready") counts.ready += 1; else if (state === "conflict") counts.conflict += 1; else counts.needsDetails += 1;
  }
  return counts;
}

export type ReadinessGrid = {
  classes: { id: string; label: string }[];
  /** Blocking reasons, details before conflicts, then by how many children each blocks. */
  issues: string[];
  counts: Record<string, Record<string, number>>;
};
/**
 * Class × reason: how many children in each class one reason blocks. A child
 * blocked for two reasons counts in both columns — each column is a list
 * somebody can work through. Classes keep roster order; clean classes drop out.
 */
export function readinessGrid(rows: Pick<ReturnStudent, "studentId" | "classId" | "classLabel">[], preflight: Pick<ReturnPreflight, "studentId" | "reasons">[]): ReadinessGrid {
  const reasonsOf = new Map(preflight.map((row) => [row.studentId, row.reasons]));
  const counts: Record<string, Record<string, number>> = {}, totals = new Map<string, number>(), classes = new Map<string, string>();
  for (const row of rows) {
    const reasons = reasonsOf.get(row.studentId) ?? [];
    if (!reasons.length) continue;
    if (!classes.has(row.classId)) classes.set(row.classId, row.classLabel);
    const cell = counts[row.classId] ??= {};
    for (const reason of reasons) { cell[reason] = (cell[reason] ?? 0) + 1; totals.set(reason, (totals.get(reason) ?? 0) + 1); }
  }
  const issues = [...totals.keys()].sort((a, b) => Number(CONFLICT_REASONS.has(a)) - Number(CONFLICT_REASONS.has(b)) || totals.get(b)! - totals.get(a)! || a.localeCompare(b));
  return { classes: [...classes].map(([id, label]) => ({ id, label })), issues, counts };
}
export type BlockedStudent = { studentId: string; studentName: string; admissionNo: string; classLabel: string; reasons: string[] };
/** The children behind one cell — or a whole class, or one reason school-wide, when the other is omitted. */
export function cellStudents(rows: ReturnStudent[], preflight: Pick<ReturnPreflight, "studentId" | "reasons">[], classId: string | null, issue: string | null): BlockedStudent[] {
  const reasonsOf = new Map(preflight.map((row) => [row.studentId, row.reasons]));
  return rows.flatMap((row) => {
    const reasons = reasonsOf.get(row.studentId) ?? [];
    if (!reasons.length || (classId && row.classId !== classId) || (issue && !reasons.includes(issue))) return [];
    return [{ studentId: row.studentId, studentName: row.studentName, admissionNo: row.admissionNo, classLabel: row.classLabel, reasons }];
  });
}

/* ------------------------------------------------ asking class teachers */

/**
 * Return fields a class teacher can supply through a collection round, keyed
 * to that round's field key. **Empty today, on purpose:** every column a
 * return carries is an office or portal fact (admission number, enrolment,
 * the portal's own ID), and none is a field the collection form asks. A
 * mapping goes here when a return gains a column a teacher can answer.
 */
export const COLLECTION_GAP_FOR: Partial<Record<ReturnField, string>> = {};

/**
 * The existing round-creation screen, pre-filled: the classes with children
 * missing details (never conflicts — those stay with the office), narrowed to
 * the gaps a round can actually collect. Null when no class needs a teacher.
 */
export function askTeachersHref(grid: ReadinessGrid, mapping: Partial<Record<string, string>> = COLLECTION_GAP_FOR): string | null {
  const detailIssues = grid.issues.filter((issue) => !CONFLICT_REASONS.has(issue));
  const classIds = grid.classes.filter((c) => detailIssues.some((issue) => grid.counts[c.id]?.[issue])).map((c) => c.id);
  if (!classIds.length) return null;
  const params = new URLSearchParams();
  for (const id of classIds) params.append("class", id);
  const gaps = new Set(detailIssues.flatMap((issue) => { const field = issue.startsWith("missing:") ? issue.slice(8) : null; const gap = field ? mapping[field] : undefined; return gap ? [gap] : []; }));
  for (const gap of gaps) params.append("gap", gap);
  return `/collection/rounds/new?${params}`;
}
