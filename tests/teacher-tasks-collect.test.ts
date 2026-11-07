import { describe, expect, it } from "vitest";
import {
  answersToCheck, autoTitle, collectCounts, groupAsks, indianMobile, isLate, missingAny, missingByField,
  needsLink, needsReminder, schoolDayOf, teacherMessage, teacherStep, toldOf, whatsappLink,
  type BoardTask, type SendRecord, type TeacherMessage,
} from "@/modules/teacher-tasks/domain/collect";
import { entryMessage, nextEntry, type SendEntry } from "@/modules/teacher-tasks/domain/send-queue";

/* Needs you · Teachers' work (D-520, D-521): the rules the board and the send list run on. Synthetic data only. */

const TODAY = "2026-11-09";
const never = { sent: false, remindedToday: false, check: false, lastAt: null, lastDay: null };

function task(over: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "t1", sourceKey: "task:t1", kind: "collection", title: "Phone, Student photograph", teacherId: "teacher-a", teacherName: "Teacher A",
    dueDate: "2026-11-12", state: "waiting", expected: 10, answered: 0, rejected: 0, approved: 0, href: "/inbox?task=t1", openedAt: null,
    createdAt: "2026-11-07T10:00:00.000Z", students: 10, group: "Class 5", told: never, ...over,
  };
}

describe("toldOf", () => {
  it("counts only delivered sends, and a reminder only on its own day", () => {
    const records: SendRecord[] = [
      { taskId: "t1", state: "manual_opened", round: "initial", at: "2026-11-07T05:00:00.000Z" },
      { taskId: "t1", state: "cancelled", round: `reminder:${TODAY}`, at: "2026-11-09T05:00:00.000Z" },
    ];
    expect(toldOf(records, TODAY)).toEqual({ sent: true, remindedToday: false, check: false, lastAt: "2026-11-07T05:00:00.000Z", lastDay: "2026-11-07" });
    const reminded = toldOf([...records, { taskId: "t1", state: "accepted", round: `reminder:${TODAY}`, at: "2026-11-09T06:00:00.000Z" }], TODAY);
    expect(reminded.remindedToday).toBe(true);
    expect(reminded.lastDay).toBe(TODAY);
  });

  it("an unknown provider result blocks the list until a person checks it", () => {
    expect(toldOf([{ taskId: "t1", state: "unknown", round: "initial", at: null }], TODAY)).toMatchObject({ sent: false, check: true });
  });

  it("dates a send by the school's own day, not UTC's", () => {
    // 20:00 UTC on the 8th is 01:30 on the 9th in Amet.
    expect(schoolDayOf("2026-11-08T20:00:00.000Z")).toBe("2026-11-09");
    expect(schoolDayOf("not a date")).toBeNull();
    expect(schoolDayOf(null)).toBeNull();
  });
});

describe("what the office does next", () => {
  it("a teacher never told needs the link; once told, they need it no more", () => {
    expect(needsLink(task())).toBe(true);
    expect(needsLink(task({ told: { ...never, sent: true, lastDay: "2026-11-07" } }))).toBe(false);
    expect(needsLink(task({ openedAt: "2026-11-07T07:00:00.000Z" }))).toBe(false);
    expect(needsLink(task({ told: { ...never, check: true } }))).toBe(false);
    expect(needsLink(task({ state: "complete" }))).toBe(false);
  });

  it("a link sent today is not a reminder yet, unless the work is due today or late", () => {
    const sentToday = { ...never, sent: true, lastAt: "2026-11-09T04:00:00.000Z", lastDay: TODAY };
    expect(needsReminder(task({ told: sentToday }), TODAY)).toBe(false);
    expect(needsReminder(task({ told: sentToday, dueDate: TODAY }), TODAY)).toBe(true);
    expect(needsReminder(task({ told: sentToday, dueDate: "2026-11-08" }), TODAY)).toBe(true);
    expect(needsReminder(task({ told: { ...sentToday, lastDay: "2026-11-08" } }), TODAY)).toBe(true);
  });

  it("never reminds twice in a day, never someone untold, never finished work", () => {
    const told = { ...never, sent: true, lastDay: "2026-11-07" };
    expect(needsReminder(task({ told: { ...told, remindedToday: true } }), TODAY)).toBe(false);
    expect(needsReminder(task(), TODAY)).toBe(false);
    expect(needsReminder(task({ told, state: "complete" }), TODAY)).toBe(false);
    expect(needsReminder(task({ told, state: "to-approve" }), TODAY)).toBe(false);
    // Opened through the app without a WhatsApp send still earns a nudge the next day.
    expect(needsReminder(task({ openedAt: "2026-11-07T07:00:00.000Z" }), TODAY)).toBe(true);
  });

  it("answers to check are what came in and nobody accepted or sent back", () => {
    expect(answersToCheck(task({ answered: 7, approved: 3, rejected: 1 }))).toBe(3);
    expect(answersToCheck(task({ answered: 2, approved: 3 }))).toBe(0);
    expect(answersToCheck(task({ kind: "marks", answered: 7 }))).toBe(0);
    expect(answersToCheck(task({ state: "revoked", answered: 7 }))).toBe(0);
  });

  it("late is past the due day and still owed", () => {
    expect(isLate(task({ dueDate: "2026-11-08" }), TODAY)).toBe(true);
    expect(isLate(task({ dueDate: TODAY }), TODAY)).toBe(false);
    expect(isLate(task({ dueDate: "2026-11-08", state: "complete" }), TODAY)).toBe(false);
    expect(isLate(task({ dueDate: null }), TODAY)).toBe(false);
  });

  it("steps sort a teacher by what the office does about them", () => {
    expect(teacherStep(task({ state: "to-assign" }))).toBe("reassign");
    expect(teacherStep(task({ told: { ...never, check: true } }))).toBe("check");
    expect(teacherStep(task())).toBe("not-sent");
    expect(teacherStep(task({ told: { ...never, sent: true } }))).toBe("sent");
    expect(teacherStep(task({ openedAt: "2026-11-07T07:00:00.000Z" }))).toBe("opened");
    expect(teacherStep(task({ answered: 3 }))).toBe("started");
    expect(teacherStep(task({ state: "to-approve" }))).toBe("to-approve");
    expect(teacherStep(task({ state: "complete" }))).toBe("done");
  });
});

