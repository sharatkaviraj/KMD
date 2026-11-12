import { describe, expect, it } from "vitest";

import { durationParts, median, topicOf, weekBounds, weekReport, type WeekHandoff, type WeekTurn } from "@/modules/whatsapp/domain/helper-week";

/**
 * Veer Patta AI's week (D-590): the numbers the owner reads each week. Every
 * id here is made up (rule 6).
 */

function turn(over: Partial<WeekTurn> = {}): WeekTurn {
  return { status: "answered", intent: "fees", route: "rule", handoff: null, costUsd: 0, latencyMs: 2_000, lessonRole: null, ...over };
}

function handoff(over: Partial<WeekHandoff> & { id: string }): WeekHandoff {
  return { replyId: `r-${over.id}`, target: "class_teacher", createdAt: "2026-11-10T04:00:00.000Z", assignedTo: "t1", answeredAt: null, closedAt: null, ...over };
}

describe("the week", () => {
  it("starts on Monday at midnight in India", () => {
    // Thursday 12 Nov 2026, noon in India.
    const now = new Date("2026-11-12T06:30:00Z");
    expect(weekBounds(now, "this")).toEqual({ from: new Date("2026-11-08T18:30:00Z"), to: new Date("2026-11-15T18:30:00Z") });
    expect(weekBounds(now, "last")).toEqual({ from: new Date("2026-11-01T18:30:00Z"), to: new Date("2026-11-08T18:30:00Z") });
  });

  it("is already the new week just after midnight on Monday in India, and still the old one just before", () => {
    expect(weekBounds(new Date("2026-11-15T18:31:00Z"), "this").from).toEqual(new Date("2026-11-15T18:30:00Z"));
    expect(weekBounds(new Date("2026-11-15T18:29:00Z"), "this").from).toEqual(new Date("2026-11-08T18:30:00Z"));
    // Sunday in India is the last day of its week.
    expect(weekBounds(new Date("2026-11-15T10:00:00Z"), "this").from).toEqual(new Date("2026-11-08T18:30:00Z"));
  });
});

describe("what counts as a parent's question", () => {
  it("is every parent turn but staff turns, a delivered answer and a rating tap", () => {
    expect(topicOf("fees")).toBe("fees");
    expect(topicOf("message_teacher")).toBe("teacher");
    expect(topicOf("handoff")).toBe("office");
    expect(topicOf("fallback")).toBe("other");
    expect(topicOf("greeting")).toBe("hello");
    for (const intent of ["staff_answer", "staff_link", "staff_not_text", "answer_delivered", "rated_helped", "rated_not_helped", "rating_unknown", null]) {
      expect(topicOf(intent)).toBeNull();
    }
  });
});

