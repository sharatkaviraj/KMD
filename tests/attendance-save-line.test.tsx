// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * Review U01 on the register's save sheet: one saving line under the title,
 * never "Saved" before the server answers, a failure that says what to do
 * next, and Try again that keeps the teacher's taps and search. Synthetic data.
 */
const state = vi.hoisted(() => ({ save: vi.fn(), check: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
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
  HelpIcon: () => null, HelpSheet: () => null, LangSeg: () => null, DrawnTick: () => null,
  TchTop: ({ actions }: { actions?: React.ReactNode }) => <header>{actions}</header>,
  useUrlState: (_key: string, initial: string | null) => React.useState(initial),
}));

import { TeachAttend } from "@/vx/screens/teach/ui/attend";
import type { AttendData } from "@/vx/screens/teach/data";

const classId = "00000000-0000-4000-8000-0000000000c1";
const kidA = "00000000-0000-4000-8000-0000000000a1";
const kidB = "00000000-0000-4000-8000-0000000000a2";
const data = (sessionLabel = "QA") => ({
  kind: "class", sessionLabel, classId, classLabel: "QA class", day: "2026-10-10", prevDay: "2026-10-09",
  choices: [], closed: false, canSave: true, canCorrect: true, isOwner: true, correctsAny: false, onBehalf: false, reason: null,
  roll: [
    { id: kidA, name: "Test Alpha", rollNo: "1", admissionNo: null, hint: null, gender: null, birthday: false },
    { id: kidB, name: "Test Beta", rollNo: "2", admissionNo: null, hint: null, gender: null, birthday: false },
  ],
  registerId: null, revision: 0, saved: {}, yesterday: {}, receipt: null, queuedAlerts: [], alertWhen: { en: "at 10 am" },
  month: "2026-10", monthMarks: [], closedDays: [],
}) as unknown as AttendData;

let root: Root;
let host: HTMLDivElement;
const sub = () => host.querySelector("[data-sub]")!;
const saveButton = () => [...host.querySelectorAll<HTMLButtonElement>("section[data-sheet] button")].find((b) => b.textContent === "Save attendance")!;
const marksSent = (call: number) => JSON.parse(state.save.mock.calls[call][0]).marks;

async function render(model: AttendData) {
  await act(async () => root.render(<TeachAttend data={model} ownerId="qa-teacher" initialSheet="save" initialView={null} school="QA School" />));
}
async function typeSearch(text: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { set.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.save.mockReset(); state.check.mockReset().mockResolvedValue(null); state.toast.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("says Saving, then Still saving, on a TEST session says TEST, and never says Saved before the answer", async () => {
  // Held open, then answered: React entangles later transitions with an action that never ends.
  let answer!: (value: unknown) => void;
  state.save.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  await render(data("TEST-2026-27"));
  // Idle: the day line, and an empty (but present) saving line.
  expect(sub().textContent).toContain("2 present");
  expect(sub().querySelector('[role="status"]')?.textContent).toBe("");
  await act(async () => saveButton().click());
  const line = sub().querySelector(".vx-save")!;
  expect(line.textContent).toContain("TEST session");
  expect(line.textContent).toContain("Saving…");
  expect(sub().textContent).not.toMatch(/\bSaved\b/);
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(line.textContent).toContain("Still saving — please wait. Pressing again will not save it twice.");
  expect(sub().textContent).not.toMatch(/\bSaved\b/);
  await act(async () => answer({ status: "refused", message: { en: "QA closed", hi: "" } }));
});

it("a save that comes back with an error stays in the sheet with what to do next; Try again keeps the taps and the search", async () => {
  state.save.mockResolvedValueOnce({ status: "error", message: { en: "QA database busy", hi: "" } });
  await render(data());
  await act(async () => host.querySelector<HTMLButtonElement>("button.tc-akid")!.click());
  await typeSearch("Test");
  await act(async () => saveButton().click());
  const alert = sub().querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Could not save · QA database busy");
  expect(alert.textContent).toContain("Your taps are still here.");
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("Test");

  state.save.mockResolvedValueOnce({ status: "refused", message: { en: "QA window closed", hi: "" } });
  await act(async () => [...sub().querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(marksSent(1)).toEqual(marksSent(0));
  expect(marksSent(1)).toContainEqual({ studentId: kidA, status: "absent" });
  expect(host.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("Test");
  // A refusal needs the office's register, not another try.
  expect(sub().textContent).toContain("Could not save · QA window closed");
  expect([...sub().querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(false);
});
