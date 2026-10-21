import { describe, expect, it } from "vitest";

import { initialMarks, markCounts } from "@/vx/screens/admin/logic";

/* Smoke run, 20 Oct: an unmarked register opened read-only as "20/20, all present". */

const roll = [{ studentId: "a" }, { studentId: "b" }];

describe("initialMarks", () => {
  it("a register only looked at starts empty, never as all present", () => {
    const marks = initialMarks(roll, {}, false);
    expect(marks).toEqual({ a: null, b: null });
    expect(markCounts(marks).marked).toBe(0);
  });
  it("for the person marking it, an unsaved register still starts present", () => {
    expect(initialMarks(roll, {})).toEqual({ a: "present", b: "present" });
  });
  it("a saved register shows what was saved either way", () => {
    expect(initialMarks(roll, { a: "absent", b: "present" }, false)).toEqual({ a: "absent", b: "present" });
  });
});
