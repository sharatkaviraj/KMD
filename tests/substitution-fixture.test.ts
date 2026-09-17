import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildTeacherProfiles,
  generatePlan,
  normalizeAbsences,
  rankCandidates,
  shiftsToPolicyOverrides,
  type AbsenceIndex,
  type PolicyOverride,
} from "@/modules/substitutions/domain/engine";
import {
  teacherDetailsFrom,
  vacanciesFor,
  type PlanSlot,
} from "@/modules/substitutions/domain/plan";
import {
  parseTimetable,
  PERIOD_COUNT,
} from "@/modules/timetable/domain/parse-timetable";

/**
 * The engine, run over the school's own timetable.
 *
 * The unit tests in `substitution-engine.test.ts` use three invented teachers,
 * which is right for pinning a rule but says nothing about a Tuesday with four
 * people away across sixteen classes. This runs the whole thing against the
 * real sheet — 768 cells, 19 teachers, 6 days — and asserts the invariants
 * that have to hold on **every** allocation, whoever is away.
 *
 * Those invariants are the promises a coordinator is relying on when they
 * press publish:
 *
 *  - nobody is in two rooms at once;
 *  - nobody is given cover in a period they are away for;
 *  - nobody is pulled out of their own lesson to cover another;
 *  - nobody is sent to a period before they arrive;
 *  - office staff are never volunteered;
 *  - duty-holders are never assigned automatically;
 *  - the same inputs give the same plan.
 *
 * Keys here are the fixture's own names, because the engine treats its keys as
 * opaque — VPPS One passes staff profile ids for the same fields.
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const parsed = parseTimetable(
  readFileSync(
    path.join(repoRoot, "tests/fixtures/timetable-2026-27.csv"),
    "utf8",
  ),
);

/** The fixture as `PlanSlot`s, keyed by name rather than by id. */
const slots: PlanSlot[] = [];

for (const day of parsed.days) {
  for (const className of parsed.classNames) {
    const row = parsed.timetable[day]?.[className];
    if (!row) continue;

    row.forEach((cell, period) => {
      if (cell.free) return;

      const pairs = cell.parallel
        ? cell.subjects.map((subject, index) => ({
            subject,
            teacher: cell.teachers[index],
          }))
        : cell.teachers.map((teacher) => ({ subject: cell.subject, teacher }));

      for (const pair of pairs) {
        if (!pair.teacher) continue;
        slots.push({
          day,
          period,
          classId: className,
          classLabel: className,
          subjectCode: pair.subject,
          staffProfileId: pair.teacher,
          teacherShortName: pair.teacher,
          parallel: Boolean(cell.parallel),
          shared: !cell.parallel && cell.teachers.length > 1,
        });
      }
    });
  }
}

const teachers = [...new Set(slots.map((slot) => slot.staffProfileId))].sort();
const details = teacherDetailsFrom(slots, parsed.days);

/** Invented names for the two roles the fixture does not carry. */
const OFFICE = "Test Office";
const DUTY = teachers[0];

function profilesWith(overrides: Record<string, PolicyOverride> = {}) {
  return buildTeacherProfiles({
    teacherDetails: details,
    roster: [...teachers, OFFICE],
    policyOverrides: overrides,
    reserveStaff: [OFFICE],
    dutyStaff: [DUTY],
  });
}

function planFor(
  day: string,
  absent: Record<string, number[] | true>,
  overrides: Record<string, PolicyOverride> = {},
) {
  const absenceIndex: AbsenceIndex = normalizeAbsences(absent, PERIOD_COUNT);
  const vacancies = vacanciesFor(slots, day, absenceIndex);

  const result = generatePlan({
    day,
    periodCount: PERIOD_COUNT,
    teacherProfiles: profilesWith(overrides),
    absenceIndex,
    vacancies: vacancies.map((vacancy) => ({
      slotId: vacancy.slotId,
      periodIndex: vacancy.periodIndex,
      className: vacancy.className,
      subject: vacancy.subject,
      originalTeacher: vacancy.originalTeacher,
    })),
    existingAssignments: [],
  });

  return { absenceIndex, vacancies, result };
}

const proposedOf = (result: ReturnType<typeof planFor>["result"]) =>
  [...result.assignments, ...result.reviewSuggestions].filter(
    (item): item is (typeof result.reviewSuggestions)[number] =>
      "source" in item,
  );

/* -------------------------------------------------- the fixture itself */

describe("the fixture the engine is run against", () => {
  it("is the timetable SOURCES.md pins", () => {
    expect(parsed.cellCount).toBe(768);
    expect(parsed.days).toHaveLength(6);
    expect(parsed.classNames).toHaveLength(16);
    expect(teachers).toHaveLength(19);
    expect(parsed.problems).toEqual([]);
  });

  it("gives every teacher a full-length row on every day", () => {
    for (const teacher of teachers) {
      for (const day of parsed.days) {
        expect(details[teacher].schedule![day]).toHaveLength(PERIOD_COUNT);
      }
    }
  });
});

