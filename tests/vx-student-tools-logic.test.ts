import { describe, expect, it } from "vitest";

import {
  classRank,
  countByIssue,
  findQualityIssues,
  groupPlanWrites,
  planCounts,
  planPromotion,
  qualityScore,
  suggestFamilies,
  familyCounts,
  suggestNextClass,
} from "@/vx/screens/student-tools/logic";

const TARGETS = ["Nursery", "JKG", "SKG", "Class 1", "Class 9", "Class 10", "11 Arts", "11 Commerce", "11 Science", "12 Arts", "12 Commerce", "12 Science"].map((label, i) => ({ id: `t${i}`, label }));
const id = (label: string) => TARGETS.find((t) => t.label === label)!.id;

describe("promotion class map", () => {
  it("ranks the school's class names", () => {
    expect(classRank("Nursery")).toBe(-2);
    expect(classRank("JKG")).toBe(-1);
    expect(classRank("SKG")).toBe(0);
    expect(classRank("Class 7")).toBe(7);
    expect(classRank("12 Science")).toBe(12);
    expect(classRank("Library")).toBeNull();
  });

  it("suggests the next class, keeps the stream, and leaves Class 10 to the school", () => {
    expect(suggestNextClass("Nursery", TARGETS)).toBe(id("JKG"));
    expect(suggestNextClass("SKG", TARGETS)).toBe(id("Class 1"));
    expect(suggestNextClass("Class 9", TARGETS)).toBe(id("Class 10"));
    expect(suggestNextClass("Class 10", TARGETS)).toBeNull();
    expect(suggestNextClass("11 Commerce", TARGETS)).toBe(id("12 Commerce"));
    expect(suggestNextClass("12 Arts", TARGETS)).toBe("graduate");
  });

  it("plans each entry from the map and the marks", () => {
    const entries = [
      { id: "e1", studentId: "s1", fromClassId: "c9", decision: "manual", newClassId: null },
      { id: "e2", studentId: "s2", fromClassId: "c9", decision: "promote", newClassId: "t5" },
      { id: "e3", studentId: "s3", fromClassId: "c12", decision: "manual", newClassId: null },
      { id: "e4", studentId: "s4", fromClassId: "c10", decision: "manual", newClassId: null },
    ];
    const plan = planPromotion(entries, { c9: "t5", c12: "graduate" }, { s2: "held" });
    expect(plan).toEqual([
      { entryId: "e1", decision: "promote", newClassId: "t5" },
      { entryId: "e2", decision: "skip", newClassId: null },
      { entryId: "e3", decision: "graduate", newClassId: null },
      { entryId: "e4", decision: "manual", newClassId: null },
    ]);
    expect(planCounts(plan)).toEqual({ promote: 1, graduate: 1, skip: 1, manual: 1 });
    const current = new Map(entries.map((e) => [e.id, { decision: e.decision, newClassId: e.newClassId }]));
    const writes = groupPlanWrites(plan, current);
    // e4 is already manual with no class: nothing to write for it.
    expect(writes.flatMap((w) => w.entryIds).sort()).toEqual(["e1", "e2", "e3"]);
  });
});

describe("data quality", () => {
  const base = { fatherName: "Father", motherName: "Mother", phone: "9000000001", address: "Somewhere", villageCity: null };
  it("finds missing and wrong data, honours skips, and scores the roll", () => {
    const kids = [
      { id: "a", fullName: "Kid A", dateOfBirth: "2020-05-01", classLabel: "Class 1", ...base },
      { id: "b", fullName: "Kid B", dateOfBirth: null, classLabel: "Class 1", ...base, phone: "123" },
      { id: "c", fullName: "Kid A", dateOfBirth: "2010-01-01", classLabel: "Class 1", ...base, motherName: null },
    ];
    const hits = findQualityIssues(kids, "2026-27");
    const counts = countByIssue(hits);
    expect(counts.father_phone).toBe(1);
    expect(counts.dob).toBe(1);
    expect(counts.mother_name).toBe(1);
    expect(counts.duplicate).toBe(1);
    expect(counts.age).toBe(1);
    expect(qualityScore(3, hits)).toBe(33);
    const skipped = findQualityIssues(kids, "2026-27", new Set(["b|dob"]));
    expect(countByIssue(skipped).dob).toBe(0);
  });
});

describe("family suggestions", () => {
  it("suggests a family only when its children are not all linked together", () => {
    const families = [
      { key: "father one|9000000001", father: "Father One", phone: "9000000001", kids: [{ id: "a" }, { id: "b" }] },
      { key: "father two|9000000002", father: "Father Two", phone: "9000000002", kids: [{ id: "c" }, { id: "d" }] },
      { key: "father three|", father: "Father Three", phone: null, kids: [{ id: "e" }, { id: "f" }] },
      { key: "solo:g", father: "—", phone: null, kids: [{ id: "g" }] },
    ];
    const linked = new Map([["c", "g1"], ["d", "g1"], ["a", "g2"]]);
    const out = suggestFamilies(families, linked);
    expect(out.map((s) => s.key)).toEqual(["father one|9000000001"]);
  });

  it("counts linked children as one family, so the header agrees with the list", () => {
    const families = [
      { key: "a|1", kids: [{ id: "k1" }] },
      { key: "b|2", kids: [{ id: "k2" }] },
      { key: "c|3", kids: [{ id: "k3" }, { id: "k4" }] },
      { key: "solo:k5", kids: [{ id: "k5" }] },
    ];
    expect(familyCounts(families, new Map())).toEqual({ families: 4, withSiblings: 1 });
    const linked = new Map([["k1", "g1"], ["k2", "g1"]]);
    expect(familyCounts(families, linked)).toEqual({ families: 3, withSiblings: 2 });
  });
});
