import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (markup: string) => { window: { document: Document } } };

type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, back() {}, refresh() {} }), usePathname: () => "/academics/progress", useSearchParams: () => new URLSearchParams(), useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => {
  function from(table: string) {
    let rows = fixture.tables[table] ?? [];
    const at = (row: Row, key: string): unknown => key.split(".").reduce<unknown>((value, k) => (value as Row)?.[k], row);
    const result = () => Promise.resolve({ data: rows, error: null });
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter(r => at(r, key) === value); return query; },
      neq: (key: string, value: unknown) => { rows = rows.filter(r => at(r, key) !== value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(at(r, key))); return query; },
      not: (key: string, _op: string, value: unknown) => { rows = rows.filter(r => at(r, key) !== value); return query; },
      order: () => query,
      range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return query; },
      limit: (n: number) => { rows = rows.slice(0, n); return query; },
      returns: result,
      overrideTypes: result,
      then: (...args: Parameters<ReturnType<typeof result>["then"]>) => result().then(...args),
    };
    return query;
  }
  return { from, schema: () => ({ from }) };
} }));

import { classDetail, classMarks, classResults, studentDetail, type Ctx, type Exam } from "@/vx/screens/academics/data";
import { AcadProgressView } from "@/vx/screens/academics/progress-view";
import { LanguageProvider } from "@/platform/i18n/use-language";

const current = "00000000-0000-4000-8000-000000000001";
const historical = "00000000-0000-4000-8000-000000000002";
const moved = "00000000-0000-4000-8000-000000000003";
const exam: Exam = { id: "exam-half", code: "HY", label: "Half yearly", labelHi: null, startsOn: "2026-09-01", endsOn: "2026-09-10", status: "completed" };
const ctx = {
  staff: { id: "synthetic-teacher", role: "teacher", permissions: [] },
  session: "TEST-2026-27", today: "2026-11-02", now: new Date("2026-11-02T10:00:00Z"),
  scope: { everyClass: false, classIds: ["class-6"] }, everyClass: false,
  classes: [{ id: "class-6", label: "Class 6", roll: 1 }], label: () => "Class 6",
} as unknown as Ctx;
const mark = (studentId: string, value: number, classId = "class-6", subject = "MATHS") => ({
  id: `${studentId}-${classId}-${subject}`, student_id: studentId, value, absent: false, exempt: false,
  assessment_subjects: { assessment_id: exam.id, class_id: classId, subject_id: subject, subject_code: subject, max_marks: 100, pass_marks: 33 },
});

beforeEach(() => {
  fixture.tables = {
    assessments: [{ id: exam.id, session_label: ctx.session, code: exam.code, label_en: exam.label, label_hi: null, starts_on: exam.startsOn, ends_on: exam.endsOn, status: "completed" }],
    enrolments: [
      { id: "1", student_id: current, class_id: "class-6", roll_no: "1", session_label: ctx.session, status: "enrolled", starts_on: "2026-10-01" },
      { id: "2", student_id: moved, class_id: "class-7", roll_no: "2", session_label: ctx.session, status: "enrolled" },
    ],
    students: [
      { id: current, full_name: "TEST Current Pupil" },
      { id: historical, full_name: "TEST Historical Pupil" },
      { id: moved, full_name: "TEST Moved Pupil" },
    ],
    marks: [mark(historical, 20), mark(moved, 30), mark(current, 90, "class-7")],
    v_paper_stats: [{ paper_id: "paper-6", assessment_id: exam.id, class_id: "class-6", subject_id: "MATHS", subject_code: "MATHS", max_marks: 100, entered: 2, scored: 2, avg_pct: 25, passed: 0, entry_status: "submitted", sort_order: 1 }],
  };
});

