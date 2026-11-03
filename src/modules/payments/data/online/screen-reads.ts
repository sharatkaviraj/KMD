import "server-only";

import {
  reconciliationByDay,
  sessionScopeFor,
  TEST_SESSION_PREFIXES,
  testSessionOrFilter,
  viewerMaySeeCapture,
  viewerMaySeeLabelled,
  viewerMaySeeOrder,
  type CaptureForReconciliation,
  type SessionScope,
} from "@/modules/payments/domain/online/session-fence";
import type { SessionViewer } from "@/platform/auth/test-session-policy";

/**
 * The staff Online payments screen's reads, fenced by session (One only,
 * go-live Phase E review; owner override T1).
 *
 * Every read is the service-role client, which the database's
 * `test_session_fence` policies do not reach — so this file is the fence:
 *
 *  - a real admin reads exactly what the fees app's screen reads;
 *  - anybody else reads only the sessions they may open. Each list is
 *    narrowed in the query (by `session_label`, so the limit still yields a
 *    full page) and then checked row by row with `canAccessSession`;
 *  - a capture with no placeable session is a real admin's only;
 *  - the reconciliation view sums every session, so for anybody else it is
 *    computed from the captures they may see;
 *  - the audit trail names payments of every session, so anybody else sees
 *    only its school-wide switch changes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

type Read<T> = { data: T[]; error: unknown };

const ATTENTION_PAGE = 50;

/** Narrow a query on a session-label column to the viewer's side of the fence. */
export function scopeQuery(query: Query, scope: SessionScope, column = "session_label", referencedTable?: string): Query {
  if (scope === "all") return query;
  if (scope === "test") {
    return referencedTable
      ? query.or(testSessionOrFilter(), { referencedTable })
      : query.or(testSessionOrFilter(column));
  }
  let next = query;
  const target = referencedTable ? `${referencedTable}.${column}` : column;
  for (const prefix of TEST_SESSION_PREFIXES) next = next.not(target, "like", `${prefix}%`);
  return next;
}

async function rows<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<Read<T>> {
  const { data, error } = await query;
  return { data: Array.isArray(data) ? (data as T[]) : [], error };
}

export type OutboxRow = {
  id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
  payload: { receipt_number?: string };
  session_label?: string | null;
};

export type OnlineScreenReads = {
  scope: SessionScope;
  recon: Read<Record<string, number | string>>;
  attention: Read<Record<string, unknown>>;
  intents: Read<Record<string, unknown>>;
  outbox: Read<OutboxRow>;
  audit: Read<{ id: number; action: string; actor: string; created_at: string }>;
  orders: Read<Record<string, unknown>>;
};

export async function readOnlineScreen(supabase: Db, viewer: SessionViewer, now = Date.now()): Promise<OnlineScreenReads> {
  const scope = sessionScopeFor(viewer);
  const all = scope === "all";

  const studentRef = "students(admission_no, full_name)";
  const attentionQuery = supabase
    .from("online_payment_captures")
    .select(
      "id, provider_payment_id, amount_paise, method, application_status, review_reason, resolution_note, created_at, intent_id, " +
        `online_payment_intents(public_ref, session_label, ${studentRef}), ` +
        `online_payment_orders(public_ref, online_payment_order_lines(amount_rupees, session_label, ${studentRef}))`,
    )
    .in("application_status", ["pending", "review_required"])
    .order("created_at", { ascending: true })
    // The fence for captures is in code (a capture is placed through its
    // intent or its order), so a fenced viewer reads further and keeps a page.
    .limit(all ? ATTENTION_PAGE : ATTENTION_PAGE * 4);

  const intentsQuery = scopeQuery(
    supabase
      .from("online_payment_intents")
      .select(`id, status, amount_rupees, provider_mode, superseded_reason, last_error, created_at, session_label, ${studentRef}`),
    scope,
  )
    .order("created_at", { ascending: false })
    .limit(30);

  const outboxQuery = scopeQuery(
    supabase
      .from("notification_outbox")
      .select("id, status, attempts, last_error, updated_at, payload, session_label"),
    scope,
  )
    .order("created_at", { ascending: false })
    .limit(30);

  // An order's lines all come from one send, so one session. `!inner` lets
  // the line filter drop the order itself.
  const linesEmbed = `online_payment_order_lines${all ? "" : "!inner"}(line_no, amount_rupees, session_label, ${studentRef})`;
  const ordersQuery = scopeQuery(
    supabase
      .from("online_payment_orders")
      .select(`id, status, amount_rupees, provider_mode, superseded_reason, last_error, created_at, ${linesEmbed}`),
    scope,
    "session_label",
    all ? undefined : "online_payment_order_lines",
  )
    .order("created_at", { ascending: false })
    .limit(20);

  let auditQuery = supabase.from("online_payment_audit").select("id, action, actor, created_at, detail");
  if (!all) auditQuery = auditQuery.eq("action", "switch_changed");
  auditQuery = auditQuery.order("id", { ascending: false }).limit(40);

  const reconQuery = all
    ? supabase.from("v_online_payment_reconciliation").select("*").order("captured_on", { ascending: false }).limit(14)
    : supabase
        .from("online_payment_captures")
        .select(
          "captured_at, provider_mode, amount_paise, application_status, fee_paise, tax_paise, " +
            "receipt:receipts!online_payment_captures_receipt_id_fkey(total_amount), " +
            "online_payment_intents(session_label), " +
            "online_payment_orders(online_payment_order_lines(session_label, receipt:receipts!online_payment_order_lines_receipt_id_fkey(total_amount)))",
        )
        // Fifteen India-time days back covers the fourteen rows the view shows.
        .gte("captured_at", new Date(now - 15 * 24 * 3600_000).toISOString())
        .limit(5000);

  const [attention, intents, outbox, orders, audit, recon] = await Promise.all([
    rows<Record<string, unknown>>(attentionQuery),
    rows<Record<string, unknown>>(intentsQuery),
    rows<OutboxRow>(outboxQuery),
    rows<Record<string, unknown>>(ordersQuery),
    rows<{ id: number; action: string; actor: string; created_at: string }>(auditQuery),
    rows<Record<string, unknown>>(reconQuery),
  ]);

  if (all) {
    return { scope, recon: recon as Read<Record<string, number | string>>, attention, intents, outbox, audit, orders };
  }

  return {
    scope,
    recon: {
      data: reconciliationByDay(
        (recon.data as unknown as CaptureForReconciliation[]).filter((row) => viewerMaySeeCapture(viewer, row)),
      ) as unknown as Array<Record<string, number | string>>,
      error: recon.error,
    },
    attention: {
      data: attention.data.filter((row) => viewerMaySeeCapture(viewer, row)).slice(0, ATTENTION_PAGE),
      error: attention.error,
    },
    intents: { data: intents.data.filter((row) => viewerMaySeeLabelled(viewer, row as { session_label?: string | null })), error: intents.error },
    outbox: { data: outbox.data.filter((row) => viewerMaySeeLabelled(viewer, row)), error: outbox.error },
    orders: {
      data: orders.data.filter((row) =>
        viewerMaySeeOrder(viewer, row as { online_payment_order_lines?: Array<{ session_label?: string | null }> }),
      ),
      error: orders.error,
    },
    audit: { data: audit.data.filter((row) => row.action === "switch_changed"), error: audit.error },
  };
}
