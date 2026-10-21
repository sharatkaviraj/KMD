// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The register screen against the 20 Oct 2026 smoke run (synthetic data):
 * a kept change never shows under a green tick, a past day never says
 * "today", the parent WhatsApp switch keeps the teacher's answer, and a closed
 * day names its reason and offers the last open day.
 */

const state = vi.hoisted(() => ({ stored: new Map<string, unknown>(), save: vi.fn(), check: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/platform/drafts/use-durable-draft", () => ({ useOnline: () => true }));
vi.mock("@/platform/drafts/store", () => ({
  loadDraft: async (key: string) => state.stored.get(key) ?? null,
  saveDraft: async (key: string, value: unknown) => void state.stored.set(key, value),
  removeDraft: async (key: string) => void state.stored.delete(key),
}));
vi.mock("@/vx/screens/teach/actions", () => ({ saveRegisterVx: state.save, checkRegisterVx: state.check }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }), Bi: ({ en }: { en: string }) => <span>{en}</span> }));
vi.mock("@/vx/ui/overlays", () => ({
  useToast: () => ({ show: state.toast }),
  Sheet: ({ open, children, footer, title }: { open: boolean; children: React.ReactNode; footer: React.ReactNode; title: string }) => (open ? <section data-sheet={title}>{children}{footer}</section> : null),
}));
vi.mock("@/vx/screens/teach/ui/shared", () => ({
  HelpIcon: () => null,
  HelpSheet: () => null,
  LangSeg: () => null,
  DrawnTick: () => null,
  TchTop: ({ actions, title }: { actions?: React.ReactNode; title: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  useUrlState: (_key: string, initial: string | null) => React.useState(initial),
}));

import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import type { AttendData } from "@/vx/screens/teach/data";
import type { RegisterContext } from "@/modules/attendance/domain/register-day";
import { draftKey } from "@/platform/drafts/policy";

const classId = "00000000-0000-4000-8000-0000000000c1";
const kidA = "00000000-0000-4000-8000-0000000000a1";
const kidB = "00000000-0000-4000-8000-0000000000a2";
const ownerId = "qa-teacher";
const base = {
  kind: "class", sessionLabel: "QA", classId, classLabel: "Class 5", day: "2026-10-19", prevDay: "2026-10-17",
  choices: [], closed: false, canSave: true, canCorrect: true, isOwner: true, correctsAny: false, onBehalf: false, reason: null,
  roll: [
    { id: kidA, name: "Test Alpha", rollNo: null, admissionNo: "PENDING-SR-1", hint: null, gender: null, birthday: false },
    { id: kidB, name: "Test Beta", rollNo: null, admissionNo: null, hint: null, gender: null, birthday: false },
  ],
  registerId: null, revision: 0, saved: {}, yesterday: {}, receipt: null, queuedAlerts: [], alertWhen: { en: "from the school office" },
  month: "2026-10", monthMarks: [], closedDays: [],
} as unknown as AttendData;
const saved = { ...base, registerId: "r1", revision: 1, saved: { [kidA]: "present", [kidB]: "absent" }, receipt: { savedAt: "2026-10-19T17:32:00Z", actorName: "QA Teacher", revision: 1 } } as unknown as AttendData;
const ctx = (over: Partial<RegisterContext> = {}): RegisterContext => ({ today: "2026-10-20", closedWhy: null, lastOpen: null, holidays: {}, unmarked: [], others: [], ...over });

let root: Root;
let host: HTMLDivElement;
async function render(data: AttendData, context?: RegisterContext, sheet: string | null = null) {
  await act(async () => root.render(<TeachAttend data={data} ownerId={ownerId} initialSheet={sheet} initialView={null} school="QA School" context={context} />));
  await act(async () => undefined);
}
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? "").includes(t));
const sw = () => host.querySelector<HTMLButtonElement>('button[role="switch"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.stored.clear();
  state.save.mockReset();
  state.check.mockReset();
  state.toast.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a change kept on the phone (P1)", () => {
  it("reopens as an unsaved change, never as 'Attendance saved' with its numbers", async () => {
    state.stored.set(draftKey(ownerId, "QA", `attendance-vx/${classId}/2026-10-19`), { value: { marks: { [kidA]: "absent", [kidB]: "absent" }, revision: 1 } });
    await render(saved, ctx());
    expect(host.textContent).toContain("did not save it");
    expect(host.textContent).not.toContain("The office can see it now");
    expect(host.textContent).toContain("You are changing the attendance for Mon 19 Oct");
  });

  it("draws the saved card from what the office has", async () => {
    await render(saved, ctx());
    expect(host.textContent).toContain("Saved at 11:02 pm.");
    expect(host.textContent).toContain("Away: Test Beta");
    const tiles = [...host.querySelectorAll(".tc-ctile")].map((t) => t.textContent);
    expect(tiles).toEqual(["1Present", "1Absent", "0Half-day"]);
  });

  it("throws a kept change away when asked", async () => {
    const key = draftKey(ownerId, "QA", `attendance-vx/${classId}/2026-10-19`);
    state.stored.set(key, { value: { marks: { [kidA]: "absent" }, revision: 1 } });
    await render(saved, ctx());
    await act(async () => byText("Throw away")!.click());
    expect(state.stored.has(key)).toBe(false);
    expect(host.textContent).toContain("Saved at 11:02 pm.");
  });
});

