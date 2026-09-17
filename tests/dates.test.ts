import { describe, expect, it } from "vitest";

import {
  addDays,
  dayLabel,
  dayOfMonth,
  daysInMonth,
  isIsoDay,
  monthBounds,
  monthLabel,
  monthOf,
  schoolToday,
  shiftMonth,
  toSchoolDay,
  weekdayLabel,
  weekdayName,
} from "@/platform/dates";

describe("the school's day", () => {
  /**
   * The whole reason this module exists. Vercel runs in UTC; the school runs
   * at UTC+05:30. Every instant between 18:30 and 23:59 UTC is already
   * tomorrow in Barmer, and `toISOString().slice(0, 10)` would file that
   * evening's work under the wrong date.
   */
  it("is tomorrow's date once it is past 18:30 UTC", () => {
    expect(toSchoolDay(new Date("2026-09-17T18:29:00Z"))).toBe("2026-09-17");
    expect(toSchoolDay(new Date("2026-09-17T18:30:00Z"))).toBe("2026-09-18");
  });

  it("is still today for the whole school morning", () => {
    // 07:40 IST, which is when the Today card is actually opened.
    expect(toSchoolDay(new Date("2026-09-17T02:10:00Z"))).toBe("2026-09-17");
  });

  it("does not roll over at UTC midnight", () => {
    // 00:30 UTC is 06:00 IST on the same date — a naive implementation that
    // used UTC would be right here and wrong twelve hours later.
    expect(toSchoolDay(new Date("2026-09-17T00:30:00Z"))).toBe("2026-09-17");
  });

  it("crosses a month boundary the school's way", () => {
    expect(toSchoolDay(new Date("2026-09-30T19:00:00Z"))).toBe("2026-10-01");
  });

  it("takes an injectable clock so this is testable at all", () => {
    expect(schoolToday(new Date("2027-01-01T20:00:00Z"))).toBe("2027-01-02");
  });
});

describe("isIsoDay()", () => {
  it.each(["2026-09-17", "2026-02-28", "2028-02-29"])("accepts %s", (day) => {
    expect(isIsoDay(day)).toBe(true);
  });

  it.each(["", "17-09-2026", "2026-9-7", "2026-02-31", "yesterday", "2026-13-01"])(
    "rejects %s",
    (day) => {
      expect(isIsoDay(day)).toBe(false);
    },
  );
});

describe("weekdays", () => {
  it("names the day the timetable sheet would write", () => {
    expect(weekdayName("2026-09-17")).toBe("Thursday");
    expect(weekdayName("2026-09-20")).toBe("Sunday");
  });

  it("labels it in both languages", () => {
    expect(weekdayLabel("2026-09-17")).toEqual({
      hi: "गुरुवार",
      en: "Thursday",
    });
  });
});

describe("months", () => {
  it("finds the first and last day, February included", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("lists every day in the month and no others", () => {
    const days = daysInMonth("2026-09");
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-01");
    expect(days.at(-1)).toBe("2026-09-30");
    expect(days.every((day) => monthOf(day) === "2026-09")).toBe(true);
  });

  it("steps across a year boundary in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("labels a month in both languages", () => {
    expect(monthLabel("2026-09")).toEqual({
      hi: "सितंबर 2026",
      en: "September 2026",
    });
  });
});

describe("days", () => {
  it("adds and subtracts across a month boundary", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("gives the register column its number", () => {
    expect(dayOfMonth("2026-09-07")).toBe(7);
  });

  it("labels a day without a leading zero", () => {
    expect(dayLabel("2026-09-07")).toEqual({ hi: "7 सितंबर", en: "7 September" });
  });
});
