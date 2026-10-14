import { describe, expect, it } from "vitest";

import { day, dayRange, firstName, minutesSince, time12, timeLeft, whenOn } from "@/vx/screens/accounts/when";

describe("the accountant's times, written as the design writes them", () => {
  it("writes a clock time with am/pm", () => {
    expect(time12("2026-10-08T10:38:00+05:30")).toBe("10:38 am");
    expect(time12("2026-10-08T17:22:00+05:30")).toBe("5:22 pm");
  });

  it("writes a day without the comma", () => {
    expect(day("2026-10-08")).toBe("Thu 8 Oct");
  });

  it("says when relative to the school day", () => {
    expect(whenOn("2026-10-08T09:40:00+05:30", "2026-10-08")).toBe("9:40 am");
    expect(whenOn("2026-10-07T16:05:00+05:30", "2026-10-08")).toBe("yesterday");
    expect(whenOn("2026-10-06T11:20:00+05:30", "2026-10-08")).toBe("Tue 6 Oct");
  });

  it("joins a range inside one month and across two", () => {
    expect(dayRange("2026-10-07", "2026-10-08")).toBe("Wed 7 – Thu 8 Oct");
    // en-IN writes September "Sept" in newer ICU data.
    expect(dayRange("2026-09-30", "2026-10-01")).toMatch(/^Wed 30 Sept? – Thu 1 Oct$/);
    expect(dayRange("2026-10-08", "2026-10-08")).toBe("Thu 8 Oct");
    expect(dayRange(undefined, undefined)).toBe("");
  });

  it("greets by first name past an honorific", () => {
    expect(firstName("Ms. Neelam Sharma")).toBe("Neelam");
    expect(firstName("Neelam Sharma")).toBe("Neelam");
  });

  it("counts the time left until the counter closes, and nothing after", () => {
    expect(timeLeft(17 * 60 + 30, new Date("2026-10-08T10:42:00+05:30"))).toBe("6 h 48 m");
    expect(timeLeft(17 * 60 + 30, new Date("2026-10-08T17:10:00+05:30"))).toBe("20 m");
    expect(timeLeft(17 * 60 + 30, new Date("2026-10-08T17:31:00+05:30"))).toBeNull();
  });

  it("never counts negative minutes", () => {
    expect(minutesSince("2026-10-08T10:39:00+05:30", new Date("2026-10-08T10:42:30+05:30"))).toBe(3);
    expect(minutesSince("2026-10-08T10:45:00+05:30", new Date("2026-10-08T10:42:00+05:30"))).toBe(0);
  });
});
