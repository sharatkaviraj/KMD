import { describe, expect, it } from "vitest";
import { returnAcceptance } from "@/modules/government-records/domain/acceptance";

const rows = [{ studentId: "00000000-0000-4000-8000-000000000011", admissionNo: "00017" }, { studentId: "00000000-0000-4000-8000-000000000012", admissionNo: "18" }];
describe("recorded portal acceptance", () => {
  it("keeps a partial outcome scoped to exact admission identifiers", () => {
    expect(returnAcceptance(rows, "partially_accepted", "00017")).toEqual([{ studentId: rows[0].studentId, state: "accepted" }, { studentId: rows[1].studentId, state: "not_accepted" }]);
    expect(() => returnAcceptance(rows, "partially_accepted", "17")).toThrow();
  });
  it("refuses ambiguous, duplicate, empty and complete selections labelled partial", () => {
    for (const input of ["", "00017\n00017", "00017\n18", "wrong"]) expect(() => returnAcceptance(rows, "partially_accepted", input)).toThrow();
    expect(() => returnAcceptance([{ ...rows[0] }, { ...rows[1], admissionNo: "00017" }], "partially_accepted", "00017")).toThrow();
  });
  it("does not infer acceptance from submission", () => {
    expect(returnAcceptance(rows, "submitted", "")).toEqual([]);
    expect(returnAcceptance(rows, "accepted", "").every(row => row.state === "accepted")).toBe(true);
    expect(returnAcceptance(rows, "rejected", "").every(row => row.state === "not_accepted")).toBe(true);
  });
});
