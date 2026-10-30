import "server-only";

import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { feeWritesMode, type FeeWritesMode } from "@/platform/deployment/decisions";
import { readEffectiveEnvironment } from "@/platform/deployment/marker";
import { getOptionalEnvVar, getServerSupabaseUrl } from "@/platform/env";
import { isTestAcademicSessionLabel } from "@/platform/config/fee-rules";

import { classifyFeeRequest, feeWriteRefusal, type WriteScope } from "@/modules/fees/domain/write-guard";

/**
 * The one place the app asks "may this fee write happen now?" (D-345, D-346).
 *
 * Wraps the `fetch` of both fee server clients (`server.ts`, `admin.ts`), so
 * every insert, update, upsert, delete and RPC the fee module sends to
 * PostgREST passes through here — there is no second door to forget.
 *
 *  - open:      everything passes (the database's own guard still applies).
 *  - test-only: a write passes only if every student, receipt, plan, waiver,
 *               refund, class or session it names is in a TEST session. Else
 *               it is answered here, without reaching the database, with the
 *               same 403 / VPP01 shape the database's guard raises — so the
 *               screen shows the same sentence either way.
 *
 * The mode (`feeWritesMode`) is test-only on any confined deployment
 * (Preview, local), whenever `fee_writes_enabled` is 'false', and on a
 * production database until the key is 'true'. "Production" is the marker
 * made stricter by the deployment's own declaration (`readEffectiveEnvironment`):
 * a Vercel production deployment is production even while the marker still
 * says dev, so it writes real fees only once the owner has set the key. The lookups use the service
 * role and the underlying fetch, so they are never themselves guarded, and
 * any failure to resolve an id refuses: fail closed.
 */

const TTL_MS = 15_000;
let cachedMode: { value: FeeWritesMode; at: number } | null = null;

