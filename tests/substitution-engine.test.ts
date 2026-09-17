import { describe, expect, it } from "vitest";

import {
  AUTO_TIERS,
  buildTeacherProfiles,
  canCombine,
  canonicalSubject,
  chooseMergeHost,
  generatePlan,
  isAbsentAt,
  isFullDayShift,
  isOnShift,
  MODIFIER_CAP,
  normalizeAbsences,
  normalizeShifts,
  planIsStale,
  rankCandidates,
  shiftPeriods,
  shiftsToPolicyOverrides,
  TIER_GAP,
  TIER_ORDER,
  TIER_SCORE,
  tierDominates,
  validateAssignment,
  absentNames,
  type PolicyOverride,
  type ScheduleSlot,
  type TeacherSchedule,
} from "@/modules/substitutions/domain/engine";

/**
 * Ported from `timetable2025/tests/substitution-engine.test.js`, which has
 * guarded this engine in production for a year. SOURCES.md says to port the
 * tests first, so these came across before the code did.
 *
 * Four of the original's tests are **not** here, and all four test the other
 * repo rather than the engine: the bell schedules and the v11 roster belong to
 * its `data.js` (VPPS One's equivalent is `tests/parse-timetable.test.ts` and
 * `tests/timetable-import.test.ts`), the i18n parity check belongs to its
 * `i18n.js` (VPPS One's is in `tests/language.test.ts`), and the two
 * `DEFAULT_SHIFTS` tests assert a hard-coded teacher's part-time hours that
 * rule 6 forbids putting in this repo at all — those hours are rows in
 * `cover_policies` now, and `shiftsToPolicyOverrides` is still tested here
 * with invented names.
 *
 * The persistence tests became `planIsStale()`: plans are database rows here,
 * so pruning is a query, but "a plan built on a different timetable is stale"
 * is still a rule worth stating.
 */

const schedule = (periods: Record<number, ScheduleSlot> = {}): TeacherSchedule => {
  const result: (ScheduleSlot | null)[] = Array(8).fill(null);
  for (const [index, value] of Object.entries(periods)) {
    result[Number(index)] = value;
  }
  return { Monday: result };
};

function profileInput() {
  return {
    teacherDetails: {
      Asha: {
        subjects: new Set(["Physics", "Science"]),
        schedule: schedule({ 0: { subject: "Physics", className: "Class 11 Science" } }),
      },
      Bela: {
        subjects: new Set(["Science"]),
        schedule: schedule({ 3: { subject: "Science", className: "Class 9" } }),
      },
      Charu: {
        subjects: new Set(["Sports"]),
        schedule: schedule({}),
      },
    },
    roster: ["Asha", "Bela", "Charu"],
    policyOverrides: {} as Record<string, PolicyOverride>,
  };
}

function baseInput() {
  return {
    day: "Monday",
    periodCount: 8,
    teacherProfiles: buildTeacherProfiles(profileInput()),
    absentTeachers: [] as string[],
    assignments: [],
    policy: { maxConsecutive: 3 },
  };
}

/* ------------------------------------------------------- the tier ladder */

describe("profiles", () => {
  it("merges timetable experience with explicit policy", () => {
    const input = profileInput();
    input.policyOverrides.Charu = {
      canCover: ["Math"],
      gradeBands: ["primary"],
      availability: { allowedPeriodIndexes: [4, 5] },
      maxAutoSubstitutions: 1,
    };

    const profiles = buildTeacherProfiles(input);
    expect(canonicalSubject(" Mathematics ")).toBe("maths");
    expect(profiles.Charu.canCover.has("maths")).toBe(true);
    expect(profiles.Charu.maxAutoSubstitutions).toBe(1);
    expect(profiles.Asha.grades.has(11)).toBe(true);
  });
});

