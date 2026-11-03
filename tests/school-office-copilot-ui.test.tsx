// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ mark: vi.fn(), write: vi.fn() }));
vi.mock("@/app/(app)/school-office/returns/actions", () => ({ markCopilotRowAction: mock.mark }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ language: "en", tx: (p: { en: string } | string) => typeof p === "string" ? p : p.en, sub: () => null }) }));
import { PortalCopilot } from "@/vx/screens/school-office/copilot";

const rows = [1, 2, 3].map((n) => ({ key: `00000000-0000-4000-8000-00000000000${n}`, name: `Synthetic ${n}`, classLabel: "8 A", values: [`SYN-${n}`, `Synthetic ${n}`, "8 A"] }));
const headers = ["Admission / SR number", "Student name", "Class"];
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.mark.mockReset().mockImplementation(async (input: { state: "entered" | "mismatch"; note?: string }) => ({ ok: true, mark: { state: input.state, note: input.note ?? null, updatedAt: "2026-11-03T10:00:00Z" } }));
  mock.write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: mock.write }, configurable: true });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (marks = {}, canMark = true) => act(async () => root.render(<PortalCopilot batchId="00000000-0000-4000-8000-0000000000aa" title="Synthetic" headers={headers} rows={rows} marks={marks} canMark={canMark} />));
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(name) || b.getAttribute("aria-label")?.includes(name))!;
const key = (k: string) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: k })); });

it("opens at the first row nobody marked and says it never submits", async () => {
  await render({ [rows[0].key]: { state: "entered", note: null, updatedAt: "x" } });
  expect(host.textContent).toContain("Student 2 of 3");
  expect(host.textContent).toContain("One never logs in or submits");
  expect(host.textContent).toContain("1 / 3");
});
it("copies one field by tap and by number key, and a whole row tab-separated", async () => {
  await render();
  await act(async () => button("Copy Student name").click());
  expect(mock.write).toHaveBeenLastCalledWith("Synthetic 1");
  expect(host.textContent).toContain("Copied");
  await key("1");
  expect(mock.write).toHaveBeenLastCalledWith("SYN-1");
  await act(async () => button("Copy row").click());
  expect(mock.write).toHaveBeenLastCalledWith("SYN-1\tSynthetic 1\t8 A");
});
it("marks entered and moves to the next row; J and K move without marking", async () => {
  await render();
  await act(async () => button("Mark entered").click());
  expect(mock.mark).toHaveBeenCalledWith({ batchId: "00000000-0000-4000-8000-0000000000aa", rowKey: rows[0].key, state: "entered" });
  expect(host.textContent).toContain("Student 2 of 3");
  await key("j"); expect(host.textContent).toContain("Student 3 of 3");
  await key("k"); await key("ArrowLeft"); expect(host.textContent).toContain("Student 1 of 3");
  expect(mock.mark).toHaveBeenCalledTimes(1);
});
it("records a mismatch only with a note, and keeps the row on failure", async () => {
  await render();
  await act(async () => button("Mismatch").click());
  const save = button("Save mismatch");
  expect(save.disabled).toBe(true);
  const textarea = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Portal shows a different class"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  // Typing J in the note is a letter, not "next".
  await act(async () => { textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })); });
  expect(host.textContent).toContain("Student 1 of 3");
  mock.mark.mockResolvedValueOnce({ ok: false });
  await act(async () => button("Save mismatch").click());
  expect(host.textContent).toContain("Didn't save");
  await act(async () => button("Save mismatch").click());
  expect(mock.mark).toHaveBeenLastCalledWith(expect.objectContaining({ state: "mismatch", note: "Portal shows a different class" }));
  expect(host.textContent).toContain("Student 1 of 3");
});
it("is view-only without permission to mark", async () => {
  await render({}, false);
  expect(button("Mark entered").disabled).toBe(true);
  expect(host.textContent).toContain("View only");
});
