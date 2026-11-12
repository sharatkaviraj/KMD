// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * Sick-day notes on the register (D-588): a child whose parent told the
 * school on WhatsApp starts as Absent with "Parent informed" beside the name,
 * the teacher can still change it, and no absent WhatsApp is offered for that
 * family. Synthetic data.
 */
const state = vi.hoisted(() => ({ save: vi.fn(), check: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/platform/drafts/use-durable-draft", () => ({ useOnline: () => true }));
vi.mock("@/platform/drafts/store", () => ({ loadDraft: async () => null, saveDraft: async () => undefined, removeDraft: async () => undefined }));
vi.mock("@/vx/screens/teach/actions", () => ({ saveRegisterVx: state.save, checkRegisterVx: state.check }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string } | string) => (typeof p === "string" ? p : p.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/shell/sidebar", () => ({ LangButton: () => null }));
vi.mock("@/vx/ui/overlays", () => ({
  useToast: () => ({ show: state.toast }),
  Sheet: ({ open, children, footer, sub }: { open: boolean; children: React.ReactNode; footer: React.ReactNode; sub?: React.ReactNode }) =>
    open ? <section data-sheet><p data-sub>{sub}</p>{children}{footer}</section> : null,
}));
vi.mock("@/vx/screens/teach/ui/shared", () => ({
  DeskHelp: () => null, HelpIcon: () => null, HelpSheet: () => null, LangSeg: () => null, DrawnTick: () => null,
  TchTop: ({ actions }: { actions?: React.ReactNode }) => <header>{actions}</header>,
  useUrlState: (_key: string, initial: string | null) => React.useState(initial),
}));

import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import type { AttendData } from "@/vx/screens/teach/data";

const classId = "00000000-0000-4000-8000-0000000000c1";
const kidA = "00000000-0000-4000-8000-0000000000a1";
const kidB = "00000000-0000-4000-8000-0000000000a2";
const TOLD = "No absent message goes to a parent who told the school on WhatsApp.";
const data = (over: Record<string, unknown> = {}) => ({
  kind: "class", sessionLabel: "TEST-2026-27", classId, classLabel: "QA class", day: "2026-10-10", prevDay: "2026-10-09",
  choices: [], closed: false, canSave: true, canCorrect: true, isOwner: true, correctsAny: false, onBehalf: false, reason: null,
  informedNote: { en: TOLD, hi: "" },
  roll: [
    { id: kidA, name: "Test Alpha", rollNo: "1", admissionNo: null, hint: null, gender: null, birthday: false, informed: { en: "Parent informed · sick", hi: "" } },
    { id: kidB, name: "Test Beta", rollNo: "2", admissionNo: null, hint: null, gender: null, birthday: false },
  ],
  registerId: null, revision: 0, saved: {}, yesterday: {}, receipt: null, parentAlerts: "ask_on", queuedAlerts: [], alertWhen: { en: "at 10 am" },
  month: "2026-10", monthMarks: [], closedDays: [],
  ...over,
}) as unknown as AttendData;

let root: Root;
let host: HTMLDivElement;
const card = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button.tc-akid")].find((b) => b.getAttribute("aria-label")?.startsWith(name))!;
const sheet = () => host.querySelector("section[data-sheet]")!;
const alertSwitch = () => sheet().querySelector<HTMLButtonElement>('button[role="switch"]');
const saveButton = () => [...host.querySelectorAll<HTMLButtonElement>("section[data-sheet] button")].find((b) => b.textContent === "Save attendance")!;

async function render(model: AttendData) {
  await act(async () => root.render(<TeachAttend data={model} ownerId="qa-teacher" initialSheet="save" initialView={null} school="QA School" />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.save.mockReset(); state.check.mockReset().mockResolvedValue(null); state.toast.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("starts the informed child as Absent, says why, and offers no absent WhatsApp for that family", async () => {
  await render(data());
  expect(card("Test Alpha").getAttribute("aria-pressed")).toBe("true");
  expect(card("Test Alpha").getAttribute("aria-label")).toContain("Parent informed · sick");
  expect(card("Test Beta").getAttribute("aria-pressed")).toBe("false");
  expect(card("Test Beta").getAttribute("aria-label")).not.toContain("Parent informed");
  expect(sheet().textContent).toContain("Parent informed · sick");
  expect(alertSwitch()).toBeNull();
  expect(sheet().textContent).toContain(TOLD);
  state.save.mockResolvedValueOnce({ status: "refused", message: { en: "QA closed", hi: "" } });
  await act(async () => saveButton().click());
  expect(JSON.parse(state.save.mock.calls[0][0]).marks).toEqual([
    { studentId: kidA, status: "absent" },
    { studentId: kidB, status: "present" },
  ]);
});

it("offers the WhatsApp only for the child whose parent did not tell the school", async () => {
  await render(data());
  await act(async () => card("Test Beta").click());
  expect(card("Test Beta").getAttribute("aria-pressed")).toBe("true");
  expect(alertSwitch()).not.toBeNull();
  expect(alertSwitch()!.textContent).toContain("1 parent ·");
  expect(sheet().textContent).toContain(TOLD);
});

it("lets the teacher mark the informed child present, and then says nothing about the note in the sheet", async () => {
  await render(data());
  // Absent → half day → present, the register's own cycle.
  for (let tap = 0; tap < 4 && card("Test Alpha").getAttribute("aria-pressed") === "true"; tap += 1) {
    await act(async () => card("Test Alpha").click());
  }
  expect(card("Test Alpha").getAttribute("aria-pressed")).toBe("false");
  expect(sheet().textContent).not.toContain(TOLD);
});

it("keeps what was saved over the note: a saved Present stays Present, and the saved card names who was away", async () => {
  await render(data({ registerId: "qa-register", revision: 1, saved: { [kidA]: "present", [kidB]: "absent" }, receipt: { savedAt: "2026-10-10T03:00:00Z", actorName: "QA", revision: 1 } }));
  expect(host.textContent).toContain("Away: Test Beta");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Change attendance")!.click());
  expect(card("Test Alpha").getAttribute("aria-pressed")).toBe("false");
  expect(card("Test Beta").getAttribute("aria-pressed")).toBe("true");
});

it("names the informed child on the saved card with the parent's word", async () => {
  await render(data({ registerId: "qa-register", revision: 1, saved: { [kidA]: "absent", [kidB]: "present" }, receipt: { savedAt: "2026-10-10T03:00:00Z", actorName: "QA", revision: 1 } }));
  expect(host.textContent).toContain("Away: Test Alpha (Parent informed · sick)");
});

it("shows nothing new for a class with no note", async () => {
  await render(data({ informedNote: undefined, roll: [{ id: kidB, name: "Test Beta", rollNo: "2", admissionNo: null, hint: null, gender: null, birthday: false }] }));
  expect(card("Test Beta").getAttribute("aria-pressed")).toBe("false");
  expect(host.textContent).not.toContain("Parent informed");
  expect(host.textContent).not.toContain(TOLD);
});
