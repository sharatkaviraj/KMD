import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { paperOrder, paperTitle, taskPaper, type TaskPaper } from "@/modules/teacher-tasks/domain/paper-words";

/*
 * "My tasks" on a 360 px phone (polish thread, 7 Nov 2026, D-527).
 *
 * With First formative and Half yearly both open, a teacher's list read
 * "अंक · Class 1 · EVS" twice: no exam name to tell the two apart, the class
 * and subject as English codes on a Hindi screen, and the papers in the order
 * of their database ids.
 */

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

const paper = (classLabel: string, subjectCode: string, exam: string, examStartsOn: string | null): TaskPaper => ({
  classLabel,
  subjectCode,
  exam: { en: exam, hi: exam },
  examStartsOn,
});

describe("a marks paper on My tasks says which exam it is (D-527)", () => {
  it("reads the exam embedded in the paper, as an object or as a list", () => {
    const exam = { label_en: "Half yearly", label_hi: "अर्धवार्षिक परीक्षा", starts_on: "2026-09-23" };
    const expected = { classLabel: "Class 1", subjectCode: "EVS", exam: { en: "Half yearly", hi: "अर्धवार्षिक परीक्षा" }, examStartsOn: "2026-09-23" };
    expect(taskPaper({ class_label: "Class 1", subject_code: "EVS", assessments: exam })).toEqual(expected);
    expect(taskPaper({ class_label: "Class 1", subject_code: "EVS", assessments: [exam] })).toEqual(expected);
  });

  it("says the English name in Hindi when no Hindi was typed, and nothing when there is no exam", () => {
    expect(taskPaper({ class_label: "Class 1", subject_code: "EVS", assessments: { label_en: "QA", label_hi: " ", starts_on: null } }).exam).toEqual({ en: "QA", hi: "QA" });
    expect(taskPaper({ class_label: "Class 1", subject_code: "EVS", assessments: null }).exam).toEqual({ en: "" });
  });

  it("names the class and subject as the marks cards do, not as codes", () => {
    expect(paperTitle(paper("Class 1", "EVS", "Half yearly", null))).toEqual({ en: "Class 1 · EVS", hi: "कक्षा 1 · पर्यावरण" });
    expect(paperTitle(paper("Class 7", "MATHS", "Half yearly", null))).toEqual({ en: "Class 7 · Maths", hi: "कक्षा 7 · गणित" });
    expect(paperTitle(paper("Class 3", "ELGA", "Half yearly", null))).toEqual({ en: "Class 3 · ELGA", hi: "कक्षा 3 · अंग्रेज़ी भाषा" });
  });

  it("lists the oldest exam first, then classes in school order, then subjects", () => {
    const list = [
      paper("Class 10", "Science", "Half yearly", "2026-09-23"),
      paper("Class 2", "Science", "Half yearly", "2026-09-23"),
      paper("Class 2", "English", "Half yearly", "2026-09-23"),
      paper("Nursery", "Hindi", "Half yearly", "2026-09-23"),
      paper("Class 1", "EVS", "QA", null),
      paper("Class 1", "EVS", "First formative", "2026-08-13"),
    ];
    expect([...list].sort(paperOrder).map((x) => `${x.exam.en} | ${x.classLabel} | ${x.subjectCode}`)).toEqual([
      "First formative | Class 1 | EVS",
      "Half yearly | Nursery | Hindi",
      "Half yearly | Class 2 | English",
      "Half yearly | Class 2 | Science",
      "Half yearly | Class 10 | Science",
      "QA | Class 1 | EVS",
    ]);
  });

  it("is what the list reads and shows", () => {
    const repo = read("src/modules/teacher-tasks/data/repo.ts");
    expect(repo).toContain("assessments!inner(session_label,status,label_en,label_hi,starts_on)");
    expect(repo).toContain(".sort((a,b)=>paperOrder(a.paper,b.paper))");
    expect(repo).toContain("dueDate:dueOn.get(p.assessment_id)??null");
    // exam_plans points at assessments twice (its exam and `copied_from`), so its
    // due days are read by id: an embed is ambiguous and would fail on every load.
    expect(repo).toContain('db.from("exam_plans").select("assessment_id,marks_due_on").in("assessment_id",chunk)');
    expect(repo).not.toMatch(/from\("exam_plans"\)\.select\("[^"]*assessments/);
    const ui = read("src/modules/teacher-tasks/ui/teacher-work.tsx");
    expect(ui).toContain("lead(paperTitle(t.paper), language)");
    expect(ui).toContain("[office ? t.teacherName : null, examOf(t),");
  });
});

describe("a paper's class is found by id and named from the class list (D-528)", () => {
  // Papers keep the label they were made with ("11 Arts"); the class list says
  // "Class 11 Arts". Matching by label left every Class 11 and 12 card on My
  // subjects reading "No paper yet" beside a paper that was there.
  it("My subjects finds a card's paper by class id, not by label", () => {
    const cls = read("src/vx/screens/teach/ui/class.tsx");
    expect(cls).toContain("links.find((l) => l.classId === s.classId && ");
    expect(cls).not.toContain("l.classLabel === s.classLabel");
  });

  it("a marks link carries its class id and the class list's name", () => {
    const data = read("src/vx/screens/teach/data.ts");
    expect(data).toContain("classId: p.classId,");
    expect(data).toContain('classLabel: labels.get(p.classId) ?? (p.classLabel || "—"),');
  });

  it("My tasks names a paper's class from the class list too", () => {
    const repo = read("src/modules/teacher-tasks/data/repo.ts");
    expect(repo).toContain("classLabelMap(session).catch(()=>new Map<string,string>())");
    expect(repo).toContain("taskPaper({...p,class_label:labels.get(p.class_id)??p.class_label})");
    expect(paperTitle(paper("Class 11 Arts", "Hindi", "Half yearly", null))).toEqual({ en: "Class 11 Arts · Hindi", hi: "कक्षा 11 Arts · हिंदी" });
  });
});
