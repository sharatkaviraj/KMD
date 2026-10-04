import { describe, expect, it } from "vitest";

import { arrangeCover, type LiveDuty } from "@/modules/substitutions/domain/arrange";
import { buildTeacherProfiles } from "@/modules/substitutions/domain/engine";
import { coverNeedsFor, teachingEventsFor } from "@/modules/substitutions/domain/events";
import { teacherDetailsFrom, type PlanSlot } from "@/modules/substitutions/domain/plan";

/**
 * P3: the arranger's promises, on synthetic days.
 *
 * Teachers are letters, classes are "Class N". Nothing here is the school's
 * roster; the shapes are the ones the plan names in §7 and §21.
 */

const ALL = new Set([0, 1, 2, 3, 4, 5, 6, 7]);

function slot(over: Partial<PlanSlot>): PlanSlot {
  return {
    day: "Monday",
    period: 0,
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

function dayOf(slots: PlanSlot[], absences: Record<string, number[]>) {
  const { events } = teachingEventsFor(slots, "Monday");
  const needs = coverNeedsFor(events, absences);
  const staff = [...new Set(slots.map((entry) => entry.staffProfileId))];
  const teacherProfiles = buildTeacherProfiles({
    teacherDetails: teacherDetailsFrom(slots, ["Monday"]),
    roster: staff,
  });
  return { needs, teacherProfiles, absenceIndex: absences };
}

describe("the whole plan is checked, not each cover alone", () => {
  // T teaches Class 7 Maths in P1, P2 and P5 (indexes 0, 1, 4) and is the
  // only maths teacher free in P3 and P4 (indexes 2, 3). A is away for both.
  // Either cover alone is legal; both together give T five in a row.
  const slots = [
    slot({ period: 0, classId: "c7", classLabel: "Class 7", staffProfileId: "T" }),
    slot({ period: 1, classId: "c7", classLabel: "Class 7", staffProfileId: "T" }),
    slot({ period: 4, classId: "c7", classLabel: "Class 7", staffProfileId: "T" }),
    slot({ period: 2, staffProfileId: "A" }),
    slot({ period: 3, staffProfileId: "A" }),
    // Somebody else entirely, so the roster is not one person.
    slot({ period: 6, classId: "c9", classLabel: "Class 9", subjectCode: "ART", staffProfileId: "Z" }),
  ];

  it("never commits five consecutive periods to one teacher", () => {
    const input = dayOf(slots, { A: [0, 1, 2, 3, 4, 5, 6, 7] });
    const { duties } = arrangeCover({
      ...input,
      openPeriods: ALL,
      live: [],
      day: "Monday",
      maxConsecutive: 3,
    });
    const byT = duties.filter((duty) => duty.covering_staff_id === "T");
    expect(byT.length).toBeLessThanOrEqual(1);
    expect(duties).toHaveLength(2);
    // The one T could not take is visible, not invented.
    expect(duties.some((duty) => duty.status === "needs_help")).toBe(byT.length < 2);
  });
});

describe("stability", () => {
  const slots = [
    slot({ period: 2, staffProfileId: "A" }),
    slot({ period: 3, classId: "c7", classLabel: "Class 7", staffProfileId: "B" }),
    // Two maths teachers who could each take either.
    slot({ period: 0, classId: "c6", classLabel: "Class 6", staffProfileId: "M" }),
    slot({ period: 1, classId: "c7", classLabel: "Class 7", staffProfileId: "N" }),
  ];

  it("keeps a still-valid cover with its teacher when the day is planned again", () => {
    const first = arrangeCover({
      ...dayOf(slots, { A: [2] }),
      openPeriods: ALL,
      live: [],
      day: "Monday",
    });
    const [cover] = first.duties;
    expect(cover.status).toBe("assigned");

    const live: LiveDuty[] = [
      {
        needKey: cover.need_key,
        period: cover.period,
        status: "assigned",
        coveringStaffId: cover.covering_staff_id,
        source: "auto",
        pinned: false,
        reason: null,
      },
    ];
    // B is now away too: a second absence must not move A's cover.
    const second = arrangeCover({
      ...dayOf(slots, { A: [2], B: [3] }),
      openPeriods: ALL,
      live,
      day: "Monday",
    });
    const kept = second.duties.find((duty) => duty.need_key === cover.need_key);
    expect(kept?.covering_staff_id).toBe(cover.covering_staff_id);
    expect(second.duties).toHaveLength(2);
  });

  it("releases a pinned cover whose teacher is now away, and says why", () => {
    const need = arrangeCover({
      ...dayOf(slots, { A: [2] }),
      openPeriods: ALL,
      live: [],
      day: "Monday",
    }).duties[0];
    const live: LiveDuty[] = [
      {
        needKey: need.need_key,
        period: 2,
        status: "assigned",
        coveringStaffId: "M",
        source: "manual",
        pinned: true,
        reason: null,
      },
    ];
    const { duties } = arrangeCover({
      ...dayOf(slots, { A: [2], M: [2] }),
      openPeriods: ALL,
      live,
      day: "Monday",
    });
    const after = duties.find((duty) => duty.need_key === need.need_key)!;
    expect(after.covering_staff_id).not.toBe("M");
    if (after.status === "needs_help") expect(after.reason).toBe("pin_invalid");
  });
});

describe("what is never automatic", () => {
  it("leaves an unmapped team for a person, with the reason", () => {
    const slots = [
      slot({ classId: "c1", classLabel: "Class 1", subjectCode: "ELGA", staffProfileId: "E", shared: true }),
      slot({ classId: "c1", classLabel: "Class 1", subjectCode: "ELGA", staffProfileId: "F", shared: true }),
      slot({ period: 1, classId: "c9", classLabel: "Class 9", staffProfileId: "Q" }),
    ];
    const { duties } = arrangeCover({
      ...dayOf(slots, { E: [0] }),
      openPeriods: ALL,
      live: [],
      day: "Monday",
    });
    expect(duties).toHaveLength(1);
    expect(duties[0].status).toBe("needs_help");
    expect(duties[0].reason).toBe("team_unmapped");
  });

  it("does not touch a period that has begun", () => {
    const slots = [slot({ period: 0, staffProfileId: "A" }), slot({ period: 1, staffProfileId: "M" })];
    const { duties } = arrangeCover({
      ...dayOf(slots, { A: [0] }),
      openPeriods: new Set([1, 2, 3, 4, 5, 6, 7]),
      live: [],
      day: "Monday",
    });
    expect(duties).toEqual([]);
  });

  it("does not ask a teacher again for a duty they said they cannot cover", () => {
    const slots = [
      slot({ period: 2, staffProfileId: "A" }),
      slot({ period: 0, classId: "c6", classLabel: "Class 6", staffProfileId: "M" }),
    ];
    const input = dayOf(slots, { A: [2] });
    const first = arrangeCover({ ...input, openPeriods: ALL, live: [], day: "Monday" }).duties[0];
    expect(first.covering_staff_id).toBe("M");

    const { duties } = arrangeCover({
      ...input,
      openPeriods: ALL,
      live: [],
      day: "Monday",
      excluded: new Map([[first.need_key, new Set(["M"])]]),
    });
    expect(duties[0].covering_staff_id).not.toBe("M");
  });
});

describe("the coordinator's choice", () => {
  const slots = [
    slot({ period: 2, staffProfileId: "A" }),
    slot({ period: 2, classId: "c7", classLabel: "Class 7", staffProfileId: "B" }),
    slot({ period: 0, classId: "c8", classLabel: "Class 8", subjectCode: "ART", staffProfileId: "R" }),
  ];

  it("is applied, pinned and manual", () => {
    const input = dayOf(slots, { A: [2] });
    const need = arrangeCover({ ...input, openPeriods: ALL, live: [], day: "Monday" }).duties[0];
    const { duties, refusedOverride } = arrangeCover({
      ...input,
      openPeriods: ALL,
      live: [],
      day: "Monday",
      override: { needKey: need.need_key, coveringStaffId: "R" },
    });
    expect(refusedOverride).toBeNull();
    expect(duties[0]).toMatchObject({ covering_staff_id: "R", source: "manual", pinned: true });
  });

  it("cannot put a teacher in two rooms at once", () => {
    const input = dayOf(slots, { A: [2] });
    const need = arrangeCover({ ...input, openPeriods: ALL, live: [], day: "Monday" }).duties[0];
    // B teaches Class 7 in that very period.
    const { refusedOverride } = arrangeCover({
      ...input,
      openPeriods: ALL,
      live: [],
      day: "Monday",
      override: { needKey: need.need_key, coveringStaffId: "B" },
    });
    expect(refusedOverride?.blocked).toContain("regular_class");
  });
});
