import { describe, expect, it } from "vitest";

import { bridgeTodaySummarySchema } from "@/platform/fees-bridge/office-read-contracts";
import { birthdayDates, closedSpell, comingUp, firstName, knownSpan, moneyFromLedger, type CalendarRow } from "@/vx/screens/admin/today-logic";

/* Synthetic figures and calendar names only (7 Nov 2026). */

const ledger = {
  total: 21300,
  count: 6,
  byMode: [{ mode: "cash", label: "Cash", amount: 15300, count: 4 }, { mode: "upi", label: "UPI", amount: 6000, count: 2 }],
  asOf: "2026-11-05T05:40:00Z",
};

describe("moneyFromLedger: the real session draws the rehearsal session's cards", () => {
  it("needs the session figures, and leaves the plain ledger tile without them", () => {
    expect(moneyFromLedger(ledger, "2026-11-05")).toBeNull();
    expect(moneyFromLedger({ ...ledger, session: null }, "2026-11-05")).toBeNull();
  });

  it("carries Fees' own figures into the shape One's reader gives", () => {
    const money = moneyFromLedger({ ...ledger, session: { expected: 3_120_000, collected: 1_860_000, dueSoFar: 1_934_000, followUps: 10, recentDays: [{ date: "2026-11-04", amount: 18000 }] } }, "2026-11-05")!;
    expect(money).toMatchObject({ today: 21300, receiptsToday: 6, expected: 3_120_000, collected: 1_860_000, dueSoFar: 1_934_000, followUps: 10, source: "fees", matrix: [] });
    expect(money.modes).toEqual([{ mode: "cash", amount: 15300, receipts: 4 }, { mode: "upi", amount: 6000, receipts: 2 }]);
    // Today's own total is the live one, never the trend's copy of it.
    expect(money.days).toEqual([{ date: "2026-11-04", amount: 18000 }, { date: "2026-11-05", amount: 21300 }]);
  });

  it("replaces a trend row for today with the live total", () => {
    const money = moneyFromLedger({ ...ledger, session: { expected: 1, collected: 0, dueSoFar: 0, followUps: 0, recentDays: [{ date: "2026-11-05", amount: 9000 }] } }, "2026-11-05")!;
    expect(money.days).toEqual([{ date: "2026-11-05", amount: 21300 }]);
  });

  it("says how far back the day series is known only when Fees sent a full list", () => {
    const fourteen = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10), amount: 1000 }));
    const full = moneyFromLedger({ ...ledger, session: { expected: 1, collected: 0, dueSoFar: 0, followUps: 0, recentDays: fourteen } }, "2026-11-05")!;
    expect(full.knownFrom).toBe("2026-10-20");
    const short = moneyFromLedger({ ...ledger, session: { expected: 1, collected: 0, dueSoFar: 0, followUps: 0, recentDays: fourteen.slice(0, 5) } }, "2026-11-05")!;
    expect(short.knownFrom).toBeNull();
  });
});

describe("knownSpan", () => {
  it("reaches back no further than the first known day", () => {
    expect(knownSpan("2026-11-05", null)).toBe(30);
    expect(knownSpan("2026-11-05", "2026-10-20")).toBe(17);
    expect(knownSpan("2026-11-05", "2026-11-05")).toBe(1);
    expect(knownSpan("2026-11-05", "2026-08-01")).toBe(30);
  });
});

describe("the Fees contract", () => {
  const base = { sessionLabel: "2026-27", asOf: "2026-11-05T05:40:00Z", asOfDate: "2026-11-05", date: "2026-11-05", totalCollected: 0, receiptCount: 0, byMode: [] };
  it("reads a payload without session figures (an older Fees) and one with them", () => {
    expect(bridgeTodaySummarySchema.parse(base).session).toBeUndefined();
    expect(bridgeTodaySummarySchema.parse({ ...base, session: null }).session).toBeNull();
    const session = { expected: 10, collected: 5, dueSoFar: 8, followUps: 2, recentDays: [{ date: "2026-11-04", amount: 5 }] };
    expect(bridgeTodaySummarySchema.parse({ ...base, session }).session).toEqual(session);
  });
});

describe("birthdayDates", () => {
  it("asks for exactly the dates of birth that fall today", () => {
    const dates = birthdayDates("2026-11-07", 2, 4);
    expect(dates).toEqual(["2022-11-07", "2023-11-07", "2024-11-07"]);
  });

  it("keeps a 29 February birthday on 28 February in an ordinary year", () => {
    expect(birthdayDates("2027-02-28", 2, 4)).toEqual(["2023-02-28", "2024-02-28", "2024-02-29", "2025-02-28"]);
    expect(birthdayDates("2028-02-28", 2, 4)).toEqual(["2024-02-28", "2025-02-28", "2026-02-28"]);
  });
});

const row = (day: string, kind: CalendarRow["kind"], en: string | null = null, hi: string | null = null): CalendarRow => ({ day, kind, en, hi });
// Diwali break 7–12 Nov 2026 (Sat–Thu), Sunday the 8th inside it carries a row like the rest.
const BREAK = ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map((d) => row(d, "vacation", "Diwali break", "दीपावली अवकाश"));

describe("closedSpell", () => {
  it("names the break and the day school opens again", () => {
    expect(closedSpell("2026-11-07", BREAK)).toEqual({ en: "Diwali break", hi: "दीपावली अवकाश", sunday: false, reopens: "2026-11-13" });
  });

  it("is null on an open day, including a Saturday", () => {
    expect(closedSpell("2026-11-14", BREAK)).toBeNull();
  });

  it("calls an unmarked Sunday a Sunday and opens on Monday", () => {
    expect(closedSpell("2026-11-15", BREAK)).toEqual({ en: null, hi: null, sunday: true, reopens: "2026-11-16" });
  });

  it("an instructional row opens a Sunday", () => {
    expect(closedSpell("2026-11-15", [row("2026-11-15", "instructional")])).toBeNull();
  });
});

describe("comingUp", () => {
  const rows = [...BREAK, row("2026-12-25", "holiday", "Christmas", "क्रिसमस"), row("2026-11-20", "exam", "Unit Test"), row("2026-11-21", "exam", "Unit Test")];
  const events = [{ title: "PTM", titleHi: null, startsOn: "2026-11-18", endsOn: "2026-11-18" }];

  it("reads a run of days with one name as one item, soonest first", () => {
    expect(comingUp("2026-11-02", rows, events)).toEqual([
      { from: "2026-11-07", to: "2026-11-12", kind: "vacation", en: "Diwali break", hi: "दीपावली अवकाश", inDays: 5 },
      { from: "2026-11-18", to: "2026-11-18", kind: "event", en: "PTM", hi: null, inDays: 16 },
      { from: "2026-11-20", to: "2026-11-21", kind: "exam", en: "Unit Test", hi: null, inDays: 18 },
    ]);
  });

  it("leaves out the spell already running today: the closed banner says it", () => {
    expect(comingUp("2026-11-07", rows, events).map((c) => c.en)).toEqual(["PTM", "Unit Test"]);
  });

  it("looks only three weeks ahead", () => {
    expect(comingUp("2026-11-25", rows, [])).toEqual([]);
    expect(comingUp("2026-12-10", rows, [], 14)).toEqual([]);
    expect(comingUp("2026-12-20", rows, []).map((c) => c.en)).toEqual(["Christmas"]);
  });
});

describe("firstName", () => {
  it("names a child the way staff say it", () => {
    expect(firstName("Test Anaya Sharma")).toBe("Test");
    expect(firstName("  Kabir ")).toBe("Kabir");
  });
});
