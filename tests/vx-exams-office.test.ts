import { describe, expect, it } from "vitest";

import { childPercent, classAnalysis, histogram, passLine, type ChildMarks } from "@/vx/screens/exams/domain/analysis";
import { bilingualReminder, reminderLinesHi } from "@/vx/screens/exams/domain/messages";
import { maskPhone, readiness, setupSteps, type SetupFacts } from "@/vx/screens/exams/domain/office";

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  startsOn: "2026-12-07",
  slots: 0,
  datesheetChecked: false,
  datesheetPublished: false,
  seats: 0,
  duties: 0,
  papersTotal: 0,
  papersReceived: 0,
  ticked: new Set(),
  ...over,
});

describe("the setup checklist", () => {
  it("reads each step from what exists", () => {
    const steps = setupSteps(facts({ slots: 28, papersTotal: 28, papersReceived: 4 }));
    const by = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(by.created.state).toBe("done");
    expect(by.datesheet.state).toBe("doing");
    expect(by.datesheet.progress).toBe("draft");
    expect(by.papers.state).toBe("doing");
    expect(by.papers.progress).toBe("4/28");
    expect(by.seating.state).toBe("todo");
    expect(by.papers.owner).toBe("teachers");
  });

  it("dates each step back from the first exam day", () => {
    const by = Object.fromEntries(setupSteps(facts()).map((s) => [s.key, s]));
    expect(by.datesheet.dueOn).toBe("2026-10-30");
    expect(by.parents.dueOn).toBe("2026-11-02");
    expect(by.seating.dueOn).toBe("2026-11-20");
    expect(by.admit.dueOn).toBe("2026-12-03");
    expect(by.created.dueOn).toBeNull();
  });

  it("lets a hand tick finish a step, and counts readiness with partial steps", () => {
    const steps = setupSteps(facts({ slots: 10, ticked: new Set(["admit"]) }));
    expect(steps.find((s) => s.key === "admit")?.state).toBe("done");
    expect(steps.find((s) => s.key === "admit")?.canTick).toBe(false);
    const r = readiness(steps);
    expect(r.done).toBe(2);
    expect(r.underWay).toBe(1);
    expect(r.percent).toBe(Math.round((2.5 / 7) * 100));
  });

  it("masks a phone number", () => {
    expect(maskPhone("+91 98290 12512")).toBe("98290 ••512");
    expect(maskPhone(null)).toBe("");
  });
});

const child = (id: string, marks: [string, number | null, boolean?][]): ChildMarks => ({
  studentId: id,
  name: `Child ${id}`,
  marks: marks.map(([subjectCode, value, absent]) => ({ subjectCode, value, absent: Boolean(absent), exempt: false, maxMarks: 80, passMarks: 26 })),
});

describe("result analysis", () => {
  it("uses the paper's pass mark, else a third of the maximum", () => {
    expect(passLine({ maxMarks: 100, passMarks: null })).toBe(33);
    expect(passLine({ maxMarks: 80, passMarks: 26 })).toBe(26);
  });

  it("counts an absent paper against the percentage but leaves exempt out", () => {
    expect(childPercent([{ subjectCode: "A", value: 40, absent: false, exempt: false, maxMarks: 80, passMarks: null }, { subjectCode: "B", value: null, absent: true, exempt: false, maxMarks: 80, passMarks: null }])).toBe(25);
    expect(childPercent([{ subjectCode: "A", value: 40, absent: false, exempt: false, maxMarks: 80, passMarks: null }, { subjectCode: "B", value: null, absent: false, exempt: true, maxMarks: 80, passMarks: null }])).toBe(50);
  });

  it("finds averages, who passed everything, the top and those below the line", () => {
    const kids = [
      child("a", [["ENG", 70], ["MATH", 72]]),
      child("b", [["ENG", 20], ["MATH", 60]]),
      child("c", [["ENG", 40], ["MATH", null, true]]),
      child("d", [["ENG", null], ["MATH", null]]),
    ];
    const r = classAnalysis(kids, ["ENG", "MATH"], 2);
    expect(r.counted).toBe(3);
    expect(r.passedAll).toBe(1);
    expect(r.subjects[0]).toEqual({ subjectCode: "ENG", avgPct: Math.round(((70 + 20 + 40) / 3 / 80) * 1000) / 10, sat: 3 });
    expect(r.subjects[1].sat).toBe(2);
    expect(r.top.map((t) => t.studentId)).toEqual(["a", "b"]);
    expect(r.below).toEqual([{ studentId: "b", name: "Child b", fails: [{ subjectCode: "ENG", value: 20, maxMarks: 80 }] }]);
  });

  it("spreads marks into equal bands with full marks in the last", () => {
    expect(histogram([0, 7, 8, 40, 80], 80, 10)).toEqual([2, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(histogram([1], 0)).toEqual(new Array(10).fill(0));
  });
});

describe("teacher reminders", () => {
  const input = { teacherName: "Mr. Test", examName: "Half-yearly", examNameHi: "अर्धवार्षिक", pending: ["Class 9 SCI (12/28)"], dueLabel: "Wed 14 Oct", link: "https://x.test/t/marks/abc", from: "Exam office" };

  it("writes Hindi first with the link, then English without repeating it", () => {
    const hi = reminderLinesHi(input);
    expect(hi[0]).toBe("नमस्ते Mr. Test जी,");
    expect(hi).toContain("https://x.test/t/marks/abc");
    const text = bilingualReminder(input);
    expect(text.indexOf("नमस्ते")).toBe(0);
    expect(text.split("https://x.test/t/marks/abc").length).toBe(2);
    expect(text).toContain("Half-yearly marks are due by Wed 14 Oct.");
  });
});
