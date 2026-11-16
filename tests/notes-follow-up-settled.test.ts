import { describe, expect, it } from "vitest";

import { followUpsSettledBy, settledWords, type BoardNote } from "@/vx/screens/notes/domain/notes";

/*
 * A new note about a child closes the writer's own due follow-up for that
 * child (D-646): teachers write the follow-up as a new note and never tap Done
 * on the old one. Every id is made up (rule 6).
 */

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const SIBLING = "44444444-4444-4444-8444-444444444444";
const NEW_NOTE = "55555555-5555-4555-8555-555555555555";
const TODAY = "2026-11-16";

type Row = Pick<BoardNote, "id" | "studentId" | "status" | "needsFollowUp" | "followUpOn" | "followUpStaffId" | "writtenBy">;

const note = (id: number, over: Partial<Row> = {}): Row => ({
  id: `66666666-6666-4666-8666-${String(id).padStart(12, "0")}`,
  studentId: CHILD,
  status: "open",
  needsFollowUp: true,
  followUpOn: "2026-11-14",
  followUpStaffId: ME,
  writtenBy: ME,
  ...over,
});

const settle = (notes: Row[]) => followUpsSettledBy({ studentId: CHILD, staffId: ME, newNoteId: NEW_NOTE, today: TODAY }, notes);

describe("a new note closes your due follow-up for the same child", () => {
  it("closes a late one and one due today, keeping how each was", () => {
    expect(settle([note(1), note(2, { followUpOn: TODAY, status: "working" })])).toEqual([
      { id: note(1).id, previous: "open" },
      { id: note(2).id, previous: "working" },
    ]);
  });

  it("closes one you wrote with nobody else named, and one someone gave you", () => {
    expect(settle([note(1, { followUpStaffId: null }), note(2, { writtenBy: OTHER })])).toHaveLength(2);
  });

  it("never closes somebody else's, a later one, a done one, another child's or the new note itself", () => {
    expect(
      settle([
        note(1, { followUpStaffId: OTHER }),
        note(2, { followUpStaffId: null, writtenBy: OTHER }),
        note(3, { followUpOn: "2026-11-17" }),
        note(4, { status: "done" }),
        note(5, { studentId: SIBLING }),
        note(6, { studentId: null }),
        note(7, { needsFollowUp: false }),
        note(8, { followUpOn: null }),
        { ...note(9), id: NEW_NOTE },
      ]),
    ).toEqual([]);
  });

  it("says so with the saved note, in both languages", () => {
    expect(settledWords(1, "Riya Sharma").en).toBe("This also finished your follow-up for Riya Sharma.");
    expect(settledWords(2, "Riya Sharma").en).toBe("This also finished your 2 follow-ups for Riya Sharma.");
    expect(settledWords(2, "Riya Sharma").hi).toContain("2 फ़ॉलो-अप");
  });
});
