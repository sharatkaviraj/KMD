import { describe, expect, it } from "vitest";

import {
  cellState,
  checkMark,
  passed,
  totalsFor,
  type AssessmentSubject,
  type Mark,
} from "@/modules/assessments/domain/assessments";
import {
  marksReceiptLine,
  paperAuthority,
  saveMarksSchema,
  toMarksReceipt,
} from "@/modules/assessments/domain/marks-command";

/**
 * P7: blank, zero, absent and exempt are four things; the scheme decides what
 * a mark can be; and only the subject teacher or the exam office enters one.
 * Synthetic ids only.
 */

const paper = (over: Partial<AssessmentSubject> = {}): AssessmentSubject => ({
  id: "p1",
  assessmentId: "a1",
  classId: "c1",
  classLabel: "Class 6",
  subjectId: "s1",
  subjectCode: "Maths",
  maxMarks: 40,
  passMarks: 13,
  sortOrder: 0,
  markStep: 0.5,
  allowExempt: true,
  entryStatus: "open",
  entryRevision: 0,
  submittedAt: null,
  ...over,
});

const mark = (over: Partial<Mark> = {}): Mark => ({
  studentId: "st1",
  value: null,
  absent: false,
  exempt: false,
  enteredByName: null,
  enteredAt: null,
  ...over,
});

describe("the four states of a cell", () => {
  it("tells blank, zero, absent and exempt apart", () => {
    expect(cellState(undefined)).toBe("blank");
    expect(cellState(mark())).toBe("blank");
    expect(cellState(mark({ value: 0 }))).toBe("value");
    expect(cellState(mark({ absent: true }))).toBe("absent");
    expect(cellState(mark({ exempt: true }))).toBe("exempt");
  });

  it("leaves an exempt paper out of both halves, and counts an absence as a nought it is out of", () => {
    const totals = totalsFor([
      { paper: paper({ id: "p1" }), mark: mark({ value: 30 }) },
      { paper: paper({ id: "p2" }), mark: mark({ exempt: true }) },
      { paper: paper({ id: "p3" }), mark: mark({ absent: true }) },
      { paper: paper({ id: "p4" }), mark: undefined },
    ]);
    expect(totals).toMatchObject({ counted: 1, exempt: 1, absent: 1, missing: 1, scored: 30, outOf: 80 });
    expect(totals.percent).toBe(37.5);
  });

  it("does not pass or fail a child who was excused", () => {
    expect(passed(mark({ exempt: true }), paper())).toBeNull();
    expect(passed(mark({ absent: true }), paper())).toBe(false);
  });
});

describe("checkMark() follows the paper's step", () => {
  it("takes halves on a paper marked in halves, and refuses quarters", () => {
    expect(checkMark("37.5", paper())).toEqual({ ok: true, value: 37.5 });
    expect(checkMark("37.25", paper()).ok).toBe(false);
  });

  it("takes only whole marks on a paper marked in wholes", () => {
    expect(checkMark("37", paper({ markStep: 1 })).ok).toBe(true);
    expect(checkMark("37.5", paper({ markStep: 1 })).ok).toBe(false);
  });

  it("takes quarters on a paper marked in quarters", () => {
    expect(checkMark("12.75", paper({ markStep: 0.25 })).ok).toBe(true);
  });

  it("still refuses more than the paper is out of, and a blank is not a zero", () => {
    expect(checkMark("41", paper()).ok).toBe(false);
    expect(checkMark("", paper())).toEqual({ ok: true, value: null });
  });
});

describe("paperAuthority()", () => {
  it("lets the subject teacher the timetable assigns enter the marks", () => {
    expect(paperAuthority({ isManager: false, isAssigned: true, hasWritePermission: true })).toEqual({
      enter: true,
      reopen: false,
    });
  });

  it("does not let a class teacher enter another teacher's subject", () => {
    const verdict = paperAuthority({ isManager: false, isAssigned: false, hasWritePermission: true });
    expect(verdict.enter).toBe(false);
    expect(verdict.reason?.en).toMatch(/subject teacher/);
  });

  it("lets the exam office enter any paper and hand a submitted one back", () => {
    expect(paperAuthority({ isManager: true, isAssigned: false, hasWritePermission: false })).toEqual({
      enter: true,
      reopen: true,
    });
  });
});

describe("saveMarksSchema", () => {
  const valid = {
    commandId: "6f1d2c58-5b2e-4bf5-9b1c-3a0c5c0a7e11",
    paperId: "0d0e8a64-2f5b-4d0b-8a35-0a5b1e2c3d44",
    kind: "draft" as const,
    expectedRevision: 0,
    entries: [
      { studentId: "1c9a7f0e-4b7d-4a52-9d3e-6c1b8f2a0d55", state: "value" as const, value: 0 },
      { studentId: "2c9a7f0e-4b7d-4a52-9d3e-6c1b8f2a0d55", state: "exempt" as const, value: null },
      { studentId: "3c9a7f0e-4b7d-4a52-9d3e-6c1b8f2a0d55", state: "blank" as const, value: null },
    ],
  };

  it("accepts a draft with a zero, an exemption and a blank in it", () => {
    expect(saveMarksSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a correction that does not say why", () => {
    expect(saveMarksSchema.safeParse({ ...valid, kind: "correction" }).success).toBe(false);
    expect(saveMarksSchema.safeParse({ ...valid, kind: "correction", reason: "Re-marked" }).success).toBe(true);
  });

  it("refuses a state it has never heard of", () => {
    expect(
      saveMarksSchema.safeParse({ ...valid, entries: [{ ...valid.entries[0], state: "excused" }] }).success,
    ).toBe(false);
  });
});

describe("marksReceiptLine()", () => {
  const raw = {
    command_id: "c",
    paper_id: "p",
    kind: "submit",
    revision: 3,
    entry_status: "submitted",
    saved_at: "2026-10-04T04:00:00Z",
    actor_name: "QA Teacher",
    changed: 2,
    counts: { entered: 37, absent: 1, exempt: 1, blank: 0, total: 39 },
  };
  const receipt = toMarksReceipt(raw);

  it("says who submitted, when, and what is in", () => {
    expect(marksReceiptLine(receipt, "09:30").en).toBe(
      "Submitted by QA Teacher at 09:30 · 37 of 39 marked · 1 absent · 1 exempt",
    );
  });

  it("says a draft is a draft, with what is still blank", () => {
    const draft = toMarksReceipt({
      ...raw,
      command_id: "d",
      kind: "draft",
      entry_status: "open",
      counts: { entered: 30, absent: 0, exempt: 0, blank: 9, total: 39 },
    });
    expect(marksReceiptLine(draft, "09:31").en).toBe(
      "Draft saved by QA Teacher at 09:31 · 30 of 39 marked · 9 still blank",
    );
  });
});
