import { describe, expect, it } from "vitest";

import { isEmptyLeaveDraft, parseLeaveDraft } from "@/vx/screens/teach/domain/leave-draft";
import { leaveNow, registerOnLeaveLine } from "@/vx/screens/teach/domain/today";

const TODAY = "2026-11-06";
const KEYS = ["unwell", "family", "personal", "other"];

describe("leaveNow (6 Nov school day: periods 1 to 4 read Done on a first-half leave)", () => {
  it("a first-half request waiting for the office takes periods 1 to 4", () => {
    const l = leaveNow([{ status: "asked", from_day: TODAY, to_day: TODAY, span: "first_half" }], TODAY);
    expect(l?.state).toBe("waiting");
    expect(l?.periods).toEqual([1, 2, 3, 4]);
  });
  it("approved wins over waiting, and several days are full days", () => {
    const l = leaveNow(
      [
        { status: "asked", from_day: TODAY, to_day: TODAY, span: "second_half" },
        { status: "approved", from_day: "2026-11-05", to_day: "2026-11-07", span: "first_half" },
      ],
      TODAY,
    );
    expect(l?.state).toBe("approved");
    expect(l?.periods).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("declined, cancelled and other days are not leave today", () => {
    expect(leaveNow([{ status: "declined", from_day: TODAY, to_day: TODAY, span: "full" }], TODAY)).toBeNull();
    expect(leaveNow([{ status: "cancelled", from_day: TODAY, to_day: TODAY, span: "full" }], TODAY)).toBeNull();
    expect(leaveNow([{ status: "approved", from_day: "2026-11-09", to_day: "2026-11-09", span: "full" }], TODAY)).toBeNull();
  });
  it("says who takes the register only when the leave takes period 1", () => {
    expect(registerOnLeaveLine({ state: "approved", periods: [1, 2, 3, 4] })?.en).toMatch(/office marks this register/);
    expect(registerOnLeaveLine({ state: "waiting", periods: [1, 2, 3, 4] })?.en).toMatch(/waiting for the office/);
    expect(registerOnLeaveLine({ state: "approved", periods: [5, 6, 7, 8] })).toBeNull();
    expect(registerOnLeaveLine(null)).toBeNull();
  });
});

describe("parseLeaveDraft (a refresh lost the day and the reason)", () => {
  const draft = { savedOn: TODAY, when: "pick", picked: ["2026-11-05", "2026-11-07"], span: "full", reason: "family", note: "wedding", submission: { id: "abc", request: "[]" } };
  it("brings back today's draft, dropping days that have passed", () => {
    const d = parseLeaveDraft(JSON.stringify(draft), TODAY, KEYS);
    expect(d?.picked).toEqual(["2026-11-07"]);
    expect(d?.reason).toBe("family");
    expect(d?.submission?.id).toBe("abc");
  });
  it("forgets a draft from another day, a malformed one and an unknown reason", () => {
    expect(parseLeaveDraft(JSON.stringify(draft), "2026-11-07", KEYS)).toBeNull();
    expect(parseLeaveDraft("{not json", TODAY, KEYS)).toBeNull();
    expect(parseLeaveDraft(null, TODAY, KEYS)).toBeNull();
    expect(parseLeaveDraft(JSON.stringify({ ...draft, when: null, picked: [], reason: "made_up", note: " " }), TODAY, KEYS)).toBeNull();
  });
  it("a picked draft whose days all passed has no day", () => {
    const d = parseLeaveDraft(JSON.stringify({ ...draft, picked: ["2026-11-04"] }), TODAY, KEYS);
    expect(d?.when).toBeNull();
    expect(d?.reason).toBe("family");
  });
  it("empty means no day, no reason and no note", () => {
    expect(isEmptyLeaveDraft({ when: null, reason: null, note: "  " })).toBe(true);
    expect(isEmptyLeaveDraft({ when: "today", reason: null, note: "" })).toBe(false);
  });
});
