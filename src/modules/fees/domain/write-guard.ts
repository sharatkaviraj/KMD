/**
 * The fee writes switch, app side (D-345, D-346; plan §2.7; critique0 #24).
 *
 * The database refuses the money RPCs itself (`vppsone.fee_writes_allowed`,
 * supabase/fee-migrations/20261030230000_fee_writes_guard.sql). This is the
 * other half: ONE check, inside the fee Supabase clients' `fetch`, that sees
 * every request the fee module makes to PostgREST — inserts, updates, upserts,
 * deletes and RPCs alike — so no screen, action or import can forget it.
 *
 * Pure: it reads a request and answers what it would touch. The client wrapper
 * (`platform/supabase/write-guard.ts`) resolves those ids to sessions and
 * decides.
 *
 * While fee writes are TEST-ONLY (mirror mode, a confined deployment, or the
 * key set to 'false' — see `feeWritesMode`), a write may proceed only if
 * everything it names resolves to a TEST session. A write that names nothing
 * this can resolve is refused: unknown is not assumed to be a test.
 */

export type WriteScope = {
  studentIds: string[];
  receiptIds: string[];
  planIds: string[];
  waiverIds: string[];
  refundIds: string[];
  classIds: string[];
  sessionLabels: string[];
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
]);

/** RPCs that only refresh derived views. */
export const FREE_RPCS = new Set([
  "refresh_workbook_materialized_views_if_requested",
  "queue_workbook_materialized_view_refresh",
  "refresh_financial_materialized_views",
]);

/** RPCs that read. Anything not here, not free and not a known writer is treated as a write. */
const READ_RPC = /^(get_|preview_|has_|is_|my_)|^(active_session_label|online_payment_quote|online_payment_quote_for|online_payment_pay_page|fee_contract_fingerprints|generate_schema_snapshot)$/;

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
};

export const KNOWN_WRITE_RPCS = Object.keys(WRITE_RPCS);

function emptyScope(): WriteScope {
  return { studentIds: [], receiptIds: [], planIds: [], waiverIds: [], refundIds: [], classIds: [], sessionLabels: [] };
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

/** `eq.x` / `in.(a,b)` / `in.("a","b")` -> values. Anything else (not.eq, like…) -> none. */
function filterValues(raw: string): string[] {
  if (raw.startsWith("eq.")) return str(raw.slice(3));
  const inList = /^in\.\((.*)\)$/.exec(raw);
  if (inList) {
    return inList[1]
      .split(",")
      .map((value) => value.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
  }
  return [];
}

/** Which ids a row (insert/upsert body, or update body) names. */
function scopeOfRow(table: string, row: unknown): WriteScope {
  const scope = emptyScope();
  if (!row || typeof row !== "object") return scope;
  const r = row as Record<string, unknown>;
  merge(scope, {
    studentIds: [...str(r.student_id), ...(table === "students" ? str(r.id) : [])],
    receiptIds: table === "receipts" ? str(r.id) : str(r.receipt_id),
    classIds: str(r.class_id),
    sessionLabels: [...str(r.session_label), ...str(r.academic_session_label)],
  });
  return scope;
}

/** Which ids the URL's filters name. */
function scopeOfFilters(table: string, params: URLSearchParams): WriteScope {
  const scope = emptyScope();
  for (const [column, raw] of params) {
    const values = filterValues(raw);
    if (values.length === 0) continue;
    if (column === "student_id" || (table === "students" && column === "id")) merge(scope, { studentIds: values });
    else if (column === "receipt_id" || (table === "receipts" && column === "id")) merge(scope, { receiptIds: values });
    else if (column === "class_id" || (table === "classes" && column === "id")) merge(scope, { classIds: values });
    else if (column === "session_label" || column === "academic_session_label") merge(scope, { sessionLabels: values });
    else if (table === "student_repayment_plans" && column === "id") merge(scope, { planIds: values });
    else if (table === "student_late_fee_waivers" && column === "id") merge(scope, { waiverIds: values });
    else if (table === "refund_requests" && column === "id") merge(scope, { refundIds: values });
  }
  return scope;
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

  const scope = scopeOfFilters(resource, url.searchParams);
  const body = parseBody(request.body);
  const rows = Array.isArray(body) ? body : body ? [body] : [];

  // A row whose ids say nothing makes the whole insert unscoped: one real row
  // hidden among TEST rows must not ride along.
  let rowWithoutScope = false;
  for (const row of rows) {
    const rowScope = scopeOfRow(resource, row);
    if (isEmpty(rowScope)) rowWithoutScope = true;
    merge(scope, rowScope);
  }

  const inserting = method === "POST" || method === "PUT";
  const unscoped = isEmpty(scope) || (inserting && rowWithoutScope);
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
