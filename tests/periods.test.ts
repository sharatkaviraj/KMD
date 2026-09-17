import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";
import {
  isPeriodIndex,
  periodIndex,
  periodNumber,
} from "@/modules/timetable/domain/periods";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

describe("what a period is called", () => {
  it("turns the sheet's first column into Period 1", () => {
    expect(periodNumber(0)).toBe(1);
    expect(periodNumber(PERIOD_COUNT - 1)).toBe(PERIOD_COUNT);
  });

  it("goes back the other way", () => {
    for (let index = 0; index < PERIOD_COUNT; index += 1) {
      expect(periodIndex(periodNumber(index))).toBe(index);
    }
  });

  it("knows which indexes are real periods", () => {
    expect(isPeriodIndex(0)).toBe(true);
    expect(isPeriodIndex(PERIOD_COUNT - 1)).toBe(true);
    expect(isPeriodIndex(PERIOD_COUNT)).toBe(false);
    expect(isPeriodIndex(-1)).toBe(false);
    expect(isPeriodIndex(1.5)).toBe(false);
  });

  it("never calls anything Period 0", () => {
    // The bug itself: `timetable_slots.period` runs 0–7 and the teacher's Today
    // card printed it raw, so her first lesson of the day read "0".
    for (let index = 0; index < PERIOD_COUNT; index += 1) {
      expect(periodNumber(index)).toBeGreaterThan(0);
    }
  });
});

/* ------------------------------------------------- nobody does it by hand */

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const components = walk(srcRoot).filter((file) => file.endsWith(".tsx"));

describe("every screen asks the same function", () => {
  it("finds the components it is supposed to be guarding", () => {
    // A glob that matches nothing is a test that always passes (D-96).
    expect(components.length).toBeGreaterThan(10);
  });

  it.each(components.map((file) => [path.relative(repoRoot, file), file]))(
    "%s does not add one to a period itself",
    (_rel, file) => {
      const source = readFileSync(file, "utf8");

      // Six screens each remembered the `+ 1` and one forgot. The point of
      // `periodNumber()` is that there is nothing left to remember, so the
      // shape that used to be everywhere has to stay gone.
      expect(source).not.toMatch(/\bperiod\s*\+\s*1\b/);
    },
  );

  it.each(components.map((file) => [path.relative(repoRoot, file), file]))(
    "%s does not render a raw period index",
    (_rel, file) => {
      const source = readFileSync(file, "utf8");

      // `{slot.period}` / `{cell.period}` / `{period}` as JSX *children* is
      // the exact shape of the bug: a 0-based index put in front of a teacher.
      //
      // `=` and `$` are excluded because `key={period}`, `period={row.period}`
      // and `` `${slot.period}` `` are all passing the index around, which is
      // what it is for. Only printing it is wrong.
      expect(source).not.toMatch(/(?<![=$])\{\s*(?:\w+\.)?period\s*\}/);
    },
  );
});
