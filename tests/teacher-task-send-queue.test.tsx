// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SendEntry } from "@/modules/teacher-tasks/domain/send-queue";
import { entryMessage } from "@/modules/teacher-tasks/domain/send-queue";
import { CW } from "@/modules/teacher-tasks/ui/collect-words";

/* The send list (D-521): one real WhatsApp link per teacher, noted on tap. Synthetic data only. */

const calls = vi.hoisted(() => ({ queue: vi.fn(), record: vi.fn(), cue: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/ui/feedback/cue", () => ({ cue: calls.cue }));
vi.mock("@/app/(app)/teach/tasks/delivery-actions", () => ({ taskSendQueueAction: calls.queue, recordTaskSentAction: calls.record }));

import { SendQueue } from "@/modules/teacher-tasks/ui/send-queue";

const TODAY = "2026-11-09";
const entry = (over: Partial<SendEntry>): SendEntry => ({
  taskId: "t1", teacherName: "Synthetic Teacher", mobile: "9000000001", language: "en", work: "collection", title: "Phone", group: "QA",
  due: "2026-11-12", students: 3, fields: [{ en: "Phone", hi: "फोन" }], answered: 0, expected: 3, url: "https://one.example/t/tasks/synthetic",
  blocked: null, done: false, opened: false, ...over,
});

let root: Root;
let host: HTMLDivElement;
const stopNavigation = (event: Event) => event.preventDefault();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.addEventListener("click", stopNavigation);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener("click", stopNavigation);
});

it("gives each teacher a real WhatsApp link and notes the send on tap", async () => {
  const first = entry({ taskId: "t1" });
  calls.queue.mockResolvedValue({ ok: true, today: TODAY, entries: [first, entry({ taskId: "t2", teacherName: "Second Teacher", mobile: null })] });
  calls.record.mockResolvedValue({ ok: true });
  const recorded = vi.fn();
  await act(async () => root.render(<SendQueue kind="initial" ids={["t1", "t2"]} language="en" onRecorded={recorded} />));

  expect(calls.queue).toHaveBeenCalledWith("initial", ["t1", "t2"]);
  const link = [...host.querySelectorAll("a")].find((a) => a.textContent?.includes(CW.sendOn.en))!;
  expect(link.getAttribute("href")).toBe(entryMessage(first, "initial", TODAY).href);
  expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/919000000001\?text=/);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(host.textContent).toContain(CW.next.en);
  // No usable mobile: said plainly, never a dead button.
  expect(host.textContent).toContain(CW.noMobile.en);

  await act(async () => link.click());
  expect(calls.record).toHaveBeenCalledWith("t1", "initial");
  expect(calls.cue).toHaveBeenCalledWith("done");
  expect(recorded).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain(CW.sentTick.en);
  expect(host.textContent).toContain(CW.allSent.en);
  expect(host.textContent).toContain(CW.sendAgain.en);
});

it("never offers a send that needs a person to check first", async () => {
  calls.queue.mockResolvedValue({ ok: true, today: TODAY, entries: [entry({ taskId: "t3", blocked: "check" })] });
  await act(async () => root.render(<SendQueue kind="reminder" ids={["t3"]} language="en" />));
  expect([...host.querySelectorAll("a")].some((a) => a.getAttribute("href")?.startsWith("https://wa.me/"))).toBe(false);
  expect(host.textContent).toContain(CW.blockedCheck.en);
  expect(host.querySelector('a[href="/inbox?view=collect&task=t3"]')).not.toBeNull();
});

it("says when the list could not load, and tries again on a tap", async () => {
  calls.queue.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, today: TODAY, entries: [] });
  await act(async () => root.render(<SendQueue kind="initial" ids={["t1"]} language="en" />));
  expect(host.textContent).toContain(CW.loadFailed.en);
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(CW.tryAgain.en))!.click());
  expect(calls.queue).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain(CW.nobody.en);
});

it("a note that did not save is said, and the board is not told to refresh", async () => {
  calls.queue.mockResolvedValue({ ok: true, today: TODAY, entries: [entry({ taskId: "t1" })] });
  calls.record.mockResolvedValue({ ok: false, reason: "changed" });
  const recorded = vi.fn();
  await act(async () => root.render(<SendQueue kind="reminder" ids={["t1"]} language="en" onRecorded={recorded} />));
  const link = [...host.querySelectorAll("a")].find((a) => a.textContent?.includes(CW.remindOn.en))!;
  await act(async () => link.click());
  expect(calls.record).toHaveBeenCalledWith("t1", "reminder");
  expect(recorded).not.toHaveBeenCalled();
  expect(host.textContent).toContain(CW.recordFailed.en);
});
