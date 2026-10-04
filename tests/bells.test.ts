import { describe, expect, it } from "vitest";

import {
  bellProblems,
  DEFAULT_BELLS,
  firstPeriodEnds,
  hhmmOf,
  isArrangeable,
  periodTiming,
  schoolClock,
} from "@/modules/timetable/domain/bells";

/** An instant given as school wall-clock time, so the tests read like the bells. */
const atSchool = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);

describe("schoolClock", () => {
  it("reads school time from any server clock", () => {
    // 23:50 UTC on the 4th is 05:20 on the 5th at school.
    expect(schoolClock(new Date("2026-10-04T23:50:00Z"))).toEqual({
      day: "2026-10-05",
      minutes: 5 * 60 + 20,
    });
  });
});

describe("the default bells", () => {
  it("are the school's regular profile: eight periods, 08:30 to 14:10, with the break", () => {
    expect(DEFAULT_BELLS.periods).toHaveLength(8);
    expect(DEFAULT_BELLS.periods[0]).toMatchObject({ starts: "08:30", ends: "09:10" });
    expect(DEFAULT_BELLS.periods[3].ends).toBe("11:10");
    expect(DEFAULT_BELLS.periods[4].starts).toBe("11:30");
    expect(DEFAULT_BELLS.periods[7].ends).toBe("14:10");
    expect(bellProblems(DEFAULT_BELLS.periods, 8)).toEqual([]);
  });

  it("put the first period's end at 09:10, the register reminder's anchor", () => {
    expect(hhmmOf(firstPeriodEnds(DEFAULT_BELLS)!)).toBe("09:10");
  });
});

describe("periodTiming", () => {
  const day = "2026-10-05";

  it("knows a period that has not started, has started and is over", () => {
    expect(periodTiming(DEFAULT_BELLS, day, 2, atSchool(day, "09:30"))).toBe("future");
    expect(periodTiming(DEFAULT_BELLS, day, 2, atSchool(day, "09:50"))).toBe("started");
    expect(periodTiming(DEFAULT_BELLS, day, 2, atSchool(day, "10:30"))).toBe("over");
  });

  it("treats other days by the calendar alone", () => {
    expect(periodTiming(DEFAULT_BELLS, "2026-10-04", 7, atSchool(day, "07:00"))).toBe("over");
    expect(periodTiming(DEFAULT_BELLS, "2026-10-06", 0, atSchool(day, "13:00"))).toBe("future");
  });

  it("will not call a period the bells do not describe safe", () => {
    expect(periodTiming(DEFAULT_BELLS, day, 9, atSchool(day, "07:00"))).toBe("unknown");
    expect(isArrangeable(DEFAULT_BELLS, day, 9, atSchool(day, "07:00"))).toBe(false);
  });

  it("does not arrange cover for the break-adjacent period once it has begun", () => {
    expect(isArrangeable(DEFAULT_BELLS, day, 4, atSchool(day, "11:20"))).toBe(true);
    expect(isArrangeable(DEFAULT_BELLS, day, 4, atSchool(day, "11:30"))).toBe(false);
  });
});

describe("bellProblems", () => {
  it("refuses overlaps, backwards windows, bad times and missing periods", () => {
    const problems = bellProblems(
      [
        { index: 0, starts: "08:30", ends: "09:10" },
        { index: 1, starts: "09:00", ends: "09:40" },
        { index: 2, starts: "10:00", ends: "09:50" },
        { index: 3, starts: "25:00", ends: "11:10" },
      ],
      5,
    );
    expect(problems.map((problem) => problem.kind).sort()).toEqual([
      "bad_time",
      "ends_before_start",
      "missing_period",
      "overlaps_previous",
    ]);
  });
});
