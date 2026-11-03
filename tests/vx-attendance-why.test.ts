import { describe, expect, it } from "vitest";

import { remindable, reminderBreakdown, type ClassBoardRow } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";

// Review A01: "2 of 20 marked … Remind 1 class" must explain itself. Synthetic classes.
const row = (over: Partial<ClassBoardRow>): ClassBoardRow => ({
  classId: Math.random().toString(36).slice(2), label: "Test", rank: 0, teacherId: "t", teacherName: "Teacher", roll: 30,
  recorded: false, savedAt: null, present: 0, absent: 0, halfDay: 0, other: 0, teacherAway: false, remindedAt: null, ...over,
});

describe("reminderBreakdown", () => {
  const rows = [
    row({ recorded: true }), row({ recorded: true }),
    row({}),
    row({ remindedAt: "2026-11-03T04:30:00Z" }),
    ...Array.from({ length: 13 }, () => row({ teacherId: null, teacherName: null })),
    row({ teacherAway: true }),
    row({ teacherId: null, remindedAt: "2026-11-03T04:30:00Z" }),
  ];

  it("gives each unmarked class one reason, and the remindable count matches the button", () => {
    const why = reminderBreakdown(rows);
    expect(why).toEqual({ notMarked: 17, canRemind: 1, reminded: 2, noTeacher: 13, teacherAway: 1 });
    expect(why.canRemind).toBe(remindable(rows).length);
    expect(why.canRemind + why.reminded + why.noTeacher + why.teacherAway).toBe(why.notMarked);
  });

  it("says it in words, leaving out reasons that do not apply", () => {
    expect(T.remindWhy(reminderBreakdown(rows)).en).toBe("Of 17 not marked: 1 can be reminded now · 2 already reminded today · 13 have no class teacher · 1 with the teacher away.");
    expect(T.remindWhy(reminderBreakdown([row({}), row({ teacherId: null })])).en).toBe("Of 2 not marked: 1 can be reminded now · 1 have no class teacher.");
  });

  it("calls a reminder queued, not sent", () => {
    expect(T.reminded(3).en).toBe("Reminder queued for 3 classes");
  });
});
