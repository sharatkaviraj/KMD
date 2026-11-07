import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  base64Bytes, EXAMPLE_QUESTIONS, mergeWorkbooks, photoFileName, photoIndexCsv, readmeText, reportBaseName, uniqueSheetName,
} from "@/modules/ai-report/domain/bundle";

/*
 * The AI report is put together in the browser (each part is one response,
 * and a response cannot pass 4.5 MB on Vercel). These are the pure pieces,
 * run with the same `xlsx` the browser loads. Synthetic names only.
 */

const book = (sheets: Record<string, unknown[][]>) => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
};

const photo = { studentId: "00000000-0000-4000-8000-000000000001", admissionNo: "T-101", fullName: "Test Child", classLabel: "Class 5 - Section A", contentType: "image/jpeg" };

describe("photo file names", () => {
  it("reads SR no, name and class, in the photos folder", () => {
    expect(photoFileName(photo, new Set())).toBe("photos/T-101 - Test Child (Class 5 - Section A).jpg");
  });

  it("never gives two children the same file, whatever the case", () => {
    const taken = new Set<string>();
    expect(photoFileName(photo, taken)).toBe("photos/T-101 - Test Child (Class 5 - Section A).jpg");
    expect(photoFileName({ ...photo, fullName: "TEST CHILD" }, taken)).toBe("photos/T-101 - TEST CHILD (Class 5 - Section A) (2).jpg");
    expect(photoFileName(photo, taken)).toBe("photos/T-101 - Test Child (Class 5 - Section A) (3).jpg");
  });

  it("keeps characters a file name cannot hold out, and says when there is no SR no", () => {
    const name = photoFileName({ ...photo, admissionNo: null, fullName: 'A/B: "C"?', classLabel: "" }, new Set());
    expect(name).toBe("photos/No SR - A B C.jpg");
    expect(name).not.toMatch(/[\\:*?"<>|]/);
  });

  it("names the image by its type", () => {
    expect(photoFileName({ ...photo, contentType: "image/png" }, new Set())).toMatch(/\.png$/);
    expect(photoFileName({ ...photo, contentType: "image/webp" }, new Set())).toMatch(/\.webp$/);
  });
});

describe("photos/index.csv", () => {
  it("lists every photograph, then the ones that could not be read, quoting what needs it", () => {
    const csv = photoIndexCsv(
      [{ file: "photos/T-101 - Test Child (Class 5).jpg", photo: { admissionNo: "T-101", fullName: "Test, Child", classLabel: "Class 5", status: "active" } }],
      [{ studentId: photo.studentId, admissionNo: "T-102", fullName: 'Second "Test"', reason: "missing" }],
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("File,SR no,Student,Class,Status,Note");
    expect(lines[1]).toBe('T-101 - Test Child (Class 5).jpg,T-101,"Test, Child",Class 5,active,');
    expect(lines[2]).toBe(',T-102,"Second ""Test""",,,Photograph on record but the file is missing');
  });
});

describe("base64 to bytes", () => {
  it("decodes what the server encoded", () => {
    expect([...base64Bytes(Buffer.from([0, 1, 254, 255]).toString("base64"))]).toEqual([0, 1, 254, 255]);
  });
});

describe("sheet names", () => {
  it("keeps Excel's rules: 31 characters, no [ ] : * ? / \\, unique ignoring case", () => {
    const taken = new Set(["students"]);
    expect(uniqueSheetName("Students", taken)).toBe("Students 2");
    expect(uniqueSheetName("A very long sheet name that goes on and on", taken)).toHaveLength(31);
    expect(uniqueSheetName("A very long sheet name that goes on and on", taken)).toMatch(/ 2$/);
    expect(uniqueSheetName("Fees: [x]/y?", taken)).toBe("Fees x y");
    expect(uniqueSheetName("   ", taken)).toBe("Sheet");
  });
});

describe("one workbook out of two", () => {
  it("puts One's sheets first and every Fees sheet after them under a Fees name", () => {
    const school = book({ _README: [["One"]], Students: [["SR no"], ["T-101"]] });
    const fees = book({ _README: [["Fees"]], Students: [["SR no", "Pending"], ["T-101", 100]], Installments: [["SR no"], ["T-101"]] });
    const merged = XLSX.read(mergeWorkbooks(XLSX, school, fees), { type: "array" });
    expect(merged.SheetNames).toEqual(["_README", "Students", "Fees README", "Fees Students", "Fees Installments"]);
    expect(merged.Sheets["Fees Students"].B2.v).toBe(100);
    expect(merged.Sheets._README.A1.v).toBe("One");
  });

  it("is One's workbook alone when Fees sent nothing", () => {
    const school = book({ _README: [["One"]] });
    expect(XLSX.read(mergeWorkbooks(XLSX, school, null), { type: "array" }).SheetNames).toEqual(["_README"]);
  });
});

describe("READ-ME-FIRST.txt", () => {
  const base = {
    sessionLabel: "TEST-2026-27", madeAt: "2026-11-07 10:00", madeBy: "Synthetic admin",
    workbook: `${reportBaseName("TEST-2026-27")}.xlsx`, fees: { included: true as const },
    photos: { included: 40, withoutPhoto: 3, skipped: 1 },
  };

  it("names the file, the photographs and how to use it", () => {
    const text = readmeText(base);
    expect(text).toContain("VPPS-AI-report-TEST-2026-27.xlsx");
    expect(text).toContain("40 student photographs");
    expect(text).toContain("3 children have no photograph on file");
    expect(text).toContain("1 photographs on record could not be read");
    expect(text).toContain("HOW TO USE IT WITH CHATGPT");
    for (const question of EXAMPLE_QUESTIONS) expect(text).toContain(question);
  });

  it("always says the file is private and what it holds", () => {
    const text = readmeText(base);
    expect(text).toContain("KEEP IT PRIVATE");
    expect(text).toMatch(/Aadhaar/);
    expect(text).toMatch(/health and family notes/);
  });

  it("says plainly what is missing and why", () => {
    const text = readmeText({ ...base, fees: { included: false, reason: "the Fees app could not send them just now" }, photos: { included: false, reason: "the photographs switch was off" } });
    expect(text).toContain("Fees sheets are NOT included: the Fees app could not send them just now");
    expect(text).toContain("Photographs are NOT included: the photographs switch was off");
  });

  it("names the separate Fees file when the two could not be joined", () => {
    expect(readmeText({ ...base, separateFeesFile: "VPPS-AI-report-TEST-2026-27-fees.xlsx" })).toContain("VPPS-AI-report-TEST-2026-27-fees.xlsx - the Fees sheets");
  });

  it("makes a safe base name from any session label", () => {
    expect(reportBaseName("2026-27")).toBe("VPPS-AI-report-2026-27");
    expect(reportBaseName("../2026-27")).toBe("VPPS-AI-report-2026-27");
  });
});
