import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { defaultStudyTemplate, type CertificateFacts } from "@/modules/certificates/domain/certificate";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), viewer: vi.fn(), previewGuard: vi.fn(), confined: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/vx/view-as", () => ({ getViewer: mocks.viewer, assertNotPreviewing: mocks.previewGuard }));
vi.mock("@/platform/deployment/confinement", () => ({ isConfinedDeployment: mocks.confined }));

import { certificateAttentionItems, returnAttentionItems, loadSchoolOfficeAttention, recordCertificateAttention, clearCertificateAttention } from "@/modules/certificates/data/attention";
import { SchoolOfficeAttention } from "@/vx/screens/school-office/attention";

const studentId = "00000000-0000-4000-8000-000000000021";
const sessionLabel = "TEST-2026-27";
const staff: CurrentStaff = { id: "00000000-0000-4000-8000-000000000022", userId: "00000000-0000-4000-8000-000000000023", email: null, displayName: "Synthetic Office", shortName: "Office", role: "office", isActive: true, isTeaching: false, language: "both", preferredStart: null, isTestAccount: true, permissions: ["certificates:view", "certificates:issue", "government:view"] };
const facts: CertificateFacts = { studentId, enrolmentId: "00000000-0000-4000-8000-000000000024", classId: "00000000-0000-4000-8000-000000000025", studentName: "Synthetic Scholar", admissionNo: "00021", classLabel: "8 A", sessionLabel, status: "current", enrolledOn: null, leftOn: null, dateOfBirth: null, fatherName: null, motherName: null, identityVerified: true, sourceCurrent: true, sourceRevision: "test", checkedAt: "2026-11-01T17:00:00Z" };
const command = { studentId, sessionLabel, commandId: "00000000-0000-4000-8000-000000000026" };
const candidate = { student_id: studentId, blocker_codes: ["admissionNo:missing_field"], facts: { ...facts, admissionNo: "" } };
const batch = { id: "00000000-0000-4000-8000-000000000027", parent_batch_id: "00000000-0000-4000-8000-000000000028", direction: "import" as const, state: "staged", has_conflicts: true, created_at: "2026-11-01T17:00:00Z" };
const snapshot = () => ({ template: { ...defaultStudyTemplate }, certificate_candidates: [candidate], certificate_artifacts: [], return_batches: [], certificate_unavailable: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confined.mockReturnValue(false);
  mocks.previewGuard.mockResolvedValue(undefined);
  mocks.viewer.mockResolvedValue({ staff: { ...staff }, menu: "admin", previewing: null });
  mocks.rpc.mockResolvedValue({ data: snapshot(), error: null });
});

it("hides a logged certificate blocker after its authoritative field has been corrected", () => {
  expect(certificateAttentionItems([{ ...candidate, facts }], defaultStudyTemplate)).toEqual([]);
  expect(certificateAttentionItems([candidate], defaultStudyTemplate)).toMatchObject([{ kind: "certificate_blocked", href: `/students/${studentId}`, blockerCodes: ["admissionNo:missing_field"] }]);
});

it("rechecks current template needs without reviving resolved logged fields or unrelated optional fields", () => {
  expect(certificateAttentionItems([candidate], { ...defaultStudyTemplate, requiredFields: ["studentName"], bodyEn: "This is to certify that {studentName} attends this school." })).toEqual([]);
  expect(certificateAttentionItems([{ ...candidate, blocker_codes: ["identity:identity_unverified"], facts: { ...facts, identityVerified: false } }], defaultStudyTemplate)).toMatchObject([{ blockerCodes: ["identity:identity_unverified"] }]);
});

it("a later applied import removes an older staged conflict for the same parent", () => {
  expect(returnAttentionItems([batch, { ...batch, id: "00000000-0000-4000-8000-000000000029", state: "applied", created_at: "2026-11-01T18:00:00Z" }])).toEqual([]);
  expect(returnAttentionItems([batch])).toMatchObject([{ kind: "return_conflict", href: `/school-office/returns/${batch.id}` }]);
});

