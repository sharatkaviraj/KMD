import "server-only";

import { createHash } from "node:crypto";

import { FEE_SCHEMA, getVppsOneEnvironment } from "@/platform/env";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createAdminClient } from "@/platform/supabase/admin";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import { validateField } from "@/modules/collection/domain/fields";
import {
  buildIndex,
  readSheet,
  resolveAll,
  type AmbiguityReason,
  type MatchedOn,
} from "@/modules/collection/domain/sampark-import";

/**
 * SamPark's records, in (P10b, D-235).
 *
 * Every function here runs on the service role after the caller has checked
 * `collection:manage`. Staging writes nothing to a child's record: it keeps
 * the file's rows and how each one resolved. Applying and resolving are the
 * database's commands, which write through `write_student_value()` and
 * nothing else.
 */

export const MAX_SAMPARK_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SAMPARK_ROWS = 3000;

export type StageResult =
  | { ok: true; batchId: string; resumed: boolean }
  | { ok: false; reason: "too_large" | "unreadable" | "no_identity" | "empty" | "too_many_rows" };

/** A cell as text: dates as ISO days, everything else as the sheet shows it. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // The sheet's own day, not shifted by a timezone: SheetJS builds the date
    // at local midnight of the cell's day.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value);
}

async function readWorkbook(bytes: ArrayBuffer): Promise<{ headers: string[]; rows: string[][] } | null> {
  const XLSX = await import("xlsx");
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
  } catch {
    return null;
  }
  // SamPark names its sheet "Students"; anything else, the first sheet.
  const name = workbook.SheetNames.find((sheet) => sheet.toLowerCase() === "students") ?? workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) return null;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  if (grid.length === 0) return null;
  const [head, ...body] = grid;
  return {
    headers: (head ?? []).map(cellText),
    rows: body.map((line) => (line ?? []).map(cellText)),
  };
}

/**
 * Read an uploaded workbook, resolve every row by ids, and stage it. The same
 * file again returns the batch it already made, so an upload that was
 * interrupted is resumed rather than duplicated.
 */
export async function stageSamparkImport(input: {
  fileName: string;
  bytes: ArrayBuffer;
  sessionLabel: string;
  actorStaffId: string;
}): Promise<StageResult> {
  if (input.bytes.byteLength > MAX_SAMPARK_FILE_BYTES) return { ok: false, reason: "too_large" };

  const environment = getVppsOneEnvironment();
  const sha = createHash("sha256").update(Buffer.from(input.bytes)).digest("hex");
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("sampark_import_batches")
    .select("id")
    .eq("source_environment", environment)
    .eq("file_sha256", sha)
    .maybeSingle<{ id: string }>();
  if (existing) return { ok: true, batchId: existing.id, resumed: true };

  const table = await readWorkbook(input.bytes);
  if (!table) return { ok: false, reason: "unreadable" };
  if (table.rows.length > MAX_SAMPARK_ROWS) return { ok: false, reason: "too_many_rows" };

  const fields = (await listFieldsPublic()).filter((field) => field.isActive);
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const reading = readSheet(table, new Set(byKey.keys()));
  if (reading.noIdentity) return { ok: false, reason: "no_identity" };
  if (reading.rows.length === 0) return { ok: false, reason: "empty" };

  // Every child the file could name, on the roll or not, paged (D-62), and
  // every SamPark id already matched in this dataset.
  const [students, mappings] = await Promise.all([
    fetchAllRows<{ id: string; admission_no: string | null }>(
      (from, to) =>
        admin
          .schema(FEE_SCHEMA)
          .from("students")
          .select("id, admission_no")
          .order("id")
          .range(from, to)
          .returns<{ id: string; admission_no: string | null }[]>(),
      "the students",
    ),
    fetchAllRows<{ external_id: string; student_id: string }>(
      (from, to) =>
        admin
          .from("external_student_ids")
          .select("external_id, student_id")
          .eq("app_id", "sampark")
          .eq("source_environment", environment)
          .order("external_id")
          .range(from, to)
          .returns<{ external_id: string; student_id: string }[]>(),
      "the SamPark matches",
    ),
  ]);

  const index = buildIndex({
    mappings: mappings.map((row) => ({ externalId: row.external_id, studentId: row.student_id })),
    students: students.map((row) => ({ id: row.id, admissionNo: row.admission_no })),
  });
  const resolutions = resolveAll(reading.rows, index);

  const { data: batch, error: batchError } = await admin
    .from("sampark_import_batches")
    .insert({
      file_name: input.fileName.slice(0, 200),
      file_sha256: sha,
      source_environment: environment,
      session_label: input.sessionLabel,
      row_count: reading.rows.length,
      mapped_fields: reading.mapped.map((entry) => entry.fieldKey),
      ignored_headers: reading.ignored.slice(0, 100),
      uploaded_by: input.actorStaffId,
    })
    .select("id")
    .single<{ id: string }>();
  if (batchError) {
    // Two uploads of the same file at once: the other one made the batch.
    const { data: raced } = await admin
      .from("sampark_import_batches")
      .select("id")
      .eq("source_environment", environment)
      .eq("file_sha256", sha)
      .maybeSingle<{ id: string }>();
    if (raced) return { ok: true, batchId: raced.id, resumed: true };
    throw new Error(`Could not stage the file: ${batchError.message}`);
  }

  const records = reading.rows.map((row) => {
    const values: Record<string, string> = {};
    const problems: { field: string; value: string; message: string }[] = [];
    for (const [key, raw] of Object.entries(row.values)) {
      const field = byKey.get(key);
      if (!field || raw === null) continue;
      const result = validateField(field, raw);
      if (result.ok) {
        if (result.value !== null) values[key] = result.value;
      } else {
        problems.push({ field: key, value: raw, message: result.error.en });
      }
    }
    const resolution = resolutions.get(row.rowNo)!;
    return {
      batch_id: batch.id,
      row_no: row.rowNo,
      external_id: row.externalId,
      presented: { sr: row.sr, admission: row.admission, name: row.name, class: row.classLabel },
      field_values: values,
      problems,
      resolution: resolution.kind,
      why: resolution.kind === "ambiguous" ? resolution.why : null,
      matched_on: resolution.kind === "matched" ? resolution.by : null,
      student_id: resolution.kind === "matched" ? resolution.studentId : null,
      candidates: resolution.kind === "ambiguous" ? resolution.candidates : [],
    };
  });

  for (const chunk of chunkArray(records, 500)) {
    const { error } = await admin.from("sampark_import_rows").insert(chunk);
    if (error) throw new Error(`Could not stage the rows: ${error.message}`);
  }
  return { ok: true, batchId: batch.id, resumed: false };
}

