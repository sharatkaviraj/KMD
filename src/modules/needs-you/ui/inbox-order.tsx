"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * The admin's queue in the AI's order (D-633), when it has made one: each
 * inbox id's place. Kept apart from the head so the queue reads it without
 * loading Needs you's actions.
 */
export const InboxOrderContext = createContext<ReadonlyMap<string, number> | null>(null);

/** The queue in the AI's order; anything it did not place keeps its place after. Unchanged without one. */
export function useInboxOrder<T extends { id: string }>(items: readonly T[]): readonly T[] {
  const order = useContext(InboxOrderContext);
  return useMemo(() => {
    if (!order) return items;
    const at = (item: T) => order.get(item.id) ?? Number.POSITIVE_INFINITY;
    return items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => at(a.item) - at(b.item) || a.i - b.i)
      .map(({ item }) => item);
  }, [items, order]);
}
