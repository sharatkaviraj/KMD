import { describe, expect, it } from "vitest";

import { deskRequestStatus, deskRequestToRow, mergeRequestRows, type DeskRequestDbRow } from "@/modules/finance-controls/vx/domain/desk-requests";
import type { AccRequestRow } from "@/modules/finance-controls/vx/types";

// B08: a reversal asked for on Receipts stays in "My requests" after it is decided.
const ME = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000a2";
const names = new Map([[ME, "TEST Accountant"], [ADMIN, "TEST Admin"]]);
const ctx = { staffId: ME, names, studentName: (id: string) => (id === "s1" ? "TEST Child A" : null) };

const desk = (over: Partial<DeskRequestDbRow>): DeskRequestDbRow => ({
  id: "d1",
  kind: "reversal",
  status: "pending",
  amount: "500.00",
  reason_code: "duplicate",
  note: null,
  receipt_id: "r1",
  receipt_number: "TEST-0001",
  student_id: "s1",
  requested_by: ME,
  requested_by_name: "TEST Accountant",
  decided_by: null,
  decided_at: null,
  decision_note: null,
  created_at: "2026-10-18T05:00:00+00:00",
  ...over,
});

const acc = (over: Partial<AccRequestRow>): AccRequestRow => ({
  id: "a1",
  kind: "late_fee_waiver",
  title: "Waive late fee",
  reason: "TEST reason",
  amount: 1000,
  studentId: null,
  studentName: null,
  receiptId: null,
  requestedAt: "2026-10-17T05:00:00+00:00",
  requestedByName: "TEST Accountant",
  mine: true,
  status: "waiting",
  remindedAt: null,
  decidedAt: null,
  decidedByName: null,
  decisionNote: null,
  withdrawnAt: null,
  canRemind: true,
  ...over,
});

describe("Receipts-desk requests in My requests (B08)", () => {
  it("maps pending to waiting and the decided states as they are", () => {
    expect(deskRequestStatus("pending")).toBe("waiting");
    expect(deskRequestStatus("approved")).toBe("approved");
    expect(deskRequestStatus("declined")).toBe("declined");
    expect(deskRequestStatus("withdrawn")).toBe("withdrawn");
  });

  it("keeps an approved reversal with its decision: when, by whom, and the note", () => {
    const row = deskRequestToRow(desk({ status: "approved", decided_by: ADMIN, decided_at: "2026-10-18T08:30:00+00:00", decision_note: "TEST checked" }), ctx);
    expect(row).toMatchObject({
      id: "d1",
      kind: "reversal",
      title: "Reverse receipt TEST-0001",
      reason: "Entered twice",
      amount: 500,
      studentName: "TEST Child A",
      receiptId: "r1",
      requestedAt: "2026-10-18T05:00:00+00:00",
      requestedByName: "TEST Accountant",
      mine: true,
      status: "approved",
      decidedAt: "2026-10-18T08:30:00+00:00",
      decidedByName: "TEST Admin",
      decisionNote: "TEST checked",
      withdrawnAt: null,
      canRemind: false,
      source: "desk",
    });
  });

  it("maps a declined one with its note, a withdrawn one with its time, and a write-off as other", () => {
    expect(deskRequestToRow(desk({ status: "declined", decided_by: ADMIN, decided_at: "2026-10-18T09:00:00+00:00", decision_note: "TEST not a duplicate" }), ctx)).toMatchObject({ status: "declined", decidedByName: "TEST Admin", decisionNote: "TEST not a duplicate" });
    expect(deskRequestToRow(desk({ status: "withdrawn", decided_at: "2026-10-18T06:00:00+00:00" }), ctx)).toMatchObject({ status: "withdrawn", withdrawnAt: "2026-10-18T06:00:00+00:00", decidedAt: null });
    expect(deskRequestToRow(desk({ kind: "write_off", receipt_id: null, receipt_number: null, reason_code: "TEST_code", note: "TEST note" }), ctx)).toMatchObject({ kind: "other", title: "Write off dues", reason: "TEST_code · TEST note", status: "waiting" });
    expect(deskRequestToRow(desk({ requested_by: ADMIN, requested_by_name: null }), ctx)).toMatchObject({ mine: false, requestedByName: "TEST Admin" });
  });

  it("merges both lists newest first and trims to the limit", () => {
    const merged = mergeRequestRows(
      [acc({ id: "a-old", requestedAt: "2026-10-17T05:00:00+00:00" }), acc({ id: "a-new", requestedAt: "2026-10-19T05:00:00+00:00" })],
      [deskRequestToRow(desk({ id: "d-mid", created_at: "2026-10-18T05:00:00+00:00" }), ctx)],
      10,
    );
    expect(merged.map((r) => r.id)).toEqual(["a-new", "d-mid", "a-old"]);
    expect(mergeRequestRows(merged, [], 2).map((r) => r.id)).toEqual(["a-new", "d-mid"]);
  });
});
