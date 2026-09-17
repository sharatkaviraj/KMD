import { describe, expect, it } from "vitest";

import {
  classesToday,
  lessonsToday,
  nextAction,
  outstanding,
  periodsInOrder,
  quietReason,
  registersDue,
  type ExistingRegister,
  type HeldClass,
  type PeriodSlot,
} from "@/modules/attendance/domain/today";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";

const held: HeldClass[] = [
  { classId: "c1", classLabel: "Class 6" },
  { classId: "c2", classLabel: "Class 7" },
];

const slot = (period: number, classId: string, classLabel: string): PeriodSlot => ({
  period,
  classId,
  classLabel,
  subjectCode: "MATH",
});

describe("registersDue()", () => {
  it("expects one register per class held", () => {
    const tasks = registersDue({ heldClasses: held, registers: [], schoolOpen: true });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => task.period === null)).toBe(true);
    expect(tasks.every((task) => !task.done)).toBe(true);
  });

  it("marks a class done once its register is submitted", () => {
    const registers: ExistingRegister[] = [
      { classId: "c1", period: null, status: "submitted" },
    ];

    const tasks = registersDue({ heldClasses: held, registers, schoolOpen: true });
    expect(tasks.find((task) => task.classId === "c1")?.done).toBe(true);
    expect(tasks.find((task) => task.classId === "c2")?.done).toBe(false);
  });

  it("does not count a register somebody still has open", () => {
    // A register open on a phone is not yet a fact about the children.
    const registers: ExistingRegister[] = [
      { classId: "c1", period: null, status: "open" },
    ];

    expect(
      registersDue({ heldClasses: held, registers, schoolOpen: true })[0].done,
    ).toBe(false);
  });

  it("does not count a period register as the daily one", () => {
    const registers: ExistingRegister[] = [
      { classId: "c1", period: 3, status: "submitted" },
    ];

    expect(
      registersDue({ heldClasses: held, registers, schoolOpen: true })[0].done,
    ).toBe(false);
  });

  it("asks for nothing on a day the school is shut", () => {
    expect(
      registersDue({ heldClasses: held, registers: [], schoolOpen: false }),
    ).toEqual([]);
  });
});

describe("quietReason()", () => {
  /**
   * Three kinds of nothing that a card counting rows would render the same
   * way. Only one of them means "you are finished".
   */
  it("says the school is closed", () => {
    expect(
      quietReason({ schoolOpen: false, heldClasses: held, tasks: [] }),
    ).toBe("closed");
  });

  it("says you hold no class", () => {
    expect(
      quietReason({ schoolOpen: true, heldClasses: [], tasks: [] }),
    ).toBe("none-held");
  });

  it("says everything is done", () => {
    const tasks = registersDue({
      heldClasses: held,
      registers: held.map((entry) => ({
        classId: entry.classId,
        period: null,
        status: "submitted" as const,
      })),
      schoolOpen: true,
    });

    expect(quietReason({ schoolOpen: true, heldClasses: held, tasks })).toBe(
      "all-done",
    );
  });

  it("says nothing at all when there is work left", () => {
    const tasks = registersDue({ heldClasses: held, registers: [], schoolOpen: true });
    expect(quietReason({ schoolOpen: true, heldClasses: held, tasks })).toBeNull();
  });
});

describe("outstanding()", () => {
  it("is the list the card leads with", () => {
    const tasks = registersDue({
      heldClasses: held,
      registers: [{ classId: "c1", period: null, status: "submitted" }],
      schoolOpen: true,
    });

    expect(outstanding(tasks).map((task) => task.classId)).toEqual(["c2"]);
  });
});

describe("periodsInOrder()", () => {
  it("teaches them in the order they happen", () => {
    const slots = [slot(5, "c1", "Class 6"), slot(1, "c2", "Class 7")];
    expect(periodsInOrder(slots).map((entry) => entry.period)).toEqual([1, 5]);
  });

  it("does not grow a gap where a period number is missing", () => {
    const slots = [slot(1, "c1", "Class 6"), slot(8, "c1", "Class 6")];
    expect(periodsInOrder(slots)).toHaveLength(2);
  });
});

describe("classesToday()", () => {
  it("puts the classes you hold first", () => {
    const slots = [slot(1, "c9", "Class 9")];
    expect(classesToday({ heldClasses: held, slots }).map((c) => c.classId)).toEqual([
      "c1",
      "c2",
      "c9",
    ]);
  });

  it("does not list a class twice when you both hold and teach it", () => {
    const slots = [slot(1, "c1", "Class 6"), slot(2, "c1", "Class 6")];
    expect(classesToday({ heldClasses: held, slots })).toHaveLength(2);
  });
});

describe("matchDayHeader()", () => {
  const headers = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  it("finds today's block", () => {
    // 2026-09-17 is a Thursday.
    expect(matchDayHeader(headers, "2026-09-17")).toBe("Thursday");
  });

  it("ignores case and stray spacing, which a retyped sheet has", () => {
    expect(matchDayHeader(["  THURSDAY "], "2026-09-17")).toBe("  THURSDAY ");
  });

  it("accepts an abbreviation", () => {
    expect(matchDayHeader(["Mon", "Tue", "Thu"], "2026-09-17")).toBe("Thu");
  });

  it("does not match a header that merely starts the same way", () => {
    // "Monthly test" starts with "Mon" but is not Monday.
    expect(matchDayHeader(["Monthly test"], "2026-09-14")).toBeNull();
  });

  it("returns null on a day the sheet has no block for", () => {
    // Sunday, which the school's timetable does not have.
    expect(matchDayHeader(headers, "2026-09-20")).toBeNull();
  });

  it("returns null rather than guessing when the sheet is empty", () => {
    expect(matchDayHeader([], "2026-09-17")).toBeNull();
  });
});

