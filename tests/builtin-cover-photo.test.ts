import { describe, expect, it } from "vitest";

import { reviewCoverPhoto, writtenCoverDate } from "@/lib/ai/cover-photo-review";
import type { CoverPhoto } from "@/lib/ai/cover-photo-types";
import type { CoverDay } from "@/modules/substitutions/data/arrange-day";
import { buildTeacherProfiles } from "@/modules/substitutions/domain/engine";
import { teacherDetailsFrom, type PlanSlot } from "@/modules/substitutions/domain/plan";
import { DEFAULT_BELLS } from "@/modules/timetable/domain/bells";

const day = "2026-11-04";
const header = "Wednesday";
const people = [
  { id: "al", displayName: "Asha Lal", shortName: "AL" },
  { id: "rs", displayName: "Ravi Sen", shortName: "RS" },
  { id: "jp", displayName: "Jyoti Pal", shortName: "JP" },
  { id: "mk", displayName: "Mina Kumar", shortName: "MK" },
].map((person) => ({ ...person, isTeaching: true, hasPhone: false, hasLogin: true }));
function slot(staffProfileId: string, period: number, classLabel: string, subjectCode: string, slotDay = header): PlanSlot {
  return {
    staffProfileId, period, classId: "class-" + classLabel, classLabel, subjectCode, day: slotDay,
    teacherShortName: staffProfileId.toUpperCase(), parallel: false, shared: false,
  };
}
const slots = [
  slot("al", 2, "3", "EVS"),
  slot("al", 3, "7A", "MATH"),
  slot("mk", 2, "8B", "HINDI"),
  slot("jp", 2, "8A", "EVS"),
  slot("rs", 2, "3", "EVS", "Monday"),
  slot("jp", 2, "3", "EVS", "Tuesday"),
];
const base: CoverDay = {
  day, header, sessionLabel: "TEST-2026-27", versionId: "tt", slots, bells: DEFAULT_BELLS, dayRevision: 0,
  absences: [], absenceIndex: {}, duties: [], live: [], needs: [], clashes: [], openPeriods: new Set([2, 3]), staff: people,
};
const row = {
  sourceDate: "04/11/2026", absentTeacher: "A. L. ma’am", period: "Ⅲ", classLabel: "3rd EVS", substitute: "RS sir", unclear: false,
};

function review(rows: CoverPhoto["rows"], overrides: Partial<Parameters<typeof reviewCoverPhoto>[0]> = {}) {
  const cover = overrides.day ?? base;
  return reviewCoverPhoto({
    photo: { rows }, day: cover, history: {}, excluded: new Map(), leave: {},
    now: new Date("2026-11-04T01:00:00Z"),
    teacherProfiles: buildTeacherProfiles({
      teacherDetails: teacherDetailsFrom(cover.slots, ["Monday", "Tuesday", header]),
      roster: cover.staff.map((person) => person.id),
    }),
    ...overrides,
  });
}

describe("substitution photo local validation", () => {
  it("matches the register’s grouped initials, Roman period and class with subject", () => {
    const outcome = review([row, { ...row, period: "IV", classLabel: "7 A Mathematics" }]);
    expect(outcome.review.rows.map((entry) => entry.issue)).toEqual([null, null]);
    expect(outcome.assignments).toMatchObject([
      { index: 0, absentId: "al", coveringId: "rs", period: 2, classId: "class-3" },
      { index: 1, absentId: "al", coveringId: "rs", period: 3, classId: "class-7A" },
    ]);
  });

  it("requires a complete, independently written date for each row", () => {
    expect(writtenCoverDate("४.११.२०२६")).toBe(day);
    expect(writtenCoverDate("31/11/2026")).toBeNull();
    expect(writtenCoverDate("04/11/26")).toBeNull();
    const outcome = review([row, { ...row, sourceDate: "" }, { ...row, sourceDate: "05/11/2026" }]);
    expect(outcome.assignments).toHaveLength(1);
    expect(outcome.review.rows.map((entry) => entry.issue)).toEqual([null, "source_date", "source_date"]);
  });

  it("preserves valid rows and ranks available teachers for unclear or conflicting rows", () => {
    const outcome = review([
      { ...row, period: "IV", classLabel: "7A", substitute: "MK" },
      { ...row, substitute: "JP", unclear: true },
      { ...row, absentTeacher: "MK", classLabel: "8B Hindi", substitute: "AL" },
    ]);
    expect(outcome.assignments).toMatchObject([{ index: 0, coveringId: "mk" }]);
    expect(outcome.review.rows.map((entry) => entry.issue)).toEqual([null, "unclear", "unavailable"]);
    expect(outcome.review.rows[1].suggestions).toMatchObject([{ label: "Ravi Sen" }]);
    expect(outcome.review.rows[2].suggestions).toMatchObject([{ label: "Ravi Sen" }]);
    const target = new URL(outcome.review.rows[1].suggestions[0].href, "https://local.test");
    expect(target.pathname).toBe("/substitutions/arrange");
    expect(Object.fromEntries(target.searchParams)).toMatchObject({ day, staff: "al", periods: "2", photoCover: "rs" });
  });

  it("never guesses an abbreviated teacher, a missing class section or an incorrect subject", () => {
    const outcome = review([
      { ...row, absentTeacher: "Asha" },
      { ...row, period: "IV", classLabel: "7th" },
      { ...row, classLabel: "3rd English" },
    ]);
    expect(outcome.review.rows.map((entry) => entry.issue)).toEqual(["teacher", "lesson", "lesson"]);
    expect(outcome.assignments).toEqual([]);
  });

  it("blocks duplicate rows, double bookings, approved leave, and starts inside the Undo window", () => {
    expect(review([row, row]).review.rows.map((entry) => entry.issue)).toEqual(["duplicate", "duplicate"]);
    expect(review([row, { ...row, absentTeacher: "MK", classLabel: "8B" }]).review.rows.map((entry) => entry.issue))
      .toEqual(["double_booked", "double_booked"]);
    expect(review([row], { leave: { rs: [2] } }).review.rows[0].issue).toBe("unavailable");
    expect(review([row], { now: new Date("2026-11-04T04:19:00Z") }).review.rows[0].issue).toBe("closed");
  });
});
