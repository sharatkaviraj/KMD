import { describe, expect, it } from "vitest";

import {
  attendancePercent,
  canMarkClass,
  compareRoll,
  COUNTS_AGAINST,
  COUNTS_AS_PRESENT,
  isEditable,
  mergeQueued,
  pendingFlushes,
  queueKeyFor,
  submitRegisterSchema,
  tally,
  type QueuedRegister,
  type Register,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";

const student = (
  studentId: string,
  fullName: string,
  rollNo: string | null = null,
): RollStudent => ({ studentId, fullName, admissionNo: null, rollNo });

describe("what counts as being in school", () => {
  /**
   * A child who arrived at 9:15 was in school that day. A percentage that says
   * otherwise is wrong in the direction that gets a family a letter they do
   * not deserve.
   */
  it("counts late as present", () => {
    expect(COUNTS_AS_PRESENT.late).toBe(true);
    expect(COUNTS_AGAINST.late).toBe(false);
  });

  it("counts approved leave as neither", () => {
    expect(COUNTS_AS_PRESENT.leave).toBe(false);
    expect(COUNTS_AGAINST.leave).toBe(false);
  });
});

describe("attendancePercent()", () => {
  it("leaves approved leave out of both halves", () => {
    // Twenty days, two of them on leave: the child attended 18 of 18.
    const statuses = [
      ...Array(18).fill("present" as const),
      ...Array(2).fill("leave" as const),
    ];

    expect(attendancePercent(statuses)).toEqual({
      percent: 100,
      counted: 18,
      present: 18,
    });
  });

  it("counts late towards attendance", () => {
    expect(attendancePercent(["present", "late", "absent", "late"]).percent).toBe(75);
  });

  it("returns null rather than zero when there is nothing to divide by", () => {
    // "No data" and "never came" must not look the same on a report card.
    expect(attendancePercent([]).percent).toBeNull();
    expect(attendancePercent(["leave", "leave"]).percent).toBeNull();
  });

  it("rounds to one decimal place", () => {
    expect(attendancePercent(["present", "present", "absent"]).percent).toBe(66.7);
  });
});

describe("compareRoll()", () => {
  it("sorts by roll number when there is one", () => {
    const roll = [student("c", "Chetan", "10"), student("a", "Asha", "2")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "c"]);
  });

  it("sorts a missing roll number last, not first", () => {
    // A null at the top of a register looks like the list is broken.
    const roll = [student("a", "Asha", null), student("b", "Bhavna", "5")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["b", "a"]);
  });

  it("falls back to the name when neither has a number", () => {
    const roll = [student("z", "Zoya"), student("a", "Asha")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "z"]);
  });

  it("reads a roll number that carries a letter", () => {
    const roll = [student("b", "B", "A-12"), student("a", "A", "A-3")];
    expect([...roll].sort(compareRoll).map((s) => s.studentId)).toEqual(["a", "b"]);
  });
});

describe("tally()", () => {
  const roll = [student("a", "Asha"), student("b", "Bhavna"), student("c", "Chetan")];

  it("counts only the children on the roll", () => {
    const marks = new Map([
      ["a", "present" as const],
      ["b", "absent" as const],
      // Somebody who has left the class: their stale mark must not inflate the
      // count of a register that is not complete.
      ["gone", "present" as const],
    ]);

    const counted = tally(roll, marks);
    expect(counted.marked).toBe(2);
    expect(counted.total).toBe(3);
    expect(counted.complete).toBe(false);
  });

  it("is complete only when everybody has a mark", () => {
    const marks = new Map([
      ["a", "present" as const],
      ["b", "late" as const],
      ["c", "leave" as const],
    ]);

    expect(tally(roll, marks).complete).toBe(true);
  });

  it("is not complete for an empty class", () => {
    // Otherwise a class with nobody in it reports a finished register.
    expect(tally([], new Map()).complete).toBe(false);
  });
});

/* ------------------------------------------------------ the offline queue */

const queued = (over: Partial<QueuedRegister> = {}): QueuedRegister => ({
  clientId: "session-1",
  classId: "class-1",
  day: "2026-09-17",
  period: null,
  marks: {},
  submitted: false,
  updatedAt: 1000,
  ...over,
});

