import { describe, expect, it } from "vitest";

import { decodeMessage } from "@/platform/i18n/language";

import {
  classAliasSchema,
  compareSubjects,
  createSubjectSchema,
  feeClassName,
  joinClassesToAliases,
  mappingProgress,
  matchesSubjectSearch,
  normalizeSubjectCode,
  normalizeTimetableLabel,
  orphanedAliases,
  SUBJECT_CODE_PATTERN,
  TIMETABLE_LABEL_MAX,
  updateSubjectSchema,
  type ClassAlias,
  type FeeClass,
  type Subject,
} from "@/modules/academics/domain/subjects";

const subject = (overrides: Partial<Subject> = {}): Subject => ({
  id: "s1",
  code: "MATHS",
  nameHi: "गणित",
  nameEn: "Mathematics",
  isActive: true,
  sortOrder: 0,
  ...overrides,
});

const feeClass = (overrides: Partial<FeeClass> = {}): FeeClass => ({
  id: "c1",
  className: "Class 5",
  section: null,
  streamName: null,
  sortOrder: 8,
  sessionLabel: "TEST-2026-27",
  ...overrides,
});

const alias = (overrides: Partial<ClassAlias> = {}): ClassAlias => ({
  id: "a1",
  classId: "c1",
  sessionLabel: "TEST-2026-27",
  timetableLabel: "5",
  displayName: null,
  sortOrder: 8,
  ...overrides,
});