describe("collectCounts and groupAsks", () => {
  const sent = { ...never, sent: true, lastDay: "2026-11-07" };
  const tasks = [
    task({ id: "a" }),
    task({ id: "b", teacherName: "Teacher B", told: sent, answered: 4, approved: 1 }),
    task({ id: "c", teacherName: "Teacher C", state: "complete", answered: 10, approved: 10 }),
    task({ id: "d", title: "Unit test 1 · Maths", kind: "marks", createdAt: "2026-11-08T10:00:00.000Z", dueDate: "2026-11-08" }),
    task({ id: "e", state: "revoked", answered: 5 }),
  ];

  it("counts each next step by the tasks it acts on, never a revoked one", () => {
    const counts = collectCounts(tasks, TODAY);
    expect(counts.toSend).toEqual(["a", "d"]);
    expect(counts.toRemind).toEqual(["b"]);
    expect(counts.answers).toBe(3);
    expect(counts.late).toBe(1);
    expect(counts.open).toBe(3);
    expect(counts.attention).toBe(3);
  });

  it("one press of Give work comes back as one ask, unfinished and newest first", () => {
    const asks = groupAsks(tasks, TODAY);
    expect(asks.map((a) => a.title)).toEqual(["Unit test 1 · Maths", "Phone, Student photograph"]);
    const details = asks[1];
    expect(details.tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(details).toMatchObject({ done: 1, answered: 14, expected: 30, finished: false, toSend: ["a"], toRemind: ["b"] });
  });

  it("a finished ask sinks below every open one", () => {
    const asks = groupAsks([task({ id: "x", state: "complete", createdAt: "2026-11-09T09:00:00.000Z", title: "Done" }), task({ id: "y" })], TODAY);
    expect(asks.map((a) => [a.title, a.finished])).toEqual([["Phone, Student photograph", false], ["Done", true]]);
  });
});

describe("phones and links", () => {
  it("reads a mobile the way the database does", () => {
    expect(indianMobile("+91 90000 00001")).toBe("9000000001");
    expect(indianMobile(null, "09000000002")).toBe("9000000002");
    expect(indianMobile("", "9000000003")).toBe("9000000003");
    expect(indianMobile("12345")).toBeNull();
    expect(indianMobile("5000000000")).toBeNull();
  });

  it("builds a click-to-chat link with the words typed in", () => {
    expect(whatsappLink("9000000001", "Namaste & hello")).toBe("https://wa.me/919000000001?text=Namaste%20%26%20hello");
  });
});

describe("teacherMessage", () => {
  const base: TeacherMessage = {
    kind: "initial", language: "en", teacherName: "Teacher A", work: "collection", title: "Phone, Student photograph",
    students: 12, fields: [{ en: "Phone", hi: "फोन" }, { en: "Student photograph", hi: "फोटो" }], answered: 0, expected: 12,
    due: "2026-11-12", url: "https://one.example/t/tasks/synthetic", today: TODAY,
  };

  it("asks in English with the count, the details, the day and the link", () => {
    const text = teacherMessage(base);
    expect(text).toContain("Namaste Teacher A,");
    expect(text).toContain("Please fill in: Phone, Student photograph");
    // Named after its fields already: the list is not said twice.
    expect(text).toContain("Please fill in: Phone, Student photograph\n12 children\n");
    expect(teacherMessage({ ...base, title: "Details for the trip" })).toContain("12 children · Phone, Student photograph");
    expect(text).toContain("Please finish by 12 November");
    expect(text).toContain("Open your list here (no login needed):\nhttps://one.example/t/tasks/synthetic");
    expect(text).not.toMatch(/[ऀ-ॿ]/);
  });

  it("asks in Hindi with no English words of its own", () => {
    const text = teacherMessage({ ...base, language: "hi" });
    expect(text).toContain("नमस्ते Teacher A जी,");
    expect(text).toContain("कृपया भरें:");
    expect(text).toContain("12 बच्चे · फोन, फोटो");
    expect(text).not.toContain("Please");
  });

  it("both languages put each English line over its Hindi line", () => {
    const lines = teacherMessage({ ...base, language: "both" }).split("\n");
    const i = lines.indexOf("Please fill in: Phone, Student photograph");
    expect(lines[i + 1]).toBe("कृपया भरें: Phone, Student photograph");
  });

  it("a reminder says how far they got, and when the day has passed", () => {
    const text = teacherMessage({ ...base, kind: "reminder", answered: 5, due: "2026-11-08" });
    expect(text).toContain("Reminder: Phone, Student photograph is still pending.");
    expect(text).toContain("5 of 12 done so far — thank you.");
    expect(text).toContain("It was due on 8 November.");
    expect(teacherMessage({ ...base, kind: "reminder" })).toContain("Not started yet.");
  });

  it("marks and attendance ask in their own words", () => {
    expect(teacherMessage({ ...base, work: "marks", title: "Unit test 1 · Maths", fields: [] })).toContain("Please enter the marks: Unit test 1 · Maths");
    expect(teacherMessage({ ...base, work: "attendance", title: "2026-11-09", fields: [] })).toContain("Please mark attendance for 9 November.");
  });
});

describe("asking for what is missing", () => {
  const fields = [{ id: "f1", key: "phone", labelEn: "Phone", labelHi: "फोन" }, { id: "f2", key: "student_photo", labelEn: "Student photograph", labelHi: "फोटो" }];
  const children = [
    { id: "c1", classId: "k5", values: { phone: "present", student_photo: null } },
    { id: "c2", classId: "k5", values: { phone: null, student_photo: null } },
    { id: "c3", classId: "k6", values: { phone: "present", student_photo: "present" } },
  ];

  it("counts who lacks each detail, and who lacks any chosen one", () => {
    expect(missingByField(children, fields)).toEqual({ f1: 1, f2: 2 });
    expect(missingAny(children, [fields[0]])).toEqual(["c2"]);
    expect(missingAny(children, fields)).toEqual(["c1", "c2"]);
  });

  it("names the work after what it asks, within what the database keeps", () => {
    expect(autoTitle(fields, "en")).toBe("Phone, Student photograph");
    expect(autoTitle(fields, "hi")).toBe("फोन, फोटो");
    const long = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, key: `k${i}`, labelEn: `Detail number ${i}`, labelHi: "" }));
    expect(autoTitle(long, "en")).toHaveLength(118);
  });
});

