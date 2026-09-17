import { describe, expect, it } from "vitest";

import { normalizeAbsences } from "@/modules/substitutions/domain/engine";
import {
  coverHistoryFrom,
  describePeriods,
  hostsInPeriod,
  isWholeDay,
  planCounts,
  teacherDetailsFrom,
  vacanciesFor,
  WHOLE_DAY,
  type PlanSlot,
} from "@/modules/substitutions/domain/plan";
import {
  absenceSchema,
  coverPolicySchema,
  isFullDay,
  policyFor,
  splitByRole,
  type CoverPolicy,
} from "@/modules/substitutions/domain/policies";

const slot = (over: Partial<PlanSlot> = {}): PlanSlot => ({
  day: "Monday",
  period: 0,
  classId: "c6",
  classLabel: "Class 6",
  subjectCode: "Maths",
  staffProfileId: "t1",
  teacherShortName: "T1",
  parallel: false,
  shared: false,
  ...over,
});

describe("vacanciesFor()", () => {
  it("finds the period a teacher is away for", () => {
    const slots = [slot({ period: 2, staffProfileId: "away" })];
    const vacancies = vacanciesFor(slots, "Monday", normalizeAbsences(["away"], 8));

    expect(vacancies).toHaveLength(1);
    expect(vacancies[0]).toMatchObject({
      classId: "c6",
      className: "Class 6",
      periodIndex: 2,
      subject: "Maths",
      originalStaffId: "away",
    });
  });

  it("ignores a day that is not the one being planned", () => {
    const slots = [slot({ day: "Tuesday", staffProfileId: "away" })];
    expect(vacanciesFor(slots, "Monday", normalizeAbsences(["away"], 8))).toEqual([]);
  });

  it("ignores a period the teacher is present for", () => {
    // A half day: away from the fifth period, so the first is still theirs.
    const slots = [slot({ period: 0, staffProfileId: "away" })];
    const half = normalizeAbsences({ away: [4, 5, 6, 7] }, 8);
    expect(vacanciesFor(slots, "Monday", half)).toEqual([]);
  });

  /**
   * The two cell shapes that pull in opposite directions, and the reason this
   * module exists at all.
   */
  it("leaves a shared block alone while anybody in it is still there", () => {
    // ELGA: one activity, five teachers. One away means four are teaching it.
    const slots = ["a", "b", "c", "d", "e"].map((id) =>
      slot({ period: 2, subjectCode: "ELGA", staffProfileId: id, shared: true }),
    );

    expect(vacanciesFor(slots, "Monday", normalizeAbsences(["a"], 8))).toEqual([]);
  });

  it("covers a shared block when everybody in it is away", () => {
    const slots = ["a", "b"].map((id) =>
      slot({ period: 2, subjectCode: "ELGA", staffProfileId: id, shared: true }),
    );

    expect(vacanciesFor(slots, "Monday", normalizeAbsences(["a", "b"], 8))).toHaveLength(
      1,
    );
  });

  it("covers a parallel elective when either half loses its teacher", () => {
    // "Biology / Maths (X / Y)" is two lessons side by side, one cohort each.
    // Reading it as co-teaching would record the Biology group as covered by
    // the person teaching Maths in the same room.
    const slots = [
      slot({ period: 6, subjectCode: "Biology", staffProfileId: "bio", parallel: true }),
      slot({ period: 6, subjectCode: "Maths", staffProfileId: "maths", parallel: true }),
    ];

    const vacancies = vacanciesFor(slots, "Monday", normalizeAbsences(["bio"], 8));
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0].subject).toBe("Biology");
  });

  it("raises one vacancy per class and period even when both halves are away", () => {
    // The room needs one cover teacher, and the unique index on
    // (plan, class, period) says the same thing.
    const slots = [
      slot({ period: 6, subjectCode: "Biology", staffProfileId: "bio", parallel: true }),
      slot({ period: 6, subjectCode: "Maths", staffProfileId: "maths", parallel: true }),
    ];

    expect(
      vacanciesFor(slots, "Monday", normalizeAbsences(["bio", "maths"], 8)),
    ).toHaveLength(1);
  });

  it("returns nothing when nobody is away", () => {
    expect(vacanciesFor([slot()], "Monday", {})).toEqual([]);
  });

  it("puts them in the order a coordinator works down the day", () => {
    const slots = [
      slot({ period: 5, classId: "b", classLabel: "Class 8", staffProfileId: "away" }),
      slot({ period: 1, classId: "a", classLabel: "Class 7", staffProfileId: "away" }),
      slot({ period: 1, classId: "c", classLabel: "Class 2", staffProfileId: "away" }),
    ];

    expect(
      vacanciesFor(slots, "Monday", normalizeAbsences(["away"], 8)).map(
        (vacancy) => `${vacancy.periodIndex}:${vacancy.className}`,
      ),
    ).toEqual(["1:Class 2", "1:Class 7", "5:Class 8"]);
  });
});

