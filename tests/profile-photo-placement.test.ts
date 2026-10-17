import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const state = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), download: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc, storage: { from: () => state } }) }));
import { placePhoto } from "@/modules/collection/data/photos-repo";
const command = { commandId: "00000000-0000-4000-8000-000000000001", studentId: "00000000-0000-4000-8000-000000000002", actorStaffId: "00000000-0000-4000-8000-000000000003", sessionLabel: "SYNTHETIC", contentType: "image/jpeg", width: 999999, height: 999999, source: "file" as const, sourceRef: null, expectedCurrent: null };
async function portrait(colour = "red") { const b = await sharp({ create: { width: 40, height: 30, channels: 3, background: colour } }).jpeg().toBuffer(); return Uint8Array.from(b).buffer; }
beforeEach(() => { vi.resetAllMocks(); state.upload.mockResolvedValue({ error: null }); state.rpc.mockResolvedValue({ data: { ok: true, photo_id: "photo" }, error: null }); });
describe("private portrait placement", () => {
  it("rejects fake JPEG bytes before storing anything", async () => {
    expect(await placePhoto({ ...command, bytes: new TextEncoder().encode("<svg />").buffer })).toMatchObject({ ok: false, reason: "wrong_type" });
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("derives the dimensions from decoded bytes instead of caller metadata", async () => {
    await placePhoto({ ...command, bytes: await portrait() });
    expect(state.rpc.mock.calls[0][1].p).toMatchObject({ width: 40, height: 30 });
  });
  it("retains possibly committed bytes after a lost placement response", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Failed to fetch" } });
    expect(await placePhoto({ ...command, bytes: await portrait() })).toMatchObject({ ok: false, reason: "unknown" });
    expect(state.remove).not.toHaveBeenCalled();
  });
  it("refuses changed bytes under an existing object identity before RPC replay", async () => {
    state.upload.mockResolvedValue({ error: { message: "already exists" } });
    state.download.mockResolvedValue({ data: new Blob([await portrait("blue")]), error: null });
    expect(await placePhoto({ ...command, bytes: await portrait() })).toMatchObject({ ok: false, reason: "id_reused" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
