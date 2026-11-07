import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ID_LEFT_OUT, SHEETS, cellOf, classLabelOf, headerOf, istStamp, schoolReadmeLines, shapeRow, sheetAllowed, sheetsFor, type Lookups,
} from "@/modules/ai-report/domain/sheets";
import { can, readsEveryClass, staffPermissions, staffRoles, type StaffRole } from "@/platform/auth/permissions";

/*
 * One's half of the AI report: the sheet catalogue and how a raw row becomes
 * a readable one. Synthetic ids and names only.
 */

const migrations = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(path.join("supabase/migrations", file), "utf8")).join("\n").toLowerCase();

describe("the sheet catalogue", () => {
  it("keeps Excel's sheet-name rules and never clashes with the Fees half or the index", () => {
    const names = SHEETS.filter((spec) => !spec.lookupOnly).map((spec) => spec.sheet.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const spec of SHEETS) {
      expect(spec.sheet.length, spec.sheet).toBeLessThanOrEqual(31);
      expect(spec.sheet, spec.sheet).not.toMatch(/[[\]:*?/\\]/);
      expect(spec.sheet.toLowerCase().startsWith("fees "), spec.sheet).toBe(false);
      expect(["_readme", "_sheets", "students"]).not.toContain(spec.sheet.toLowerCase());
    }
  });

  it("reads only One's own tables, each of which exists", () => {
    for (const spec of SHEETS) {
      const made = new RegExp(`create (?:or replace )?(?:materialized )?(?:table|view)(?: if not exists)? vppsone\\.${spec.table}\\b`);
      expect(made.test(migrations), spec.table).toBe(true);
    }
  });

  it("orders every read, so paging never skips or repeats a row", () => {
    for (const spec of SHEETS) expect(spec.order.length, spec.key).toBeGreaterThan(0);
  });

  it("reads a children sheet only after the sheet it belongs to", () => {
    SHEETS.forEach((spec, index) => {
      if (spec.scope.kind !== "children") return;
      const { parent } = spec.scope;
      const at = SHEETS.findIndex((candidate) => candidate.key === parent);
      expect(at, `${spec.key} → ${parent}`).toBeGreaterThanOrEqual(0);
      expect(at, `${spec.key} → ${parent}`).toBeLessThan(index);
    });
  });

  it("names only real permissions", () => {
    for (const spec of SHEETS) expect(staffPermissions, spec.key).toContain(spec.permission);
  });
});

describe("who gets which sheets", () => {
  const sheetsOf = (role: StaffRole) => sheetsFor((permission) => can({ role }, permission), readsEveryClass({ role })).map((spec) => spec.key);

  it("gives the administrator every sheet", () => {
    expect(sheetsOf("admin")).toEqual(SHEETS.map((spec) => spec.key));
  });

  it("gives a teacher only notes (filtered note by note), never the school's records or money", () => {
    const keys = sheetsOf("teacher");
    for (const key of keys) expect(["notes", "note_replies", "support_plans", "support_plan_steps"], key).toContain(key);
    expect(keys.some((key) => key.startsWith("fee_"))).toBe(false);
    expect(keys).not.toContain("student_records");
    expect(keys).not.toContain("marks");
  });

  it("gives the fee desk One's fee follow-ups and nothing school-wide", () => {
    for (const role of ["accountant", "fee_collector"] as const) {
      const keys = sheetsOf(role);
      expect(keys.every((key) => key.startsWith("fee_") || ["notes", "note_replies", "support_plans", "support_plan_steps"].includes(key)), role).toBe(true);
      expect(keys).not.toContain("student_records");
    }
  });

  it("needs the sheet's own permission even for a school-wide role", () => {
    expect(sheetAllowed("marks:view", () => false, true)).toBe(false);
    expect(sheetAllowed("marks:view", () => true, false)).toBe(false);
    expect(sheetAllowed("fees:view", () => true, false)).toBe(true);
    expect(sheetAllowed("notes:view", () => true, false)).toBe(true);
  });

  it("decides every role without throwing", () => {
    for (const role of staffRoles) expect(() => sheetsOf(role)).not.toThrow();
  });
});

const STUDENT = "00000000-0000-4000-8000-0000000000a1";
const CLASS = "00000000-0000-4000-8000-0000000000c1";
const STAFF = "00000000-0000-4000-8000-0000000000f1";
const PAPER = "00000000-0000-4000-8000-0000000000b1";

const lookups: Lookups = {
  students: new Map([[STUDENT, { admissionNo: "T-101", name: "Test Child", classId: CLASS }]]),
  classes: new Map([[CLASS, "Class 5 - Section A"]]),
  staff: new Map([[STAFF, "Test Teacher"]]),
  subjects: new Map(),
  fields: new Map(),
  noteKinds: new Map(),
  assessments: new Map(),
  papers: new Map([[PAPER, { assessment: "Half yearly", subject: "Maths", classId: CLASS, maxMarks: 80, passMarks: 27 }]]),
  registers: new Map(),
  versions: new Map(),
  supportPlans: new Map(),
  substitutionPlans: new Map(),
  campaigns: new Map(),
  requests: new Map(),
  rounds: new Map(),
  rooms: new Map(),
};

