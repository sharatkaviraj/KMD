import { describe, expect, it } from "vitest";
import { toCsv as studentsCsv } from "@/vx/screens/admin/logic";
import { marksCsv, toCsv as assessmentCsv } from "@/modules/assessments/domain/report-card";

describe("school CSV exports preserve untrusted text instead of spreadsheet formulas", () => {
  for (const text of ['=HYPERLINK("https://example.invalid","QA")', "+SUM(1,2)", "-1+2", "@SUM(A1)", "\t=1+1", "\r=1+1", "  =1+1"]) {
    it(`student text ${JSON.stringify(text)} is inert`, () => {
      expect(studentsCsv(["Name"], [[text]])).toContain(`"'${text.replaceAll('"', '""')}"`);
    });
    it(`assessment text ${JSON.stringify(text)} is inert`, () => {
      const csv = assessmentCsv([[text]]);
      expect(csv.includes(`'${text.replaceAll('"', '""')}`)).toBe(true);
    });
  }
  it("keeps real numeric zero and negative values numeric", () => {
    expect(studentsCsv(["Amount"], [[-1], [0], [12.5]])).toBe('"Amount"\r\n"-1"\r\n"0"\r\n"12.5"');
    expect(assessmentCsv([[-1, 0, 12.5]])).toBe("\uFEFF-1,0,12.5");
  });
  it("retains Hindi, commas, quotes, line breaks and blank cells", () => {
    expect(studentsCsv(["Name"], [['QA हिन्दी, "child"\nrow', null]])).toContain('"QA हिन्दी, ""child""\nrow",""');
    expect(assessmentCsv([['QA हिन्दी, "child"\nrow', null]])).toBe('\uFEFF"QA हिन्दी, ""child""\nrow",');
  });
  it("marks export neutralizes pupil text while preserving status and zero marks", () => {
    const csv = marksCsv([{ rollNo: "1", studentName: "=1+1", classLabel: "QA", subjectCode: "EN", assessmentCode: "OPS", value: 0, absent: false, exempt: false, maxMarks: 100 }]);
    expect(csv).toContain("1,'=1+1,QA,EN,OPS,0,100,Entered");
  });
});
