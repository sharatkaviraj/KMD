import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Assessment, AssessmentSubject, Mark } from "@/modules/assessments/domain/assessments";
import { withInsights } from "@/modules/assessments/domain/card-insight";
import { buildReportCard, rankClassCards } from "@/modules/assessments/domain/report-card";
import { ruleForClass } from "@/modules/assessments/domain/result-rules";
import { renderReportCardsPdf, type CardForPdf } from "@/vx/screens/exams/report-card-pdf";

import { fontsNotEmbedded } from "./support/pdf-fonts";

/*
 * Report card v2 (D-612) is one sheet of A4 per child, whatever the class:
 * nine subjects and Robotics apart, the subject picture, the effort panel and
 * a two-line remark all fit. Every child here is made up.
 * REPORT_PDF_OUT=dir writes the PDFs out to look at.
 */

const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

const EXAMS = [
  { id: "fa1", code: "FA1", en: "Test I", hi: "टेस्ट I", max: 20, starts: "2026-07-20" },
  { id: "fa2", code: "FA2", en: "Test II", hi: "टेस्ट II", max: 20, starts: "2026-08-20" },
  { id: "sa1", code: "SA1", en: "Half Yearly", hi: "अर्धवार्षिक", max: 60, starts: "2026-09-21" },
];

const assessment = (e: (typeof EXAMS)[number]): Assessment => ({
  id: e.id,
  code: e.code,
  sessionLabel: "TEST-2026-27",
  term: "Term 1",
  labelHi: e.hi,
  labelEn: e.en,
  kind: e.code.startsWith("FA") ? "formative" : "summative",
  startsOn: e.starts,
  endsOn: null,
  weight: 1,
  status: "open",
  lockedAt: null,
  lockedByName: null,
});

function classCards(classLabel: string, subjects: string[], children: number, seed: number) {
  const papers: AssessmentSubject[] = subjects.flatMap((code, i) =>
    EXAMS.map((e) => ({
      id: `${code}-${e.id}`,
      assessmentId: e.id,
      classId: "c",
      classLabel,
      subjectId: code,
      subjectCode: code,
      maxMarks: e.max,
      passMarks: null,
      sortOrder: i,
      markStep: 0.5,
      allowExempt: false,
      entryStatus: "submitted",
      entryRevision: 1,
      submittedAt: null,
    })),
  );
  // A fixed pseudo-random spread, so the picture has some shape.
  let s = seed;
  const next = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const rule = ruleForClass(classLabel);
  const cards = Array.from({ length: children }, (_, k) => {
    const id = `st${k + 1}`;
    const marks = new Map<string, Mark>();
    for (const p of papers) {
      const exam = EXAMS.find((e) => e.id === p.assessmentId)!;
      const base = 0.45 + 0.4 * next() + (k === 0 && exam.code === "SA1" ? 0.12 : 0);
      const value = Math.min(exam.max, Math.round(base * exam.max * 2) / 2);
      marks.set(`${p.id}|${id}`, { studentId: id, value, absent: false, exempt: false, enteredByName: null, enteredAt: null });
    }
    return buildReportCard({
      sessionLabel: "TEST-2026-27",
      term: "Term 1",
      student: { id, fullName: `Test Child ${k + 1}`, admissionNo: `TEST-${100 + k}`, rollNo: String(k + 1), classLabel, fatherName: "Test Parent" },
      assessments: EXAMS.map(assessment),
      papers,
      marks,
      attendance: { present: 88, counted: 94, percent: 93.6 },
      rule,
      generatedAt: "2026-11-14T10:00:00Z",
    });
  });
  return withInsights(rankClassCards(cards));
}

const entry = (card: CardForPdf["card"], issued: boolean): CardForPdf => ({
  card,
  grace: {},
  remark: "Works hard in class and helps others. Reading aloud has improved a great deal this term.\nकक्षा में मेहनत करते हैं और दूसरों की मदद करते हैं। इस सत्र में पढ़ने में बहुत सुधार हुआ है।",
  issued,
  photo: null,
  motherName: "Test Mother",
  dateOfBirth: "2018-05-14",
  classTeacher: "Test Teacher",
});

describe("report card v2 is one sheet of A4 per child", () => {
  it.each([
    ["class-3-nine-subjects", "Class 3", ["Hindi", "English", "Maths", "EVS", "Sanskrit", "Computer", "GK", "Drawing", "Robotics"], true],
    ["class-9-division", "Class 9", ["Hindi", "English", "Maths", "Science", "SST", "Sanskrit", "Computer"], false],
    ["nursery-word-grades", "Nursery", ["Hindi", "English", "Maths", "Drawing"], false],
    // More than any real class has (8): eleven subjects and Robotics apart.
    ["class-8-eleven-subjects", "Class 8", ["Hindi", "English", "Maths", "Science", "SST", "Sanskrit", "Computer", "GK", "Drawing", "Sports", "Self Study", "Robotics"], true],
  ] as const)("%s", async (name, classLabel, subjects, issued) => {
    const cards = classCards(classLabel, [...subjects], 12, name.length * 17);
    const pdf = await renderReportCardsPdf({
      cards: [entry(cards[0], issued), entry(cards[5], false)],
      title: { en: "Half Yearly · Report card", hi: "अर्धवार्षिक · प्रगति पत्र" },
      coordinator: "Test Coordinator",
    });
    const out = process.env.REPORT_PDF_OUT;
    if (out) writeFileSync(`${out}/${name}.pdf`, pdf);
    expect(pages(pdf)).toBe(2);
    expect(cards[0].insight?.classSize).toBe(12);
    // D-640: the card a parent is sent carries every font it uses.
    expect(fontsNotEmbedded(pdf)).toEqual([]);
  }, 60_000);
});
