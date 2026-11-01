import { z } from "zod";
import { idKey } from "@/modules/collection/domain/sampark-import";
import { isCertificateDate } from "@/modules/certificates/domain/certificate";

export const portals = ["psp", "udise", "class5", "class8", "rbse10", "rbse12"] as const;
export const returnFields = ["studentId", "admissionNo", "studentName", "classLabel", "sessionLabel", "schoolCode", "externalId", "registrationStatus"] as const;
export type ReturnField = (typeof returnFields)[number];
export const adapterSchema = z.object({
  portal: z.enum(portals), module: z.string().trim().min(2).max(80), sessionLabel: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/),
  schoolCode: z.string().trim().max(50), version: z.number().int().positive(), mode: z.enum(["manual_reference", "verified_upload"]),
  format: z.enum(["csv", "xlsx"]), sheetName: z.string().min(1).max(31).refine((s) => !/[\[\]:*?/\\]/.test(s)),
  matchField: z.enum(["studentId", "admissionNo", "externalId"]), sourceReference: z.string().trim().max(600),
  specimenSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), verifiedOn: z.string().nullable(),
  columns: z.array(z.object({ header: z.string().trim().min(1).max(100).refine(value => safeSpreadsheetText(value) === value, "Unsafe header"), field: z.enum(returnFields), required: z.boolean(), maxLength: z.number().int().min(1).max(1000).optional(), codeMap: z.record(z.string().min(1).max(250), z.string().min(1).max(250)).refine(map => Object.keys(map).length <= 100, "Too many codes").optional() })).min(3).max(30),
}).superRefine((a, ctx) => {
  const fields = a.columns.map((c) => c.field), headers = a.columns.map((c) => c.header);
  if (new Set(fields).size !== fields.length || new Set(headers).size !== headers.length) ctx.addIssue({ code: "custom", message: "Duplicate columns" });
  if (!fields.includes(a.matchField)) ctx.addIssue({ code: "custom", message: "Matching identity column is required" });
  if (a.columns.some(c => c.codeMap && new Set(Object.values(c.codeMap)).size !== Object.values(c.codeMap).length)) ctx.addIssue({ code: "custom", message: "Code mappings must be reversible" });
  if (a.mode === "verified_upload" && (!a.schoolCode || !a.specimenSha256 || !a.verifiedOn || !isCertificateDate(a.verifiedOn) || a.sourceReference.length < 10 || !fields.includes("schoolCode") || !fields.includes("sessionLabel"))) ctx.addIssue({ code: "custom", message: "A verified current specimen, school/session columns and provenance are required" });
});
export type GovernmentAdapter = z.infer<typeof adapterSchema>;
export type ReturnStudent = {
  studentId: string; admissionNo: string; studentName: string; classLabel: string; classId: string; sessionLabel: string; schoolCode: string;
  externalId: string; registrationStatus: string; sourceRevision: string; externalRevision: number; identityVerified: boolean;
};
export type ReturnPreflight = { studentId: string; state: "ready" | "blocked"; reasons: string[] };
export type ReturnImportRow = { row: number; studentId: string | null; studentName: string; state: "ready" | "unchanged" | "conflict" | "unmatched"; reasons: string[]; changes: Partial<Pick<ReturnStudent, "externalId" | "registrationStatus">>; expectedRevision: number; sourceRevision: string };
export type GovernmentBatch = { id: string; session_label: string; portal: string; module: string; direction: "export" | "import"; state: "preparing" | "exported" | "staged" | "applied" | "submitted" | "accepted" | "partially_accepted" | "rejected"; adapter: GovernmentAdapter; payload: { rows?: ReturnStudent[]; preview?: ReturnImportRow[]; counts: Record<string, number>; sourceRevision: string; excluded?: string[] }; file_path: string | null; file_sha256: string | null; file_name: string | null; created_at: string; updated_at: string; revision: number; parent_batch_id: string | null; evidence_path: string | null; acknowledgement: string | null; source_hash: string | null; row_outcomes?: { studentId: string; state: "accepted" | "not_accepted" }[] };

export function manualReferenceAdapter(portal: GovernmentAdapter["portal"], module: string, sessionLabel: string, schoolCode = ""): GovernmentAdapter {
  return { portal, module, sessionLabel, schoolCode, version: 1, mode: "manual_reference", format: "xlsx", sheetName: "Manual reference", matchField: "studentId", sourceReference: "One reference sheet for manual portal entry; not an official upload format", specimenSha256: null, verifiedOn: null,
    columns: [{ header: "One student UUID", field: "studentId", required: true }, { header: "Admission / SR number", field: "admissionNo", required: true }, { header: "Student name", field: "studentName", required: true }, { header: "Class", field: "classLabel", required: true }, { header: "Academic session", field: "sessionLabel", required: true }, { header: "School code", field: "schoolCode", required: false }] };
}
export function safeSpreadsheetText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
}
function key(value: string | null | undefined): string { return idKey(value) ?? ""; }
function duplicateKeys(values: string[]): Set<string> { const seen = new Set<string>(), duplicates = new Set<string>(); for (const v of values) { if (v && seen.has(v)) duplicates.add(v); seen.add(v); } return duplicates; }

