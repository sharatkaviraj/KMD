import { describe, expect, it } from "vitest";

import {
  boardKpis,
  canEditNote,
  classLevel,
  countP,
  filterBoard,
  findKids,
  followUpWho,
  goalForParents,
  isMyFollowUp,
  knownPair,
  noteAttention,
  noteSubject,
  parentPlanMessage,
  pickedFollowOn,
  pickerStartClass,
  planReaders,
  suggestedGoals,
  suggestedSteps,
  teacherCounts,
  whenPair,
  type BoardNote,
} from "@/vx/screens/notes/domain/notes";

/*
 * The notes findings of the 20 October school day (stream "notes"). Pure
 * rules only; synthetic children and staff.
 */

const TODAY = "2026-10-21"; // a Wednesday

function note(over: Partial<BoardNote>): BoardNote {
  return {
    id: "n",
    studentId: "s",
    studentName: "Test Child",
    classId: "c1",
    classLabel: "Class 7",
    body: "A note",
    tags: ["studies"],
    source: "typed",
    status: "open",
    visibility: "team",
    needsFollowUp: false,
    followUpOn: null,
    followUpOwner: null,
    followUpStaffId: null,
    followUpName: null,
    tellParents: false,
    writtenBy: "t1",
    writtenByName: "QA Teacher",
    authorRelation: null,
    subjectCode: null,
    createdAt: "2026-10-20T05:00:00Z",
    replies: 0,
    planId: null,
    ...over,
  };
}

describe("the child picker (dev.groups[11])", () => {
  const kids = [
    { id: "k1", classId: "c3", name: "Krishna Alpha", rollNo: "1" },
    { id: "k2", classId: "c3", name: "Mira Beta", rollNo: "2" },
    { id: "k3", classId: "c12", name: "Krishna Anumaan", rollNo: "7" },
  ];

  it("opens on the class it came from, else the reader's own class, not the school's first", () => {
    expect(pickerStartClass(["c3", "c12"], { held: ["c12"] })).toBe("c12");
    expect(pickerStartClass(["c3", "c12"], { initial: "c3", held: ["c12"] })).toBe("c3");
    expect(pickerStartClass(["c3", "c12"], { initial: "elsewhere", held: [] })).toBe("c3");
    expect(pickerStartClass([], { held: ["c12"] })).toBe("");
  });

  it("searches the picked class first, then the reader's other classes", () => {
    const found = findKids(kids, "c12", "krishna");
    expect(found.here.map((k) => k.id)).toEqual(["k3"]);
    expect(found.elsewhere.map((k) => k.id)).toEqual(["k1"]);
  });

  it("lists the whole picked class with no search, and nothing elsewhere", () => {
    const found = findKids(kids, "c3", "");
    expect(found.here.map((k) => k.id)).toEqual(["k1", "k2"]);
    expect(found.elsewhere).toEqual([]);
  });

  it("finds by roll number in the class", () => {
    expect(findKids(kids, "c3", "2").here.map((k) => k.id)).toEqual(["k2"]);
  });
});

describe("who follows up, said to the reader", () => {
  it("never says 'Me' for another teacher's own follow-up", () => {
    const n = note({ needsFollowUp: true, followUpOwner: "me", followUpStaffId: "t1", followUpName: "QA Teacher", writtenBy: "t1" });
    expect(followUpWho(n, "coord")?.en).toBe("QA Teacher");
    expect(followUpWho(n, "t1")).toEqual({ en: "You", hi: "आप" });
  });

  it("names the writer of an old 'me' follow-up with nobody recorded", () => {
    const n = note({ needsFollowUp: true, followUpOwner: "me", followUpStaffId: null, writtenBy: "t1", writtenByName: "QA Teacher" });
    expect(followUpWho(n, "coord")?.en).toBe("QA Teacher");
    expect(followUpWho(n, "t1")?.en).toBe("You");
  });

  it("falls back to the role when nobody was found for it", () => {
    expect(followUpWho(note({ followUpOwner: "class_teacher" }), "x")?.en).toBe("Class teacher");
  });
});

