import "server-only";

import { FEE_SCHEMA, getVppsOneEnvironment } from "@/platform/env";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap } from "@/modules/academics/data/academics-repo";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import { toSchoolDay } from "@/platform/dates";
import type { ExportField, RoundLinkExport, Sheet, StudentExportRow } from "@/modules/collection/domain/workbook";

/**
 * The reads behind the workbook exports (P10d, S-13). The caller has checked
 * `collection:manage`; every read here is the whole school's for one session,
 * which is the office's scope. Ids are chunked (rule 3b); tables that can
 * pass a thousand rows are paged (D-62).
 */

async function feeStudents(ids: string[]) {
  const admin = createAdminClient();
  const out = new Map<string, { name: string; srNo: string | null }>();
  for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select("id, full_name, admission_no")
      .in("id", chunk)
      .returns<{ id: string; full_name: string | null; admission_no: string | null }[]>();
    if (error) throw new Error(`Could not read the students: ${error.message}`);
    for (const row of data) out.set(row.id, { name: row.full_name ?? "—", srNo: row.admission_no });
  }
  return out;
}

export async function studentExport(sessionLabel: string): Promise<{ fields: ExportField[]; rows: StudentExportRow[] }> {
  const admin = createAdminClient();
  const roll = await fetchAllRows<{ student_id: string; class_id: string }>(
    (from, to) =>
      admin
        .from("enrolments")
        .select("student_id, class_id")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled")
        .order("student_id")
        .range(from, to)
        .returns<{ student_id: string; class_id: string }[]>(),
    "the roll",
  );
  const ids = roll.map((row) => row.student_id);
  const [students, labels, fieldList] = await Promise.all([feeStudents(ids), classLabelMap(sessionLabel), listFieldsPublic()]);
  const fields = fieldList.filter((field) => field.isActive).map((field) => ({ key: field.key, labelHi: field.labelHi, labelEn: field.labelEn }));
  const keyOf = new Map(fieldList.map((field) => [field.id, field.key]));

  const mappings = new Map<string, string>();
  const records = new Map<string, StudentExportRow["values"]>();
  for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
    const [mapped, held] = await Promise.all([
      admin.from("external_student_ids").select("student_id, external_id").eq("app_id", "sampark")
        .eq("source_environment", getVppsOneEnvironment()).in("student_id", chunk)
        .returns<{ student_id: string; external_id: string }[]>(),
      admin.from("student_records").select("student_id, field_id, value, source, source_detail, updated_at").in("student_id", chunk)
        .returns<{ student_id: string; field_id: string; value: string | null; source: string; source_detail: string | null; updated_at: string }[]>(),
    ]);
    if (mapped.error || held.error) throw new Error("Could not read the records for the export.");
    for (const row of mapped.data) mappings.set(row.student_id, row.external_id);
    for (const row of held.data) {
      const key = keyOf.get(row.field_id);
      if (!key) continue;
      const values = records.get(row.student_id) ?? {};
      values[key] = { value: row.value, source: row.source, sourceDetail: row.source_detail, recordedOn: toSchoolDay(new Date(row.updated_at)) };
      records.set(row.student_id, values);
    }
  }

  // The school's own class order (classLabelMap iterates in it), then by name.
  const classOrder = new Map([...labels.keys()].map((id, index) => [id, index]));
  const rows = [...roll]
    .sort(
      (a, b) =>
        (classOrder.get(a.class_id) ?? 999) - (classOrder.get(b.class_id) ?? 999) ||
        (students.get(a.student_id)?.name ?? "").localeCompare(students.get(b.student_id)?.name ?? ""),
    )
    .map((entry) => ({
      srNo: students.get(entry.student_id)?.srNo ?? null,
      samparkId: mappings.get(entry.student_id) ?? null,
      name: students.get(entry.student_id)?.name ?? "—",
      classLabel: labels.get(entry.class_id) ?? null,
      values: records.get(entry.student_id) ?? {},
    }));
  return { fields, rows };
}

