// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/ui/primitives/sheet";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key === "close" ? "Close" : key }));

let root: Root;
let host: HTMLDivElement;
function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => (element as HTMLElement).click());
}
function escape() { act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); }
function dialog(name: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(element => {
    const label = element.getAttribute("aria-labelledby");
    return label && document.getElementById(label)?.textContent === name;
  });
}
function Demo({ simultaneous = false }: { simultaneous?: boolean }) {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return <>
    <main className="mobile-app-main"><button id="trigger" onClick={() => { setOpen(true); if (simultaneous) setNested(true); }}>Open</button></main>
    <Sheet open={open} onClose={() => setOpen(false)} title="Task" description="Task details" historyDismiss={false}>
      <input hidden aria-label="Hidden input" />
      <button id="nested-trigger" onClick={() => setNested(true)}>Nested</button>
      <button id="last">Last</button>
    </Sheet>
    <Sheet open={nested} onClose={() => setNested(false)} title="Nested" historyDismiss={false}>
      <button id="nested-action">Nested action</button>
    </Sheet>
  </>;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  // JSDOM does not implement the native inert property. Mirror its DOM
  // attribute contract; this tests ownership, not browser inert enforcement.
  Object.defineProperty(HTMLElement.prototype, "inert", {
    configurable: true,
    get() { return this.hasAttribute("inert"); },
    set(value: boolean) { this.toggleAttribute("inert", value); },
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.hidden ? [] : [{}]) as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return this.hidden ? null : this.parentElement; } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function openDemo(simultaneous = false) {
  act(() => root.render(<Demo simultaneous={simultaneous} />));
  const trigger = document.querySelector<HTMLElement>("#trigger")!;
  trigger.focus();
  click(trigger);
  act(() => vi.runOnlyPendingTimers());
  return trigger;
}

describe("shared mobile sheet DOM interaction", () => {
  it("names the modal, associates its description, transfers focus and restores it", () => {
    const trigger = openDemo();
    const modal = dialog("Task")!;
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(modal.getAttribute("aria-describedby")!)?.textContent).toBe("Task details");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
    expect(document.activeElement?.closest('[role="dialog"]')).toBe(modal);
    expect(host.inert).toBe(true);
    expect(document.querySelector<HTMLElement>("main")!.style.overflow).toBe("hidden");
    escape();
    expect(dialog("Task")).toBeUndefined();
    expect(document.activeElement).toBe(trigger);
    expect(host.inert).toBe(false);
    expect(document.querySelector<HTMLElement>("main")!.style.overflow).toBe("");
  });

  it("loops Tab and Shift+Tab through visible enabled controls", () => {
    openDemo();
    const last = document.querySelector<HTMLElement>("#last")!;
    const first = document.activeElement as HTMLElement;
    last.focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(first);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
  });

  it("dismisses only the top nested modal, retaining the parent lock and focus", () => {
    openDemo();
    const nestedTrigger = document.querySelector<HTMLElement>("#nested-trigger")!;
    nestedTrigger.focus();
    click(nestedTrigger);
    act(() => vi.runOnlyPendingTimers());
    expect(dialog("Task")!.inert).toBe(true);
    expect(dialog("Nested")!.inert).toBe(false);
    escape();
    expect(dialog("Nested")).toBeUndefined();
    expect(dialog("Task")!.inert).toBe(false);
    expect(host.inert).toBe(true);
    expect(document.activeElement).toBe(nestedTrigger);
    escape();
    expect(host.inert).toBe(false);
  });

  it("keeps the top sheet interactive when two portals open in one commit", () => {
    openDemo(true);
    expect(dialog("Task")!.inert).toBe(true);
    expect(dialog("Nested")!.inert).toBe(false);
    escape();
    expect(dialog("Nested")).toBeUndefined();
    expect(dialog("Task")!.inert).toBe(false);
    escape();
    expect(host.inert).toBe(false);
  });
});
