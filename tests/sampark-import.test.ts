import { describe, expect, it } from "vitest";

import {
  buildIndex,
  countResolutions,
  headerKey,
  idKey,
  readSheet,
  resolveAll,
  resolveIdentity,
} from "@/modules/collection/domain/sampark-import";

/**
 * P10b: reading SamPark's Students workbook, and deciding which child each row
 * is by ids alone. Synthetic children and numbers.
 */

const FIELDS = new Set(["guardian_phone", "date_of_birth", "aadhaar_last4", "address", "transport", "mother_phone"]);

// The headers SamPark's student-export.ts writes, in its order.
const HEADERS = [
  "Student ID", "SR No", "Admission No", "Class", "Section", "Roll No", "Name", "Father's Name",
  "Mother's Name", "Mobile No", "Alternate Mobile", "On WhatsApp", "Date of Birth", "Gender",
  "Category", "Aadhaar", "Aadhaar Last 4", "Jan Aadhaar", "Village", "Address", "Bus Route",
  "House", "Status", "Photo", "Source", "Added On", "Last Updated",
];

const row = (values: Partial<Record<string, string>>) => HEADERS.map((header) => values[header] ?? "");

describe("headerKey()", () => {
  it("folds case, apostrophes and punctuation", () => {
    expect(headerKey("Father's Name")).toBe("fathers name");
    expect(headerKey("  SR No. ")).toBe("sr no");
    expect(headerKey("Aadhaar Last 4")).toBe("aadhaar last 4");
  });
});

describe("readSheet()", () => {
  const reading = readSheet(
    {
      headers: HEADERS,
      rows: [
        row({ "Student ID": "S-1", "SR No": "0101", Name: "Test Child A", Class: "6", Section: "A", "Mobile No": "98123 00001", "Date of Birth": "2014-05-01" }),
        row({}),
        row({ "Student ID": "S-2", "SR No": "0102", Name: "Test Child B", "Bus Route": "Route 3" }),
      ],
    },
    FIELDS,
  );

  it("reads only the columns that map to a field here, and names every other one", () => {
    expect(reading.mapped.map((entry) => entry.fieldKey)).toEqual([
      "guardian_phone", "date_of_birth", "aadhaar_last4", "address", "transport",
    ]);
    expect(reading.ignored).toContain("Alternate Mobile");
    expect(reading.ignored).toContain("Father's Name");
    expect(reading.ignored).not.toContain("SR No");
  });

  it("skips a blank row and numbers rows as Excel does", () => {
    expect(reading.rows.map((entry) => entry.rowNo)).toEqual([2, 4]);
    expect(reading.rows[0]).toMatchObject({ externalId: "S-1", sr: "0101", classLabel: "6 A" });
    expect(reading.rows[0]!.values.guardian_phone).toBe("98123 00001");
  });

  it("knows when nothing in the file can say who a row is", () => {
    expect(readSheet({ headers: ["Name", "Mobile No"], rows: [["A", "9812300001"]] }, FIELDS).noIdentity).toBe(true);
    expect(reading.noIdentity).toBe(false);
  });

  it("ignores a column for a field this app does not have", () => {
    const narrow = readSheet({ headers: ["SR No", "Bus Route"], rows: [["1", "Route 1"]] }, new Set(["guardian_phone"]));
    expect(narrow.mapped).toEqual([]);
    expect(narrow.ignored).toEqual(["Bus Route"]);
  });
});

describe("idKey()", () => {
  it("keeps leading zeros, so 0123 and 123 stay two children", () => {
    expect(idKey("0123")).toBe("0123");
    expect(idKey("123")).not.toBe(idKey("0123"));
  });

  it("ignores case and spacing", () => {
    expect(idKey(" sr 12a ")).toBe("SR12A");
    expect(idKey("   ")).toBeNull();
  });
});

describe("resolveIdentity()", () => {
  const index = buildIndex({
    mappings: [{ externalId: "S-9", studentId: "child-9" }],
    students: [
      { id: "child-1", admissionNo: "0101" },
      { id: "child-2", admissionNo: "0102" },
      { id: "child-3", admissionNo: "0103" },
      { id: "child-4", admissionNo: "0103" },
      { id: "child-9", admissionNo: "0109" },
    ],
  });

  it("matches by SR number", () => {
    expect(resolveIdentity({ externalId: "S-1", sr: "0101", admission: null }, index)).toEqual({ kind: "matched", studentId: "child-1", by: "sr" });
  });

  it("prefers an earlier match, and agrees with the SR when both point at one child", () => {
    expect(resolveIdentity({ externalId: "S-9", sr: "0109", admission: null }, index)).toEqual({ kind: "matched", studentId: "child-9", by: "mapping" });
  });

  it("refuses to choose when the earlier match and the SR disagree", () => {
    expect(resolveIdentity({ externalId: "S-9", sr: "0101", admission: null }, index)).toEqual({
      kind: "ambiguous",
      candidates: ["child-9", "child-1"],
      why: "ids_disagree",
    });
  });

  it("refuses to choose between two children with the same number", () => {
    expect(resolveIdentity({ externalId: null, sr: "0103", admission: null }, index)).toMatchObject({
      kind: "ambiguous",
      candidates: ["child-3", "child-4"],
      why: "several_children",
    });
  });

  it("falls back to the admission number only when there is no SR", () => {
    expect(resolveIdentity({ externalId: null, sr: null, admission: "0102" }, index)).toEqual({ kind: "matched", studentId: "child-2", by: "admission" });
    // An SR that matches nobody is not rescued by the admission number.
    expect(resolveIdentity({ externalId: null, sr: "9999", admission: "0102" }, index)).toEqual({ kind: "unmatched" });
  });

  it("is unmatched with no id at all — a name never decides", () => {
    expect(resolveIdentity({ externalId: null, sr: null, admission: null }, index)).toEqual({ kind: "unmatched" });
  });
});

describe("resolveAll()", () => {
  it("refuses both rows when a file has two for the same child", () => {
    const index = buildIndex({ mappings: [], students: [{ id: "child-1", admissionNo: "0101" }, { id: "child-2", admissionNo: "0102" }] });
    const rows = [
      { rowNo: 2, externalId: "S-1", sr: "0101", admission: null, name: null, classLabel: null, values: {} },
      { rowNo: 3, externalId: "S-1b", sr: "0101", admission: null, name: null, classLabel: null, values: {} },
      { rowNo: 4, externalId: "S-2", sr: "0102", admission: null, name: null, classLabel: null, values: {} },
    ];
    const resolved = resolveAll(rows, index);
    expect(resolved.get(2)).toMatchObject({ kind: "ambiguous", why: "same_child_twice" });
    expect(resolved.get(3)).toMatchObject({ kind: "ambiguous", why: "same_child_twice" });
    expect(resolved.get(4)).toEqual({ kind: "matched", studentId: "child-2", by: "sr" });
    expect(countResolutions(resolved.values())).toEqual({ matched: 1, ambiguous: 2, unmatched: 0 });
  });
});