/* ------------------------------------------------------------- reading */

export type ImportRow = {
  rowNo: number;
  externalId: string | null;
  presented: { sr: string | null; admission: string | null; name: string | null; class: string | null };
  values: Record<string, string>;
  problems: { field: string; value: string; message: string }[];
  resolution: "matched" | "ambiguous" | "unmatched" | "resolved" | "dismissed";
  why: AmbiguityReason | "no_such_child" | "child_mapped_elsewhere" | null;
  matchedOn: MatchedOn | "hand" | null;
  studentId: string | null;
  candidates: { id: string; name: string; admissionNo: string | null }[];
  appliedAt: string | null;
  outcome: { written: number; unchanged: number; kept_person: number; kept_other_import: number } | null;
  decisionNote: string | null;
};

export type ImportBatch = {
  id: string;
  fileName: string;
  rowCount: number;
  mappedFields: string[];
  ignoredHeaders: string[];
  uploadedAt: string;
  rows: ImportRow[];
};

type RowRecord = {
  row_no: number;
  external_id: string | null;
  presented: ImportRow["presented"];
  field_values: Record<string, string>;
  problems: ImportRow["problems"];
  resolution: ImportRow["resolution"];
  why: ImportRow["why"];
  matched_on: ImportRow["matchedOn"];
  student_id: string | null;
  candidates: string[];
  applied_at: string | null;
  outcome: ImportRow["outcome"];
  decision_note: string | null;
};

