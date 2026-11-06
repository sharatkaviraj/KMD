/**
 * The fee writes switch, app side (D-345, D-346; plan §2.7; critique0 #24).
 *
 * The database refuses the money RPCs and direct money-table writes itself
 * (`vppsone.fee_writes_allowed`, supabase/fee-migrations/20261030230000_* and
 * 20261030230200_*). This is the other half: ONE check, inside the fee
 * Supabase clients' `fetch`, that sees every request the fee module makes to
 * PostgREST — inserts, updates, upserts, deletes and RPCs alike — so no
 * screen, action or import can forget it.
 *
 * Pure: it reads a request and answers what it would touch. The client wrapper
 * (`platform/supabase/write-guard.ts`) resolves those ids to sessions and
 * decides.
 *
 * While fee writes are TEST-ONLY (mirror mode, a confined deployment, or the
 * key set to 'false' — see `feeWritesMode`), a write may proceed only if
 * everything it names resolves to a TEST session. A write that names nothing
 * this can resolve is refused: unknown is not assumed to be a test.
 *
 * For an UPDATE or DELETE the rows changed are the ones the URL FILTERS pick,
 * so the filters alone must place the write; what the body names must be TEST
 * as well, but never stands in for the filters (a body saying
 * `session_label: 'TEST-…'` does not make "update the row with this id" a
 * TEST write). A filter this cannot read exactly — `or=`, `and=`, `not.…`, or
 * a scope column compared other than by `eq.` / `in.` — makes the write
 * unscoped.
 */

export type WriteScope = {
  studentIds: string[];
  receiptIds: string[];
  /** public.installments.id -> its student. The ledger generator updates rows by id. */
  installmentIds: string[];
  /** public.session_reconcile_log.id -> its session_label (Session health's repair log). */
  reconcileLogIds: string[];
  planIds: string[];
  waiverIds: string[];
  refundIds: string[];
  classIds: string[];
  sessionLabels: string[];
  /** public.payment_import_batches.id -> its session_label. */
  paymentBatchIds: string[];
  /** public.payment_import_rows.id -> its batch. */
  paymentImportRowIds: string[];
  /** public.import_batches.id -> its target_session_label. */
  importBatchIds: string[];
  /** public.import_rows.id -> its batch. */
  importRowIds: string[];
  /** public.academic_sessions.id -> its session_label. */
  academicSessionIds: string[];
  /** public.fee_policy_configs.id -> its academic_session_label. */
  policyIds: string[];
  /** public.whatsapp_reminder_sends.id -> its session_label (an online order's send). */
  sendIds: string[];
  /** public.online_payment_intents.id -> its student. */
  intentIds: string[];
  /** public.online_payment_intents.provider_reference_id -> its student. */
  intentRefs: string[];
  /** public.online_payment_orders.id -> its send. */
  orderIds: string[];
  /** public.online_payment_orders.provider_order_id -> its send. */
  providerOrderIds: string[];
  /** public.online_payment_captures.id -> its intent or its order. */
  captureIds: string[];
};

export type FeeRequestTarget =
  | { kind: "read" }
  /** Operational rows that are not fee data (telemetry, sync signals, refresh queues). */
  | { kind: "free"; resource: string }
  | { kind: "write"; resource: string; rpc: boolean; scope: WriteScope; unscoped: boolean };

/** Tables written as a side effect of using the app, not fee data. */
export const FREE_TABLES = new Set([
  "user_activity_events",
  "office_sync_events",
  "workbook_materialized_view_refresh_queue",
  "backup_runs",
  // Razorpay's inbox (status of a delivered event) and the online audit trail
  // (append-only notes): records of what happened, never fee data. Refusing
  // the inbox would make Razorpay redeliver for a day and then switch the
  // webhook off.
  "online_payment_events",
  "online_payment_audit",
]);

