import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canSeeNote, followOwnerAllowed } from "@/vx/screens/notes/domain/notes";

// Teacher replay, 6 Nov 2026: a health note's follow-up could be handed to
// the coordinator, and following a note up lets that person read it, so one
// tap widened a health note beyond the admin and the class teacher.
describe("a health or family note is never followed up by the coordinator", () => {
  it("refuses the coordinator only for health and family notes", () => {
    expect(followOwnerAllowed("coordinator", { tags: ["health"] })).toBe(false);
    expect(followOwnerAllowed("coordinator", { tags: ["family", "academic"] as never })).toBe(false);
    expect(followOwnerAllowed("coordinator", { tags: [] })).toBe(true);
    for (const o of ["me", "class_teacher", "admin"] as const) expect(followOwnerAllowed(o, { tags: ["health"] })).toBe(true);
  });

  it("is the widening it prevents: a follow-up owner can read the note", () => {
    const reader = { id: "co", isAdmin: false, readsEveryClass: true, correctsAttendance: false, heldClassIds: new Set<string>(), classIds: new Set<string>() };
    const note = { visibility: "team" as const, writtenBy: "t1", classId: "c1", tags: ["health"] as const };
    expect(canSeeNote({ ...note, followUpStaffId: null }, reader as never)).toBe(false);
    expect(canSeeNote({ ...note, followUpStaffId: "co" }, reader as never)).toBe(true);
  });

  it("is checked by the server and by both pickers", () => {
    const actions = readFileSync("src/vx/screens/notes/actions.ts", "utf8");
    expect(actions.match(/followOwnerAllowed\(/g)?.length).toBe(2);
    expect(readFileSync("src/vx/screens/notes/ui/cards.tsx", "utf8").match(/followOwnerAllowed\(/g)?.length).toBe(2);
    expect(readFileSync("src/vx/screens/notes/ui/detail.tsx", "utf8")).toContain("followOwnerAllowed(a.key, note)");
  });
});
