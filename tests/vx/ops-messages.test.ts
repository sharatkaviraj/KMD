import { describe, expect, it } from "vitest";

import {
  buildFamilies,
  composeProblems,
  composeText,
  costPaise,
  countFamilies,
  countSends,
  familiesFor,
  latestByRecipient,
  matchesReply,
  numberPlaceholders,
  personalFor,
  templateSlug,
  templateState,
  tenDigits,
  unknownPlaceholders,
} from "@/vx/screens/messages/domain/messages";

const roll = [
  { id: "s1", name: "Test Child One", classId: "c5", classLabel: "Class 5", parentName: "Test Parent A", phone: "+91 90000 00101" },
  { id: "s2", name: "Test Child Two", classId: "c8", classLabel: "Class 8", parentName: "Test Parent A", phone: "9000000101" },
  { id: "s3", name: "Test Child Three", classId: "c8", classLabel: "Class 8", parentName: "Test Parent B", phone: "12345" },
  { id: "s4", name: "Test Child Four", classId: "c10", classLabel: "Class 10", parentName: null, phone: "09000000104" },
];

describe("families", () => {
  it("normalises numbers", () => {
    expect(tenDigits("+91 90000 00101")).toBe("9000000101");
    expect(tenDigits("09000000104")).toBe("9000000104");
    expect(tenDigits("5000000101")).toBeNull();
  });

  it("dedupes siblings by guardian phone and counts children with no number", () => {
    const { families, noPhone } = buildFamilies(roll);
    expect(families).toHaveLength(2);
    expect(families[0].children).toHaveLength(2);
    expect(families[1].parentName).toBe("Parent");
    expect(noPhone).toBe(1);
    expect(familiesFor(families, "classes", ["c8"])).toHaveLength(1);
    expect(familiesFor(families, "staff", [])).toHaveLength(0);
  });

  it("counts families from class sets", () => {
    const sets = [["c5", "c8"], ["c10"]];
    expect(countFamilies(sets, "school", [], 9)).toBe(2);
    expect(countFamilies(sets, "classes", ["c10"], 9)).toBe(1);
    expect(countFamilies(sets, "staff", [], 9)).toBe(9);
    expect(costPaise(3)).toBe(264);
  });
});

describe("compose", () => {
  const family = buildFamilies(roll).families[0];

  it("personalises with the child in the chosen classes", () => {
    const personal = personalFor(family, ["c8"], "12 Oct");
    expect(personal.student).toBe("Test");
    expect(personal.className).toBe("Class 8");
    const out = composeText({ title: "PTM", hi: "प्रिय {parent}", en: "Dear {parent}, {class}", language: "both" }, personal);
    expect(out.hi).toBe("*PTM*\nप्रिय Test Parent A");
    expect(out.en).toBe("Dear Test Parent A, Class 8");
  });

  it("finds the problems that block queueing", () => {
    expect(composeProblems({ kind: "notice", title: "", hi: "", en: "x", language: "both", audience: "classes", classIds: [] })).toEqual(["title", "hi", "classes"]);
    expect(composeProblems({ kind: "notice", title: "T", hi: "", en: "Hi {nmae}", language: "en", audience: "school", classIds: [] })).toEqual(["placeholder"]);
    expect(unknownPlaceholders("{parent} {x}")).toEqual(["{x}"]);
  });
});

describe("sent log and templates", () => {
  it("lets a newer resend row win", () => {
    const rows = [
      { to_phone: "1", status: "failed", requested_at: "2026-10-01T00:00:00Z" },
      { to_phone: "1", status: "queued", requested_at: "2026-10-02T00:00:00Z" },
      { to_phone: "2", status: "sent", requested_at: "2026-10-01T00:00:00Z" },
    ];
    expect(countSends(latestByRecipient(rows))).toEqual({ total: 2, queued: 1, sent: 1, failed: 0, cancelled: 0 });
  });

  it("numbers placeholders consistently across languages", () => {
    expect(numberPlaceholders("{student} {parent}", "{parent} {student}")).toEqual({ hi: "{{1}} {{2}}", en: "{{2}} {{1}}", variables: ["student", "parent"] });
    expect(templateSlug("Unit test — datesheet!")).toBe("unit_test_datesheet");
    expect(templateState({ isActive: false, waCategory: "utility" })).toBe("waiting");
  });

  it("filters replies", () => {
    expect(matchesReply({ status: "open", assignedStaffId: null }, "unassigned")).toBe(true);
    expect(matchesReply({ status: "open", assignedStaffId: "x" }, "unassigned")).toBe(false);
    expect(matchesReply({ status: "done", assignedStaffId: null }, "open")).toBe(false);
  });
});
