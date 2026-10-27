import { describe, expect, it, vi } from "vitest";
import { uploadToBucket } from "@/modules/collection/ui/bucket-upload";

const upload = vi.hoisted(() => vi.fn());
vi.mock("@/platform/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: upload }) } }) }));
const id = "00000000-0000-4000-8000-000000000001";
function file(size: number, header = "%PDF-") {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode(header));
  return Object.assign(new Blob([bytes], { type: "application/pdf" }), { name: "synthetic.pdf" });
}
function setup(f: ReturnType<typeof file>) {
  const requests: { phase: string; byteSize: number }[] = [];
  const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    return Response.json(body.phase === "begin" ? { ok: true, state: "uploading", path: "private/path", token: "test" } : { ok: true, state: "stored" });
  });
  return { input: { documentId: id, studentId: id, kind: "other" as const, note: "", file: f }, requests,
    deps: { fetch: fetch as typeof globalThis.fetch, sleep: async () => {}, digest: async () => new Uint8Array(32).buffer, onProgress: () => {} } };
}

describe("private bucket upload", () => {
  it.each([1_100_335, 10 * 1024 * 1024])("sends %i bytes directly and only metadata to the app", async (size) => {
    upload.mockResolvedValue({ error: null });
    const { input, requests, deps } = setup(file(size));
    expect(await uploadToBucket(input, deps)).toEqual({ ok: true });
    expect(requests.map((r) => r.phase)).toEqual(["begin", "finish"]);
    expect(requests.every((r) => r.byteSize === size)).toBe(true);
    expect(upload).toHaveBeenCalledWith("private/path", "test", expect.objectContaining({ size, type: "application/pdf" }), expect.objectContaining({ upsert: false }));
  });
  it("rejects oversized and invalid files before any request", async () => {
    for (const f of [file(10 * 1024 * 1024 + 1), file(20, "<html")]) {
      const { input, requests, deps } = setup(f);
      expect((await uploadToBucket(input, deps)).ok).toBe(false);
      expect(requests).toHaveLength(0);
    }
  });
  it("checks finalization even when a retry finds the object already uploaded", async () => {
    upload.mockResolvedValue({ error: new Error("already exists") });
    const { input, requests, deps } = setup(file(100));
    expect(await uploadToBucket(input, deps)).toEqual({ ok: true });
    expect(requests.map((r) => r.phase)).toEqual(["begin", "finish"]);
  });
  it("finalizes a previous successful upload when a new signing attempt is refused", async () => {
    const { input, deps } = setup(file(100));
    deps.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const { phase } = JSON.parse(String(init.body));
      return Response.json(phase === "begin" ? { ok: false, reason: "storage_unavailable" } : { ok: true, state: "stored" });
    }) as typeof globalThis.fetch;
    expect(await uploadToBucket(input, deps)).toEqual({ ok: true });
  });
});
