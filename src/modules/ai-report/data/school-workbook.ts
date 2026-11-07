import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass, type StaffPermission } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { schoolProfile } from "@/platform/config/school";
import { FEE_SCHEMA } from "@/platform/env";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { noteViewer } from "@/vx/screens/notes/data";
import { canSeeNote, isTag, tagsFromKind, type Visibility } from "@/vx/screens/notes/domain/notes";
import {
  SHEETS, cellOf, classLabelOf, istStamp, schoolReadmeLines, shapeRow, sheetAllowed, shortRef,
  type Cell, type Lookups, type Row, type SheetSpec,
} from "../domain/sheets";
import { AiReportError } from "./access";

/**
 * The AI report's One half, as one workbook: "_README", "_SHEETS", the roll
 * ("Students"), then every sheet of `domain/sheets.ts` this reader may have.
 *
 * Read with the service role, so the permission rules are applied here:
 *  - a sheet needs the One permission that shows the same records on screen;
 *  - school-wide sheets need a school-wide role (admin, office, coordinators),
 *    because a teacher's or accountant's permission covers their own classes
 *    or the desk, not the whole school. Others get their own notes and One's
 *    fee follow-up records;
 *  - notes go through the notes screen's own rule (`canSeeNote`), so a private
 *    note is only its writer's and a health or family note only the admin's
 *    and the class teacher's.
 */

/** One response must stay under Vercel's 4.5 MB. */
export const MAX_SCHOOL_WORKBOOK_BYTES = 4_300_000;

type Admin = ReturnType<typeof createAdminClient>;
type ClassRow = { id: string; class_name: string; section: string | null; stream_name: string | null; sort_order: number | null };
type StudentRow = { id: string; admission_no: string | null; full_name: string; class_id: string | null; roll_no: string | null; status: string | null };
type StaffRow = { id: string; user_id: string | null; display_name: string };

export type SchoolWorkbook = { bytes: Uint8Array<ArrayBuffer>; rows: number; students: number; sheets: number };

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const message = (error: unknown) => (error instanceof Error ? error.message : "unknown error");

async function mapLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  }));
}

/** The session's classes and children, from One's view of the roll (Fees' roster for real staff on a real year). */
async function readRoll(admin: Admin, sessionLabel: string) {
  const { data: classes, error } = await admin.schema(FEE_SCHEMA).from("classes")
    .select("id, class_name, section, stream_name, sort_order").eq("session_label", sessionLabel).returns<ClassRow[]>();
  if (error) throw new Error(`Could not read the classes: ${error.message}`);
  const students = classes.length === 0 ? [] : await fetchAllRows<StudentRow>((from, to) => admin.schema(FEE_SCHEMA).from("students")
    .select("id, admission_no, full_name, class_id, roll_no, status, class_ref:classes!inner(session_label)")
    .eq("class_ref.session_label", sessionLabel).order("id").range(from, to).returns<StudentRow[]>(), "the roll");
  return { classes, students };
}

async function readAll(admin: Admin, table: string, columns: string, order: string, sessionLabel?: string): Promise<Row[]> {
  return fetchAllRows<Row>((from, to) => {
    let query = admin.from(table).select(columns);
    if (sessionLabel) query = query.eq("session_label", sessionLabel);
    return query.order(order).range(from, to).returns<Row[]>();
  }, table);
}

/** One sheet's raw rows, paged, and chunked by parent id for a children sheet (rule 3b). */
async function readSheet(admin: Admin, spec: SheetSpec, sessionLabel: string, parentIds: readonly string[]): Promise<Row[]> {
  const page = (chunk: string[] | null) => (from: number, to: number) => {
    let query = admin.from(spec.table).select("*");
    if (spec.scope.kind === "session") query = query.eq("session_label", sessionLabel);
    if (spec.scope.kind === "children" && chunk) query = query.in(spec.scope.column, chunk);
    for (const where of spec.where ?? []) {
      query = where.op === "isNull" ? query.is(where.column, null)
        : where.op === "neq" ? query.neq(where.column, where.value ?? "")
        : query.eq(where.column, where.value ?? "");
    }
    for (const column of spec.order) query = query.order(column, { ascending: true });
    return query.range(from, to).returns<Row[]>();
  };
  if (spec.scope.kind !== "children") return fetchAllRows<Row>(page(null), `the ${spec.sheet} sheet`);
  const rows: Row[] = [];
  for (const chunk of chunkArray(parentIds, IN_FILTER_CHUNK_SIZE)) rows.push(...(await fetchAllRows<Row>(page(chunk), `the ${spec.sheet} sheet`)));
  return rows;
}

