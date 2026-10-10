import { describe, expect, it } from "vitest";

import {
  bandOf,
  diffDrafts,
  draftToFormData,
  isDateLocked,
  lateFeeFor,
  perInstallment,
  raiseTuition,
  ruleCode,
  type FeeSetupDraft,
} from "@/modules/fees/vx/domain/fee-setup";

const base: FeeSetupDraft = {
  academicSessionLabel: "2026-27",
  installmentDates: ["2026-04-20", "2026-07-20", "2026-10-20", "2027-01-20"],
  lateFeeFlatAmount: 100,
  newStudentAcademicFeeAmount: 1200,
  oldStudentAcademicFeeAmount: 1000,
  academicFeeDistribution: "first_only",
  customFeeHeads: [],
  discounts: [
    { key: "d1", id: "d1", code: "staff_child", displayName: "Staff Child", calculationType: "tuition_percentage", percentage: 50, fixedTuitionAmount: null, isActive: true, isBuiltin: true },
  ],
  classRows: [
    { label: "Class 7", annualTuition: 22000 },
    { label: "11 Science", annualTuition: 35000 },
  ],
  routeRows: [{ routeName: "Test Route", annualFee: 6000 }],
};

describe("fee setup draft", () => {
  it("lists every change, one line each", () => {
    const draft: FeeSetupDraft = {
      ...base,
      lateFeeFlatAmount: 150,
      classRows: [{ label: "Class 7", annualTuition: 23000 }, base.classRows[1]],
      routeRows: [...base.routeRows, { routeName: "New Route", annualFee: 5000 }],
      discounts: [{ ...base.discounts[0], isActive: false }],
    };
    const keys = diffDrafts(base, draft).map((c) => c.key);
    expect(keys).toEqual(["class:Class 7", "route:New Route", "latefee", "disc:d1:on"]);
    expect(diffDrafts(base, base)).toEqual([]);
  });

  it("writes the exact fields the existing save action reads", () => {
    const fd = draftToFormData(base, "apply", "batch-1");
    expect(fd.get("_intent")).toBe("apply");
    expect(fd.get("changeBatchId")).toBe("batch-1");
    expect(fd.getAll("installmentDueDate")).toHaveLength(4);
    expect(fd.getAll("classLabel")).toEqual(["Class 7", "11 Science"]);
    expect(fd.getAll("classAnnualTuition")).toEqual(["22000", "35000"]);
    expect(fd.getAll("conventionalPolicyIsActive")).toEqual(["yes"]);
    expect(draftToFormData(base, "preview", null).get("changeBatchId")).toBeNull();
  });

  it("raises tuition by a percent to the nearest hundred", () => {
    expect(raiseTuition(base.classRows, 5)).toEqual([
      { label: "Class 7", annualTuition: 23100 },
      { label: "11 Science", annualTuition: 36800 },
    ]);
  });

  it("splits the year the way the fee engine does", () => {
    const first = perInstallment(base, 22000);
    expect(first.reduce((s, v) => s + v, 0)).toBe(23000);
    expect(first[0]).toBeGreaterThan(first[1]);
    const equal = perInstallment({ ...base, academicFeeDistribution: "equal" }, 22000);
    expect(equal.reduce((s, v) => s + v, 0)).toBe(23000);
  });

  it("charges the flat late fee only after the due date, never on time", () => {
    expect(lateFeeFor({ dueDate: "2026-07-20", paidOn: "2026-07-20", flat: 100 })).toBe(0);
    expect(lateFeeFor({ dueDate: "2026-07-20", paidOn: "2026-07-25", flat: 100 })).toBe(100);
    expect(lateFeeFor({ dueDate: "2026-07-20", paidOn: "2026-07-25", flat: 0 })).toBe(0);
  });

  it("bands classes, locks passed dates and makes unique rule codes", () => {
    expect(["Nursery", "JKG", "Class 3", "Class 7", "Class 10", "12 Arts"].map(bandOf)).toEqual(["pre", "pre", "primary", "middle", "secondary", "senior"]);
    expect(isDateLocked("2026-07-20", "2026-10-08")).toBe(true);
    expect(isDateLocked("2026-10-20", "2026-10-08")).toBe(false);
    expect(ruleCode("Staff child", ["staff_child"])).toBe("staff_child_2");
  });
});
