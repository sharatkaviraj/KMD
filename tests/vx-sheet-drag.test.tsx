// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Sheet } from "@/vx/ui/overlays";

/* Phones: drag the handle or the title down to close; a short pull springs back. */

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;

function Page({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onClose={() => { onClose(); setOpen(false); }} title="Change">
      <button type="button">Inside</button>
    </Sheet>
  );
}

function pointer(target: Element, type: string, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  act(() => { target.dispatchEvent(event); });
}

beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  layer = document.createElement("div");
  layer.id = "vx-layer";
  document.body.append(layer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  layer.remove();
});

it("closes on a long pull of the handle and follows the finger while dragging", () => {
  const onClose = vi.fn();
  act(() => root.render(<Page onClose={onClose} />));
  const grab = layer.querySelector(".grab")!;
  const sheet = layer.querySelector<HTMLElement>(".sheet")!;
  pointer(grab, "pointerdown", 100);
  pointer(grab, "pointermove", 180);
  expect(sheet.style.transform).toBe("translateY(80px)");
  pointer(grab, "pointermove", 260);
  pointer(grab, "pointerup", 260);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("springs back on a short, slow pull, and never starts from a button", () => {
  const onClose = vi.fn();
  act(() => root.render(<Page onClose={onClose} />));
  const header = layer.querySelector("[data-drag-zone]:not(.grab)")!;
  const sheet = layer.querySelector<HTMLElement>(".sheet")!;
  pointer(header, "pointerdown", 100);
  pointer(header, "pointerup", 110);
  expect(onClose).not.toHaveBeenCalled();
  expect(sheet.style.transform).toBe("translateY(0)");
  const close = header.querySelector("button")!;
  sheet.style.transform = "";
  pointer(close, "pointerdown", 100);
  pointer(close, "pointermove", 400);
  expect(sheet.style.transform).toBe("");
});
