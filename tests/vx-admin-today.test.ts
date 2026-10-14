import { describe, expect, it } from "vitest";

import { dailySeries } from "@/vx/screens/admin/logic";
import { catchUp, dayPercent, dueColumns, kfmt, moneyChart, schoolWeek, weekBars } from "@/vx/screens/admin/today-logic";

/* The design's own sample day (Desktop.dc.html DAILY), 9 Sep – 8 Oct 2026. Synthetic. */
const DAILY = [24600, 31200, 27800, 41500, 0, 64200, 58900, 33400, 29700, 22100, 36800, 0, 38600, 26300, 19800, 24500, 21900, 33700, 0, 35200, 27600, 18400, 29300, 0, 31900, 0, 40700, 25800, 22600, 38400];
const TODAY = "2026-10-08";
const DAYS = DAILY.map((amount, i) => ({ date: new Date(Date.UTC(2026, 8, 9 + i)).toISOString().slice(0, 10), amount }));

describe("kfmt", () => {
  it("writes money the way the design's tiles and axes do", () => {
    expect(kfmt(0)).toBe("—");
    expect(kfmt(950)).toBe("₹950");
    expect(kfmt(4200)).toBe("₹4.2k");
    expect(kfmt(18600)).toBe("₹19k");
    expect(kfmt(52000)).toBe("₹52k");
    expect(kfmt(186000)).toBe("₹1.9L");
  });
});

describe("moneyChart", () => {
  const chart = moneyChart(dailySeries(DAYS, TODAY, 30), TODAY);

  it("averages every day in the range, empty ones included, as the design's summary does", () => {
    expect(chart.average).toBe(26830);
    expect(chart.best).toBe(64200);
    expect(chart.emptyDays).toBe(5);
  });

  it("tops the chart at the best day plus 8% and labels the grid from it", () => {
    expect(chart.bars.find((b) => b.amount === 64200)!.height).toBeCloseTo(100 / 1.08, 5);
    expect(chart.grid.map((g) => g.label)).toEqual(["₹17k", "₹35k", "₹52k"]);
  });

  it("labels the first bar with its month, every fourth day, and today", () => {
    expect(chart.bars[0].label).toBe("9 Sep");
    expect(chart.bars.filter((b) => b.showLabel).map((b) => b.label)).toEqual(["9 Sep", "13", "17", "21", "25", "29", "3", "7", "8"]);
    expect(chart.bars.at(-1)!.isToday).toBe(true);
    expect(chart.bars.find((b) => b.date === "2026-10-01")!.label).toBe("1 Oct");
  });

  it("labels every other day over 14 days", () => {
    const short = moneyChart(dailySeries(DAYS, TODAY, 14), TODAY);
    expect(short.bars).toHaveLength(14);
    expect(short.bars.filter((b) => b.showLabel)).toHaveLength(8);
  });

  it("draws an empty chart without a grid when nothing came in", () => {
    const none = moneyChart(dailySeries([], TODAY, 14), TODAY);
    expect(none.grid).toEqual([]);
    expect(none.bars.every((b) => b.height === 0)).toBe(true);
  });
});

describe("the school week", () => {
  it("runs Monday to Saturday, a Sunday belonging to the week before", () => {
    expect(schoolWeek(TODAY)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(schoolWeek("2026-10-11")[0]).toBe("2026-10-05");
  });

  it("takes today from the live board and leaves unmarked and later days as dashes", () => {
    const bars = weekBars(TODAY, [{ day: "2026-10-05", percent: 92 }, { day: "2026-10-06", percent: null }], 96);
    expect(bars.map((b) => b.percent)).toEqual([92, null, null, 96, null, null]);
    expect(bars.map((b) => b.isToday)).toEqual([false, false, false, true, false, false]);
    expect(bars[0].weekday).toBe(1);
  });

  it("counts half days at the school's credit and never a day with nothing marked", () => {
    expect(dayPercent({ present: 18, absent: 1, halfDay: 1 }, 0.5)).toBe(93);
    expect(dayPercent({ present: 0, absent: 0, halfDay: 0 })).toBeNull();
  });
});

describe("catchUp", () => {
  it("spreads the gap over the days left in the month, rounded up to ₹100", () => {
    expect(catchUp(74000, TODAY)).toEqual({ perDay: 3300, daysLeft: 23, month: 9 });
  });

  it("says nothing when on pace or on the month's last day", () => {
    expect(catchUp(0, TODAY)).toBeNull();
    expect(catchUp(5000, "2026-10-31")).toBeNull();
  });
});

describe("dueColumns", () => {
  const installments = ["Previous year", "Installment 1", "Installment 2", "Installment 3", "Installment 4"];
  const due = { "Installment 1": "2026-07-20", "Installment 2": "2026-09-20", "Installment 3": "2026-10-20", "Installment 4": "2027-01-20" };

  it("keeps the old balance and installments already past due, named by month", () => {
    const cols = dueColumns(installments, due, ["Previous year"], TODAY)!;
    expect(cols.map((c) => (c.carry ? "old" : c.label))).toEqual(["old", "Jul", "Sep"]);
  });

  it("leaves out an installment falling due today: it is not due yet (UI-74)", () => {
    expect(dueColumns(installments, due, [], "2026-09-20")!.map((c) => c.label)).toEqual(["Jul"]);
  });

  it("has no answer without due dates, rather than guessing", () => {
    expect(dueColumns(installments, undefined, [], TODAY)).toBeNull();
  });
});
