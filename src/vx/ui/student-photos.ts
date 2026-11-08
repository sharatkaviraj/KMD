"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * Children's photos for screens that list children without loading photos
 * themselves (owner, 8 Nov 2026). A face asks for its child's id; the asks of
 * one moment go to `/api/photos/students` together (`student-photos-ask.ts`,
 * loaded on the first ask), and the answers stay for the rest of the visit,
 * so moving between screens never asks twice. The server decides which
 * photos this reader may see; a child it does not answer for keeps their
 * initials.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Absent: not asked yet or on its way; null: no photo for this reader. */
export const known = new Map<string, string | null>();
const listeners = new Set<() => void>();

/** Answers came in: every face looks again. */
export function settled() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The photo for this child: the one the screen passed, else the one the store
 * found. Asks the server only when the screen passed none (`given` undefined);
 * a screen that says "no photo" (null) is believed.
 */
export function useStudentPhoto(id: string | null | undefined, given?: string | null): string | null {
  const key = id && UUID.test(id) ? id.toLowerCase() : null;
  const found = useSyncExternalStore(
    subscribe,
    () => (key ? known.get(key) ?? null : null),
    () => null,
  );
  const ask = given === undefined ? key : null;
  useEffect(() => {
    if (ask && !known.has(ask)) void import("./student-photos-ask").then(({ want }) => want(ask));
  }, [ask]);
  return given !== undefined ? given : found;
}
