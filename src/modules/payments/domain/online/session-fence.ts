import {
  canAccessSession,
  isRealAdmin,
  type SessionViewer,
} from "@/platform/auth/test-session-policy";

/**
 * The test-session fence for the staff Online payments screen (One only,
 * go-live Phase E review). Pure: no database.
 *
 * The screen reads every online table with the service-role client, which
 * the `test_session_fence` policies do not reach, so this IS the fence there
 * (owner override T1): a test account — everybody, on a confined deployment —
 * sees TEST-session payments only; real staff never see them; a real admin
 * sees both.
 *
 * Intents, order lines and outbox rows carry their own `session_label`. A
 * capture is placed through its link's intent or its order's lines; a capture
 * that cannot be placed (paid on a link this app does not know) is shown to a
 * real admin only, because nothing says which side of the fence it is on.
 */

/** Which rows a list query may return for this viewer. */
export type SessionScope = "all" | "test" | "real";

export function sessionScopeFor(viewer: SessionViewer): SessionScope {
  if (isRealAdmin(viewer)) return "all";
  return viewer.isTestAccount === true ? "test" : "real";
}

/** The label prefixes `isTestSessionLabel` accepts, for a database filter. */
export const TEST_SESSION_PREFIXES = ["TEST-", "UAT-", "DEMO-"] as const;

/**
 * The PostgREST `or` that keeps test-session labels (scope "test"). The
 * database narrows; `canAccessSession` then decides each row exactly.
 */
export function testSessionOrFilter(column = "session_label"): string {
  return TEST_SESSION_PREFIXES.map((prefix) => `${column}.like.${prefix}*`).join(",");
}

type Labelled = { session_label?: string | null } | null | undefined;

export type CaptureForFence = {
  online_payment_intents?: Labelled;
  online_payment_orders?: { online_payment_order_lines?: Labelled[] | null } | null;
};

/** The sessions a capture pays into: its intent's, or each of its order's lines'. */
export function captureSessionLabels(row: CaptureForFence): string[] {
  const labels = row.online_payment_intents
    ? [row.online_payment_intents.session_label]
    : (row.online_payment_orders?.online_payment_order_lines ?? []).map((line) => line?.session_label);
  return labels.filter((label): label is string => typeof label === "string" && label.length > 0);
}

/** May this viewer see this capture? Every session it pays into must be open to them. */
export function viewerMaySeeCapture(viewer: SessionViewer, row: CaptureForFence): boolean {
  if (isRealAdmin(viewer)) return true;
  const labels = captureSessionLabels(row);
  if (labels.length === 0) return false;
  return labels.every((label) => canAccessSession(viewer, label));
}

/** May this viewer see a row that carries its own session label? */
export function viewerMaySeeLabelled(viewer: SessionViewer, row: Labelled): boolean {
  if (isRealAdmin(viewer)) return true;
  return canAccessSession(viewer, row?.session_label ?? null);
}

/** May this viewer see an order? All its lines come from one send, but every one is checked. */
export function viewerMaySeeOrder(
  viewer: SessionViewer,
  row: { online_payment_order_lines?: Labelled[] | null },
): boolean {
  return viewerMaySeeCapture(viewer, { online_payment_orders: row });
}

/** One row of `v_online_payment_reconciliation`, the shape the screen prints. */
export type ReconciliationRow = {
  captured_on: string;
  provider_mode: string;
  captures: number;
  captured_paise: number;
  applied: number;
  applied_paise: number;
  in_review: number;
  in_review_paise: number;
  awaiting_posting: number;
  awaiting_posting_paise: number;
  receipted_paise: number;
  provider_fee_paise: number;
  provider_tax_paise: number;
};

export type CaptureForReconciliation = Omit<CaptureForFence, "online_payment_orders"> & {
  captured_at: string | null;
  provider_mode: string;
  amount_paise: number | null;
  application_status: string;
  fee_paise: number | null;
  tax_paise: number | null;
  receipt?: { total_amount?: number | null } | null;
  online_payment_orders?: {
    online_payment_order_lines?: Array<{ session_label?: string | null; receipt?: { total_amount?: number | null } | null }> | null;
  } | null;
};

/** `YYYY-MM-DD` in India time, as the view's `(captured_at at time zone 'Asia/Kolkata')::date`. */
function istDay(at: string): string | null {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The view, computed from captures the viewer may see. The view itself sums
 * every session together, so a viewer who is not a real admin gets this
 * instead — the same columns, the same rules: by India-time capture day and
 * mode, receipted money from the capture's receipt or its order lines'
 * receipts. Newest day first, at most `limit` rows.
 */
export function reconciliationByDay(
  captures: readonly CaptureForReconciliation[],
  limit = 14,
): ReconciliationRow[] {
  const byKey = new Map<string, ReconciliationRow>();
  for (const capture of captures) {
    // The view groups a capture with no captured_at under a null day; there is
    // nothing to print for it, and the review list still shows the capture.
    const day = capture.captured_at ? istDay(capture.captured_at) : null;
    if (!day) continue;
    const key = `${day}|${capture.provider_mode}`;
    const row =
      byKey.get(key) ??
      ({
        captured_on: day,
        provider_mode: capture.provider_mode,
        captures: 0,
        captured_paise: 0,
        applied: 0,
        applied_paise: 0,
        in_review: 0,
        in_review_paise: 0,
        awaiting_posting: 0,
        awaiting_posting_paise: 0,
        receipted_paise: 0,
        provider_fee_paise: 0,
        provider_tax_paise: 0,
      } satisfies ReconciliationRow);
    const amount = Number(capture.amount_paise ?? 0);
    row.captures += 1;
    row.captured_paise += amount;
    if (capture.application_status === "applied") {
      row.applied += 1;
      row.applied_paise += amount;
    } else if (capture.application_status === "review_required") {
      row.in_review += 1;
      row.in_review_paise += amount;
    } else if (capture.application_status === "pending") {
      row.awaiting_posting += 1;
      row.awaiting_posting_paise += amount;
    }
    const lineReceipts = (capture.online_payment_orders?.online_payment_order_lines ?? [])
      .map((line) => line.receipt?.total_amount)
      .filter((total): total is number => typeof total === "number");
    const receiptRupees =
      typeof capture.receipt?.total_amount === "number"
        ? capture.receipt.total_amount
        : lineReceipts.length > 0
          ? lineReceipts.reduce((sum, total) => sum + total, 0)
          : 0;
    row.receipted_paise += receiptRupees * 100;
    row.provider_fee_paise += Number(capture.fee_paise ?? 0);
    row.provider_tax_paise += Number(capture.tax_paise ?? 0);
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.captured_on === b.captured_on ? a.provider_mode.localeCompare(b.provider_mode) : a.captured_on < b.captured_on ? 1 : -1))
    .slice(0, limit);
}
