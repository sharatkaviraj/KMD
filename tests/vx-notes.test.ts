import { describe, expect, it } from "vitest";

import {
  boardKpis,
  canSeeNote,
  canWorkOnNote,
  excerpt,
  filterBoard,
  followUpDate,
  followUpLabel,
  followUpOwnerText,
  kindForTags,
  latestStrength,
  myCounts,
  needsAction,
  nextOpenAction,
  parentNoteMessage,
  planProgress,
  suggestedSteps,
  tagMix,
  tagsFromKind,
  monthInsight,
  monthStats,
  noteStage,
  suggestTags,
  weekEndOf,
  weekStartOf,
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
  const teacher = { id: "t2", isAdmin: false, readsEveryClass: false, correctsAttendance: false, classIds: new Set(["c1"]), heldClassIds: new Set<string>() };

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

  it("keeps health and family notes to the admin, the class teacher, the author and the follow-up owner (D-264)", () => {
    for (const tag of ["health", "family"] as const) {
      const n = note({ tags: [tag] });
      // A subject teacher of the class does not read it; the class teacher does.
      expect(canSeeNote(n, teacher)).toBe(false);
      expect(canSeeNote(n, { ...teacher, heldClassIds: new Set(["c1"]) })).toBe(true);
      // The office and the coordinators read every class, but not these.
      expect(canSeeNote(n, { ...teacher, classIds: new Set(), readsEveryClass: true, correctsAttendance: true })).toBe(false);
      expect(canSeeNote(n, { ...teacher, classIds: new Set(), readsEveryClass: true, isAdmin: true })).toBe(true);
      expect(canSeeNote(n, { ...teacher, id: "t1" })).toBe(true);
      expect(canSeeNote(note({ tags: [tag], classId: "c9", followUpStaffId: "t2" }), teacher)).toBe(true);
      // Only me is still only the author, admin or not.
      expect(canSeeNote(note({ tags: [tag], visibility: "private" }), { ...teacher, isAdmin: true })).toBe(false);
    }
    // A support note still reaches every teacher of the class.
    expect(canSeeNote(note({ tags: ["studies", "talent"] }), teacher)).toBe(true);
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

  it("narrows to one child, on top of every other filter, without adding anyone", () => {
    const mixed = [...notes, note({ id: "child2", studentId: "s2", needsFollowUp: true, followUpOn: "2026-10-09" }), note({ id: "class", studentId: null })];
    expect(filterBoard(mixed, { tab: "all", studentId: "s2" }, TODAY).map((n) => n.id)).toEqual(["child2"]);
    expect(filterBoard(mixed, { tab: "action", studentId: "s2" }, TODAY).map((n) => n.id)).toEqual(["child2"]);
    expect(filterBoard(mixed, { tab: "all", studentId: "s2", classId: "c2" }, TODAY)).toEqual([]);
    expect(filterBoard(mixed, { tab: "all", studentId: "nobody" }, TODAY)).toEqual([]);
    // No student: the whole board, as before.
    expect(filterBoard(mixed, { tab: "all", studentId: null }, TODAY)).toHaveLength(mixed.length);
  });
});

describe("one child at a glance", () => {
  it("picks the newest talent note as the strength", () => {
    const picked = latestStrength([
      note({ id: "old", tags: ["talent"], createdAt: "2026-09-01T05:00:00Z" }),
      note({ id: "new", tags: ["studies", "talent"], createdAt: "2026-10-01T05:00:00Z" }),
      note({ id: "other", tags: ["behaviour"], createdAt: "2026-10-05T05:00:00Z" }),
    ]);
    expect(picked?.id).toBe("new");
  });

  it("never shows a health or family note as a strength", () => {
    expect(latestStrength([note({ tags: ["talent", "health"] }), note({ tags: ["talent", "family"] })])).toBeNull();
    expect(latestStrength([])).toBeNull();
  });

  it("finds the open action with the earliest review date", () => {
    const picked = nextOpenAction([
      note({ id: "plain" }),
      note({ id: "done", status: "done", needsFollowUp: true, followUpOn: "2026-10-01" }),
      note({ id: "later", needsFollowUp: true, followUpOn: "2026-10-20" }),
      note({ id: "overdue", status: "working", needsFollowUp: true, followUpOn: "2026-10-08" }),
    ]);
    expect(picked?.id).toBe("overdue");
    expect(nextOpenAction([note({ id: "plain" }), note({ status: "done", needsFollowUp: true, followUpOn: "2026-10-01" })])).toBeNull();
  });

  it("names who follows a note up", () => {
    expect(followUpOwnerText(note({ followUpOwner: "coordinator", followUpName: "QA Coordinator" }))?.en).toBe("QA Coordinator");
    expect(followUpOwnerText(note({ followUpOwner: "me", writtenByName: "QA Teacher" }))?.en).toBe("QA Teacher");
    expect(followUpOwnerText(note({ followUpOwner: "class_teacher" }))).toEqual({ en: "Class teacher", hi: "कक्षा अध्यापक" });
    expect(followUpOwnerText(note({ followUpOwner: null }))).toBeNull();
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

describe("the redesigned board's words", () => {
  it("says where a note stands, and an unasked note is just noting", () => {
    expect(noteStage(note({ status: "done" }))).toBe("done");
    expect(noteStage(note({ status: "working" }))).toBe("working");
    expect(noteStage(note({ needsFollowUp: true, followUpOn: "2026-10-12" }))).toBe("open");
    expect(noteStage(note({ needsFollowUp: false }))).toBe("noting");
    // An unclaimed health or family note is open: it is on the board's "Needs action".
    expect(noteStage(note({ needsFollowUp: false, tags: ["family"] }))).toBe("open");
  });

  it("runs the week from Monday to Sunday", () => {
    expect(weekStartOf(TODAY)).toBe("2026-10-05");
    expect(weekEndOf(TODAY)).toBe("2026-10-11");
    expect(weekEndOf("2026-10-11")).toBe("2026-10-11");
  });

  it("counts this week's notes and this month's teachers", () => {
    const notes = [
      note({ id: "a", writtenBy: "t1", createdAt: "2026-10-06T05:00:00Z" }),
      note({ id: "b", writtenBy: "t2", createdAt: "2026-10-02T05:00:00Z" }),
      note({ id: "c", writtenBy: "t1", createdAt: "2026-09-30T05:00:00Z" }),
    ];
    expect(monthStats(notes, TODAY)).toEqual({ thisWeek: 1, teachers: 2 });
  });

  it("finds this month's commonest tag and busiest class, and nothing in an empty month", () => {
    const notes = [
      note({ id: "a", tags: ["studies"], classId: "c1", classLabel: "Class 1" }),
      note({ id: "b", tags: ["studies", "health"], classId: "c2", classLabel: "Class 2" }),
      note({ id: "c", tags: ["talent"], classId: "c2", classLabel: "Class 2" }),
      note({ id: "d", tags: ["talent"], classId: "c1", createdAt: "2026-09-01T05:00:00Z" }),
    ];
    expect(monthInsight(notes, TODAY)).toEqual({ tag: "studies", classId: "c2", classLabel: "Class 2", classCount: 2 });
    expect(monthInsight(notes, "2026-11-02")).toBeNull();
  });

  it("suggests tags from the words, in Hindi or English, only as suggestions", () => {
    expect(suggestTags("Finds fractions hard; needs practice")).toEqual(["studies"]);
    expect(suggestTags("रिया को भिन्न वाले सवालों में दिक्कत")).toEqual(["studies"]);
    expect(suggestTags("Absent, grandmother unwell")).toEqual(expect.arrayContaining(["health", "family", "attendance"]));
    expect(suggestTags("   ")).toEqual([]);
  });
});
