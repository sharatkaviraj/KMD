import { describe, expect, it } from "vitest";
import {
  buildTeacherProfiles, generatePlan, normalizeAbsences, rankCandidates,
  shiftsToPolicyOverrides, type PolicyOverride,
} from "@/modules/substitutions/domain/engine";
import { teacherDetailsFrom, vacanciesFor, PERIOD_COUNT, type PlanSlot } from "@/modules/substitutions/domain/plan";
import { TEACHERS, syntheticTimetable } from "./fixtures/timetable-synthetic";

// A separate small integration fixture, not a pass claim for the real-school sweep.
const { parsed, slots } = syntheticTimetable();
const details = teacherDetailsFrom(slots, parsed.days);
const OFFICE = "QA Office";
const DUTY = "QA Beta";
const profilesWith = (policyOverrides: Record<string, PolicyOverride> = {}) => buildTeacherProfiles({
  teacherDetails: details, roster: [...TEACHERS, OFFICE],
  reserveStaff: [OFFICE], dutyStaff: [DUTY], policyOverrides,
});

function planFor(day: string, absent: Record<string, number[] | true>, overrides: Record<string, PolicyOverride> = {}) {
  const absenceIndex = normalizeAbsences(absent, PERIOD_COUNT);
  const vacancies = vacanciesFor(slots, day, absenceIndex);
  const result = generatePlan({ day, periodCount: PERIOD_COUNT,
    teacherProfiles: profilesWith(overrides), absenceIndex, vacancies, existingAssignments: [],
  });
  return { absenceIndex, vacancies, result };
}
const proposedOf = (result: ReturnType<typeof planFor>["result"]) =>
  [...result.assignments, ...result.reviewSuggestions].filter(
    (item): item is (typeof result.reviewSuggestions)[number] => "source" in item,
  );
const awayExcept = (present: string) => Object.fromEntries(
  TEACHERS.filter((teacher) => teacher !== present).map((teacher) => [teacher, true as const]),
);
const shapes: { name: string; absent: Record<string, number[] | true> }[] = [
  { name: "one whole day", absent: { "QA Alpha": true } },
  { name: "three whole days", absent: { "QA Alpha": true, "QA Beta": true, "QA Zeta": true } },
  { name: "morning half", absent: { "QA Delta": [0, 1, 2, 3] } },
  { name: "afternoon half", absent: { "QA Alpha": [4, 5, 6, 7] } },
  { name: "single period", absent: { "QA Gamma": [0] } },
  { name: "five teachers", absent: awayExcept("QA Zeta") },
  { name: "half the roster", absent: { "QA Alpha": true, "QA Gamma": true, "QA Epsilon": true } },
];
const cases = parsed.days.flatMap((day) => shapes.map((shape) => ({ day, ...shape })));

// Small boundary schedules complement the intentionally sparse integration CSV.
function capacityPlan(ownPeriods: number[], vacantPeriods: number[]) {
  const lesson = (teacher: string, day: string, period: number): PlanSlot => ({
    day, period, classId: "QA Blue", classLabel: "QA Blue", subjectCode: "Numeracy",
    staffProfileId: teacher, teacherShortName: teacher, parallel: false, shared: false,
  });
  const boundarySlots = [
    ...ownPeriods.map((period) => lesson("QA Cover", "Monday", period)),
    ...vacantPeriods.map((period) => lesson("QA Away", "Monday", period)),
    // Establish class/subject familiarity even when the cover teacher has no Monday lessons.
    lesson("QA Cover", "Tuesday", 0),
  ];
  const absenceIndex = normalizeAbsences({ "QA Away": true }, 8);
  return generatePlan({
    day: "Monday", periodCount: 8, absenceIndex,
    teacherProfiles: buildTeacherProfiles({
      teacherDetails: teacherDetailsFrom(boundarySlots, ["Monday", "Tuesday"]),
      roster: ["QA Cover", "QA Away"],
    }),
    vacancies: vacanciesFor(boundarySlots, "Monday", absenceIndex), existingAssignments: [],
  });
}

