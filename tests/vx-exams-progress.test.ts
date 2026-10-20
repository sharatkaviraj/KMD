import { describe, expect, it } from "vitest";

import { afterSave, counts, draftEntries, submitBlockers, type Cell } from "@/vx/screens/exams/domain/entry";
import {
  cellOf,
  classReadiness,
  countPaper,
  eligibleIds,
  lockRefusal,
  lockRefusalText,
  needsCorrectionText,
  paperReadiness,
  progressLine,
  READINESS_LABEL,
  type PersistedMark,
} from "@/vx/screens/exams/domain/progress";
import { pipelineStates } from "@/vx/screens/exams/domain/results";
import type { EnrolmentFacts } from "@/vx/screens/exams/domain/tracker";

/*
 * One counting contract for every marks surface (B01): the teacher's Today /
 * More / subject cards (`marksLinks` → `trackerFor`), the marks sheet
 * (`paper_roster` + `counts(order, saved)`) and the tracker / results
 * pipeline (`trackerFor`). Test ids only, no real children.
 */

const exam = { startsOn: "2026-09-20", endsOn: "2026-09-30" };
const today = "2026-10-19";
const paper = { maxMarks: 50, markStep: 1 };

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E, F, G, H, I] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);

const enrol = (studentId: string, over: Partial<EnrolmentFacts> = {}): EnrolmentFacts => ({
  studentId,
  classId: "class-1",
  status: "enrolled",
  enrolledOn: "2026-04-01",
  leftOn: null,
  ...over,
});

const enrolments: EnrolmentFacts[] = [
  enrol(A), // zero
  enrol(B), // cleared cell: a row with value null
  enrol(C), // absent
  enrol(D), // exempt
  enrol(E), // a mark
  enrol(F), // no row at all
  enrol(G, { enrolledOn: "2026-10-05" }), // joined after the exam: not on its roster
  enrol(H, { status: "left", leftOn: "2026-09-10" }), // left before it began: not on its roster
  enrol(I, { status: "left", leftOn: "2026-09-25" }), // left during it: on its roster
];

const marks: PersistedMark[] = [
  { studentId: A, value: 0, absent: false, exempt: false },
  { studentId: B, value: null, absent: false, exempt: false },
  { studentId: C, value: null, absent: true, exempt: false },
  { studentId: D, value: null, absent: false, exempt: true },
  { studentId: E, value: "45", absent: false, exempt: false },
  { studentId: G, value: 30, absent: false, exempt: false },
  { studentId: H, value: 20, absent: false, exempt: false },
  { studentId: I, value: 7.5, absent: false, exempt: false }, // a legacy half on a whole-mark paper
];

describe("B01 — one population, one count, everywhere", () => {
  const roster = eligibleIds(enrolments, exam, today);

  it("the roster is the exam's: late joiners and early leavers are out, a mid-exam leaver is in", () => {
    expect(roster).toEqual([A, B, C, D, E, F, I]);
  });

  it("saved = value (zero included), absent or exempt; blank, absent and exempt stay distinct", () => {
    const n = countPaper(roster, marks, paper);
    expect(n).toMatchObject({ eligible: 7, saved: 5, values: 3, absent: 1, exempt: 1, blank: 2, invalid: 1 });
    expect(n.invalidIds).toEqual([I]);
  });

  it("the marks sheet's own count over the same fixture gives the same numbers", () => {
    // The sheet: order = paper_roster, saved = each persisted row as a cell.
    const byStudent = new Map(marks.map((m) => [m.studentId, m]));
    const saved: Record<string, Cell> = {};
    for (const s of roster) saved[s] = cellOf(byStudent.get(s));
    const sheet = counts(roster, saved);
    const tracker = countPaper(roster, marks, paper);
    // Today / More / subject cards read `trackerFor`, which is `countPaper`.
    const today = countPaper(roster, marks, paper);
    expect([sheet.filled, sheet.total]).toEqual([tracker.saved, tracker.eligible]);
    expect([today.saved, today.eligible]).toEqual([tracker.saved, tracker.eligible]);
    expect([sheet.entered, sheet.absent, sheet.exempt, sheet.blank]).toEqual([tracker.values, tracker.absent, tracker.exempt, tracker.blank]);
  });

  it("documents the old Today rule this replaces: every row over 'enrolled' ignoring dates", () => {
    const oldTotal = enrolments.filter((e) => e.status === "enrolled").length; // includes the late joiner, drops the mid-exam leaver
    const oldEntered = marks.length; // includes the cleared cell and two off-roster rows
    expect([oldEntered, oldTotal]).toEqual([8, 7]); // "8 of 7"
    const n = countPaper(roster, marks, paper);
    expect([n.saved, n.eligible]).not.toEqual([oldEntered, oldTotal]);
  });

  it("a row for a pupil off the roster is never counted, and a cleared cell is blank", () => {
    expect(cellOf({ value: null, absent: false, exempt: false })).toEqual({ state: "blank", value: null });
    expect(cellOf({ value: 0, absent: false, exempt: false })).toEqual({ state: "value", value: 0 });
    expect(cellOf({ value: 12, absent: true, exempt: true })).toEqual({ state: "exempt", value: null });
    expect(countPaper([A], marks, paper).eligible).toBe(1);
  });
});