/** RPCs that only refresh derived views, or only queue and log (go-live Phase E). */
export const FREE_RPCS = new Set([
  "refresh_workbook_materialized_views_if_requested",
  "queue_workbook_materialized_view_refresh",
  "refresh_financial_materialized_views",
  // A Razorpay event written to the inbox. Acting on it is a separate,
  // guarded call (`online_payment_record_capture` and the rest).
  "online_payment_record_event",
  // The receipt-notice outbox: a lease and a status. The message itself
  // passes the parent-send gate (D-353), which holds a TEST session or a
  // confined deployment to the test-recipient allowlist.
  "notification_outbox_claim",
  "notification_outbox_complete",
]);

/**
 * Online payment rows whose only change is the reconciler's "last looked at"
 * stamp. Bookkeeping for the next pass, never money — and the pay page's
 * eight-second poll claims it with an `or=` filter this guard cannot place.
 */
const STAMP_ONLY_TABLES = new Set(["online_payment_orders", "online_payment_intents"]);
const STAMP_COLUMNS = new Set(["last_reconciled_at"]);

/** RPCs that read. Anything not here, not free and not a known writer is treated as a write. */
const READ_RPC = /^(get_|preview_|has_|is_|my_)|^(active_session_label|online_payment_quote|online_payment_quote_for|online_payment_pay_page|online_payments_cron_secret_matches|fee_contract_fingerprints|generate_schema_snapshot)$/;

type Args = Record<string, unknown>;

const str = (value: unknown): string[] => (typeof value === "string" && value.trim() ? [value.trim()] : []);

/** What each money-writing RPC names, from its arguments. */
const WRITE_RPCS: Record<string, (args: Args) => Partial<WriteScope> | "read"> = {
  post_student_payment: (a) => ({ studentIds: str(a.p_student_id) }),
  post_student_payment_with_adjustments: (a) => ({ studentIds: str(a.p_student_id) }),
  post_corrected_payment: (a) => ({ studentIds: str(a.p_student_id) }),
  waive_late_fee: (a) => ({ studentIds: str(a.p_student_id) }),
  create_student_repayment_plan: (a) => ({ studentIds: str(a.p_student_id) }),
  undo_recent_payment: (a) => ({ receiptIds: str(a.p_receipt_id) }),
  reverse_receipt_admin: (a) => ({ receiptIds: str(a.p_receipt_id) }),
  void_late_fee_waiver: (a) => ({ waiverIds: str(a.p_waiver_id) }),
  process_refund_with_adjustment: (a) => ({ refundIds: str(a.p_refund_request_id) }),
  reschedule_student_repayment_plan: (a) => ({ planIds: str(a.p_plan_id) }),
  cancel_student_repayment_plan: (a) => ({ planIds: str(a.p_plan_id) }),
  import_student_batch_row: (a) => ({ classIds: str(a.p_class_id) }),
  refresh_defaulter_recovery_state: (a) => ({ sessionLabels: str(a.p_session_label) }),
  sync_repayment_plan_late_fees: (a) =>
    a.p_dry_run === true ? "read" : { sessionLabels: str(a.p_session_label) },
  // Deletes one academic session (and refuses if it has data): placed by that session.
  delete_academic_session_safe: (a) => ({ academicSessionIds: str(a.p_session_id) }),

  // Online payments (go-live Phase E). Each is placed by the student, send,
  // intent, order or capture it names, so a TEST family can pay online while
  // writes are TEST-only and a real one is refused — on the webhook, the
  // reconciler and the pay page alike. A capture or apply that cannot be
  // placed (money on a link this database does not know) is refused, and the
  // inbox keeps it for the reconciler once writes open.
  online_payment_open_intent: (a) => ({ studentIds: str(a.p_student_id) }),
  online_payment_open_order: (a) => ({ sendIds: str(a.p_send_id) }),
  online_payment_link_recorded: (a) => ({ intentIds: str(a.p_intent_id) }),
  online_payment_link_failed: (a) => ({ intentIds: str(a.p_intent_id) }),
  online_payment_link_closed: (a) => ({ intentIds: str(a.p_intent_id) }),
  online_payment_order_recorded: (a) => ({ orderIds: str(a.p_order_id) }),
  online_payment_order_failed: (a) => ({ orderIds: str(a.p_order_id) }),
  online_payment_order_closed: (a) => ({ orderIds: str(a.p_order_id) }),
  online_payment_record_capture: (a) => ({ intentRefs: str(factOf(a.p_facts, "reference_id")) }),
  online_payment_record_order_capture: (a) => ({ providerOrderIds: str(factOf(a.p_facts, "provider_order_id")) }),
  online_payment_apply_capture: (a) => ({ captureIds: str(a.p_capture_id) }),
  online_payment_apply_order_capture: (a) => ({ captureIds: str(a.p_capture_id) }),
  online_payment_resolve_review: (a) => ({ captureIds: str(a.p_capture_id) }),
};

