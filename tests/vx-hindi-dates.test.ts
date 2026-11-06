import { describe, expect, it } from "vitest";
import { when } from "@/vx/screens/exams/when";

// The Hindi line of an exam timestamp had "Mon 9 Nov" and "9:40 am" in it (20-teacher day, 6 Nov 2026).
describe("exam timestamps read in Hindi", () => {
  const now = new Date("2026-11-06T10:00:00+05:30");
  it("says the time the Hindi way today and yesterday", () => {
    expect(when("2026-11-06T09:40:00+05:30", { now }).hi).toBe("आज सुबह 9:40");
    expect(when("2026-11-05T19:58:00+05:30", { now }).hi).toBe("कल शाम 7:58");
  });
  it("names the day and month in Hindi", () => {
    const week = when("2026-11-02T12:00:00+05:30", { now });
    expect(week.en).toMatch(/Mon/);
    expect(week.hi).toBe("सोम 2 नवंबर");
    expect(when("2026-09-18T12:00:00+05:30", { now }).hi).toBe("18 सितंबर");
  });
});
