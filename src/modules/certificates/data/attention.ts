import "server-only";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { canAccessSession, isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing, getViewer, rolePreviewOf } from "@/vx/view-as";
import { certificateFields, certificatePreflight, templateSchema, type CertificateBlocker, type CertificateCommand, type CertificateFacts, type CertificateTemplate } from "../domain/certificate";

export type SchoolOfficeAttentionItem = {
  id: string;
  kind: "certificate_blocked" | "certificate_artifact" | "return_conflict" | "return_artifact";
  href: string;
  studentName?: string;
  blockerCodes?: string[];
  state?: string;
};
type CertificateCandidate = { student_id: string; blocker_codes: string[]; facts: CertificateFacts };
type ReturnCandidate = { id: string; parent_batch_id: string | null; direction: "export" | "import"; state: string; has_conflicts: boolean; created_at: string; session_label?: string };
type AttentionSnapshot = {
  template: unknown;
  certificate_candidates: CertificateCandidate[];
  certificate_artifacts: { id: string; student_id: string; student_name: string; session_label: string; artifact_state: string }[];
  return_batches: ReturnCandidate[];
  certificate_unavailable: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codes = new Set([
  ...certificateFields.flatMap(field => [`${field}:missing_field`, `${field}:invalid_date`]),
  "identity:identity_unverified", "template:template_inactive", "source:source_unavailable",
]);
const codeOf = (blocker: CertificateBlocker) => `${blocker.field}:${blocker.reason}`;

function scopeAllowed(staff: CurrentStaff, sessionLabel: string): boolean {
  return staff.isActive && readsEveryClass(staff) && /^(?:TEST-)?\d{4}-\d{2}$/.test(sessionLabel)
    && canAccessSession(staff, sessionLabel) && (!isConfinedDeployment() || isTestSessionLabel(sessionLabel));
}

/** Optional command-side attention; failure must never change an issue result. */
export async function recordCertificateAttention(staff: CurrentStaff, command: CertificateCommand, blockers: readonly CertificateBlocker[]): Promise<void> {
  const blockerCodes = [...new Set(blockers.map(codeOf).filter(code => codes.has(code)))].sort();
  if (!blockerCodes.length || !UUID.test(command.studentId) || !scopeAllowed(staff, command.sessionLabel)
    || !can(staff, "certificates:issue") || !can(staff, "certificates:view")) return;
  try {
    await assertNotPreviewing();
    await createAdminClient().rpc("school_certificate_attention_record", {
      p_actor: staff.id, p_student: command.studentId, p_session: command.sessionLabel,
      p_blockers: blockerCodes, p_confined: isConfinedDeployment(),
    });
  } catch { /* Attention is optional; current preflight remains authoritative. */ }
}

export async function clearCertificateAttention(staff: CurrentStaff, command: CertificateCommand): Promise<void> {
  if (!UUID.test(command.studentId) || !scopeAllowed(staff, command.sessionLabel)
    || !can(staff, "certificates:issue") || !can(staff, "certificates:view")) return;
  try {
    await assertNotPreviewing();
    await createAdminClient().rpc("school_certificate_attention_clear", {
      p_actor: staff.id, p_student: command.studentId, p_session: command.sessionLabel, p_confined: isConfinedDeployment(),
    });
  } catch { /* A stale log is hidden by current preflight on the next read. */ }
}

/** A log is a candidate, never proof that the student is still blocked. */
export function certificateAttentionItems(candidates: readonly CertificateCandidate[], template: CertificateTemplate): SchoolOfficeAttentionItem[] {
  return candidates.flatMap(row => {
    if (!row.facts.sourceCurrent) return [];
    const logged = new Set(row.blocker_codes);
    const blockerCodes = certificatePreflight(row.facts, template).map(codeOf).filter(code => logged.has(code));
    return blockerCodes.length ? [{ id: row.student_id, kind: "certificate_blocked" as const, href: `/students/${row.student_id}`, studentName: row.facts.studentName, blockerCodes }] : [];
  });
}

/** Select the newest import across ALL states before looking for conflicts. */
export function returnAttentionItems(batches: readonly ReturnCandidate[]): SchoolOfficeAttentionItem[] {
  const latest = new Map<string, ReturnCandidate>();
  for (const batch of batches) {
    const key = `${batch.direction}:${batch.direction === "import" ? batch.parent_batch_id ?? batch.id : batch.id}`;
    const previous = latest.get(key);
    if (!previous || batch.created_at > previous.created_at || (batch.created_at === previous.created_at && batch.id > previous.id)) latest.set(key, batch);
  }
  return [...latest.values()].flatMap(batch => {
    const kind = batch.state === "preparing" ? "return_artifact" : batch.direction === "import" && batch.state === "staged" && batch.has_conflicts ? "return_conflict" : null;
    return kind ? [{ id: batch.id, kind, href: `/school-office/returns/${batch.id}`, state: batch.state }] : [];
  });
}

/** Request-scoped server read. No GET writes, and no role-preview data; seeing One as a person reads theirs (D-544). */
export async function loadSchoolOfficeAttention(sessionLabel: string) {
  const viewer = await getViewer();
  const { staff } = viewer;
  if (rolePreviewOf(viewer) || !scopeAllowed(staff, sessionLabel)) return null;
  const certificates = can(staff, "certificates:view"), government = can(staff, "government:view");
  if (!certificates && !government) return null;
  const result = { language: staff.language, items: [] as SchoolOfficeAttentionItem[], unavailable: false };
  try {
    const { data, error } = await createAdminClient().rpc("school_office_attention", { p_actor: staff.id, p_session: sessionLabel, p_confined: isConfinedDeployment() });
    if (error || !data) return { ...result, unavailable: true };
    const snapshot = data as AttentionSnapshot;
    if (!Array.isArray(snapshot.certificate_candidates) || !Array.isArray(snapshot.certificate_artifacts) || !Array.isArray(snapshot.return_batches)) return { ...result, unavailable: true };
    if (certificates) {
      const template = templateSchema.safeParse(snapshot.template);
      result.unavailable = snapshot.certificate_unavailable || !template.success;
      if (template.success) result.items.push(...certificateAttentionItems(snapshot.certificate_candidates.filter(row => row.facts.sessionLabel === sessionLabel), template.data));
      if (snapshot.certificate_candidates.some(row => row.facts.sessionLabel === sessionLabel && !row.facts.sourceCurrent)) result.unavailable = true;
      result.items.push(...snapshot.certificate_artifacts.filter(row => row.session_label === sessionLabel && ["failed", "preparing"].includes(row.artifact_state)).map(row => ({
        id: row.id, kind: "certificate_artifact" as const, href: `/school-office/certificates/${row.id}`, studentName: row.student_name, state: row.artifact_state,
      })));
    }
    if (government) result.items.push(...returnAttentionItems(snapshot.return_batches.filter(row => row.session_label === sessionLabel)));
    result.items = result.items.slice(0, 4);
    return result;
  } catch { return { ...result, unavailable: true }; }
}
