import { expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { zipSync } from "fflate";
vi.mock("server-only", () => ({}));
import { inspectReturnSpecimen, MAX_RETURN_FILE_BYTES, parseReturnFile, renderReturnFile } from "@/modules/government-records/data/files";
import { manualReferenceAdapter, type GovernmentAdapter, type ReturnStudent } from "@/modules/government-records/domain/exchange";
const reference = manualReferenceAdapter("psp", "Student records", "TEST-2026-27", "00042");
const adapter: GovernmentAdapter = { ...reference, mode: "verified_upload", sheetName: "Students", specimenSha256: "a".repeat(64), verifiedOn: "2026-11-01", sourceReference: "Synthetic verified flat format for isolated parser tests" };
const row: ReturnStudent = { studentId: "00000000-0000-4000-8000-000000000011", studentName: "काल्पनिक विद्यार्थी", admissionNo: "00017", classLabel: "8 A", classId: "class-8", sessionLabel: "TEST-2026-27", schoolCode: "00042", externalId: "", registrationStatus: "", sourceRevision: "317", externalRevision: 0, identityVerified: true };
const workbook = (mutate?: (book: XLSX.WorkBook) => void) => { const result = renderReturnFile([row], adapter); const book = XLSX.read(result.bytes, { type: "array" }); mutate?.(book); return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true })); };
it("XLSX keeps identifiers as text and round-trips Hindi and leading zeros", () => {
  const result = renderReturnFile([row], adapter), book = XLSX.read(result.bytes, { type: "array" });
  expect(book.Sheets.Students.B2.t).toBe("s");
  expect(book.Sheets.Students.B2.v).toBe("00017");
  expect(parseReturnFile(result.bytes, "result.xlsx", adapter)[0]["Student name"]).toBe(row.studentName);
  expect(parseReturnFile(result.bytes, "result.xlsx", adapter)[0]["Admission / SR number"]).toBe("00017");
});
it("manual output has a visible instruction sheet and a distinct filename", () => {
  const result = renderReturnFile([row], reference), book = XLSX.read(result.bytes, { type: "array" });
  expect(result.fileName).toContain("manual-reference");
  expect(book.Sheets["Read first"].A1.v).toContain("NOT AN OFFICIAL UPLOAD");
});
it("refuses formula workbooks and numeric identifiers", () => {
  expect(() => parseReturnFile(workbook(book => { book.Sheets.Students.B2 = { t: "n", v: 17, f: "8+9" }; }), "result.xlsx", adapter)).toThrow("Formula");
  expect(() => parseReturnFile(workbook(book => { book.Sheets.Students.B2 = { t: "n", v: 17 }; }), "result.xlsx", adapter)).toThrow("text");
});
it("refuses macro filenames, extra worksheets and oversized archives", () => {
  expect(() => parseReturnFile(workbook(), "result.xlsm", adapter)).toThrow("file type");
  expect(() => parseReturnFile(workbook(book => XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["hidden"]]), "Other")), "result.xlsx", adapter)).toThrow("one flat");
  const expanded = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(11 * 1024 * 1024) });
  expect(() => parseReturnFile(expanded, "large.xlsx", adapter)).toThrow("Oversized");
  expect(() => parseReturnFile(new Uint8Array(MAX_RETURN_FILE_BYTES + 1), "large.xlsx", adapter)).toThrow("750 KB");
});
it("can inspect a blank current specimen before mapping it", () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([adapter.columns.map(c => c.header)]), "Students");
  const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
  expect(inspectReturnSpecimen(bytes, "blank.xlsx", "xlsx", "Students")).toEqual(adapter.columns.map(c => c.header));
});
it("CSV uses UTF-8 without changing text identifiers", () => {
  const csv = { ...adapter, format: "csv" as const }, result = renderReturnFile([row], csv);
  const parsed = parseReturnFile(result.bytes, "rows.csv", csv);
  expect(parsed[0]["Admission / SR number"]).toBe("00017");
  expect(parsed[0]["Student name"]).toBe(row.studentName);
});
