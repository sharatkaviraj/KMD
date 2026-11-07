// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteCardName } from "@/vx/screens/notes/ui/cards";
import { useFrame } from "@/vx/screens/notes/ui/frame";

/*
 * How a note card gives way when what it holds does not fit (useFrame).
 * jsdom draws nothing, so each test says how far the card's body would
 * overflow in each way of drawing it: plain, squeezed and tight.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Overflow = { plain: number; squeeze: number; tight: number };
let overflow: Overflow = { plain: 0, squeeze: 0, tight: 0 };

const drawnAs = (el: Element): keyof Overflow => {
  const squeeze = el.closest(".nc")?.getAttribute("data-squeeze");
  return squeeze === null || squeeze === undefined ? "plain" : squeeze === "tight" ? "tight" : "squeeze";
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  overflow = { plain: 0, squeeze: 0, tight: 0 };
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("nc-body") ? 300 + Math.max(0, overflow[drawnAs(this)]) : 300;
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
});

function Card({ card, words }: { card: NoteCardName; words: string }) {
  const frame = useRef<HTMLDivElement>(null);
  useFrame(frame, card);
  return (
    <div ref={frame} className="nc" data-card={card}>
      <div className="nc-card">
        <div className="nc-body">
          <span>{words}</span>
        </div>
      </div>
    </div>
  );
}

async function show(card: NoteCardName, words: string) {
  await act(async () => root.render(<Card card={card} words={words} />));
  // The second measure runs on the next frame (and after any change to what the card holds).
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
}

const nc = () => host.querySelector<HTMLElement>(".nc")!;
const state = () => (nc().hasAttribute("data-short") ? "own height" : (nc().getAttribute("data-squeeze") ?? "plain"));

describe("a note card that does not fit gives way before it hides a row", () => {
  it("draws a card that fits as it is", async () => {
    await show("check", "TEST check: did not bring the homework notebook today.");
    expect(state()).toBe("plain");
  });

  it("folds the AI's offers beside the words first", async () => {
    overflow = { plain: 46, squeeze: -4, tight: -27 };
    await show("check", "TEST check: did not bring the homework notebook today.");
    expect(state()).toBe("");
  });

  it("lets the AI's reading line go too, rather than drop the card to its own height", async () => {
    // 360x600 on live, 7 Nov: the reading line was the last 20px.
    overflow = { plain: 69, squeeze: 19, tight: -4 };
    await show("check", "TEST check: did not bring the homework notebook today.");
    expect(state()).toBe("tight");
    // The AI answers: its line stops reading, and the card is only squeezed.
    overflow = { plain: 46, squeeze: -4, tight: -27 };
    await show("check", "TEST check: did not bring the homework notebook today. (sorted)");
    expect(state()).toBe("");
  });

  it("draws a card at its own height only when even tight spills, and measures it again when what it holds changes", async () => {
    overflow = { plain: 120, squeeze: 70, tight: 47 };
    await show("check", "TEST check: a long note that does not fit this phone at all.");
    expect(state()).toBe("own height");
    // Before 7 Nov (live, 360x600) a card drawn at its own height stayed so after the AI answered.
    overflow = { plain: 46, squeeze: -4, tight: -27 };
    await show("check", "TEST check: a long note that does not fit this phone at all. (sorted)");
    expect(state()).toBe("");
  });

  it("keeps a card drawn at its own height when only the window moves, so its scroll stays", async () => {
    overflow = { plain: 120, squeeze: 70, tight: 47 };
    await show("check", "TEST check: a long note that does not fit this phone at all.");
    expect(state()).toBe("own height");
    overflow = { plain: 46, squeeze: -4, tight: -27 };
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(state()).toBe("own height");
  });

  it("never squeezes the child and words cards, which cut their own lists", async () => {
    overflow = { plain: 120, squeeze: 70, tight: 47 };
    await show("write", "TEST check");
    expect(state()).toBe("plain");
  });
});
