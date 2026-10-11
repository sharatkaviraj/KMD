// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InboxItem } from "@/vx/screens/admin/types";

const state = vi.hoisted(() => ({ decide: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/(app)/inbox/actions", () => ({ decideSubmissionsVx: state.decide, assignCoverVx: vi.fn() }));
vi.mock("@/app/(app)/attendance/actions", () => ({ remindTeachersVx: vi.fn() }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => typeof v === "string" ? v : v.en }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }), Sheet: () => null }));
vi.mock("@/vx/ui/page", () => ({ TopBar: () => null, Split: ({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) => <>{list}{detail}</> }));
vi.mock("@/vx/ui/controls", () => ({ ChipRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, IconTile: () => null, EmptyState: () => null,
}));
import { InboxScreen } from "@/vx/screens/admin/inbox";

let root: Root;
let host: HTMLDivElement;
const item: InboxItem = { id: "qa-item", submissionIds: ["qa-submission"], type: "students", kind: "submission", at: null, urgent: false,
  badge: { en: "QA submission" }, title: { en: "QA child" }, sub: { en: "Phone number" }, facts: [] };
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<InboxScreen items={[item]} initial={item.id} previewing={false} unavailable={false} />));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
async function approve() {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Accept")!;
  expect(button).toBeDefined(); await act(async () => button.click());
}

it("pagehide still flushes a decision after the undo timer while its server response is outstanding", async () => {
  let resolve!: (value: { ok: boolean }) => void;
  state.decide.mockReturnValue(new Promise(r => { resolve = r; }));
  await approve();
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(state.decide).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("pagehide"));
  expect(fetch).toHaveBeenCalledWith("/api/inbox", expect.objectContaining({ keepalive: true,
    body: JSON.stringify({ kind: "submissions", submissionIds: ["qa-submission"], accept: true }) }));
  await act(async () => { resolve({ ok: true }); });
});
it("undo before sending prevents both the action and a departure flush", async () => {
  await approve();
  const toast = state.toast.mock.calls.at(-1)![0];
  await act(async () => toast.undo());
  await act(async () => { vi.advanceTimersByTime(6000); });
  window.dispatchEvent(new Event("pagehide"));
  expect(state.decide).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("an acknowledged decision is not sent again when leaving", async () => {
  state.decide.mockResolvedValue({ ok: true }); await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  window.dispatchEvent(new Event("pagehide")); expect(fetch).not.toHaveBeenCalled();
});

it("a double-click holds only one decision and one send", async () => {
  state.decide.mockResolvedValue({ ok: true });
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Accept")!;
  await act(async () => { button.click(); button.click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(state.decide).toHaveBeenCalledOnce();
  expect(state.toast).toHaveBeenCalledOnce();
});
it("undo is no longer offered as an effective reversal once sending starts", async () => {
  let resolve!: (value: { ok: boolean }) => void;
  state.decide.mockReturnValue(new Promise(r => { resolve = r; }));
  await approve();
  const toast = state.toast.mock.calls.at(-1)![0];
  await act(async () => { vi.advanceTimersByTime(6000); toast.undo(); });
  expect([...host.querySelectorAll("button")].some(b => b.textContent === "Accept")).toBe(false);
  window.dispatchEvent(new Event("pagehide"));
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => { resolve({ ok: true }); });
});
it.each(["transport", "server refusal"])("retains an unacknowledged departure after %s for a subsequent flush", async (failure) => {
  if (failure === "transport") vi.mocked(fetch).mockRejectedValueOnce(new Error("QA disconnected"));
  else vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ ok: false }) } as Response);
  await approve();
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  await act(async () => { window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state.decide).not.toHaveBeenCalled();
});
it("does not duplicate an outstanding keepalive request on repeated departure events", async () => {
  let resolve!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise(r => { resolve = r; }));
  await approve();
  await act(async () => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("pagehide")); });
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => { resolve({ ok: true, json: async () => ({ ok: true }) } as Response); });
});
it("restores a failed normal decision and does not assert that a lost response changed nothing", async () => {
  state.decide.mockRejectedValue(new Error("QA response lost"));
  await approve();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect([...host.querySelectorAll("button")].some(b => b.textContent === "Accept")).toBe(true);
  expect(state.toast.mock.calls.at(-1)![0].text).not.toMatch(/Nothing was changed/i);
});
