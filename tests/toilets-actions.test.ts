import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Toilet checks' server actions (D-652): who may change the toilets or send a
 * chart, and that a stale screen, a preview or a bad id never reaches the
 * write library. Every library below is a mock; nothing reaches a database.
 */

const m = vi.hoisted(() => ({
  permission: vi.fn(),
  preview: vi.fn(),
  session: vi.fn(),
  writable: vi.fn(),
  now: vi.fn(),
  read: vi.fn(),
  saveToilet: vi.fn(),
  removeToilet: vi.fn(),
  orderToilets: vi.fn(),
  saveSettings: vi.fn(),
  beginChart: vi.fn(),
  finishChart: vi.fn(),
  removeChart: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: m.session }));
vi.mock("@/modules/toilets/data/read", () => ({ readToilets: m.read }));
vi.mock("@/modules/toilets/data/writes", () => ({
  saveToilet: m.saveToilet, removeToilet: m.removeToilet, orderToilets: m.orderToilets, saveSettings: m.saveSettings,
  beginChart: m.beginChart, finishChart: m.finishChart, removeChart: m.removeChart,
}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: m.permission }));
vi.mock("@/platform/auth/qa-clock", () => ({ schoolNow: m.now }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertSessionWritable: m.writable }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: m.preview }));

import {
  beginChartAction,
  finishChartAction,
  orderToiletsAction,
  removeChartAction,
  saveSettingsAction,
  saveToiletAction,
} from "@/app/(app)/toilets/actions";
import { W } from "@/vx/screens/toilets/words";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = "TEST-2026-27";
const staff = { id: u(900), role: "office", email: "office@test.invalid" };
const MON = "2026-11-16";

beforeEach(() => {
  vi.clearAllMocks();
  m.permission.mockResolvedValue(staff);
  m.preview.mockResolvedValue(undefined);
  m.session.mockResolvedValue(SESSION);
  m.writable.mockResolvedValue(undefined);
  // Tuesday 17 Nov 2026, 11:00 in India.
  m.now.mockResolvedValue(new Date("2026-11-17T05:30:00Z"));
  m.read.mockResolvedValue({ ready: true, toilets: [], settings: null, charts: [], isOpen: (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 });
  m.saveToilet.mockResolvedValue({ ok: true, value: { id: u(1) } });
  m.orderToilets.mockResolvedValue({ ok: true, value: null });
  m.saveSettings.mockResolvedValue({ ok: true, value: null });
  m.beginChart.mockResolvedValue({ ok: true, value: { paths: ["a.jpg"], tokens: ["t"] } });
  m.finishChart.mockResolvedValue({ ok: true, value: { storedAt: "2026-11-17T05:31:00Z" } });
  m.removeChart.mockResolvedValue({ ok: true, value: null });
});

const writes = () =>
  [m.saveToilet, m.removeToilet, m.orderToilets, m.saveSettings, m.beginChart, m.finishChart, m.removeChart].reduce((n, f) => n + f.mock.calls.length, 0);

describe("who may do what", () => {
  it("changing the list needs toilets:manage", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    expect(await saveToiletAction({ session: SESSION, id: null, draft: { name: "Boys", place: "", usedBy: "boys" }, expected: null })).toEqual({ ok: false, message: W.answer.denied });
    expect(m.permission).toHaveBeenCalledWith("toilets:manage");
    expect(writes()).toBe(0);
  });

  it("sending a chart needs toilets:upload, and taking one off needs toilets:manage", async () => {
    await beginChartAction({ session: SESSION, chartId: u(5), toiletId: u(1), weekStart: MON, pages: 1 });
    expect(m.permission).toHaveBeenLastCalledWith("toilets:upload");
    await finishChartAction({ session: SESSION, chartId: u(5), weekStart: MON, missed: [], note: null });
    expect(m.permission).toHaveBeenLastCalledWith("toilets:upload");
    await removeChartAction({ session: SESSION, chartId: u(5) });
    expect(m.permission).toHaveBeenLastCalledWith("toilets:manage");
  });

  it("refuses a preview, another year's screen and a year this account may not write", async () => {
    m.preview.mockRejectedValueOnce(new Error("previewing"));
    expect(await saveSettingsAction({ session: SESSION, draft: { morningAt: "09:00", afternoonAt: "13:00", checklist: [{ en: "Floor", hi: "फ़र्श" }] } })).toEqual({ ok: false, message: W.answer.preview });
    m.session.mockResolvedValueOnce("2026-27");
    expect(await saveSettingsAction({ session: SESSION, draft: { morningAt: "09:00", afternoonAt: "13:00", checklist: [{ en: "Floor", hi: "फ़र्श" }] } })).toEqual({ ok: false, message: W.answer.session });
    m.writable.mockRejectedValueOnce(new Error("read only"));
    expect(await saveSettingsAction({ session: SESSION, draft: { morningAt: "09:00", afternoonAt: "13:00", checklist: [{ en: "Floor", hi: "फ़र्श" }] } })).toEqual({ ok: false, message: W.answer.session });
    expect(await saveSettingsAction({ session: "anything", draft: { morningAt: "09:00", afternoonAt: "13:00", checklist: [] } })).toEqual({ ok: false, message: W.answer.bad_request });
    expect(writes()).toBe(0);
  });
});

