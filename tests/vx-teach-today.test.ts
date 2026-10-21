import { describe, expect, it } from "vitest";

import {
  classWord,
  closedTag,
  closedTitle,
  closedWhy,
  combinedClasses,
  coverLine,
  lastOpenDay,
  leaveForToday,
  leaveState,
  marksTileLine,
  mayCancelLeave,
  periodClassList,
  profileClasses,
  remarksLeft,
  subjectWord,
  taskAsk,
  teacherKind,
} from "@/vx/screens/teach/domain/today";

/* Synthetic data only: no real names. Smoke school day, 20 Oct 2026. */

describe("closed days", () => {
  it("names the holiday the office typed", () => {
    const why = closedWhy("2026-10-20", false, { kind: "holiday", labelEn: "Dussehra", labelHi: "दशहरा" });
    expect(why).toEqual({ kind: "holiday", name: { en: "Dussehra", hi: "दशहरा" } });
    expect(closedTitle(why!)).toEqual({ en: "Today is a holiday — Dussehra", hi: "आज दशहरा की छुट्टी है" });
    expect(closedTag(why!)).toEqual({ en: "Holiday · Dussehra", hi: "छुट्टी · दशहरा" });
  });

  it("falls back to the other language's name, then to a plain holiday", () => {
    expect(closedWhy("2026-10-20", false, { kind: "holiday", labelEn: null, labelHi: "दशहरा" })).toEqual({ kind: "holiday", name: { en: "दशहरा", hi: "दशहरा" } });
    const unnamed = closedWhy("2026-10-20", false, { kind: "vacation", labelEn: " ", labelHi: null });
    expect(unnamed).toEqual({ kind: "holiday", name: null });
    expect(closedTitle(unnamed!).en).toBe("Today is a school holiday");
  });

  it("says Sunday on a Sunday with no row, and nothing on an open day", () => {
    expect(closedWhy("2026-10-18", false, undefined)).toEqual({ kind: "sunday" });
    expect(closedWhy("2026-10-21", true, undefined)).toBeNull();
    expect(closedWhy("2026-10-21", true, { kind: "exam", labelEn: "Exam", labelHi: null })).toBeNull();
  });

  it("finds the last open day before a holiday, skipping Sunday", () => {
    const shut = new Set(["2026-10-20", "2026-10-18"]);
    const open = (d: string) => !shut.has(d);
    expect(lastOpenDay("2026-10-20", open)).toBe("2026-10-19");
    expect(lastOpenDay("2026-10-19", (d) => d !== "2026-10-18")).toBe("2026-10-17");
    expect(lastOpenDay("2026-10-20", () => false, 5)).toBeNull();
  });
});

