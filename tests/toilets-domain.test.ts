import { describe, expect, it } from "vitest";

import {
  addDays,
  buildWeek,
  checkSettings,
  checkToilet,
  cleanMissed,
  findGaps,
  isJpeg,
  isMonday,
  onListThatWeek,
  pagePath,
  recentWeeks,
  uploadableWeek,
  weekDays,
  weekRow,
  weekStartOf,
  type Chart,
  type Toilet,
} from "@/modules/toilets/domain/checks";

/*
 * Toilet checks (D-652): which week a day belongs to, when a chart is due and
 * late, what a missed list may name, and what a toilet or a check list may say.
 */

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const toilet = (n: number, patch: Partial<Toilet> = {}): Toilet => ({
  id: u(n), name: `Toilet ${n}`, place: null, usedBy: "all", position: n,
  createdAt: "2026-10-01T04:00:00Z", removedAt: null, updatedAt: "2026-10-01T04:00:00Z", ...patch,
});
const chart = (toiletId: string, weekStart: string, patch: Partial<Chart> = {}): Chart => ({
  id: u(500), toiletId, weekStart, pages: 1, missed: [], note: null, uploadedBy: u(900), uploadedByName: "Office One",
  storedAt: `${addDays(weekStart, 6)}T05:00:00Z`, ...patch,
});
const open = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;

// 17 Nov 2026 is a Tuesday; its week starts Monday 16 Nov.
const MON = "2026-11-16";

