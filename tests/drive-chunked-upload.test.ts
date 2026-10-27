import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { uploadToDrive, type UploadDeps } from "@/modules/collection/ui/chunked-upload";

import { syntheticFile } from "./fake-drive.fixture";

/**
 * The browser uploader against a fake upload route: order, resume after a
 * dropped connection, the same id throughout, and refusals said once.
 */

const CHUNK = 256 * 1024;
const STUDENT = "00000000-0000-4000-8000-0000000000b1";

function server(options: { dropEvery?: number; busyOnce?: boolean; refuseWith?: string } = {}) {
  const received: Uint8Array[] = [];
  const ids = new Set<string>();
  let declared: { sha256: string; byteSize: number } | null = null;
  let calls = 0;
  let busy = options.busyOnce ?? false;
  const log: string[] = [];
  const have = () => received.reduce((sum, part) => sum + part.byteLength, 0);
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  const state = () =>
    have() >= (declared?.byteSize ?? Infinity) ? { ok: true, state: "stored" } : { ok: true, state: "uploading", offset: have(), chunkBytes: CHUNK };

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://vppsone.test");
    const method = init?.method ?? "GET";
    calls += 1;
    log.push(`${method} ${url.pathname}${url.search}`);
    if (options.refuseWith) return reply({ ok: false, reason: options.refuseWith, retryable: false }, 403);
    if (method === "POST") {
      const body = JSON.parse(String(init!.body)) as { clientRequestId: string; sha256: string; byteSize: number };
      ids.add(body.clientRequestId);
      declared = { sha256: body.sha256, byteSize: body.byteSize };
      return reply(state());
    }
    ids.add(url.pathname.split("/").pop()!);
    if (method === "GET") return reply(state());
    if (busy) {
      busy = false;
      return reply({ ok: false, reason: "busy", retryable: true }, 429);
    }
    const offset = Number(url.searchParams.get("offset"));
    if (offset !== have()) return reply({ ok: false, reason: "offset", retryable: false, offset: have() }, 409);
    const bytes = new Uint8Array(init!.body as ArrayBuffer);
    received.push(bytes);
    // A dropped connection after the server took the bytes: the browser never hears back.
    if (options.dropEvery && calls % options.dropEvery === 0) throw new TypeError("Failed to fetch");
    return reply(state());
  }) as typeof globalThis.fetch;

  return { fetch, received, ids, log, have, declared: () => declared };
}

function deps(fetch: typeof globalThis.fetch): UploadDeps & { retries: number; progress: number[] } {
  const result = {
    retries: 0,
    progress: [] as number[],
    fetch,
    sleep: async () => {},
    digest: async (bytes: ArrayBuffer) => {
      const hash = createHash("sha256").update(new Uint8Array(bytes)).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
    },
    onProgress: (sent: number) => void result.progress.push(sent),
    onRetry: () => void (result.retries += 1),
  };
  return result;
}

const file = (bytes: Uint8Array, name = "synthetic.pdf") => Object.assign(new Blob([bytes.slice()]), { name });

it("sends every byte in order and declares the right checksum", async () => {
  const bytes = syntheticFile("pdf", CHUNK * 3 + 1234);
  const fake = server();
  const outcome = await uploadToDrive({ documentId: crypto.randomUUID(), studentId: STUDENT, kind: "report", note: "", file: file(bytes) }, deps(fake.fetch));
  expect(outcome).toEqual({ ok: true });
  expect(fake.have()).toBe(bytes.byteLength);
  expect(fake.declared()?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
});

it("resumes from the server's count after dropped connections, with one id throughout", async () => {
  const bytes = syntheticFile("pdf", CHUNK * 5);
  const fake = server({ dropEvery: 3, busyOnce: true });
  const tools = deps(fake.fetch);
  const id = crypto.randomUUID();
  const outcome = await uploadToDrive({ documentId: id, studentId: STUDENT, kind: "report", note: "", file: file(bytes) }, tools);
  expect(outcome).toEqual({ ok: true });
  expect(fake.have()).toBe(bytes.byteLength);
  expect(tools.retries).toBeGreaterThan(0);
  expect([...fake.ids]).toEqual([id]);
  expect(fake.log.some((line) => line.startsWith("GET "))).toBe(true);
});

it("stops before sending anything when the file is not a PDF or a photograph", async () => {
  const fake = server();
  const outcome = await uploadToDrive(
    { documentId: crypto.randomUUID(), studentId: STUDENT, kind: "report", note: "", file: file(syntheticFile("html", 5000), "x.pdf") },
    deps(fake.fetch),
  );
  expect(outcome).toEqual({ ok: false, reason: "wrong_type", resumable: false });
  expect(fake.log).toEqual([]);
});

it("refuses a file over 10 MB without sending it", async () => {
  const fake = server();
  const outcome = await uploadToDrive(
    { documentId: crypto.randomUUID(), studentId: STUDENT, kind: "report", note: "", file: file(syntheticFile("pdf", 10 * 1024 * 1024 + 1)) },
    deps(fake.fetch),
  );
  expect(outcome).toMatchObject({ ok: false, reason: "too_large" });
  expect(fake.log).toEqual([]);
});

it("says plainly when the person may not add documents for this child", async () => {
  const fake = server({ refuseWith: "out_of_scope" });
  const outcome = await uploadToDrive(
    { documentId: crypto.randomUUID(), studentId: STUDENT, kind: "report", note: "", file: file(syntheticFile("pdf", 1000)) },
    deps(fake.fetch),
  );
  expect(outcome).toEqual({ ok: false, reason: "not_allowed", resumable: false });
  expect(fake.log).toHaveLength(1);
});