describe("leave", () => {
  const row = (over: Partial<{ status: string; from_day: string; to_day: string }>) => ({ status: "asked", from_day: "2026-10-20", to_day: "2026-10-20", ...over });

  it("a request nobody answered before its last day is 'passed', not pending", () => {
    expect(leaveState(row({ from_day: "2026-10-13", to_day: "2026-10-14" }), "2026-10-20")).toBe("passed");
    expect(leaveState(row({}), "2026-10-20")).toBe("waiting");
    expect(leaveState(row({ status: "approved" }), "2026-10-20")).toBe("approved");
    expect(leaveState(row({ status: "declined" }), "2026-10-20")).toBe("declined");
  });

  it("only an unanswered request can be withdrawn, even after its dates", () => {
    expect(mayCancelLeave(row({ from_day: "2026-10-13", to_day: "2026-10-14" }))).toBe(true);
    expect(mayCancelLeave(row({ status: "approved" }))).toBe(false);
    expect(mayCancelLeave(row({ status: "cancelled" }))).toBe(false);
  });

  it("Today shows current and coming leave, soonest first, never cancelled or past", () => {
    const rows = [
      { id: "a", ...row({ from_day: "2026-10-23", to_day: "2026-10-23" }) },
      { id: "b", ...row({ status: "approved" }) },
      { id: "c", ...row({ status: "cancelled", from_day: "2026-10-21", to_day: "2026-10-21" }) },
      { id: "d", ...row({ from_day: "2026-10-13", to_day: "2026-10-14" }) },
    ];
    expect(leaveForToday(rows, "2026-10-20").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("says who takes each period, or that nobody does yet", () => {
    expect(coverLine({ day: "2026-10-20", number: 2, classLabels: ["Class 10"], coverName: "Teacher Q" })).toEqual({ en: "P2 Class 10 — Teacher Q takes it", hi: "P2 कक्षा 10 — Teacher Q लेंगे" });
    expect(coverLine({ day: "2026-10-20", number: 3, classLabels: ["Class 7"], coverName: null }).en).toBe("P3 Class 7 — not arranged yet");
  });

  it("maps each period to its class in the preview", () => {
    expect(periodClassList([{ number: 2, classLabels: ["Class 10"] }, { number: 3, classLabels: ["Class 7"] }, { number: 4, classLabels: ["Class 7"] }])).toEqual({
      en: "P2 Class 10 · P3 Class 7 · P4 Class 7",
      hi: "P2 कक्षा 10 · P3 कक्षा 7 · P4 कक्षा 7",
    });
  });
});

describe("plain words", () => {
  it("NUR reads Nursery, and Class reads कक्षा in Hindi", () => {
    expect(classWord("NUR")).toEqual({ en: "Nursery", hi: "नर्सरी" });
    expect(classWord("Class 11 Arts")).toEqual({ en: "Class 11 Arts", hi: "कक्षा 11 Arts" });
    expect(classWord("UKG")).toEqual({ en: "UKG", hi: "UKG" });
  });

  it("a combined period reads 'Classes 1–5 together'", () => {
    expect(combinedClasses("Class 1 · 2 · 3 · 4 · 5")).toEqual({ en: "Classes 1–5 together", hi: "कक्षा 1 से 5 एक साथ" });
    expect(combinedClasses("Class 11 Science · 11 Commerce").en).toBe("Classes 11 Science and 11 Commerce together");
    expect(combinedClasses("Class 7")).toEqual({ en: "Class 7", hi: "कक्षा 7" });
  });

  it("a subject reads its name, never a bare code when a name exists", () => {
    const names = new Map([["ELGA", { en: "Early Learning", hi: "प्रारंभिक शिक्षा" }]]);
    expect(subjectWord("ELGA", names)).toEqual({ en: "Early Learning", hi: "प्रारंभिक शिक्षा" });
    expect(subjectWord("XYZ", names)).toEqual({ en: "XYZ", hi: "XYZ" });
  });
});

describe("who she is", () => {
  it("class teacher, subject teacher or new", () => {
    expect(teacherKind({ classes: 2, unassigned: false })).toBe("class");
    expect(teacherKind({ classes: 0, unassigned: false })).toBe("subject");
    expect(teacherKind({ classes: 0, unassigned: true })).toBe("new");
  });

  it("her own class first, then school order", () => {
    const rank = new Map([["c1", 1], ["c2", 2], ["c7", 7], ["c11", 11]]);
    const out = profileClasses(
      [
        { classId: "c11", held: false },
        { classId: "c7", held: true },
        { classId: "c2", held: false },
        { classId: "c1", held: false },
      ],
      rank,
    );
    expect(out.map((c) => c.classId)).toEqual(["c7", "c1", "c2", "c11"]);
  });
});

describe("More's Marks tile", () => {
  it("counts remarks still to write, and says 'Nothing waiting' only when nothing is", () => {
    expect(remarksLeft([{ done: 0, total: 41 }, { done: 3, total: 2 }])).toBe(41);
    expect(marksTileLine(null, 41)).toEqual({ en: "41 report-card remarks to write", hi: "41 रिपोर्ट-कार्ड टिप्पणियाँ बाकी" });
    expect(marksTileLine({ classLabel: "Class 7", entered: 3, total: 20 }, 1).en).toBe("Class 7 · 3 of 20 entered · 1 report-card remark to write");
    expect(marksTileLine(null, 0).en).toBe("Nothing waiting");
  });
});

describe("office tasks", () => {
  it("says what the office needs, for how many children, and by when", () => {
    const ask = taskAsk({ fields: [{ labelEn: "Address", labelHi: "पता" }, { labelEn: "Photo", labelHi: "फ़ोटो" }], children: 1, dueLabel: { en: "Fri 23 Oct", hi: "शुक्र 23 अक्टू॰" } });
    expect(ask).toEqual({ en: "The office needs Address and Photo for 1 child · by Fri 23 Oct", hi: "ऑफ़िस को 1 बच्चे का पता और फ़ोटो चाहिए · शुक्र 23 अक्टू॰ तक" });
    expect(taskAsk({ fields: [{ labelEn: "Phone", labelHi: "फ़ोन" }], children: 4, dueLabel: null }).en).toBe("The office needs Phone for 4 children");
  });
});
