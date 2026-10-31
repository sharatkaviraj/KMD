/**
 * The line between rows the fees app wrote and rows One wrote (go-live Phase
 * D; critique0 #11 and #12).
 *
 * The real fee data reaches One's database by `scripts/migrate/load-snapshot`
 * and, at cutover, a `kind = 'cutover'` row in `vppsone.migration_runs`. Rows
 * created before that line were written by the fees app:
 *
 *  - a `failed` reminder send it made must not be re-sent from One (the fees
 *    app may have retried it already, with its own pay code);
 *  - a `pending` one must not be reconciled from One;
 *  - a pay code it minted must not open a One payment (`/pay/[code]`, which
 *    arrives with Phase E, calls `payCodeRefused`).
 *
 * The line is the cutover row's snapshot time (its start, if it has none).
 * Before cutover, the newest load of that source table stands in for it. With
 * neither — no real data has ever been loaded — there is no line and nothing is
 * refused on its account. A read that fails refuses (`unreadable`).
 *
 * TEST-session rows are never refused here: they are One's own after the
 * first load, reach only the test-recipient allowlist, and re-testing a pay
 * link is the point of the test session.
 *
 * Pure; the read is `readCutoverWatermark` in `cutover-watermark-reader.ts`.
 */

import { isTestSessionLabel } from "@/platform/auth/test-session-policy";

export type CutoverWatermark =
  /** No real data has been loaded: no restriction. */
  | { state: "none" }
  | { state: "at"; at: string; source: "cutover" | "load" }
  /** The read failed: refuse anything the line would decide. */
  | { state: "unreadable" };

/** Was this row written before the line (by the fees app)? Unreadable counts as yes. */
export function writtenBeforeWatermark(
  row: { created_at: string | null | undefined; session_label?: string | null },
  watermark: CutoverWatermark,
): boolean {
  if (row.session_label && isTestSessionLabel(row.session_label)) return false;
  if (watermark.state === "none") return false;
  if (watermark.state === "unreadable") return true;
  const created = Date.parse(String(row.created_at ?? ""));
  // A row with no readable creation time cannot be shown to be One's.
  if (!Number.isFinite(created)) return true;
  return created < Date.parse(watermark.at);
}

/** For `/pay/[code]` (Phase E): a code the fees app minted never opens a One payment. */
export function payCodeRefused(
  sendRow: { created_at: string | null | undefined; session_label?: string | null },
  watermark: CutoverWatermark,
): boolean {
  return writtenBeforeWatermark(sendRow, watermark);
}

/** Which answer the reads give, as one value. Exported for the reader and its tests. */
export function watermarkFrom(input: {
  cutover: { snapshot_at: string | null; started_at: string } | null;
  load: { snapshot_at: string } | null;
}): CutoverWatermark {
  if (input.cutover) {
    return { state: "at", at: input.cutover.snapshot_at ?? input.cutover.started_at, source: "cutover" };
  }
  if (input.load) return { state: "at", at: input.load.snapshot_at, source: "load" };
  return { state: "none" };
}
