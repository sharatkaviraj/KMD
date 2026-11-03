import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn() }));
vi.mock("@/modules/certificates/data/repo", () => ({ certificateForViewer: mocks.read, CERTIFICATES_BUCKET: "vppsone-certificates" }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }) }));
import { GET } from "@/app/(app)/school-office/certificates/[id]/pdf/route";
const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic original certificate\n%%EOF");
const open = () => GET(new Request("https://one.test/school-office/certificates/id/pdf?download=1"), { params: Promise.resolve({ id: "id" }) });
beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue({ serial: "TEST/VPPS/STUDY/2026-27/0001", artifact_state: "ready", storage_path: "private/file.pdf", artifact_sha256: createHash("sha256").update(bytes).digest("hex") });
  mocks.download.mockReset().mockResolvedValue({ data: new Blob([bytes]), error: null });
});
it("returns exact original bytes with private cache headers", async () => {
  const response = await open();
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment");
});
it("does not mint a link or fetch a file for an inaccessible issue", async () => {
  mocks.read.mockResolvedValue(null);
  expect((await open()).status).toBe(404);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("refuses a changed stored file rather than returning a different reprint", async () => {
  mocks.download.mockResolvedValue({ data: new Blob(["%PDF-1.7 changed contents longer than twenty bytes"]), error: null });
  expect((await open()).status).toBe(503);
});
it("a pending artifact does not cause generation on GET", async () => {
  mocks.read.mockResolvedValue({ artifact_state: "failed" });
  expect((await open()).status).toBe(409);
  expect(mocks.download).not.toHaveBeenCalled();
});
