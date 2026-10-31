import { describe, expect, it } from "vitest";

import { DEFAULT_QUIET_HOURS } from "@/modules/whatsapp/domain/send-guards";
import {
  DIGEST_THRESHOLD,
  EDGE_GRACE_HOURS,
  evaluateStaffSend,
  evaluateTeacherTaskSend,
  hasConsent,
  inSendWindow,
  nextWindowOpen,
  paceDelay,
  readMonthCap,
  STAFF_DAILY_LIMIT,
  STAFF_SEND_WINDOW,
  type StaffGateFacts,
  type StaffGateInput,
} from "@/modules/staff-notices/domain/gates";
import { seededKindsMap } from "@/modules/staff-notices/domain/kinds";

/**
 * The staff WhatsApp gate (go-live Phase F, plan §8.3, D-356): every branch,
 * and that each one fails closed. Times are IST on the school's clock; 04:30
 * UTC is 10:00 in school.
 */

const AT_10 = new Date("2026-11-02T04:30:00.000Z");
const AT_0630 = new Date("2026-11-02T01:00:00.000Z");
const AT_2030 = new Date("2026-11-02T15:00:00.000Z");
const AT_2130 = new Date("2026-11-02T16:00:00.000Z");

const allOn = Object.fromEntries(Object.keys(seededKindsMap()).map((kind) => [kind, true]));

function facts(overrides: Partial<StaffGateFacts> = {}): StaffGateFacts {
  return {
    optInAt: "2026-10-01T05:00:00.000Z",
    optOutAt: null,
    isTestAccount: false,
    isTestSession: false,
    prefEnabled: null,
    kindsEnabled: allOn,
    sentToday: 0,
    recentSameKind: 0,
    pendingSameKind: 0,
    heldForDigest: false,
    monthSent: 0,
    monthCap: 1000,
    allowlisted: false,
    ...overrides,
  };
}

function gate(overrides: Partial<StaffGateInput> & { f?: Partial<StaffGateFacts> } = {}) {
  const { f, ...rest } = overrides;
  return evaluateStaffSend({
    kind: "money_request",
    facts: facts(f),
    transport: "aisensy",
    confined: false,
    now: AT_10,
    ...rest,
  });
}

describe("the send window is the fee reminders' quiet hours, opening at 07:00 (critique1 C1)", () => {
  it("has DEFAULT_QUIET_HOURS' shape and end", () => {
    expect(STAFF_SEND_WINDOW).toEqual({ start: 7, end: DEFAULT_QUIET_HOURS.end });
    expect(STAFF_SEND_WINDOW.end).toBe(20);
  });

  it("reads IST whatever the server's zone", () => {
    expect(inSendWindow(AT_10)).toBe(true);
    expect(inSendWindow(AT_0630)).toBe(false);
    expect(inSendWindow(AT_2030)).toBe(false);
    // 19:59 IST is in; 20:00 is out.
    expect(inSendWindow(new Date("2026-11-02T14:29:00.000Z"))).toBe(true);
    expect(inSendWindow(new Date("2026-11-02T14:30:00.000Z"))).toBe(false);
  });

  it("gives an edge-of-window kind one more hour, not more", () => {
    expect(EDGE_GRACE_HOURS).toBe(1);
    expect(inSendWindow(AT_2030, true)).toBe(true);
    expect(inSendWindow(AT_2130, true)).toBe(false);
  });

  it("holds until 07:00 the same morning before it, the next morning after it", () => {
    expect(nextWindowOpen(AT_0630).toISOString()).toBe("2026-11-02T01:30:00.000Z");
    expect(nextWindowOpen(AT_2030).toISOString()).toBe("2026-11-03T01:30:00.000Z");
  });
});

