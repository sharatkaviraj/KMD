import { useSyncExternalStore } from "react";
import { DEFAULT_IDENTITY } from "@/modules/certificates/domain/identity";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { VxPage, Section } from "@/vx/ui/page";
import { CertificateRegister } from "@/vx/screens/school-office/certificates";
import { StudyCertificateButton } from "@/vx/screens/school-office/study-certificate-button";
import { CertificateDetail } from "@/vx/screens/school-office/certificate-detail";
import { CertificateTemplateForm } from "@/vx/screens/school-office/template";
import { ReturnsBoard } from "@/vx/screens/school-office/returns";
import { ReturnDestination } from "@/vx/screens/school-office/return-destination";
import { PortalCopilot } from "@/vx/screens/school-office/copilot";
import { returnDestinations, readinessCounts, readinessGrid, cellStudents, type Destination } from "@/modules/government-records/domain/readiness";
import { copilotSheet } from "@/modules/government-records/domain/copilot";
import { preflightReturn, type ReturnStudent } from "@/modules/government-records/domain/exchange";
import { ReturnBatchDetail } from "@/vx/screens/school-office/return-detail";
import { ReturnFormatForm } from "@/vx/screens/school-office/return-format";
import { BoardWorkspace } from "@/vx/screens/board-office/workspace";
import { boardData, boardRoster } from "./board-data";
import { defaultStudyTemplate, type CertificateIssue } from "@/modules/certificates/domain/certificate";
import { manualReferenceAdapter, type GovernmentBatch, type GovernmentAdapter } from "@/modules/government-records/domain/exchange";
import { importPreview } from "./actions";
import "../../src/app/globals.css";
import "../../src/vx/vx.css";
import "./fixture.css";