describe("synthetic timetable to cover-plan integration", () => {
  it("pins a nonempty two-day sweep and complete teacher schedules", () => {
    expect(cases).toHaveLength(14);
    expect(slots).toHaveLength(29);
    for (const teacher of TEACHERS) for (const day of parsed.days) {
      expect(details[teacher].schedule?.[day]).toHaveLength(8);
    }
    expect(details["QA Epsilon"].schedule?.Monday[3]).toMatchObject({ className: "QA Blue", alsoClassNames: ["QA Green"] });
  });

  it.each(cases)("accounts for every vacancy safely: $day / $name", ({ day, absent }) => {
    const { absenceIndex, vacancies, result } = planFor(day, absent);
    expect(vacancies.length).toBeGreaterThan(0);
    const proposed = proposedOf(result);
    // Array equality, not just Set size: duplicates or unknown slot IDs fail too.
    const handled = [...proposed.map((item) => item.slotId), ...result.openSlots.map((item) => item.slotId)];
    expect(handled.sort()).toEqual(vacancies.map((item) => item.slotId).sort());
    const teacherPeriods = new Set<string>();
    for (const item of proposed) {
      expect(absenceIndex[item.teacher]?.includes(item.periodIndex) ?? false).toBe(false);
      expect(details[item.teacher]?.schedule?.[day]?.[item.periodIndex] ?? null).toBeNull();
      expect(item.teacher).not.toBe(OFFICE);
      const key = `${item.teacher}:${item.periodIndex}`;
      expect(teacherPeriods.has(key)).toBe(false);
      teacherPeriods.add(key);
    }
    const given = new Map<string, number>();
    for (const item of result.assignments) {
      if (!("teacher" in item)) continue;
      expect(item.teacher).not.toBe(DUTY);
      given.set(item.teacher, (given.get(item.teacher) ?? 0) + 1);
    }
    for (const [teacher, count] of given) {
      expect(count).toBeLessThanOrEqual(2);
      expect(count + (details[teacher].schedule?.[day] ?? []).filter(Boolean).length).toBeLessThan(8);
    }
  });

  it("actually exercises automatic, review and open outcomes", () => {
    const results = cases.map(({ day, absent }) => planFor(day, absent).result);
    expect(results.reduce((count, result) => count + result.assignments.length, 0)).toBeGreaterThan(0);
    expect(results.reduce((count, result) => count + result.reviewSuggestions.length, 0)).toBeGreaterThan(0);
    expect(results.reduce((count, result) => count + result.openSlots.length, 0)).toBeGreaterThan(0);
  });

  it("stops at two automatic covers when an ordinary familiar teacher could cover eight", () => {
    const result = capacityPlan([], [0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.every((item) => "teacher" in item && item.teacher === "QA Cover")).toBe(true);
    expect(result.reviewSuggestions.length + result.openSlots.length).toBe(6);
  });

  it("does not automatically consume an eligible teacher's only free period", () => {
    const result = capacityPlan([0, 1, 2, 3, 4, 5, 6], [7]);
    expect(result.assignments).toEqual([]);
    expect(result.reviewSuggestions).toEqual([expect.objectContaining({ teacher: "QA Cover", periodIndex: 7 })]);
    expect(result.openSlots).toEqual([]);
  });

  it("preserves one free period across two individually eligible cover choices", () => {
    const result = capacityPlan([0, 1, 2, 3, 4, 5], [6, 7]);
    expect(result.assignments).toHaveLength(1);
    expect(result.reviewSuggestions).toHaveLength(1);
    expect(result.openSlots).toEqual([]);
    const proposed = proposedOf(result);
    expect(proposed.map((item) => item.periodIndex).sort()).toEqual([6, 7]);
    expect(proposed.every((item) => item.teacher === "QA Cover")).toBe(true);
  });

  it.each(parsed.days)("is deterministic on %s", (day) => {
    const absent = { "QA Alpha": true, "QA Epsilon": true } as const;
    expect(planFor(day, absent).result).toEqual(planFor(day, absent).result);
  });

  it("suggests an available duty holder but never volunteers office staff", () => {
    const { result } = planFor("Monday", awayExcept(DUTY));
    expect(result.reviewSuggestions.some((item) => item.teacher === DUTY)).toBe(true);
    expect(result.assignments).toHaveLength(0);
    expect(proposedOf(result).some((item) => item.teacher === OFFICE)).toBe(false);
  });

  it("excludes pre-arrival cover while still using the latecomer after arrival", () => {
    const latecomer = "QA Zeta";
    const overrides = shiftsToPolicyOverrides({ [latecomer]: { fromPeriodIndex: 4 } }, PERIOD_COUNT);
    const proposals = parsed.days.flatMap((day) => proposedOf(planFor(day, awayExcept(latecomer), overrides).result));
    expect(proposals.length).toBeGreaterThan(0);
    for (const proposal of proposals) {
      expect(proposal.teacher).toBe(latecomer);
      expect(proposal.periodIndex).toBeGreaterThanOrEqual(4);
    }
  });

  it("absorbs a single shared absence but opens shared rooms when both teachers are away", () => {
    const one = vacanciesFor(slots, "Monday", normalizeAbsences({ "QA Gamma": [2] }, 8));
    expect(one).toEqual([]);
    const both = vacanciesFor(slots, "Monday", normalizeAbsences({ "QA Gamma": [2], "QA Delta": [2] }, 8));
    expect(both.map((item) => item.slotId)).toEqual(["QA Blue|2", "QA Green|2"]);
  });

  it("opens a parallel room if either cohort is absent, only once if both are", () => {
    const one = vacanciesFor(slots, "Monday", normalizeAbsences({ "QA Alpha": [1] }, 8));
    expect(one).toEqual([expect.objectContaining({ slotId: "QA Blue|1", subject: "Science", originalTeacher: "QA Alpha" })]);
    const both = vacanciesFor(slots, "Monday", normalizeAbsences({ "QA Alpha": [1], "QA Beta": [1] }, 8));
    expect(both).toHaveLength(1);
    expect(both[0].slotId).toBe("QA Blue|1");
  });

  it("ranks a familiar teacher ahead of a stranger and office staff last among free candidates", () => {
    const ranked = rankCandidates({ day: "Monday", periodCount: 8, teacherProfiles: profilesWith(),
      absenceIndex: normalizeAbsences({ "QA Epsilon": [3] }, 8),
      vacancy: { slotId: "QA Blue|3", periodIndex: 3, className: "QA Blue", subject: "Community Studies" },
    }).filter((candidate) => candidate.blocked.length === 0);
    expect(ranked.length).toBeGreaterThan(1);
    expect(["general", "last_resort", "reserve"]).not.toContain(ranked[0].matchTier);
    expect(ranked.at(-1)).toMatchObject({ teacher: OFFICE, autoEligible: false });
  });
});