describe("evaluateStaffSend — in order, every branch fails closed", () => {
  it("sends when every rule says yes", () => {
    expect(gate()).toEqual({ action: "send", allowlistRequired: false, digestCount: null });
  });

  it("1. holds, never sends, when the facts could not be read", () => {
    for (const bad of [null, undefined, { ...facts(), sentToday: "3" }, { ...facts(), heldForDigest: undefined }]) {
      const verdict = evaluateStaffSend({ kind: "money_request", facts: bad as never, transport: "aisensy", confined: false, now: AT_10 });
      expect(verdict).toMatchObject({ action: "defer", reason: "gate_unreadable" });
    }
  });

  it("2. refuses a kind it does not know, and one not switched on by name", () => {
    expect(gate({ kind: "teacher_task" })).toEqual({ action: "suppress", reason: "kind_unknown" });
    expect(gate({ kind: "anything" })).toEqual({ action: "suppress", reason: "kind_unknown" });
    expect(gate({ f: { kindsEnabled: { ...allOn, money_request: false } } })).toEqual({ action: "suppress", reason: "kind_off" });
    expect(gate({ f: { kindsEnabled: { ...allOn, money_request: "true" } } })).toEqual({ action: "suppress", reason: "kind_off" });
    expect(gate({ f: { kindsEnabled: null } })).toEqual({ action: "suppress", reason: "kind_off" });
    expect(gate({ f: { kindsEnabled: ["money_request"] } })).toEqual({ action: "suppress", reason: "kind_off" });
  });

  it("the seeded map keeps the existing kinds on and every new kind off", () => {
    const seeded = seededKindsMap();
    expect(seeded.cover_assigned && seeded.attendance_reminder && seeded.teacher_task).toBe(true);
    for (const kind of ["online_review", "online_payment", "day_collection", "day_not_closed", "money_request", "money_decision", "leave_requested", "leave_decided", "marks_reminder", "weekly_summary", "staff_broadcast"] as const) {
      expect(seeded[kind]).toBe(false);
    }
    expect(gate({ f: { kindsEnabled: seeded } })).toEqual({ action: "suppress", reason: "kind_off" });
  });

  it("3. refuses without consent, and after an opt-out", () => {
    expect(gate({ f: { optInAt: null } })).toEqual({ action: "suppress", reason: "no_consent" });
    expect(gate({ f: { optOutAt: "2026-10-05T00:00:00.000Z" } })).toEqual({ action: "suppress", reason: "opted_out" });
    expect(gate({ f: { optInAt: null, optOutAt: "2026-10-05T00:00:00.000Z" } })).toEqual({ action: "suppress", reason: "opted_out" });
    // A yes after the no is a yes.
    expect(gate({ f: { optOutAt: "2026-09-01T00:00:00.000Z" } }).action).toBe("send");
    // An unreadable opt-out is an opt-out; an unreadable opt-in is no consent.
    expect(hasConsent({ optInAt: "2026-10-01T00:00:00Z", optOutAt: "garbage" })).toBe("opted_out");
    expect(hasConsent({ optInAt: "garbage", optOutAt: null })).toBe("no_consent");
    // The same instant: the no wins.
    expect(hasConsent({ optInAt: "2026-10-01T00:00:00Z", optOutAt: "2026-10-01T00:00:00Z" })).toBe("opted_out");
  });

  it("4. refuses a kind the person switched off; no row is not a no", () => {
    expect(gate({ f: { prefEnabled: false } })).toEqual({ action: "suppress", reason: "pref_off" });
    expect(gate({ f: { prefEnabled: true } }).action).toBe("send");
    expect(gate({ f: { prefEnabled: null } }).action).toBe("send");
  });

  it("5. a TEST session, a test account or a confined deployment: the allowlist only", () => {
    for (const input of [{ f: { isTestSession: true } }, { f: { isTestAccount: true } }, { confined: true }]) {
      expect(gate(input)).toEqual({ action: "suppress", reason: "not_test_recipient" });
      expect(gate({ ...input, f: { ...(input.f ?? {}), allowlisted: null } })).toEqual({ action: "suppress", reason: "not_test_recipient" });
      expect(gate({ ...input, f: { ...(input.f ?? {}), allowlisted: true } })).toEqual({
        action: "send",
        allowlistRequired: true,
        digestCount: null,
      });
    }
    // Real session, real account, Vercel production: the allowlist is not asked.
    expect(gate({ f: { allowlisted: false } })).toMatchObject({ action: "send", allowlistRequired: false });
  });

  it("6. outside 07:00–20:00 holds until the window opens; cover is exempt; day-not-closed gets the edge hour", () => {
    expect(gate({ now: AT_0630 })).toEqual({ action: "defer", reason: "outside_window", until: nextWindowOpen(AT_0630) });
    expect(gate({ now: AT_2030 })).toMatchObject({ action: "defer", reason: "outside_window" });
    expect(gate({ kind: "cover_assigned", now: AT_0630 }).action).toBe("send");
    expect(gate({ kind: "cover_escalation", now: AT_2130 }).action).toBe("send");
    expect(gate({ kind: "day_not_closed", now: AT_2030 }).action).toBe("send");
    expect(gate({ kind: "day_not_closed", now: AT_2130 })).toMatchObject({ action: "defer", reason: "outside_window" });
  });

  it("7. at most 8 a day, cover exempt", () => {
    expect(STAFF_DAILY_LIMIT).toBe(8);
    expect(gate({ f: { sentToday: 7 } }).action).toBe("send");
    expect(gate({ f: { sentToday: 8 } })).toEqual({ action: "suppress", reason: "daily_cap" });
    expect(gate({ kind: "cover_changed", f: { sentToday: 30 } }).action).toBe("send");
  });

  it("8. the month's cap on AiSensy sends, for every kind; the mock is not counted", () => {
    expect(gate({ f: { monthSent: 999 } }).action).toBe("send");
    expect(gate({ f: { monthSent: 1000 } })).toEqual({ action: "suppress", reason: "month_cap" });
    expect(gate({ kind: "cover_assigned", f: { monthSent: 1000 } })).toEqual({ action: "suppress", reason: "month_cap" });
    expect(gate({ transport: "mock", f: { monthSent: 5000 } }).action).toBe("send");
    // A cap that is off, missing or not a positive whole number: nothing goes.
    for (const cap of [null, 0, -5, 1.5, "abc", {}]) {
      expect(gate({ f: { monthCap: cap } })).toMatchObject({ action: "defer", reason: "gate_unreadable" });
    }
    expect(readMonthCap("250")).toBe(250);
    expect(gate({ f: { monthCap: "250", monthSent: 250 } })).toEqual({ action: "suppress", reason: "month_cap" });
  });

  it("9. more than 3 of one kind in 30 minutes become one digest; cover is never folded", () => {
    expect(DIGEST_THRESHOLD).toBe(3);
    // Four due at once: one digest of four.
    expect(gate({ f: { pendingSameKind: 3 } })).toEqual({ action: "send", allowlistRequired: false, digestCount: 4 });
    // Three due: each goes.
    expect(gate({ f: { pendingSameKind: 2 } })).toMatchObject({ action: "send", digestCount: null });
    // Three went in the last half hour and one more arrives: held to gather.
    const held = gate({ f: { recentSameKind: 3 } });
    expect(held).toMatchObject({ action: "defer", reason: "digest_hold" });
    if (held.action === "defer") expect(held.until.getTime() - AT_10.getTime()).toBe(30 * 60_000);
    // Back from the hold with others gathered: one digest.
    expect(gate({ f: { recentSameKind: 3, heldForDigest: true, pendingSameKind: 1 } })).toMatchObject({ action: "send", digestCount: 2 });
    // Back from the hold alone: it goes on its own, never held twice.
    expect(gate({ f: { recentSameKind: 3, heldForDigest: true } })).toMatchObject({ action: "send", digestCount: null });
    // Cover: never.
    expect(gate({ kind: "cover_assigned", f: { pendingSameKind: 10, recentSameKind: 10 } })).toMatchObject({ action: "send", digestCount: null });
  });

  it("asks consent before the window, so a no is never held until morning", () => {
    expect(gate({ now: AT_0630, f: { optInAt: null } })).toEqual({ action: "suppress", reason: "no_consent" });
  });
});