describe("the send list", () => {
  const entry: SendEntry = {
    taskId: "t1", teacherName: "Teacher A", mobile: "9000000001", language: "en", work: "collection", title: "Phone", group: "Class 5",
    due: null, students: 3, fields: [{ en: "Phone", hi: "फोन" }], answered: 0, expected: 3, url: "https://one.example/t/tasks/synthetic",
    blocked: null, done: false, opened: false,
  };

  it("opens WhatsApp only when there is a number, a link and nothing blocking", () => {
    const { text, href } = entryMessage(entry, "initial", TODAY);
    expect(href).toBe(whatsappLink("9000000001", text));
    expect(entryMessage({ ...entry, mobile: null }, "initial", TODAY).href).toBeNull();
    expect(entryMessage({ ...entry, url: null }, "initial", TODAY).href).toBeNull();
    expect(entryMessage({ ...entry, blocked: "check" }, "initial", TODAY).href).toBeNull();
  });

  it("points Next at the first teacher still to do", () => {
    const list = [
      { ...entry, taskId: "done", done: true },
      { ...entry, taskId: "blocked", blocked: "no-link" as const },
      { ...entry, taskId: "nophone", mobile: null },
      { ...entry, taskId: "tapped" },
      { ...entry, taskId: "next" },
    ];
    expect(nextEntry(list, new Set(["tapped"]))).toBe("next");
    expect(nextEntry(list, new Set(["tapped", "next"]))).toBeNull();
  });
});
