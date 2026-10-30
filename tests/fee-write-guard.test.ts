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
vi.mock("@/platform/deployment/marker", () => ({ readDeploymentEnvironment: async () => mocks.environment.value }));

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

/** The database, as far as the guard's lookups can see it. */
function lookups(url: string): Response {
  const u = new URL(url);
  const table = u.pathname.split("/").pop();
  if (table === "app_settings") return Response.json(setting === null ? [] : [{ value: setting }]);
  const ids = (u.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",").map((id) => id.replace(/"/g, ""));
  const rows: Record<string, Record<string, string>> = {
    students: { [REAL_STUDENT]: REAL_CLASS, [TEST_STUDENT]: TEST_CLASS },
    classes: { [REAL_CLASS]: "2026-27", [TEST_CLASS]: "TEST-2026-27" },
    receipts: { [REAL_RECEIPT]: REAL_STUDENT, [TEST_RECEIPT]: TEST_STUDENT },
  };
  const column = table === "students" ? "class_id" : table === "classes" ? "session_label" : "student_id";
  const found = rows[table ?? ""] ?? {};
  return Response.json(ids.filter((id) => found[id]).map((id) => ({ id, [column]: found[id] })));
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

  it("knows every money RPC the database guards", () => {
    for (const name of ["post_student_payment", "post_student_payment_with_adjustments", "post_corrected_payment", "undo_recent_payment", "reverse_receipt_admin", "waive_late_fee", "void_late_fee_waiver", "process_refund_with_adjustment", "create_student_repayment_plan", "reschedule_student_repayment_plan", "cancel_student_repayment_plan", "sync_repayment_plan_late_fees", "import_student_batch_row"]) {
      expect(KNOWN_WRITE_RPCS).toContain(name);
    }
  });
});

describe("the guarded fetch", () => {
  it("lets everything through while writes are open (dev database, key unset)", async () => {
    mocks.environment.value = "dev";
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

  it("never blocks reads or the operational tables", async () => {
    expect((await guarded()(`${BASE}/students?select=id`, { method: "GET" })).status).toBe(200);
    expect((await guarded()(`${BASE}/user_activity_events`, { method: "POST", body: "{}" })).status).toBe(200);
  });
});