describe("B03 — an old mark the paper cannot hold does not block a new one", () => {
  // X has a legacy 7.5 on a paper that now takes whole marks; Y is new; Z unchanged.
  const [X, Y, Z] = [id(21), id(22), id(23)];
  const order = [X, Y, Z];
  const legacy: Cell = { state: "value", value: 7.5 };
  const saved: Record<string, Cell> = { [X]: legacy, [Y]: { state: "blank", value: null }, [Z]: { state: "value", value: 40 } };
  const cells: Record<string, Cell> = { ...saved, [Y]: { state: "value", value: 35 } };

  it("the draft payload carries only the changed row, and passes", () => {
    const draft = draftEntries(order, cells, saved, 50, 1);
    expect(draft.blocked).toEqual([]);
    expect(draft.changed).toEqual([Y]);
    expect(draft.entries).toEqual([{ studentId: Y, state: "value", value: 35 }]);
  });

  it("the final send is blocked, naming the pupil with the 7.5", () => {
    expect(submitBlockers(order, cells, 50, 1)).toEqual([X]);
    expect(needsCorrectionText(7.5, 50, 1).en).toBe("Needs correction: 7.5 — this paper takes whole marks");
    expect(needsCorrectionText(55, 50, 1).en).toBe("Needs correction: 55 — this paper is out of 50");
  });

  it("the legacy value is byte-identical after the save", () => {
    const draft = draftEntries(order, cells, saved, 50, 1);
    const next = afterSave(saved, draft.entries);
    expect(next[X]).toBe(legacy); // the same cell, not a rebuilt one
    expect(JSON.stringify(next[X])).toBe(JSON.stringify({ state: "value", value: 7.5 }));
    expect(next[Y]).toEqual({ state: "value", value: 35 });
    expect(next[Z]).toBe(saved[Z]);
  });

  it("a changed cell the paper cannot hold is still refused, and nothing is sent", () => {
    const bad = { ...cells, [Z]: { state: "value", value: 40.5 } as Cell };
    const draft = draftEntries(order, bad, saved, 50, 1);
    expect(draft.blocked).toEqual([Z]);
    expect(draft.entries).toEqual([]);
  });
});

describe("B04 — readiness from persisted marks and their validity", () => {
  const base: { total: number; entered: number; invalid: number; entryStatus: "open" | "submitted" } = { total: 30, entered: 30, invalid: 0, entryStatus: "submitted" };

  it("each paper state", () => {
    expect(paperReadiness({ ...base, invalid: 1 })).toBe("needs_correction");
    expect(paperReadiness({ ...base, entered: 29 })).toBe("missing");
    expect(paperReadiness({ ...base, entryStatus: "open" })).toBe("saved");
    expect(paperReadiness(base)).toBe("submitted");
    expect(READINESS_LABEL.saved.en).toBe("Saved, not submitted");
    expect(READINESS_LABEL.ready_for_review.en).toBe("Ready for review");
  });

  it("'Ready to lock' only when every paper is submitted, complete and valid", () => {
    expect(classReadiness([base, base])).toMatchObject({ state: "ready_for_review", readyToLock: true });
    // All submitted is not enough:
    expect(classReadiness([base, { ...base, invalid: 2 }])).toMatchObject({ state: "needs_correction", readyToLock: false, invalid: 2 });
    expect(classReadiness([base, { ...base, entered: 28 }])).toMatchObject({ state: "missing", readyToLock: false });
    expect(classReadiness([base, { ...base, entryStatus: "open" }])).toMatchObject({ state: "saved", readyToLock: false, notSubmitted: 1 });
    expect(classReadiness([]).readyToLock).toBe(false);
  });

  it("the lock action refuses with the exact reason, and accepts a ready class", () => {
    const p = (over: Partial<typeof base> = {}, subjectCode = "MATH") => ({ ...base, ...over, classLabel: "6A", subjectCode });
    expect(lockRefusal([p(), p({}, "SCI")])).toBeNull();
    expect(lockRefusal([p({ invalid: 2 })])).toEqual({ reason: "needs_correction", papers: ["6A MATH (2)"] });
    expect(lockRefusal([p({ entered: 27 })])).toEqual({ reason: "missing", papers: ["6A MATH (27/30)"] });
    expect(lockRefusal([p({ entryStatus: "open" })])).toEqual({ reason: "not_submitted", papers: ["6A MATH"] });
    // Needs correction is reported before anything else.
    expect(lockRefusal([p({ entryStatus: "open" }, "SCI"), p({ invalid: 1 })])?.reason).toBe("needs_correction");
    expect(lockRefusalText({ reason: "missing", papers: ["6A MATH (27/30)"] }).en).toBe("Some marks are missing: 6A MATH (27/30)");
  });

  it("the pipeline's Checked step is not done while a mark needs correction", () => {
    const input = { enteredPct: 100, unusualOpen: 0, graceOpen: 0, lockedClasses: 0, totalClasses: 2, cardsIssued: 0, cardsDue: 10, published: false };
    expect(pipelineStates(input).checked).toBe("done");
    expect(pipelineStates({ ...input, invalid: 1 }).checked).not.toBe("done");
  });

  it("the tracker never says 'No marks yet' over saved marks", () => {
    expect(progressLine(0, 30).en).toBe("No marks yet");
    expect(progressLine(12, 30).en).toBe("Marks being entered (12 of 30 saved)");
  });
});
