import { describe, expect, it } from "vitest";

import {
  boardKpis,
  canSeeNote,
  canWorkOnNote,
  excerpt,
  filterBoard,
  followUpDate,
  followUpLabel,
  kindForTags,
  myCounts,
  needsAction,
  parentNoteMessage,
  planProgress,
  suggestedSteps,
  tagMix,
  tagsFromKind,
  type BoardNote,
} from "@/vx/screens/notes/domain/notes";

const TODAY = "2026-10-10"; // a Saturday

function note(over: Partial<BoardNote>): BoardNote {
  return {
    id: "n",
    studentId: "s",
    studentName: "Test Child",
    classId: "c1",
    classLabel: "Class 1",
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
    writtenByName: "Teacher",
    authorRelation: null,
    subjectCode: null,
    createdAt: "2026-10-09T05:00:00Z",
    replies: 0,
    planId: null,
    ...over,
  };
}

describe("follow-up dates", () => {
  it("skips Sunday for tomorrow", () => {
    expect(followUpDate("tomorrow", TODAY)).toBe("2026-10-12");
    expect(followUpDate("tomorrow", "2026-10-12")).toBe("2026-10-13");
  });

  it("gives the Monday after today, never today", () => {
    expect(followUpDate("next_monday", TODAY)).toBe("2026-10-12");
    expect(followUpDate("next_monday", "2026-10-12")).toBe("2026-10-19");
  });

  it("lands a week later on a school day", () => {
    expect(followUpDate("one_week", "2026-10-12")).toBe("2026-10-19");
    expect(followUpDate("one_week", "2026-10-11")).toBe("2026-10-19");
  });

  it("says late, today, tomorrow, or the date", () => {
    const fmt = (d: string) => `on ${d}`;
    expect(followUpLabel("2026-10-08", TODAY, fmt)).toMatchObject({ tone: "bad", text: { en: "2 days late" } });
    expect(followUpLabel(TODAY, TODAY, fmt)?.text.en).toBe("Today");
    expect(followUpLabel("2026-10-11", TODAY, fmt)?.text.en).toBe("Tomorrow");
    expect(followUpLabel("2026-10-20", TODAY, fmt)?.text.en).toBe("on 2026-10-20");
    expect(followUpLabel(null, TODAY, fmt)).toBeNull();
  });
});

describe("who sees a note", () => {
  const teacher = { id: "t2", readsEveryClass: false, correctsAttendance: false, classIds: new Set(["c1"]) };

  it("shows 'only me' to its author alone", () => {
    const n = note({ visibility: "private" });
    expect(canSeeNote(n, { ...teacher, id: "t1" })).toBe(true);
    expect(canSeeNote(n, teacher)).toBe(false);
    expect(canSeeNote(n, { ...teacher, readsEveryClass: true })).toBe(false);
  });

  it("lets a subject teacher's note reach the class teacher through the class", () => {
    expect(canSeeNote(note({}), teacher)).toBe(true);
    expect(canSeeNote(note({ classId: "c9" }), teacher)).toBe(false);
  });

  it("shows a team note to the person asked to follow up, and to the office", () => {
    expect(canSeeNote(note({ classId: "c9", followUpStaffId: "t2" }), teacher)).toBe(true);
    expect(canSeeNote(note({ classId: "c9" }), { ...teacher, correctsAttendance: true })).toBe(true);
  });

  it("lets the class teacher and the follow-up owner work on it, not any reader", () => {
    const v = { id: "t3", readsEveryClass: false, correctsAttendance: false, heldClassIds: new Set<string>() };
    expect(canWorkOnNote(note({}), v)).toBe(false);
    expect(canWorkOnNote(note({}), { ...v, heldClassIds: new Set(["c1"]) })).toBe(true);
    expect(canWorkOnNote(note({ followUpStaffId: "t3" }), v)).toBe(true);
  });
});

describe("the board", () => {
  const notes = [
    note({ id: "due", needsFollowUp: true, followUpOn: "2026-10-09", tags: ["behaviour"] }),
    note({ id: "later", needsFollowUp: true, followUpOn: "2026-10-20", createdAt: "2026-09-20T05:00:00Z" }),
    note({ id: "health", tags: ["health"] }),
    note({ id: "done", status: "done", needsFollowUp: true, followUpOn: "2026-10-01", planId: "p1" }),
    note({ id: "other", classId: "c2", writtenBy: "t9", tags: ["talent"] }),
  ];

  it("needs action: a due follow-up, or an unclaimed health or family note", () => {
    expect(notes.filter((n) => needsAction(n, TODAY)).map((n) => n.id)).toEqual(["due", "health"]);
  });

  it("filters by tab, class, teacher and tag", () => {
    expect(filterBoard(notes, { tab: "followups" }, TODAY).map((n) => n.id)).toEqual(["due", "later"]);
    expect(filterBoard(notes, { tab: "plans" }, TODAY).map((n) => n.id)).toEqual(["done"]);
    expect(filterBoard(notes, { tab: "all", classId: "c2" }, TODAY).map((n) => n.id)).toEqual(["other"]);
    expect(filterBoard(notes, { tab: "all", teacherId: "t9" }, TODAY).map((n) => n.id)).toEqual(["other"]);
    expect(filterBoard(notes, { tab: "all", tag: "health" }, TODAY).map((n) => n.id)).toEqual(["health"]);
  });

  it("counts the KPIs without adding unlike things", () => {
    // Week of Saturday 10 Oct ends Sunday 11 Oct.
    expect(boardKpis(notes, 2, TODAY)).toEqual({ needsAction: 2, dueThisWeek: 1, plansRunning: 2, thisMonth: 4 });
  });

  it("mixes tags with no empty slices", () => {
    expect(tagMix(notes)).toEqual([
      { tag: "studies", count: 2 },
      { tag: "behaviour", count: 1 },
      { tag: "health", count: 1 },
      { tag: "talent", count: 1 },
    ]);
  });

  it("gives the teacher's header", () => {
    expect(myCounts(notes, TODAY)).toEqual({ dueSoon: 1, open: 4, done: 1 });
  });
});

describe("kinds, plans and parents", () => {
  it("maps tags and kinds both ways", () => {
    expect(kindForTags(["talent", "studies"])).toBe("praise");
    expect(kindForTags([])).toBe("other");
    expect(tagsFromKind("homework")).toEqual(["studies"]);
    expect(tagsFromKind("other")).toEqual([]);
  });

  it("suggests up to five distinct steps", () => {
    const steps = suggestedSteps(["behaviour", "studies"]);
    expect(steps.length).toBe(5);
    expect(new Set(steps.map((s) => s.en)).size).toBe(5);
  });

  it("counts a plan's progress", () => {
    expect(planProgress([
      { id: "1", body: "a", ownerRole: null, ownerName: null, whenLabel: null, done: true, sortOrder: 0 },
      { id: "2", body: "b", ownerRole: null, ownerName: null, whenLabel: null, done: false, sortOrder: 1 },
    ])).toEqual({ done: 1, total: 2 });
  });

  it("shortens a long note for a card and a message", () => {
    expect(excerpt("a ".repeat(200), 20)).toHaveLength(20);
    const msg = parentNoteMessage({ childName: "Test Child", teacher: "Ms Test", body: "Reads well now.", school: "VPPS" });
    expect(msg.hi.indexOf("Test Child")).toBeGreaterThan(-1);
    expect(msg.en).toContain("Reads well now.");
  });
});
