import type { DuesTab } from "./types";

/** `/dues?…` for a tab, with a family, sheet or child picked. */
export function duesHref(tab: DuesTab, changes: Record<string, string | null> = {}): string {
  const q = new URLSearchParams();
  if (tab !== "call") q.set("tab", tab);
  for (const [k, v] of Object.entries(changes)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/dues?${s}` : "/dues";
}

/**
 * Where a child's row in an open family goes: Student 360 for a reader who
 * may open it (`students:view`), else the Payment Desk with that child picked
 * for one who may collect, else nowhere. The accountant has the desk but not
 * Student 360, and "Open student" landed on "No access" (smoke 21 Oct).
 */
export function kidLink(studentId: string, perms: { openStudent?: boolean; collect: boolean }): { href: string; to: "student" | "desk" } | null {
  const id = encodeURIComponent(studentId);
  if (perms.openStudent) return { href: `/students/${id}`, to: "student" };
  if (perms.collect) return { href: `/payments?student=${id}`, to: "desk" };
  return null;
}
