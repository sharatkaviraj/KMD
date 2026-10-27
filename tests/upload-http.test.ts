import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/platform/observability/log", () => ({ logError: vi.fn() }));

import { UploadRefusal } from "@/modules/collection/data/drive-upload-flow";
import { failureResponse, readCapped, sameOrigin } from "@/modules/collection/data/upload-http";
import { DriveError } from "@/platform/google/drive";
import { GoogleAuthError } from "@/platform/google/workload-identity";

const at = (headers: Record<string, string>, method = "PUT") =>
  new Request("https://vppsone.vercel.app/documents/uploads/x", { method, headers });

it("accepts only the uploader's own requests", () => {
  expect(sameOrigin(at({ "x-vppsone-upload": "1", origin: "https://vppsone.vercel.app" }))).toBe(true);
  // A same-origin GET from an older Safari carries neither Origin nor Sec-Fetch-Site.
  expect(sameOrigin(at({ "x-vppsone-upload": "1" }, "GET"))).toBe(true);
  expect(sameOrigin(at({ origin: "https://vppsone.vercel.app" }))).toBe(false);
  expect(sameOrigin(at({ "x-vppsone-upload": "1", origin: "https://evil.example" }))).toBe(false);
});

it("refuses a body past its cap whatever Content-Length says", async () => {
  const body = new Uint8Array(2000);
  expect(await readCapped(new Request("https://x.test", { method: "PUT", body }), 1000)).toBeNull();
  expect((await readCapped(new Request("https://x.test", { method: "PUT", body }), 4000))?.byteLength).toBe(2000);
});

it("turns failures into reasons the uploader understands, without Google's details", async () => {
  const read = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown> });
  expect(await read(failureResponse(new UploadRefusal("offset", 4096), {}))).toEqual({
    status: 409,
    body: { ok: false, reason: "offset", retryable: false, offset: 4096 },
  });
  expect((await read(failureResponse(new UploadRefusal("starting"), {}))).body).toMatchObject({ retryable: true });
  expect(await read(failureResponse(new DriveError("rate_limited", "x", 429), {}))).toMatchObject({
    status: 429,
    body: { reason: "busy", retryable: true },
  });
  expect((await read(failureResponse(new DriveError("quota", "x", 403), {}))).body).toMatchObject({ reason: "storage_full" });
  const revoked = await read(failureResponse(new GoogleAuthError("revoked", "pool binding removed"), {}));
  expect(revoked.body).toEqual({ ok: false, reason: "storage_refused", retryable: false });
  expect(JSON.stringify(revoked.body)).not.toContain("pool binding");
});
