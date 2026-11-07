// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardTask } from "@/modules/teacher-tasks/domain/collect";
import { CW } from "@/modules/teacher-tasks/ui/collect-words";

/* Needs you · Teachers' work (D-520): three next steps over the asks. Synthetic data only. */

const calls = vi.hoisted(() => ({ queue: vi.fn(), record: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: calls.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/vx/ui/overlays", () => ({
  Sheet: ({ children, open, title }: { children: React.ReactNode; open: boolean; title: string }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null),
  useToast: () => ({ show: vi.fn() }),
}));
vi.mock("@/ui/feedback/cue", () => ({ cue: vi.fn() }));
vi.mock("@/app/(app)/teach/tasks/delivery-actions", () => ({ taskSendQueueAction: calls.queue, recordTaskSentAction: calls.record }));
vi.mock("@/app/(app)/teach/tasks/actions", () => ({ taskAssignmentContextAction: vi.fn(), previewTeacherTasksAction: vi.fn(), createTeacherTasksAction: vi.fn() }));

import { CollectBoard } from "@/modules/teacher-tasks/ui/collect-board";

const TODAY = "2026-11-09";
const never = { sent: false, remindedToday: false, check: false, lastAt: null, lastDay: null };
const task = (over: Partial<BoardTask>): BoardTask => ({
  id: "a", sourceKey: "task:a", kind: "collection", title: "Phone", teacherId: "teacher-a", teacherName: "Teacher A", dueDate: "2026-11-12",
  state: "waiting", expected: 4, answered: 0, rejected: 0, approved: 0, href: "/inbox?task=a", openedAt: null,
  createdAt: "2026-11-07T10:00:00.000Z", students: 4, group: "Class 5", told: never, ...over,
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label));

it("shows who needs a link, who needs a nudge and what came back, and opens the send list", async () => {
  const tasks = [
    task({ id: "a" }),
    task({ id: "b", teacherName: "Teacher B", told: { ...never, sent: true, lastDay: "2026-11-07" }, answered: 3, approved: 1 }),
  ];
  calls.queue.mockResolvedValue({ ok: true, today: TODAY, entries: [] });
  await act(async () => root.render(<CollectBoard tasks={tasks} today={TODAY} language="en" previewing={false} />));

  const tile = (label: string) => host.querySelector(`section[aria-label="${label}"]`)?.textContent ?? "";
  expect(tile(CW.toSendTitle.en)).toContain("1");
  expect(tile(CW.toRemindTitle.en)).toContain("1");
  expect(tile(CW.answersTitle.en)).toContain("2");
  // Every teacher is one row that opens their work; nothing is a table.
  expect(host.querySelector("table")).toBeNull();
  expect(host.querySelector('a[href="/inbox?view=collect&task=a"]')?.textContent).toContain(CW.step["not-sent"].en);
  expect(host.querySelector('a[href="/inbox?view=collect&task=b"]')?.textContent).toContain(CW.step.started.en);
  expect(host.querySelector('a[href="/collection/review"]')?.textContent).toContain(CW.check.en);

  await act(async () => button(CW.sendLinks.en)!.click());
  expect(host.querySelector(`[role=dialog][aria-label="${CW.sendTitle.en}"]`)).not.toBeNull();
  expect(calls.queue).toHaveBeenCalledWith("initial", ["a"]);
});

it("a preview shows the board but offers no sends", async () => {
  await act(async () => root.render(<CollectBoard tasks={[task({ id: "a" })]} today={TODAY} language="en" previewing />));
  expect(host.textContent).toContain(CW.preview.en);
  expect(button(CW.sendLinks.en)?.disabled).toBe(true);
});

it("no work yet says so and still offers Ask teachers", async () => {
  await act(async () => root.render(<CollectBoard tasks={[]} today={TODAY} language="en" previewing={false} />));
  expect(host.textContent).toContain(CW.noWorkTitle.en);
  expect(button(CW.ask.en)).toBeDefined();
});

it("a list that could not be read says so instead of an empty board", async () => {
  await act(async () => root.render(<CollectBoard tasks={null} today={TODAY} language="en" previewing={false} />));
  expect(host.textContent).toContain(CW.couldNotRead.en);
  expect(host.textContent).not.toContain(CW.noWorkTitle.en);
});