describe("evaluateTeacherTaskSend — the teacher-task link's API send", () => {
  const task = (overrides: Partial<StaffGateFacts> = {}, confined = false) =>
    evaluateTeacherTaskSend({ facts: facts(overrides), confined });

  it("sends with consent and the switch on", () => {
    expect(task()).toEqual({ ok: true });
  });

  it("refuses on every missing yes, and on unreadable facts", () => {
    expect(evaluateTeacherTaskSend({ facts: null, confined: false })).toEqual({ ok: false, reason: "gate_unreadable" });
    expect(task({ kindsEnabled: { ...allOn, teacher_task: false } })).toEqual({ ok: false, reason: "kind_off" });
    expect(task({ optInAt: null })).toEqual({ ok: false, reason: "no_consent" });
    expect(task({ optOutAt: "2026-10-20T00:00:00Z" })).toEqual({ ok: false, reason: "opted_out" });
    expect(task({ prefEnabled: false })).toEqual({ ok: false, reason: "pref_off" });
    expect(task({ isTestSession: true })).toEqual({ ok: false, reason: "not_test_recipient" });
    expect(task({}, true)).toEqual({ ok: false, reason: "not_test_recipient" });
    expect(task({ isTestAccount: true, allowlisted: true })).toEqual({ ok: true });
  });

  it("is a person's press, so the daily limit does not apply", () => {
    expect(task({ sentToday: 50 })).toEqual({ ok: true });
  });

  it("is held to the one month's cap every staff WhatsApp shares (review of PR #148)", () => {
    expect(task({ monthSent: 999, monthCap: 1000 })).toEqual({ ok: true });
    expect(task({ monthSent: 1000, monthCap: 1000 })).toEqual({ ok: false, reason: "month_cap" });
    expect(task({ monthCap: null })).toEqual({ ok: false, reason: "gate_unreadable" });
    expect(task({ monthSent: Number.NaN })).toEqual({ ok: false, reason: "gate_unreadable" });
  });
});

describe("1 request a second to AiSensy", () => {
  it("waits out the rest of the second since the last call, and not at all the first time", () => {
    expect(paceDelay(null, 5000)).toBe(0);
    expect(paceDelay(5000, 5200)).toBe(800);
    expect(paceDelay(5000, 7000)).toBe(0);
  });
});
