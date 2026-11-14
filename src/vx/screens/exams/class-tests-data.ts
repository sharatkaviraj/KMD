import "server-only";

import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { tellApart } from "@/vx/screens/teach/domain/teach";

import { classesFor, studentsByIds, type PaperRow } from "./data";
import type { Cell } from "./domain/entry";
import type { ClassTest, CountedTest, TestMark } from "./domain/class-tests";
import { rollOrder, type SheetPaper, type SheetStudent } from "./sheet-data";

/*
 * Reads for class tests (D-609). Callers have checked who may see what; the
 * rows here are the test's own, never an exam's.
 */

const admin = () => createAdminClient();

const COLUMNS = "id, session_label, class_id, class_label, subject_id, subject_code, title, held_on, max_marks, mark_step, counts_in, status, revision, created_by, removed_at";

type TestRow = {
  id: string;
  session_label: string;
  class_id: string;
  class_label: string;
  subject_id: string;
  subject_code: string;
  title: string;
  held_on: string;
  max_marks: number | string;
  mark_step: number | string;
  counts_in: string | null;
  status: "open" | "finished";
  revision: number;
  created_by: string;
  removed_at: string | null;
};

type MarkRow = { class_test_id: string; student_id: string; value: number | string | null; absent: boolean };

function toTest(row: TestRow): ClassTest {
  return {
    id: row.id,
    sessionLabel: row.session_label,
    classId: row.class_id,
    classLabel: row.class_label,
    subjectId: row.subject_id,
    subjectCode: row.subject_code,
    title: row.title,
    heldOn: row.held_on,
    maxMarks: Number(row.max_marks),
    markStep: Number(row.mark_step),
    countsIn: row.counts_in,
    status: row.status,
    revision: row.revision,
    createdBy: row.created_by,
  };
}

export async function classTestById(id: string): Promise<ClassTest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await admin().from("class_tests").select(COLUMNS).eq("id", id).is("removed_at", null).maybeSingle<TestRow>();
  if (error) throw new Error(`Could not read the test: ${error.message}`);
  return data ? toTest(data) : null;
}

/**
 * A reader's recent tests, newest first: the ones she made and the ones on
 * her own class-subjects (`pairs`, "classId|subjectId"); every test for the
 * exam office (`pairs` null).
 */
