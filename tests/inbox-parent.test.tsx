// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { InboxItem } from "@/vx/screens/admin/types";

/*
 * A parent's suggestion in Needs you (D-598): decided at once with the button
 * that says what it does, never shown as done before the server answers, a
 * refusal kept with its reason, and the toast's Undo taking it back. Every
 * name and number is made up (rule 6).
 */

const state = vi.hoisted(() => ({ toast: vi.fn(), refresh: vi.fn(), decide: vi.fn(), undo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh, push: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/ui/face", () => ({ Face: ({ children }: { children: React.ReactNode }) => <span data-face>{children}</span> }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }), Sheet: () => null }));
vi.mock("@/vx/ui/page", () => ({ TopBar: () => null }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick, disabled, href }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; href?: string }) =>
    href ? <a href={href}>{children}</a> : <button disabled={disabled} onClick={onClick}>{children}</button>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  toneColors: () => ({ bg: "", fg: "" }),
}));
vi.mock("@/app/(app)/timetable/vx-actions", () => ({ decideLeaveAction: vi.fn() }));
vi.mock("@/app/(app)/inbox/parent-actions", () => ({ decideParentSuggestionsAction: state.decide, undoParentSuggestionsAction: state.undo }));
vi.mock("@/app/(app)/receipts/office-command-actions", () => ({
  reverseFeesReceiptAction: vi.fn(), decideFeesRefundAction: vi.fn(), processFeesRefundAction: vi.fn(), checkFeesOfficeCommandAction: vi.fn(),
}));

import { InboxScreen } from "@/vx/screens/admin/inbox";

const SICK = "11111111-1111-4111-8111-111111111111";
const AWAY = "22222222-2222-4222-8222-222222222222";
const PHONE = "33333333-3333-4333-8333-333333333333";
const scope = { accountId: "qa-account", sessionLabel: "TEST-2026-27", day: "2026-11-12" };

function absence(id: string, name: string): InboxItem {
  return {
    id: `parent:${id}`, type: "attendance", kind: "parent", at: "2026-11-12T02:00:00Z", urgent: true,
    badge: { en: "Parent" }, title: { en: `Parent says ${name} is sick` }, sub: { en: "Today · Sick · Class 6" }, facts: [],
    footnote: { en: "Leave or Absent is how the register starts the child." },
    parent: { suggestionId: id, kind: "absence", studentId: "44444444-4444-4444-8444-444444444444", childName: name, classLabel: "Class 6", words: "She has fever today", change: null, phone: null, practice: true },
  };
}
const record: InboxItem = {
  id: `parent:${PHONE}`, type: "students", kind: "parent", at: "2026-11-12T03:00:00Z", urgent: false,
  badge: { en: "Parent" }, title: { en: "Change guardian phone? · Test Gamma" }, sub: { en: "Guardian phone · Class 3" }, facts: [],
  parent: { suggestionId: PHONE, kind: "record", studentId: "55555555-5555-4555-8555-555555555555", childName: "Test Gamma", classLabel: "Class 3", words: null, change: { field: { en: "Guardian phone" }, was: "9000000001", becomes: "9876543210" }, phone: "+91 90000 00001", practice: false },
};

let root: Root;
let host: HTMLDivElement;
async function render(items: InboxItem[], previewing = false) {
  await act(async () => root.render(<InboxScreen items={items} initial={items[0]?.id ?? null} previewing={previewing} unavailable={false} scope={scope} />));
}
const buttons = (label: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent === label);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("shows what the parent said, side by side for a change, with the number to call", async () => {
  await render([absence(SICK, "Test Alpha"), record]);
  expect(host.textContent).toContain("She has fever today");
  expect(host.textContent).toContain("Practice");
  expect(host.textContent).toContain("9000000001");
  expect(host.textContent).toContain("9876543210");
  expect(host.querySelector('a[href="tel:+919000000001"]')).not.toBeNull();
  expect(buttons("Mark Leave").length).toBeGreaterThan(0);
  expect(buttons("Apply").length).toBeGreaterThan(0);
});

it("decides at once with the chosen mark, says so with Undo, and Undo asks the server to take it back", async () => {
  state.decide.mockResolvedValue({ ok: true, decided: [SICK], refused: [], message: { en: "Leave noted for the register · Test Alpha" } });
  state.undo.mockResolvedValue({ ok: true, undone: [SICK], refused: [], message: { en: "Undone · it waits for a decision again" } });
  await render([absence(SICK, "Test Alpha")]);
  await act(async () => buttons("Mark Leave")[0].click());
  expect(state.decide).toHaveBeenCalledWith({ ids: [SICK], decision: "apply", mark: "leave", via: "needs_you", kind: "absence", childName: "Test Alpha" });
  const shown = state.toast.mock.calls.at(-1)![0];
  expect(shown).toMatchObject({ text: "Leave noted for the register · Test Alpha", tone: "ok", undoLabel: "Undo" });
  await act(async () => { await shown.undo(); });
  expect(state.undo).toHaveBeenCalledWith({ ids: [SICK] });
  expect(state.refresh).toHaveBeenCalled();
});

it("keeps a refused one with its buttons and the server's reason", async () => {
  state.decide.mockResolvedValue({ ok: false, refused: [{ id: SICK, message: { en: "Someone has already decided this one." } }], message: { en: "Someone has already decided this one." } });
  await render([absence(SICK, "Test Alpha")]);
  await act(async () => buttons("Mark Absent")[0].click());
  expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({ ids: [SICK], decision: "apply", mark: "absent" }));
  expect(host.textContent).toContain("Someone has already decided this one.");
  expect(buttons("Mark Leave").length).toBeGreaterThan(0);
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad" }));
});

it("marks every absence shown as Leave in one tap, and leaves the record change alone", async () => {
  state.decide.mockResolvedValue({ ok: true, decided: [SICK, AWAY], refused: [], message: { en: "2 noted as Leave for the register" } });
  await render([absence(SICK, "Test Alpha"), absence(AWAY, "Test Beta"), record]);
  const all = buttons("Mark all 2 as Leave");
  expect(all.length).toBeGreaterThan(0);
  await act(async () => all[0].click());
  expect(state.decide).toHaveBeenCalledWith({ ids: [SICK, AWAY], decision: "apply", mark: "leave", via: "needs_you", kind: "absence", childName: null });
});

it("decides nothing while an admin only looks", async () => {
  await render([absence(SICK, "Test Alpha")], true);
  await act(async () => buttons("Not now")[0].click());
  expect(state.decide).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "info" }));
});
