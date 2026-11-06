import { describe, expect, it } from "vitest";

import {
  agingBuckets,
  classBand,
  contactOutcomeFor,
  familyKeyOf,
  filterFamilies,
  groupFamilies,
  isCallable,
  lateFeeOnly,
  monthlyAmountFor,
  monthlySchedule,
  NO_CALL_FILTERS,
  promiseState,
  sortForCalling,
  splitIntoParts,
  validWriteOffAmount,
  type DuesStudent,
} from "@/modules/defaulters/vx/domain/families";

const kid = (over: Partial<DuesStudent>): DuesStudent => ({
  studentId: "s1",
  fullName: "Test Child",
  fatherName: "Test Parent",
  fatherPhone: "90000 00001",
  classLabel: "Class 4",
  transportRouteId: null,
  overdueAmount: 0,
  totalPending: 0,
  lateFee: 0,
  daysOverdue: 0,
  ...over,
});

describe("families", () => {
  it("groups siblings by family group, else by phone", () => {
    expect(familyKeyOf(kid({ familyGroupId: "g1" }))).toBe("g:g1");
    expect(familyKeyOf(kid({ fatherPhone: "+91 90000-00001" }))).toBe("p:9000000001");
    expect(familyKeyOf(kid({ fatherPhone: null }))).toBe("s:s1");

    const fams = groupFamilies([
      kid({ studentId: "a", overdueAmount: 3000, totalPending: 9000, lateFee: 200, daysOverdue: 20 }),
      kid({ studentId: "b", overdueAmount: 1000, totalPending: 1000, lateFee: 100, daysOverdue: 50, transportRouteId: "r1" }),
    ]);
    expect(fams).toHaveLength(1);
    expect(fams[0].kids).toHaveLength(2);
    expect(fams[0].days).toBe(50);
    expect(fams[0].usesBus).toBe(true);
  });

  it("takes not due yet from the installment rows when the board gives it (Reports' rule)", () => {
    // A child whose fees were never set up as installments owes ₹22,000 on
    // the student row but has nothing due on any installment.
    const [f] = groupFamilies([kid({ overdueAmount: 0, totalPending: 22000, notDueYet: 0 })]);
    expect(f.notDueYet).toBe(0);
    const [g] = groupFamilies([kid({ overdueAmount: 3000, totalPending: 9000, notDueYet: 6000 })]);
    expect(g.notDueYet).toBe(6000);
  });

  it("keeps pending today, not due yet and late fee apart", () => {
    const [f] = groupFamilies([kid({ overdueAmount: 3000, totalPending: 9000, lateFee: 200 })]);
    expect(f.pendingToday).toBe(3000);
    expect(f.notDueYet).toBe(6000);
    expect(f.lateFee).toBe(200);
    // Never a sum of the three anywhere on the family.
    expect(Object.values(f)).not.toContain(9200);
    expect(Object.values(f)).not.toContain(3200);
  });

  it("leaves a family whose only debt today is a late fee off the call list", () => {
    const fams = groupFamilies([kid({ studentId: "x", fatherPhone: "90000 00009", overdueAmount: 0, totalPending: 5000, lateFee: 300 })]);
    expect(isCallable(fams[0])).toBe(false);
    expect(lateFeeOnly(fams)).toHaveLength(1);
  });

  it("sorts oldest first, then biggest", () => {
    const fams = groupFamilies([
      kid({ studentId: "a", fatherPhone: "90000 00001", overdueAmount: 9000, daysOverdue: 10 }),
      kid({ studentId: "b", fatherPhone: "90000 00002", overdueAmount: 1000, daysOverdue: 90 }),
      kid({ studentId: "c", fatherPhone: "90000 00003", overdueAmount: 5000, daysOverdue: 90 }),
    ]);
    expect(sortForCalling(fams).map((f) => f.kids[0].studentId)).toEqual(["c", "b", "a"]);
  });

  it("filters by class band, installment, amount and bus", () => {
    const fams = groupFamilies([
      kid({ studentId: "a", fatherPhone: "90000 00001", classLabel: "UKG", overdueAmount: 6000, overdueInstallments: [1, 2] }),
      kid({ studentId: "b", fatherPhone: "90000 00002", classLabel: "Class 7", overdueAmount: 2000, overdueInstallments: [2], transportRouteId: "r" }),
    ]);
    const ids = (f: typeof NO_CALL_FILTERS) => filterFamilies(fams, f).map((x) => x.kids[0].studentId);
    expect(ids({ ...NO_CALL_FILTERS, band: "pre" })).toEqual(["a"]);
    expect(ids({ ...NO_CALL_FILTERS, inst: "i2" })).toEqual(["b"]);
    expect(ids({ ...NO_CALL_FILTERS, inst: "i12" })).toEqual(["a"]);
    expect(ids({ ...NO_CALL_FILTERS, big: true })).toEqual(["a"]);
    expect(ids({ ...NO_CALL_FILTERS, bus: true })).toEqual(["b"]);
    expect(ids({ ...NO_CALL_FILTERS, query: "class 7" })).toEqual(["b"]);
  });

  it("puts classes in bands", () => {
    expect(classBand("Nursery")).toBe("pre");
    expect(classBand("Class 5 - Section A")).toBe("p");
    expect(classBand("8")).toBe("m");
    expect(classBand("12 - Science")).toBe("s");
  });
});