export async function recentClassTests(sessionLabel: string, input: { staffId: string; pairs: Set<string> | null; limit?: number }): Promise<ClassTest[]> {
  const { data, error } = await admin()
    .from("class_tests")
    .select(COLUMNS)
    .eq("session_label", sessionLabel)
    .is("removed_at", null)
    .order("held_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(400)
    .returns<TestRow[]>();
  if (error) throw new Error(`Could not read the class tests: ${error.message}`);
  const mine = (data ?? []).filter((r) => input.pairs === null || r.created_by === input.staffId || input.pairs.has(`${r.class_id}|${r.subject_id}`));
  return mine.slice(0, input.limit ?? 12).map(toTest);
}

async function marksOfTests(testIds: string[]): Promise<MarkRow[]> {
  if (testIds.length === 0) return [];
  const res = await fetchInChunks<MarkRow>(testIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin().from("class_test_marks").select("class_test_id, student_id, value, absent").in("class_test_id", chunk),
  );
  if (res.error) throw new Error("Could not read the test marks.");
  return res.data;
}

async function rosterOf(test: Pick<ClassTest, "sessionLabel" | "classId" | "heldOn">): Promise<string[]> {
  const { data, error } = await admin().rpc("attendance_roster", { p_session: test.sessionLabel, p_class: test.classId, p_day: test.heldOn });
  if (error) throw new Error(`Could not read the class list: ${error.message}`);
  return ((data ?? []) as string[]).filter(Boolean);
}

export type TestProgress = { entered: number; total: number };

/** How many children of each test's class have a mark or an absence. */
export async function progressOf(tests: ClassTest[]): Promise<Map<string, TestProgress>> {
  const [rosters, marks] = await Promise.all([Promise.all(tests.map((t) => rosterOf(t).catch(() => [] as string[]))), marksOfTests(tests.map((t) => t.id))]);
  const out = new Map<string, TestProgress>();
  tests.forEach((t, i) => {
    const on = new Set(rosters[i]);
    const entered = marks.filter((m) => m.class_test_id === t.id && on.has(m.student_id) && (m.value !== null || m.absent)).length;
    out.set(t.id, { entered, total: on.size });
  });
  return out;
}

const cellOf = (row: MarkRow | undefined): Cell =>
  !row ? { state: "blank", value: null } : row.absent ? { state: "absent", value: null } : row.value === null ? { state: "blank", value: null } : { state: "value", value: Number(row.value) };

/** A test as the shared marks sheet reads a paper: its class on the test's day, in roll order. */
export async function loadClassTestSheet(test: ClassTest): Promise<{ paper: SheetPaper; students: SheetStudent[]; saved: Record<string, Cell> }> {
  const ids = await rosterOf(test);
  const [names, rolls, marks] = await Promise.all([
    studentsByIds(ids),
    ids.length
      ? admin().from("enrolments").select("student_id, roll_no").eq("session_label", test.sessionLabel).eq("class_id", test.classId).returns<{ student_id: string; roll_no: string | null }[]>()
      : Promise.resolve({ data: [] as { student_id: string; roll_no: string | null }[] }),
    marksOfTests([test.id]),
  ]);
  const rollOf = new Map((rolls.data ?? []).map((r) => [r.student_id, r.roll_no]));
  const students: SheetStudent[] = ids
    .map((id) => ({ id, name: names.get(id)?.name ?? "—", roll: rollOf.get(id) ?? null, prev: null, prevPct: null }))
    .sort(rollOrder);
  const apart = tellApart(students.map((s) => ({ id: s.id, name: s.name, admissionNo: names.get(s.id)?.admissionNo ?? null, fatherName: names.get(s.id)?.fatherName ?? null })));
  for (const s of students) s.hint = apart.get(s.id) ?? null;
  const byStudent = new Map(marks.map((m) => [m.student_id, m]));
  const saved: Record<string, Cell> = {};
  for (const s of students) saved[s.id] = cellOf(byStudent.get(s.id));
  return {
    paper: {
      id: test.id,
      examId: test.countsIn ?? "",
      examLabel: { en: test.title, hi: test.title },
      classId: test.classId,
      classLabel: test.classLabel,
      subjectCode: test.subjectCode,
      subjectId: test.subjectId,
      maxMarks: test.maxMarks,
      passMarks: null,
      markStep: test.markStep,
      allowExempt: false,
      entryStatus: test.status === "finished" ? "submitted" : "open",
      entryRevision: test.revision,
      submittedAt: null,
      submittedBy: null,
      examOpen: true,
      locked: false,
      dueLabel: null,
    },
    students,
    saved,
  };
}

/** The class tests that count in this exam paper, with their marks, oldest first. */
export async function countedTestsFor(paper: Pick<PaperRow, "assessment_id" | "class_id" | "subject_id">): Promise<(ClassTest & { counted: CountedTest })[]> {
  const { data, error } = await admin()
    .from("class_tests")
    .select(COLUMNS)
    .eq("counts_in", paper.assessment_id)
    .eq("class_id", paper.class_id)
    .eq("subject_id", paper.subject_id)
    .is("removed_at", null)
    .order("held_on")
    .returns<TestRow[]>();
  if (error) throw new Error(`Could not read the class tests: ${error.message}`);
  const tests = (data ?? []).map(toTest);
  const marks = await marksOfTests(tests.map((t) => t.id));
  return tests.map((t) => {
    const own = new Map<string, TestMark>();
    for (const m of marks) if (m.class_test_id === t.id) own.set(m.student_id, { value: m.value === null ? null : Number(m.value), absent: m.absent });
    return { ...t, counted: { id: t.id, maxMarks: t.maxMarks, marks: own } };
  });
}

/**
 * The class-subjects a person may make a test for: her timetable's, in the
 * school's class order; every class-subject on the timetable for the exam
 * office (`staffId` null).
 */
export async function testOptions(sessionLabel: string, staffId: string | null): Promise<{ classId: string; classLabel: string; classSort: number; subjectId: string; subjectCode: string }[]> {
  const db = admin();
  let query = db.from("teaching_assignments").select("class_id, subject_id").eq("session_label", sessionLabel);
  if (staffId) query = query.eq("staff_profile_id", staffId);
  const [{ data: rows, error }, classes, { data: subjects }] = await Promise.all([
    query.returns<{ class_id: string; subject_id: string }[]>(),
    classesFor(sessionLabel),
    db.from("subjects").select("id, code, sort_order").returns<{ id: string; code: string; sort_order: number | null }[]>(),
  ]);
  if (error) throw new Error(`Could not read who teaches what: ${error.message}`);
  const klass = new Map(classes.map((c) => [c.id, c]));
  const subject = new Map((subjects ?? []).map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: { classId: string; classLabel: string; classSort: number; subjectId: string; subjectCode: string; subjectSort: number }[] = [];
  for (const r of rows ?? []) {
    const k = `${r.class_id}|${r.subject_id}`;
    const c = klass.get(r.class_id);
    const s = subject.get(r.subject_id);
    if (seen.has(k) || !c || !s) continue;
    seen.add(k);
    out.push({ classId: c.id, classLabel: c.label, classSort: c.sort, subjectId: s.id, subjectCode: s.code, subjectSort: s.sort_order ?? 0 });
  }
  return out
    .sort((a, b) => a.classSort - b.classSort || a.subjectSort - b.subjectSort || a.subjectCode.localeCompare(b.subjectCode))
    .map((o) => ({ classId: o.classId, classLabel: o.classLabel, classSort: o.classSort, subjectId: o.subjectId, subjectCode: o.subjectCode }));
}
