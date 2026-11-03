import type { CertificateCommand, CertificateResult } from "@/modules/certificates/domain/certificate";
import type { ReturnImportRow } from "@/modules/government-records/domain/exchange";
export type Call = { name: string; input: unknown };
declare global { interface Window { schoolOfficeCalls: Call[]; schoolOfficeScenario: string } }
window.schoolOfficeCalls = [];
function log(name: string, input: unknown) { window.schoolOfficeCalls.push({ name, input }); sessionStorage.setItem("synthetic-office-calls", JSON.stringify(window.schoolOfficeCalls)); }
export async function generateStudyCertificateAction(input: CertificateCommand): Promise<CertificateResult> {
  log("generate", input);
  if (window.schoolOfficeScenario === "blocked") return { ok: false, code: "blocked", blockers: [{ field: "admissionNo", reason: "missing_field" }, { field: "identity", reason: "identity_unverified" }] };
  if (window.schoolOfficeScenario === "retry" && window.schoolOfficeCalls.filter(c => c.name === "generate").length === 1) throw new Error("Synthetic interrupted response");
  return { ok: true, issueId: "synthetic-issue", existing: false };
}
export const generateCertificateAction = generateStudyCertificateAction;
export async function handOverManyAction(input: { items: { issueId: string }[] }) { log("hand-over", input); return { ok: true as const, done: input.items.map((item) => item.issueId) }; }
export async function saveCertificateIdentityAction(input: unknown) { log("save-identity", input); return { ok: true as const }; }
export async function certificateEventAction(input: unknown) { log("certificate-event", input); return { ok: !(window.schoolOfficeScenario === "event-denied" && window.schoolOfficeCalls.filter(call => call.name === "certificate-event").length === 1) }; }
export async function saveCertificateTemplateAction(input: unknown) { log("save-template", input); return { ok: true as const }; }
export async function checkReturnAction(input: unknown) {
  log("check-return", input);
  const rows = [{ studentId: "synthetic-ready", name: "Synthetic Ready Child", state: "ready" as const, reasons: [] }, { studentId: "synthetic-blocked", name: "Synthetic Missing SR / पहचान में अंतर वाला परीक्षण विद्यार्थी", state: "blocked" as const, reasons: ["missing:admissionNo", "duplicate_identity"] }];
  return { ok: true as const, rows, mode: (input as { adapterId?: string }).adapterId ? "verified_upload" as const : "manual_reference" as const, sourceRevision: "synthetic-source-revision" };
}
export async function prepareReturnAction(input: unknown) { log("prepare-return", input); return { ok: true as const, id: "synthetic-batch" }; }
export async function applyReturnAction(input: unknown) { log("apply-return", input); return { ok: true as const }; }
export async function recordReturnOutcomeAction(input: FormData) { log("record-outcome", Object.fromEntries(input)); return { ok: true as const }; }
export async function markCopilotRowAction(input: { state: "entered" | "mismatch"; note?: string }) {
  log("mark-copilot", input);
  if (window.schoolOfficeScenario === "mark-fails") return { ok: false as const };
  return { ok: true as const, mark: { state: input.state, note: input.note ?? null, updatedAt: "2026-11-03T10:00:00Z" } };
}
export async function resumeReturnAction(input: unknown) { log("resume-return", input); return { ok: true as const }; }
export async function stageReturnAction(input: FormData) { log("stage-return", Object.fromEntries(input)); return { ok: true as const, id: "synthetic-import" }; }
export async function inspectReturnSpecimenAction(input: FormData) { log("inspect-specimen", Object.fromEntries(input)); return { ok: true as const, headers: ["Admission number", "School", "Session", "External ID"] }; }
export async function saveReturnAdapterAction(input: FormData) { log("save-adapter", Object.fromEntries(input)); return { ok: true as const }; }
export const importPreview: ReturnImportRow[] = [{ row: 2, studentId: "synthetic-child", studentName: "Synthetic Conflict Child / परीक्षण विद्यार्थी", state: "conflict", reasons: ["protected_field:studentName"], changes: {}, expectedRevision: 1, sourceRevision: "synthetic-source" }];
export async function saveBoardCycleAction(input: unknown) { log("save-board-cycle", input); return { ok: true as const }; }
export async function saveBoardCandidateAction(input: unknown) { log("save-board-candidate", input); return { ok: true as const }; }
export async function saveBoardReadinessAction(input: unknown) { log("save-board-readiness", input); return { ok: true as const }; }
export async function saveOfficialResultAction(input: FormData) { log("save-official-result", JSON.parse(String(input.get("input")))); return { ok: true as const }; }