it("keeps separate parent conflicts and unfinished artifacts actionable", () => {
  expect(returnAttentionItems([batch, { ...batch, id: "00000000-0000-4000-8000-000000000030", parent_batch_id: null, direction: "export", state: "preparing", has_conflicts: false }])).toMatchObject([{ kind: "return_conflict" }, { kind: "return_artifact" }]);
  expect(returnAttentionItems([{ ...batch, has_conflicts: false }, { ...batch, id: "00000000-0000-4000-8000-000000000031", parent_batch_id: null, state: "rejected" }])).toEqual([]);
});

it("does not merge an unfinished export with its returned-file conflict", () => {
  expect(returnAttentionItems([batch, { ...batch, id: batch.parent_batch_id!, parent_batch_id: null, direction: "export", state: "preparing", has_conflicts: false }])).toHaveLength(2);
});

it.each([
  { changed: { permissions: [] }, session: sessionLabel },
  { changed: { role: "teacher", permissions: ["certificates:view"] }, session: sessionLabel },
  { changed: { isActive: false }, session: sessionLabel },
  { changed: {}, session: "2026-27" },
  { changed: {}, session: "" },
])("does not read office work outside capability, class scope or current session: $changed $session", async ({ changed, session }) => {
  mocks.viewer.mockResolvedValue({ staff: { ...staff, ...changed }, previewing: null });
  expect(await loadSchoolOfficeAttention(session)).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("does not leak real admin attention into a view-as screen", async () => {
  mocks.viewer.mockResolvedValue({ staff: { ...staff, role: "admin", isTestAccount: false }, previewing: "teacher" });
  expect(await SchoolOfficeAttention({ sessionLabel: "2026-27" })).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("renders current actionable rows in both languages without treating an outage as an empty queue", async () => {
  const html = renderToStaticMarkup(createElement("div", null, await SchoolOfficeAttention({ sessionLabel })));
  expect(html).toContain(`/students/${studentId}`);
  expect(html).toContain("Synthetic Scholar");
  expect(html).toContain("विद्यालय कार्यालय");
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "source outage" } });
  const offline = renderToStaticMarkup(createElement("div", null, await SchoolOfficeAttention({ sessionLabel })));
  expect(offline).toContain("unavailable");
  expect(offline).not.toContain("Synthetic Scholar");
});

it("does not render a healthy empty queue and keeps source outage distinct from an unresolved identity", async () => {
  mocks.rpc.mockResolvedValue({ data: { ...snapshot(), certificate_candidates: [] }, error: null });
  expect(await SchoolOfficeAttention({ sessionLabel })).toBeNull();
  mocks.rpc.mockResolvedValue({ data: { ...snapshot(), certificate_candidates: [], certificate_unavailable: true }, error: null });
  expect(await loadSchoolOfficeAttention(sessionLabel)).toMatchObject({ unavailable: true, items: [] });
});

it("only persists a known blocker code and never copies certificate fact values into attention", async () => {
  await recordCertificateAttention(staff, command, [{ field: "admissionNo", reason: "missing_field" }]);
  expect(mocks.rpc).toHaveBeenCalledWith("school_certificate_attention_record", { p_actor: staff.id, p_student: studentId, p_session: sessionLabel, p_blockers: ["admissionNo:missing_field"], p_confined: false });
  mocks.rpc.mockClear();
  await recordCertificateAttention(staff, command, [{ field: "Synthetic private value", reason: "missing_field" }] as never);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("attention recording and clearing stay optional and enforce TEST confinement before any write", async () => {
  mocks.rpc.mockRejectedValue(new Error("attention table unavailable"));
  await expect(recordCertificateAttention(staff, command, [{ field: "admissionNo", reason: "missing_field" }])).resolves.toBeUndefined();
  await expect(clearCertificateAttention(staff, command)).resolves.toBeUndefined();
  mocks.rpc.mockClear();
  await clearCertificateAttention(staff, { ...command, sessionLabel: "2026-27" });
  await recordCertificateAttention(staff, { ...command, sessionLabel: "2026-27" }, [{ field: "admissionNo", reason: "missing_field" }]);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
