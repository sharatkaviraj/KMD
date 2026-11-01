"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { certificateEventAction } from "@/app/(app)/school-office/actions";
import type { CertificateEvent, CertificateIssue } from "@/modules/certificates/domain/certificate";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { dateLabel } from "@/vx/format";
import { Btn, Pill } from "@/vx/ui/primitives";
import { StudyCertificateButton } from "./study-certificate-button";
import { CERTIFICATE_STATUS, O } from "./text";
import "./office.css";

export function CertificateDetail({ issue, events, canIssue, canManage }: { issue: CertificateIssue; events: CertificateEvent[]; canIssue: boolean; canManage: boolean }) {
  const { tx } = useVx(); const router = useRouter();
  const [mode, setMode] = useState<"cancelled" | "correct" | null>(null);
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const command = useRef<string | null>(null);
  const requests = useRef<{ download_requested: string | null; print_requested: string | null }>({ download_requested: null, print_requested: null });
  const requesting = useRef(false);
  const current = issue.status === "prepared" || issue.status === "issued";
  const ready = issue.artifact_state === "ready";
  async function event(kind: "handed_over" | "cancelled") {
    if (busy) return; setBusy(true); setFailed(false); command.current ??= crypto.randomUUID();
    try {
      const result = await certificateEventAction({ issueId: issue.id, kind, commandId: command.current, ...(kind === "cancelled" ? { reason } : {}) });
      if (result.ok) { command.current = null; setMode(null); router.refresh(); } else setFailed(true);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  async function requestArtifact(kind: "download_requested" | "print_requested") {
    if (requesting.current || busy) return;
    requesting.current = true; setBusy(true); setFailed(false);
    const printWindow = kind === "print_requested" ? window.open("about:blank", "_blank") : null;
    if (printWindow) printWindow.opener = null;
    requests.current[kind] ??= crypto.randomUUID();
    try {
      const result = await certificateEventAction({ issueId: issue.id, kind, commandId: requests.current[kind] });
      if (!result.ok) { printWindow?.close(); setFailed(true); return; }
      requests.current[kind] = null;
      const href = `/school-office/certificates/${issue.id}/pdf${kind === "download_requested" ? "?download=1" : ""}`;
      if (printWindow) printWindow.location.href = href;
      else {
        // The response is stored binary PDF bytes, not a Next.js page.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(href);
      }
    } catch { printWindow?.close(); setFailed(true); }
    finally { requesting.current = false; setBusy(false); }
  }
  const names: Record<string, ReturnType<typeof p>> = { prepared: O.prepared, artifact_ready: p("PDF stored", "पीडीएफ सुरक्षित"), handed_over: CERTIFICATE_STATUS.issued, cancelled: CERTIFICATE_STATUS.cancelled, superseded: CERTIFICATE_STATUS.superseded, download_requested: p("Download requested", "डाउनलोड का अनुरोध"), print_requested: p("Print requested", "प्रिंट का अनुरोध") };
  return <>
    <div className="office-tools"><Btn icon="chevLeft" href="/school-office">{tx(O.register)}</Btn><Btn className="wrap" style={{ overflowWrap: "anywhere", height: "auto", minHeight: 44, padding: "8px 16px", lineHeight: 1.5 }} href={`/students/${issue.student_id}?tab=documents`}>{issue.snapshot.facts.studentName}</Btn><Pill tone={current ? "warn" : "mut"}>{tx(CERTIFICATE_STATUS[issue.status])}</Pill></div>
    <div className="office-note" role="status"><strong>{issue.serial}</strong><br />{tx(O.manual)}{issue.snapshot.isTest ? <p style={{ color: "var(--bad)" }}>{tx(O.test)}</p> : null}</div>
    {!current ? <div className="office-note">{tx(O.archived)}</div> : null}
    <div className="office-tools">
      {ready ? <><Btn variant="pri" icon="download" disabled={busy} onClick={() => requestArtifact("download_requested")}>{tx(O.download)}</Btn><Btn icon="printer" disabled={busy} onClick={() => requestArtifact("print_requested")}>{tx(O.print)}</Btn></> : canIssue ? <StudyCertificateButton studentId={issue.student_id} sessionLabel={issue.session_label} resumeIssue={issue.id} label={tx(O.retry)} /> : null}
      {current && ready && issue.status === "prepared" && canIssue ? <Btn disabled={busy} onClick={() => event("handed_over")}>{tx(O.handover)}</Btn> : null}
      {current && canManage ? <><Btn onClick={() => { command.current = null; setReason(""); setMode("correct"); }}>{tx(O.correct)}</Btn><Btn onClick={() => { command.current = null; setReason(""); setMode("cancelled"); }}>{tx(O.cancelled)}</Btn></> : null}
    </div>
    {current && ready && canIssue ? <details className="card" style={{ padding: 16 }}><summary style={{ cursor: "pointer" }}>{tx(p("Create another issue", "एक और प्रति जारी करें"))}</summary><p>{tx(p("This creates a fresh issue date and number. Use Download or Print for the original copy.", "इससे नई तारीख और संख्या जारी होगी। मूल प्रति के लिए डाउनलोड या प्रिंट उपयोग करें।"))}</p><StudyCertificateButton studentId={issue.student_id} sessionLabel={issue.session_label} newIssue label={tx(p("Issue with a new number", "नई संख्या से जारी करें"))} /></details> : null}
    {failed ? <div role="alert" className="office-note">{tx(O.saveFailed)}</div> : null}
    {mode ? <div className="card office-form" style={{ padding: 18 }}>
      <p style={{ margin: 0 }}>{tx(mode === "correct" ? O.correctionHint : p("The original remains in history and its number will not be reused.", "मूल प्रति इतिहास में रहेगी और उसकी संख्या दोबारा नहीं दी जाएगी।"))}</p>
      {mode === "correct" ? <Btn href={`/admissions/${issue.student_id}`}>{tx(O.fix)}</Btn> : null}
      <label className="field"><span>{tx(O.reason)}</span><textarea className="inp" maxLength={500} value={reason} onChange={(e) => { command.current = null; setReason(e.target.value); }} /></label>
      {mode === "correct" ? <StudyCertificateButton key={reason} studentId={issue.student_id} sessionLabel={issue.session_label} newIssue supersedes={issue.id} reason={reason} label={tx(O.correct)} /> : <Btn variant="danger" disabled={busy || reason.trim().length < 3} onClick={() => event("cancelled")}>{tx(O.cancelled)}</Btn>}
    </div> : null}
    <div className="office-detail">
      {ready ? <iframe className="office-preview" src={`/school-office/certificates/${issue.id}/pdf`} title={tx(O.signature)} /> : <div className="office-note">{tx(O.unavailable)}</div>}
      <div className="card office-history"><strong>{tx(O.history)}</strong><p style={{ margin: 0, fontSize: 13, color: "var(--mut)", lineHeight: 1.6 }}>{tx(O.frozen)}</p>{events.map((entry) => <div key={entry.id} style={{ borderTop: "1px solid var(--bd)", paddingTop: 10, fontSize: 13 }}><strong>{tx(names[entry.kind] ?? O.prepared)}</strong><div style={{ color: "var(--mut)" }}>{dateLabel(entry.created_at)}</div>{entry.reason ? <p style={{ overflowWrap: "anywhere" }}>{entry.reason}</p> : null}</div>)}{issue.supersedes ? <Btn href={`/school-office/certificates/${issue.supersedes}`}>{tx(p("Previous issue", "पिछली प्रति"))}</Btn> : null}</div>
    </div>
  </>;
}
