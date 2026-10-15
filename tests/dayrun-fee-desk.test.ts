import { describe, expect, it } from "vitest";

import { COUNTER_CONCESSION, counterConcessionRefusal, matchesDeskSearch, nameSkeleton } from "@/modules/payments/vx/domain/desk";
import { dayBookClosure } from "@/modules/receipts/vx/domain/day-close";
import { familyMatchesQuery } from "@/modules/defaulters/vx/domain/families";
import { newAdmissionSplit } from "@/modules/students-fees/domain/admission-dues";

describe("a new admission's done screen reads its installments when the views lag (admin B4)", () => {
  it("splits the scheduled installments by due date", () => {
    const rows = [
      { amount_due: 5975, due_date: "2026-04-20" },
      { amount_due: 4875, due_date: "2026-07-20" },
      { amount_due: 4875, due_date: "2026-10-20" },
      { amount_due: 4875, due_date: "2027-01-20" },
    ];
    expect(newAdmissionSplit(rows, "2026-10-14")).toEqual({ pendingToday: 10850, notDueYet: 9750, lateFeePending: 0 });
    expect(newAdmissionSplit(rows, "2026-10-20")).toEqual({ pendingToday: 15725, notDueYet: 4875, lateFeePending: 0 });
    expect(newAdmissionSplit([], "2026-10-14")).toEqual({ pendingToday: 0, notDueYet: 0, lateFeePending: 0 });
  });
});

describe("Dues search by class is exact (accountant B14)", () => {
  it("class 1 is Class 1, not Class 10, 11 or 12", () => {
    expect(familyMatchesQuery("TEST Father 9999911111 TEST Child Class 1", "class 1")).toBe(true);
    for (const c of ["Class 10", "Class 11", "12 Science"]) expect(familyMatchesQuery(`TEST Father 9999911111 TEST Child ${c}`, "class 1")).toBe(false);
    expect(familyMatchesQuery("TEST Father TEST Child 12 Science", "12 science")).toBe(true);
  });
  it("still finds a phone's last digits, names across words, and ignores double spaces", () => {
    expect(familyMatchesQuery("TEST Father 9999960767 TEST Child Class 4", "60767")).toBe(true);
    expect(familyMatchesQuery("Hukam Testwal 9999960767 Tanmay Parikhya Nursery", "tanmay  hukam")).toBe(true);
    expect(familyMatchesQuery("Hukam Testwal 9999960767 Tanmay Parikhya Nursery", "charvi")).toBe(false);
  });
});

describe("the Day book reports the close made on Receipts (accountant B5)", () => {
  const fee = { status: "open", closedAt: null, closedByName: null };
  it("uses the desk's close when there is one", () => {
    expect(dayBookClosure(null, [{ action: "close", createdAt: "2026-10-14T19:03:00Z", actorName: "TEST Accountant" }])).toEqual({ status: "closed", closedAt: "2026-10-14T19:03:00Z", closedByName: "TEST Accountant" });
    expect(dayBookClosure(fee, [{ action: "close", createdAt: "2026-10-14T19:03:00Z", actorName: null }])?.status).toBe("closed");
  });
  it("says reopened when the latest desk event reopened the day", () => {
    expect(dayBookClosure(null, [
      { action: "close", createdAt: "2026-10-14T19:03:00Z" },
      { action: "reopen", createdAt: "2026-10-14T19:30:00Z", actorName: "TEST Admin" },
    ])).toEqual({ status: "reopened", closedAt: null, closedByName: "TEST Admin" });
  });
  it("falls back to the fee app's closure when the desk has none", () => {
    expect(dayBookClosure(fee, [])).toBe(fee);
    expect(dayBookClosure(null, [])).toBeNull();
  });
});

// Regressions from the 14 Oct school-day run (.dayrun/reports/accountant.md).

describe("counter concession is off (accountant B1)", () => {
  it("the desk sends no concession", () => {
    expect(COUNTER_CONCESSION).toBe(0);
  });

  it("the server refuses any concession and lets a plain payment through", () => {
    expect(counterConcessionRefusal(undefined)).toBeNull();
    expect(counterConcessionRefusal(null)).toBeNull();
    expect(counterConcessionRefusal(0)).toBeNull();
    expect(counterConcessionRefusal(500)).toMatch(/did not lower the dues/);
    expect(counterConcessionRefusal(-1)).not.toBeNull();
    expect(counterConcessionRefusal(Number.NaN)).not.toBeNull();
  });
});

describe("forgiving desk search (accountant B9)", () => {
  const s = { name: "Tanmay Parikhya", sr: "9100", father: "Hukam Testwal", classLabel: "Nursery", phone: "9999960767" };

  it("still finds by name, SR, father and phone digits", () => {
    for (const q of ["tanmay", "tanmay pari", "9100", "SR 9100", "60767", "9999960767", "hukam"]) expect(matchesDeskSearch(s, q)).toBe(true);
  });

  it("collapses repeated spaces and matches every word across name and father", () => {
    expect(matchesDeskSearch(s, "Tanmay  Parikhya")).toBe(true);
    expect(matchesDeskSearch(s, "tanmay hukam")).toBe(true);
    expect(matchesDeskSearch(s, "hukam tanmay")).toBe(true);
    expect(matchesDeskSearch(s, "99999 60767")).toBe(true);
  });

  it("tolerates the usual spelling variants", () => {
    expect(matchesDeskSearch(s, "tanmy")).toBe(true);
    expect(matchesDeskSearch(s, "parikya")).toBe(true);
    expect(nameSkeleton("Namoona")).toBe(nameSkeleton("Namuna"));
  });

  it("does not match a different child", () => {
    expect(matchesDeskSearch(s, "charvi")).toBe(false);
    expect(matchesDeskSearch(s, "tanmay charvi")).toBe(false);
    expect(matchesDeskSearch(s, "12345")).toBe(false);
    expect(matchesDeskSearch(s, "ta")).toBe(true); // a plain substring, as before
    expect(matchesDeskSearch(s, "xyz")).toBe(false);
  });
});
