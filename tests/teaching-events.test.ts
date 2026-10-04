import { describe, expect, it } from "vitest";

import {
  buildTeacherProfiles,
  generatePlan,
  rankCandidates,
  type Vacancy,
} from "@/modules/substitutions/domain/engine";
import {
  coverNeedsFor,
  teachingEventsFor,
  type TeachingEvent,
} from "@/modules/substitutions/domain/events";
import { teacherDetailsFrom, type PlanSlot } from "@/modules/substitutions/domain/plan";

/**
 * P2, Gate D: every physical lesson survives the trip from flat timetable rows
 * to cover, without losing a cohort or inventing a supervisor.
 *
 * Synthetic throughout — Teachers A to H, classes named for their shape. None
 * of this establishes how the school actually groups its senior sections or
 * staffs ELGA; it establishes what the app does with each shape once the
 * school has said.
 */

function slot(over: Partial<PlanSlot>): PlanSlot {
  return {
    day: "Monday",
    period: 2,
    classId: "c6",
    classLabel: "Class 6",
    subjectCode: "MATHS",
    staffProfileId: "A",
    teacherShortName: "A",
    parallel: false,
    shared: false,
    ...over,
  };
}

/** One synthetic Monday period with every shape in it. */
const period2: PlanSlot[] = [
  // Ordinary: A teaches Class 6 Maths.
  slot({}),
  // Joint senior lesson: B teaches Hindi to three sections at once.
  slot({ classId: "s11", classLabel: "11 Science", subjectCode: "HINDI", staffProfileId: "B" }),
  slot({ classId: "c11", classLabel: "11 Commerce", subjectCode: "HINDI", staffProfileId: "B" }),
  slot({ classId: "a11", classLabel: "11 Arts", subjectCode: "HINDI", staffProfileId: "B" }),
  // Parallel cohorts: 12 Science split, Biology with C and Maths with D.
  slot({ classId: "s12", classLabel: "12 Science", subjectCode: "BIO", staffProfileId: "C", parallel: true }),
  slot({ classId: "s12", classLabel: "12 Science", subjectCode: "MATHS", staffProfileId: "D", parallel: true }),
  // Team block: ELGA across Classes 1 and 2, three teachers.
  slot({ classId: "c1", classLabel: "Class 1", subjectCode: "ELGA", staffProfileId: "E", shared: true }),
  slot({ classId: "c1", classLabel: "Class 1", subjectCode: "ELGA", staffProfileId: "F", shared: true }),
  slot({ classId: "c2", classLabel: "Class 2", subjectCode: "ELGA", staffProfileId: "F", shared: true }),
  slot({ classId: "c2", classLabel: "Class 2", subjectCode: "ELGA", staffProfileId: "G", shared: true }),
  // Same subject, same time, different teacher, different room: H, Class 7 Maths.
  slot({ classId: "c7", classLabel: "Class 7", subjectCode: "MATHS", staffProfileId: "H" }),
];

const { events, clashes } = teachingEventsFor(period2, "Monday");
const byKind = (kind: TeachingEvent["kind"]) => events.filter((event) => event.kind === kind);

describe("teachingEventsFor — the shapes", () => {
  it("keeps an ordinary lesson ordinary", () => {
    const ordinary = byKind("ordinary");
    expect(ordinary.map((event) => event.classes.map((entry) => entry.label))).toEqual([
      ["Class 6"],
      ["Class 7"],
    ]);
  });

  it("makes a joint lesson one event with every section in it", () => {
    const [joint] = byKind("joint");
    expect(joint.classes.map((entry) => entry.id)).toEqual(["a11", "c11", "s11"]);
    expect(joint.staffIds).toEqual(["B"]);
    expect(joint.sources).toHaveLength(3);
  });

  it("keeps both halves of a split class as separate cohorts", () => {
    const cohorts = byKind("parallel_cohort");
    expect(cohorts).toHaveLength(2);
    expect(cohorts.map((event) => event.subjectCode).sort()).toEqual(["BIO", "MATHS"]);
    expect(cohorts.every((event) => event.classes[0].id === "s12")).toBe(true);
  });

  it("joins a team across the classes it shares a teacher with", () => {
    const [team] = byKind("team_block");
    expect(team.classes.map((entry) => entry.id)).toEqual(["c1", "c2"]);
    expect(team.staffIds).toEqual(["E", "F", "G"]);
  });

  it("does not merge two lessons because they share a subject and a time", () => {
    // A (Class 6 Maths) and H (Class 7 Maths): two rooms, two lessons.
    const maths = events.filter((event) => event.subjectCode === "MATHS" && event.kind === "ordinary");
    expect(maths).toHaveLength(2);
    expect(new Set(maths.map((event) => event.key)).size).toBe(2);
  });

  it("reports nothing as a clash when nobody is in two rooms", () => {
    expect(clashes).toEqual([]);
  });

  it("reports one person in two lessons at once", () => {
    const { clashes: found } = teachingEventsFor(
      [slot({}), slot({ classId: "c9", classLabel: "Class 9", subjectCode: "SCIENCE" })],
      "Monday",
    );
    expect(found).toHaveLength(1);
    expect(found[0].staffId).toBe("A");
  });

  it("gives the same arrangement the same key every time", () => {
    const again = teachingEventsFor([...period2].reverse(), "Monday").events;
    expect(again.map((event) => event.key)).toEqual(events.map((event) => event.key));
  });

  it("ignores other days", () => {
    expect(teachingEventsFor(period2, "Tuesday").events).toEqual([]);
  });
});

