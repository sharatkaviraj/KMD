import { beforeEach, expect, it, vi } from "vitest";
import { executeCertificateIssue, type CertificateIssuePorts } from "@/modules/certificates/domain/issue-flow";
import { defaultStudyTemplate, type CertificateFacts, type CertificateIssue } from "@/modules/certificates/domain/certificate";

const facts: CertificateFacts = { studentId: "00000000-0000-4000-8000-000000000011", enrolmentId: "00000000-0000-4000-8000-000000000012", classId: "00000000-0000-4000-8000-000000000013", studentName: "Synthetic Scholar", admissionNo: "00017", classLabel: "8 A", sessionLabel: "TEST-2026-27", status: "current", enrolledOn: null, leftOn: null, dateOfBirth: null, fatherName: null, motherName: null, identityVerified: true, sourceCurrent: true, sourceRevision: "1", checkedAt: "2026-11-01T16:00:00Z" };
const issue: CertificateIssue = { id: "00000000-0000-4000-8000-000000000014", student_id: facts.studentId, session_label: facts.sessionLabel, serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", status: "prepared", artifact_state: "preparing", snapshot: { serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", issuedAt: "2026-11-01T16:00:00Z", issuedOn: "2026-11-01", isTest: true, school: { name: "Synthetic School", address: "", phone: "", email: "" }, facts, template: defaultStudyTemplate }, issued_by: "staff", issued_at: "2026-11-01T16:00:00Z", storage_path: null, artifact_sha256: null, supersedes: null, reason: null };
const command = { studentId: facts.studentId, sessionLabel: facts.sessionLabel, commandId: "00000000-0000-4000-8000-000000000015" };
const bytes = new TextEncoder().encode("%PDF-1.7\nSynthetic certificate only\n%%EOF");
let ports: CertificateIssuePorts;

beforeEach(() => {
  ports = { replay: vi.fn().mockResolvedValue(null), currentIssue: vi.fn().mockResolvedValue(null), template: vi.fn().mockResolvedValue(defaultStudyTemplate), facts: vi.fn().mockResolvedValue(facts), reserve: vi.fn().mockResolvedValue({ issue, existing: false }), readArtifact: vi.fn().mockResolvedValue(null), render: vi.fn().mockResolvedValue(bytes), storeArtifact: vi.fn().mockResolvedValue(undefined), finish: vi.fn().mockResolvedValue(undefined), failed: vi.fn().mockResolvedValue(undefined) };
});

it("stores one artifact and finishes the reserved issue", async () => {
  await expect(executeCertificateIssue(command, ports)).resolves.toEqual({ ok: true, issueId: issue.id, existing: false });
  expect(ports.storeArtifact).toHaveBeenCalledTimes(1);
  expect(ports.finish).toHaveBeenCalledWith(issue, expect.any(String), bytes);
  expect(ports.reserve).toHaveBeenCalledWith(command, facts, defaultStudyTemplate);
});
it("a command replay does not require a live source or render a second PDF", async () => {
  vi.mocked(ports.replay).mockResolvedValue({ ...issue, artifact_state: "ready" });
  vi.mocked(ports.facts).mockRejectedValue(new Error("source offline"));
  await expect(executeCertificateIssue(command, ports)).resolves.toMatchObject({ ok: true, existing: true });
  expect(ports.facts).not.toHaveBeenCalled();
  expect(ports.render).not.toHaveBeenCalled();
  expect(ports.reserve).not.toHaveBeenCalled();
});
it("the ordinary action returns the latest current issue rather than another number", async () => {
  vi.mocked(ports.currentIssue).mockResolvedValue({ ...issue, artifact_state: "ready" });
  await expect(executeCertificateIssue(command, ports)).resolves.toMatchObject({ ok: true, existing: true });
  expect(ports.reserve).not.toHaveBeenCalled();
});
it("recovers existing stored bytes after a lost upload acknowledgement", async () => {
  vi.mocked(ports.replay).mockResolvedValue(issue);
  vi.mocked(ports.readArtifact).mockResolvedValue(bytes);
  await expect(executeCertificateIssue(command, ports)).resolves.toMatchObject({ ok: true });
  expect(ports.render).not.toHaveBeenCalled();
  expect(ports.storeArtifact).not.toHaveBeenCalled();
  expect(ports.finish).toHaveBeenCalledWith(issue, expect.any(String), bytes);
});
it("does not acknowledge success after a rendering failure, and retains the issue", async () => {
  vi.mocked(ports.render).mockRejectedValue(new Error("font unavailable"));
  await expect(executeCertificateIssue(command, ports)).resolves.toEqual({ ok: false, code: "unavailable" });
  expect(ports.failed).toHaveBeenCalledWith(issue.id);
  expect(ports.finish).not.toHaveBeenCalled();
});
it("recovers a race in immutable storage by reading the winner's bytes", async () => {
  vi.mocked(ports.storeArtifact).mockRejectedValue(new Error("already stored"));
  vi.mocked(ports.readArtifact).mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
  await expect(executeCertificateIssue(command, ports)).resolves.toMatchObject({ ok: true });
});
it("does not allocate a number for a missing required field or stale identity", async () => {
  vi.mocked(ports.facts).mockResolvedValue({ ...facts, admissionNo: "", sourceCurrent: false });
  const result = await executeCertificateIssue(command, ports);
  expect(result).toMatchObject({ ok: false, code: "blocked" });
  expect(ports.reserve).not.toHaveBeenCalled();
});
it("refuses corrupt recovered bytes rather than overwriting the artifact", async () => {
  vi.mocked(ports.replay).mockResolvedValue(issue);
  vi.mocked(ports.readArtifact).mockResolvedValue(new TextEncoder().encode("<html>not a PDF</html>"));
  await expect(executeCertificateIssue(command, ports)).resolves.toMatchObject({ ok: false });
  expect(ports.storeArtifact).not.toHaveBeenCalled();
  expect(ports.finish).not.toHaveBeenCalled();
});
