import { describe, expect, it } from "vitest";

import {
  activeKinds,
  byNewest,
  canReadNote,
  toneCounts,
  writeNoteSchema,
  type Note,
  type NoteKind,
} from "@/modules/notes/domain/notes";

const kind = (over: Partial<NoteKind> = {}): NoteKind => ({
  id: "k1",
  code: "behaviour",
  labelHi: "व्यवहार",
  labelEn: "Behaviour",
  tone: "concern",
  isActive: true,
  sortOrder: 1,
  ...over,
});

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  sessionLabel: "2026-27",
  studentId: "s1",
  classId: "c1",
  kindId: "k1",
  kindCode: "behaviour",
  kindLabelHi: "व्यवहार",
  kindLabelEn: "Behaviour",
  tone: "concern",
  body: "Test note.",
  writtenById: "staff-1",
  writtenByName: "Test Teacher",
  createdAt: "2026-09-17T10:00:00Z",
  ...over,
});

describe("activeKinds()", () => {
  it("drops the retired ones and keeps the school's order", () => {
    const kinds = [
      kind({ id: "c", sortOrder: 9 }),
      kind({ id: "gone", isActive: false, sortOrder: 0 }),
      kind({ id: "a", sortOrder: 1 }),
    ];

    expect(activeKinds(kinds).map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("falls back to the label when two share a sort order", () => {
    const kinds = [
      kind({ id: "z", labelEn: "Zebra", sortOrder: 1 }),
      kind({ id: "a", labelEn: "Apple", sortOrder: 1 }),
    ];

    expect(activeKinds(kinds).map((entry) => entry.id)).toEqual(["a", "z"]);
  });
});

describe("byNewest()", () => {
  it("reads a note screen from the top", () => {
    const notes = [
      note({ id: "old", createdAt: "2026-09-01T10:00:00Z" }),
      note({ id: "new", createdAt: "2026-09-17T10:00:00Z" }),
    ];

    expect([...notes].sort(byNewest).map((entry) => entry.id)).toEqual([
      "new",
      "old",
    ]);
  });
});

describe("toneCounts()", () => {
  it("summarises a child in one line", () => {
    // "Two things need attention" is the useful first sentence about a child;
    // a wall of text is not.
    expect(
      toneCounts([
        note({ tone: "concern" }),
        note({ tone: "concern" }),
        note({ tone: "good" }),
      ]),
    ).toEqual({ neutral: 0, good: 1, concern: 2 });
  });

  it("counts nothing as nothing rather than undefined", () => {
    expect(toneCounts([])).toEqual({ neutral: 0, good: 0, concern: 0 });
  });
});

describe("canReadNote()", () => {
  const base = {
    hasNotesView: true,
    seesEverything: false,
    ownClassIds: ["mine"],
    staffId: "staff-1",
  };

  it("refuses anybody without the permission at all", () => {
    expect(
      canReadNote({
        ...base,
        hasNotesView: false,
        seesEverything: true,
        note: note(),
      }),
    ).toBe(false);
  });

  it("lets the office see everything, because following up is the job", () => {
    expect(
      canReadNote({
        ...base,
        seesEverything: true,
        note: note({ classId: "somebody-elses", writtenById: "staff-9" }),
      }),
    ).toBe(true);
  });

  it("lets you read your own note about any class", () => {
    expect(
      canReadNote({
        ...base,
        note: note({ classId: "somebody-elses", writtenById: "staff-1" }),
      }),
    ).toBe(true);
  });

  it("lets you read a note about a class you teach", () => {
    expect(
      canReadNote({
        ...base,
        note: note({ classId: "mine", writtenById: "staff-9" }),
      }),
    ).toBe(true);
  });

  it("refuses somebody else's note about a class you do not teach", () => {
    expect(
      canReadNote({
        ...base,
        note: note({ classId: "somebody-elses", writtenById: "staff-9" }),
      }),
    ).toBe(false);
  });

  it("refuses a note attached to no class and written by somebody else", () => {
    // A note about a child with no class context is only theirs to read.
    expect(
      canReadNote({
        ...base,
        note: note({ classId: null, writtenById: "staff-9" }),
      }),
    ).toBe(false);
  });
});

describe("writeNoteSchema", () => {
  const student = "0192e5b2-0000-7000-8000-000000000002";

  const valid = {
    kindId: "0192e5b2-0000-7000-8000-000000000001",
    studentId: student,
    classId: "",
    body: "Brought the homework in today.",
  };

  it("accepts a note about a child", () => {
    const parsed = writeNoteSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    // An empty class becomes null, so the "about somebody" check in the
    // database sees the same thing this one did.
    expect(parsed.success && parsed.data.classId).toBeNull();
  });

  it("accepts a note about a whole class", () => {
    expect(
      writeNoteSchema.safeParse({ ...valid, studentId: "", classId: student })
        .success,
    ).toBe(true);
  });

  it("refuses a note about nobody", () => {
    // A note about nobody is a note nobody will ever find again.
    expect(
      writeNoteSchema.safeParse({ ...valid, studentId: "", classId: "" }).success,
    ).toBe(false);
  });

  it("refuses an empty body", () => {
    expect(writeNoteSchema.safeParse({ ...valid, body: "  " }).success).toBe(false);
  });

  it("refuses a body longer than the screen can show", () => {
    expect(
      writeNoteSchema.safeParse({ ...valid, body: "x".repeat(1001) }).success,
    ).toBe(false);
  });
});
