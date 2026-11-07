/**
 * Collect's motion (plan §3.4), copied from the approved prototype: the card
 * slide, the ticket chip's flight, the number roll, the seal stamp and the
 * receipt printer. CSS and the Web Animations API only — no library — and
 * only transform, opacity and clip-path move. A reader who asked for reduced
 * motion gets short fades instead.
 */

import { cue } from "@/ui/feedback/cue";

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const OUT = "cubic-bezier(.4,0,.2,1)";
const IN = "cubic-bezier(.22,1,.36,1)";

/** The card leaving: left (forward) or right (back), shrinking to .96 and fading. */
export function slideOut(el: HTMLElement, dir: 1 | -1): Animation {
  const rm = reducedMotion();
  return el.animate(
    rm ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 56}px) scale(.96)` }],
    { duration: rm ? 120 : 220, easing: OUT, fill: "forwards" },
  );
}

/** The next card arriving from the right (forward) or the left (back). */
export function slideIn(el: HTMLElement, dir: 1 | -1, afterLeave: boolean): Animation {
  const rm = reducedMotion();
  return el.animate(
    rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `translateX(${dir * 64}px) scale(.985)` }, { opacity: 1, transform: "none" }],
    { duration: rm ? 140 : 300, easing: IN, delay: afterLeave && !rm ? 50 : 0, fill: "backwards" },
  );
}

/** A card's inside swapping for a sub-card (notes, calendar, QR): out down, in from above. */
export function swapInside(el: HTMLElement, change: () => void) {
  if (reducedMotion()) {
    change();
    return;
  }
  el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(6px)" }], { duration: 110 }).onfinish = () => {
    change();
    requestAnimationFrame(() => el.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: IN }));
  };
}

/** The answer flying from the card's title into its ticket chip (a FLIP-style flight), then the chip pulses. */
export function flyChip(text: string, from: DOMRect, target: Element | null) {
  if (!target || reducedMotion() || !text) return;
  const to = target.getBoundingClientRect();
  const chip = document.createElement("div");
  chip.className = "cx-flyer";
  chip.textContent = text;
  chip.style.left = `${from.left}px`;
  chip.style.top = `${from.top}px`;
  document.body.appendChild(chip);
  chip.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 0 },
      { transform: "translate(0,-6px) scale(1.04)", opacity: 1, offset: 0.18 },
      { transform: `translate(${to.left - from.left}px,${to.top - from.top - 4}px) scale(.78)`, opacity: 0.85 },
    ],
    { duration: 520, easing: "cubic-bezier(.5,0,.15,1)" },
  ).onfinish = () => {
    chip.remove();
    const host = target.closest("[data-chip]") ?? target;
    host.classList.add("cx-pulse");
    window.setTimeout(() => host.classList.remove("cx-pulse"), 520);
  };
}

/** Roll a number from one value to another over 260 ms (ease-out cubic). Returns a cancel. */
export function rollNumber(from: number, to: number, draw: (value: number) => void): () => void {
  if (reducedMotion() || from === to) {
    draw(to);
    return () => {};
  }
  const t0 = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 260);
    const e = 1 - Math.pow(1 - k, 3);
    draw(Math.round(from + (to - from) * e));
    if (k < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/** The seal coming down: from above and large, landing tilted, with an ink ring and a small bump of the card. */
export function stamp(seal: HTMLElement, ring: HTMLElement | null, card: HTMLElement | null): Promise<void> {
  const rm = reducedMotion();
  const down = seal.animate(
    rm
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: "translateY(-90px) scale(1.75) rotate(4deg)", opacity: 0 },
          { transform: "translateY(0) scale(.92) rotate(-9deg)", opacity: 1, offset: 0.72 },
          { transform: "translateY(0) scale(1) rotate(-8deg)", opacity: 1 },
        ],
    { duration: rm ? 150 : 540, easing: "cubic-bezier(.55,0,.2,1)", fill: "both" },
  );
  return new Promise((resolve) => {
    window.setTimeout(() => {
      // The seal lands: the app's "job done" buzz and three-note chime (D-497), on the person's switches.
      cue("done");
      if (!rm && ring) ring.animate([{ transform: "scale(.7)", opacity: 0.55 }, { transform: "scale(1.45)", opacity: 0 }], { duration: 520, easing: "ease-out", fill: "both" });
      if (!rm && card) card.animate([{ transform: "translateY(0)" }, { transform: "translateY(3px)" }, { transform: "translateY(-1px)" }, { transform: "none" }], { duration: 200, easing: "ease-out" });
    }, rm ? 0 : 390);
    down.onfinish = () => window.setTimeout(resolve, rm ? 200 : 760);
  });
}

/** The receipt feeding out of the printer slot in steps, as a thermal printer does. */
export function printFeed(receipt: HTMLElement, children: number): Animation {
  const rm = reducedMotion();
  const steps = 12 + 4 * children;
  const ms = 900 + 300 * children;
  return receipt.animate(rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateY(-103%)" }, { transform: "translateY(0)" }], {
    duration: rm ? 150 : ms,
    easing: rm ? "linear" : `steps(${steps}, end)`,
    fill: "both",
    delay: rm ? 0 : 120,
  });
}

/** Type a receipt number in, one character every 24 ms. */
export async function typeIn(el: HTMLElement, text: string, skip: () => boolean) {
  if (reducedMotion()) {
    el.textContent = text;
    return;
  }
  for (let i = 1; i <= text.length; i += 1) {
    if (skip()) break;
    el.textContent = text.slice(0, i);
    await new Promise((r) => window.setTimeout(r, 24));
  }
  el.textContent = text;
}

/** A shake for an amount the ledger will not take. */
export function shake(el: HTMLElement | null) {
  // The amount was refused: felt as well as seen (D-497).
  cue("warn");
  if (!el || reducedMotion()) return;
  el.animate(
    [{ transform: "none" }, { transform: "translateX(-7px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(2px)" }, { transform: "none" }],
    { duration: 380, easing: "ease" },
  );
}
