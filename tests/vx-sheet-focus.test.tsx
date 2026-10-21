// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/vx/ui/overlays";

/*
 * Smoke 20 Oct (dev.groups[0]): typing a note in the attendance change sheet
 * jumped to the WhatsApp switch after the first letter, and a space turned the
 * parent message on. Sheet's focus-first effect listed the caller's inline
 * onClose in its deps, so every re-render of the parent moved focus again.
 */

let root: Root;
let host: HTMLDivElement;
let layer: HTMLDivElement;

/** A page like attend.tsx: the note lives in the parent and onClose is inline. */
function Page({ onCloseSpy }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);
  return (
    <>
      <button id="trigger" type="button" onClick={() => setOpen(true)}>Open</button>
      <output id="note">{note}</output>
      <output id="wa">{String(whatsapp)}</output>
      <Sheet
        open={open}
        onClose={() => {
          onCloseSpy?.();
          setOpen(false);
        }}
        title="Change"
      >
        <button id="switch" type="button" role="switch" aria-checked={whatsapp} onClick={() => setWhatsapp((v) => !v)}>WhatsApp</button>
        <textarea id="why" value={note} onChange={(e) => setNote(e.target.value)} />
      </Sheet>
    </>
  );
}

function typeInto(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  for (const ch of text) {
    act(() => {
      setter.call(el, el.value + ch);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // The old effect refocused 40 ms after each render.
    act(() => vi.advanceTimersByTime(100));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

function open(onCloseSpy?: () => void) {
  act(() => root.render(<Page onCloseSpy={onCloseSpy} />));
  act(() => document.querySelector<HTMLButtonElement>("#trigger")!.click());
  act(() => vi.advanceTimersByTime(100));
}

describe("vx Sheet focus", () => {
  it("moves focus into the sheet once, when it opens", () => {
    open();
    expect(document.activeElement?.id).toBe("switch");
  });

  it("keeps focus in a textarea while the parent re-renders on every keystroke", () => {
    open();
    const why = document.querySelector<HTMLTextAreaElement>("#why")!;
    act(() => why.focus());
    typeInto(why, "Fever");
    expect(document.activeElement).toBe(why);
    expect(document.querySelector("#note")!.textContent).toBe("Fever");
    expect(document.querySelector("#wa")!.textContent).toBe("false");
  });

  it("Escape still calls the latest onClose", () => {
    const spy = vi.fn();
    open(spy);
    const why = document.querySelector<HTMLTextAreaElement>("#why")!;
    act(() => why.focus());
    typeInto(why, "ab");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(300));
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
