import { useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

import { getKeyboardOffset, subscribeKeyboardOffset } from "@/ui/system/keyboard-offset-store";

import type { NoteCardName } from "./cards";

/* ----------------------------------------------- the note cards' frame */

const kbUp = () => getKeyboardOffset() > 120;

/**
 * The least room each card is drawn in as one card. Below it (a phone on its
 * side, a small phone with the keyboard up) the card is drawn at its own
 * height and the page scrolls, instead of a card that cuts off its own Save.
 */
const ROOM: Record<NoteCardName, number> = { child: 330, write: 240, check: 400, saved: 380 };

/**
 * Cards that cut nothing on purpose (the child and words cards cut their own
 * lists, useFit). If their content is taller than the card, from the AI's
 * offers or large text, a row would be hidden ("Tell parents" was, on a
 * 360×640 phone, 7 Nov): the card gives way one SQUEEZE step at a time, and
 * if that is not enough it is drawn at its own height and the page scrolls.
 */
const WHOLE: ReadonlySet<NoteCardName> = new Set<NoteCardName>(["check", "saved"]);

/**
 * How a whole card gives way, in order (`data-squeeze`, cards.css). First the
 * AI's offers fold into two buttons beside the words. Then ("tight") the AI's
 * line under the rows goes too, and the words keep one line: while the AI
 * reads the note, that line alone dropped a 360×600 card to its own height
 * (7 Nov, live). The marks beside the rows still say what the AI did, and the
 * words are one tap away on the card before.
 */
const SQUEEZE = ["", "tight"] as const;

const spills = (el: HTMLElement) => {
  const body = el.querySelector<HTMLElement>(".nc-card:not(.leaving) .nc-body");
  return body !== null && body.scrollHeight - body.clientHeight > 1;
};

/**
 * The cards' height: from the frame's top to the tab bar, or to the
 * keyboard while it is up. Divided by the page's zoom (large text, 1.125),
 * which a pixel height inside it is multiplied by. Measured again whenever
 * anything above the cards changes height without the window changing: the
 * offline banner arriving pushed Save under the tab bar (7 Nov, phone test).
 */
export function useFrame(root: RefObject<HTMLDivElement | null>, card: NoteCardName) {
  const keyboard = useSyncExternalStore(subscribeKeyboardOffset, kbUp, () => false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let frame = 0;
    // The room and the view on the card at which its content spilled even squeezed. Drawn at its own
    // height there, it is not measured again until one of them moves or what the card holds changes:
    // measuring draws it in its frame for a moment, which takes the page's scroll away.
    let spilled: { room: number; sub: string | null } | null = null;
    const size = () => {
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetWidth > 0 && rect.width / el.offsetWidth > 0.5 ? rect.width / el.offsetWidth : 1;
      const top = rect.top + window.scrollY;
      const view = window.visualViewport?.height ?? window.innerHeight;
      const bar = document.querySelector<HTMLElement>(".vx-bottom");
      const barH = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
      const room = Math.floor((view - top - barH) / zoom);
      const sub = el.getAttribute("data-sub");
      el.style.setProperty("--nc-h", `${Math.max(ROOM[card], room)}px`);
      el.style.setProperty("--nc-bar", `${Math.ceil(barH / zoom)}px`);
      el.removeAttribute("data-squeeze");
      if (room < ROOM[card] || (spilled !== null && spilled.sub === sub && room <= spilled.room)) {
        el.setAttribute("data-short", "");
        return;
      }
      const y = window.scrollY;
      spilled = null;
      el.removeAttribute("data-short");
      if (!WHOLE.has(card) || !spills(el)) return;
      for (const step of SQUEEZE) {
        el.setAttribute("data-squeeze", step);
        if (!spills(el)) return;
      }
      el.removeAttribute("data-squeeze");
      el.setAttribute("data-short", "");
      spilled = { room, sub };
      if (window.scrollY !== y) window.scrollTo(0, y);
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(size);
    };
    size();
    later();
    window.addEventListener("resize", later);
    window.visualViewport?.addEventListener("resize", later);
    // A banner above the page (offline, preview) takes room from the shell's main; a top bar that
    // wraps grows the page. Either moves the cards without resizing the window.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    for (const box of [document.body, el.closest(".vx-main"), el.closest(".vx-page")]) if (box) ro?.observe(box);
    // What a card holds changes without any size changing (the AI's sort and offers arrive, its line
    // stops reading): measured again from the start, a card drawn at its own height too.
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            spilled = null;
            later();
          });
    mo?.observe(el, { childList: true, subtree: true, characterData: true, attributeFilter: ["class"] });
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", later);
      window.visualViewport?.removeEventListener("resize", later);
    };
  }, [root, keyboard, card]);
  return keyboard;
}
