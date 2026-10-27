import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const state = vi.hoisted(() => ({ allowed: true, scoped: true, row: null as Record<string, unknown> | null, object: null as Blob | null, signed: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => { if (!state.allowed) throw Error(); return { id: "staff" }; } }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => {} }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "2026" }));
vi.mock("@/modules/collection/data/drive-documents", () => ({ studentInScope: async () => state.scoped }));
vi.mock("@/modules/collection/data/storage-settings", () => ({ readStorageSettings: async () => ({ documentsProvider: "supabase", driveConfigured: false, drivePilotStaffIds: [] }) }));
vi.mock("@/modules/collection/data/documents-repo", () => ({ DOCUMENTS_BUCKET: "vppsone-documents" }));
vi.mock("@/platform/observability/log", () => ({ logError: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({
  storage: { from: () => ({ createSignedUploadUrl: async () => { state.signed++; return { data: { token: "synthetic" }, error: null }; }, download: async () => ({ data: state.object, error: state.object ? null : Error() }) }) },
  from: () => ({
    insert: async (row: Record<string, unknown>) => { if (state.row) return { error: { code: "23505" } }; state.row = { ...row, removed_at: null, created_at: new Date().toISOString() }; return { error: null }; },
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }) }),
    update: (changes: Record<string, unknown>) => { const query = { eq() { return this; }, select: async () => { if (state.row?.upload_state !== "uploading") return { data: [], error: null }; Object.assign(state.row, changes); return { data: [{ id: state.row.id }], error: null }; }, then: (resolve: (x: unknown) => void) => { if (state.row?.upload_state === "uploading") Object.assign(state.row, changes); resolve({ error: null }); } }; return query; },
  }),
}) }));

import { POST } from "@/app/(app)/documents/bucket-upload/route";
const id = "00000000-0000-4000-8000-000000000001";
const pdf = new TextEncoder().encode("%PDF-synthetic");
const body = { clientRequestId: id, studentId: id, kind: "other", fileName: "x.pdf", contentType: "application/pdf", byteSize: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex"), note: "" };
const call = (input: object, header = true) => POST(new Request("https://test.invalid/documents/bucket-upload", { method: "POST", headers: header ? { "x-vppsone-upload": "1" } : {}, body: JSON.stringify(input) }));
beforeEach(() => { state.allowed = true; state.scoped = true; state.row = null; state.object = null; state.signed = 0; });
describe("bucket upload route", () => {
  it("refuses unauthenticated, cross-origin and out-of-scope attempts before signing", async () => {
    expect((await call({ ...body, phase: "begin" }, false)).status).toBe(403);
    state.allowed = false;
    expect((await call({ ...body, phase: "begin" })).status).toBe(403);
    state.allowed = true; state.scoped = false;
    expect((await call({ ...body, phase: "begin" })).status).toBe(403);
    expect(state.signed).toBe(0); expect(state.row).toBeNull();
  });
  it("keeps mismatched bytes hidden and rejects a changed request", async () => {
    expect((await call({ ...body, phase: "begin" })).status).toBe(200);
    expect(state.row?.upload_state).toBe("uploading");
    expect((await call({ ...body, byteSize: 20, phase: "finish" })).status).toBe(409);
    state.object = new Blob([new TextEncoder().encode("%PDF-tampered!")], { type: "application/pdf" });
    expect((await call({ ...body, phase: "finish" })).status).toBe(422);
    expect(state.row?.upload_state).toBe("failed");
  });
  it("publishes verified bytes once and recognizes an identical retry", async () => {
    expect((await call({ ...body, phase: "begin" })).status).toBe(200);
    state.object = new Blob([pdf], { type: "application/pdf" });
    expect((await call({ ...body, phase: "finish" })).status).toBe(200);
    expect(state.row?.upload_state).toBe("stored");
    expect((await (await call({ ...body, phase: "begin" })).json()).state).toBe("stored");
    expect(state.signed).toBe(1);
  });
  it("does not renew or finalize an abandoned upload after one hour", async () => {
    expect((await call({ ...body, phase: "begin" })).status).toBe(200);
    if (state.row) state.row.created_at = new Date(Date.now() - 61 * 60_000).toISOString();
    expect((await call({ ...body, phase: "begin" })).status).toBe(410);
    expect((await call({ ...body, phase: "finish" })).status).toBe(410);
    expect(state.signed).toBe(1);
    expect(state.row?.upload_state).toBe("uploading");
  });
});
