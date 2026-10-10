import type { DaySpan } from "@/modules/receipts/vx/domain/day-close";

/** `/receipts?…` keeping the day and span, with some keys changed. */
export function deskHref(base: { anchor: string; today: string; span: DaySpan }, changes: Record<string, string | null>, path = "/receipts"): string {
  const q = new URLSearchParams();
  if (base.anchor !== base.today) q.set("date", base.anchor);
  if (base.span !== "today") q.set("span", base.span);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