describe("mergeQueued()", () => {
  /**
   * The failure this prevents: a teacher marks twenty children, the signal
   * goes, they mark the last ten, and the merge throws away the first twenty.
   */
  it("merges per student, not per register", () => {
    const first = queued({
      marks: { a: { status: "present", note: null } },
      updatedAt: 1000,
    });
    const second = queued({
      marks: { b: { status: "absent", note: null } },
      updatedAt: 2000,
    });

    expect(mergeQueued(first, second).marks).toEqual({
      a: { status: "present", note: null },
      b: { status: "absent", note: null },
    });
  });

  it("lets the newer mark win for the same child", () => {
    const first = queued({ marks: { a: { status: "absent", note: null } } });
    const second = queued({
      marks: { a: { status: "present", note: null } },
      updatedAt: 2000,
    });

    expect(mergeQueued(first, second).marks.a.status).toBe("present");
  });

  it("never un-submits a register", () => {
    // A later edit is still work to flush, but the teacher believes they have
    // handed this in — and they have.
    const submitted = queued({ submitted: true, updatedAt: 2000 });
    const edited = queued({ submitted: false, updatedAt: 3000 });

    expect(mergeQueued(submitted, edited).submitted).toBe(true);
  });

  it("takes the newer of two different marking sessions", () => {
    const stale = queued({ clientId: "old", updatedAt: 5000 });
    const fresh = queued({ clientId: "new", updatedAt: 1000 });

    // Different sessions do not merge: the older one is somebody's abandoned
    // work, and blending them would produce a register nobody marked.
    expect(mergeQueued(stale, fresh).clientId).toBe("old");
  });

  it("returns the incoming one when the queue is empty", () => {
    const fresh = queued();
    expect(mergeQueued(undefined, fresh)).toBe(fresh);
  });
});

describe("queueKeyFor()", () => {
  it("keeps the daily register and a period register apart", () => {
    expect(queueKeyFor("c1", "2026-09-17", null)).not.toBe(
      queueKeyFor("c1", "2026-09-17", 3),
    );
  });

  it("is the same key for the same register, so a retry overwrites", () => {
    expect(queueKeyFor("c1", "2026-09-17", null)).toBe(
      queueKeyFor("c1", "2026-09-17", null),
    );
  });
});

describe("pendingFlushes()", () => {
  it("sends the oldest work first", () => {
    const flushes = pendingFlushes({
      b: queued({ clientId: "b", updatedAt: 3000 }),
      a: queued({ clientId: "a", updatedAt: 1000 }),
    });

    expect(flushes.map((entry) => entry.clientId)).toEqual(["a", "b"]);
  });
});

/* -------------------------------------------------------------- who marks */

describe("canMarkClass()", () => {
  const base = {
    hasMarkPermission: true,
    hasMarkOnBehalfPermission: false,
    ownClassIds: ["mine"],
    classId: "mine",
  };

  it("lets a teacher mark their own class", () => {
    expect(canMarkClass(base)).toEqual({ allowed: true, onBehalf: false });
  });

  it("refuses a class that is not theirs, and says why", () => {
    const verdict = canMarkClass({ ...base, classId: "somebody-elses" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.hi).toBeTruthy();
    expect(verdict.reason?.en).toBeTruthy();
  });

  it("lets the office mark any class, and records that it did", () => {
    // `onBehalf` is the whole point: "the office recorded this" and "the
    // teacher recorded this" are different facts.
    const verdict = canMarkClass({
      ...base,
      hasMarkPermission: false,
      hasMarkOnBehalfPermission: true,
      classId: "somebody-elses",
    });

    expect(verdict).toEqual({ allowed: true, onBehalf: true });
  });

  it("does not mark a teacher's own class as on-behalf", () => {
    const verdict = canMarkClass({ ...base, hasMarkOnBehalfPermission: true });
    expect(verdict.onBehalf).toBe(false);
  });

  it("refuses somebody with neither permission", () => {
    const verdict = canMarkClass({
      ...base,
      hasMarkPermission: false,
      hasMarkOnBehalfPermission: false,
    });

    expect(verdict.allowed).toBe(false);
  });
});

describe("isEditable()", () => {
  const register = (status: "open" | "submitted"): Register => ({
    id: "r1",
    sessionLabel: "2026-27",
    classId: "c1",
    day: "2026-09-17",
    period: null,
    status,
    takenBy: null,
    onBehalfOf: null,
    submittedAt: null,
  });

  it("treats a register that does not exist yet as editable", () => {
    expect(isEditable(null)).toBe(true);
  });

  it("locks a submitted register", () => {
    expect(isEditable(register("submitted"))).toBe(false);
    expect(isEditable(register("open"))).toBe(true);
  });
});

describe("submitRegisterSchema", () => {
  const valid = {
    classId: "0192e5b2-0000-7000-8000-000000000001",
    day: "2026-09-17",
    period: null,
    marks: [
      {
        studentId: "0192e5b2-0000-7000-8000-000000000002",
        status: "present",
        note: "",
      },
    ],
    submit: true,
  };

  it("accepts a whole register in one payload", () => {
    const parsed = submitRegisterSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    // An empty note becomes null rather than an empty string, so the column
    // has one representation of "nothing".
    expect(parsed.success && parsed.data.marks[0].note).toBeNull();
  });

  it("refuses a register with no marks at all", () => {
    expect(
      submitRegisterSchema.safeParse({ ...valid, marks: [] }).success,
    ).toBe(false);
  });

  it("refuses a day that is not a date", () => {
    expect(
      submitRegisterSchema.safeParse({ ...valid, day: "17/09/2026" }).success,
    ).toBe(false);
  });

  it("refuses a status it has never heard of", () => {
    expect(
      submitRegisterSchema.safeParse({
        ...valid,
        marks: [{ ...valid.marks[0], status: "maybe" }],
      }).success,
    ).toBe(false);
  });
});