export async function recentBatches(limit = 10): Promise<{ id: string; fileName: string; rowCount: number; uploadedAt: string }[]> {
  const { data, error } = await createAdminClient()
    .from("sampark_import_batches")
    .select("id, file_name, row_count, uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; file_name: string; row_count: number; uploaded_at: string }[]>();
  if (error) throw new Error(`Could not read the imports: ${error.message}`);
  return data.map((row) => ({ id: row.id, fileName: row.file_name, rowCount: row.row_count, uploadedAt: row.uploaded_at }));
}

export async function importBatch(batchId: string): Promise<ImportBatch | null> {
  const admin = createAdminClient();
  const { data: batch } = await admin
    .from("sampark_import_batches")
    .select("id, file_name, row_count, mapped_fields, ignored_headers, uploaded_at")
    .eq("id", batchId)
    .maybeSingle<{ id: string; file_name: string; row_count: number; mapped_fields: string[]; ignored_headers: string[]; uploaded_at: string }>();
  if (!batch) return null;

  const rows = await fetchAllRows<RowRecord>(
    (from, to) =>
      admin
        .from("sampark_import_rows")
        .select("row_no, external_id, presented, field_values, problems, resolution, why, matched_on, student_id, candidates, applied_at, outcome, decision_note")
        .eq("batch_id", batchId)
        .order("row_no")
        .range(from, to)
        .returns<RowRecord[]>(),
    "the imported rows",
  );

  // Names for the children a queued row could be — read for the person
  // choosing, chunked (rule 3b).
  const candidateIds = [...new Set(rows.flatMap((row) => row.candidates))];
  const names = new Map<string, { name: string; admissionNo: string | null }>();
  for (const chunk of chunkArray(candidateIds, IN_FILTER_CHUNK_SIZE)) {
    const { data } = await admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select("id, full_name, admission_no")
      .in("id", chunk)
      .returns<{ id: string; full_name: string | null; admission_no: string | null }[]>();
    for (const student of data ?? []) {
      names.set(student.id, { name: student.full_name ?? "—", admissionNo: student.admission_no });
    }
  }

  return {
    id: batch.id,
    fileName: batch.file_name,
    rowCount: batch.row_count,
    mappedFields: batch.mapped_fields,
    ignoredHeaders: batch.ignored_headers,
    uploadedAt: batch.uploaded_at,
    rows: rows.map((row) => ({
      rowNo: row.row_no,
      externalId: row.external_id,
      presented: row.presented,
      values: row.field_values,
      problems: row.problems,
      resolution: row.resolution,
      why: row.why,
      matchedOn: row.matched_on,
      studentId: row.student_id,
      candidates: row.candidates.map((id) => ({ id, name: names.get(id)?.name ?? "—", admissionNo: names.get(id)?.admissionNo ?? null })),
      appliedAt: row.applied_at,
      outcome: row.outcome,
      decisionNote: row.decision_note,
    })),
  };
}

/** One child by the fee record's admission (SR) number, for a row nobody matched. */
export async function childByAdmissionNo(admissionNo: string): Promise<{ id: string } | "none" | "several"> {
  const { data } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id")
    .eq("admission_no", admissionNo.trim())
    .limit(2)
    .returns<{ id: string }[]>();
  if (!data || data.length === 0) return "none";
  if (data.length > 1) return "several";
  return { id: data[0]!.id };
}

/* ------------------------------------------------------------ commands */

const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type ApplyReceipt =
  | {
      ok: true;
      rowsApplied: number;
      written: number;
      unchanged: number;
      keptPerson: number;
      keptOtherImport: number;
      sentBackToQueue: number;
      replayed: boolean;
    }
  | { ok: false; reason: string };

export async function applySamparkImport(input: { commandId: string; batchId: string; actorStaffId: string }): Promise<ApplyReceipt> {
  const { data, error } = await createAdminClient().rpc("apply_sampark_import", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      batch_id: input.batchId,
      payload_hash: hashOf({ batch: input.batchId }),
    },
  });
  if (error || !data) return { ok: false, reason: "unavailable" };
  const receipt = data as Record<string, unknown>;
  if (receipt.ok !== true) return { ok: false, reason: String(receipt.reason ?? "unavailable") };
  return {
    ok: true,
    rowsApplied: Number(receipt.rows_applied ?? 0),
    written: Number(receipt.written ?? 0),
    unchanged: Number(receipt.unchanged ?? 0),
    keptPerson: Number(receipt.kept_person ?? 0),
    keptOtherImport: Number(receipt.kept_other_import ?? 0),
    sentBackToQueue: Number(receipt.sent_back_to_queue ?? 0),
    replayed: receipt.replayed === true,
  };
}

export type ResolveReceipt =
  | { ok: true; resolution: "resolved" | "dismissed"; applied: boolean; reason: string | null; written: number; keptPerson: number }
  | { ok: false; reason: string };

export async function resolveSamparkRow(input: {
  commandId: string;
  batchId: string;
  rowNo: number;
  studentId: string | null;
  dismiss: boolean;
  note: string | null;
  actorStaffId: string;
}): Promise<ResolveReceipt> {
  const payload = { batch: input.batchId, row: input.rowNo, student: input.studentId, dismiss: input.dismiss, note: input.note ?? "" };
  const { data, error } = await createAdminClient().rpc("resolve_sampark_row", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      batch_id: input.batchId,
      row_no: input.rowNo,
      student_id: input.studentId,
      dismiss: input.dismiss,
      note: input.note,
      payload_hash: hashOf(payload),
    },
  });
  if (error || !data) return { ok: false, reason: "unavailable" };
  const receipt = data as Record<string, unknown>;
  if (receipt.ok !== true) return { ok: false, reason: String(receipt.reason ?? "unavailable") };
  return {
    ok: true,
    resolution: receipt.resolution === "dismissed" ? "dismissed" : "resolved",
    applied: receipt.applied === true,
    reason: typeof receipt.reason === "string" ? receipt.reason : null,
    written: Number(receipt.written ?? 0),
    keptPerson: Number(receipt.kept_person ?? 0),
  };
}
