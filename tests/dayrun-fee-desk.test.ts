import { describe, expect, it } from "vitest";

import { COUNTER_CONCESSION, counterConcessionRefusal, matchesDeskSearch, nameSkeleton } from "@/modules/payments/vx/domain/desk";
import { dayBookClosure } from "@/modules/receipts/vx/domain/day-close";

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