describe("subject codes", () => {
  it.each([
    ["maths", "MATHS"],
    ["  sst  ", "SST"],
    ["s.st", "S.ST"],
  ])("folds %s to %s", (input, expected) => {
    expect(normalizeSubjectCode(input)).toBe(expected);
  });

  it.each(["MATHS", "SST", "S.ST", "G-K", "H", "ENG2"])(
    "accepts %s",
    (value) => {
      // The school's own sheets use dots and hyphens.
      expect(SUBJECT_CODE_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    ["a space", "S ST"],
    ["a leading dot", ".ST"],
    ["a leading hyphen", "-GK"],
    ["lowercase", "maths"],
    ["too long", "ABCDEFGHIJKLMNOPQ"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    // A space is the one that matters: a timetable cell is split on whitespace,
    // so a code containing one could never be matched back.
    expect(SUBJECT_CODE_PATTERN.test(value)).toBe(false);
  });
});

describe("createSubjectSchema", () => {
  const valid = {
    code: " maths ",
    nameHi: " गणित ",
    nameEn: " Mathematics ",
    sortOrder: "10",
  };

  it("trims, folds and coerces", () => {
    const result = createSubjectSchema.parse(valid);
    expect(result.code).toBe("MATHS");
    expect(result.nameHi).toBe("गणित");
    expect(result.nameEn).toBe("Mathematics");
    expect(result.sortOrder).toBe(10);
  });

  it.each([
    ["a blank Hindi name", { nameHi: "   " }],
    ["a blank English name", { nameEn: "" }],
    ["a code with a space", { code: "S ST" }],
    ["a negative order", { sortOrder: "-1" }],
    ["a non-numeric order", { sortOrder: "abc" }],
  ])("rejects %s", (_label, patch) => {
    expect(createSubjectSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  });

  it("carries both languages so the screen can pick one", () => {
    const result = createSubjectSchema.safeParse({ ...valid, nameEn: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const decoded = decodeMessage(result.error.issues[0].message);
      expect(decoded.hi).toBeTruthy();
      expect(decoded.en).toBeTruthy();
      expect(decoded.hi).not.toBe(decoded.en);
    }
  });

  it("names the field in the reader's own language", () => {
    // "हिन्दी नाम ज़रूरी है" rather than "Hindi name ज़रूरी है" — the field's
    // own name is part of the sentence, so it has to be translated too.
    const result = createSubjectSchema.safeParse({ ...valid, nameHi: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const decoded = decodeMessage(result.error.issues[0].message);
      expect(decoded.hi).toContain("हिन्दी नाम");
      expect(decoded.en).toContain("Hindi name");
    }
  });
});

describe("updateSubjectSchema", () => {
  it("has no code field", () => {
    // Immutable, enforced by a trigger. A field the form cannot submit is a
    // clearer promise than one that submits and is rejected.
    expect(Object.keys(updateSubjectSchema.shape)).not.toContain("code");
  });
});

describe("compareSubjects()", () => {
  it("puts active before inactive", () => {
    const a = subject({ isActive: false, sortOrder: 0 });
    const b = subject({ isActive: true, sortOrder: 99 });
    expect([a, b].sort(compareSubjects)[0]).toBe(b);
  });

  it("then orders by sortOrder", () => {
    const a = subject({ sortOrder: 5, nameEn: "Aaa" });
    const b = subject({ sortOrder: 1, nameEn: "Zzz" });
    expect([a, b].sort(compareSubjects)[0]).toBe(b);
  });

  it("then falls back to the English name", () => {
    const a = subject({ sortOrder: 1, nameEn: "Zoology" });
    const b = subject({ sortOrder: 1, nameEn: "Algebra" });
    expect([a, b].sort(compareSubjects)[0]).toBe(b);
  });
});

describe("matchesSubjectSearch()", () => {
  const maths = subject();

  it.each([
    ["an empty query", ""],
    ["the code", "math"],
    ["the English name", "mathem"],
    ["the wrong case", "MATHEM"],
    ["the Hindi name", "गणित"],
  ])("matches on %s", (_label, query) => {
    expect(matchesSubjectSearch(maths, query)).toBe(true);
  });

  it("does not match something unrelated", () => {
    expect(matchesSubjectSearch(maths, "history")).toBe(false);
  });
});

describe("normalizeTimetableLabel()", () => {
  it.each([
    ["  11-S  ", "11-S"],
    ["11  S", "11 S"],
    ["11 S", "11 S"],
  ])("normalises %s to %s", (input, expected) => {
    // Collapsing inner whitespace means "11  S" and "11 S" are one label,
    // not two rows the import would see as different classes.
    expect(normalizeTimetableLabel(input)).toBe(expected);
  });
});

describe("classAliasSchema", () => {
  const valid = {
    classId: "0f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
    timetableLabel: " 11-S ",
    displayName: "",
    sortOrder: "14",
  };

  it("normalises the label and blanks the display name", () => {
    const result = classAliasSchema.parse(valid);
    expect(result.timetableLabel).toBe("11-S");
    expect(result.displayName).toBeNull();
  });

  it("rejects a classId that is not a uuid", () => {
    expect(
      classAliasSchema.safeParse({ ...valid, classId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects a blank label", () => {
    expect(
      classAliasSchema.safeParse({ ...valid, timetableLabel: "   " }).success,
    ).toBe(false);
  });

  it("rejects a label longer than the maximum", () => {
    const tooLong = "x".repeat(TIMETABLE_LABEL_MAX + 1);
    expect(
      classAliasSchema.safeParse({ ...valid, timetableLabel: tooLong }).success,
    ).toBe(false);
  });

  it("accepts the labels the school actually uses", () => {
    for (const label of ["5", "NUR", "11-S", "12 Comm", "JKG"]) {
      expect(
        classAliasSchema.safeParse({ ...valid, timetableLabel: label }).success,
        `${label} should be accepted`,
      ).toBe(true);
    }
  });
});

describe("feeClassName()", () => {
  it("joins the class and section the way the fee app does", () => {
    expect(feeClassName(feeClass({ className: "Class 5", section: "A" }))).toBe(
      "Class 5 A",
    );
  });

  it("omits an absent section rather than leaving a trailing space", () => {
    expect(feeClassName(feeClass({ section: null }))).toBe("Class 5");
  });
});

describe("joinClassesToAliases()", () => {
  const classes = [
    feeClass({ id: "c1", className: "Class 1", sortOrder: 4 }),
    feeClass({ id: "c2", className: "Class 2", sortOrder: 5 }),
    feeClass({ id: "c3", className: "Class 3", sortOrder: 6 }),
  ];

  it("pairs each class with its alias, keeping the unmapped ones", () => {
    const rows = joinClassesToAliases(classes, [alias({ classId: "c2" })]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.feeClass.id === "c2")?.alias).not.toBeNull();
    expect(rows.find((r) => r.feeClass.id === "c1")?.alias).toBeNull();
  });

  it("lists unmapped classes first", () => {
    // The screen exists to empty that list, so it puts the work at the top.
    const rows = joinClassesToAliases(classes, [alias({ classId: "c1" })]);
    expect(rows[0].feeClass.id).not.toBe("c1");
    expect(rows[rows.length - 1].feeClass.id).toBe("c1");
  });

  it("orders within each group by the fee app's sort order", () => {
    const rows = joinClassesToAliases(classes, []);
    expect(rows.map((r) => r.feeClass.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("ignores an alias whose class is not in the list", () => {
    const rows = joinClassesToAliases(classes, [alias({ classId: "gone" })]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.alias === null)).toBe(true);
  });
});

describe("orphanedAliases()", () => {
  it("finds aliases whose class no longer exists", () => {
    // There is no foreign key into `public` — one would be a write into the
    // fee app's schema (rule 2) — so nothing stops this happening. Something
    // has to notice it, and this is that something.
    const orphans = orphanedAliases(
      [feeClass({ id: "c1" })],
      [alias({ classId: "c1" }), alias({ id: "a2", classId: "gone" })],
    );
    expect(orphans.map((a) => a.id)).toEqual(["a2"]);
  });

  it("finds none when every alias resolves", () => {
    expect(
      orphanedAliases([feeClass({ id: "c1" })], [alias({ classId: "c1" })]),
    ).toEqual([]);
  });
});

describe("mappingProgress()", () => {
  const classes = [feeClass({ id: "c1" }), feeClass({ id: "c2" })];

  it("counts what is mapped", () => {
    const rows = joinClassesToAliases(classes, [alias({ classId: "c1" })]);
    expect(mappingProgress(rows)).toEqual({ mapped: 1, total: 2, complete: false });
  });

  it("is complete only when every class has a label", () => {
    const rows = joinClassesToAliases(classes, [
      alias({ classId: "c1" }),
      alias({ id: "a2", classId: "c2", timetableLabel: "2" }),
    ]);
    expect(mappingProgress(rows).complete).toBe(true);
  });

  it("is not complete when there is nothing at all", () => {
    // Zero of zero is not "done" — it means the fee app has no classes, which
    // is a different problem and must not read as a green tick.
    expect(mappingProgress([])).toEqual({ mapped: 0, total: 0, complete: false });
  });
});
