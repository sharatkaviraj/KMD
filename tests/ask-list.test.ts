import { describe, expect, it } from "vitest";

import {
  TEMPLATE_HEADERS,
  hasIdentityColumn,
  indexByAdmissionNo,
  matchAskList,
  normaliseAdmissionNo,
  notesFrom,
  parseCsv,
  templateCsv,
  type MatchableStudent,
} from "@/modules/collection/domain/ask-list";

/**
 * A list of specific children the office typed out.
 *
 * **Every test here is about what did not match.** A list of thirty-five that
 * quietly becomes a round of thirty-one is the worst thing this feature can
 * do: the office believes it asked about everyone, and the four it dropped are
 * the four whose rows were already wrong.
 */

const student = (over: Partial<MatchableStudent> = {}): MatchableStudent => ({
  id: "s1",
  fullName: "Test Child One",
  admissionNo: "TEST-CL6-001",
  classId: "c6",
  isEnrolled: true,
  ...over,
});

const roll = [
  student(),
  student({ id: "s2", fullName: "Test Child Two", admissionNo: "TEST-CL6-002" }),
  student({
    id: "s3",
    fullName: "Test Child Three",
    admissionNo: "TEST-CL7-001",
    classId: "c7",
  }),
  student({
    id: "s4",
    fullName: "Test Child Gone",
    admissionNo: "TEST-CL6-009",
    isEnrolled: false,
  }),
];

const sheet = (body: string) =>
  parseCsv(
    `${TEMPLATE_HEADERS.admissionNo},${TEMPLATE_HEADERS.name},${TEMPLATE_HEADERS.note}\n${body}`,
  );

describe("reading the file Excel writes", () => {
  it("reads a plain sheet", () => {
    const table = parseCsv("SR No,Note\nTEST-1,ring the uncle\n");

    expect(table.headers).toEqual(["SR No", "Note"]);
    expect(table.rows).toEqual([{ "SR No": "TEST-1", Note: "ring the uncle" }]);
  });

  it("strips the byte order mark Excel puts at the front", () => {
    // Without this the first header is `﻿SR No`, so the column the office
    // can see is one the matcher cannot — and every row reads as unidentified.
    const table = parseCsv("﻿SR No,Note\nTEST-1,x\n");

    expect(table.headers[0]).toBe("SR No");
    expect(hasIdentityColumn(table.headers)).toBe(true);
  });

  it("reads a comma and a newline inside a quoted note", () => {
    const table = parseCsv('SR No,Note\nTEST-1,"number is wrong, ring\nthe uncle"\n');

    expect(table.rows[0]?.Note).toBe("number is wrong, ring\nthe uncle");
  });

  it("reads a doubled quote as one quote", () => {
    const table = parseCsv('SR No,Note\nTEST-1,"said ""no phone"""\n');

    expect(table.rows[0]?.Note).toBe('said "no phone"');
  });

  it("reads CRLF as one row break", () => {
    const table = parseCsv("SR No\r\nTEST-1\r\nTEST-2\r\n");

    expect(table.rows.map((row) => row["SR No"])).toEqual(["TEST-1", "TEST-2"]);
  });

  it("reads Hindi in a note", () => {
    const table = parseCsv("SR No,Note\nTEST-1,फ़ोन चाचा का है\n");

    expect(table.rows[0]?.Note).toBe("फ़ोन चाचा का है");
  });

  it("survives an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
    expect(parseCsv("\n\n")).toEqual({ headers: [], rows: [] });
  });

  it("refuses a sheet with no way to identify a child", () => {
    expect(hasIdentityColumn(["Name", "Note"])).toBe(false);
    expect(hasIdentityColumn(["Admission No"])).toBe(true);
  });

  it("writes a template Excel will open with Hindi intact", () => {
    const csv = templateCsv();

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(hasIdentityColumn(parseCsv(csv).headers)).toBe(true);
  });
});

describe("indexing the roll", () => {
  it("matches however the number was typed", () => {
    expect(normaliseAdmissionNo(" test-cl6-001 ")).toBe("TEST-CL6-001");
    expect(indexByAdmissionNo(roll).get("TEST-CL6-001")?.id).toBe("s1");
  });

  it("indexes a duplicated number as neither child", () => {
    // Picking one would be a coin toss about which family gets asked. Two
    // children with one number is a row to report, not a row to resolve.
    const twins = [student(), student({ id: "s9", fullName: "Other Child" })];

    expect(indexByAdmissionNo(twins).get("TEST-CL6-001")).toBeNull();
  });

  it("ignores a child with no admission number at all", () => {
    expect(indexByAdmissionNo([student({ admissionNo: null })]).size).toBe(0);
  });
});

