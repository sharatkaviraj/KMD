"use client";

import { createElement, createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/*
 * How many parents are waiting for this person's reply, as the last look at
 * `/chats/pulse` found it (D-618). The shell is drawn once and kept while
 * someone moves between screens, so the number the server put on the menu
 * goes stale; the bubble and the Chats screen write each fresh count here and
 * the menu's badges read it. Null until one of them has looked.
 *
 * Whose number it is travels with it (D-642). The shell names the person and
 * the year it was drawn for (`LiveChatScope`), and a number looked up for
 * anybody else is never shown. Seeing One as a teacher, coming back to one's
 * own view, or changing the year draws a new shell without loading the page
 * again, and the administrator's own number used to stay on the bubble and
 * the menu as the teacher's until the next look, up to 30 seconds later.
 */

let owner: string | null = null;
let count: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whose count the screens inside are: the person and the year. Empty outside a shell. */
const Scope = createContext("");

/** The shell's person and year, for every bubble, badge and Chats screen inside it. */
export function LiveChatScope({ who, children }: { who: string; children: ReactNode }) {
  return createElement(Scope, { value: who }, children);
}

/** Whose count this screen keeps: pass it with every fresh count. */
export function useLiveChatScope(): string {
  return useContext(Scope);
}

/** A fresh count from `/chats/pulse`, for `who`; the badges redraw only when it changed. */
export function setLiveChatCount(next: number, who: string): void {
  if (!Number.isFinite(next) || next < 0) return;
  if (who === owner && next === count) return;
  owner = who;
  count = next;
  for (const listener of listeners) listener();
}

/** The latest count for this screen's person and year, or null before anything has looked for them (the server's number stands until then). */
export function useLiveChatCount(): number | null {
  const who = useContext(Scope);
  return useSyncExternalStore(
    subscribe,
    () => (owner === who ? count : null),
    () => null,
  );
}