/** An update body that sets the reconciler's stamp and nothing else. */
function isStampOnly(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const columns = Object.keys(body as Record<string, unknown>);
  return columns.length > 0 && columns.every((column) => STAMP_COLUMNS.has(column));
}

function factOf(facts: unknown, key: string): unknown {
  return facts && typeof facts === "object" ? (facts as Record<string, unknown>)[key] : undefined;
}

export const KNOWN_WRITE_RPCS = Object.keys(WRITE_RPCS);

function emptyScope(): WriteScope {
  return {
    studentIds: [],
    receiptIds: [],
    installmentIds: [],
    reconcileLogIds: [],
    planIds: [],
    waiverIds: [],
    refundIds: [],
    classIds: [],
    sessionLabels: [],
    paymentBatchIds: [],
    paymentImportRowIds: [],
    importBatchIds: [],
    importRowIds: [],
    academicSessionIds: [],
    policyIds: [],
    sendIds: [],
    intentIds: [],
    intentRefs: [],
    orderIds: [],
    providerOrderIds: [],
    captureIds: [],
  };
}

function merge(into: WriteScope, from: Partial<WriteScope>) {
  for (const key of Object.keys(into) as Array<keyof WriteScope>) {
    for (const value of from[key] ?? []) if (!into[key].includes(value)) into[key].push(value);
  }
}

function isEmpty(scope: WriteScope) {
  return Object.values(scope).every((list) => list.length === 0);
}

function parseBody(body: string | null): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** `eq.x` / `in.(a,b)` / `in.("a","b")` -> values. Anything else (not.eq, like…) -> null. */
function filterValues(raw: string): string[] | null {
  if (raw.startsWith("eq.")) return str(raw.slice(3));
  const inList = /^in\.\((.*)\)$/.exec(raw);
  if (inList) {
    return inList[1]
      .split(",")
      .map((value) => value.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
  }
  return null;
}

/** PostgREST query parameters that are not row filters. */
const NOT_FILTERS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/** Logical filters: they can widen a filter beyond what its other params say. */
const LOGICAL = /^(not\.)?(or|and)$/;

/** Which scope key a column names on a table, or null when it names none. */
function scopeKeyOf(table: string, column: string): keyof WriteScope | null {
  if (column === "student_id" || (table === "students" && column === "id")) return "studentIds";
  if (column === "receipt_id" || (table === "receipts" && column === "id")) return "receiptIds";
  if (column === "class_id" || (table === "classes" && column === "id")) return "classIds";
  if (column === "session_label" || column === "academic_session_label" || column === "target_session_label") {
    return "sessionLabels";
  }
  if (table === "installments" && column === "id") return "installmentIds";
  if (table === "session_reconcile_log" && column === "id") return "reconcileLogIds";
  if (table === "student_repayment_plans" && column === "id") return "planIds";
  if (table === "student_late_fee_waivers" && column === "id") return "waiverIds";
  if (table === "refund_requests" && column === "id") return "refundIds";
  if (table === "payment_import_batches" && column === "id") return "paymentBatchIds";
  if (table === "payment_import_rows" && column === "batch_id") return "paymentBatchIds";
  if (table === "payment_import_rows" && column === "id") return "paymentImportRowIds";
  if (table === "import_batches" && column === "id") return "importBatchIds";
  if (table === "import_rows" && column === "batch_id") return "importBatchIds";
  if (table === "import_rows" && column === "id") return "importRowIds";
  if (table === "academic_sessions" && column === "id") return "academicSessionIds";
  if (table === "fee_policy_configs" && column === "id") return "policyIds";
  if (table === "online_payment_intents" && column === "id") return "intentIds";
  if (table === "online_payment_orders" && column === "id") return "orderIds";
  if (table === "online_payment_captures" && column === "id") return "captureIds";
  return null;
}

/** Which ids a row (insert/upsert body, or update body) names. */
function scopeOfRow(table: string, row: unknown): WriteScope {
  const scope = emptyScope();
  if (!row || typeof row !== "object") return scope;
  for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
    const key = scopeKeyOf(table, column);
    if (key) merge(scope, { [key]: str(value) });
  }
  return scope;
}

