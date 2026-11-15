"use client";

import { useSyncExternalStore } from "react";

/*
 * Whether the "+" sheet (D-643) is open, shared by the three things that
 * touch it: the bar's "+" (which turns into a "×" while it is open), the desk
 * side menu's Quick actions button, and the sheet itself. Tiny on purpose:
 * every screen carries it, the sheet's own code comes only when it is needed.
 */

let open = false;
/** Counts openings: the register line is asked for afresh each time, never shown from an earlier one. */
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const fn of listeners) fn();
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function openQuick(): void {
  if (open) return;
  open = true;
  seq += 1;
  emit();
}

/** The "×" on the bar, a tap on the bar around it, or the sheet closing itself. */
export function closeQuick(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useQuickOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

export function useQuickSeq(): number {
  return useSyncExternalStore(subscribe, () => seq, () => 0);
}
