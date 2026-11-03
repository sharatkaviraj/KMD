import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  compareShapes,
  formatComparison,
  readWorkbookShape,
  workbookShape,
} from "../scripts/migrate/export-parity.mjs";

/**
 * The export parity check (plan §5.4, critique1 B5): two exports compared by
 * sheet names, headers and row counts — never by cell contents, which carry
 * student names and phone numbers. Synthetic workbooks only.
 */

type Rows = Array<Record<string, string | number>>;

function book(sheets: Array<[string, Rows]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name);
  return workbook;
}

const students: Rows = [
  { "SR no": "TEST-001", "Student name": "Test Child One", "Fees pending": 1200 },
  { "SR no": "TEST-002", "Student name": "Test Child Two", "Fees pending": 0 },
];
const payments: Rows = [{ "Receipt no": "TST-1", Amount: 500 }];

describe("workbookShape", () => {
  it("keeps names, headers and counts, and nothing below the header row", () => {
    const shape = workbookShape(book([["Students", students], ["Payments", payments]]));
    expect(shape).toEqual([
      { name: "Students", headers: ["SR no", "Student name", "Fees pending"], rows: 2 },
      { name: "Payments", headers: ["Receipt no", "Amount"], rows: 1 },
    ]);
    expect(JSON.stringify(shape)).not.toContain("Test Child");
  });

  it("reads an empty sheet as no headers and no rows", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");
    expect(workbookShape(workbook)).toEqual([{ name: "Empty", headers: [], rows: 0 }]);
  });
});

describe("compareShapes", () => {
  const fees = workbookShape(book([["Students", students], ["Payments", payments]]));

  it("calls two identical exports the same", () => {
    const result = compareShapes(fees, workbookShape(book([["Students", students], ["Payments", payments]])));
    expect(result.same).toBe(true);
    expect(formatComparison(result).at(-1)).toBe("SAME shape");
  });

  it("names a missing sheet, an extra sheet and a reordered workbook", () => {
    const one = workbookShape(book([["Payments", payments], ["Defaulters", students]]));
    const result = compareShapes(fees, one);
    expect(result.missingSheets).toEqual(["Students"]);
    expect(result.extraSheets).toEqual(["Defaulters"]);
    expect(result.same).toBe(false);

    const reordered = compareShapes(fees, workbookShape(book([["Payments", payments], ["Students", students]])));
    expect(reordered.sheetOrderDiffers).toBe(true);
    expect(reordered.same).toBe(false);
  });

  it("names a renamed column — the change that would break the vpps-fee-list skill", () => {
    const renamed = students.map(({ "Fees pending": pending, ...rest }) => ({ ...rest, "Fee pending": pending }));
    const result = compareShapes(fees, workbookShape(book([["Students", renamed], ["Payments", payments]])));
    const sheet = result.sheets.find((entry) => entry.name === "Students")!;
    expect(sheet.missingHeaders).toEqual(["Fees pending"]);
    expect(sheet.extraHeaders).toEqual(["Fee pending"]);
    expect(formatComparison(result)).toContain("DIFF  Students: column missing in one: Fees pending");
  });

  it("names reordered columns", () => {
    const reordered = students.map((row) => ({ "Student name": row["Student name"], "SR no": row["SR no"], "Fees pending": row["Fees pending"] }));
    const result = compareShapes(fees, workbookShape(book([["Students", reordered], ["Payments", payments]])));
    expect(result.sheets[0]).toMatchObject({ headerOrderDiffers: true, missingHeaders: [], extraHeaders: [] });
  });

  it("compares row counts unless told not to, and prints counts, not rows", () => {
    const fewer = workbookShape(book([["Students", students.slice(0, 1)], ["Payments", payments]]));
    const result = compareShapes(fees, fewer);
    expect(result.same).toBe(false);
    const lines = formatComparison(result);
    expect(lines).toContain("DIFF  Students: rows fees 2 vs one 1");
    expect(lines.join("\n")).not.toContain("Test Child");
    expect(compareShapes(fees, fewer, { ignoreRowCounts: true }).same).toBe(true);
  });
});

describe("readWorkbookShape", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "export-parity-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads an .xlsx file from disk", () => {
    const file = path.join(dir, "one.xlsx");
    writeFileSync(file, XLSX.write(book([["Students", students]]), { type: "buffer", bookType: "xlsx" }));
    expect(readWorkbookShape(file)).toEqual([
      { name: "Students", headers: ["SR no", "Student name", "Fees pending"], rows: 2 },
    ]);
  });
});