/* ---------------------------------------------------- the permutations */

/**
 * Every day crossed with a set of absence shapes: one teacher, several, a
 * morning half, an afternoon half, a single period, and the whole primary
 * team at once.
 */
const SHAPES: {
  name: string;
  absent: (day: string) => Record<string, number[] | true>;
}[] = [
  { name: "one teacher, whole day", absent: () => ({ [teachers[0]]: true }) },
  {
    name: "three teachers, whole day",
    absent: () => ({
      [teachers[0]]: true,
      [teachers[5]]: true,
      [teachers[10]]: true,
    }),
  },
  {
    name: "a morning half day",
    absent: () => ({ [teachers[3]]: [0, 1, 2, 3] }),
  },
  {
    name: "an afternoon half day",
    absent: () => ({ [teachers[3]]: [4, 5, 6, 7] }),
  },
  { name: "a single period", absent: () => ({ [teachers[7]]: [2] }) },
  {
    name: "five teachers at once",
    absent: () =>
      Object.fromEntries(
        teachers.slice(0, 5).map((teacher) => [teacher, true]),
      ),
  },
  {
    name: "half the staff room",
    absent: () =>
      Object.fromEntries(
        teachers
          .filter((_, index) => index % 2 === 0)
          .map((teacher) => [teacher, true as const]),
      ),
  },
];

const CASES = parsed.days.flatMap((day) =>
  SHAPES.map((shape) => ({
    day,
    shape: shape.name,
    absent: shape.absent(day),
  })),
);

describe("the invariants hold on every allocation", () => {
  it("has enough cases to be worth calling a sweep", () => {
    // 6 days x 7 shapes. A glob that silently matches nothing is a test that
    // always passes.
    expect(CASES.length).toBe(42);
  });

  it.each(
    CASES.map((entry) => [`${entry.day} — ${entry.shape}`, entry] as const),
  )("%s", (_label, entry) => {
    const { absenceIndex, vacancies, result } = planFor(
      entry.day,
      entry.absent,
    );
    const proposed = proposedOf(result);

    // Somebody is always away in these cases, and the sheet has no free
    // cells, so there is always something to do.
    expect(vacancies.length).toBeGreaterThan(0);

    // Every vacancy is accounted for exactly once: covered, suggested, or
    // openly reported as nobody being free.
    const handled = [
      ...proposed.map((item) => item.slotId),
      ...result.openSlots.map((item) => item.slotId),
    ];
    expect(new Set(handled).size).toBe(vacancies.length);

    const byPeriod = new Map<number, string[]>();

    for (const item of proposed) {
      const names = byPeriod.get(item.periodIndex) ?? [];
      names.push(item.teacher);
      byPeriod.set(item.periodIndex, names);

      // Nobody is asked to cover a period they are away for.
      expect(
        absenceIndex[item.teacher]?.includes(item.periodIndex) ?? false,
        `${item.teacher} is away in P${item.periodIndex + 1}`,
      ).toBe(false);

      // Nobody is pulled out of their own lesson.
      expect(
        details[item.teacher]?.schedule?.[entry.day]?.[item.periodIndex] ??
          null,
        `${item.teacher} already teaches in P${item.periodIndex + 1}`,
      ).toBeNull();

      // Office staff are never volunteered, not even as a suggestion.
      expect(item.teacher).not.toBe(OFFICE);
    }

    // Nobody is in two rooms at once.
    for (const [period, names] of byPeriod) {
      expect(
        new Set(names).size,
        `two rooms at once in P${period + 1}: ${names.join(", ")}`,
      ).toBe(names.length);
    }

    // Duty-holders are suggested, never assigned automatically.
    for (const item of result.assignments) {
      if ("teacher" in item) expect(item.teacher).not.toBe(DUTY);
    }
  });
});

describe("determinism", () => {
  it.each(parsed.days)("gives the same plan twice on %s", (day) => {
    const absent = { [teachers[2]]: true, [teachers[8]]: true } as const;
    expect(planFor(day, absent).result).toEqual(planFor(day, absent).result);
  });
});