describe("teacherDetailsFrom()", () => {
  it("builds each teacher's week, keyed by staff id", () => {
    const details = teacherDetailsFrom(
      [
        slot({ period: 0, staffProfileId: "t1" }),
        slot({ day: "Tuesday", period: 3, staffProfileId: "t1", subjectCode: "EVS" }),
      ],
      ["Monday", "Tuesday"],
    );

    expect(Object.keys(details)).toEqual(["t1"]);
    expect(details.t1.schedule!.Monday[0]).toEqual({
      subject: "Maths",
      className: "Class 6",
    });
    expect(details.t1.schedule!.Monday[1]).toBeNull();
    expect(details.t1.schedule!.Tuesday[3]!.subject).toBe("EVS");
    expect([...(details.t1.subjects as Set<string>)].sort()).toEqual(["EVS", "Maths"]);
  });

  it("gives every named day a full-length row", () => {
    // A short row would make period 8 read as "no such period" rather than
    // "free", and the load facts count on the length.
    const details = teacherDetailsFrom([slot()], ["Monday", "Saturday"]);
    expect(details.t1.schedule!.Saturday).toHaveLength(8);
  });
});

describe("hostsInPeriod()", () => {
  const slots = [
    slot({ period: 3, classId: "c5", classLabel: "Class 5", staffProfileId: "t5" }),
    slot({ period: 3, classId: "c6", classLabel: "Class 6", staffProfileId: "t6" }),
  ];

  it("lists the classes still being taught", () => {
    const hosts = hostsInPeriod(slots, "Monday", 3, {}, new Map());
    expect(hosts.map((host) => host.classId).sort()).toEqual(["c5", "c6"]);
    expect(hosts.every((host) => host.teacher)).toBe(true);
  });

  it("marks a class whose teacher is away and uncovered as having nobody", () => {
    const hosts = hostsInPeriod(
      slots,
      "Monday",
      3,
      normalizeAbsences(["t5"], 8),
      new Map(),
    );

    expect(hosts.find((host) => host.classId === "c5")!.teacher).toBeNull();
  });

  it("marks a covered class as substituted, so it loses to one with its own teacher", () => {
    const hosts = hostsInPeriod(
      slots,
      "Monday",
      3,
      normalizeAbsences(["t5"], 8),
      new Map([["c5|3", "cover"]]),
    );

    const c5 = hosts.find((host) => host.classId === "c5")!;
    expect(c5.teacher).toBe("cover");
    expect(c5.substituted).toBe(true);
  });
});

describe("describePeriods()", () => {
  it("collapses a run", () => {
    expect(describePeriods([0, 1, 2, 3])).toBe("P1–P4");
  });

  it("names the whole day as the whole day", () => {
    expect(describePeriods(WHOLE_DAY)).toBe("P1–P8");
    expect(isWholeDay(WHOLE_DAY)).toBe(true);
  });

  it("lists separate runs", () => {
    expect(describePeriods([1, 4, 5])).toBe("P2, P5–P6");
  });

  it("says nothing for nothing", () => {
    expect(describePeriods([])).toBe("—");
  });
});

describe("planCounts()", () => {
  it("counts what happened to each vacancy", () => {
    const counts = planCounts(
      [
        { kind: "cover", source: "auto", coveringStaffId: "a" },
        { kind: "cover", source: "suggestion", coveringStaffId: "b" },
        { kind: "self_study", source: "auto", coveringStaffId: null },
        { kind: "merged", source: "auto", coveringStaffId: null },
      ],
      5,
    );

    expect(counts).toEqual({
      vacancies: 5,
      covered: 2,
      selfStudy: 1,
      merged: 1,
      open: 1,
      needsReview: 1,
    });
  });

  it("never reports a negative number of open periods", () => {
    // A pin can leave more rows than the engine found vacancies for.
    expect(
      planCounts([{ kind: "cover", source: "manual", coveringStaffId: "a" }], 0).open,
    ).toBe(0);
  });
});

