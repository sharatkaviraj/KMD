// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxItem } from "@/vx/screens/admin/types";
const state = vi.hoisted(() => ({ toast: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => typeof v === "string" ? v : v.en }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }), Sheet: () => null }));
vi.mock("@/vx/ui/page", () => ({ TopBar: () => null, Split: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => <>{list}{detail}</> }));
vi.mock("@/vx/ui/controls", () => ({ ChipRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, IconTile: () => null, EmptyState: () => null,
  toneColors: () => ({ bg: "", fg: "" }),
}));
vi.mock("@/app/(app)/timetable/vx-actions", () => ({ decideLeaveAction: vi.fn() }));
vi.mock("@/app/(app)/receipts/office-command-actions", () => ({
  reverseFeesReceiptAction: vi.fn(), decideFeesRefundAction: vi.fn(), processFeesRefundAction: vi.fn(), checkFeesOfficeCommandAction: vi.fn(),
}));
import { InboxScreen } from "@/vx/screens/admin/inbox";
let root: Root; let host: HTMLDivElement;
const scope = { accountId: "qa-account", sessionLabel: "QA-2026", day: "2026-10-11" };
const item: InboxItem = { id: "qa-item", submissionIds: ["22222222-2222-4222-8222-222222222222"], type: "students", kind: "submission", at: null, urgent: false,
  badge: { en: "QA submission" }, title: { en: "QA child" }, sub: { en: "Absent to present" }, facts: [] };
