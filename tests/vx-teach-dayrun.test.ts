import { describe, expect, it } from "vitest";

import {
  alertWhen,
  childMatches,
  genderSplit,
  mergeCombinedSlots,
  monthEnd,
  orderPapersToFill,
  tellApart,
} from "@/vx/screens/teach/domain/teach";
import { callName, greetName } from "@/vx/screens/teach/ui/fmt";

/* Regression tests for the 14 Oct school-day run (class-teacher and subject-teacher reports). */

describe("the month view's last day (BUG-03)", () => {
  it("ends each month on its real last day, never the 31st of September", () => {
    expect(monthEnd("2026-09")).toBe("2026-09-30");
    expect(monthEnd("2026-10")).toBe("2026-10-31");
    expect(monthEnd("2027-02")).toBe("2027-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-11")).toBe("2026-11-30");
  });
});

describe("the marks screen lists every open paper (BUG-02, ST-01)", () => {
  it("puts papers past their due date first, then the rest by date, finished ones last", () => {
    const cards = [
      { id: "test-exam-paper", status: "done" as const, dueOn: null },
      { id: "sa1-english", status: "not_started" as const, dueOn: "2026-10-14" },
      { id: "fa2-maths", status: "in_progress" as const, dueOn: "2026-10-30" },
      { id: "undated", status: "not_started" as const, dueOn: null },
      { id: "sa1-elga", status: "in_progress" as const, dueOn: "2026-10-14" },
    ];
    const order = orderPapersToFill(cards, "2026-10-15").map((c) => c.id);
    expect(order.slice(0, 2).sort()).toEqual(["sa1-elga", "sa1-english"]);
    expect(order.slice(2)).toEqual(["fa2-maths", "undated", "test-exam-paper"]);
  });
});

describe("telling same-named children apart (BUG-05, ST-19)", () => {
  const rows = [
    { id: "a", name: "Ansh  Namoona", admissionNo: "1201", fatherName: "Father One" },
    { id: "b", name: "ansh namoona", admissionNo: "1202", fatherName: "Father Two" },
    { id: "c", name: "Sai Jaanch", admissionNo: "1203", fatherName: null },
  ];
  it("gives a line only to children who share a name", () => {
    const hints = tellApart(rows);
    expect(hints.get("a")).toEqual({ en: "SR 1201 · father Father One", hi: "SR 1201 · पिता Father One" });
    expect(hints.get("b")?.en).toBe("SR 1202 · father Father Two");
    expect(hints.has("c")).toBe(false);
  });
  it("finds a child by any word of the name, the roll or the SR number", () => {
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: "1201" }, "1201")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: "4", admissionNo: null }, "4")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: null }, "namoona ansh")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: null }, "rudra")).toBe(false);
  });
});

describe("periods a week count a combined period once (BUG-07, ST-14)", () => {
  it("merges the classes taught together in one day and period", () => {
    const week = mergeCombinedSlots([
      { day: "Thu", period: 5, classLabel: "Class 11 Science", subjectCode: "HIN" },
      { day: "Thu", period: 5, classLabel: "Class 11 Commerce", subjectCode: "HIN" },
      { day: "Thu", period: 5, classLabel: "Class 11 Arts", subjectCode: "HIN" },
      { day: "Thu", period: 6, classLabel: "Class 6", subjectCode: "HIN" },
    ]);
    expect(week).toHaveLength(2);
    expect(week[0].classLabel).toBe("Class 11 Science · 11 Commerce · 11 Arts");
  });
});

describe("the parents' message time is never a time already past (BUG-16, ST-12)", () => {
  it("says 10 am only for today's register saved before 10", () => {
    expect(alertWhen(8 * 60, "2026-10-15", "2026-10-15").en).toBe("at 10 am");
    expect(alertWhen(23 * 60, "2026-10-15", "2026-10-15").en).toBe("from the school office");
    expect(alertWhen(8 * 60, "2026-10-14", "2026-10-15").en).toBe("from the school office");
  });
});

describe("the class card's gender split (BUG-10, ST-26)", () => {
  it("shows a split only when every child has a gender recorded", () => {
    expect(genderSplit(["F", "M", "female", "Male"])).toEqual({ girls: 2, boys: 2 });
    expect(genderSplit(["F", null, "M"])).toBeNull();
    expect(genderSplit([])).toBeNull();
  });
});

describe("the greeting falls back to the first word only without a short name (BUG-15)", () => {
  it("keeps a title with the surname", () => {
    expect(greetName("Ms. Asha Bhati")).toBe("Ms. Bhati");
    expect(greetName("Ravina Sharma")).toBe("Ravina");
  });
});

describe("callName (verification ST-15: greeted as \"QATE\")", () => {
  it("uses the short name only when it is a name, not a roster code", () => {
    expect(callName("Ravina", "QA Teacher")).toBe("Ravina");
    expect(callName("QATE", "Asha Bhati")).toBe("Asha");
    expect(callName("SP", "Sunita Purohit")).toBe("Sunita");
    expect(callName(null, "Ms. Asha Bhati")).toBe("Ms. Bhati");
    expect(callName("  ", "Ravina Sharma")).toBe("Ravina");
  });
});
