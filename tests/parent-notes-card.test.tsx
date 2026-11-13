// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * Parents' notes on the class teacher's Today (D-598): each absence a parent
 * told Veer Patta AI about, with Leave, Absent and Not now; "Mark all" for the
 * morning's; and what was decided today, with Undo. Every name is made up.
 */

const state = vi.hoisted(() => ({ toast: vi.fn(), refresh: vi.fn(), decide: vi.fn(), undo: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/ui/face", () => ({ Face: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }) }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/app/(app)/inbox/parent-actions", () => ({ decideParentSuggestionsAction: state.decide, undoParentSuggestionsAction: state.undo }));

import { ParentNotesCard, type ParentNoteRow } from "@/vx/screens/parents/parent-notes-card";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const row = (id: string, name: string, decided: string | null = null): ParentNoteRow => ({
  id, studentId: null, childName: name, classLabel: "Class 6", line: { en: "Today · Sick · Class 6" }, words: decided ? null : "Has fever", practice: false, urgent: true,
  decided: decided ? { en: decided } : null,
});

let root: Root;
let host: HTMLDivElement;
const buttons = (label: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent === label);

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("lists each note with its buttons, and decides one as Leave from Today", async () => {
  state.decide.mockResolvedValue({ ok: true, decided: [A], refused: [], message: { en: "Leave noted for the register · Test Alpha" } });
  await act(async () => root.render(<ParentNotesCard via="teacher_home" waiting={[row(A, "Test Alpha")]} decided={[]} />));
  expect(host.textContent).toContain("Parents' notes");
  expect(host.textContent).toContain("Has fever");
  expect(host.textContent).toContain("1 waiting");
  expect(buttons("Mark all 1 as Leave")).toHaveLength(0);
  await act(async () => buttons("Mark Leave")[0].click());
  expect(state.decide).toHaveBeenCalledWith({ ids: [A], decision: "apply", mark: "leave", via: "teacher_home", kind: "absence", childName: "Test Alpha" });
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "ok", undoLabel: "Undo" }));
  expect(state.refresh).toHaveBeenCalled();
});

it("marks the morning's notes as Leave in one tap", async () => {
  state.decide.mockResolvedValue({ ok: true, decided: [A, B], refused: [], message: { en: "2 noted as Leave for the register" } });
  await act(async () => root.render(<ParentNotesCard via="teacher_home" waiting={[row(A, "Test Alpha"), row(B, "Test Beta")]} decided={[]} />));
  await act(async () => buttons("Mark all 2 as Leave")[0].click());
  expect(state.decide).toHaveBeenCalledWith({ ids: [A, B], decision: "apply", mark: "leave", via: "teacher_home", kind: "absence", childName: null });
});

it("says a refusal and leaves the note waiting", async () => {
  state.decide.mockResolvedValue({ ok: false, refused: [{ id: A, message: { en: "Its day has passed, so it no longer waits. Nothing was changed." } }], message: { en: "Its day has passed, so it no longer waits. Nothing was changed." } });
  await act(async () => root.render(<ParentNotesCard via="teacher_home" waiting={[row(A, "Test Alpha")]} decided={[]} />));
  await act(async () => buttons("Not now")[0].click());
  expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "dismiss" }));
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad", text: "Its day has passed, so it no longer waits. Nothing was changed." }));
  expect(buttons("Mark Leave")).toHaveLength(1);
});

it("shows what was decided today and by whom, each with Undo", async () => {
  state.undo.mockResolvedValue({ ok: true, undone: [C], refused: [], message: { en: "Undone · it waits for a decision again" } });
  await act(async () => root.render(<ParentNotesCard via="needs_you" waiting={[]} decided={[row(C, "Test Gamma", "Leave · Test Teacher · 9:10 am")]} decidedOnly />));
  expect(host.textContent).toContain("Decided today");
  expect(host.textContent).toContain("Leave · Test Teacher · 9:10 am");
  await act(async () => buttons("Undo")[0].click());
  expect(state.undo).toHaveBeenCalledWith({ ids: [C] });
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "info" }));
});

it("draws nothing on Needs you when nothing was decided today", async () => {
  await act(async () => root.render(<ParentNotesCard via="needs_you" waiting={[]} decided={[]} decidedOnly />));
  expect(host.textContent).toBe("");
});
