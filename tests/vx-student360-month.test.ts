import { describe, expect, it } from "vitest";

import { monthGrid } from "@/vx/screens/admin/logic";

describe("monthGrid — the Student 360 attendance month (design F06 attendance)", () => {
  const marks = [
    { day: "2026-10-01", status: "present" as const },
    { day: "2026-10-03", status: "present" as const },
    { day: "2026-10-05", status: "half_day" as const },
    { day: "2026-10-06", status: "absent" as const },
    { day: "2026-10-07", status: "leave" as const },
    { day: "2026-09-30", status: "absent" as const },
  ];
  const grid = monthGrid(marks, "2026-10-08", (d) => d === "2026-10-02" || d === "2026-10-04");

  it("starts on Monday with blanks before the first", () => {
    // 1 October 2026 is a Thursday: three blanks (Mon–Wed).
    expect(grid.cells.slice(0, 3).every((c) => c.state === "blank")).toBe(true);
    expect(grid.cells[3]).toEqual({ day: "2026-10-01", label: "1", state: "present" });
    expect(grid.cells.filter((c) => c.state !== "blank")).toHaveLength(31);
  });

  it("keeps closed, today, future and not-marked apart", () => {
    const of = (day: string) => grid.cells.find((c) => c.day === day)?.state;
    expect(of("2026-10-02")).toBe("closed");
    expect(of("2026-10-08")).toBe("today");
    expect(of("2026-10-09")).toBe("future");
    expect(of("2026-10-04")).toBe("closed");
  });

  it("counts only marked days, leave left out, half day at its credit, and finds the last absence", () => {
    expect(grid.marked).toBe(4);
    expect(grid.present).toBe(2);
    expect(grid.percent).toBe(63); // (1 + 1 + 0.5) / 4
    expect(grid.lastAbsent).toBe("2026-10-06");
  });

  it("never turns a month with nothing marked into a percentage", () => {
    expect(monthGrid([], "2026-10-08").percent).toBeNull();
  });
});
