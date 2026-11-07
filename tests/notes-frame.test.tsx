// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteCardName } from "@/vx/screens/notes/ui/cards";
import { useFrame, useMoreBelow } from "@/vx/screens/notes/ui/frame";

/*
 * The note cards' frame (useFrame) and their "more below" mark (useMoreBelow),
 * D-500. A card is one card whenever the window has its least room: what it
 * holds and does not fit scrolls inside it, above its button, and the card
 * says so. jsdom draws nothing, so each test says how tall the window is and
 * how far a card's body or list runs past what shows.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let over = { body: 0, list: 0 };
let height = 800;
const innerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  over = { body: 0, list: 0 };
  height = 800;
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => height });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("nc-list")) return 300 + over.list;
      if (this.classList.contains("nc-body")) return 300 + over.body;
      return 300;
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
  if (innerHeight) Object.defineProperty(window, "innerHeight", innerHeight);
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
});

function Cards({ card, words, list = false }: { card: NoteCardName; words: string; list?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  useFrame(frame, card);
  useMoreBelow(frame);
  return (
    <div ref={frame} className="nc" data-card={card}>
      <div className="nc-stage">
        <div className="nc-ghosts" />
        <section className="nc-card">
          <div className={`nc-body${list ? " nc-pick" : ""}`}>
            {list ? (
              <div className="nc-list">
                <span>{words}</span>
              </div>
            ) : (
              <span>{words}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 60)));

async function show(card: NoteCardName, words: string, list = false) {
  await act(async () => root.render(<Cards card={card} words={words} list={list} />));
  // The second measure runs on the next frame (and after any change to what the card holds).
  await settle();
}

const nc = () => host.querySelector<HTMLElement>(".nc")!;
const card = () => host.querySelector<HTMLElement>(".nc-card")!;
const drawn = () => (nc().hasAttribute("data-short") ? "own height" : "one card");
const more = () => card().hasAttribute("data-more");

describe("a note card keeps its button in sight and scrolls what does not fit", () => {
  it("keeps a card whose words run long as one card, and marks that there is more below", async () => {
    over = { body: 220, list: 0 };
    await show("check", "TEST check: a long note with the AI's clear note and its own words beside it.");
    expect(drawn()).toBe("one card");
    expect(nc().hasAttribute("data-squeeze")).toBe(false);
    expect(more()).toBe(true);
  });

  it("says nothing more of a card that fits", async () => {
    await show("check", "TEST check: did not bring the homework notebook today.");
    expect(drawn()).toBe("one card");
    expect(more()).toBe(false);
  });

  it("takes the mark away once the teacher has scrolled to the end", async () => {
    over = { body: 120, list: 0 };
    await show("check", "TEST check: a long note that runs past the card.");
    expect(more()).toBe(true);
    const body = host.querySelector<HTMLElement>(".nc-body")!;
    Object.defineProperty(body, "scrollTop", { configurable: true, value: 120 });
    await act(async () => {
      body.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(more()).toBe(false);
  });

  it("marks the child card from its class list, which scrolls inside the card", async () => {
    over = { body: 0, list: 900 };
    await show("child", "TEST class list", true);
    expect(drawn()).toBe("one card");
    expect(more()).toBe(true);
  });

  it("marks a card again when what it holds grows (the AI's note arriving)", async () => {
    await show("check", "TEST check: did not bring the homework notebook today.");
    expect(more()).toBe(false);
    over = { body: 160, list: 0 };
    await show("check", "TEST check: did not bring the homework notebook today. And the AI's clear note.");
    expect(more()).toBe(true);
  });
});

describe("a window too short for a card draws it at its own height, and the page scrolls", () => {
  it("gives each card its own least room", async () => {
    height = 350;
    await show("child", "TEST");
    expect(drawn()).toBe("one card");
    await show("write", "TEST");
    expect(drawn()).toBe("one card");
    await show("check", "TEST");
    expect(drawn()).toBe("own height");
    await show("saved", "TEST");
    expect(drawn()).toBe("own height");
  });

  it("measures again when the window grows (a phone turned upright, the keyboard put away)", async () => {
    height = 350;
    await show("check", "TEST");
    expect(drawn()).toBe("own height");
    height = 800;
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(drawn()).toBe("one card");
    expect(nc().style.getPropertyValue("--nc-h")).toBe("800px");
  });
});
