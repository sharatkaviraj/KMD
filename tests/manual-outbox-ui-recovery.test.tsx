// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OutboxData } from "@/vx/screens/messages/outbox-data";
const state = vi.hoisted(() => ({ send: vi.fn(), toast: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/app/(app)/messages/outbox-actions", () => ({ sendByHandAction: state.send, undoSentAction: vi.fn(), approveCalendarNoticeAction: vi.fn(), declineCalendarNoticeAction: vi.fn(), prepareReminderBatchAction: vi.fn() }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => typeof v === "string" ? v : v.en }) }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }) }));
vi.mock("@/vx/ui/page", () => ({ Banner: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Section: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/vx/ui/controls", () => ({ SearchBox: () => null }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, CardHead: () => null, EmptyState: () => null,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>, SecHead: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
import { Outbox } from "@/vx/screens/messages/outbox";
const ID = "11111111-1111-4111-8111-111111111111";
const data: OutboxData = { notices: [], batches: [], more: 0, outOfDate: [], repeats: 0, items: [{ source: "queue", id: ID, name: "QA parent", about: "QA child", group: "QA messages", groupLabel: { en: "QA messages" }, forDay: null, phone: "98765 **210", preview: "Synthetic QA notice", status: "queued", sentAt: null, canUndo: false, blocked: false, queuedAt: "2026-10-10T10:00:00Z" }] };
let root: Root; let host: HTMLDivElement;
const popup = { closed: false, location: { href: "about:blank" }, close: vi.fn() };
beforeEach(async () => {
  vi.clearAllMocks(); popup.closed = false; popup.location.href = "about:blank";
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  state.send.mockImplementation(async (input) => input.confirmed ? { ok: true, message: { en: "Marked sent by you" } } : { ok: true, link: "https://qa.invalid/handoff", message: { en: "Confirm after sending" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Outbox data={data} tabs={null} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const button = (name: string) => [...host.querySelectorAll("button")].find(b => b.textContent === name)!;
it("prepares a handoff and requires a second explicit confirmation", async () => {
  await act(async () => button("Open WhatsApp").click());
  expect(state.send).toHaveBeenCalledWith({ source: "queue", id: ID }); expect(popup.location.href).toBe("https://qa.invalid/handoff");
  expect(state.refresh).not.toHaveBeenCalled(); expect(button("I sent it")).toBeDefined();
  await act(async () => button("I sent it").click());
  expect(state.send).toHaveBeenLastCalledWith({ source: "queue", id: ID, confirmed: true }); expect(state.refresh).toHaveBeenCalledOnce(); expect(window.open).toHaveBeenCalledOnce();
});
it.each(["blocked", "closed"])("a %s popup never records a send or navigates the app away", async (mode) => {
  if (mode === "blocked") vi.mocked(window.open).mockReturnValue(null); else popup.closed = true;
  await act(async () => button("Open WhatsApp").click());
  expect(state.send).toHaveBeenCalledOnce(); expect(state.send.mock.calls[0][0].confirmed).toBeUndefined();
  expect(popup.location.href).toBe("about:blank"); expect(host.querySelector('a[href="https://qa.invalid/handoff"]')).not.toBeNull(); expect(state.refresh).not.toHaveBeenCalled();
});
it("keeping a prepared message in To send performs no status change", async () => {
  await act(async () => button("Open WhatsApp").click());
  await act(async () => button("Keep in To send").click());
  expect(state.send).toHaveBeenCalledOnce(); expect(button("Open WhatsApp")).toBeDefined(); expect(state.refresh).not.toHaveBeenCalled();
});
it("a failed preparation closes the blank tab and restores the action", async () => {
  state.send.mockRejectedValueOnce(new Error("QA dependency unavailable"));
  await act(async () => button("Open WhatsApp").click());
  expect(popup.close).toHaveBeenCalledOnce(); expect(button("Open WhatsApp").disabled).toBe(false); expect(state.refresh).not.toHaveBeenCalled();
  expect(state.toast.mock.calls.at(-1)![0].text).toMatch(/not sure that went through/i);
});
it("a refused confirmation keeps the handoff available without a false sent toast", async () => {
  await act(async () => button("Open WhatsApp").click());
  state.send.mockResolvedValueOnce({ ok: false, message: { en: "QA stale message" } });
  await act(async () => button("I sent it").click());
  expect(button("I sent it")).toBeDefined(); expect(state.refresh).not.toHaveBeenCalled(); expect(state.toast.mock.calls.at(-1)![0].tone).toBe("bad");
});
it("a double click opens and prepares only one handoff", async () => {
  const open = button("Open WhatsApp"); await act(async () => { open.click(); open.click(); });
  expect(state.send).toHaveBeenCalledOnce(); expect(window.open).toHaveBeenCalledOnce();
});
