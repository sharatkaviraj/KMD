import { describe, expect, it } from "vitest";

import { supportAttention } from "@/vx/screens/admin/logic";
import { groupActivities, scheduleNow, type ScheduleInput, type ScheduleSlot } from "@/vx/screens/admin/schedule";

/* Test data only: classes, subjects and teachers are invented. */

const BELLS = [
  { index: 0, starts: "08:00", ends: "08:40" },
  { index: 1, starts: "08:40", ends: "09:20" },
  // a break from 09:20 to 09:40
  { index: 2, starts: "09:40", ends: "10:20" },
];

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function slot(period: number, classId: string, subjectCode: string, staffProfileId: string, extra: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    period,
    classId,
    classLabel: classId.toUpperCase(),
    subjectCode,
    staffProfileId,
    teacherShortName: staffProfileId.toUpperCase(),
    shared: false,
    parallel: false,
    ...extra,
  };
}

const SLOTS: ScheduleSlot[] = [
  slot(0, "c6a", "MATH", "t1"),
  slot(0, "c6b", "ENG", "t2"),
  slot(1, "c6a", "SCI", "t3"),
  slot(1, "c6b", "MATH", "t1"),
  slot(2, "c6a", "HIN", "t2"),
];

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    bells: BELLS,
    nowMinutes: at("08:10"),
    schoolOpen: true,
    timetableRuns: true,
    slots: SLOTS,
    duties: [],
    absences: [],
    names: new Map([
      ["t1", "Teacher One"],
      ["t2", "Teacher Two"],
      ["t3", "Teacher Three"],
      ["t4", "Teacher Four"],
      ["t5", "Teacher Five"],
    ]),
    classRank: new Map([
      ["c6a", 1],
      ["c6b", 2],
      ["c7a", 3],
    ]),
    ...overrides,
  };
}

describe("scheduleNow — where the day stands", () => {
  it("before the first bell, shows the first period as next", () => {
    const view = scheduleNow(input({ nowMinutes: at("07:30") }));
    expect(view.state).toBe("before");
    if (view.state !== "before") return;
    expect(view.next.number).toBe(1);
    expect(view.next.starts).toBe("08:00");
    expect(view.next.activities.map((a) => a.classes[0].label)).toEqual(["C6A", "C6B"]);
  });

  it("during a period, shows it as now and the following one as next", () => {
    const view = scheduleNow(input({ nowMinutes: at("08:45") }));
    expect(view.state).toBe("during");
    if (view.state !== "during") return;
    expect(view.now.number).toBe(2);
    expect(view.now.activities.map((a) => [a.classes[0].label, a.subjects[0], a.teachers[0].name])).toEqual([
      ["C6A", "SCI", "Teacher Three"],
      ["C6B", "MATH", "Teacher One"],
    ]);
    expect(view.next?.number).toBe(3);
  });

  it("in the last period, there is no next", () => {
    const view = scheduleNow(input({ nowMinutes: at("10:00") }));
    expect(view.state).toBe("during");
    if (view.state !== "during") return;
    expect(view.now.number).toBe(3);
    expect(view.next).toBeNull();
  });

  it("between periods, is a break with the next period", () => {
    const view = scheduleNow(input({ nowMinutes: at("09:25") }));
    expect(view.state).toBe("break");
    if (view.state !== "break") return;
    expect(view.next.number).toBe(3);
  });

  it("after the last bell, the school day is finished", () => {
    expect(scheduleNow(input({ nowMinutes: at("14:00") }))).toEqual({ state: "after", lastEnds: "10:20" });
  });

  it("on a closed day says so, whatever the clock", () => {
    expect(scheduleNow(input({ schoolOpen: false })).state).toBe("closed");
  });

  it("on an open day the timetable does not run, says so", () => {
    expect(scheduleNow(input({ timetableRuns: false })).state).toBe("no_teaching");
  });

  it("with nothing published for today, says so rather than showing an empty period", () => {
    expect(scheduleNow(input({ slots: [] })).state).toBe("no_timetable");
  });

  it("orders bells by time, not by the order they were stored in", () => {
    const view = scheduleNow(input({ bells: [...BELLS].reverse(), nowMinutes: at("07:00") }));
    expect(view.state === "before" && view.next.number).toBe(1);
  });
});

