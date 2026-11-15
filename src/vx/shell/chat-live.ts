import { useSyncExternalStore } from "react";

/*
 * How many parents are waiting for this person's reply, as the last look at
 * `/chats/pulse` found it (D-618). The shell is drawn once and kept while
 * someone moves between screens, so the number the server put on the menu
 * goes stale; the pop-up and the Chats screen write each fresh count here and
 * the menu's badges read it. Null until one of them has looked.
 */

let count: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A fresh count from `/chats/pulse`; the badges redraw only when it changed. */
export function setLiveChatCount(next: number): void {
  if (!Number.isFinite(next) || next < 0 || next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

/** The latest count, or null before anything has looked (the server's number stands until then). */
export function useLiveChatCount(): number | null {
  return useSyncExternalStore(subscribe, () => count, () => null);
}
