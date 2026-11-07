"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/*
 * "New here? Help is this button" (D-497). On the first three visits to a
 * screen, until the person opens its help once, the Help button gives a soft
 * ripple, three times and then stops. Kept on this device; nothing is sent.
 * Reduced motion turns the ripple off with every other animation.
 */

const KEY = "vx.help.seen.v1";
const EVENT = "vx:help-seen";
/** Visits that still glow. After that the button is just a button. */
export const GLOW_VISITS = 3;

type Seen = Record<string, number>;

let lastCounted: { path: string; at: number } | null = null;

function readRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseSeen(raw: string): Seen {
  try {
    const value = raw ? (JSON.parse(raw) as unknown) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Seen) : {};
  } catch {
    return {};
  }
}

/** -1 once the help was opened; otherwise how many visits so far. */
export function glows(seen: Seen, path: string): boolean {
  const n = seen[path] ?? 0;
  return n >= 1 && n <= GLOW_VISITS;
}

function write(update: (seen: Seen) => Seen) {
  try {
    const next = update(parseSeen(readRaw()));
    // Keep the list short: the screens a person has actually opened.
    const keys = Object.keys(next);
    if (keys.length > 80) for (const k of keys.slice(0, keys.length - 80)) delete next[k];
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private mode: no glow memory, no harm.
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

/** Whether this screen's Help should glow, and `opened()` for the button's click. */
export function useHelpGlow(): { glow: boolean; opened: () => void } {
  const path = usePathname() ?? "";
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const glow = path !== "" && glows(parseSeen(raw), path);

  useEffect(() => {
    if (!path) return;
    // The phone bar and the desk bar each draw a Help button: one visit counts once.
    const now = Date.now();
    if (lastCounted && lastCounted.path === path && now - lastCounted.at < 2000) return;
    lastCounted = { path, at: now };
    write((seen) => {
      const n = seen[path] ?? 0;
      return n < 0 || n > GLOW_VISITS ? seen : { ...seen, [path]: n + 1 };
    });
  }, [path]);

  const opened = useCallback(() => {
    if (path) write((seen) => ({ ...seen, [path]: -1 }));
  }, [path]);

  return { glow, opened };
}
