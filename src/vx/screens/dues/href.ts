import type { DuesTab } from "./types";

/** `/dues?…` for a tab, with a family, sheet or child picked. */
export function duesHref(tab: DuesTab, changes: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  if (tab !== "call") q.set("tab", tab);
  for (const [k, v] of Object.entries(changes)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/dues?${s}` : "/dues";
}
