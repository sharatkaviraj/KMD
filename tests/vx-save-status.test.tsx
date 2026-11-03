// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Review U01: the one saving line. Synthetic words only. */
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (v: string | { en: string }) => (typeof v === "string" ? v : v.en) }) }));
vi.mock("@/vx/icons", () => ({ Ic: ({ n }: { n: string }) => <i data-icon={n} /> }));

import { SaveMark, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";

let root: Root;
let host: HTMLDivElement;
const line = () => host.querySelector<HTMLElement>(".vx-save")!;
async function show(node: React.ReactNode) {
  await act(async () => root.render(<>{node}</>));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SaveStatus", () => {
  it("keeps its live region and its height while idle, so the line appearing neither jumps nor goes unannounced", async () => {
    await show(<SaveStatus state={{ kind: "idle" }} />);
    expect(line().style.minHeight).toBe("20px");
    const region = host.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    await show(<SaveStatus state={{ kind: "saving" }} />);
    expect(host.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toContain("Saving…");
  });

  it("only the server's answer reads as saved", async () => {
    for (const state of [{ kind: "held" }, { kind: "saving" }, { kind: "saving", slow: true }, { kind: "failed" }] as SaveState[]) {
      await show(<SaveStatus state={state} />);
      expect(host.textContent).not.toMatch(/\bSaved\b/);
      expect(host.querySelector('[data-icon="check"]')).toBeNull();
    }
    await show(<SaveStatus state={{ kind: "saved" }} />);
    expect(host.textContent).toContain("Saved");
    expect(host.querySelector('[data-icon="check"]')).not.toBeNull();
  });

  it("says a slow save is still going and that pressing again will not save twice", async () => {
    await show(<SaveStatus state={{ kind: "saving", slow: true }} />);
    expect(host.textContent).toContain("Still saving — please wait. Pressing again will not save it twice.");
  });

  it("a failure is an alert with what happened, what to do next, and Try again that keeps focus on the line", async () => {
    const retry = vi.fn();
    await show(<SaveStatus state={{ kind: "failed", message: { en: "QA refused" }, next: { en: "QA next step" } }} onRetry={retry} />);
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Could not save · QA refused");
    expect(alert.textContent).toContain("QA next step");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    button.focus();
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(line());
  });

  it("does not offer Try again or Undo without a handler, nor take focus by itself", async () => {
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    await show(<SaveStatus state={{ kind: "failed" }} />);
    await show(<SaveStatus state={{ kind: "held" }} />);
    expect(host.querySelector("button")).toBeNull();
    expect(line().hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it("a held save offers Undo", async () => {
    const undo = vi.fn();
    await show(<SaveStatus state={{ kind: "held" }} onUndo={undo} />);
    expect(host.textContent).toContain("Will send in a moment");
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Undo")!.click());
    expect(undo).toHaveBeenCalledOnce();
  });

  it("on a TEST session the line says so; idle says nothing", async () => {
    await show(<SaveStatus state={{ kind: "idle" }} test />);
    expect(host.textContent).toBe("");
    await show(<SaveStatus state={{ kind: "saving" }} test />);
    expect(host.querySelector(".vx-save-test")?.textContent).toBe("TEST session");
  });

  it("takes a screen's own words and an optional removed confirmation", async () => {
    await show(<SaveStatus state={{ kind: "saving" }} words={{ saving: { en: "Sending…" } }} />);
    expect(host.textContent).toContain("Sending…");
    await show(<SaveStatus state={{ kind: "removed", detail: { en: "QA item" } }} />);
    expect(host.textContent).toContain("Saved and taken off the list · QA item");
  });

  it("a row that is not announced has no live region", async () => {
    await show(<SaveStatus state={{ kind: "saving" }} live={false} reserve={false} />);
    expect(host.querySelector('[role="status"], [role="alert"]')).toBeNull();
    expect(line().style.minHeight).toBe("");
  });

  it("SaveMark draws the batch's marks", async () => {
    await show(<><SaveMark kind="saving" /><SaveMark kind="saved" /><SaveMark kind="failed" /><SaveMark kind="idle" /></>);
    expect([...host.querySelectorAll("[data-icon]")].map((i) => i.getAttribute("data-icon"))).toEqual(["refresh", "check", "alert"]);
  });
});

describe("useSlowSave", () => {
  function Probe({ active }: { active: boolean }) {
    return <span>{useSlowSave(active) ? "slow" : "quick"}</span>;
  }
  it("turns slow after three seconds and starts fresh for the next save", async () => {
    vi.useFakeTimers();
    await show(<Probe active />);
    expect(host.textContent).toBe("quick");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(host.textContent).toBe("slow");
    await show(<Probe active={false} />);
    expect(host.textContent).toBe("quick");
    await show(<Probe active />);
    expect(host.textContent).toBe("quick");
  });
});