describe("the tier ladder", () => {
  it("runs class+subject, class, subject, approved, related, general", () => {
    const input = baseInput();

    // Asha teaches Physics to Class 11 Science: both the class and the subject.
    const physics = rankCandidates({
      ...input,
      vacancy: {
        slotId: "physics",
        periodIndex: 2,
        subject: "Physics",
        className: "Class 11 Science",
      },
    });
    expect(physics[0].teacher).toBe("Asha");
    expect(physics[0].matchTier).toBe("class_subject");
    expect(physics[0].autoEligible).toBe(true);

    // Same class, a subject she does not teach: still the class she knows, and
    // still automatic — the timetable is the school's own evidence that she
    // works with these children.
    const biology = rankCandidates({
      ...input,
      vacancy: {
        slotId: "biology",
        periodIndex: 2,
        subject: "Biology",
        className: "Class 11 Science",
      },
    });
    const ashaOnBiology = biology.find((item) => item.teacher === "Asha")!;
    expect(ashaOnBiology.matchTier).toBe("class");
    expect(ashaOnBiology.autoEligible).toBe(true);
    expect(ashaOnBiology.warnings).toContain("class_not_subject");

    // A teacher with neither the class nor the subject stays a review-only
    // suggestion.
    const charuOnBiology = biology.find((item) => item.teacher === "Charu")!;
    expect(charuOnBiology.matchTier).toBe("general");
    expect(charuOnBiology.autoEligible).toBe(false);
  });

  it("puts a teacher who knows the class above an outside subject specialist", () => {
    // Bela takes Class 9 for Science. Asha is the Physics specialist but has
    // never stood in front of Class 9. For a Class 9 Physics vacancy the
    // children get the teacher they know.
    const ranked = rankCandidates({
      ...baseInput(),
      vacancy: {
        slotId: "c9physics",
        periodIndex: 5,
        subject: "Physics",
        className: "Class 9",
      },
    });

    const bela = ranked.find((item) => item.teacher === "Bela")!;
    const asha = ranked.find((item) => item.teacher === "Asha")!;

    expect(bela.matchTier).toBe("class");
    expect(asha.matchTier).toBe("exact");
    expect(ranked[0].teacher).toBe("Bela");
    expect(bela.score).toBeGreaterThan(asha.score);
    expect(bela.autoEligible).toBe(true);
  });

  it("survives the worst possible load, fatigue and history", () => {
    // The guarantee is arithmetic, not a hope: tier bases are spaced further
    // apart than twice the modifier clamp, so no combination of penalties can
    // lift one tier past another.
    TIER_ORDER.slice(1).forEach((worse, index) => {
      const better = TIER_ORDER[index];
      expect(tierDominates(better, worse), `${better} must outrank ${worse}`).toBe(true);
    });

    // And the spacing that makes it true, stated directly.
    expect(MODIFIER_CAP * 2).toBeLessThan(TIER_GAP);

    // Demonstrated end to end: a class-familiar teacher buried under every
    // penalty the scorer can apply still beats a fresh subject specialist.
    const ranked = rankCandidates({
      ...baseInput(),
      vacancy: {
        slotId: "c9physics",
        periodIndex: 7,
        subject: "Physics",
        className: "Class 9",
      },
      assignments: [
        { slotId: "x", teacher: "Bela", periodIndex: 4 },
        { slotId: "y", teacher: "Bela", periodIndex: 5 },
        { slotId: "z", teacher: "Bela", periodIndex: 6 },
      ],
      coverHistory: { Bela: 50 },
    });

    expect(
      ranked.find((item) => item.teacher === "Bela")!.score,
    ).toBeGreaterThan(ranked.find((item) => item.teacher === "Asha")!.score);
  });

  it("only ever auto-assigns the four tiers that mean something to the class", () => {
    expect(AUTO_TIERS).toEqual(["class_subject", "class", "exact", "approved"]);
    expect(TIER_SCORE.reserve).toBeLessThan(TIER_SCORE.last_resort);
  });
});

/* ------------------------------------------------ hard availability rules */

describe("hard availability rules", () => {
  it("blocks the absent, the busy, the unavailable and the already assigned", () => {
    const input = baseInput();
    input.teacherProfiles.Charu.availability = { allowedPeriodIndexes: [4] };

    const absent = validateAssignment({
      ...input,
      teacher: "Bela",
      absentTeachers: ["Bela"],
      vacancy: { slotId: "v1", periodIndex: 2, subject: "Science", className: "Class 9" },
    });
    expect(absent.errors).toEqual(["absent"]);

    const busy = validateAssignment({
      ...input,
      teacher: "Asha",
      vacancy: { slotId: "v2", periodIndex: 0, subject: "Physics", className: "Class 10" },
    });
    expect(busy.errors).toContain("regular_class");

    const unavailable = validateAssignment({
      ...input,
      teacher: "Charu",
      vacancy: { slotId: "v3", periodIndex: 2, subject: "Sports", className: "Class 7" },
    });
    expect(unavailable.errors).toContain("unavailable");

    const doubleBooked = validateAssignment({
      ...input,
      teacher: "Bela",
      assignments: [{ slotId: "other", teacher: "Bela", periodIndex: 2 }],
      vacancy: { slotId: "v4", periodIndex: 2, subject: "Science", className: "Class 8" },
    });
    expect(doubleBooked.errors).toContain("double_booked");
  });

  it("refuses a name it has never heard of", () => {
    const check = validateAssignment({
      ...baseInput(),
      teacher: "Nobody",
      vacancy: { slotId: "v", periodIndex: 2, subject: "Science", className: "Class 9" },
    });
    expect(check.valid).toBe(false);
    expect(check.canOverride).toBe(false);
    expect(check.errors).toEqual(["unknown_teacher"]);
  });
});

/* --------------------------------------------------------- whole-day plan */