describe("shift windows", () => {
  it("never places a part-time teacher before they arrive", () => {
    // The bug the ported engine exists to prevent: a teacher who teaches
    // nothing in the morning reads as free all day.
    const latecomer = teachers[4];
    const overrides = shiftsToPolicyOverrides(
      { [latecomer]: { fromPeriodIndex: 4 } },
      PERIOD_COUNT,
    );

    for (const day of parsed.days) {
      const { result } = planFor(
        day,
        Object.fromEntries(
          teachers
            .filter((name) => name !== latecomer)
            .map((name) => [name, true as const]),
        ),
        overrides,
      );

      for (const item of proposedOf(result)) {
        if (item.teacher !== latecomer) continue;
        expect(
          item.periodIndex,
          `${latecomer} placed in P${item.periodIndex + 1}, before their shift`,
        ).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe("the daily cap", () => {
  it("is never exceeded automatically, however bad the day", () => {
    // Half the staff room away, so the allocator is under real pressure.
    const absent = Object.fromEntries(
      teachers
        .filter((_, index) => index % 2 === 0)
        .map((teacher) => [teacher, true as const]),
    );

    for (const day of parsed.days) {
      const { result } = planFor(day, absent);
      const perTeacher: Record<string, number> = {};

      for (const item of result.assignments) {
        if (!("teacher" in item)) continue;
        perTeacher[item.teacher] = (perTeacher[item.teacher] ?? 0) + 1;
      }

      for (const [teacher, count] of Object.entries(perTeacher)) {
        expect(
          count,
          `${teacher} was given ${count} automatic covers`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  it("leaves everybody a free period when it decides on its own", () => {
    const absent: Record<string, true> = {
      [teachers[1]]: true,
      [teachers[6]]: true,
      [teachers[11]]: true,
    };

    for (const day of parsed.days) {
      const { result } = planFor(day, absent);

      const given: Record<string, number[]> = {};
      for (const item of result.assignments) {
        if (!("teacher" in item)) continue;
        (given[item.teacher] ??= []).push(item.periodIndex);
      }

      for (const [teacher, periods] of Object.entries(given)) {
        const taught = (details[teacher]?.schedule?.[day] ?? []).filter(
          Boolean,
        ).length;
        expect(
          taught + periods.length,
          `${teacher} would have no free period left on ${day}`,
        ).toBeLessThan(PERIOD_COUNT);
      }
    }
  });
});

describe("shared blocks and parallel electives", () => {
  it("raises no vacancy when one of a shared block's teachers is away", () => {
    // ELGA on Monday is one activity with five teachers. Four remain.
    const shared = slots.find((slot) => slot.shared && slot.day === "Monday");
    expect(shared, "the fixture still contains a shared block").toBeTruthy();

    const absent = normalizeAbsences([shared!.staffProfileId], PERIOD_COUNT);
    const raised = vacanciesFor(slots, "Monday", absent).some(
      (vacancy) =>
        vacancy.classId === shared!.classId &&
        vacancy.periodIndex === shared!.period,
    );

    // The teacher is away for the whole day, so other periods of theirs *are*
    // vacancies — only the shared one is absorbed.
    expect(raised).toBe(false);
  });

  it("raises a vacancy when one half of a parallel elective is away", () => {
    const parallel = slots.find((slot) => slot.parallel);
    expect(
      parallel,
      "the fixture still contains a parallel elective",
    ).toBeTruthy();

    const absent = normalizeAbsences(
      { [parallel!.staffProfileId]: [parallel!.period] },
      PERIOD_COUNT,
    );

    expect(
      vacanciesFor(slots, parallel!.day, absent).some(
        (vacancy) =>
          vacancy.classId === parallel!.classId &&
          vacancy.periodIndex === parallel!.period,
      ),
    ).toBe(true);
  });
});

describe("ranking on the real sheet", () => {
  it("prefers a teacher who already takes the class", () => {
    // Pick a real lesson and ask who should cover it.
    const lesson = slots.find(
      (slot) =>
        slot.day === "Monday" &&
        slot.period === 3 &&
        !slot.shared &&
        !slot.parallel,
    )!;

    const ranked = rankCandidates({
      day: "Monday",
      periodCount: PERIOD_COUNT,
      teacherProfiles: profilesWith(),
      absenceIndex: normalizeAbsences([lesson.staffProfileId], PERIOD_COUNT),
      vacancy: {
        slotId: "x",
        periodIndex: lesson.period,
        className: lesson.classLabel,
        subject: lesson.subjectCode,
      },
    });

    const best = ranked.find((candidate) => candidate.blocked.length === 0)!;
    expect(best).toBeTruthy();
    // Whoever comes out on top is either familiar with the class or teaches
    // the subject — never a stranger to both while one of those exists.
    const strangers = ["general", "last_resort", "reserve"];
    const anyFamiliar = ranked.some(
      (candidate) =>
        candidate.blocked.length === 0 &&
        !strangers.includes(candidate.matchTier),
    );
    if (anyFamiliar) expect(strangers).not.toContain(best.matchTier);
  });

  it("puts office staff last among everybody who is actually free", () => {
    // Last *among the available*, not last overall: a teacher standing in
    // front of their own class is `blocked`, and the sort puts every blocked
    // candidate below every free one so a coordinator reads the usable names
    // first. Office staff being below all of those is the promise.
    for (const day of parsed.days) {
      const ranked = rankCandidates({
        day,
        periodCount: PERIOD_COUNT,
        teacherProfiles: profilesWith(),
        absenceIndex: {},
        vacancy: {
          slotId: "x",
          periodIndex: 3,
          className: "Class 6",
          subject: "Maths",
        },
      });

      const free = ranked.filter((candidate) => candidate.blocked.length === 0);
      expect(free.length).toBeGreaterThan(1);
      expect(free[free.length - 1].teacher).toBe(OFFICE);

      // And never automatically usable, wherever they sit.
      expect(free[free.length - 1].autoEligible).toBe(false);
    }
  });
});