describe("groupActivities — several rows are one activity only when the timetable says so", () => {
  it("shows a shared ELGA block with several teachers and classes once", () => {
    // Two teachers take ELGA together for two classes: four rows, one activity.
    const elga = [
      slot(0, "c6a", "ELGA", "t4", { shared: true }),
      slot(0, "c6a", "ELGA", "t5", { shared: true }),
      slot(0, "c6b", "ELGA", "t4", { shared: true }),
      slot(0, "c6b", "ELGA", "t5", { shared: true }),
    ];
    const view = scheduleNow(input({ slots: elga, nowMinutes: at("08:05") }));
    expect(view.state).toBe("during");
    if (view.state !== "during") return;
    expect(view.now.activities).toHaveLength(1);
    const [activity] = view.now.activities;
    expect(activity.kind).toBe("shared");
    expect(activity.classes.map((c) => c.label)).toEqual(["C6A", "C6B"]);
    expect(activity.subjects).toEqual(["ELGA"]);
    expect(activity.teachers.map((t) => t.name)).toEqual(["Teacher Four", "Teacher Five"]);
  });

  it("one teacher with the same subject in several classes is one combined lesson", () => {
    const groups = groupActivities([slot(0, "c6a", "GAMES", "t1"), slot(0, "c6b", "GAMES", "t1"), slot(0, "c7a", "GAMES", "t1")]);
    expect(groups).toHaveLength(1);
    const view = scheduleNow(input({ slots: [slot(0, "c6a", "GAMES", "t1"), slot(0, "c6b", "GAMES", "t1")], nowMinutes: at("08:05") }));
    expect(view.state === "during" && view.now.activities[0].kind).toBe("combined");
  });

  it("never merges two teachers with the same subject in different classes", () => {
    expect(groupActivities([slot(0, "c6a", "MATH", "t1"), slot(0, "c6b", "MATH", "t2")])).toHaveLength(2);
  });

  it("never merges two unflagged subjects in one class — that is a clash, not a lesson", () => {
    expect(groupActivities([slot(0, "c6a", "MATH", "t1"), slot(0, "c6a", "SCI", "t3")])).toHaveLength(2);
  });

  it("keeps a parallel class as one activity with each teacher's subject", () => {
    const view = scheduleNow(
      input({
        slots: [slot(0, "c6a", "BIO", "t1", { parallel: true }), slot(0, "c6a", "CS", "t2", { parallel: true })],
        nowMinutes: at("08:05"),
      }),
    );
    if (view.state !== "during") throw new Error("expected during");
    expect(view.now.activities).toHaveLength(1);
    expect(view.now.activities[0].kind).toBe("parallel");
    expect(view.now.activities[0].subjects).toEqual(["BIO", "CS"]);
    expect(view.now.activities[0].teachers.map((t) => t.subjectCode)).toEqual(["BIO", "CS"]);
  });
});

describe("cover laid over the timetable", () => {
  const during = (overrides: Partial<ScheduleInput>) => {
    const view = scheduleNow(input({ nowMinutes: at("08:10"), ...overrides }));
    if (view.state !== "during") throw new Error("expected during");
    return view.now;
  };

  it("an absent teacher with cover arranged shows who covers", () => {
    const now = during({
      absences: [{ staffProfileId: "t1", periods: [] }],
      duties: [{ period: 0, classIds: ["c6a"], absentStaffIds: ["t1"], status: "assigned", coveringStaffId: "t3" }],
    });
    const math = now.activities.find((a) => a.subjects[0] === "MATH")!;
    expect(math.teachers[0].cover).toEqual({ state: "covered", by: "Teacher Three" });
    expect(now.covered).toBe(1);
    expect(now.uncovered).toBe(0);
  });

  it("an absent teacher without a substitute shows it is needed", () => {
    const now = during({
      absences: [{ staffProfileId: "t1", periods: [0, 1] }],
      duties: [{ period: 0, classIds: ["c6a"], absentStaffIds: ["t1"], status: "needs_help", coveringStaffId: null }],
    });
    expect(now.activities.find((a) => a.subjects[0] === "MATH")!.teachers[0].cover).toEqual({ state: "needed" });
    expect(now.uncovered).toBe(1);
  });

  it("an absent teacher with no duty on record is marked on leave, not covered", () => {
    const now = during({ absences: [{ staffProfileId: "t1", periods: [] }] });
    expect(now.activities.find((a) => a.subjects[0] === "MATH")!.teachers[0].cover).toEqual({ state: "away" });
  });

  it("a part-day absence outside this period leaves the teacher in school", () => {
    const now = during({ absences: [{ staffProfileId: "t1", periods: [2] }] });
    expect(now.activities.find((a) => a.subjects[0] === "MATH")!.teachers[0].cover).toBeNull();
  });

  it("ignores cancelled and superseded duties", () => {
    const now = during({
      duties: [
        { period: 0, classIds: ["c6a"], absentStaffIds: ["t1"], status: "cancelled", coveringStaffId: "t3" },
        { period: 0, classIds: ["c6a"], absentStaffIds: ["t1"], status: "superseded", coveringStaffId: "t3" },
      ],
    });
    expect(now.activities.find((a) => a.subjects[0] === "MATH")!.teachers[0].cover).toBeNull();
  });

  it("in a shared lesson, marks only the teacher who is away", () => {
    const now = during({
      slots: [slot(0, "c6a", "ELGA", "t4", { shared: true }), slot(0, "c6a", "ELGA", "t5", { shared: true })],
      absences: [{ staffProfileId: "t5", periods: [] }],
    });
    expect(now.activities).toHaveLength(1);
    expect(now.activities[0].teachers.map((t) => [t.name, t.cover?.state ?? "in"])).toEqual([
      ["Teacher Four", "in"],
      ["Teacher Five", "away"],
    ]);
  });
});

describe("supportAttention", () => {
  const today = "2026-10-12";
  it("counts due follow-ups and unpicked health or family notes, never done ones", () => {
    expect(
      supportAttention(
        [
          { status: "open", needsFollowUp: true, followUpOn: "2026-10-10", tags: ["studies"] },
          { status: "working", needsFollowUp: true, followUpOn: "2026-10-12", tags: [] },
          { status: "open", needsFollowUp: true, followUpOn: "2026-10-20", tags: ["health"] },
          { status: "open", needsFollowUp: false, followUpOn: null, tags: ["family"] },
          { status: "working", needsFollowUp: false, followUpOn: null, tags: ["health"] },
          { status: "done", needsFollowUp: true, followUpOn: "2026-10-01", tags: ["health"] },
          { status: "open", needsFollowUp: false, followUpOn: null, tags: ["talent"] },
        ],
        today,
      ),
    ).toEqual({ needsAction: 3, due: 2 });
  });
});