describe("weeks", () => {
  it("runs Monday to Saturday, and a Sunday belongs to the week just over", () => {
    expect(weekStartOf("2026-11-17")).toBe(MON);
    expect(weekStartOf("2026-11-16")).toBe(MON);
    expect(weekStartOf("2026-11-22")).toBe(MON);
    expect(weekStartOf("2026-11-23")).toBe("2026-11-23");
    expect(weekDays(MON)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(isMonday(MON)).toBe(true);
    expect(isMonday("2026-11-17")).toBe(false);
    expect(isMonday("16-11-2026")).toBe(false);
  });

  it("lists the last eight weeks, newest first", () => {
    const weeks = recentWeeks("2026-11-17");
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe(MON);
    expect(weeks[1]).toBe("2026-11-09");
  });

  it("takes an upload only for this week and the twelve before it", () => {
    expect(uploadableWeek(MON, "2026-11-17")).toBe(true);
    expect(uploadableWeek("2026-11-23", "2026-11-17")).toBe(false);
    expect(uploadableWeek(addDays(MON, -7 * 12), "2026-11-17")).toBe(true);
    expect(uploadableWeek(addDays(MON, -7 * 13), "2026-11-17")).toBe(false);
    expect(uploadableWeek("2026-11-17", "2026-11-17")).toBe(false);
    expect(uploadableWeek(42, "2026-11-17")).toBe(false);
  });
});

describe("a toilet's chart for a week", () => {
  const t = toilet(1);
  it("is being filled in until Saturday", () => {
    expect(weekRow({ toilet: t, weekStart: MON, chart: null, today: "2026-11-21", isOpen: open }).state).toBe("this_week");
  });
  it("is due on the Sunday and the Monday after", () => {
    expect(weekRow({ toilet: t, weekStart: MON, chart: null, today: "2026-11-22", isOpen: open }).state).toBe("due_today");
    expect(weekRow({ toilet: t, weekStart: MON, chart: null, today: "2026-11-23", isOpen: open }).state).toBe("due_today");
  });
  it("is late from Tuesday", () => {
    expect(weekRow({ toilet: t, weekStart: MON, chart: null, today: "2026-11-24", isOpen: open }).state).toBe("late");
  });
  it("is done once uploaded, and only open days' missed checks count", () => {
    const c = chart(t.id, MON, { missed: [{ day: "2026-11-17", slot: "morning" }, { day: "2026-11-18", slot: "afternoon" }] });
    const shut = (day: string) => open(day) && day !== "2026-11-18";
    const row = weekRow({ toilet: t, weekStart: MON, chart: c, today: "2026-11-24", isOpen: shut });
    expect(row.state).toBe("done");
    expect(row.missed).toEqual([{ day: "2026-11-17", slot: "morning" }]);
    expect(row.checks).toBe(10);
  });
  it("is not asked for in a week the school is shut", () => {
    expect(weekRow({ toilet: t, weekStart: MON, chart: null, today: "2026-12-01", isOpen: () => false }).state).toBe("closed");
  });
  it("is not owed before the toilet was added, or after it was removed", () => {
    expect(onListThatWeek(toilet(2, { createdAt: "2026-11-22T04:00:00Z" }), MON)).toBe(false);
    expect(onListThatWeek(toilet(2, { createdAt: "2026-11-18T04:00:00Z" }), MON)).toBe(true);
    expect(onListThatWeek(toilet(2, { removedAt: "2026-11-20T04:00:00Z" }), MON)).toBe(false);
    expect(onListThatWeek(toilet(2, { removedAt: "2026-11-23T04:00:00Z" }), MON)).toBe(true);
  });
});

describe("the week board and what is missing", () => {
  const a = toilet(1);
  const b = toilet(2);
  const gone = toilet(3, { removedAt: "2026-11-05T04:00:00Z" });

  it("counts the charts in and the checks missed", () => {
    const board = buildWeek({
      toilets: [b, a, gone],
      charts: [chart(a.id, "2026-11-09", { missed: [{ day: "2026-11-10", slot: "morning" }] })],
      weekStart: "2026-11-09",
      today: "2026-11-17",
      isOpen: open,
    });
    expect(board.rows.map((r) => r.toilet.id)).toEqual([a.id, b.id]);
    expect(board.uploaded).toBe(1);
    expect(board.expected).toBe(2);
    expect(board.missedChecks).toBe(1);
  });

  it("finds late charts, today's uploads and last week's missed checks", () => {
    const charts = recentWeeks("2026-11-23").slice(1).map((w, i) => chart(a.id, w, { id: u(600 + i), missed: i === 0 ? [{ day: addDays(w, 1), slot: "afternoon" }] : [] }));
    const gaps = findGaps({ toilets: [a, b], charts, today: "2026-11-23", isOpen: open });
    expect(gaps.dueToday.map((g) => [g.toilet.id, g.weekStart])).toEqual([[b.id, MON]]);
    // Toilet 1 owes this week's chart only later; toilet 2 never sent one.
    expect(gaps.late.every((g) => g.toilet.id === b.id)).toBe(true);
    expect(gaps.late.length).toBeGreaterThan(0);
    expect(gaps.missedLastWeek.map((g) => g.toilet.id)).toEqual([a.id]);
  });
});

describe("what may be saved", () => {
  it("a toilet needs a name and who uses it", () => {
    expect(checkToilet({ name: "  Boys,   ground floor ", place: "", usedBy: "boys" })).toEqual({ ok: true, value: { name: "Boys, ground floor", place: null, usedBy: "boys" } });
    expect(checkToilet({ name: "", place: "x".repeat(61), usedBy: "teachers" })).toEqual({ ok: false, fields: { name: "name_missing", place: "place_long", usedBy: "used_by" } });
  });

  it("check times run morning then afternoon, and the list has one to eight lines", () => {
    expect(checkSettings({ morningAt: "9:00", afternoonAt: "13:30", checklist: [{ en: "Floor clean", hi: "" }] })).toEqual({
      ok: true,
      value: { morningAt: "09:00", afternoonAt: "13:30", checklist: [{ en: "Floor clean", hi: "Floor clean" }] },
    });
    const bad = checkSettings({ morningAt: "14:00", afternoonAt: "13:00", checklist: [] });
    expect(bad).toEqual({ ok: false, fields: { afternoonAt: "times_order", checklist: "items_none" } });
    expect(checkSettings({ morningAt: "09:00", afternoonAt: "13:00", checklist: Array.from({ length: 9 }, () => ({ en: "x", hi: "x" })) }).ok).toBe(false);
  });

  it("a missed list names only open days of that week, once each", () => {
    expect(cleanMissed([{ day: "2026-11-18", slot: "afternoon" }, { day: "2026-11-17", slot: "morning" }], MON, open))
      .toEqual([{ day: "2026-11-17", slot: "morning" }, { day: "2026-11-18", slot: "afternoon" }]);
    expect(cleanMissed([], MON, open)).toEqual([]);
    expect(cleanMissed([{ day: "2026-11-17", slot: "morning" }, { day: "2026-11-17", slot: "morning" }], MON, open)).toBeNull();
    expect(cleanMissed([{ day: "2026-11-22", slot: "morning" }], MON, open)).toBeNull();
    expect(cleanMissed([{ day: "2026-11-18", slot: "night" }], MON, open)).toBeNull();
    expect(cleanMissed([{ day: "2026-11-18", slot: "morning" }], MON, (d) => d !== "2026-11-18")).toBeNull();
    expect(cleanMissed("all", MON)).toBeNull();
    expect(cleanMissed(Array.from({ length: 13 }, () => ({ day: "2026-11-17", slot: "morning" })), MON)).toBeNull();
  });

  it("a photo is a JPEG on its session's own path", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(pagePath({ sessionLabel: "TEST-2026-27", toiletId: u(1), weekStart: MON, chartId: u(2), page: 1 })).toBe(`TEST-2026-27/${u(1)}/${MON}/${u(2)}-1.jpg`);
  });
});