describe("a past day is not today", () => {
  it("dates the sheet and the parent message", async () => {
    await render(base, ctx(), "save");
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    expect(host.textContent).toContain("This is the register for Mon 19 Oct, not today.");
    expect(host.textContent).toContain("Absent on Mon 19 Oct");
    expect(host.textContent).not.toContain("Absent today");
  });
});

describe("the parent WhatsApp switch", () => {
  it("is off for a past day's first save, and on for today's", async () => {
    await render(base, ctx(), "save");
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    expect(sw()!.getAttribute("aria-checked")).toBe("false");
    await act(async () => root.unmount());
    root = createRoot(host);
    state.stored.clear();
    await render(base, ctx({ today: "2026-10-19" }), "save");
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    expect(sw()!.getAttribute("aria-checked")).toBe("true");
  });

  it("stays off for a correction when no message was sent, and after the teacher turns it off", async () => {
    await render(saved, ctx({ today: "2026-10-19" }));
    await act(async () => byText("Change attendance")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    await act(async () => byText("Save changes")!.click());
    expect(sw()!.getAttribute("aria-checked")).toBe("false");
    await act(async () => sw()!.click());
    expect(sw()!.getAttribute("aria-checked")).toBe("true");
    await act(async () => sw()!.click());
    await act(async () => byText("Check again")!.click());
    await act(async () => byText("Save changes")!.click());
    expect(sw()!.getAttribute("aria-checked")).toBe("false");
  });

  it("cannot be flipped by a key press while the teacher is typing her note", async () => {
    await render(saved, ctx({ today: "2026-10-19" }));
    await act(async () => byText("Change attendance")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    await act(async () => byText("Save changes")!.click());
    const note = host.querySelector("textarea")!;
    await act(async () => note.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    // A keyboard-made click has detail 0.
    await act(async () => sw()!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(sw()!.getAttribute("aria-checked")).toBe("false");
  });

  it("says why Save changes waits", async () => {
    await render(saved, ctx({ today: "2026-10-19" }));
    await act(async () => byText("Change attendance")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    await act(async () => byText("Save changes")!.click());
    const footer = byText("Pick a reason first")!;
    expect(footer.disabled).toBe(true);
    await act(async () => byText("Came late")!.click());
    expect(byText("Save changes")).toBeTruthy();
  });
});

describe("the cards", () => {
  it("shows a number on every card and no placeholder SR", async () => {
    await render(base, ctx(), "save");
    const nums = [...host.querySelectorAll("button.tc-akid .num")].map((n) => n.textContent);
    expect(nums).toEqual(["1", "2"]);
    await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
    expect(host.textContent).toContain("No. 1");
    expect(host.textContent).not.toContain("PENDING");
  });

  it("undoes a wrong tap with one more tap, and offers half-day as its own button", async () => {
    await render(base, ctx());
    const card = () => host.querySelector<HTMLButtonElement>("button.tc-akid")!;
    await act(async () => card().click());
    expect(card().className).toMatch(/\ba\b/);
    await act(async () => byText("half-day instead")!.click());
    expect(card().className).toMatch(/\bh\b/);
    await act(async () => card().click());
    expect(card().className).toMatch(/\bp\b/);
  });
});

describe("a closed day", () => {
  it("names the holiday and offers the last open day", async () => {
    const closed = { ...base, day: "2026-10-20", closed: true, canSave: true } as unknown as AttendData;
    await render(closed, ctx({ closedWhy: { kind: "holiday", en: "Dussehra", hi: "दशहरा" }, lastOpen: { day: "2026-10-19", marked: false } }));
    expect(host.textContent).toContain("Today is a holiday — Dussehra");
    expect(host.textContent).not.toContain("or it has not come yet");
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent?.includes("Mark Mon 19 Oct (not marked)"));
    expect(link?.getAttribute("href")).toBe(`/teach/attendance?class=${classId}&day=2026-10-19`);
  });
});

describe("the class chooser", () => {
  it("says which classes are marked, and opens the last school day on a holiday", async () => {
    const { AttendChoose } = await import("@/vx/screens/teach/ui/attend");
    const c2 = "00000000-0000-4000-8000-0000000000c2";
    const c3 = "00000000-0000-4000-8000-0000000000c3";
    const data = { kind: "choose", choices: [{ classId: c2, classLabel: "Class 2" }, { classId: c3, classLabel: "Class 3" }], day: "2026-10-20" } as const;
    state.stored.set(draftKey(ownerId, "QA", `attendance-vx/${c3}/2026-10-19`), { value: { marks: { x: "absent" }, revision: 0 } });
    await act(async () =>
      root.render(
        <AttendChoose
          data={data as never}
          ownerId={ownerId}
          context={{ today: "2026-10-20", day: "2026-10-19", closedWhy: { kind: "holiday", en: "Dussehra", hi: "दशहरा" }, savedAt: { [c2]: "2026-10-19T03:22:00Z", [c3]: null }, sessionLabel: "QA" }}
        />,
      ),
    );
    await act(async () => undefined);
    expect(host.textContent).toContain("Today is a holiday — Dussehra");
    expect(host.textContent).toContain("Saved 8:52 am");
    expect(host.textContent).toContain("Not saved · 1 marked away");
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/teach/attendance?class=${c2}&day=2026-10-19`);
  });
});
