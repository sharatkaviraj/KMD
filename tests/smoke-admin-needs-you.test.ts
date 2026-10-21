import { describe, expect, it } from "vitest";

import { deskReason } from "@/modules/dashboard/domain/desk-reason";
import { registerLate } from "@/vx/screens/admin/logic";
import { sortLeaveByUrgency } from "@/vx/screens/timetable/domain/timetable";

/* Smoke run, 20 Oct: Needs you at 0:02, raw reason codes, and past leave on top. */

const bells = [
  { starts: "08:30", ends: "09:10" },
  { starts: "09:10", ends: "09:50" },
  { starts: "13:30", ends: "14:10" },
];
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

describe("registerLate", () => {
  it("is quiet at midnight and before the first period ends", () => {
    expect(registerLate(bells, at("00:02"))).toBe(false);
    expect(registerLate(bells, at("09:09"))).toBe(false);
  });
  it("raises it from the end of the first period until the last bell", () => {
    expect(registerLate(bells, at("09:10"))).toBe(true);
    expect(registerLate(bells, at("14:09"))).toBe(true);
    expect(registerLate(bells, at("14:10"))).toBe(false);
  });
  it("no bells, nothing to judge by", () => {
    expect(registerLate([], at("10:00"))).toBe(false);
  });
});

describe("deskReason", () => {
  it("says the reason in words with the note and who asked, never the code", () => {
    const r = deskReason("wrong_amount", "Typed 5000 for 500", "QA Accountant");
    expect(r.en).toBe("Wrong amount typed · Typed 5000 for 500 · asked by QA Accountant");
    expect(r.hi).toBe("ग़लत राशि लिखी · Typed 5000 for 500 · QA Accountant ने माँगा");
    expect(deskReason("duplicate", null, null)).toEqual({ en: "Entered twice", hi: "दो बार दर्ज" });
    expect(deskReason("cheque_bounced", null, null).en).toBe("Cheque bounced");
    expect(deskReason("wrong_student", null, null).hi).toBe("ग़लत विद्यार्थी");
  });
  it("an unknown code still reads as words", () => {
    expect(deskReason("fee_waived_by_trust", null, null).en).toBe("Fee waived by trust");
    expect(deskReason(null, null, null).en).toBe("—");
  });
});

describe("sortLeaveByUrgency", () => {
  it("puts leave for days already gone last, and the soonest first", () => {
    const rows = [
      { id: "past", from: "2026-10-13", to: "2026-10-14" },
      { id: "later", from: "2026-10-23", to: "2026-10-23" },
      { id: "today", from: "2026-10-20", to: "2026-10-20" },
    ];
    expect(sortLeaveByUrgency(rows, "2026-10-20").map((r) => r.id)).toEqual(["today", "later", "past"]);
  });
});