export async function buildSchoolWorkbook(staff: CurrentStaff, sessionLabel: string): Promise<SchoolWorkbook> {
  const admin = createAdminClient();
  const schoolWide = readsEveryClass(staff);
  const allowed = (permission: StaffPermission) => sheetAllowed(permission, (wanted) => can(staff, wanted), schoolWide);
  const studentsSheet = allowed("students:view");

  // Which sheets to read: the reader's own, plus any parent a children sheet
  // needs only for its ids (papers for marks), which is never shown itself.
  const plan = new Map<string, { spec: SheetSpec; show: boolean }>();
  const want = (spec: SheetSpec, show: boolean) => {
    const known = plan.get(spec.key);
    if (known) { known.show ||= show && !spec.lookupOnly; return; }
    if (spec.scope.kind === "children") {
      const parentKey = spec.scope.parent;
      const parent = SHEETS.find((candidate) => candidate.key === parentKey);
      if (parent) want(parent, false);
    }
    plan.set(spec.key, { spec, show: show && !spec.lookupOnly });
  };
  for (const spec of SHEETS) if (allowed(spec.permission)) want(spec, true);
  const ordered = SHEETS.filter((spec) => plan.has(spec.key));

  // The roll and the names every sheet turns ids into.
  const [roll, staffRows, subjectRows, fieldRows, kindRows, roomRows, enrolmentRows, admissionRows] = await Promise.all([
    readRoll(admin, sessionLabel),
    readAll(admin, "staff_profiles", "id, user_id, display_name", "id") as Promise<StaffRow[]>,
    readAll(admin, "subjects", "id, code, name_en", "id"),
    readAll(admin, "collection_fields", "id, key, label_en", "id"),
    readAll(admin, "note_kinds", "id, code, label_en", "id"),
    readAll(admin, "exam_rooms", "id, name", "id"),
    studentsSheet ? readAll(admin, "enrolments", "student_id, roll_no, status, enrolled_on, left_on", "id", sessionLabel) : Promise.resolve([]),
    studentsSheet ? readAll(admin, "admission_details", "student_id, name_hi, docs, admitted_by, admitted_at", "student_id", sessionLabel) : Promise.resolve([]),
  ]);

  const raw = new Map<string, Row[]>();
  const failed = new Map<string, string>();
  await mapLimited(ordered.filter((spec) => spec.scope.kind !== "children"), 4, async (spec) => {
    try { raw.set(spec.key, await readSheet(admin, spec, sessionLabel, [])); } catch (error) { failed.set(spec.key, message(error)); }
  });

  // Notes by the notes screen's rule; support plans by the same reader.
  if (raw.has("notes") || raw.has("support_plans")) {
    const viewer = await noteViewer(staff, sessionLabel);
    // A note written before tags existed takes its old kind's tags, as on the
    // notes screen: an old "health" note is still a health note.
    const kindCode = new Map(kindRows.map((row) => [String(row.id), str(row.code)]));
    const notes = (raw.get("notes") ?? []).filter((row) => {
      const tags = (Array.isArray(row.tags) ? row.tags : []).filter(isTag);
      return canSeeNote({
        visibility: (row.visibility === "private" ? "private" : "team") as Visibility,
        writtenBy: str(row.written_by) ?? "",
        followUpStaffId: str(row.follow_up_staff_id),
        classId: str(row.class_id),
        tags: tags.length ? tags : tagsFromKind(kindCode.get(String(row.kind_id)) ?? null),
      }, viewer);
    });
    if (raw.has("notes")) raw.set("notes", notes);
    const seen = new Set(notes.map((row) => row.id));
    const everyClass = viewer.isAdmin || viewer.readsEveryClass || viewer.correctsAttendance;
    const plans = raw.get("support_plans");
    if (plans) {
      raw.set("support_plans", plans.filter((plan) => {
        const classId = str(plan.class_id);
        const noteId = str(plan.note_id);
        return (everyClass || (classId !== null && viewer.classIds.has(classId))) && (noteId === null || viewer.isAdmin || seen.has(noteId));
      }));
    }
  }

  for (const spec of ordered) {
    if (spec.scope.kind !== "children") continue;
    const { parent, parentKey } = spec.scope;
    const parentRows = raw.get(parent);
    if (!parentRows) { failed.set(spec.key, "the sheet it belongs to could not be read"); continue; }
    const ids = [...new Set(parentRows.filter(spec.parentFilter ?? (() => true)).map((row) => str(row[parentKey ?? "id"])).filter((id): id is string => id !== null))];
    try { raw.set(spec.key, await readSheet(admin, spec, sessionLabel, ids)); } catch (error) { failed.set(spec.key, message(error)); }
  }

  // Staff test accounts are not the school's staff on a real year.
  const realYear = !isTestSessionLabel(sessionLabel);
  if (realYear && raw.has("staff_profiles")) raw.set("staff_profiles", raw.get("staff_profiles")!.filter((row) => row.is_test_account !== true));

  const classes = new Map(roll.classes.map((row) => [row.id, classLabelOf(row)]));
  const staffNames = new Map<string, string>();
  for (const row of staffRows) {
    staffNames.set(row.id, row.display_name);
    if (row.user_id) staffNames.set(row.user_id, row.display_name);
  }
  const subjects = new Map(subjectRows.map((row) => [String(row.id), String(row.name_en || row.code || "")]));
  const assessments = new Map((raw.get("assessments") ?? []).map((row) => [String(row.id), String(row.label_en || row.code || "")]));
  const label = (key: string, column: string, pick: (row: Row) => unknown) =>
    new Map((raw.get(key) ?? []).map((row) => [String(row[column]), String(pick(row) ?? "")]));
  const lookups: Lookups = {
    students: new Map(roll.students.map((row) => [row.id, { admissionNo: row.admission_no, name: row.full_name, classId: row.class_id }])),
    classes,
    staff: staffNames,
    subjects,
    fields: new Map(fieldRows.map((row) => [String(row.id), String(row.label_en || row.key || "")])),
    noteKinds: new Map(kindRows.map((row) => [String(row.id), String(row.label_en || row.code || "")])),
    assessments,
    papers: new Map((raw.get("assessment_subjects") ?? []).map((row) => [String(row.id), {
      assessment: assessments.get(String(row.assessment_id)) ?? "",
      subject: String(row.subject_code || subjects.get(String(row.subject_id)) || ""),
      classId: str(row.class_id),
      maxMarks: cellOf(row.max_marks),
      passMarks: cellOf(row.pass_marks),
    }])),
    registers: new Map((raw.get("v_register_tally") ?? []).map((row) => [String(row.register_id), { day: String(row.day ?? ""), classId: str(row.class_id) }])),
    versions: label("timetable_versions", "id", (row) => `${row.label ?? ""} (${row.status ?? ""})`),
    supportPlans: label("support_plans", "id", (row) => `${shortRef(row.id)} · ${String(row.goal ?? "").slice(0, 80)}`),
    substitutionPlans: label("substitution_plans", "id", (row) => row.day),
    campaigns: label("message_campaigns", "id", (row) => row.title),
    requests: label("collection_requests", "id", (row) => row.title_en || row.title_hi),
    rounds: label("collection_rounds", "id", (row) => row.title_en || row.title_hi),
    rooms: new Map(roomRows.map((row) => [String(row.id), String(row.name ?? "")])),
  };

  // The roll, with One's enrolment and admission beside each child.
  const sortOrder = new Map(roll.classes.map((row) => [row.id, row.sort_order ?? 9999]));
  const enrolment = new Map(enrolmentRows.map((row) => [String(row.student_id), row]));
  const admission = new Map(admissionRows.map((row) => [String(row.student_id), row]));
  const rollNumber = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : Number.MAX_SAFE_INTEGER);
  const studentRows: Record<string, Cell>[] = studentsSheet ? [...roll.students]
    .sort((a, b) => (sortOrder.get(a.class_id ?? "") ?? 9999) - (sortOrder.get(b.class_id ?? "") ?? 9999)
      || (classes.get(a.class_id ?? "") ?? "").localeCompare(classes.get(b.class_id ?? "") ?? "")
      || rollNumber(a.roll_no) - rollNumber(b.roll_no) || a.full_name.localeCompare(b.full_name))
    .map((row) => {
      const enrolled = enrolment.get(row.id);
      const admitted = admission.get(row.id);
      return {
        "SR no": row.admission_no ?? "",
        Student: row.full_name,
        "Name (Hindi)": cellOf(admitted?.name_hi),
        Class: row.class_id ? classes.get(row.class_id) ?? "" : "",
        "Roll no": cellOf(enrolled?.roll_no ?? row.roll_no),
        Status: row.status ?? "",
        "Enrolment in One": enrolled ? cellOf(enrolled.status) : "Not enrolled in One",
        "Enrolled on": cellOf(enrolled?.enrolled_on),
        "Left on": cellOf(enrolled?.left_on),
        "Admitted on": cellOf(admitted?.admitted_at),
        "Admitted by": admitted?.admitted_by ? staffNames.get(String(admitted.admitted_by)) ?? "Unknown staff" : "",
        "Documents at admission": cellOf(admitted?.docs),
      };
    }) : [];

  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const index: Record<string, Cell>[] = [];
  const left: { sheet: string; why: string }[] = [];
  const sheets: { name: string; rows: Record<string, Cell>[] }[] = [];
  let total = 0;

  if (studentsSheet) {
    sheets.push({ name: "Students", rows: studentRows });
    index.push({ Sheet: "Students", Rows: studentRows.length, "What it holds": "The whole roll of the session: SR no, name, class, roll no, status, enrolment and admission.", Note: studentRows.length ? "" : "Nothing recorded for this session" });
    total += studentRows.length;
  } else {
    left.push({ sheet: "Students", why: "not included for this account (needs a school-wide role and 'students:view'). The Fees sheets carry the roll." });
  }
  for (const spec of SHEETS) {
    if (spec.lookupOnly) continue;
    const planned = plan.get(spec.key);
    if (!planned?.show) {
      const why = can(staff, spec.permission) ? "not included for this account (needs a school-wide role)" : `not included for this account (needs '${spec.permission}')`;
      left.push({ sheet: spec.sheet, why });
      index.push({ Sheet: spec.sheet, Rows: "", "What it holds": spec.about, Note: `Not included: ${why.replace(/^not included for this account /, "")}` });
      continue;
    }
    const problem = failed.get(spec.key);
    if (problem) {
      index.push({ Sheet: spec.sheet, Rows: "", "What it holds": spec.about, Note: `Could not be read: ${problem}` });
      continue;
    }
    const rows = (raw.get(spec.key) ?? []).map((row) => shapeRow(row, spec, lookups));
    index.push({ Sheet: spec.sheet, Rows: rows.length, "What it holds": spec.about, Note: rows.length ? "" : "Nothing recorded for this session" });
    if (rows.length) sheets.push({ name: spec.sheet, rows });
    total += rows.length;
  }

  const readme = schoolReadmeLines({
    schoolName: schoolProfile.name,
    sessionLabel,
    madeAt: istStamp(new Date().toISOString()),
    madeBy: staff.displayName,
    left,
    rehearsal: !realYear,
  });
  const readmeSheet = XLSX.utils.aoa_to_sheet(readme.map((line) => [line]));
  readmeSheet["!cols"] = [{ wch: 120 }];
  XLSX.utils.book_append_sheet(book, readmeSheet, "_README");
  const indexSheet = XLSX.utils.json_to_sheet(index, { header: ["Sheet", "Rows", "What it holds", "Note"] });
  indexSheet["!cols"] = [{ wch: 26 }, { wch: 8 }, { wch: 90 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(book, indexSheet, "_SHEETS");
  for (const { name, rows } of sheets) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    const headers = Object.keys(rows[0] ?? {});
    sheet["!cols"] = headers.map((header) => ({
      wch: Math.min(60, Math.max(8, header.length + 2, ...rows.slice(0, 50).map((row) => String(row[header] ?? "").length + 1))),
    }));
    if (sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(book, sheet, name);
  }

  const bytes = new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer);
  if (bytes.byteLength > MAX_SCHOOL_WORKBOOK_BYTES) throw new AiReportError("too_large", "One's records for this session do not fit one download.");
  return { bytes, rows: total, students: roll.students.length, sheets: sheets.length };
}

/** Who took the file, for which year, how many rows (`academic_exports`, kind ai_report). */
export async function logAiReport(staff: CurrentStaff, sessionLabel: string, rows: number, scope: string): Promise<void> {
  const { error } = await createAdminClient().from("academic_exports").insert({
    session_label: sessionLabel, kind: "ai_report", scope, row_count: rows, exported_by: staff.id,
  });
  if (error) console.error("[ai-report] could not log the download", error.message);
}
