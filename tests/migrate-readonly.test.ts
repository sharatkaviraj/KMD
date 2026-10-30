import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  feesPgOptions,
  FeesReadOnlyError,
  isReadOnlyRequest,
  openFeesReadOnly,
  readOnlyFetch,
  sealClient,
} from "../scripts/migrate/lib/fees-readonly.mjs";

/**
 * The fees app's live database is reachable from scripts/migrate/* only
 * through a client that cannot write (D-339; plan I-3; critique0 #22). These
 * tests prove both seals — the surface and the wire — against a client whose
 * fetch never leaves the process. Synthetic keys only.
 */

const URL_FEES = "https://vgqyilgstjvgohrsiwkb.supabase.co";
const KEY = "synthetic-service-role-key";

type Call = { url: string; method: string };

function fakeFetch(calls: Call[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, method: String(init?.method ?? "GET").toUpperCase() });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/0" } });
  };
}

function sealed(calls: Call[] = []) {
  const wire = readOnlyFetch(fakeFetch(calls));
  const client = createClient(URL_FEES, KEY, { auth: { persistSession: false }, global: { fetch: wire } });
  return { fees: sealClient(client, { url: URL_FEES, serviceRoleKey: KEY, fetchImpl: wire }), calls };
}

describe("the surface seal", () => {
  it("lets a select through, as a GET", async () => {
    const { fees, calls } = sealed();
    const { data, error } = await fees.from("students").select("id").eq("status", "active").order("id").limit(5);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/rest/v1/students");
  });

  it("allows a HEAD count", async () => {
    const { fees, calls } = sealed();
    await fees.from("receipts").select("*", { count: "exact", head: true });
    expect(calls[0].method).toBe("HEAD");
  });

  it.each(["insert", "update", "upsert", "delete"])("has no from().%s", (method) => {
    const { fees, calls } = sealed();
    const table = fees.from("payments") as unknown as Record<string, (...a: unknown[]) => unknown>;
    expect(() => table[method]({ amount: 1 })).toThrow(FeesReadOnlyError);
    expect(calls).toHaveLength(0);
  });

  it("has no rpc, schema, channel, functions, auth or rest", () => {
    const { fees } = sealed();
    const surface = fees as unknown as Record<string, unknown>;
    for (const name of ["rpc", "schema", "channel", "functions", "auth", "rest", "realtime"]) {
      expect(() => surface[name], name).toThrow(FeesReadOnlyError);
    }
  });

  it("refuses a builder whose method is changed to a write", () => {
    const { fees } = sealed();
    const builder = fees.from("receipts").select("id") as unknown as { method: string };
    expect(() => {
      builder.method = "DELETE";
    }).toThrow(FeesReadOnlyError);
  });

  it("refuses builder methods that are not reads", () => {
    const { fees } = sealed();
    const builder = fees.from("receipts").select("id") as unknown as Record<string, () => unknown>;
    expect(() => builder.csv()).toThrow(FeesReadOnlyError);
    expect(() => builder.rollback()).toThrow(FeesReadOnlyError);
  });

  it.each(["remove", "upload", "move", "copy", "update", "uploadToSignedUrl", "createSignedUploadUrl"])(
    "has no storage.from().%s",
    (method) => {
      const { fees, calls } = sealed();
      const files = fees.storage.from("student-photos") as unknown as Record<string, (...a: unknown[]) => unknown>;
      expect(() => files[method]("a/b.jpg")).toThrow(FeesReadOnlyError);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(["createBucket", "deleteBucket", "emptyBucket", "updateBucket"])("has no storage.%s", (method) => {
    const { fees } = sealed();
    const storage = fees.storage as unknown as Record<string, (...a: unknown[]) => unknown>;
    expect(() => storage[method]("student-photos")).toThrow(FeesReadOnlyError);
  });

  it.each(["createUser", "deleteUser", "updateUserById", "inviteUserByEmail", "generateLink", "signOut"])(
    "has no authAdmin.%s",
    (method) => {
      const { fees } = sealed();
      const admin = fees.authAdmin as unknown as Record<string, (...a: unknown[]) => unknown>;
      expect(() => admin[method]({})).toThrow(FeesReadOnlyError);
    },
  );

  it("lists and downloads storage through the sealed surface", async () => {
    const { fees, calls } = sealed();
    await fees.storage.from("student-photos").list("", { limit: 10 });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/storage/v1/object/list/student-photos");
  });
});

describe("the wire seal", () => {
  it("allows reads only", () => {
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/students`, "GET")).toBe(true);
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/students`, "HEAD")).toBe(true);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/list/student-photos`, "POST")).toBe(true);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/sign/student-photos/a.jpg`, "POST")).toBe(true);
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/students`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/rpc/post_student_payment`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/students`, "PATCH")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/rest/v1/students`, "DELETE")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/student-photos/a.jpg`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/student-photos`, "DELETE")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/move`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/auth/v1/admin/users`, "POST")).toBe(false);
    // An upload whose path only CONTAINS a read path is still an upload.
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/student-photos/x/storage/v1/object/list/y`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/student-photos/storage/v1/object/sign/y`, "POST")).toBe(false);
    expect(isReadOnlyRequest(`${URL_FEES}/storage/v1/object/list/student-photos/extra`, "POST")).toBe(false);
  });

  it("throws before sending a write, even from a raw client that escaped the surface", async () => {
    const calls: Call[] = [];
    const client = createClient(URL_FEES, KEY, { auth: { persistSession: false }, global: { fetch: readOnlyFetch(fakeFetch(calls)) } });
    await expect(client.from("payments").insert({ amount: 1 }).then((r) => { if (r.error) throw r.error; return r; })).rejects.toThrow(/read-only/);
    await expect(client.rpc("post_student_payment").then((r) => { if (r.error) throw r.error; return r; })).rejects.toThrow(/read-only/);
    const removed = await client.storage.from("student-photos").remove(["a.jpg"]);
    expect(removed.error).not.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("opening", () => {
  it("refuses any project but the fees app's", () => {
    expect(() => openFeesReadOnly({ NEXT_PUBLIC_SUPABASE_URL: "https://wtgxcptmucjerhufzjcf.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY })).toThrow(/refusing/);
    expect(() => openFeesReadOnly({ NEXT_PUBLIC_SUPABASE_URL: "https://elsewhere.example/?vgqyilgstjvgohrsiwkb", SUPABASE_SERVICE_ROLE_KEY: KEY })).toThrow(/refusing/);
    expect(() => openFeesReadOnly({ NEXT_PUBLIC_SUPABASE_URL: URL_FEES })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("the optional Postgres path is read-only, session-mode, and for the fees project only", () => {
    expect(feesPgOptions({})).toBeNull();
    expect(() => feesPgOptions({ LIVE_DB_URL: "postgres://postgres.wtgxcptmucjerhufzjcf:x@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" })).toThrow(/does not name/);
    expect(() => feesPgOptions({ LIVE_DB_URL: "postgres://postgres.vgqyilgstjvgohrsiwkb:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" })).toThrow(/transaction pooler/);
    const ok = feesPgOptions({ LIVE_DB_URL: "postgres://postgres.vgqyilgstjvgohrsiwkb:x@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" });
    expect(ok?.options.connection.default_transaction_read_only).toBe("on");
  });
});
