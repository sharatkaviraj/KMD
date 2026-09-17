import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bySchoolOrder,
  inSchoolOrder,
  rankOf,
  type ClassChoice,
} from "@/modules/academics/domain/class-order";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(repoRoot, "src");

/**
 * B-06, as a test. Four screens sorted class labels as text, so a teacher
 * looking for Class 2 found it after Class 12.
 */

const SCHOOL: ClassChoice[] = [
  { id: "n", label: "Nursery", sortOrder: 1 },
  { id: "j", label: "JKG", sortOrder: 2 },
  { id: "s", label: "SKG", sortOrder: 3 },
  { id: "c1", label: "Class 1", sortOrder: 4 },
  { id: "c2", label: "Class 2", sortOrder: 5 },
  { id: "c10", label: "Class 10", sortOrder: 13 },
  { id: "c12s", label: "12 Science", sortOrder: 19 },
];

describe("school order is not alphabetical order", () => {
  it("is the order the school already agreed on", () => {
    const shuffled = [...SCHOOL].reverse();

    expect(inSchoolOrder(shuffled).map((c) => c.label)).toEqual([
      "Nursery",
      "JKG",
      "SKG",
      "Class 1",
      "Class 2",
      "Class 10",
      "12 Science",
    ]);
  });

  it("puts Class 2 before Class 10, which sorting as text does not", () => {
    // The bug itself: "Class 10".localeCompare("Class 2") is negative.
    const asText = [...SCHOOL].sort((a, b) => a.label.localeCompare(b.label, "en"));

    expect(asText.map((c) => c.label).indexOf("Class 10")).toBeLessThan(
      asText.map((c) => c.label).indexOf("Class 2"),
    );
    expect(inSchoolOrder(SCHOOL).map((c) => c.label).indexOf("Class 2")).toBeLessThan(
      inSchoolOrder(SCHOOL).map((c) => c.label).indexOf("Class 10"),
    );
  });

  it("breaks a tie on the label, so two sections do not swap between loads", () => {
    const sections: ClassChoice[] = [
      { id: "b", label: "Class 6 B", sortOrder: 9 },
      { id: "a", label: "Class 6 A", sortOrder: 9 },
    ];

    expect(inSchoolOrder(sections).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const original = [...SCHOOL].reverse();
    const copy = [...original];

    inSchoolOrder(original);
    expect(original).toEqual(copy);
  });

  it("is a total order, so sort() is stable whichever way it is called", () => {
    for (const a of SCHOOL) {
      for (const b of SCHOOL) {
        // `+ 0` normalises the -0 that `Math.sign` returns for a tie, which
        // `Object.is` would otherwise call a different number from 0.
        expect(Math.sign(bySchoolOrder(a, b)) + 0).toBe(
          -Math.sign(bySchoolOrder(b, a)) + 0,
        );
      }
    }
  });
});

describe("ranking a subset by an ordered map", () => {
  const labels = new Map(inSchoolOrder(SCHOOL).map((c) => [c.id, c.label]));

  it("gives each class its position in the school's order", () => {
    const rank = rankOf(labels);

    expect(rank.get("n")).toBe(0);
    expect(rank.get("c2")).toBeLessThan(rank.get("c10")!);
  });

  it("lets a teacher's own classes sort without a second read", () => {
    const rank = rankOf(labels);
    const own = ["c10", "c1", "c2"];

    expect(
      [...own].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
    ).toEqual(["c1", "c2", "c10"]);
  });

  it("returns nothing for a class the map has never heard of", () => {
    expect(rankOf(labels).get("gone")).toBeUndefined();
  });
});

/* -------------------------------------------- nobody sorts labels as text */

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

const sources = walk(srcRoot).filter((file) => /\.tsx?$/.test(file));

describe("no screen sorts class labels as text again", () => {
  it("finds the files it is supposed to be guarding", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it.each(sources.map((file) => [path.relative(repoRoot, file), file]))(
    "%s does not localeCompare a class label",
    (_rel, file) => {
      const source = readFileSync(file, "utf8");

      // The exact shape that shipped on four screens. Staff names and subject
      // names are sorted as text on purpose and are not matched here.
      expect(source).not.toMatch(/\bclass[Ll]abel\b[^\n]*localeCompare/);
      expect(source).not.toMatch(/labels\.entries\(\)[\s\S]{0,120}?localeCompare/);
    },
  );
});