export function preflightReturn(rows: ReturnStudent[], adapter: GovernmentAdapter): ReturnPreflight[] {
  adapterSchema.parse(adapter);
  const duplicates = duplicateKeys(rows.map((row) => key(row[adapter.matchField])));
  return rows.map((row) => {
    const reasons: string[] = [];
    if (!row.identityVerified) reasons.push("identity_unverified");
    if (row.sessionLabel !== adapter.sessionLabel) reasons.push("wrong_session");
    if (adapter.schoolCode && row.schoolCode !== adapter.schoolCode) reasons.push("wrong_school");
    if (duplicates.has(key(row[adapter.matchField]))) reasons.push("duplicate_identity");
    for (const column of adapter.columns) {
      const value = row[column.field] ?? "";
      if ((column.required || column.field === adapter.matchField) && !value.trim()) reasons.push(`missing:${column.field}`);
      if (value.length > (column.maxLength ?? 250)) reasons.push(`too_long:${column.field}`);
      if (adapter.mode === "verified_upload" && safeSpreadsheetText(value) !== value) reasons.push("unsafe_cell");
      if (adapter.mode === "verified_upload" && column.codeMap?.[value] && safeSpreadsheetText(column.codeMap[value]) !== column.codeMap[value]) reasons.push("unsafe_cell");
      if (column.codeMap && value && !Object.hasOwn(column.codeMap, value)) reasons.push(`invalid_code:${column.field}`);
    }
    return { studentId: row.studentId, state: reasons.length ? "blocked" : "ready", reasons: [...new Set(reasons)] };
  });
}
export function returnTable(rows: ReturnStudent[], adapter: GovernmentAdapter): string[][] {
  return [adapter.columns.map((c) => c.header), ...rows.map((row) => adapter.columns.map((c) => { const raw = row[c.field] ?? ""; const value = c.codeMap && raw ? c.codeMap[raw] ?? raw : raw; if (adapter.mode === "verified_upload" && safeSpreadsheetText(value) !== value) throw new Error("Unsafe mapped cell"); return adapter.mode === "manual_reference" ? safeSpreadsheetText(value) : value; }))];
}

export function previewReturnImport(rows: Record<string, string>[], adapter: GovernmentAdapter, current: ReturnStudent[]): ReturnImportRow[] {
  adapterSchema.parse(adapter);
  if (adapter.mode !== "verified_upload") throw new Error("An official returned file needs a verified adapter");
  const expected = adapter.columns.map((c) => c.header);
  if (rows.some(row => JSON.stringify(Object.keys(row)) !== JSON.stringify(expected))) throw new Error("Unsupported file headers or order");
  const decoded = rows.map((row) => Object.fromEntries(adapter.columns.map((c) => {
    const raw = row[c.header] ?? "";
    const reverse = c.codeMap ? Object.fromEntries(Object.entries(c.codeMap).map(([k, v]) => [v, k])) : null;
    return [c.field, reverse && raw ? reverse[raw] ?? raw : raw];
  })) as Partial<Record<ReturnField, string>>);
  const duplicates = duplicateKeys(decoded.map((row) => key(row[adapter.matchField])));
  const externalDuplicates = duplicateKeys(decoded.map((row) => key(row.externalId)));
  return decoded.map((row, index) => {
    const reasons: string[] = [];
    const value = key(row[adapter.matchField]);
    if (row.schoolCode !== adapter.schoolCode) reasons.push("wrong_school");
    if (row.sessionLabel !== adapter.sessionLabel) reasons.push("wrong_session");
    if (!value || duplicates.has(value)) reasons.push("duplicate_identity");
    const matches = current.filter((s) => key(s[adapter.matchField]) === value);
    const student = matches.length === 1 ? matches[0] : null;
    if (matches.length > 1) reasons.push("ambiguous_identity");
    const changes: ReturnImportRow["changes"] = {};
    if (student) {
      if (!student.identityVerified) reasons.push("identity_unverified");
      for (const column of adapter.columns) {
        const incoming = row[column.field] ?? "";
        if (column.required && !incoming.trim()) reasons.push(`missing:${column.field}`);
        if (incoming.length > (column.maxLength ?? 250) || safeSpreadsheetText(incoming) !== incoming) reasons.push("invalid_cell");
        if (column.codeMap && incoming && !Object.hasOwn(column.codeMap, incoming)) reasons.push(`invalid_code:${column.field}`);
        if (!incoming) continue; // An empty cell is not a deletion.
        if (column.field === "externalId" || column.field === "registrationStatus") {
          if (incoming !== student[column.field]) changes[column.field] = incoming;
        } else if (column.field !== "schoolCode" && column.field !== "sessionLabel" && incoming !== student[column.field]) reasons.push(`protected_field:${column.field}`);
      }
      if (row.externalId && (externalDuplicates.has(key(row.externalId)) || current.some((s) => s.studentId !== student.studentId && key(s.externalId) === key(row.externalId)))) reasons.push("external_id_collision");
    }
    return { row: index + 2, studentId: student?.studentId ?? null, studentName: student?.studentName ?? row.studentName ?? "", state: reasons.length ? "conflict" : !student ? "unmatched" : Object.keys(changes).length ? "ready" : "unchanged", reasons: [...new Set(reasons)], changes: reasons.length ? {} : changes, expectedRevision: student?.externalRevision ?? 0, sourceRevision: student?.sourceRevision ?? "" };
  });
}