describe("aging", () => {
  it("ages pending today only", () => {
    const b = agingBuckets([
      kid({ overdueAmount: 1000, daysOverdue: 5 }),
      kid({ overdueAmount: 2000, daysOverdue: 45 }),
      kid({ overdueAmount: 3000, daysOverdue: 75 }),
      kid({ overdueAmount: 4000, daysOverdue: 120 }),
      kid({ overdueAmount: 0, totalPending: 9000, daysOverdue: 0 }),
    ]);
    expect(b.map((x) => x.amount)).toEqual([1000, 2000, 3000, 4000]);
    expect(b.map((x) => x.students)).toEqual([1, 1, 1, 1]);
  });
});

describe("promises", () => {
  const p = { studentId: "s1", promisedOn: "2026-10-10", amount: 3000, madeAt: "2026-10-06T08:00:00Z" };

  it("is kept once the promised amount is paid after the promise", () => {
    const res = promiseState(p, [{ studentId: "s1", paymentDate: "2026-10-09", amount: 3000, receiptNumber: "R-9" }], "2026-10-12");
    expect(res.state).toBe("kept");
    expect(res.receiptNumber).toBe("R-9");
  });

  it("does not count a payment made before the promise", () => {
    expect(promiseState(p, [{ studentId: "s1", paymentDate: "2026-10-01", amount: 5000 }], "2026-10-10").state).toBe("due");
  });

  it("is due on the day, broken after, upcoming before", () => {
    expect(promiseState(p, [], "2026-10-10").state).toBe("due");
    expect(promiseState(p, [], "2026-10-11").state).toBe("broken");
    expect(promiseState(p, [], "2026-10-08").state).toBe("upcoming");
    expect(promiseState(p, [{ studentId: "s1", paymentDate: "2026-10-07", amount: 1000 }], "2026-10-11").state).toBe("broken");
  });

  it("keeps a visit with no amount once anything is paid", () => {
    expect(promiseState({ ...p, amount: 0 }, [{ studentId: "s1", paymentDate: "2026-10-10", amount: 500 }], "2026-10-12").state).toBe("kept");
  });
});

describe("EMI split", () => {
  it("adds up exactly with the rounding in the last part", () => {
    const parts = splitIntoParts(12843, 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(12843);
    expect(parts.slice(0, 3)).toEqual([3210, 3210, 3210]);
    expect(monthlyAmountFor(12843, 4)).toBe(3211);
  });

  it("schedules monthly and moves a Sunday to Monday", () => {
    const s = monthlySchedule("2026-10-10", 3);
    expect(s.map((x) => x.date)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    // 11 Oct 2026 is a Sunday.
    expect(monthlySchedule("2026-10-11", 1)[0]).toEqual({ date: "2026-10-12", movedFromSunday: true });
    // 31 Jan → end of February, not March.
    expect(monthlySchedule("2027-01-31", 2)[1].date).toBe("2027-03-01");
  });
});

describe("calls and write-offs", () => {
  it("maps the design's outcomes onto the contact log", () => {
    expect(contactOutcomeFor("promised")).toBe("promised_pay");
    expect(contactOutcomeFor("noreach")).toBe("no_answer");
    expect(contactOutcomeFor("time")).toBe("dispute");
  });

  it("accepts a write-off from ₹1 to what is owed", () => {
    expect(validWriteOffAmount(1, 500)).toBe(true);
    expect(validWriteOffAmount(500, 500)).toBe(true);
    expect(validWriteOffAmount(0, 500)).toBe(false);
    expect(validWriteOffAmount(501, 500)).toBe(false);
    expect(validWriteOffAmount(10.5, 500)).toBe(false);
  });
});
