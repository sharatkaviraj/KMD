import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

import { getKeyboardOffset, subscribeKeyboardOffset } from "@/ui/system/keyboard-offset-store";

import type { NoteCardName } from "./cards";

/* ----------------------------------------------- the note cards' frame */

const kbUp = () => getKeyboardOffset() > 120;

/**
 * The least room each card is drawn in as one card. Below it (a phone on its
 * side, a small phone with the keyboard up) the card is drawn at its own
 * height and the page scrolls, instead of a card too small to show its list
 * or its words above the button.
 */
const ROOM: Record<NoteCardName, number> = { child: 300, write: 280, check: 400, saved: 380 };

/**
 * The cards' height: from the frame's top to the tab bar, or to the
 * keyboard while it is up. Divided by the page's zoom (large text, 1.125),
 * which a pixel height inside it is multiplied by. Measured again whenever
 * anything above the cards changes height without the window changing: the
 * offline banner arriving pushed Save under the tab bar (7 Nov, phone test).
 *
 * What a card holds and does not fit scrolls inside the card, above its
 * button (D-500): the card no longer gives way step by step (PR 273's
 * squeeze), so the AI's note and the teacher's words are never folded away.
 */
export function useFrame(root: RefObject<HTMLDivElement | null>, card: NoteCardName) {
  const keyboard = useSyncExternalStore(subscribeKeyboardOffset, kbUp, () => false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let frame = 0;
    const size = () => {
      const rect = el.getBoundingClientRect();
      const zoom = el.offsetWidth > 0 && rect.width / el.offsetWidth > 0.5 ? rect.width / el.offsetWidth : 1;
      const top = rect.top + window.scrollY;
      const view = window.visualViewport?.height ?? window.innerHeight;
      const bar = document.querySelector<HTMLElement>(".vx-bottom");
      const barH = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().height : 0;
      const room = Math.floor((view - top - barH) / zoom);
      el.style.setProperty("--nc-h", `${Math.max(ROOM[card], room)}px`);
      el.style.setProperty("--nc-bar", `${Math.ceil(barH / zoom)}px`);
      if (room < ROOM[card]) el.setAttribute("data-short", "");
      else el.removeAttribute("data-short");
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
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", later);
      window.visualViewport?.removeEventListener("resize", later);
    };
  }, [root, keyboard, card]);
  return keyboard;
}

/**
 * Marks the card whose list or body has more below what shows (`data-more`),
 * so the card can say so: a fade over its last line and a small arrow above
 * its button (cards.css). A teacher who does not know a box scrolls still sees
 * that there is more (owner, 7 Nov: nothing hidden). Measured again when the
 * card scrolls, changes size, or what it holds changes (the AI's note arriving).
 */
export function useMoreBelow(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    let frame = 0;
    const check = () => {
      const card = el.querySelector<HTMLElement>(".nc-stage > .nc-card");
      if (!card) return;
      const body = card.querySelector<HTMLElement>(":scope > .nc-body");
      const box = body?.querySelector<HTMLElement>(":scope > .nc-list") ?? body;
      const more = box ? box.scrollHeight - box.clientHeight - box.scrollTop > 6 : false;
      if (more) card.setAttribute("data-more", "");
      else card.removeAttribute("data-more");
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    later();
    el.addEventListener("scroll", later, { capture: true, passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(later);
    ro?.observe(el);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(later);
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", later, { capture: true });
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [root]);
}
