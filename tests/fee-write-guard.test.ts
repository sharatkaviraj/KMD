import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyFeeRequest, KNOWN_WRITE_RPCS } from "@/modules/fees/domain/write-guard";

/**
 * The fee writes switch, app side (D-345, D-346): one check inside the fee
 * clients' fetch. Synthetic ids, a stubbed network, nothing real.
 */

const mocks = vi.hoisted(() => ({
  confined: { value: false },
  environment: { value: "production" as "dev" | "production" },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({
  getOptionalEnvVar: (name: string) => (name === "SUPABASE_SERVICE_ROLE_KEY" ? "synthetic-service-key" : undefined),
  getServerSupabaseUrl: () => "https://wtgxcptmucjerhufzjcf.supabase.co",
}));
vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: () => mocks.confined.value }));
// The real combination rule: this "deployment" declares production exactly
// when it is not confined (VERCEL_ENV=production).
vi.mock("@/platform/deployment/marker", async () => {
  const { effectiveEnvironment } = await import("@/platform/deployment/decisions");
  return {
    readEffectiveEnvironment: async () =>
      effectiveEnvironment({ marker: mocks.environment.value, declaredProduction: !mocks.confined.value }),
  };
});

import {
  createFeeWriteGuardedFetch,
  forgetFeeWritesMode,
} from "@/modules/fees/platform/supabase/write-guard";

const BASE = "https://wtgxcptmucjerhufzjcf.supabase.co/rest/v1";
const REAL_STUDENT = "00000000-0000-4000-8000-00000000a001";
const TEST_STUDENT = "00000000-0000-4000-8000-00000000b001";
const REAL_CLASS = "00000000-0000-4000-8000-00000000c001";
const TEST_CLASS = "00000000-0000-4000-8000-00000000c002";
const TEST_RECEIPT = "00000000-0000-4000-8000-00000000d002";
const REAL_RECEIPT = "00000000-0000-4000-8000-00000000d001";

let setting: string | null = null;

const TEST_BATCH = "00000000-0000-4000-8000-00000000e002";
const TEST_BATCH_ROW = "00000000-0000-4000-8000-00000000e012";
const REAL_SESSION_ID = "00000000-0000-4000-8000-00000000f001";
const REAL_POLICY = "00000000-0000-4000-8000-00000000f101";

/** The database, as far as the guard's lookups can see it: table -> id -> { column: value }. */
const DB: Record<string, Record<string, Record<string, string>>> = {
  students: { [REAL_STUDENT]: { class_id: REAL_CLASS }, [TEST_STUDENT]: { class_id: TEST_CLASS } },
  classes: { [REAL_CLASS]: { session_label: "2026-27" }, [TEST_CLASS]: { session_label: "TEST-2026-27" } },
  receipts: { [REAL_RECEIPT]: { student_id: REAL_STUDENT }, [TEST_RECEIPT]: { student_id: TEST_STUDENT } },
  payment_import_batches: { [TEST_BATCH]: { session_label: "TEST-2026-27" } },
  payment_import_rows: { [TEST_BATCH_ROW]: { batch_id: TEST_BATCH } },
  academic_sessions: { [REAL_SESSION_ID]: { session_label: "2026-27" } },
  fee_policy_configs: { [REAL_POLICY]: { academic_session_label: "2026-27" } },
};

