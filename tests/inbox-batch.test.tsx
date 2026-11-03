// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Review N01/N02. Synthetic queue items only. */
const state = vi.hoisted(() => ({ leave: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/timetable/vx-actions", () => ({ decideLeaveAction: state.leave }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string }) => p.en }) }));

import { batchGroupOf, batchSummary, groupSelection } from "@/vx/screens/admin/inbox-batch-logic";
import { InboxBatch } from "@/vx/screens/admin/inbox-batch";
import type { InboxItem } from "@/vx/screens/admin/types";

const base = { at: "2026-11-03T04:00:00Z", urgent: false, badge: { en: "B" }, sub: { en: "Synthetic" }, body: { en: "" }, facts: [] } as unknown as InboxItem;
const item = (over: Partial<InboxItem>): InboxItem => ({ ...base, id: Math.random().toString(36).slice(2), title: { en: over.id ?? "Item" }, ...over }) as InboxItem;
const future = item({ id: "leave-future", kind: "leave", type: "timetable", leaveId: "l1", leavePast: false } as Partial<InboxItem>);
const past = item({ id: "leave-past", kind: "leave", type: "timetable", leaveId: "l2", leavePast: true } as Partial<InboxItem>);
const future2 = item({ id: "leave-future-2", kind: "leave", type: "timetable", leaveId: "l3", leavePast: false } as Partial<InboxItem>);
const review = item({ id: "review", kind: "submission", type: "students", submissionIds: ["s1"] } as Partial<InboxItem>);
const refund = item({ id: "refund", kind: "refund", type: "money" } as Partial<InboxItem>);
const cover = item({ id: "cover", kind: "cover", type: "timetable" } as Partial<InboxItem>);

describe("batch grouping", () => {
  it("never batches money or cover, and keeps future and past leave apart", () => {
    expect([future, past, review, refund, cover].map(batchGroupOf)).toEqual(["leave_future", "leave_past", "reviews", null, null]);
    const groups = groupSelection([future, past, review, refund], new Set(["leave-future", "leave-past", "refund"]));
    expect(groups.leave_future.map((i) => i.id)).toEqual(["leave-future"]);
    expect(groups.leave_past.map((i) => i.id)).toEqual(["leave-past"]);
    expect(groups.reviews).toEqual([]);
  });

  it("never folds a failure into success", () => {
    const summary = batchSummary(new Map([["a", { state: "done" }], ["b", { state: "failed", why: { en: "x" } }]] as const));
    expect(summary).toEqual(expect.objectContaining({ done: 1, failed: 1 }));
    expect(summary.line.en).toContain("1 could not be saved");
  });
});

describe("InboxBatch", () => {
  let root: Root; let host: HTMLDivElement; let layer: HTMLDivElement;
  const scope = { accountId: "qa", sessionLabel: "TEST-2026-27", day: "2026-11-03" };
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(text));
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.leave.mockReset(); state.refresh.mockReset();
    layer = document.createElement("div"); layer.id = "vx-layer"; document.body.append(layer);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); layer.remove(); vi.unstubAllGlobals(); });

  it("is not offered when fewer than two items can be batched", async () => {
    await act(async () => root.render(<InboxBatch items={[future, refund, cover]} scope={scope} previewing={false} onSettled={vi.fn()} />));
    expect(host.textContent).not.toContain("Decide several");
  });

  it("saves each picked item, settles only confirmed ones, and keeps a failure to retry", async () => {
    const settled = vi.fn();
    state.leave.mockResolvedValueOnce({ ok: true, message: { en: "ok" } }).mockResolvedValueOnce({ ok: false, message: { en: "Already decided" } });
    await act(async () => root.render(<InboxBatch items={[future, future2, past, refund]} scope={scope} previewing={false} onSettled={settled} />));
    await act(async () => button("Decide several")!.click());
    const group = layer.querySelector('section[aria-label="Leave requests"]')!;
    for (const box of group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => box.click());
    await act(async () => [...group.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Approve")!.click());
    expect(layer.textContent).toContain("Each teacher is marked away");
    await act(async () => button("Approve · 2")!.click());
    expect(state.leave.mock.calls.map(([input]) => input)).toEqual([{ id: "l1", approve: true }, { id: "l3", approve: true }]);
    expect(settled).toHaveBeenCalledWith(["leave-future"]);
    expect(layer.textContent).toContain("1 saved · 1 could not be saved");
    expect(layer.querySelector('[role="alert"]')?.textContent).toContain("Already decided");
    state.leave.mockResolvedValueOnce({ ok: true, message: { en: "ok" } });
    await act(async () => button("Try the failed ones again")!.click());
    expect(state.leave).toHaveBeenLastCalledWith({ id: "l3", approve: true });
    expect(settled).toHaveBeenLastCalledWith(["leave-future-2"]);
  });

  it("retries a review with the same command, so a lost answer is not saved twice", async () => {
    const review2 = item({ id: "review-2", kind: "submission", type: "students", submissionIds: ["s2"] } as Partial<InboxItem>);
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<InboxBatch items={[review, review2]} scope={scope} previewing={false} onSettled={vi.fn()} />));
    await act(async () => button("Decide several")!.click());
    await act(async () => button("Select all")!.click());
    await act(async () => [...layer.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Accept")!.click());
    await act(async () => button("Accept · 2")!.click());
    const first = JSON.parse(fetch.mock.calls[0][1].body).commandId;
    await act(async () => button("Try the failed ones again")!.click());
    expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).commandId).toBe(first);
  });
});