describe("what reaches the library", () => {
  it("a tidied toilet, or the boxes to fix", async () => {
    expect(await saveToiletAction({ session: SESSION, id: null, draft: { name: "  Girls  first floor ", place: "", usedBy: "girls" }, expected: null })).toMatchObject({ ok: true, id: u(1) });
    expect(m.saveToilet).toHaveBeenCalledWith(SESSION, staff.id, null, { name: "Girls first floor", place: null, usedBy: "girls" }, null);
    expect(await saveToiletAction({ session: SESSION, id: null, draft: { name: "", place: "", usedBy: "girls" }, expected: null })).toEqual({ ok: false, message: W.fixAbove, fields: { name: "name_missing" } });
    expect(await saveToiletAction({ session: SESSION, id: "not-an-id", draft: { name: "x", place: "", usedBy: "girls" }, expected: null })).toEqual({ ok: false, message: W.answer.bad_request });
    m.saveToilet.mockResolvedValueOnce({ ok: false, code: "duplicate" });
    expect(await saveToiletAction({ session: SESSION, id: null, draft: { name: "Boys", place: "", usedBy: "boys" }, expected: null })).toEqual({ ok: false, message: W.answer.duplicate, fields: { name: "duplicate" } });
    expect(m.revalidate).toHaveBeenCalledWith("/toilets");
  });

  it("an order with no repeats", async () => {
    expect(await orderToiletsAction({ session: SESSION, ids: [u(1), u(1)] })).toEqual({ ok: false, message: W.answer.bad_request });
    expect(await orderToiletsAction({ session: SESSION, ids: [u(2), u(1)] })).toMatchObject({ ok: true });
    expect(m.orderToilets).toHaveBeenCalledWith(SESSION, staff.id, [u(2), u(1)]);
  });

  it("a chart for this week or an earlier one, of one to four pages", async () => {
    expect(await beginChartAction({ session: SESSION, chartId: u(5), toiletId: u(1), weekStart: "2026-11-23", pages: 1 })).toEqual({ ok: false, message: W.answer.week });
    expect(await beginChartAction({ session: SESSION, chartId: u(5), toiletId: u(1), weekStart: "2026-11-17", pages: 1 })).toEqual({ ok: false, message: W.answer.week });
    expect(await beginChartAction({ session: SESSION, chartId: u(5), toiletId: u(1), weekStart: MON, pages: 5 })).toEqual({ ok: false, message: W.answer.bad_request });
    expect(writes()).toBe(0);
    expect(await beginChartAction({ session: SESSION, chartId: u(5), toiletId: u(1), weekStart: MON, pages: 2 })).toMatchObject({ ok: true, paths: ["a.jpg"], tokens: ["t"] });
    expect(m.beginChart).toHaveBeenCalledWith({ sessionLabel: SESSION, actorId: staff.id, chartId: u(5), toiletId: u(1), weekStart: MON, pages: 2 });
  });

  it("a missed list of open days only, and a short note", async () => {
    expect(await finishChartAction({ session: SESSION, chartId: u(5), weekStart: MON, missed: [{ day: "2026-11-22", slot: "morning" }], note: null })).toEqual({ ok: false, message: W.answer.bad_request });
    const done = await finishChartAction({ session: SESSION, chartId: u(5), weekStart: MON, missed: [{ day: "2026-11-17", slot: "afternoon" }], note: `  tap   leaking ${"x".repeat(400)}` });
    expect(done).toMatchObject({ ok: true, message: W.savedMissed(1), storedAt: "2026-11-17T05:31:00Z" });
    const call = m.finishChart.mock.calls[0][0];
    expect(call.missed).toEqual([{ day: "2026-11-17", slot: "afternoon" }]);
    expect(call.note.startsWith("tap leaking x")).toBe(true);
    expect(call.note.length).toBe(300);
    expect(m.revalidate).toHaveBeenCalledWith("/inbox");
  });
});