function lookups(url: string): Response {
  const u = new URL(url);
  const table = u.pathname.split("/").pop() ?? "";
  if (table === "app_settings") return Response.json(setting === null ? [] : [{ value: setting }]);
  const column = (u.searchParams.get("select") ?? "").split(",")[1];
  const ids = (u.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((id) => id.replace(/"/g, ""));
  const found = DB[table] ?? {};
  return Response.json(ids.filter((id) => found[id]?.[column]).map((id) => ({ id, [column]: found[id][column] })));
}

const sent = vi.fn(async () => Response.json({ ok: true }));

beforeEach(() => {
  forgetFeeWritesMode();
  mocks.confined.value = false;
  mocks.environment.value = "production";
  setting = null;
  sent.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => lookups(String(input))));
});
afterEach(() => vi.unstubAllGlobals());

const guarded = () => createFeeWriteGuardedFetch(sent as unknown as typeof fetch);
const rpc = (name: string, args: object) =>
  guarded()(`${BASE}/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });

async function refusedWith(response: Response) {
  expect(response.status).toBe(403);
  const body = await response.json();
  expect(body.code).toBe("VPP01");
  expect(body.message).toMatch(/Only TEST-session students can be changed/);
  return body;
}

describe("classifyFeeRequest", () => {
  it("passes reads, Storage and Auth", () => {
    expect(classifyFeeRequest({ method: "GET", url: `${BASE}/students?id=eq.x`, body: null }).kind).toBe("read");
    expect(classifyFeeRequest({ method: "POST", url: `${BASE}/rpc/get_dashboard_summary`, body: "{}" }).kind).toBe("read");
    expect(classifyFeeRequest({ method: "POST", url: `${BASE}/rpc/preview_workbook_payment_allocation`, body: "{}" }).kind).toBe("read");
    expect(classifyFeeRequest({ method: "POST", url: "https://wtgxcptmucjerhufzjcf.supabase.co/storage/v1/object/x", body: null }).kind).toBe("read");
    expect(classifyFeeRequest({ method: "POST", url: `${BASE}/rpc/sync_repayment_plan_late_fees`, body: JSON.stringify({ p_dry_run: true }) }).kind).toBe("read");
  });

  it("names what a write touches, from filters and rows", () => {
    const patch = classifyFeeRequest({ method: "PATCH", url: `${BASE}/students?id=eq.${TEST_STUDENT}`, body: JSON.stringify({ class_id: REAL_CLASS }) });
    expect(patch).toMatchObject({ kind: "write", unscoped: false, scope: { studentIds: [TEST_STUDENT], classIds: [REAL_CLASS] } });
    const insert = classifyFeeRequest({ method: "POST", url: `${BASE}/payments`, body: JSON.stringify([{ student_id: TEST_STUDENT }, { amount: 5 }]) });
    expect(insert).toMatchObject({ kind: "write", unscoped: true });
    const unknownRpc = classifyFeeRequest({ method: "POST", url: `${BASE}/rpc/something_new`, body: "{}" });
    expect(unknownRpc).toMatchObject({ kind: "write", unscoped: true });
  });

  it("places an update or delete by its filters alone, never by its body", () => {
    // Relabelling a row the guard cannot place, to a TEST label: unscoped.
    const relabel = classifyFeeRequest({
      method: "PATCH",
      url: `${BASE}/payment_methods?id=eq.00000000-0000-4000-8000-0000000000aa`,
      body: JSON.stringify({ session_label: "TEST-2026-27" }),
    });
    expect(relabel).toMatchObject({ kind: "write", unscoped: true });
    // A delete with no placing filter at all.
    expect(classifyFeeRequest({ method: "DELETE", url: `${BASE}/installments?status=eq.pending`, body: null })).toMatchObject({ unscoped: true });
  });

  it("treats a filter it cannot read exactly as unscoped", () => {
    const widened = classifyFeeRequest({
      method: "PATCH",
      url: `${BASE}/students?id=eq.${TEST_STUDENT}&or=(class_id.eq.${REAL_CLASS},status.eq.active)`,
      body: JSON.stringify({ notes: "x" }),
    });
    expect(widened).toMatchObject({ kind: "write", unscoped: true });
    expect(classifyFeeRequest({ method: "DELETE", url: `${BASE}/payments?student_id=not.eq.${REAL_STUDENT}`, body: null })).toMatchObject({ unscoped: true });
    expect(classifyFeeRequest({ method: "PATCH", url: `${BASE}/students?id=eq.${TEST_STUDENT}&not.and=(status.eq.x)`, body: "{}" })).toMatchObject({ unscoped: true });
    // select / order / on_conflict are not filters.
    expect(classifyFeeRequest({ method: "PATCH", url: `${BASE}/students?id=eq.${TEST_STUDENT}&select=id`, body: "{}" })).toMatchObject({ unscoped: false });
  });

  it("knows every money RPC the database guards", () => {
    for (const name of ["post_student_payment", "post_student_payment_with_adjustments", "post_corrected_payment", "undo_recent_payment", "reverse_receipt_admin", "waive_late_fee", "void_late_fee_waiver", "process_refund_with_adjustment", "create_student_repayment_plan", "reschedule_student_repayment_plan", "cancel_student_repayment_plan", "sync_repayment_plan_late_fees", "import_student_batch_row"]) {
      expect(KNOWN_WRITE_RPCS).toContain(name);
    }
  });
});

describe("the guarded fetch", () => {
  it("treats a Vercel production deployment as production while the marker still says dev", async () => {
    mocks.environment.value = "dev";
    await refusedWith(await rpc("post_student_payment_with_adjustments", { p_student_id: REAL_STUDENT }));
    expect(sent).not.toHaveBeenCalled();
    forgetFeeWritesMode();
    setting = "true";
    const response = await rpc("post_student_payment_with_adjustments", { p_student_id: REAL_STUDENT });
    expect(response.status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("on production with the key unset, refuses a real student's payment without sending it", async () => {
    await refusedWith(await rpc("post_student_payment_with_adjustments", { p_student_id: REAL_STUDENT }));
    expect(sent).not.toHaveBeenCalled();
  });

  it("always lets a TEST-session student through — testing happens in production", async () => {
    expect((await rpc("post_student_payment_with_adjustments", { p_student_id: TEST_STUDENT })).status).toBe(200);
    expect((await rpc("undo_recent_payment", { p_receipt_id: TEST_RECEIPT })).status).toBe(200);
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("resolves a receipt to its student's session", async () => {
    await refusedWith(await rpc("reverse_receipt_admin", { p_receipt_id: REAL_RECEIPT }));
  });

  it("refuses moving a TEST student into a real class", async () => {
    await refusedWith(await guarded()(`${BASE}/students?id=eq.${TEST_STUDENT}`, { method: "PATCH", body: JSON.stringify({ class_id: REAL_CLASS }) }));
  });

  it("refuses a write it cannot place, and an id it cannot find", async () => {
    await refusedWith(await guarded()(`${BASE}/fee_settings?id=eq.x`, { method: "PATCH", body: JSON.stringify({ late_fee: 1 }) }));
    await refusedWith(await rpc("post_student_payment", { p_student_id: "00000000-0000-4000-8000-0000000000ff" }));
  });

  it("opens on production once the key says 'true', and closes on any deployment when it says 'false'", async () => {
    setting = "true";
    expect((await rpc("post_student_payment", { p_student_id: REAL_STUDENT })).status).toBe(200);
    forgetFeeWritesMode();
    mocks.environment.value = "dev";
    setting = "false";
    await refusedWith(await rpc("post_student_payment", { p_student_id: REAL_STUDENT }));
  });

  it("on a confined deployment (preview, local) is test-only even with the key 'true'", async () => {
    mocks.confined.value = true;
    mocks.environment.value = "dev";
    setting = "true";
    await refusedWith(await rpc("waive_late_fee", { p_student_id: REAL_STUDENT }));
    expect((await rpc("waive_late_fee", { p_student_id: TEST_STUDENT })).status).toBe(200);
  });

  it("refuses relabelling a real session, policy or unknown row as TEST", async () => {
    const body = JSON.stringify({ session_label: "TEST-2026-27" });
    await refusedWith(await guarded()(`${BASE}/academic_sessions?id=eq.${REAL_SESSION_ID}`, { method: "PATCH", body }));
    await refusedWith(
      await guarded()(`${BASE}/fee_policy_configs?id=eq.${REAL_POLICY}`, {
        method: "PATCH",
        body: JSON.stringify({ academic_session_label: "TEST-2026-27" }),
      }),
    );
    await refusedWith(await guarded()(`${BASE}/academic_sessions?id=eq.00000000-0000-4000-8000-0000000000ee`, { method: "PATCH", body }));
    expect(sent).not.toHaveBeenCalled();
  });

  it("lets a TEST bulk payment import run end to end in test-only mode", async () => {
    const send = (path: string, method: string, body: unknown) =>
      guarded()(`${BASE}/${path}`, { method, body: JSON.stringify(body) });
    const steps = [
      await send("payment_import_batches?select=id", "POST", { session_label: "TEST-2026-27", file_name: "x.csv" }),
      await send("payment_import_rows", "POST", [
        { batch_id: TEST_BATCH, row_number: 1, student_id: TEST_STUDENT },
        { batch_id: TEST_BATCH, row_number: 2, student_id: null },
      ]),
      await send(`payment_import_batches?id=eq.${TEST_BATCH}`, "PATCH", { status: "committing" }),
      await send("rpc/post_student_payment_with_adjustments", "POST", { p_student_id: TEST_STUDENT }),
      await send(`payment_import_rows?id=eq.${TEST_BATCH_ROW}`, "PATCH", { receipt_id: TEST_RECEIPT, posted_at: "now" }),
      await send(`payment_import_rows?id=eq.${TEST_BATCH_ROW}`, "PATCH", { post_error: "x" }),
      await send(`payment_import_batches?id=eq.${TEST_BATCH}`, "PATCH", { posted_rows: 1, status: "posted" }),
    ];
    expect(steps.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    // …but a TEST row cannot be pointed at a real receipt.
    await refusedWith(await send(`payment_import_rows?id=eq.${TEST_BATCH_ROW}`, "PATCH", { receipt_id: REAL_RECEIPT }));
  });

  it("never blocks reads or the operational tables", async () => {
    expect((await guarded()(`${BASE}/students?select=id`, { method: "GET" })).status).toBe(200);
    expect((await guarded()(`${BASE}/user_activity_events`, { method: "POST", body: "{}" })).status).toBe(200);
  });
});
