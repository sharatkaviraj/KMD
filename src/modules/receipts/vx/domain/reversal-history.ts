/**
 * A receipt's reversal rows, as the history shows them (B08). Pure.
 *
 * One reversal writes one `payment_adjustments` row per payment line, all in
 * the same moment, so they are shown as one event. They used to be keyed by
 * `created_at.slice(0, 16)` and that key was also the time shown — which
 * drops the UTC offset, so "2026-10-19T08:30:00+00:00" became the local
 * "08:30" and the history read 8:30 am for a reversal made at 2:00 pm IST.
 * The grouping key is now the absolute minute; the time shown is the first
 * row's full timestamp, offset and all.
 */

export type ReversalRow = { amount_delta: number | string; reason: string | null; created_at: string; created_by?: string | null };

export type ReversalEvent = {
  /** Full ISO timestamp of the first row of the event, with its offset. */
  at: string;
  amount: number;
  note: string | null;
  /** Who wrote it (the fee user id on the adjustment), when recorded. */
  by: string | null;
};

/** The absolute minute a timestamp falls in, for grouping only. */
export function reversalMinuteKey(createdAt: string): string {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) : createdAt;
}

export function groupReversals(rows: readonly ReversalRow[]): ReversalEvent[] {
  const byMinute = new Map<string, ReversalEvent>();
  for (const r of rows) {
    const key = reversalMinuteKey(r.created_at);
    const cur = byMinute.get(key) ?? { at: r.created_at, amount: 0, note: r.reason, by: r.created_by ?? null };
    cur.amount += Math.abs(Number(r.amount_delta) || 0);
    if (!cur.note && r.reason) cur.note = r.reason;
    if (!cur.by && r.created_by) cur.by = r.created_by;
    byMinute.set(key, cur);
  }
  return [...byMinute.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
