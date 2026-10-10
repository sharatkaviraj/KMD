import { describe, expect, it } from "vitest";

import {
  ageFit,
  ageOn,
  buildFeePlan,
  changedFields,
  dobForInput,
  groupFamilies,
  isLikelySameChild,
  lastDayChoices,
  maskPhone,
  nextSrNumber,
  nextStage,
  normalizeMobile,
  parseDob,
  tcNumber,
  usualAgeFor,
  withdrawReasonText,
} from "@/vx/screens/admissions/logic";

describe("admissions dates", () => {
  it("reads the office's DD-MM-YYYY and ISO, refuses impossible days", () => {
    expect(parseDob("21-08-2019")).toBe("2019-08-21");
    expect(parseDob("1/2/2020")).toBe("2020-02-01");
    expect(parseDob("2019-08-21")).toBe("2019-08-21");
    expect(parseDob("31-02-2019")).toBeNull();
    expect(parseDob("hello")).toBeNull();
    expect(dobForInput("2019-08-21")).toBe("21-08-2019");
  });

  it("works out age and fit on the 1 July cut-off", () => {
    expect(ageOn("2020-07-02", "2026-07-01")).toEqual({ years: 5, months: 11 });
    expect(usualAgeFor("Class 1")).toBe(6);
    expect(usualAgeFor("JKG")).toBe(4);
    expect(ageFit("2020-06-01", "Class 1", "2026-27").fit).toBe("right");
    expect(ageFit("2023-01-01", "Class 1", "2026-27").fit).toBe("young");
    expect(ageFit(null, "Class 1", "2026-27").fit).toBe("unknown");
  });
});

describe("admissions people", () => {
  it("normalises and masks phones", () => {
    expect(normalizeMobile("+91 98290 12345")).toBe("9829012345");
    expect(normalizeMobile("09829012345")).toBe("9829012345");
    expect(maskPhone("9829012345")).toBe("98290 ••345");
  });

  it("stops only for a likely same child", () => {
    const adding = { fullName: "Test Child", fatherName: "Test Father", dateOfBirth: "2019-01-01" };
    expect(isLikelySameChild(adding, { fullName: "test  child", fatherName: "Test Father", dateOfBirth: null })).toBe(true);
    expect(isLikelySameChild(adding, { fullName: "Test Child", fatherName: "Other", dateOfBirth: "2019-01-01" })).toBe(true);
    expect(isLikelySameChild(adding, { fullName: "Test Child", fatherName: "Other", dateOfBirth: null })).toBe(false);
    expect(isLikelySameChild(adding, { fullName: "Another", fatherName: "Test Father", dateOfBirth: "2019-01-01" })).toBe(false);
  });

  it("gives the next numeric SR number", () => {
    expect(nextSrNumber(["12", "T-5", null, "40"])).toBe("41");
    expect(nextSrNumber([])).toBe("1");
  });

  it("groups children into families by father and phone", () => {
    const fams = groupFamilies([
      { id: "a", fullName: "Kid A", fatherName: "Father One", motherName: null, phone: "9000000001", classLabel: "Class 1", villageCity: null, address: null },
      { id: "b", fullName: "Kid B", fatherName: "father one", motherName: "Mother", phone: "+91 9000000001", classLabel: "Class 3", villageCity: "Town", address: null },
      { id: "c", fullName: "Kid C", fatherName: null, motherName: null, phone: null, classLabel: "Class 2", villageCity: null, address: null },
    ]);
    expect(fams).toHaveLength(2);
    expect(fams[0].kids.map((k) => k.id)).toEqual(["a", "b"]);
    expect(fams[0].mother).toBe("Mother");
    expect(fams[1].key).toBe("solo:c");
  });
});

describe("admissions fee plan", () => {
  const schedule = [
    { label: "Inst 1", dueDate: "2026-04-15" },
    { label: "Inst 2", dueDate: "2026-07-15" },
    { label: "Inst 3", dueDate: "2026-10-15" },
    { label: "Inst 4", dueDate: "2027-01-15" },
  ];

  it("keeps pending today and not due yet apart, and they sum to the plan", () => {
    const plan = buildFeePlan({ classTuition: 12000, transportAnnual: 0, academicFee: 1000, policy: null, schedule, distribution: "first_only", today: "2026-08-01" });
    expect(plan.rows).toHaveLength(4);
    expect(plan.rows.filter((r) => r.due)).toHaveLength(2);
    expect(plan.pendingToday + plan.notDueYet).toBe(plan.total);
    expect(plan.concession).toBe(0);
  });

  it("applies a concession policy to tuition only", () => {
    const half = buildFeePlan({ classTuition: 12000, transportAnnual: 4000, academicFee: 0, policy: { calculationType: "tuition_percentage", percentage: 50, fixedTuitionAmount: null }, schedule, distribution: "equal", today: "2026-01-01" });
    expect(half.tuition).toBe(6000);
    expect(half.concession).toBe(6000);
    expect(half.transport).toBe(4000);
    expect(half.pendingToday).toBe(0);
    const rte = buildFeePlan({ classTuition: 12000, transportAnnual: 0, academicFee: 0, policy: { calculationType: "tuition_zero", percentage: null, fixedTuitionAmount: null }, schedule, distribution: "equal", today: "2026-01-01" });
    expect(rte.tuition).toBe(0);
  });
});

describe("admissions pipeline and withdrawal", () => {
  it("moves enquiry → visited → form and stops before admitted", () => {
    expect(nextStage("enquiry")).toBe("visited");
    expect(nextStage("visited")).toBe("form");
    expect(nextStage("form")).toBeNull();
  });

  it("numbers TCs per session", () => {
    expect(tcNumber("2026-27", 18)).toBe("TC/2026-27/018");
    expect(withdrawReasonText("other", " Moving abroad ").en).toBe("Moving abroad");
    expect(withdrawReasonText("town", "").hi).toBeTruthy();
  });

  it("offers today, yesterday and last month's end as last days", () => {
    expect(lastDayChoices("2026-10-10").map((c) => c.value)).toEqual(["2026-10-10", "2026-10-09", "2026-09-30"]);
    expect(lastDayChoices("2026-10-01").map((c) => c.value)).toEqual(["2026-10-01", "2026-09-30"]);
  });

  it("counts real changes only", () => {
    expect(changedFields({ a: "x", b: "y " }, { a: "x", b: "y" })).toEqual([]);
    expect(changedFields({ a: "x", b: "y" }, { a: "z", b: "y" })).toEqual(["a"]);
  });
});