describe("allocating a whole day at once", () => {
  it("preserves the scarce specialist and is deterministic", () => {
    const input = baseInput();
    const vacancies = [
      {
        slotId: "science",
        periodIndex: 2,
        subject: "Science",
        className: "Class 9",
        originalTeacher: "Absent 1",
      },
      {
        slotId: "physics",
        periodIndex: 2,
        subject: "Physics",
        className: "Class 11 Science",
        originalTeacher: "Absent 2",
      },
    ];

    const first = generatePlan({ ...input, vacancies });
    const second = generatePlan({ ...input, vacancies });

    expect(first).toEqual(second);
    expect(first.assignments).toHaveLength(2);
    expect(
      first.assignments.find((item) => item.slotId === "physics")!.teacher,
    ).toBe("Asha");
    expect(
      first.assignments.find((item) => item.slotId === "science")!.teacher,
    ).toBe("Bela");
    expect(new Set(first.assignments.map((item) => item.teacher)).size).toBe(2);
  });

  it("suggests the generic fallback but never assigns it", () => {
    const result = generatePlan({
      ...baseInput(),
      vacancies: [
        {
          slotId: "maths",
          periodIndex: 5,
          subject: "Maths",
          className: "Class 5",
          originalTeacher: "Absent",
        },
      ],
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.reviewSuggestions).toHaveLength(1);
    expect(result.reviewSuggestions[0].matchTier).toBe("general");
  });

  it("respects the two-substitution daily limit", () => {
    const input = baseInput();
    const result = generatePlan({
      ...input,
      teacherProfiles: { Asha: input.teacherProfiles.Asha },
      vacancies: [
        { slotId: "a", periodIndex: 2, subject: "Physics", className: "Class 11 Science" },
        { slotId: "b", periodIndex: 4, subject: "Physics", className: "Class 11 Science" },
        { slotId: "c", periodIndex: 6, subject: "Physics", className: "Class 11 Science" },
      ],
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.reviewSuggestions).toHaveLength(1);

    // A coordinator may still go over it deliberately.
    const override = validateAssignment({
      ...input,
      teacher: "Asha",
      assignments: [
        { slotId: "a", teacher: "Asha", periodIndex: 2 },
        { slotId: "b", teacher: "Asha", periodIndex: 4 },
      ],
      vacancy: { slotId: "c", periodIndex: 6, subject: "Physics", className: "Class 11 Science" },
    });

    expect(override.canOverride).toBe(true);
    expect(override.warnings).toContain("over_substitution_limit");
  });
});

/* -------------------------------------------------- fatigue and spreading */

/** Two teachers, identical in every way the scorer can see. */
function twinsInput(scheduleA: TeacherSchedule, scheduleB: TeacherSchedule) {
  return {
    day: "Monday",
    periodCount: 8,
    teacherProfiles: buildTeacherProfiles({
      teacherDetails: {
        Twin1: { subjects: new Set(["Sports"]), schedule: scheduleA },
        Twin2: { subjects: new Set(["Sports"]), schedule: scheduleB },
      },
      roster: ["Twin1", "Twin2"],
    }),
    absentTeachers: [] as string[],
    assignments: [],
    policy: { maxConsecutive: 3 },
  };
}

describe("fatigue", () => {
  it("avoids taking a teacher's last free period", () => {
    const busy = (subject: string) => ({ subject, className: "Class 7" });
    // Twin1 has one period left after covering; Twin2 would have none.
    const input = twinsInput(
      schedule({
        0: busy("Sports"),
        1: busy("Sports"),
        2: busy("Sports"),
        3: busy("Sports"),
        4: busy("Sports"),
      }),
      schedule({
        0: busy("Sports"),
        1: busy("Sports"),
        2: busy("Sports"),
        3: busy("Sports"),
        4: busy("Sports"),
        5: busy("Sports"),
        6: busy("Sports"),
      }),
    );

    const ranked = rankCandidates({
      ...input,
      vacancy: { slotId: "v", periodIndex: 7, subject: "Sports", className: "Class 7" },
    });

    const one = ranked.find((item) => item.teacher === "Twin1")!;
    const none = ranked.find((item) => item.teacher === "Twin2")!;

    expect(none.load.freeAfter).toBe(0);
    expect(one.load.freeAfter).toBeGreaterThan(0);
    expect(one.score).toBeGreaterThan(none.score);
    expect(ranked[0].teacher).toBe("Twin1");
  });

  it("penalises a long consecutive run more steeply than a short one", () => {
    const busy = { subject: "Sports", className: "Class 7" };
    // Both teach four periods and both keep three free, so day load and free
    // time cancel out and only the shape of the day differs. Covering P5,
    // Twin1's period stands alone while Twin2's extends a block to four.
    const input = twinsInput(
      schedule({ 0: busy, 1: busy, 6: busy, 7: busy }),
      schedule({ 1: busy, 2: busy, 3: busy, 7: busy }),
    );

    const ranked = rankCandidates({
      ...input,
      vacancy: { slotId: "v", periodIndex: 4, subject: "Sports", className: "Class 7" },
    });

    const short = ranked.find((item) => item.teacher === "Twin1")!;
    const long = ranked.find((item) => item.teacher === "Twin2")!;

    expect(short.load.regular).toBe(long.load.regular);
    expect(short.load.freeAfter).toBe(long.load.freeAfter);
    expect(short.load.consecutiveAfter).toBe(2);
    expect(long.load.consecutiveAfter).toBe(4);
    expect(short.score).toBeGreaterThan(long.score);
    expect(long.warnings).toContain("excessive_consecutive");
    expect(ranked[0].teacher).toBe("Twin1");
  });
});

describe("load spreading", () => {
  it("gives two vacancies to two teachers rather than both to one", () => {
    // Identical twins, two vacancies, and a per-teacher cap of 2 — so one
    // teacher *could* legally take both. The convex cost is what stops it.
    const plan = generatePlan({
      ...twinsInput(schedule({}), schedule({})),
      vacancies: [
        { slotId: "v1", periodIndex: 2, subject: "Sports", className: "Class 7" },
        { slotId: "v2", periodIndex: 5, subject: "Sports", className: "Class 7" },
      ],
    });

    expect(plan.assignments).toHaveLength(2);
    expect(new Set(plan.assignments.map((item) => item.teacher)).size).toBe(2);
  });

  it("never double-books one teacher in the same period, even as a suggestion", () => {
    // Two classes need cover in the same period and only the twins are free.
    // Suggestions used to be read off a matrix built before any of them were
    // made, so the top-ranked teacher was offered for both at once.
    const plan = generatePlan({
      ...twinsInput(schedule({}), schedule({})),
      vacancies: [
        { slotId: "a", periodIndex: 3, subject: "History", className: "Class 6" },
        { slotId: "b", periodIndex: 3, subject: "History", className: "Class 8" },
      ],
    });

    const proposed = [...plan.assignments, ...plan.reviewSuggestions];
    const inPeriod3 = proposed
      .filter((item) => item.periodIndex === 3)
      .map((item) => item.teacher);

    expect(new Set(inPeriod3).size).toBe(inPeriod3.length);
  });

  it("spreads leftover periods instead of stacking them on one teacher", () => {
    // Four vacancies, nobody qualified, per-teacher auto cap of 2. All four
    // fall to the suggestion path — which must still share them out.
    const plan = generatePlan({
      ...twinsInput(schedule({}), schedule({})),
      vacancies: [0, 1, 2, 3].map((index) => ({
        slotId: `v${index}`,
        periodIndex: index,
        subject: "History",
        className: "Class 6",
      })),
    });

    const proposed = [...plan.assignments, ...plan.reviewSuggestions];
    expect(proposed).toHaveLength(4);

    const perTeacher: Record<string, number> = {};
    for (const item of proposed) {
      perTeacher[item.teacher] = (perTeacher[item.teacher] ?? 0) + 1;
    }
    expect(Object.values(perTeacher).sort()).toEqual([2, 2]);
  });

  it("puts the daily cap above a better match while anyone else is free", () => {
    // Star teaches the class (top tier); Spare has no connection at all
    // (bottom tier). Four vacancies, a cap of two. Tier order would hand every
    // period to Star, so the cap has to be a rule rather than a score.
    const busy = { subject: "History", className: "Class 6" };
    const profiles = buildTeacherProfiles({
      teacherDetails: {
        Star: {
          subjects: new Set<string>(),
          schedule: { Monday: [busy, null, null, null, null, null, null, null] },
        },
        Spare: { subjects: new Set<string>(), schedule: { Monday: Array(8).fill(null) } },
      },
      roster: ["Star", "Spare"],
    });

    const plan = generatePlan({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: profiles,
      absentTeachers: [],
      policy: { maxConsecutive: 3 },
      vacancies: [1, 2, 3, 4].map((index) => ({
        slotId: `v${index}`,
        periodIndex: index,
        subject: "History",
        className: "Class 6",
      })),
    });

    const proposed = [...plan.assignments, ...plan.reviewSuggestions];
    const perTeacher: Record<string, number> = {};
    for (const item of proposed) {
      perTeacher[item.teacher] = (perTeacher[item.teacher] ?? 0) + 1;
    }

    expect(perTeacher.Star).toBe(2);
    expect(perTeacher.Spare).toBe(2);
  });
});

describe("cover history", () => {
  it("pushes a teacher who covered recently down the ranking", () => {
    const ranked = rankCandidates({
      ...twinsInput(schedule({}), schedule({})),
      vacancy: { slotId: "v", periodIndex: 3, subject: "Sports", className: "Class 7" },
      coverHistory: { Twin1: 6 },
    });

    const busy = ranked.find((item) => item.teacher === "Twin1")!;
    const rested = ranked.find((item) => item.teacher === "Twin2")!;

    expect(busy.recentCovers).toBe(6);
    expect(rested.recentCovers).toBe(0);
    expect(rested.score).toBeGreaterThan(busy.score);
    expect(ranked[0].teacher).toBe("Twin2");
  });

  it("caps the debt, so a heavy fortnight is not a permanent demotion", () => {
    const input = twinsInput(schedule({}), schedule({}));
    const rank = (history: number) =>
      rankCandidates({
        ...input,
        vacancy: { slotId: "v", periodIndex: 3, subject: "Sports", className: "Class 7" },
        coverHistory: { Twin1: history },
      }).find((item) => item.teacher === "Twin1")!.score;

    expect(rank(40)).toBe(rank(400));
  });
});

/* ------------------------------------------------------ combining classes */

describe("combining two classes", () => {
  it("only combines within one grade", () => {
    expect(canCombine("Class 5", "Class 6")).toBe(true);
    expect(canCombine("Class 5", "Class 4")).toBe(true);
    expect(canCombine("Class 11 Science", "Class 11 Arts")).toBe(true);
    expect(canCombine("Class 1", "Class 9")).toBe(false);
    expect(canCombine("Class 5", "Class 5")).toBe(false);
    expect(canCombine("Class 5", null)).toBe(false);
  });

  it("chooses the host rather than just finding one", () => {
    const hosts = [
      { className: "Class 10", teacher: "Far", substituted: false },
      { className: "Class 11 Arts", teacher: "Covered", substituted: true },
      { className: "Class 11 Science", teacher: "Own", substituted: false },
    ];

    // Same grade wins over an adjacent one, and among same-grade hosts the
    // class that still has its own teacher wins over one already covered.
    expect(chooseMergeHost("Class 11 Commerce", hosts)!.className).toBe(
      "Class 11 Science",
    );

    // With only the covered same-grade host left, that is still better than
    // dragging the class down a year.
    expect(
      chooseMergeHost("Class 11 Commerce", [hosts[0], hosts[1]])!.className,
    ).toBe("Class 11 Arts");
  });

  it("never lets a class with no teacher host, and rules out the distant", () => {
    expect(
      chooseMergeHost("Class 6", [
        { className: "Class 7", teacher: "", substituted: false },
        { className: "Class 7", teacher: null, substituted: false },
      ]),
    ).toBeNull();

    expect(
      chooseMergeHost("Class 2", [
        { className: "Class 9", teacher: "Someone", substituted: false },
      ]),
    ).toBeNull();
  });

  it("is deterministic", () => {
    const hosts = [
      { className: "Class 7", teacher: "A", substituted: false },
      { className: "Class 5", teacher: "B", substituted: false },
    ];
    expect(chooseMergeHost("Class 6", hosts)!.className).toBe(
      chooseMergeHost("Class 6", hosts.slice().reverse())!.className,
    );
  });
});

/* ---------------------------------------------------------- reserve staff */

/** One ordinary teacher and one admin, both free all day. */
function reserveInput() {
  return {
    day: "Monday",
    periodCount: 8,
    teacherProfiles: buildTeacherProfiles({
      teacherDetails: {
        Regular: { subjects: new Set<string>(), schedule: schedule({}) },
        Office: { subjects: new Set<string>(), schedule: {} },
      },
      roster: ["Regular", "Office"],
      reserveStaff: ["Office"],
    }),
    absentTeachers: [] as string[],
    assignments: [],
    policy: { maxConsecutive: 3 },
  };
}

describe("reserve staff", () => {
  it("are offered to a coordinator but never ranked above a teacher", () => {
    const ranked = rankCandidates({
      ...reserveInput(),
      vacancy: { slotId: "v", periodIndex: 3, subject: "Maths", className: "Class 6" },
    });

    const office = ranked.find((item) => item.teacher === "Office")!;
    expect(office).toBeTruthy();
    expect(office.reserve).toBe(true);
    expect(office.matchTier).toBe("reserve");
    expect(office.autoEligible).toBe(false);
    expect(office.warnings).toContain("reserve_staff");
    expect(ranked[ranked.length - 1].teacher).toBe("Office");
  });

  it("are not suggested even when every teacher is blocked", () => {
    // The trap: admin staff have no timetable, so they read as free in every
    // period. With the only teacher absent they would be the top non-blocked
    // candidate and get quietly proposed for the hardest period of the day.
    const plan = generatePlan({
      ...reserveInput(),
      absentTeachers: ["Regular"],
      vacancies: [
        {
          slotId: "v",
          periodIndex: 3,
          subject: "Maths",
          className: "Class 6",
          originalTeacher: "Regular",
        },
      ],
    });

    expect([...plan.assignments, ...plan.reviewSuggestions]).toEqual([]);
    expect(plan.openSlots).toHaveLength(1);
  });

  it("are still honoured once a coordinator pins one", () => {
    const check = validateAssignment({
      ...reserveInput(),
      teacher: "Office",
      vacancy: { slotId: "v", periodIndex: 3, subject: "Maths", className: "Class 6" },
    });

    expect(check.canOverride).toBe(true);
    expect(check.errors).toEqual([]);
  });
});

/* ----------------------------------------------------------- duty-holders */

/**
 * `Duty` is deliberately the best-qualified person in the room: she teaches
 * the very class and the very subject. That is the case that has to come out
 * last, because the star on the school's chart is about protecting coordinator
 * time, not about what she is able to teach.
 */
function dutyInput() {
  return {
    day: "Monday",
    periodCount: 8,
    teacherProfiles: buildTeacherProfiles({
      teacherDetails: {
        Duty: {
          subjects: new Set(["Maths"]),
          schedule: schedule({ 0: { subject: "Maths", className: "Class 6" } }),
        },
        Plain: { subjects: new Set(["Sports"]), schedule: schedule({}) },
      },
      roster: ["Duty", "Plain"],
      dutyStaff: ["Duty"],
    }),
    absentTeachers: [] as string[],
    assignments: [],
    policy: { maxConsecutive: 3 },
  };
}

describe("duty-holders", () => {
  it("rank below an unqualified teacher, however well they fit", () => {
    const ranked = rankCandidates({
      ...dutyInput(),
      vacancy: { slotId: "v", periodIndex: 3, subject: "Maths", className: "Class 6" },
    });

    const duty = ranked.find((item) => item.teacher === "Duty")!;
    const plain = ranked.find((item) => item.teacher === "Plain")!;

    // Without the star she would be `class_subject`, the top tier there is.
    expect(duty.matchTier).toBe("last_resort");
    expect(plain.matchTier).toBe("general");
    expect(plain.score).toBeGreaterThan(duty.score);
    expect(ranked[ranked.length - 1].teacher).toBe("Duty");
    expect(duty.lastResort).toBe(true);
    expect(duty.warnings).toContain("duty_holder");
  });

  it("are never assigned automatically, even as the perfect match", () => {
    const plan = generatePlan({
      ...dutyInput(),
      absentTeachers: ["Plain"],
      vacancies: [
        {
          slotId: "v",
          periodIndex: 3,
          subject: "Maths",
          className: "Class 6",
          originalTeacher: "Plain",
        },
      ],
    });

    expect(plan.assignments).toEqual([]);
  });

  it("are still suggested when nobody else is free", () => {
    // This is the whole difference from reserve staff, who stay silent even
    // here. "Only if no one else is free" has to mean she is offered on the
    // day that actually happens, or the rule would just read as "never".
    const plan = generatePlan({
      ...dutyInput(),
      absentTeachers: ["Plain"],
      vacancies: [
        {
          slotId: "v",
          periodIndex: 3,
          subject: "Maths",
          className: "Class 6",
          originalTeacher: "Plain",
        },
      ],
    });

    expect(plan.reviewSuggestions).toHaveLength(1);
    expect(plan.reviewSuggestions[0].teacher).toBe("Duty");
    expect(plan.reviewSuggestions[0].matchTier).toBe("last_resort");
    expect(plan.openSlots).toEqual([]);
  });

  it("are passed over while an ordinary teacher can go", () => {
    const plan = generatePlan({
      ...dutyInput(),
      absentTeachers: ["Absentee"],
      vacancies: [
        {
          slotId: "v",
          periodIndex: 3,
          subject: "Maths",
          className: "Class 6",
          originalTeacher: "Absentee",
        },
      ],
    });

    const chosen = [...plan.assignments, ...plan.reviewSuggestions];
    expect(chosen).toHaveLength(1);
    expect(chosen[0].teacher).toBe("Plain");
  });

  it("are honoured once a coordinator pins one", () => {
    const check = validateAssignment({
      ...dutyInput(),
      teacher: "Duty",
      vacancy: { slotId: "v", periodIndex: 3, subject: "Maths", className: "Class 6" },
    });
    expect(check.errors).toEqual([]);
  });
});

/* ---------------------------------------------------------- shift timings */

describe("shift timings", () => {
  it("accept a range, a list, or nothing at all", () => {
    expect(shiftPeriods(null, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shiftPeriods({ fromPeriodIndex: 4 }, 8)).toEqual([4, 5, 6, 7]);
    expect(shiftPeriods({ fromPeriodIndex: 2, toPeriodIndex: 4 }, 8)).toEqual([2, 3, 4]);
    expect(shiftPeriods({ allowedPeriodIndexes: [5, 7] }, 8)).toEqual([5, 7]);

    expect(isFullDayShift(null, 8)).toBe(true);
    expect(isFullDayShift({ fromPeriodIndex: 0 }, 8)).toBe(true);
    expect(isFullDayShift({ fromPeriodIndex: 4 }, 8)).toBe(false);

    const shifts = { Latecomer: { fromPeriodIndex: 4 } };
    expect(isOnShift(shifts, "Latecomer", 0, 8)).toBe(false);
    expect(isOnShift(shifts, "Latecomer", 4, 8)).toBe(true);
    expect(isOnShift(shifts, "Anybody", 0, 8)).toBe(true);
  });

  it("normalise to one shape, and only restricted staff become overrides", () => {
    const normalized = normalizeShifts(
      {
        Latecomer: { fromPeriodIndex: 4, note: "Late shift" },
        FullDay: { allowedPeriodIndexes: [0, 1, 2, 3, 4, 5, 6, 7] },
      },
      8,
    );

    expect(normalized.Latecomer).toEqual({
      allowedPeriodIndexes: [4, 5, 6, 7],
      note: "Late shift",
    });
    expect(normalized.FullDay.allowedPeriodIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const overrides = shiftsToPolicyOverrides(normalized, 8);
    expect(overrides.Latecomer).toEqual({
      availability: { allowedPeriodIndexes: [4, 5, 6, 7] },
    });
    expect("FullDay" in overrides).toBe(false);
  });

  it("block a late-shift teacher before arrival and free them after it", () => {
    // Charu teaches nothing on Monday, so without this she is "free" all day
    // and the planner hands her cover from Period 1.
    const input = profileInput();
    input.policyOverrides = shiftsToPolicyOverrides({ Charu: { fromPeriodIndex: 4 } }, 8);
    const base = {
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(input),
      absentTeachers: [] as string[],
      assignments: [],
    };

    for (const periodIndex of [0, 1, 2, 3]) {
      const early = rankCandidates({
        ...base,
        vacancy: {
          slotId: `early${periodIndex}`,
          periodIndex,
          subject: "Sports",
          className: "Class 7",
        },
      }).find((item) => item.teacher === "Charu")!;

      expect(early.blocked).toContain("unavailable");
      expect(early.autoEligible).toBe(false);
    }

    const late = rankCandidates({
      ...base,
      vacancy: { slotId: "late", periodIndex: 5, subject: "Sports", className: "Class 7" },
    }).find((item) => item.teacher === "Charu")!;

    expect(late.blocked).toEqual([]);
    expect(late.autoEligible).toBe(true);
  });

  it("never place a shifted teacher before their shift starts", () => {
    const input = profileInput();
    input.policyOverrides = shiftsToPolicyOverrides({ Charu: { fromPeriodIndex: 4 } }, 8);

    const plan = generatePlan({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(input),
      absentTeachers: ["Asha"],
      existingAssignments: [],
      vacancies: [
        { slotId: "p1", periodIndex: 0, subject: "Sports", className: "Class 7" },
        { slotId: "p6", periodIndex: 5, subject: "Sports", className: "Class 7" },
      ],
    });

    const proposed = [...plan.assignments, ...plan.reviewSuggestions];

    expect(
      proposed.some((item) => item.periodIndex === 0 && item.teacher === "Charu"),
    ).toBe(false);
    expect(proposed.some((item) => item.slotId === "p1" && item.teacher === "Bela")).toBe(
      true,
    );
    expect(
      plan.assignments.some((item) => item.slotId === "p6" && item.teacher === "Charu"),
    ).toBe(true);
  });
});

/* ---------------------------------------------------------------- half days */

describe("half days", () => {
  it("carry the periods they apply to, and a bare name means all day", () => {
    // Every older caller passed a list of names and meant the whole day. That
    // has to keep meaning the whole day.
    expect(normalizeAbsences(["Asha"], 8)).toEqual({ Asha: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(normalizeAbsences({ Asha: true }, 8)).toEqual({
      Asha: [0, 1, 2, 3, 4, 5, 6, 7],
    });
    expect(normalizeAbsences([{ teacher: "Asha", periods: [4, 5, 6, 7] }], 8)).toEqual({
      Asha: [4, 5, 6, 7],
    });
    expect(normalizeAbsences({ Asha: [3, 1, 1] }, 8)).toEqual({ Asha: [1, 3] });
    expect(normalizeAbsences({ Asha: [9, -1] }, 8)).toEqual({});
    expect(normalizeAbsences(null, 8)).toEqual({});

    const index = normalizeAbsences({ Asha: [4, 5, 6, 7] }, 8);
    expect(isAbsentAt(index, "Asha", 3)).toBe(false);
    expect(isAbsentAt(index, "Asha", 4)).toBe(true);
    expect(isAbsentAt(index, "Bela", 4)).toBe(false);
    expect(absentNames(index)).toEqual(["Asha"]);
  });

  it("block only the periods they cover", () => {
    const base = baseInput();
    // Bela goes home after the fourth period. She teaches Class 9 Science in
    // P4, which is inside her own day, so that period is hers and the ones
    // after it are not.
    const withHalfDay = { ...base, absentTeachers: { Bela: [4, 5, 6, 7] } };

    const morning = rankCandidates({
      ...withHalfDay,
      vacancy: { slotId: "am", periodIndex: 1, subject: "Science", className: "Class 9" },
    }).find((item) => item.teacher === "Bela")!;

    expect(morning.blocked).toEqual([]);
    expect(morning.autoEligible).toBe(true);

    const afternoon = rankCandidates({
      ...withHalfDay,
      vacancy: { slotId: "pm", periodIndex: 5, subject: "Science", className: "Class 9" },
    }).find((item) => item.teacher === "Bela")!;

    expect(afternoon.blocked).toContain("absent");
    expect(afternoon.autoEligible).toBe(false);
  });

  it("are covered for the half away and used for the other half", () => {
    // Asha is away from the fifth period. Her own P1 class needs nobody — she
    // is there to teach it — and the vacancy she does leave must not come back
    // to her.
    const plan = generatePlan({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(profileInput()),
      absentTeachers: { Asha: [4, 5, 6, 7], Bela: [5] },
      existingAssignments: [],
      vacancies: [
        { slotId: "bela-p6", periodIndex: 5, subject: "Science", className: "Class 9" },
      ],
    });

    const cover = [...plan.assignments, ...plan.reviewSuggestions].find(
      (item) => item.slotId === "bela-p6",
    )!;

    expect(cover).toBeTruthy();
    expect(cover.teacher).not.toBe("Asha");
    expect(cover.teacher).not.toBe("Bela");

    const early = rankCandidates({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(profileInput()),
      absentTeachers: { Asha: [4, 5, 6, 7] },
      assignments: [],
      vacancy: {
        slotId: "early",
        periodIndex: 3,
        subject: "Physics",
        className: "Class 11 Science",
      },
    }).find((item) => item.teacher === "Asha")!;

    expect(early.blocked).toEqual([]);
  });
});

describe("load is measured over the day a teacher is in school for", () => {
  it("counts only the periods they are present", () => {
    const input = profileInput();
    input.policyOverrides = shiftsToPolicyOverrides({ Charu: { fromPeriodIndex: 6 } }, 8);
    const base = {
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(input),
      absentTeachers: [] as string[],
      assignments: [],
    };

    const onlyTwo = rankCandidates({
      ...base,
      vacancy: { slotId: "p7", periodIndex: 6, subject: "Sports", className: "Class 7" },
    }).find((item) => item.teacher === "Charu")!;
    expect(onlyTwo.load.dayLength).toBe(2);

    // Her one other present period is now taken, so this cover fills her day.
    const full = rankCandidates({
      ...base,
      assignments: [{ slotId: "p8", teacher: "Charu", periodIndex: 7 }],
      vacancy: { slotId: "p7", periodIndex: 6, subject: "Sports", className: "Class 7" },
    }).find((item) => item.teacher === "Charu")!;

    expect(full.load.freeAfter).toBe(0);
    expect(full.warnings).toContain("full_day");
    expect(full.autoEligible).toBe(false);

    // A half day does the same thing for one date rather than every day.
    const halfDay = rankCandidates({
      ...base,
      absentTeachers: { Bela: [0, 1, 2, 3] },
      vacancy: { slotId: "p6", periodIndex: 5, subject: "Science", className: "Class 9" },
    }).find((item) => item.teacher === "Bela")!;
    expect(halfDay.load.dayLength).toBe(4);
  });

  it("never fills a teacher's last free period by itself", () => {
    // The per-candidate gate scores one cover against a plan that does not yet
    // contain the flow's other choices, so two vacancies could each look fine
    // alone and together leave one teacher with nothing free all day.
    const input = profileInput();
    input.policyOverrides = shiftsToPolicyOverrides({ Charu: { fromPeriodIndex: 6 } }, 8);

    const plan = generatePlan({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(input),
      absentTeachers: ["Asha", "Bela"],
      existingAssignments: [],
      vacancies: [
        { slotId: "p7", periodIndex: 6, subject: "Sports", className: "Class 7" },
        { slotId: "p8", periodIndex: 7, subject: "Sports", className: "Class 7" },
      ],
    });

    expect(plan.assignments.filter((item) => item.teacher === "Charu")).toHaveLength(1);
    expect(plan.assignments.length + plan.reviewSuggestions.length).toBe(2);

    // And a full-time teacher with room to spare is untouched by the cap.
    const roomy = generatePlan({
      day: "Monday",
      periodCount: 8,
      teacherProfiles: buildTeacherProfiles(profileInput()),
      absentTeachers: ["Asha"],
      existingAssignments: [],
      vacancies: [
        { slotId: "a", periodIndex: 1, subject: "Sports", className: "Class 7" },
        { slotId: "b", periodIndex: 2, subject: "Sports", className: "Class 7" },
      ],
    });

    expect(roomy.assignments.filter((item) => item.teacher === "Charu")).toHaveLength(2);
  });

  it("measures an ordinary full day exactly as it always did", () => {
    // The regression guard: with no shift and no absence, every load fact has
    // to read the way it did before half days existed, or every plan the
    // school has seen would quietly move.
    const facts = rankCandidates({
      ...baseInput(),
      vacancy: { slotId: "plain", periodIndex: 5, subject: "Science", className: "Class 9" },
    }).find((item) => item.teacher === "Charu")!.load;

    expect(facts.dayLength).toBe(8);
    expect(facts.regular).toBe(0);
    expect(facts.freeAfter).toBe(7);
  });
});

/* -------------------------------------------------------------- staleness */

describe("planIsStale()", () => {
  it("is true when the timetable has been republished under the plan", () => {
    expect(planIsStale({ versionId: "v1" }, "v2")).toBe(true);
  });

  it("is false for a plan on the live timetable", () => {
    expect(planIsStale({ versionId: "v1" }, "v1")).toBe(false);
  });

  it("says nothing when there is no plan or no published timetable", () => {
    // Neither is staleness: one is "nothing planned yet" and the other is
    // "nothing to plan against", and both have their own screen.
    expect(planIsStale(null, "v1")).toBe(false);
    expect(planIsStale({ versionId: "v1" }, null)).toBe(false);
  });
});
