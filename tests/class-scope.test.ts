import { describe, expect, it } from "vitest";

import {
  EVERY_CLASS,
  isEffectiveOn,
  ownClasses,
  scopeIncludes,
  withinScope,
} from "@/modules/attendance/domain/class-scope";

describe("class scope", () => {
  const mine = ownClasses(["c6", "c7", "c6"]);

  it("holds a teacher to her own classes", () => {
    expect(scopeIncludes(mine, "c6")).toBe(true);
    expect(scopeIncludes(mine, "c9")).toBe(false);
    expect(mine.everyClass ? [] : mine.classIds).toEqual(["c6", "c7"]);
  });

  it("gives the school-wide roles every class", () => {
    expect(scopeIncludes(EVERY_CLASS, "c9")).toBe(true);
  });

  it("never matches a missing class", () => {
    // A child with no enrolment is nobody's — including the office's page,
    // which shows that state itself rather than through the scope.
    expect(scopeIncludes(EVERY_CLASS, null)).toBe(false);
    expect(scopeIncludes(mine, undefined)).toBe(false);
  });

  it("filters a list to the scope", () => {
    const rows = [{ c: "c6" }, { c: "c9" }, { c: null }];
    expect(withinScope(mine, rows, (row) => row.c)).toEqual([{ c: "c6" }]);
    expect(withinScope(EVERY_CLASS, rows, (row) => row.c)).toHaveLength(3);
  });
});

describe("isEffectiveOn", () => {
  const day = "2026-10-05";

  it("holds an open assignment", () => {
    expect(isEffectiveOn({ effectiveFrom: "2026-04-01", effectiveTo: null }, day)).toBe(true);
    expect(isEffectiveOn({ effectiveFrom: null, effectiveTo: null }, day)).toBe(true);
  });

  it("does not hand a class over before its start date", () => {
    expect(isEffectiveOn({ effectiveFrom: "2026-10-12", effectiveTo: null }, day)).toBe(false);
  });

  it("ends the day after the last day, not the day somebody nulls a column", () => {
    expect(isEffectiveOn({ effectiveFrom: "2026-04-01", effectiveTo: day }, day)).toBe(true);
    expect(isEffectiveOn({ effectiveFrom: "2026-04-01", effectiveTo: "2026-10-04" }, day)).toBe(false);
  });
});
