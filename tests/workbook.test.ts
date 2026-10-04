import { describe, expect, it } from "vitest";

import { roundWorkbook, safeSheetName, studentWorkbook, uniqueSheetName } from "@/modules/collection/domain/workbook";

/** P10d: the rules an exported spreadsheet silently breaks. Synthetic children. */

const fields = [
  { key: "guardian_phone", labelHi: "अभिभावक का फ़ोन", labelEn: "Guardian phone" },
  { key: "blood_group", labelHi: "रक्त समूह", labelEn: "Blood group" },
];

describe("sheet names", () => {
  it("removes what Excel refuses and keeps to 31 characters", () => {
    expect(safeSheetName("Class 6/A [old]?")).toBe("Class 6-A -old--");
    expect(safeSheetName("x".repeat(40))).toHaveLength(31);
    expect(safeSheetName("  ")).toBe("Sheet");
  });

  it("never gives two sheets one name", () => {
    const taken = new Set<string>();
    expect(uniqueSheetName("Class 6", taken)).toBe("Class 6");
    expect(uniqueSheetName("class 6", taken)).toBe("class 6 (2)");
    expect(uniqueSheetName("Class 6", taken)).toBe("Class 6 (3)");
  });
});

describe("studentWorkbook()", () => {
  const sheets = studentWorkbook({
    sessionLabel: "2026-27",
    generatedOn: "2026-10-04",
    fields,
    rows: [
      {
        srNo: "0101",
        samparkId: "S-1",
        name: "परीक्षण बालक",
        classLabel: "6 A",
        values: { guardian_phone: { value: "9812300001", source: "teacher", sourceDetail: null, recordedOn: "2026-10-01" } },
      },
      { srNo: "0102", samparkId: null, name: "Test Child", classLabel: "6 A", values: { blood_group: { value: "0", source: "import", sourceDetail: "sampark", recordedOn: null } } },
    ],
  });
  const [students, sources, about] = sheets;

  it("keeps SR numbers as text with their leading zeros", () => {
    expect(students!.rows[1]![0]).toBe("0101");
    expect(typeof students!.rows[1]![0]).toBe("string");
  });

  it("keeps a blank blank and a zero a zero", () => {
    expect(students!.rows[1]![5]).toBe("");
    expect(students!.rows[2]![5]).toBe("0");
  });

  it("keeps Hindi in the names and the headers", () => {
    expect(students!.rows[1]![2]).toBe("परीक्षण बालक");
    expect(students!.rows[0]![4]).toBe("Guardian phone / अभिभावक का फ़ोन");
  });

  it("puts where each value came from beside it, and counts both sheets", () => {
    expect(sources!.rows).toHaveLength(3);
    expect(sources!.rows[2]).toEqual(["0102", "Test Child", "blood_group", "0", "import", "sampark", ""]);
    expect(about!.rows).toContainEqual(["Students rows", "2"]);
    expect(about!.rows).toContainEqual(["Sources rows", "2"]);
  });
});

describe("roundWorkbook()", () => {
  it("gives each link a sheet with the shown value, the answer and its status", () => {
    const sheets = roundWorkbook({
      title: "Phone numbers",
      sessionLabel: "2026-27",
      generatedOn: "2026-10-04",
      links: [
        {
          label: "Class 6/A",
          fields: [fields[0]!],
          members: [
            { rollNo: "1", srNo: "0101", name: "A", shown: { guardian_phone: "9812300000" }, answers: { guardian_phone: { value: "9812300001", status: "accepted" } } },
            { rollNo: "2", srNo: "0102", name: "B", shown: { guardian_phone: null }, answers: {} },
          ],
        },
        { label: "About", fields: [], members: [] },
      ],
    });
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Class 6-A", "About (2)", "About"]);
    expect(sheets[0]!.rows[1]).toEqual(["1", "0101", "A", "9812300000", "9812300001", "accepted"]);
    expect(sheets[0]!.rows[2]).toEqual(["2", "0102", "B", "", "", "not answered"]);
    expect(sheets[2]!.rows).toContainEqual(["Class 6-A rows", "2"]);
  });
});