const params = new URLSearchParams(location.search);
const language = params.get("language") === "hi" ? "hi" : params.get("language") === "both" ? "both" : "en";
const screen = params.get("screen") ?? "register";
window.schoolOfficeScenario = params.get("state") ?? "ready";
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
document.documentElement.lang = language === "hi" ? "hi" : "en";
const studentId = "00000000-0000-4000-8000-000000000001", sessionLabel = "TEST-2026-27";
const issuedAt = "2026-11-01T12:00:00Z";
const longName = "SyntheticLongUnbrokenStudentNameForWrappingChecks परीक्षण विद्यार्थी बहुत लंबा नाम विद्यालय कार्यालय";
const issue: CertificateIssue = {
  id: "synthetic-issue", student_id: studentId, session_label: sessionLabel, serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", status: "prepared", artifact_state: "ready", issued_by: "synthetic-staff", issued_at: issuedAt, storage_path: "synthetic.pdf", artifact_sha256: null, supersedes: null, reason: null,
  snapshot: { serial: "TEST/VPPS/STUDY/TEST-2026-27/0001", issuedAt, issuedOn: "2026-11-01", isTest: true, template: defaultStudyTemplate, school: { name: "Synthetic School", address: "Synthetic locality", phone: "", email: "school@example.invalid" }, facts: { studentId, enrolmentId: "synthetic-enrolment", classId: "synthetic-class", studentName: longName, admissionNo: "SYN-001", classLabel: "Class 10 · A", sessionLabel, status: "current", enrolledOn: "2026-04-01", leftOn: null, dateOfBirth: null, fatherName: null, motherName: null, identityVerified: true, sourceCurrent: true, sourceRevision: "synthetic-source", checkedAt: issuedAt } },
};
const adapter = manualReferenceAdapter("psp", "Student records", sessionLabel, "SYN-SCHOOL");
const verifiedAdapter: GovernmentAdapter = { ...adapter, mode: "verified_upload", specimenSha256: "a".repeat(64), verifiedOn: "2026-11-01", sourceReference: "Synthetic current official specimen; no real records", columns: [...adapter.columns, { header: "External ID", field: "externalId", required: false }] };
const batch: GovernmentBatch = { id: "synthetic-batch", session_label: sessionLabel, portal: "psp", module: "Synthetic student records / परीक्षण विद्यार्थी विवरण", direction: "export", state: "exported", adapter, payload: { counts: { selected: 2, ready: 1, excluded: 1 }, sourceRevision: "synthetic-source" }, file_path: "synthetic.xlsx", file_sha256: null, file_name: "synthetic.xlsx", created_at: issuedAt, updated_at: issuedAt, revision: 1, parent_batch_id: null, evidence_path: null, acknowledgement: null, source_hash: null };
// Synthetic readiness: two classes, one ready child each, one missing SR and one duplicate identity.
const child = (n: number, classId: string, classLabel: string, extra: Partial<ReturnStudent> = {}): ReturnStudent => ({ studentId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, admissionNo: `SYN-${n}`, studentName: n === 3 ? longName : `Synthetic Child ${n} / परीक्षण विद्यार्थी ${n}`, classLabel, classId, sessionLabel, schoolCode: "SYN-SCHOOL", externalId: "", registrationStatus: "", sourceRevision: "synthetic-source-revision", externalRevision: 0, identityVerified: true, ...extra });
const readinessRows = [child(1, "class-9", "Class 9 · A"), child(2, "class-9", "Class 9 · A", { admissionNo: "" }), child(3, "class-10", "Class 10 · A"), child(4, "class-10", "Class 10 · A", { identityVerified: false })];
const destinations = returnDestinations([{ id: "synthetic-verified-format", adapter: verifiedAdapter, version: 1 }], [batch]);
function destinationScreen(verified: boolean) {
  const destination: Destination = destinations.find(d => d.mode === (verified ? "verified_upload" : "manual_reference") && d.portal === "psp")!;
  const adapterFor = verified ? verifiedAdapter : manualReferenceAdapter("psp", destination.module, sessionLabel, "");
  const preflight = preflightReturn(readinessRows, adapterFor), grid = readinessGrid(readinessRows, preflight);
  const local = new URLSearchParams(location.search), classId = local.get("class"), issue = local.get("issue");
  const selected = classId || issue ? { classId, issue } : null;
  return <ReturnDestination sessionLabel={sessionLabel} destination={destination} counts={window.schoolOfficeScenario === "source-unavailable" ? null : readinessCounts(preflight)} grid={window.schoolOfficeScenario === "source-unavailable" ? null : grid}
    selected={selected} students={selected ? cellStudents(readinessRows, preflight, classId, issue) : []} sourceRevision="synthetic-source-revision"
    batches={[{ id: batch.id, state: batch.state, created_at: batch.created_at, direction: batch.direction, mode: batch.adapter.mode }]}
    manual={window.schoolOfficeScenario === "continue" ? { batchId: batch.id, total: 2, entered: 1, mismatch: 0 } : null} askHref="/collection/rounds/new?class=class-9" canExport canManage />;
}
const copilotRows = copilotSheet(readinessRows.slice(0, 3).map(row => ({ ...row, admissionNo: row.admissionNo || "=SUM(1)" })), adapter);
const subscribe = (fn: () => void) => { window.addEventListener("popstate", fn); return () => window.removeEventListener("popstate", fn); };
function Fixture() {
  const path = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const local = new URLSearchParams(location.search);
  const destination = location.pathname.startsWith("/school-office/certificates/") ? "certificate" : location.pathname === "/exam-office/board" ? "board" : location.pathname === "/exam-office/official-results" ? "results" : location.pathname === "/school-office/returns/synthetic-batch" ? "batch" : location.pathname === "/school-office/returns/synthetic-batch/copilot" ? "copilot" : location.pathname.startsWith("/school-office/returns/d/") ? "destination" : location.pathname === "/school-office/returns" ? "returns" : location.pathname === "/school-office" ? "register" : location.pathname.startsWith("/admissions/") ? "source" : screen;
  void path;
  return <LanguageProvider language={language}><VxPage label="Synthetic school office QA"><Section>
    {destination === "profile" ? <><h1>Synthetic student profile</h1><StudyCertificateButton studentId={studentId} sessionLabel={sessionLabel} editHref={`/admissions/${studentId}`} /></> : null}
    {destination === "source" ? <h1>Synthetic authoritative student correction</h1> : null}
    {destination === "register" ? <CertificateRegister rows={[issue, { ...issue, id: "synthetic-issued", status: "issued" as const, serial: "TEST/VPPS/STUDY/TEST-2026-27/0002" }].filter(row => (!local.get("q") || row.snapshot.facts.studentName.toLowerCase().includes(local.get("q")!.toLowerCase())) && (!local.get("status") || row.status === local.get("status")))} count={local.get("status") ? 1 : 62} page={Number(local.get("page") ?? 1)} query={local.get("q") ?? ""} status={local.get("status") ?? ""} studentId={studentId} sessionLabel={sessionLabel} canManage canGovernment unavailable={window.schoolOfficeScenario === "unavailable"} /> : null}
    {destination === "certificate" ? <CertificateDetail issue={window.schoolOfficeScenario === "artifact-failed" ? { ...issue, artifact_state: "failed" } : issue} events={[{ id: "event-1", kind: "prepared", created_at: issuedAt, actor_id: "synthetic-staff", reason: null }]} canIssue canManage /> : null}
    {destination === "template" ? <CertificateTemplateForm templates={{ study: defaultStudyTemplate }} identity={DEFAULT_IDENTITY} schoolName="Synthetic School" /> : null}
    {destination === "returns" ? <ReturnsBoard sessionLabel={sessionLabel} cards={destinations.map((d, i) => ({ destination: d, counts: window.schoolOfficeScenario === "source-unavailable" ? null : readinessCounts(preflightReturn(readinessRows, d.mode === "verified_upload" ? verifiedAdapter : manualReferenceAdapter(d.portal, d.module, sessionLabel, ""))), latest: i === 0 ? { id: batch.id, state: batch.state, created_at: batch.created_at } : null, manual: null }))} canManage unavailable={false} sourceUnavailable={window.schoolOfficeScenario === "source-unavailable"} /> : null}
    {destination === "destination" ? destinationScreen(window.schoolOfficeScenario === "verified") : null}
    {destination === "copilot" ? <PortalCopilot batchId={batch.id} title="PSP · Synthetic · TEST-2026-27" headers={copilotRows.headers} rows={copilotRows.rows} marks={window.schoolOfficeScenario === "resume" ? { [copilotRows.rows[0].key]: { state: "entered", note: null, updatedAt: issuedAt } } : {}} canMark /> : null}
    {destination === "batch" ? <ReturnBatchDetail batch={window.schoolOfficeScenario === "partial" ? { ...batch, state: "submitted", payload: { ...batch.payload, rows: boardRoster } } : window.schoolOfficeScenario === "partial-recorded" ? { ...batch, state: "partially_accepted", payload: { ...batch.payload, rows: boardRoster }, row_outcomes: boardRoster.map((student, index) => ({ studentId: student.studentId, state: index === 0 ? "accepted" : "not_accepted" })) } : batch} events={[]} copilot={window.schoolOfficeScenario === "ready" ? { total: 2, entered: 1, mismatches: [{ key: "synthetic-mismatch", name: "Synthetic Child 2 / परीक्षण विद्यार्थी 2", note: "Synthetic: portal shows a different class" }], open: true } : null} canExport canImport /> : null}
    {destination === "import" ? <ReturnBatchDetail batch={{ ...batch, direction: "import", state: "staged", adapter: verifiedAdapter, file_path: null, parent_batch_id: batch.id, payload: { ...batch.payload, counts: { conflict: window.schoolOfficeScenario === "clean" ? 0 : 1 }, preview: window.schoolOfficeScenario === "clean" ? importPreview.map(row => ({ ...row, state: "ready", changes: { externalId: "SYN-EXTERNAL" }, reasons: [] })) : importPreview } }} events={[]} canExport canImport /> : null}
    {destination === "format" ? <ReturnFormatForm sessionLabel={sessionLabel} adapters={[]} /> : null}
    {destination === "board" || destination === "results" ? <BoardWorkspace workspace={boardData(window.schoolOfficeScenario)} sessionLabel={sessionLabel} mode={destination === "board" ? "board" : "results"} canManage unavailable={false} /> : null}
  </Section><div id="vx-layer" /></VxPage></LanguageProvider>;
}
document.addEventListener("click", event => {
  const anchor = (event.target as Element).closest("a"), href = anchor?.getAttribute("href");
  if (!href?.startsWith("/") || anchor?.target === "_blank" || event.defaultPrevented || (event as MouseEvent).ctrlKey || (event as MouseEvent).metaKey) return;
  event.preventDefault(); history.pushState(null, "", href); window.dispatchEvent(new PopStateEvent("popstate"));
});
document.addEventListener("submit", event => {
  const form = event.target as HTMLFormElement;
  if (form.getAttribute("action") !== "/school-office") return;
  event.preventDefault(); history.pushState(null, "", `/school-office?${new URLSearchParams(new FormData(form) as unknown as Record<string, string>)}`); window.dispatchEvent(new PopStateEvent("popstate"));
});
createRoot(document.getElementById("root")!).render(<Fixture />);
