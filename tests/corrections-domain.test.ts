import { describe, expect, it } from "vitest";

import {
  byQueueOrder,
  canDecide,
  canRequestCorrection,
  decideCorrectionSchema,
  pendingCount,
  requestCorrectionSchema,
  type Correction,
} from "@/modules/attendance/domain/corrections";

const correction = (over: Partial<Correction> = {}): Correction => ({
  id: "c1",
  registerId: "r1",
  studentId: "s1",
  studentName: "Test Child",
  classLabel: "Class 6",
  day: "2026-09-17",
  fromStatus: "absent",
  toStatus: "present",
  reason: "Was in the sports ground with me.",
  requestedById: "staff-1",
  requestedByName: "Test Teacher",
  requestedAt: "2026-09-17T10:00:00Z",
  status: "pending",
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  ...over,
});

describe("canRequestCorrection()", () => {
  const base = {
    registerStatus: "submitted" as const,
    currentStatus: "absent" as const,
    toStatus: "present" as const,
    hasPendingRequest: false,
  };

  it("allows a change to a submitted register", () => {
    expect(canRequestCorrection(base).allowed).toBe(true);
  });

  it("refuses one on a register that is still open", () => {
    // A correction request on a draft is ceremony: just edit it.
    const verdict = canRequestCorrection({ ...base, registerStatus: "open" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toContain("still open");
  });

  it("refuses a second request for the same child", () => {
    // Two pending corrections for one mark make the approval queue a race.
    expect(
      canRequestCorrection({ ...base, hasPendingRequest: true }).allowed,
    ).toBe(false);
  });

  it("refuses a change to what is already recorded", () => {
    expect(
      canRequestCorrection({ ...base, toStatus: "absent" }).allowed,
    ).toBe(false);
  });

  it("allows a change when nothing was recorded for the child", () => {
    expect(
      canRequestCorrection({ ...base, currentStatus: null }).allowed,
    ).toBe(true);
  });
});

describe("canDecide()", () => {
  const base = {
    hasCorrectPermission: true,
    requestedByStaffId: "staff-1",
    deciderStaffId: "staff-2",
    status: "pending" as const,
  };

  it("lets a second person decide", () => {
    expect(canDecide(base).allowed).toBe(true);
  });

  /**
   * The point of the queue is that somebody else looked. With one approver in
   * the school this means a request can sit — which is the right failure,
   * because the alternative is a rubber stamp that looks like oversight.
   */
  it("never lets anybody approve their own request", () => {
    const verdict = canDecide({ ...base, deciderStaffId: "staff-1" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toContain("your own");
  });

  it("refuses somebody without the permission", () => {
    expect(
      canDecide({ ...base, hasCorrectPermission: false }).allowed,
    ).toBe(false);
  });

  it("refuses a request that is already decided", () => {
    expect(canDecide({ ...base, status: "approved" }).allowed).toBe(false);
    expect(canDecide({ ...base, status: "rejected" }).allowed).toBe(false);
  });
});

describe("byQueueOrder()", () => {
  it("puts everything waiting above everything decided", () => {
    const rows = [
      correction({ id: "old-approved", status: "approved", requestedAt: "2026-09-20T10:00:00Z" }),
      correction({ id: "waiting", status: "pending", requestedAt: "2026-09-01T10:00:00Z" }),
    ];

    expect([...rows].sort(byQueueOrder).map((row) => row.id)).toEqual([
      "waiting",
      "old-approved",
    ]);
  });

  it("puts the newest first within a status", () => {
    const rows = [
      correction({ id: "older", requestedAt: "2026-09-01T10:00:00Z" }),
      correction({ id: "newer", requestedAt: "2026-09-10T10:00:00Z" }),
    ];

    expect([...rows].sort(byQueueOrder).map((row) => row.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("pendingCount()", () => {
  it("counts only what is still waiting", () => {
    expect(
      pendingCount([
        correction({ status: "pending" }),
        correction({ status: "approved" }),
        correction({ status: "pending" }),
      ]),
    ).toBe(2);
  });
});

describe("the request schema", () => {
  const valid = {
    registerId: "0192e5b2-0000-7000-8000-000000000001",
    studentId: "0192e5b2-0000-7000-8000-000000000002",
    toStatus: "present",
    reason: "Was with me at the assembly.",
  };

  it("accepts a request with a reason", () => {
    expect(requestCorrectionSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses one without", () => {
    // A correction with no reason cannot be judged, so it is not a request.
    expect(
      requestCorrectionSchema.safeParse({ ...valid, reason: "  " }).success,
    ).toBe(false);
  });

  it("refuses a reason longer than the column", () => {
    expect(
      requestCorrectionSchema.safeParse({ ...valid, reason: "x".repeat(301) })
        .success,
    ).toBe(false);
  });
});

describe("the decision schema", () => {
  it("turns an empty note into null", () => {
    const parsed = decideCorrectionSchema.safeParse({
      correctionId: "0192e5b2-0000-7000-8000-000000000001",
      approve: true,
      decisionNote: "   ",
    });

    expect(parsed.success && parsed.data.decisionNote).toBeNull();
  });
});