const response = (ok = true) => ({ ok, json: async () => ({ ok }) }) as Response;
const body = (index = 0) => JSON.parse(String(vi.mocked(fetch).mock.calls[index][1]!.body));
async function render(next = scope, previewing = false) { await act(async () => root.render(<InboxScreen items={[item]} initial={item.id} previewing={previewing} unavailable={false} scope={next} />)); }
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const approveButton = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Accept")!;
async function approve() { expect(approveButton()).toBeDefined(); await act(async () => approveButton().click()); }
it("departure and an outstanding normal request carry the same scoped command", async () => {
  let resolve!: (v: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await approve(); await act(async () => { vi.advanceTimersByTime(6000); }); expect(fetch).toHaveBeenCalledOnce();
  await act(async () => { window.dispatchEvent(new Event("pagehide")); }); expect(fetch).toHaveBeenCalledTimes(2);
  expect(body(0)).toEqual(body(1)); expect(body(0).scope).toEqual(scope);
  expect(vi.mocked(fetch).mock.calls[1][1]!.keepalive).toBe(true);
  await act(async () => resolve(response()));
});
it("undo before sending removes the durable intent and prevents departure", async () => {
  await approve(); await act(async () => state.toast.mock.calls[0][0].undo());
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});
it("an acknowledged command is not sent again on departure", async () => {
  await approve(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).toHaveBeenCalledOnce(); expect(localStorage.length).toBe(0);
});
it("double-click creates one intent and sends one command", async () => {
  const button = approveButton(); await act(async () => { button.click(); button.click(); });
  expect(localStorage.length).toBe(1); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetch).toHaveBeenCalledOnce();
});
it("undo cannot erase an intent after transport started", async () => {
  let resolve!: (v: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await approve(); const undo = state.toast.mock.calls[0][0].undo;
  await act(async () => { vi.advanceTimersByTime(6000); undo(); });
  expect(localStorage.length).toBe(1); expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).attempted).toBe(true);
  await act(async () => resolve(response()));
});
it.each(["transport", "server refusal"])("retains %s for another departure with the same identity", async (failure) => {
  if (failure === "transport") vi.mocked(fetch).mockRejectedValueOnce(new Error("QA disconnected"));
  else vi.mocked(fetch).mockResolvedValueOnce(response(false));
  await approve(); await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(localStorage.length).toBe(1);
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(body(0).commandId).toBe(body(1).commandId);
});
it("repeated departure does not duplicate an outstanding keepalive", async () => {
  let resolve!: (v: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await approve(); await act(async () => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).toHaveBeenCalledOnce(); await act(async () => resolve(response()));
});
it("a lost normal response preserves the intent and offers a check without asserting no changes", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("QA offline")); await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(approveButton()).toBeDefined(); expect(localStorage.length).toBe(1);
  expect(state.toast.mock.calls.at(-1)![0].text).not.toMatch(/Nothing was changed/i);
});
it("a different button cannot silently retry the original uncertain decision", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("QA offline")); await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  const decline = [...host.querySelectorAll("button")].find(b => b.textContent === "Decline")!;
  await act(async () => decline.click()); expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem(localStorage.key(0)!)!).beacon.accept).toBe(true);
});
it("reload resumes an unacknowledged intent with its original command and no persisted names", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("QA offline")); await approve(); await act(async () => root.unmount());
  const pending = JSON.parse(localStorage.getItem(localStorage.key(0)!)!);
  expect(pending.beacon.commandId).toMatch(/^[0-9a-f-]{36}$/i); expect(JSON.stringify(pending)).not.toContain("QA child");
  root = createRoot(host); vi.mocked(fetch).mockResolvedValue(response()); await render();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(body(vi.mocked(fetch).mock.calls.length - 1).commandId).toBe(pending.beacon.commandId); expect(localStorage.length).toBe(0);
});
it.each(["account", "session", "day"])("does not replay the prior %s scope", async (field) => {
  vi.mocked(fetch).mockRejectedValue(new Error("QA offline")); await approve(); await act(async () => root.unmount());
  vi.mocked(fetch).mockClear(); root = createRoot(host);
  const next = { ...scope, ...(field === "account" ? { accountId: "qa-other" } : field === "session" ? { sessionLabel: "QA-other" } : { day: "2026-10-12" }) };
  await render(next); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(1);
});
it("storage refusal leaves the item visible and sends nothing", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QA quota"); });
  await approve(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetch).not.toHaveBeenCalled(); expect(approveButton()).toBeDefined();
});
it("online recovery retries the same decision after a lost response", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("QA offline")); await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event("online")); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(body(0).commandId).toBe(body(1).commandId);
});
it("preview never sends a persisted decision", async () => {
  await render(scope, true); await approve(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetch).not.toHaveBeenCalled();
});
it("Undo from another tab restores the item and cancels the local timer", async () => {
  await approve(); localStorage.clear();
  await act(async () => { window.dispatchEvent(new Event("storage")); await vi.advanceTimersByTimeAsync(6000); });
  expect(fetch).not.toHaveBeenCalled(); expect(approveButton()).toBeDefined();
});
it("a removed device copy cannot be resurrected by a timer without a storage event", async () => {
  await approve(); localStorage.clear();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0); expect(approveButton()).toBeDefined();
});
/* Review N02: never look done before the server confirms. */
const buttonNamed = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
const lines = () => [...host.querySelectorAll(".vx-save")].map(l => l.textContent ?? "");
it("keeps a held and then sending decision in the list, dimmed, with no tick and no success toast", async () => {
  let resolve!: (v: Response) => void; vi.mocked(fetch).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await approve();
  expect(host.textContent).toContain("QA child");
  expect(lines().some(l => l.includes("Will send in a moment"))).toBe(true);
  expect(host.querySelector(".vx-held")).not.toBeNull();
  expect(buttonNamed("Undo")).toBeDefined();
  expect(host.textContent).not.toMatch(/\bSaved\b/);
  const toast = state.toast.mock.calls[0][0];
  expect(toast.tone).toBe("info"); expect(toast.text).toContain("Will send in a moment");
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(lines().some(l => l.includes("Sending…"))).toBe(true);
  expect(buttonNamed("Undo")).toBeUndefined();
  expect(host.textContent).toContain("QA child"); expect(host.textContent).not.toMatch(/\bSaved\b/);
  await act(async () => resolve(response()));
});
it("removes the item only after the server confirms, with the tick first", async () => {
  await approve(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(localStorage.length).toBe(0);
  expect(host.textContent).toContain("QA child");
  expect(lines().some(l => l.includes("Saved"))).toBe(true);
  expect(state.refresh).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(host.querySelector(".vx-leave")).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(450); });
  expect(host.textContent).not.toContain("QA child");
  expect(host.textContent).toContain("Saved and taken off the list");
  expect(state.refresh).toHaveBeenCalledOnce();
});
it("a failure keeps the item and its buttons, says what happened and what to do, and Try again sends the same command", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("QA offline")); await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(host.textContent).toContain("QA child"); expect(approveButton()).toBeDefined();
  expect(host.querySelector(".vx-held")).toBeNull();
  const failure = lines().find(l => l.includes("Could not save · No answer"))!;
  expect(failure).toContain("Try again sends the same decision once more");
  expect(host.textContent).not.toMatch(/\bSaved\b/);
  expect(state.toast.mock.calls.at(-1)![0].tone).toBe("bad");
  await act(async () => { buttonNamed("Try again")!.click(); await vi.advanceTimersByTimeAsync(0); });
  expect(fetch).toHaveBeenCalledTimes(2); expect(body(1).commandId).toBe(body(0).commandId);
  await act(async () => { await vi.advanceTimersByTimeAsync(1350); });
  expect(host.textContent).not.toContain("QA child");
});
it("Undo on the item during the hold restores it fully and sends nothing", async () => {
  await approve();
  await act(async () => buttonNamed("Undo")!.click());
  expect(approveButton()).toBeDefined(); expect(host.querySelector(".vx-held")).toBeNull();
  expect(lines().join("")).toBe(""); expect(localStorage.length).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).not.toHaveBeenCalled(); expect(host.textContent).toContain("Absent to present");
});
it("on a TEST session the waiting line says it is TEST", async () => {
  await render({ ...scope, sessionLabel: "TEST-2026-27" }); await approve();
  expect(host.querySelector(".vx-save-test")?.textContent).toBe("TEST session");
});
it("older own decisions stay visible for review while another account's copies stay private", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("QA offline")); await approve(); await act(async () => root.unmount());
  root = createRoot(host); await render({ ...scope, day: "2026-10-12" });
  expect(host.textContent).toContain("Earlier decisions");
  const clear = [...host.querySelectorAll("button")].find(b => b.textContent === "Clear reviewed device copies");
  expect(clear).toBeDefined(); await act(async () => clear!.click()); expect(localStorage.length).toBe(0);
});