async function restGet(path: string): Promise<unknown[] | null> {
  const key = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return null;
  try {
    const response = await globalThis.fetch(`${getServerSupabaseUrl()}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "public" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

export async function currentFeeWritesMode(): Promise<FeeWritesMode> {
  if (cachedMode && Date.now() - cachedMode.at < TTL_MS) return cachedMode.value;
  const confined = isConfinedDeployment();
  let value: FeeWritesMode = "test-only";
  if (!confined) {
    const [environment, rows] = await Promise.all([
      readEffectiveEnvironment(),
      restGet("app_settings?select=value&key=eq.fee_writes_enabled"),
    ]);
    // An unreadable setting on a production database stays test-only below;
    // on a dev database it reads as unset, which is open — the same answer
    // the database gives.
    const setting = rows === null ? (environment === "dev" ? null : "false") : ((rows[0] as { value?: string } | undefined)?.value ?? null);
    value = feeWritesMode({ confined, environment, setting });
  }
  cachedMode = { value, at: Date.now() };
  return value;
}

/** For tests: forget the cached mode. */
export function forgetFeeWritesMode() {
  cachedMode = null;
}

const CHUNK = 100;

/** id -> value for a single-column lookup, chunked. Null when any read fails. */
async function lookup(table: string, column: string, ids: string[]): Promise<Map<string, string | null> | null> {
  const out = new Map<string, string | null>();
  for (let at = 0; at < ids.length; at += CHUNK) {
    const chunk = ids.slice(at, at + CHUNK);
    const list = chunk.map((id) => encodeURIComponent(`"${id}"`)).join(",");
    const rows = await restGet(`${table}?select=id,${column}&id=in.(${list})`);
    if (!rows) return null;
    for (const row of rows as Array<Record<string, unknown>>) {
      out.set(String(row.id), row[column] == null ? null : String(row[column]));
    }
  }
  return out;
}

/**
 * Every session the scope touches, or null when any id cannot be resolved —
 * a missing row is not assumed to be a test one.
 */
export async function sessionsTouched(scope: WriteScope): Promise<string[] | null> {
  const labels = new Set(scope.sessionLabels);

  /** Resolve every id through `table.column`, feeding each value to `add`. */
  async function through(table: string, column: string, ids: string[], add: (value: string) => void) {
    if (ids.length === 0) return true;
    const found = await lookup(table, column, ids);
    if (!found) return false;
    for (const id of ids) {
      const value = found.get(id);
      if (!value) return false;
      add(value);
    }
    return true;
  }

  // Import rows -> their batch; batches, sessions and policies -> a label.
  const paymentBatchIds = new Set(scope.paymentBatchIds);
  const importBatchIds = new Set(scope.importBatchIds);
  if (!(await through("payment_import_rows", "batch_id", scope.paymentImportRowIds, (id) => paymentBatchIds.add(id)))) return null;
  if (!(await through("import_rows", "batch_id", scope.importRowIds, (id) => importBatchIds.add(id)))) return null;
  const addLabel = (label: string) => labels.add(label);
  if (!(await through("payment_import_batches", "session_label", [...paymentBatchIds], addLabel))) return null;
  if (!(await through("import_batches", "target_session_label", [...importBatchIds], addLabel))) return null;
  if (!(await through("academic_sessions", "session_label", scope.academicSessionIds, addLabel))) return null;
  if (!(await through("fee_policy_configs", "academic_session_label", scope.policyIds, addLabel))) return null;

  const studentIds = new Set(scope.studentIds);

  for (const [table, ids] of [
    ["receipts", scope.receiptIds],
    ["student_repayment_plans", scope.planIds],
    ["student_late_fee_waivers", scope.waiverIds],
    ["refund_requests", scope.refundIds],
  ] as const) {
    if (ids.length === 0) continue;
    const found = await lookup(table, "student_id", ids);
    if (!found) return null;
    for (const id of ids) {
      const studentId = found.get(id);
      if (!studentId) return null;
      studentIds.add(studentId);
    }
  }

  const classIds = new Set(scope.classIds);
  if (studentIds.size > 0) {
    const ids = [...studentIds];
    const found = await lookup("students", "class_id", ids);
    if (!found) return null;
    for (const id of ids) {
      const classId = found.get(id);
      if (!classId) return null;
      classIds.add(classId);
    }
  }

  if (classIds.size > 0) {
    const ids = [...classIds];
    const found = await lookup("classes", "session_label", ids);
    if (!found) return null;
    for (const id of ids) {
      const label = found.get(id);
      if (!label) return null;
      labels.add(label);
    }
  }

  return [...labels];
}

function isTestLabel(label: string) {
  try {
    return isTestAcademicSessionLabel(label);
  } catch {
    return false;
  }
}

function refuse(resource: string, why: string): Response {
  return new Response(JSON.stringify(feeWriteRefusal(resource, why)), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

/** The reason this request may not be sent now, or null if it may. */
export async function feeWriteRefusalFor(request: { method: string; url: string; body: string | null }) {
  const target = classifyFeeRequest(request);
  if (target.kind !== "write") return null;
  if ((await currentFeeWritesMode()) === "open") return null;

  if (target.unscoped) {
    return { resource: target.resource, why: "it names no student, class or session that can be shown to be TEST" };
  }
  const labels = await sessionsTouched(target.scope);
  if (!labels || labels.length === 0) {
    return { resource: target.resource, why: "a row it names could not be resolved to a session" };
  }
  const real = labels.filter((label) => !isTestLabel(label));
  if (real.length > 0) {
    return { resource: target.resource, why: `it touches ${real.join(", ")}` };
  }
  return null;
}

/**
 * A `fetch` for the fee clients that answers a refused write itself.
 *
 * `underlying` follows `createGuardedFetch`'s rule: read at call time, never
 * captured, because Next.js swaps the global fetch per request scope.
 */
export function createFeeWriteGuardedFetch(underlying?: typeof fetch): typeof fetch {
  return async function feeWriteGuardedFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const body = typeof init?.body === "string" ? init.body : null;

    const refusal = await feeWriteRefusalFor({ method, url, body });
    if (refusal) return refuse(refusal.resource, refusal.why);

    return (underlying ?? globalThis.fetch)(input, init);
  };
}