export async function roundExport(roundId: string): Promise<{ title: string; sessionLabel: string; links: RoundLinkExport[] } | null> {
  const admin = createAdminClient();
  const { data: round } = await admin
    .from("collection_rounds")
    .select("id, session_label, title_hi, title_en")
    .eq("id", roundId)
    .maybeSingle<{ id: string; session_label: string; title_hi: string | null; title_en: string | null }>();
  if (!round) return null;

  const { data: links } = await admin
    .from("collection_requests")
    .select("id, audience_label, class_label")
    .eq("round_id", roundId)
    .order("audience_label")
    .returns<{ id: string; audience_label: string | null; class_label: string | null }[]>();
  if (!links || links.length === 0) {
    return { title: round.title_en ?? round.title_hi ?? "Round", sessionLabel: round.session_label, links: [] };
  }
  const linkIds = links.map((link) => link.id);

  const [fieldRows, members, answers] = await Promise.all([
    admin.from("collection_request_fields").select("request_id, sort_order, collection_fields!inner(key, label_hi, label_en)").in("request_id", linkIds)
      .returns<{ request_id: string; sort_order: number; collection_fields: { key: string; label_hi: string; label_en: string } }[]>(),
    fetchAllRows<{ request_id: string; student_id: string; roll_no: string | null; snapshot: Record<string, string | null> | null }>(
      (from, to) =>
        admin.from("collection_request_members").select("request_id, student_id, roll_no, snapshot").in("request_id", linkIds)
          .order("request_id").order("student_id").range(from, to)
          .returns<{ request_id: string; student_id: string; roll_no: string | null; snapshot: Record<string, string | null> | null }[]>(),
      "the round's children",
    ),
    fetchAllRows<{ request_id: string; student_id: string; value: string | null; status: string; collection_fields: { key: string } }>(
      (from, to) =>
        admin.from("collection_submissions").select("request_id, student_id, value, status, collection_fields!inner(key)").in("request_id", linkIds)
          .order("request_id").order("id").range(from, to)
          .returns<{ request_id: string; student_id: string; value: string | null; status: string; collection_fields: { key: string } }[]>(),
      "the round's answers",
    ),
  ]);
  const students = await feeStudents([...new Set(members.map((member) => member.student_id))]);

  return {
    title: round.title_en ?? round.title_hi ?? "Round",
    sessionLabel: round.session_label,
    links: links.map((link) => {
      const fields = (fieldRows.data ?? [])
        .filter((row) => row.request_id === link.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((row) => ({ key: row.collection_fields.key, labelHi: row.collection_fields.label_hi, labelEn: row.collection_fields.label_en }));
      const answered = answers.filter((row) => row.request_id === link.id);
      return {
        label: link.audience_label ?? link.class_label ?? "Link",
        fields,
        members: members
          .filter((member) => member.request_id === link.id)
          .sort((a, b) => (Number(a.roll_no) || 0) - (Number(b.roll_no) || 0))
          .map((member) => ({
            rollNo: member.roll_no,
            srNo: students.get(member.student_id)?.srNo ?? null,
            name: students.get(member.student_id)?.name ?? "—",
            shown: member.snapshot ?? {},
            answers: Object.fromEntries(
              answered
                .filter((row) => row.student_id === member.student_id)
                .map((row) => [row.collection_fields.key, { value: row.value, status: row.status }]),
            ),
          })),
      };
    }),
  };
}

/** Write the sheets as an `.xlsx`. Every cell goes in as text (see `domain/workbook.ts`). */
export async function workbookBytes(sheets: Sheet[]): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    // Text format on every cell, so Excel does not turn "0101" into 101 when
    // somebody edits a cell and saves.
    for (const address of Object.keys(ws)) {
      if (address.startsWith("!")) continue;
      const cell = ws[address] as { t: string; z?: string };
      cell.t = "s";
      cell.z = "@";
    }
    XLSX.utils.book_append_sheet(book, ws, sheet.name);
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** One row per export taken: who took what, and when. */
export async function logExport(input: { sessionLabel: string; kind: "students" | "round"; scope: string; rowCount: number; actorStaffId: string }) {
  await createAdminClient().from("academic_exports").insert({
    session_label: input.sessionLabel,
    kind: input.kind,
    scope: input.scope,
    row_count: input.rowCount,
    exported_by: input.actorStaffId,
  });
}