describe("coverHistoryFrom()", () => {
  it("counts covers per teacher and ignores self study", () => {
    expect(
      coverHistoryFrom([
        { coveringStaffId: "a" },
        { coveringStaffId: "a" },
        { coveringStaffId: "b" },
        { coveringStaffId: null },
      ]),
    ).toEqual({ a: 2, b: 1 });
  });
});

/* ------------------------------------------------------------- policies */

const policy = (over: Partial<CoverPolicy> = {}): CoverPolicy => ({
  id: "p1",
  staffProfileId: "t1",
  staffName: "Test Teacher",
  shortName: "TT",
  allowedPeriods: [0, 1, 2, 3, 4, 5, 6, 7],
  coverRole: "normal",
  maxAutoCovers: 2,
  note: null,
  ...over,
});

describe("policyFor()", () => {
  it("returns the stored policy when there is one", () => {
    const stored = policy({ allowedPeriods: [4, 5, 6, 7], coverRole: "duty" });
    expect(policyFor([stored], "t1").coverRole).toBe("duty");
  });

  it("defaults to the full day and an ordinary teacher", () => {
    // Absence of a row means nobody has said anything, and the planner must
    // not have to ask whether somebody has been set up.
    const fallback = policyFor([], "nobody");
    expect(isFullDay(fallback.allowedPeriods)).toBe(true);
    expect(fallback.coverRole).toBe("normal");
    expect(fallback.maxAutoCovers).toBe(2);
  });
});

describe("splitByRole()", () => {
  it("separates the two kinds the engine ranks differently", () => {
    const split = splitByRole([
      policy({ staffProfileId: "office", coverRole: "reserve" }),
      policy({ staffProfileId: "coord", coverRole: "duty" }),
      policy({ staffProfileId: "plain", coverRole: "normal" }),
    ]);

    expect(split.reserveStaff).toEqual(["office"]);
    expect(split.dutyStaff).toEqual(["coord"]);
  });
});

describe("coverPolicySchema", () => {
  const valid = {
    staffProfileId: "0192e5b2-0000-7000-8000-000000000001",
    allowedPeriods: [4, 5, 6, 7],
    coverRole: "normal",
    maxAutoCovers: "2",
    note: "",
  };

  it("accepts a part-time window", () => {
    const parsed = coverPolicySchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.note).toBeNull();
  });

  it("sorts and de-duplicates the periods", () => {
    const parsed = coverPolicySchema.safeParse({
      ...valid,
      allowedPeriods: [5, 4, 4, 7],
    });
    expect(parsed.success && parsed.data.allowedPeriods).toEqual([4, 5, 7]);
  });

  it("refuses a window of no periods at all", () => {
    // Somebody on site for none is simply away, and that is an absence.
    expect(
      coverPolicySchema.safeParse({ ...valid, allowedPeriods: [] }).success,
    ).toBe(false);
  });

  it("refuses a cap larger than the day", () => {
    expect(
      coverPolicySchema.safeParse({ ...valid, maxAutoCovers: "20" }).success,
    ).toBe(false);
  });

  it("refuses a role it has never heard of", () => {
    expect(
      coverPolicySchema.safeParse({ ...valid, coverRole: "headmaster" }).success,
    ).toBe(false);
  });
});

describe("absenceSchema", () => {
  const valid = {
    staffProfileId: "0192e5b2-0000-7000-8000-000000000001",
    day: "2026-09-17",
    periods: [0, 1, 2, 3, 4, 5, 6, 7],
    reason: "Hospital appointment",
  };

  it("accepts a whole day", () => {
    expect(absenceSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a half day", () => {
    expect(absenceSchema.safeParse({ ...valid, periods: [4, 5, 6, 7] }).success).toBe(
      true,
    );
  });

  it("refuses an absence covering no periods", () => {
    expect(absenceSchema.safeParse({ ...valid, periods: [] }).success).toBe(false);
  });

  it("refuses a day that is not a date", () => {
    expect(absenceSchema.safeParse({ ...valid, day: "17/09/2026" }).success).toBe(false);
  });
});
