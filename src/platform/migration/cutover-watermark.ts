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

/**
 * How long the fees app's one-tap checkout (Path B) honours a pay code:
 * `CHECKOUT_LINK_DAYS` in both apps' `checkout-send.ts`, and
 * `scripts/migrate/lib/tail.mjs`.
 */
export const FEES_CHECKOUT_LINK_DAYS = 21;

function istDateOf(at: string): string | null {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10) : null;
}

function addDaysIso(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 24 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Can a parent still pay through this pay code ON THE FEES APP? (critique0
 * #4, #5.) One's Pay now must not go to a family who can: an old fees link
 * and a new One link for the same installment could both be paid, and
 * neither ledger sees the other.
 *
 * Only a code the fees app minted counts (written before the line; TEST rows
 * never). Then it is payable while either door is open, as
 * `scripts/migrate/lib/tail.mjs#tailEnd` counts them:
 *  - Path B (a send with a `pay_scope`): until its IST day + 21 days;
 *  - Path A: until `pay_code_expires_on` — and with no expiry, for good (the
 *    fees page treats a missing date as never expired).
 * `today` is IST `YYYY-MM-DD`.
 */
export function feesPayCodeStillPayable(
  row: {
    created_at: string | null | undefined;
    session_label?: string | null;
    pay_code?: string | null;
    pay_code_expires_on?: string | null;
    pay_scope?: unknown;
  },
  watermark: CutoverWatermark,
  today: string,
): boolean {
  if (!row.pay_code) return false;
  if (!writtenBeforeWatermark(row, watermark)) return false;
  if (row.pay_scope && row.created_at) {
    const sent = istDateOf(String(row.created_at));
    if (sent && addDaysIso(sent, FEES_CHECKOUT_LINK_DAYS) >= today) return true;
  }
  const expires = row.pay_code_expires_on ? String(row.pay_code_expires_on).slice(0, 10) : null;
  return expires === null || expires >= today;
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