/**
 * Which ids the URL's filters name, and whether some filter could not be read
 * exactly (`opaque`): a logical `or` / `and`, or a scope column compared other
 * than by `eq.` / `in.`.
 */
function scopeOfFilters(table: string, params: URLSearchParams): { scope: WriteScope; opaque: boolean } {
  const scope = emptyScope();
  let opaque = false;
  for (const [column, raw] of params) {
    if (NOT_FILTERS.has(column)) continue;
    if (LOGICAL.test(column)) {
      opaque = true;
      continue;
    }
    const key = scopeKeyOf(table, column);
    if (!key) continue;
    const values = filterValues(raw);
    if (values === null) {
      opaque = true;
      continue;
    }
    merge(scope, { [key]: values });
  }
  return { scope, opaque };
}

/**
 * What a PostgREST request would do. Only `/rest/v1/` is judged; Storage and
 * Auth calls are not fee rows and pass through.
 */
export function classifyFeeRequest(request: { method: string; url: string; body: string | null }): FeeRequestTarget {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: "read" };
  }
  const match = /\/rest\/v1\/(rpc\/)?([^/?]+)$/.exec(url.pathname);
  if (!match) return { kind: "read" };

  const method = request.method.toUpperCase();
  const isRpc = Boolean(match[1]);
  const resource = decodeURIComponent(match[2]);

  if (isRpc) {
    if (FREE_RPCS.has(resource)) return { kind: "free", resource };
    if (READ_RPC.test(resource)) return { kind: "read" };
    const args = (parseBody(request.body) ?? {}) as Args;
    const describe = WRITE_RPCS[resource];
    const named = describe ? describe(args) : {};
    if (named === "read") return { kind: "read" };
    const scope = emptyScope();
    merge(scope, named);
    return { kind: "write", resource, rpc: true, scope, unscoped: isEmpty(scope) };
  }

  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return { kind: "read" };
  if (FREE_TABLES.has(resource)) return { kind: "free", resource };

  const body = parseBody(request.body);
  if (method === "PATCH" && STAMP_ONLY_TABLES.has(resource) && isStampOnly(body)) return { kind: "free", resource };

  const filters = scopeOfFilters(resource, url.searchParams);
  const scope = emptyScope();
  merge(scope, filters.scope);

  const rows = Array.isArray(body) ? body : body ? [body] : [];

  // A row whose ids say nothing makes the whole insert unscoped: one real row
  // hidden among TEST rows must not ride along.
  let rowWithoutScope = false;
  for (const row of rows) {
    const rowScope = scopeOfRow(resource, row);
    if (isEmpty(rowScope)) rowWithoutScope = true;
    merge(scope, rowScope);
  }

  const inserting = method === "POST";
  // UPDATE / DELETE / PUT change the rows the filters pick: the filters alone
  // must place them. The body's ids were merged above, so they must be TEST
  // too — but they never stand in for the filters.
  const unscoped = inserting
    ? isEmpty(scope) || rowWithoutScope
    : filters.opaque || isEmpty(filters.scope);
  return { kind: "write", resource, rpc: false, scope, unscoped };
}

/** The message a refused write carries, said the same way as the database's VPP01. */
export const FEE_WRITES_REFUSED_MESSAGE =
  "Fee changes are switched off here until go-live (fee_writes_enabled). Only TEST-session students can be changed.";

export function feeWriteRefusal(resource: string, why: string) {
  return {
    code: "VPP01",
    message: FEE_WRITES_REFUSED_MESSAGE,
    details: `${resource}: ${why}`,
    hint: "Real-session fee writes open at T0 (D-345). Previews and local development only ever write TEST data (D-346).",
  };
}
