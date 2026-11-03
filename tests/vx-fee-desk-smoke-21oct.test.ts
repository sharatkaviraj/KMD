import { describe, expect, it } from "vitest";

import { kidLink } from "@/vx/screens/dues/href";
import { dotJoin, srTag } from "@/vx/screens/payments/look";
import { daySeg } from "@/vx/screens/receipts/look";

/* Fee desk findings from the 21 Oct smoke run. Test data only. */

describe("Payment Desk SR line", () => {
  it("prints a real SR number", () => {
    expect(srTag("4312")).toBe("SR 4312");
    expect(srTag(" 4312 ")).toBe("SR 4312");
  });

  it("prints nothing for the office's placeholders or a blank SR", () => {
    expect(srTag("PENDING-SR-6752")).toBeNull();
    expect(srTag("PENDING-7949-2989")).toBeNull();
    expect(srTag("pending")).toBeNull();
    expect(srTag("")).toBeNull();
    expect(srTag(null)).toBeNull();
    expect(srTag(undefined)).toBeNull();
  });

  it("joins only the parts that are there, so the father's name stays without an SR", () => {
    expect(dotJoin("Class 6", srTag("PENDING-SR-6752"), "Test Father")).toBe("Class 6 · Test Father");
    expect(dotJoin(false, srTag("4312"), null, "Test Father")).toBe("SR 4312 · Test Father");
    expect(dotJoin(null, undefined, "")).toBe("");
  });
});

describe("Dues family panel: where a child's row goes", () => {
  it("opens Student 360 for a reader with students:view", () => {
    expect(kidLink("s-1", { openStudent: true, collect: true })).toEqual({ href: "/students/s-1", to: "student" });
  });

  it("opens the Payment Desk with the child picked for a reader who only collects (the accountant)", () => {
    expect(kidLink("s-1", { openStudent: false, collect: true })).toEqual({ href: "/payments?student=s-1", to: "desk" });
    expect(kidLink("s-1", { collect: true })).toEqual({ href: "/payments?student=s-1", to: "desk" });
  });

  it("offers no link to a reader who can do neither", () => {
    expect(kidLink("s-1", { openStudent: false, collect: false })).toBeNull();
  });
});

describe("Receipts day toggle", () => {
  const today = "2026-10-21";

  it("reads today as Today / Yesterday", () => {
    expect(daySeg(today, today, "today")).toEqual({ anchor: today, span: "today", first: null, second: null });
    expect(daySeg(today, today, "yesterday")).toEqual({ anchor: today, span: "yesterday", first: null, second: null });
  });

  it("reads yesterday picked by date as the Yesterday option, not a second dated chip", () => {
    const seg = daySeg("2026-10-20", today, "today");
    expect(seg).toEqual({ anchor: today, span: "yesterday", first: null, second: null });
  });

  it("dates both options for an older day, since the second is the day before it", () => {
    expect(daySeg("2026-10-15", today, "today")).toEqual({ anchor: "2026-10-15", span: "today", first: "2026-10-15", second: "2026-10-14" });
  });

  it("keeps a three-day span on yesterday anchored where it was", () => {
    expect(daySeg("2026-10-20", today, "3d")).toEqual({ anchor: "2026-10-20", span: "3d", first: "2026-10-20", second: "2026-10-19" });
  });
});