/* ------------------------------------------------ one lesson, not one slot */

describe("lessonsToday()", () => {
  const lesson = (
    period: number,
    classId: string,
    subjectCode: string,
  ): PeriodSlot => ({
    period,
    classId,
    classLabel: classId.toUpperCase(),
    subjectCode,
  });

  it("merges a subject taught to several classes at once into one lesson", () => {
    // B-20: ELGA is taught to Classes 1–5 in one room, and the timetable
    // stores a slot per class. Five rows told a teacher she was in five rooms.
    const lessons = lessonsToday([
      lesson(2, "c1", "ELGA"),
      lesson(2, "c2", "ELGA"),
      lesson(2, "c3", "ELGA"),
      lesson(2, "c4", "ELGA"),
      lesson(2, "c5", "ELGA"),
    ]);

    expect(lessons).toHaveLength(1);
    expect(lessons[0].classes.map((entry) => entry.classId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("turns an eight-period day into eight rows, not twenty", () => {
    const slots = [
      lesson(0, "c2", "Maths"),
      lesson(1, "c2", "Maths"),
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => lesson(2, id, "ELGA")),
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => lesson(3, id, "ELGA")),
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => lesson(4, id, "ELGA")),
      lesson(5, "c3", "Maths"),
      lesson(6, "c1", "EVS"),
      lesson(7, "c1", "EVS"),
    ];

    expect(slots).toHaveLength(20);
    expect(lessonsToday(slots)).toHaveLength(8);
  });

  it("gives a single-class lesson a class to open and a combined one none", () => {
    const [combined, alone] = lessonsToday([
      lesson(1, "c1", "ELGA"),
      lesson(1, "c2", "ELGA"),
      lesson(2, "c3", "Maths"),
    ]);

    // Offering one of the five would be picking a room at random.
    expect(combined.classId).toBeNull();
    expect(alone.classId).toBe("c3");
  });

  it("keeps two different subjects in one period apart", () => {
    // That is a clash, and merging it would hide the thing worth seeing.
    const lessons = lessonsToday([lesson(3, "c1", "Maths"), lesson(3, "c2", "Hindi")]);

    expect(lessons).toHaveLength(2);
    expect(lessons.map((entry) => entry.subjectCode)).toEqual(["Hindi", "Maths"]);
  });

  it("does not list the same class twice in one lesson", () => {
    const lessons = lessonsToday([lesson(1, "c1", "Games"), lesson(1, "c1", "Games")]);

    expect(lessons[0].classes).toHaveLength(1);
  });

  it("is in period order", () => {
    const lessons = lessonsToday([lesson(7, "c1", "EVS"), lesson(0, "c2", "Maths")]);

    expect(lessons.map((entry) => entry.period)).toEqual([0, 7]);
  });

  it("is empty for a day with no slots, rather than throwing", () => {
    expect(lessonsToday([])).toEqual([]);
  });
});

/* -------------------------------------------------- one thing to do next */

describe("nextAction()", () => {
  const mine: HeldClass[] = [
    { classId: "c1", classLabel: "Class 1" },
    { classId: "c2", classLabel: "Class 2" },
  ];

  it("is the first outstanding register", () => {
    const tasks = [
      { classId: "c1", classLabel: "Class 1", period: null, done: true },
      { classId: "c2", classLabel: "Class 2", period: null, done: false },
    ];

    const action = nextAction({ schoolOpen: true, heldClasses: mine, tasks });

    expect(action.kind).toBe("register");
    if (action.kind === "register") expect(action.task.classId).toBe("c2");
  });

  it("offers nothing at all when everything is in", () => {
    // "You are finished" is the most useful thing the screen can say, and
    // inventing a task to fill the space is how it stops being believed.
    const tasks = mine.map((entry) => ({ ...entry, period: null, done: true }));
    const action = nextAction({ schoolOpen: true, heldClasses: mine, tasks });

    expect(action).toEqual({ kind: "none", reason: "all-done" });
  });

  it("says why there is nothing, and the three whys stay apart", () => {
    expect(nextAction({ schoolOpen: false, heldClasses: mine, tasks: [] })).toEqual({
      kind: "none",
      reason: "closed",
    });

    expect(nextAction({ schoolOpen: true, heldClasses: [], tasks: [] })).toEqual({
      kind: "none",
      reason: "none-held",
    });
  });

  it("agrees with registersDue about a closed day", () => {
    // The hero reads the same task list the rest of the screen does, so a
    // holiday cannot produce an action on one and a holiday notice on the
    // other.
    const tasks = registersDue({ heldClasses: mine, registers: [], schoolOpen: false });

    expect(tasks).toEqual([]);
    expect(nextAction({ schoolOpen: false, heldClasses: mine, tasks })).toEqual({
      kind: "none",
      reason: "closed",
    });
  });
});
