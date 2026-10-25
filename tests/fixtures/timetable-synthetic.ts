import { parseTimetable } from "@/modules/timetable/domain/parse-timetable";
import { buildContext, resolveImport } from "@/modules/timetable/domain/resolve-import";

// Invented from scratch: 2 days, 3 classes, 8 periods, 6 teachers. No real sheet.
// Includes parallel electives, co-teaching, combined sections and free periods.
export const SYNTHETIC_TIMETABLE = `Monday
Class,P1,P2,P3,P4,P5,P6,P7,P8
QA Blue,Numeracy (QA Alpha),Science / Maths (QA Alpha / QA Beta),Studio (QA Gamma / QA Delta),Community Studies (QA Epsilon),Free,Reading (QA Zeta),Free,Free
QA Green,Reading (QA Beta),Free,Studio (QA Gamma / QA Delta),Community Studies (QA Epsilon),Inquiry (QA Alpha),Free,Free,Free
QA Gold,Inquiry (QA Gamma),Reading (QA Delta),Free,Free,Free,Free,Free,Free
Tuesday
Class,P1,P2,P3,P4,P5,P6,P7,P8
QA Blue,Reading (QA Beta),Inquiry (QA Gamma),Studio (QA Gamma / QA Delta),Community Studies (QA Epsilon),Free,Numeracy (QA Alpha),Free,Free
QA Green,Numeracy (QA Alpha),Science / Maths (QA Alpha / QA Beta),Studio (QA Gamma / QA Delta),Community Studies (QA Epsilon),Reading (QA Zeta),Free,Free,Free
QA Gold,Inquiry (QA Gamma),Reading (QA Delta),Free,Free,Free,Free,Free,Free`;

export const CLASS_LABELS = ["QA Blue", "QA Green", "QA Gold"];
export const TEACHERS = ["QA Alpha", "QA Beta", "QA Gamma", "QA Delta", "QA Epsilon", "QA Zeta"];
export const SUBJECTS = ["Numeracy", "Science", "Maths", "Studio", "Community Studies", "Reading", "Inquiry"];

// These masters are literal fixture data, not inferred from parser output.
export function syntheticMasters() {
  return {
    classAliases: CLASS_LABELS.map((label) => ({ timetableLabel: label, classId: label })),
    teachers: TEACHERS.map((name) => ({ shortName: name, id: name })),
    subjects: SUBJECTS.map((code) => ({ code, id: code })),
  };
}

export function syntheticTimetable() {
  const parsed = parseTimetable(SYNTHETIC_TIMETABLE);
  const report = resolveImport(parsed, buildContext(syntheticMasters()));
  return { parsed, report, slots: report.slots };
}