describe("who a note is about", () => {
  it("says 'Whole class' for a class note and 'Child not found' for a missing child, never '— —'", () => {
    expect(noteSubject(note({ studentId: null, studentName: "" }))).toEqual({ en: "Whole class", hi: "पूरी कक्षा" });
    expect(noteSubject(note({ studentName: "" })).en).toBe("Child not found");
    expect(noteSubject(note({ studentName: "—" })).en).toBe("Child not found");
    expect(noteSubject(note({})).en).toBe("Test Child");
  });
});

describe("counts that agree", () => {
  it("counts one note as '1 note'", () => {
    expect(countP(1, "note", "notes", "नोट")).toEqual({ en: "1 note", hi: "1 नोट" });
    expect(countP(2, "note", "notes", "नोट").en).toBe("2 notes");
  });

  it("gives the teacher's header, tiles and sections one follow-up count", () => {
    const mine = [
      note({ id: "a", needsFollowUp: true, followUpOwner: "me", followUpStaffId: "t1", followUpOn: "2026-10-22" }),
      note({ id: "b", needsFollowUp: true, followUpOwner: "me", followUpStaffId: "t1", followUpOn: "2026-10-27" }),
      note({ id: "c", needsFollowUp: true, followUpOwner: "class_teacher", followUpStaffId: "t9", followUpOn: "2026-10-22" }),
      note({ id: "d", status: "done", needsFollowUp: true, followUpStaffId: "t1", followUpOn: "2026-10-01" }),
    ];
    const counts = teacherCounts(mine, "t1");
    expect(counts.followUp).toBe(mine.filter((n) => isMyFollowUp(n, "t1")).length);
    expect(counts).toEqual({ total: 4, followUp: 2, open: 1, done: 1 });
  });

  it("counts 'needs action' the board's way for every screen", () => {
    const notes = [
      note({ id: "late", needsFollowUp: true, followUpOn: "2026-10-10" }),
      note({ id: "today", needsFollowUp: true, followUpOn: TODAY }),
      note({ id: "later", needsFollowUp: true, followUpOn: "2026-10-26" }),
      note({ id: "health", tags: ["health"] }),
      note({ id: "done", status: "done", needsFollowUp: true, followUpOn: "2026-10-01" }),
    ];
    const att = noteAttention(notes, TODAY);
    expect(att).toEqual({ needsAction: 3, due: 2, oldestDue: "2026-10-10" });
    expect(att.needsAction).toBe(boardKpis(notes, 0, TODAY).needsAction);
    expect(att.needsAction).toBe(filterBoard(notes, { tab: "action" }, TODAY).length);
  });
});

describe("changing a saved note", () => {
  it("is its author's, before it is done, for two weeks", () => {
    const n = note({ writtenBy: "t1", createdAt: "2026-10-15T05:00:00Z" });
    expect(canEditNote(n, "t1", TODAY)).toBe(true);
    expect(canEditNote(n, "t2", TODAY)).toBe(false);
    expect(canEditNote({ ...n, status: "done" }, "t1", TODAY)).toBe(false);
    expect(canEditNote({ ...n, createdAt: "2026-09-30T05:00:00Z" }, "t1", TODAY)).toBe(false);
  });
});

describe("a follow-up date picked by hand", () => {
  it("is after today and within the term; a Sunday moves to Monday", () => {
    expect(pickedFollowOn("2026-11-04", TODAY)).toBe("2026-11-04");
    expect(pickedFollowOn("2026-10-25", TODAY)).toBe("2026-10-26"); // a Sunday
    expect(pickedFollowOn(TODAY, TODAY)).toBeNull();
    expect(pickedFollowOn("2026-10-20", TODAY)).toBeNull();
    expect(pickedFollowOn("2027-06-01", TODAY)).toBeNull();
    expect(pickedFollowOn("2026-02-30", TODAY)).toBeNull();
    expect(pickedFollowOn("next week", TODAY)).toBeNull();
  });
});