describe("coverNeedsFor — what an absence asks for", () => {
  it("asks for one cover for a joint lesson, not three", () => {
    const needs = coverNeedsFor(events, { B: [2] });
    expect(needs).toHaveLength(1);
    expect(needs[0].event.classes).toHaveLength(3);
    expect(needs[0].supervisorsNeeded).toBe(1);
    expect(needs[0].automatic).toBe(true);
  });

  it("asks for both cohorts when both halves of a split class are away", () => {
    const needs = coverNeedsFor(events, { C: [2], D: [2] });
    expect(needs.map((need) => need.event.subjectCode).sort()).toEqual(["BIO", "MATHS"]);
  });

  it("asks only for the half whose teacher is away", () => {
    const needs = coverNeedsFor(events, { C: [2] });
    expect(needs).toHaveLength(1);
    expect(needs[0].event.subjectCode).toBe("BIO");
  });

  it("never arranges an unmapped team, and says so", () => {
    const one = coverNeedsFor(events, { E: [2] });
    expect(one).toHaveLength(1);
    expect(one[0].reason).toBe("team_unmapped");
    expect(one[0].supervisorsNeeded).toBeNull();
    expect(one[0].automatic).toBe(false);
  });

  it("lets a stated rule absorb an absence the team can carry", () => {
    const rules = [{ subjectCode: "ELGA", minimumPresent: 2 }];
    expect(coverNeedsFor(events, { E: [2] }, rules)).toEqual([]);
  });

  it("asks for exactly the shortfall below the rule", () => {
    const rules = [{ subjectCode: "ELGA", minimumPresent: 3 }];
    const needs = coverNeedsFor(events, { E: [2], F: [2] }, rules);
    expect(needs[0].reason).toBe("team_below_minimum");
    expect(needs[0].supervisorsNeeded).toBe(2);
    expect(needs[0].automatic).toBe(false);
  });

  it("says the whole team is away when it is", () => {
    const needs = coverNeedsFor(events, { E: [2], F: [2], G: [2] });
    expect(needs[0].reason).toBe("whole_team_absent");
    expect(needs[0].supervisorsNeeded).toBe(1);
  });

  it("only counts an absence in the periods it covers", () => {
    expect(coverNeedsFor(events, { B: [0, 1] })).toEqual([]);
  });

  it("gives a need the same key whoever is absent, so a duty keeps its identity", () => {
    const first = coverNeedsFor(events, { C: [2] })[0];
    const second = coverNeedsFor(events, { C: [2], D: [2] }).find(
      (need) => need.event.subjectCode === "BIO",
    );
    expect(second?.key).toBe(first.key);
  });
});

describe("a joint lesson's substitute must fit every class", () => {
  // X teaches 11 Science Hindi every day and has never met 11 Arts.
  // Y teaches Hindi to all three sections. Both are free in period 2.
  const week: PlanSlot[] = [
    slot({ day: "Tuesday", period: 0, classId: "s11", classLabel: "11 Science", subjectCode: "HINDI", staffProfileId: "X" }),
    slot({ day: "Tuesday", period: 1, classId: "s11", classLabel: "11 Science", subjectCode: "HINDI", staffProfileId: "Y" }),
    slot({ day: "Tuesday", period: 1, classId: "c11", classLabel: "11 Commerce", subjectCode: "HINDI", staffProfileId: "Y" }),
    slot({ day: "Tuesday", period: 1, classId: "a11", classLabel: "11 Arts", subjectCode: "HINDI", staffProfileId: "Y" }),
  ];
  const profiles = buildTeacherProfiles({
    teacherDetails: teacherDetailsFrom(week, ["Monday", "Tuesday"]),
    roster: ["X", "Y"],
  });
  const vacancy: Vacancy = {
    slotId: "joint",
    periodIndex: 2,
    className: "11 Science",
    alsoClassNames: ["11 Commerce", "11 Arts"],
    subject: "HINDI",
  };

  it("credits a joint lesson's teacher with every section it reaches", () => {
    expect(profiles.Y.classLoad).toEqual({ "11 Science": 1, "11 Commerce": 1, "11 Arts": 1 });
  });

  it("ranks the stranger to two of three sections by the worst of them", () => {
    const ranked = rankCandidates({ day: "Monday", teacherProfiles: profiles, vacancy });
    const x = ranked.find((candidate) => candidate.teacher === "X")!;
    const y = ranked.find((candidate) => candidate.teacher === "Y")!;
    expect(y.matchTier).toBe("class_subject");
    // X teaches the subject but not Commerce or Arts: exact, not class_subject.
    expect(x.matchTier).toBe("exact");
    expect(ranked[0].teacher).toBe("Y");
  });

  it("allocates one teacher to the whole joint lesson, counting it once", () => {
    const result = generatePlan({ day: "Monday", teacherProfiles: profiles, vacancies: [vacancy] });
    expect(result.assignments).toHaveLength(1);
    expect(result.diagnostics.autoAssigned).toBe(1);
  });
});