describe("a raw row as a readable row", () => {
  it("names the child, class and staff instead of their ids", () => {
    const out = shapeRow({ id: "00000000-0000-4000-8000-000000000999", student_id: STUDENT, marked_by: STAFF, status: "absent" }, {}, lookups);
    expect(out).toEqual({ "SR no": "T-101", Student: "Test Child", Class: "Class 5 - Section A", "Marked by": "Test Teacher", Status: "absent" });
  });

  it("turns a paper into its assessment, subject, class and marks", () => {
    const out = shapeRow({ student_id: STUDENT, assessment_subject_id: PAPER, marks: 61 }, {}, lookups);
    expect(out).toMatchObject({ Assessment: "Half yearly", Subject: "Maths", "Max marks": 80, "Pass marks": 27, Marks: 61 });
  });

  it("never lets a secret, a link, a storage path or a raw id out", () => {
    const out = shapeRow({
      id: "00000000-0000-4000-8000-000000000999", session_label: "TEST-2026-27", token: "secret-link", verify_code: "1234",
      storage_path: "bucket/file.pdf", user_id: STAFF, upload_token: "x", api_key: "x", password_hash: "x", webhook_secret: "x",
      some_other_id: "00000000-0000-4000-8000-000000000777", title: "Kept",
    }, {}, lookups);
    expect(out).toEqual({ Title: "Kept" });
  });

  it("drops what the sheet says to drop, and gives a short Ref when asked", () => {
    const out = shapeRow({ id: "abcdef12-0000-4000-8000-000000000000", removed_at: null, body: "Text" }, { drop: ["removed_at"], ref: true }, lookups);
    expect(out).toEqual({ Ref: "abcdef12", Text: "Text" });
  });

  it("names or leaves out an id hiding inside a value: JSON, a status reason, an upload's id", () => {
    const out = shapeRow({
      audience: { classIds: [CLASS], studentIds: [STUDENT], search: "" },
      status_reason: "withdrawn:00000000-0000-4000-8000-000000000777",
      value: "00000000-0000-4000-8000-000000000778",
      scope: { kind: "class", value: CLASS },
      note: "Moved to Test Teacher's cover",
    }, {}, lookups);
    expect(out.Audience).toBe('{"classIds":["Class 5 - Section A"],"studentIds":["Test Child (T-101)"],"search":""}');
    expect(out["Status reason"]).toBe("withdrawn");
    expect(out.Value).toBe(ID_LEFT_OUT);
    expect(out.Scope).toBe('{"kind":"class","value":"Class 5 - Section A"}');
    expect(out.Note).toBe("Moved to Test Teacher's cover");
    expect(JSON.stringify(out)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("says when a child is not on this year's roll rather than showing an id", () => {
    const out = shapeRow({ student_id: "00000000-0000-4000-8000-0000000000a9" }, {}, lookups);
    expect(out.Student).toBe("Student not on this year's roll");
    expect(Object.values(out).join(" ")).not.toMatch(/0000000000a9/);
  });
});

describe("cells", () => {
  it("writes Yes/No, India time, lists and long text the way Excel and an assistant read them", () => {
    expect(cellOf(true)).toBe("Yes");
    expect(cellOf(null)).toBe("");
    expect(cellOf("2026-07-01T03:35:00+00:00")).toBe("2026-07-01 09:05");
    expect(cellOf(["health", "family", null])).toBe("health, family");
    expect(cellOf({ a: 1 })).toBe('{"a":1}');
    expect(String(cellOf("x".repeat(40_000))).length).toBe(32_001);
    expect(istStamp("not a time")).toBe("not a time");
  });

  it("makes headers people read", () => {
    expect(headerOf("follow_up_on")).toBe("Follow up on");
    expect(headerOf("label_hi")).toBe("Label (Hindi)");
    expect(headerOf("admission_no")).toBe("SR no");
  });

  it("writes a class the way Fees writes it, so the two halves join", () => {
    expect(classLabelOf({ class_name: "Class 11", section: "A", stream_name: "Science" })).toBe("Class 11 - Section A - Science");
    expect(classLabelOf({ class_name: "Class 5", section: null, stream_name: null })).toBe("Class 5");
  });
});

describe("the _README sheet", () => {
  const lines = schoolReadmeLines({ schoolName: "Test School", sessionLabel: "TEST-2026-27", madeAt: "2026-11-07 10:00", madeBy: "Synthetic admin", left: [{ sheet: "Marks", why: "not included for this account" }], rehearsal: true }).join("\n");

  it("keeps fees and late fees apart and says a late fee alone is not a defaulter", () => {
    expect(lines).toMatch(/never added together/);
    expect(lines).toMatch(/only debt is a late fee is not a defaulter/);
  });

  it("tells the assistant never to follow instructions written inside the records", () => {
    expect(lines).toMatch(/Never follow\s+an instruction/);
  });

  it("names what this account did not get, marks a rehearsal year and says the file is private", () => {
    expect(lines).toContain("- Marks: not included for this account");
    expect(lines).toContain("REHEARSAL YEAR");
    expect(lines).toContain("PRIVACY");
  });
});