describe("historic exam cohort and current detail permissions", () => {
  it("names the exam cohort, keeps class summaries consistent and retains the detail denial", async () => {
    const marks = await classMarks(ctx, "class-6", exam.id);
    expect(marks.map(m => m.studentId)).toEqual([historical, moved]);
    // This is the reproduced dead end: both historical targets are denied by the unchanged guard.
    expect(await studentDetail(ctx, historical)).toBeNull();
    expect(await studentDetail(ctx, moved)).toBeNull();
    const detail = await classDetail(ctx, "class-6", exam, null);
    expect(detail?.students.find(s => s.studentId === historical)).toMatchObject({ name: "TEST Historical Pupil", avg: 20, canOpen: false, historical: true });
    expect(detail?.students.find(s => s.studentId === moved)).toMatchObject({ name: "TEST Moved Pupil", avg: 30, canOpen: false });
    // A current pupil's marks in another class must not become this class's result.
    expect(detail?.students.find(s => s.studentId === current)).toMatchObject({ avg: null, canOpen: true });
    expect(detail).toMatchObject({ roll: 1, average: 25, pass: 0 });
    expect((await classResults(ctx, exam, null)).classes[0]).toMatchObject({ avg: 25, pass: 0 });
  });

  it.each(["en", "hi"] as const)("shows historical names without dead-end links in %s", async language => {
    const detail = (await classDetail(ctx, "class-6", exam, null))!;
    const marks = await classMarks(ctx, "class-6", exam.id);
    const tab = { code: exam.code, label: exam.label };
    const html = renderToStaticMarkup(<LanguageProvider language={language}><AcadProgressView
      language={language} today={ctx.today} session={ctx.session} exams={[tab]} exam={tab} previous={null}
      entered={100} attentionCount={0} mayManage={false} mayFollow={false} notesHref={null}
      view="class" detail={detail} marks={marks} result={null}
      nav={{ prev: ctx.classes[0], next: ctx.classes[0], pos: 1, total: 1 }}
      people={{ classTeacher: null, bySubject: {}, locked: false, notes: { total: 0, followUp: 0 } }}
    /></LanguageProvider>);
    const doc = new JSDOM(html).window.document;
    expect(doc.body.textContent).toContain("TEST Historical Pupil");
    expect(doc.body.textContent).toContain("TEST Moved Pupil");
    expect([...doc.querySelectorAll("a")].some(a => a.href.includes(historical) || a.href.includes(moved))).toBe(false);
    expect(doc.body.textContent).toContain(language === "hi" ? "ऐतिहासिक परिणाम" : "Historical result");
  });

  it("denies an out-of-scope class before loading a cohort", async () => {
    expect(await classDetail(ctx, "class-7", exam, null)).toBeNull();
    expect(await classMarks(ctx, "class-7", exam.id)).toEqual([]);
  });

  it("preserves equal pupil weighting and counts an absent paper as zero", async () => {
    fixture.tables.marks = [
      mark(historical, 90), mark(historical, 90, "class-6", "ENG"), mark(historical, 90, "class-6", "SST"),
      mark(moved, 50), { ...mark(moved, 0, "class-6", "ENG"), value: null, absent: true },
    ];
    // Scored-paper weighting would give 80. The established pupil rule gives
    // mean(90, (50 + 0) / 2) = 57.5, rounded to 58.
    fixture.tables.v_paper_stats = [
      { ...fixture.tables.v_paper_stats[0], avg_pct: 80, scored: 4 },
    ];
    const detail = (await classDetail(ctx, "class-6", exam, null))!;
    expect(detail.average).toBe(58);
    expect(detail.students.find(s => s.studentId === moved)).toMatchObject({ avg: 25, absent: 1 });
  });

  it("keeps 394 scored pupil/subject entries, rather than treating them as distinct papers", async () => {
    fixture.tables.marks = Array.from({ length: 197 }, (_, i) => [mark(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, 20), mark(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, 60, "class-6", "ENG")]).flat();
    expect(await classMarks(ctx, "class-6", exam.id)).toHaveLength(394);
  });
});
