// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/*
 * Review U01 on the note composer's save bar: "Saving…" only while the note is
 * on its way, a refusal with Try again that keeps the child, the words and the
 * tags, and a lost answer that is never retried. Synthetic data only.
 */
const state = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en), sub: () => null, language: "en" }) }));
vi.mock("@/vx/screens/notes/actions", () => ({ createNoteAction: state.create, undoNoteAction: vi.fn() }));
vi.mock("@/vx/assist/note-assist", () => ({ NoteAssist: () => null }));
vi.mock("@/app/(app)/preferences/actions", () => ({ saveLanguageAction: vi.fn() }));

import { SaveBarLine, useComposer } from "@/vx/screens/notes/ui/compose";
import type { ChildChoice } from "@/vx/screens/notes/data";

const kid = { id: "00000000-0000-4000-8000-0000000000k1", name: "Test Kid", classId: "00000000-0000-4000-8000-0000000000c1", classLabel: "QA class", rollNo: "1", hint: null } as unknown as ChildChoice;
const viewer = { id: "qa-teacher", name: "QA Teacher", readsEveryClass: false, correctsAttendance: false, heldClassIds: [kid.classId], canWrite: true };

function Harness({ onSaved, testSession }: { onSaved: () => void; testSession?: boolean }) {
  const c = useComposer({ kids: [kid], notes: [], viewer, initialStudent: kid.id, initialStep: "add", lang: "en-IN", today: "2026-11-03", testSession, tags: ["studies"], ownerFor: () => "me" });
  return (
    <div>
      <button type="button" onClick={() => c.setBody("QA note words")}>type</button>
      <SaveBarLine c={c} onSaved={onSaved} idle="QA readers line" />
      <button type="button" disabled={c.pending || c.saveUncertain} onClick={() => c.save(onSaved)}>Save note</button>
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
const click = async (text: string) => act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.create.mockReset();
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("checks before it says Saving, and says Saving (with TEST) only while the note is on its way", async () => {
  let answer!: (value: unknown) => void;
  state.create.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const saved = vi.fn();
  await act(async () => root.render(<Harness onSaved={saved} testSession />));
  await click("Save note");
  // Nothing typed: a problem to fix, not a save.
  expect(state.create).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Speak or type the note first.");
  expect(host.querySelector(".vx-save")?.textContent).toBe("");
  await click("type");
  await click("Save note");
  const line = host.querySelector(".vx-save")!;
  expect(line.textContent).toContain("TEST session");
  expect(line.textContent).toContain("Saving…");
  expect(host.textContent).not.toMatch(/\bSaved\b/);
  await act(async () => answer({ ok: true, id: "qa-note-1" }));
  expect(saved).toHaveBeenCalledWith("qa-note-1", kid);
});

it("a refusal keeps the note and offers Try again with the same child, words and tags", async () => {
  state.create.mockResolvedValueOnce({ ok: false, error: { en: "QA refused" } }).mockResolvedValueOnce({ ok: true, id: "qa-note-2" });
  const saved = vi.fn();
  await act(async () => root.render(<Harness onSaved={saved} />));
  await click("type");
  await click("Save note");
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Could not save · QA refused");
  expect(alert.textContent).toContain("Your note, child and choices are still here.");
  expect(host.textContent).not.toContain("QA readers line");
  await click("Try again");
  expect(state.create).toHaveBeenCalledTimes(2);
  expect(state.create.mock.calls[1][0]).toEqual(state.create.mock.calls[0][0]);
  expect(state.create.mock.calls[1][0]).toMatchObject({ studentId: kid.id, body: "QA note words", tags: ["studies"] });
  expect(saved).toHaveBeenCalledWith("qa-note-2", kid);
});

it("a lost answer is not confirmed, offers no Try again, and blocks another save", async () => {
  state.create.mockRejectedValueOnce(new Error("QA lost answer"));
  await act(async () => root.render(<Harness onSaved={vi.fn()} />));
  await click("type");
  await click("Save note");
  const alert = host.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Not confirmed · We could not tell whether the note was saved");
  expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Try again")).toBe(false);
  expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Save note")!.disabled).toBe(true);
});
