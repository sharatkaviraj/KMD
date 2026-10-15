import { describe, expect, it } from "vitest";

import { coverEligibleIds, distinctNames, missedPeriods } from "@/modules/substitutions/domain/cover-view";

/*
 * School-day run, 14 Oct: a teacher marked away at 22:30 read "0 periods · no
 * cover needed"; two staff both read "QA Teacher"; the accountant was offered
 * as "Best match".
 */

const need = (period: number, cls: string, absent = ["antima"]) => ({
  key: `need-${period}-${cls}`,
  event: { key: `ev-${period}-${cls}`, day: "Wednesday", period, kind: "ordinary" as const, classes: [{ id: cls, label: cls }], subjectCode: "HINDI", staffIds: absent, sources: [] },
  absentStaffIds: absent,
});

describe("missed periods", () => {
  it("lists every lesson an absence leaves after the bells, instead of nothing", () => {
    const needs = [need(0, "Class 3"), need(1, "Class 4"), need(2, "Class 5")];
    const missed = missedPeriods(needs, [], new Set());
    expect(missed.map((m) => m.period)).toEqual([0, 1, 2]);
    expect(missed[0]).toMatchObject({ classLabels: ["Class 3"], subjectCode: "HINDI", absentStaffIds: ["antima"] });
  });

  it("leaves out periods still to come and lessons that already have a duty", () => {
    const needs = [need(0, "Class 3"), need(1, "Class 4"), need(5, "Class 5")];
    const missed = missedPeriods(needs, [{ needKey: "need-1-Class 4" }], new Set([5]));
    expect(missed.map((m) => m.key)).toEqual(["need-0-Class 3"]);
  });

  it("is empty when nothing has begun", () => {
    expect(missedPeriods([need(4, "Class 3")], [], new Set([4]))).toEqual([]);
  });
});

describe("who may be offered as cover", () => {
  const staff = [
    { id: "t1", isTeaching: true },
    { id: "admin", isTeaching: false },
    { id: "viewer", isTeaching: false },
    { id: "coord-who-teaches", isTeaching: false },
  ];

  it("is teaching staff and anybody the timetable gives a lesson — never the office", () => {
    const ids = coverEligibleIds(staff, [{ staffProfileId: "coord-who-teaches" }]);
    expect([...ids].sort()).toEqual(["coord-who-teaches", "t1"]);
  });
});

describe("distinct staff names", () => {
  it("adds the short name only where two people share a name", () => {
    const names = distinctNames([
      { id: "a", displayName: "QA Teacher", shortName: "Ravina" },
      { id: "b", displayName: "QA Teacher", shortName: "QATE" },
      { id: "c", displayName: "Kusum", shortName: "Kusum" },
    ]);
    expect(names.get("a")).toBe("QA Teacher (Ravina)");
    expect(names.get("b")).toBe("QA Teacher (QATE)");
    expect(names.get("c")).toBe("Kusum");
  });

  it("numbers people the short name cannot tell apart", () => {
    const names = distinctNames([
      { id: "a", displayName: "Asha", shortName: "Asha" },
      { id: "b", displayName: "asha", shortName: "" },
    ]);
    expect(new Set(names.values()).size).toBe(2);
    expect(names.get("a")).toBe("Asha 1");
    expect(names.get("b")).toBe("asha 2");
  });
});