describe("matching the sheet", () => {
  it("matches a row and keeps its note", () => {
    const result = matchAskList(
      sheet("TEST-CL6-001,Someone,number belongs to an uncle\n"),
      roll,
    );

    expect(result.unmatched).toEqual([]);
    expect(result.matched).toEqual([
      {
        rowNumber: 2,
        studentId: "s1",
        fullName: "Test Child One",
        admissionNo: "TEST-CL6-001",
        classId: "c6",
        note: "number belongs to an uncle",
      },
    ]);
  });

  it("numbers rows the way Excel does", () => {
    // Row 1 is the header. Reporting row 0 or row 1 for the first data row is
    // a number the office cannot act on with the file open in front of them.
    const result = matchAskList(sheet("NOPE-1,,\nNOPE-2,,\n"), roll);

    expect(result.unmatched.map((miss) => miss.rowNumber)).toEqual([2, 3]);
  });

  it("names a row with no identifier rather than dropping it", () => {
    const result = matchAskList(sheet(",Someone With A Name,a note\n"), roll);

    expect(result.unmatched).toEqual([
      { rowNumber: 2, admissionNo: null, name: "Someone With A Name", reason: "no-identifier" },
    ]);
  });

  it("names a number nobody has", () => {
    const result = matchAskList(sheet("TEST-CL9-404,,\n"), roll);

    expect(result.unmatched[0]).toMatchObject({
      admissionNo: "TEST-CL9-404",
      reason: "not-found",
    });
  });

  it("refuses a child who has left, and says so", () => {
    // Matched, then refused. The resolver only takes enrolled children, so
    // without this the row vanishes between this screen and the frozen roster
    // with nothing said about it.
    const result = matchAskList(sheet("TEST-CL6-009,,\n"), roll);

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toBe("not-enrolled");
  });

  it("refuses a second row for a child already on the list", () => {
    const result = matchAskList(sheet("TEST-CL6-001,,first\nTEST-CL6-001,,again\n"), roll);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.note).toBe("first");
    expect(result.unmatched[0]).toMatchObject({ rowNumber: 3, reason: "already-listed" });
  });

  it("refuses an ambiguous number rather than picking one", () => {
    const twins = [student(), student({ id: "s9", fullName: "Other Child" })];
    const result = matchAskList(sheet("TEST-CL6-001,,\n"), twins);

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toBe("not-found");
  });

  it("ignores the blank tail of a spreadsheet", () => {
    const result = matchAskList(sheet("TEST-CL6-001,,\n,,\n,,\n"), roll);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toEqual([]);
  });

  it("never loses a row: every non-blank row is matched or named", () => {
    // The invariant the whole module exists for. Thirty-five in, thirty-five
    // accounted for — however many of them are wrong.
    const body =
      "TEST-CL6-001,,a\nTEST-CL6-002,,b\nTEST-CL7-001,,c\nTEST-CL6-009,,d\nNOPE,,e\n,Nameless,f\n";
    const result = matchAskList(sheet(body), roll);

    expect(result.matched.length + result.unmatched.length).toBe(6);
  });

  it("reports the classes the matched children fall across", () => {
    const result = matchAskList(sheet("TEST-CL6-001,,\nTEST-CL7-001,,\n"), roll);

    expect(result.classIds.sort()).toEqual(["c6", "c7"]);
  });

  it("carries the notes in the shape an audience holds them", () => {
    const result = matchAskList(sheet("TEST-CL6-001,,uncle\nTEST-CL6-002,,\n"), roll);

    expect(notesFrom(result.matched)).toEqual({ s1: "uncle" });
  });

  it("reads a sheet whose headers the office renamed", () => {
    const table = parseCsv("Admission Number,Remarks\ntest-cl6-002,ring after four\n");
    const result = matchAskList(table, roll);

    expect(result.matched[0]?.studentId).toBe("s2");
    expect(result.matched[0]?.note).toBe("ring after four");
  });

  it("reads the name column so a mis-mapped sheet can be explained", () => {
    // The name is never a match key, but it has to be *visible*: a row with a
    // name and no SR must be reported rather than read as the blank tail.
    const result = matchAskList(sheet(",Meera,\n"), roll);

    expect(result.unmatched[0]?.name).toBe("Meera");
  });
});
