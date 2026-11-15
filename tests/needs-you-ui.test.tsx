// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { NeedsView } from "@/modules/needs-you/data/board";
import type { NeedItem } from "@/modules/needs-you/domain/types";
import type { InboxItem } from "@/vx/screens/admin/types";

/*
 * Needs you on screen (D-630..D-635): the strip on Today with the next job and
 * its own button, a to-do ticked where it is shown with Undo, the admin's queue
 * put in the AI's order only when the AI made one, and nothing asked or
 * written while only looking. Every name is made up (rule 6).
 */

const state = vi.hoisted(() => ({
  toast: vi.fn(),
  arrange: vi.fn(),
  ownDone: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/icons", () => ({ Ic: () => null }));
vi.mock("@/ui/feedback/cue", () => ({ cue: vi.fn() }));
vi.mock("@/ui/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/vx/ui/listen", () => ({ ListenButton: () => null }));
vi.mock("@/vx/ui/voice", () => ({ VoiceNote: () => null }));
vi.mock("@/vx/ui/face", () => ({ Face: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("@/vx/ui/overlays", () => ({ useToast: () => ({ show: state.toast }), Sheet: () => null }));
vi.mock("@/vx/ui/page", () => ({ TopBar: () => null }));
vi.mock("@/vx/ui/primitives", () => ({
  Btn: ({ children, onClick, disabled, href }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; href?: string }) =>
    href ? <a href={href}>{children}</a> : <button disabled={disabled} onClick={onClick}>{children}</button>,
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  IconTile: () => null,
  Ring: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  SuccessTick: () => null,
  toneColors: () => ({ bg: "", fg: "" }),
}));
vi.mock("@/app/(app)/needs/actions", () => ({
  addOwnNeedAction: vi.fn(),
  arrangeNeedsAction: state.arrange,
  cancelReminderAction: vi.fn(),
  ownDoneAction: state.ownDone,
  snoozeNeedAction: vi.fn(),
}));
vi.mock("@/vx/screens/teach/actions", () => ({ answerCoverVx: vi.fn() }));
vi.mock("@/app/(app)/timetable/vx-actions", () => ({ decideLeaveAction: vi.fn() }));
vi.mock("@/app/(app)/inbox/parent-actions", () => ({ decideParentSuggestionsAction: vi.fn(), undoParentSuggestionsAction: vi.fn() }));
vi.mock("@/app/(app)/receipts/office-command-actions", () => ({
  reverseFeesReceiptAction: vi.fn(), decideFeesRefundAction: vi.fn(), processFeesRefundAction: vi.fn(), checkFeesOfficeCommandAction: vi.fn(),
}));

import { InboxHead, NeedsHeadProvider } from "@/modules/needs-you/ui/inbox-head";
import { NeedsStrip } from "@/modules/needs-you/ui/strip";
import { InboxScreen } from "@/vx/screens/admin/inbox";

const NOW = "2026-11-15T05:00:00.000Z"; // 10:30 at the school

const job = (over: Partial<NeedItem> & { key: string }): NeedItem => ({
  kind: "attendance",
  title: { en: over.key },
  why: null,
  lane: "today",
  dueAt: null,
  lateMinutes: 0,
  startsInMinutes: null,
  peopleWaiting: 0,
  count: 1,
  effort: "medium",
  href: "/teach/attendance",
  act: { en: "Open" },
  canSnooze: true,
  ...over,
});

const view = (over: Partial<NeedsView> = {}): NeedsView => ({
  role: "teacher",
  day: "2026-11-15",
  nowIso: NOW,
  items: [],
  plan: null,
  done: [],
  mayAsk: false,
  readOnly: false,
  ...over,
});

let root: Root;
let host: HTMLDivElement;
async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label);

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

it("shows the next job on Today with its own button, and the way into the full list", async () => {
  await render(
    <NeedsStrip
      view={view({
        items: [
          job({ key: "att:6A", title: { en: "Mark attendance · Class 6A" }, lane: "now", lateMinutes: 20, act: { en: "Mark attendance" } }),
          job({ key: "marks:1", kind: "marks", title: { en: "Enter marks · Maths" } }),
        ],
      })}
    />,
  );
  expect(host.textContent).toContain("Mark attendance · Class 6A");
  expect(host.querySelector('a[href="/teach/attendance"]')?.textContent).toBe("Mark attendance");
  expect(host.querySelector('a[href="/needs"]')).not.toBeNull();
  expect(state.arrange).not.toHaveBeenCalled();
});

it("says plainly when nothing is waiting", async () => {
  await render(<NeedsStrip view={view()} />);
  expect(host.textContent).toContain("Nothing waiting on you right now");
});

it("asks the AI once the page is drawn, and never while only looking", async () => {
  state.arrange.mockResolvedValue({ ok: false });
  const items = [job({ key: "att:6A", title: { en: "Register · Class 6A" }, lane: "now" }), job({ key: "marks:1", title: { en: "Marks · Test Alpha" } })];
  await render(<NeedsStrip view={view({ items, mayAsk: true, readOnly: true })} />);
  expect(state.arrange).not.toHaveBeenCalled();
  await render(<NeedsStrip view={view({ items, mayAsk: true })} />);
  expect(state.arrange).toHaveBeenCalledTimes(1);
  // The AI is shown kinds and numbers under made-up ids; the keys only come back to One.
  const sent = state.arrange.mock.calls[0][0] as { facts: { input: unknown; ids: Record<string, string> } };
  expect(JSON.stringify(sent.facts.input)).not.toMatch(/6A|Alpha|att:|marks:/);
  expect(Object.values(sent.facts.ids).sort()).toEqual(["att:6A", "marks:1"]);
});

it("ticks a to-do of one's own where it is shown, with Undo", async () => {
  state.ownDone.mockResolvedValue({ ok: true, value: true });
  const own = job({ key: "own:9", kind: "own", title: { en: "Call the bus driver" }, quick: "own-done", ownId: "99999999-9999-4999-8999-999999999999", act: { en: "Done" }, effort: "quick" });
  await render(
    <NeedsHeadProvider view={view({ role: "admin", items: [own] })}>
      <InboxHead />
    </NeedsHeadProvider>,
  );
  expect(host.textContent).toContain("Call the bus driver");
  await act(async () => button("Done")!.click());
  expect(state.ownDone).toHaveBeenCalledWith({ id: own.ownId, done: true });
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ undoLabel: "Undo", tone: "ok" }));
  expect(host.textContent).toContain("Done today");
});

const inboxItem = (id: string, title: string): InboxItem => ({
  id, type: "attendance", kind: "leave", at: "2026-11-15T03:00:00Z", urgent: false,
  badge: { en: "Leave" }, title: { en: title }, sub: { en: "Today" }, facts: [],
});
const scope = { accountId: "qa-account", sessionLabel: "TEST-2026-27", day: "2026-11-15" };

it("puts the admin's queue in the AI's order only when the AI made one", async () => {
  const a = inboxItem("a", "Leave · Test Alpha");
  const b = inboxItem("b", "Leave · Test Beta");
  const jobs = [job({ key: "inbox:a", kind: "leave", canSnooze: false }), job({ key: "inbox:b", kind: "leave", canSnooze: false })];
  const screen = <InboxScreen items={[a, b]} initial={null} previewing={false} unavailable={false} scope={scope} head={<InboxHead />} />;

  await render(<NeedsHeadProvider view={view({ role: "admin", items: jobs })}>{screen}</NeedsHeadProvider>);
  let text = host.textContent ?? "";
  expect(text.indexOf("Test Alpha")).toBeLessThan(text.indexOf("Test Beta"));
  expect(text).not.toContain("Arranged by AI");

  await act(async () => root.unmount());
  root = createRoot(host);
  const plan = { order: ["inbox:b", "inbox:a"], reasons: { "inbox:b": "someone_waiting" as const }, source: "ai" as const };
  await render(<NeedsHeadProvider view={view({ role: "admin", items: jobs, plan })}>{screen}</NeedsHeadProvider>);
  text = host.textContent ?? "";
  expect(text.indexOf("Test Beta")).toBeLessThan(text.indexOf("Test Alpha"));
  expect(text).toContain("Arranged by AI");
  expect(text).toContain("My own to-dos");
});