describe("support plans that fit the note", () => {
  it("suggests practical catch-up for a Class 12 practicals note, not reading practice", () => {
    const steps = suggestedSteps(["studies"], { text: "Behind in Physics practicals, record book incomplete", classLabel: "Class 12 Science" }).map((s) => s.en);
    expect(steps[0]).toBe("A catch-up practical session this week");
    expect(steps).toContain("Check the practical record book is complete");
    expect(steps).not.toContain("Extra reading practice 10 minutes a day");
    expect(steps).not.toContain("Sit near the front in class");
  });

  it("suggests calling home for an absence note", () => {
    const steps = suggestedSteps(["attendance"], { text: "Absent 3 days this month", classLabel: "SKG" }).map((s) => s.en);
    expect(steps[0]).toBe("Call home to ask why the child was away");
  });

  it("offers reading practice to the youngest and a doubt session to the oldest", () => {
    expect(suggestedSteps(["studies"], { classLabel: "Class 2" }).map((s) => s.en)).toContain("Extra reading practice 10 minutes a day");
    expect(suggestedSteps(["studies"], { classLabel: "Class 11 Commerce" }).map((s) => s.en)).toContain("A doubt-clearing session with the subject teacher");
    expect(classLevel("UKG")).toBe(0);
    expect(classLevel("Class 7")).toBe(7);
    expect(classLevel(null)).toBeNull();
  });

  it("suggests a short goal, never the note's words", () => {
    const body = "Synthetic note: behind in Physics practicals and needs a catch-up before the exam";
    const goals = suggestedGoals(["studies"], body);
    expect(goals[0]?.en).toBe("Finish the missed practicals");
    for (const g of goals) expect(g.en.length).toBeLessThan(40);
  });
});

describe("the parents' plan message", () => {
  const body = "Synthetic team note: has been absent 3 days this month. Please check with the family and help him catch up on lessons";

  it("leaves out a goal that is the note's words cut mid-word", () => {
    expect(goalForParents(`${body.slice(0, 100)}…`, body)).toBeNull();
    expect(goalForParents(body.slice(0, 80), body)).toBeNull();
    expect(goalForParents("Come to school every day", body)).toBe("Come to school every day");
    const msg = parentPlanMessage({ childName: "Test Child", goal: `${body.slice(0, 119)}…`, steps: ["Call home when absent"], school: "QA School", noteBody: body });
    expect(msg.en).not.toContain("Synthetic team note");
    expect(msg.hi).not.toContain("Synthetic team note");
    expect(msg.en.startsWith("Hello, our plan to help Test Child:\n1. Call home when absent")).toBe(true);
  });

  it("puts each suggested step in the parents' language, whichever language it was saved in", () => {
    const msg = parentPlanMessage({ childName: "Test Child", goal: "रोज़ स्कूल आए", steps: ["रोज़ गृहकार्य डायरी जाँचें", "Sit near the front in class", "My own step"], school: "QA School" });
    expect(msg.en).toContain("Hello, our plan to help Test Child: Come to school every day");
    expect(msg.en).toContain("1. Check the homework diary every day");
    expect(msg.en).not.toMatch(/[ऀ-ॿ]/);
    expect(msg.hi).toContain("2. कक्षा में आगे बैठाएँ");
    expect(msg.hi).toContain("3. My own step");
  });

  it("finds a stored step's pair, and leaves a teacher's own step as written", () => {
    expect(knownPair("कक्षा में आगे बैठाएँ").en).toBe("Sit near the front in class");
    expect(knownPair("  Call home when absent ")).toEqual({ en: "Call home when absent", hi: "अनुपस्थित होने पर घर फ़ोन करें" });
    expect(knownPair("Practise tables")).toEqual({ en: "Practise tables" });
  });

  it("says a step's when in Hindi", () => {
    expect(whenPair("Every Friday")).toEqual({ en: "Every Friday", hi: "हर शुक्रवार" });
    expect(whenPair("From Wed 21 Oct").hi).toBe("बुध 21 अक्टूबर से");
    expect(whenPair("By Mon 26 Oct").hi).toBe("सोम 26 अक्टूबर तक");
    expect(whenPair("Mon 26 Oct").hi).toBe("सोम 26 अक्टूबर");
    expect(whenPair("after the PTM")).toEqual({ en: "after the PTM" });
  });
});

describe("who reads a plan", () => {
  it("names every teacher of the class, the class teacher as one of them", () => {
    const r = planReaders({ tags: ["studies"] }, { classTeacher: "QA Teacher", admin: null });
    expect(r.en).toBe("You, all the class's teachers (class teacher QA Teacher), the coordinators, the office and the admin");
    expect(r.hi).toContain("कक्षा के सभी अध्यापक");
  });
});
