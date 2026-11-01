import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), preview: vi.fn(), scope: vi.fn(), rpc: vi.fn(), cycle: vi.fn(), source: vi.fn(), candidate: vi.fn(), receipt: vi.fn(), store: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: mocks.permission }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertSessionWritable: mocks.scope }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: () => true }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mocks.preview }));
vi.mock("@/modules/official-results/data/repo", () => ({ boardCycle: mocks.cycle, boardSource: mocks.source, boardCandidate: mocks.candidate, boardCommandReceipt: mocks.receipt }));
vi.mock("@/modules/government-records/data/repo", () => ({ hashBytes: () => "a".repeat(64), storeOfficeArtifact: mocks.store }));
import { boardEvidenceType, executeBoardCommand, MAX_BOARD_EVIDENCE_BYTES } from "@/modules/official-results/data/commands";
const cycleId = "00000000-0000-4000-8000-000000000001", commandId = "00000000-0000-4000-8000-000000000002";
const payload = { studentId: "00000000-0000-4000-8000-000000000003", subjectCode: "001", status: "available", rawValue: "0", rawStatus: "FAIL", appearance: "appeared", sourceReference: "Synthetic authority issued result", expectedRevision: 2, candidateRevision: 4, cycleRevision: 3, expectedSource: "synthetic:1" };
const snapshot = { studentId: payload.studentId, studentName: "Synthetic registered pupil", admissionNo: "00017", classId: cycleId, classLabel: "5 A", sessionLabel: "TEST-2026-27", identityVerified: true, enrolmentStatus: "enrolled", sourceRevision: "synthetic:old" };
beforeEach(() => {
 vi.clearAllMocks(); mocks.permission.mockResolvedValue({ id: commandId }); mocks.preview.mockResolvedValue(undefined); mocks.scope.mockResolvedValue(undefined); mocks.cycle.mockResolvedValue({ id: cycleId, session_label: "TEST-2026-27", config: { classIds: [cycleId], sessionLabel: "TEST-2026-27", subjects: [{ code: "001", label: "Synthetic subject" }] } }); mocks.rpc.mockResolvedValue({ data: { revision: 3 }, error: null });
 mocks.source.mockResolvedValue({ sourceRevision: "synthetic:1", roster: [{ ...snapshot, sourceRevision: "synthetic:1" }] });
 mocks.candidate.mockResolvedValue({ cycle_id: cycleId, student_id: payload.studentId, verified: true, subjects: ["001"], revision: 4, student_snapshot: snapshot });
 mocks.receipt.mockResolvedValue(null);
});
describe("official result command boundary", () => {
 it("carries expected revisions, actor, TEST confinement and exact raw zero to the atomic writer", async () => {
  await executeBoardCommand("result", { cycleId, commandId, payload });
  expect(mocks.permission).toHaveBeenCalledWith("outcomes:manage"); expect(mocks.preview).toHaveBeenCalled();
  expect(mocks.scope).toHaveBeenCalledWith({ id: commandId }, "TEST-2026-27");
  expect(mocks.rpc).toHaveBeenCalledWith("school_board_command", expect.objectContaining({ p_actor: commandId, p_command: commandId, p_cycle: cycleId, p_confined: true, p_payload: { ...payload, evidence: null } }));
 });
 it("refuses view-as or denied session before uploading or invoking a writer", async () => {
  mocks.preview.mockRejectedValueOnce(new Error("preview"));
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("preview");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.scope.mockRejectedValueOnce(new Error("wrong session"));
  await expect(executeBoardCommand("result", { cycleId, commandId, payload }, new File(["%PDF-1"], "synthetic.pdf"))).rejects.toThrow("wrong session");
  expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("rejects internal-mark fields and non-issued pending values", async () => {
  await expect(executeBoardCommand("result", { cycleId, commandId, payload: { ...payload, internalMark: 100 } })).rejects.toThrow();
  await expect(executeBoardCommand("result", { cycleId, commandId, payload: { ...payload, status: "pending" } })).rejects.toThrow();
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("propagates stale/registration rejection without retrying or writing another result", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "board:registration" } });
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("not saved");
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it("stores sniffed evidence immutably under cycle and command IDs", async () => {
  await executeBoardCommand("result", { cycleId, commandId, payload }, new File(["%PDF-1.7 synthetic"], "synthetic.txt", { type: "text/plain" }));
  expect(mocks.store).toHaveBeenCalledWith(`board/${cycleId}/${commandId}/${"a".repeat(64)}.pdf`, expect.any(Uint8Array), "application/pdf");
  expect(mocks.rpc.mock.calls[0][1].p_payload.evidence.type).toBe("application/pdf");
 });
 it("refuses disguised or oversized evidence before storage", async () => {
  expect(boardEvidenceType(new TextEncoder().encode("<script>synthetic</script>"))).toBeNull();
  expect(boardEvidenceType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  await expect(executeBoardCommand("result", { cycleId, commandId, payload }, new File(["<script>"], "synthetic.pdf"))).rejects.toThrow("Unsupported");
  await expect(executeBoardCommand("result", { cycleId, commandId, payload }, new File([new Uint8Array(MAX_BOARD_EVIDENCE_BYTES + 1)], "synthetic.pdf"))).rejects.toThrow("Unsupported");
  expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("sends an exact correction for a departed registered student using the current source fence", async () => {
  mocks.source.mockResolvedValueOnce({ sourceRevision: "synthetic:1", roster: [] });
  await executeBoardCommand("result", { cycleId, commandId, payload });
  expect(mocks.rpc).toHaveBeenCalledWith("school_board_command", expect.objectContaining({ p_payload: { ...payload, evidence: null } }));
  expect(mocks.rpc.mock.calls[0][1].p_payload).not.toHaveProperty("student_snapshot");
 });
 it("source outage or changed revision still blocks departed candidates before artifact/write", async () => {
  mocks.source.mockRejectedValueOnce(new Error("source unavailable"));
  await expect(executeBoardCommand("result", { cycleId, commandId, payload }, new File(["%PDF-1"], "synthetic.pdf"))).rejects.toThrow("source unavailable");
  mocks.source.mockResolvedValueOnce({ sourceRevision: "synthetic:new", roster: [] });
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("source changed");
  expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("never permits unknown candidates or departed registration/subject changes", async () => {
  mocks.source.mockResolvedValue({ sourceRevision: "synthetic:1", roster: [] });
  await expect(executeBoardCommand("candidate", { cycleId, commandId, payload: { studentId: payload.studentId, registration: "00031", roll: "00008", subjects: ["001"], verified: true, sourceReference: "Synthetic registration evidence", expectedRevision: 4, cycleRevision: 3, expectedSource: "synthetic:1" } })).rejects.toThrow("identity");
  await expect(executeBoardCommand("result", { cycleId, commandId, payload: { ...payload, subjectCode: "999" } })).rejects.toThrow("outside the verified registration");
  mocks.candidate.mockResolvedValueOnce(undefined);
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("identity");
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("returns the committed receipt after a lost response even when source subsequently changes or fails", async () => {
  const file = new File(["%PDF-1.7 synthetic"], "synthetic.pdf");
  await executeBoardCommand("result", { cycleId, commandId, payload }, file);
  mocks.receipt.mockResolvedValueOnce({ actor_id: commandId, cycle_id: cycleId, kind: "result", request_hash: "a".repeat(64), receipt: { revision: 3, id: "synthetic-committed" } });
  mocks.source.mockRejectedValue(new Error("source changed / unavailable after commit"));
  expect(await executeBoardCommand("result", { cycleId, commandId, payload }, file)).toEqual({ revision: 3, id: "synthetic-committed" });
  expect(mocks.source).toHaveBeenCalledTimes(1); expect(mocks.store).toHaveBeenCalledTimes(1); expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it("receipt replay remains bound to the active actor, cycle, kind and exact request hash", async () => {
  mocks.receipt.mockResolvedValueOnce({ actor_id: commandId, cycle_id: cycleId, kind: "result", request_hash: "b".repeat(64), receipt: { revision: 3 } });
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("different request");
  mocks.receipt.mockResolvedValueOnce({ actor_id: cycleId, cycle_id: cycleId, kind: "result", request_hash: "a".repeat(64), receipt: { revision: 3 } });
  await expect(executeBoardCommand("result", { cycleId, commandId, payload })).rejects.toThrow("different request");
  expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