describe("the week's numbers", () => {
  it("counts questions, what the helper did itself and where it struggled", () => {
    const report = weekReport({
      turns: [
        turn({ intent: "fees", route: "tap", latencyMs: 1_000 }),
        turn({ intent: "fees", route: "rule", latencyMs: 3_000 }),
        turn({ intent: "calendar", route: "ai", costUsd: 0.004, lessonRole: "used", latencyMs: 9_000 }),
        turn({ intent: "calendar", route: "ai", costUsd: 0.006, handoff: "office", lessonRole: "asked", latencyMs: 11_000 }),
        turn({ intent: "other", route: "fallback", latencyMs: 2_500 }),
        turn({ intent: "attendance", status: "failed", latencyMs: null }),
        turn({ intent: "results", status: "not_claimed", latencyMs: null }),
        turn({ intent: "staff_answer", route: "rule", costUsd: 0 }),
        turn({ intent: "rated_helped", route: "tap" }),
      ],
      handoffs: [],
      answers: [],
      ratings: [],
      open: [],
    });
    expect(report).toMatchObject({ questions: 5, byItself: 4, handedOff: 1, fromSchoolAnswers: 1, couldNotAnswer: 1, fellBack: 1, notSent: 1, medianSeconds: 3 });
    expect(report.costUsd).toBeCloseTo(0.01, 6);
    expect(report.topics).toEqual([
      { topic: "fees", count: 2 },
      { topic: "calendar", count: 2 },
      { topic: "other", count: 1 },
    ]);
  });

  it("times each hand-off to its first answer, by who it was for and by who answered", () => {
    const report = weekReport({
      turns: [],
      handoffs: [
        handoff({ id: "h1", target: "class_teacher", createdAt: "2026-11-10T04:00:00.000Z" }),
        handoff({ id: "h2", target: "class_teacher", createdAt: "2026-11-10T05:00:00.000Z" }),
        handoff({ id: "h3", target: "accounts", assignedTo: "a1", createdAt: "2026-11-10T06:00:00.000Z" }),
        handoff({ id: "h4", target: "office", assignedTo: null, createdAt: "2026-11-11T06:00:00.000Z" }),
      ],
      answers: [
        { replyId: "r-h1", answeredBy: "t1", createdAt: "2026-11-10T04:30:00.000Z" },
        { replyId: "r-h1", answeredBy: "t2", createdAt: "2026-11-10T04:10:00.000Z" },
        { replyId: "r-h2", answeredBy: "t1", createdAt: "2026-11-10T07:00:00.000Z" },
        { replyId: "r-h3", answeredBy: "a1", createdAt: "2026-11-10T06:05:00.000Z" },
      ],
      ratings: ["helped", "helped", "not_helped", ""],
      open: [],
    });
    expect(report.targets).toEqual([
      { target: "class_teacher", count: 2, answered: 2, medianMinutes: 65 },
      { target: "accounts", count: 1, answered: 1, medianMinutes: 5 },
      { target: "office", count: 1, answered: 0, medianMinutes: null },
    ]);
    // h1's first answer was t2's, after ten minutes.
    expect(report.people).toEqual([
      { staffId: "a1", answered: 1, medianMinutes: 5 },
      { staffId: "t2", answered: 1, medianMinutes: 10 },
      { staffId: "t1", answered: 1, medianMinutes: 120 },
    ]);
    expect(report.ratings).toEqual({ helped: 2, notHelped: 1 });
  });

  it("shows who parents are still waiting on, the longest wait first among equals", () => {
    const report = weekReport({
      turns: [],
      handoffs: [],
      answers: [],
      ratings: [],
      open: [
        handoff({ id: "o1", assignedTo: "t1", createdAt: "2026-11-11T04:00:00.000Z" }),
        handoff({ id: "o2", assignedTo: "t1", createdAt: "2026-11-09T04:00:00.000Z" }),
        handoff({ id: "o3", assignedTo: null, target: "office", createdAt: "2026-11-10T04:00:00.000Z" }),
      ],
    });
    expect(report.waiting).toEqual({
      count: 3,
      oldestAt: "2026-11-09T04:00:00.000Z",
      byPerson: [
        { staffId: "t1", count: 2, oldestAt: "2026-11-09T04:00:00.000Z" },
        { staffId: null, count: 1, oldestAt: "2026-11-10T04:00:00.000Z" },
      ],
    });
  });

  it("is empty, not broken, for a week with nothing in it", () => {
    expect(weekReport({ turns: [], handoffs: [], answers: [], ratings: [], open: [] })).toMatchObject({
      questions: 0,
      medianSeconds: null,
      topics: [],
      targets: [],
      people: [],
      waiting: { count: 0, oldestAt: null, byPerson: [] },
    });
  });
});

describe("small sums", () => {
  it("finds the middle", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("splits a wait into days, hours and minutes", () => {
    expect(durationParts(7)).toEqual({ days: 0, hours: 0, minutes: 7 });
    expect(durationParts(125)).toEqual({ days: 0, hours: 2, minutes: 5 });
    expect(durationParts(3 * 1440 + 61)).toEqual({ days: 3, hours: 1, minutes: 1 });
  });
});
