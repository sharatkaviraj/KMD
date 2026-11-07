"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { approveCertificateRequestAction, declineCertificateRequestAction } from "@/app/(app)/school-office/actions";
import type { CertificateBlocker, CertificateExtra } from "@/modules/certificates/domain/certificate";
import type { CertificateRequestRow, RequestErrorCode } from "@/modules/certificates/domain/request-view";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { dateLabelP } from "@/vx/format";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Pill, SuccessTick } from "@/vx/ui/primitives";
import { downloadCertificate, printCertificate } from "./artifact";
import { CONDUCT_LABELS, EXTRA_LABELS, FIELD_LABELS, KIND_LABELS, O } from "./text";
import { DECLINE_REASONS, R, requestError } from "./request-text";
import "./cert.css";

/** Waits for `work`, and for at least `ms`, so a short animation is seen to finish. */
async function atLeast<T>(ms: number, work: Promise<T>): Promise<T> {
  const [result] = await Promise.all([work, new Promise((resolve) => window.setTimeout(resolve, ms))]);
  return result;
}

type Approval =
  | { at: "working"; row: CertificateRequestRow }
  | { at: "done"; row: CertificateRequestRow; issueId: string; serial: string }
  | { at: "blocked"; row: CertificateRequestRow; blockers: CertificateBlocker[] }
  | { at: "failed"; row: CertificateRequestRow; code: RequestErrorCode };

/**
 * "Asked by teachers" (D-542): every waiting request with the facts the
 * approver checks before signing — father's name and date of birth — and two
 * answers. "Approve and sign" makes the certificate under the approver's own
 * name, with the principal's signature and the school seal printed on it;
 * "Decline" needs a reason the teacher will read.
 */
export function CertificateRequestQueue({ rows }: { rows: CertificateRequestRow[] }) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [approval, setApproval] = useState<Approval | null>(null);
  const [declining, setDeclining] = useState<CertificateRequestRow | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const waiting = useMemo(() => rows.filter((row) => row.state === "waiting" && !answered.has(row.id)), [rows, answered]);
  const recent = rows.filter((row) => row.state !== "waiting").slice(0, 6);
  if (!waiting.length && !recent.length) return null;

  async function approve(row: CertificateRequestRow) {
    if (busy) return;
    setBusy(true);
    setApproval({ at: "working", row });
    try {
      // Let the stamp land before the answer replaces it.
      const result = await atLeast(1100, approveCertificateRequestAction({ requestId: row.id }));
      if (result.ok) {
        setApproval({ at: "done", row, issueId: result.issueId, serial: result.serial });
        setAnswered((old) => new Set([...old, row.id]));
        toast.show({ text: tx(R.approved), tone: "ok", cue: "done" });
      } else if (result.code === "blocked" && "blockers" in result && result.blockers?.length) setApproval({ at: "blocked", row, blockers: result.blockers });
      else setApproval({ at: "failed", row, code: result.code });
    } catch { setApproval({ at: "failed", row, code: "unavailable" }); }
    finally { setBusy(false); }
  }

  async function decline() {
    const row = declining;
    if (!row || busy || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const result = await declineCertificateRequestAction({ requestId: row.id, reason: reason.replace(/[{}<>]/g, "").trim().slice(0, 300) });
      if (result.ok) {
        setAnswered((old) => new Set([...old, row.id]));
        setDeclining(null);
        setReason("");
        toast.show({ text: tx(R.declined), tone: "info" });
        window.setTimeout(() => router.refresh(), 400);
      } else toast.show({ text: tx(requestError(result.code)), tone: "bad" });
    } catch { toast.show({ text: tx(requestError("unavailable")), tone: "bad" }); }
    finally { setBusy(false); }
  }

  function closeApproval() {
    const done = approval?.at === "done";
    setApproval(null);
    if (done) window.setTimeout(() => router.refresh(), 300);
  }

  const blockerText = (b: CertificateBlocker) => b.field === "identity" ? O.identity : b.field === "source" ? O.source : b.field === "template" ? O.templateMissing
    : b.field in EXTRA_LABELS ? EXTRA_LABELS[b.field as CertificateExtra] : FIELD_LABELS[b.field as keyof typeof FIELD_LABELS] ?? O.details;

  return <section id="requests" className="card" aria-label={tx(R.queue)} style={{ overflow: "hidden", animation: "xRise .42s var(--ease) both" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 6px", flexWrap: "wrap" }}>
      <span className="cert-req-ic" style={{ background: "var(--accs)", color: "var(--accfg)" }} aria-hidden="true"><Ic n="award" size={19} /></span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <h2 className="serif" style={{ margin: 0, fontSize: 21 }}>{tx(R.queue)} {waiting.length ? <span className="num" style={{ color: "var(--warn)" }}>{waiting.length}</span> : null}</h2>
        {sub(R.queue) ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub(R.queue)}</span> : null}
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--mut)" }}>{tx(R.queueHint)}</p>
      </div>
    </div>
    <div style={{ padding: "0 16px 12px" }}>
      {waiting.map((row, index) => <article key={row.id} className="cert-req" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span className="cert-req-ic warn" aria-hidden="true"><Ic n="fileText" size={19} /></span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <strong style={{ fontSize: 15.5, overflowWrap: "anywhere" }}>{row.studentName || "—"}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{[row.classLabel, row.admissionNo ? `SR ${row.admissionNo}` : null].filter(Boolean).join(" · ")}</span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              <span className="kind-pill">{tx(KIND_LABELS[row.kind])}</span>
              {row.extras?.conduct ? <span className="kind-pill">{tx(EXTRA_LABELS.conduct)}: {tx(CONDUCT_LABELS[row.extras.conduct])}</span> : null}
            </span>
          </span>
        </div>
        <dl className="cert-check">
          {row.purpose ? <><dt>{tx(R.forPurpose)}</dt><dd>{row.purpose}</dd></> : null}
          <dt>{tx(R.father)}</dt><dd>{row.fatherName || "—"}</dd>
          <dt>{tx(R.born)}</dt><dd>{row.dateOfBirth ? tx(dateLabelP(row.dateOfBirth)) : "—"}</dd>
          <dt>{tx(R.askedBy)}</dt><dd>{row.requestedByName} · {tx(dateLabelP(row.requestedAt))}</dd>
          {row.note ? <><dt>{tx(R.noteFrom)}</dt><dd style={{ fontWeight: 500 }}>“{row.note}”</dd></> : null}
        </dl>
        <div className="cert-req-actions">
          <Btn variant="pri" icon="check" disabled={busy} onClick={() => approve(row)}>{tx(R.approve)}</Btn>
          <Btn icon="x" disabled={busy} onClick={() => { setReason(""); setDeclining(row); }}>{tx(R.decline)}</Btn>
        </div>
      </article>)}
      {recent.length ? <div style={{ marginTop: waiting.length ? 6 : 0, opacity: .8 }}>
        {recent.map((row) => <div key={row.id} className="tray-row" style={{ padding: "10px 2px" }}>
          <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", fontSize: 13.5, overflowWrap: "anywhere" }}>{row.studentName}</strong><span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(KIND_LABELS[row.kind])} · {row.requestedByName}{row.serial ? <> · <span className="num">{row.serial}</span></> : null}</span></span>
          <Pill tone={row.state === "approved" ? "ok" : "mut"}>{tx(row.state === "approved" ? R.approved : R.declined)}</Pill>
        </div>)}
      </div> : null}
    </div>

    <Sheet open={approval !== null} onClose={closeApproval} title={tx(R.approve)} sub={approval?.row.studentName} icon="award" dismissable={approval?.at !== "working"}
      footer={approval?.at === "done" ? <Btn variant="pri" big full icon="check" onClick={closeApproval}>{tx(R.done)}</Btn>
        : approval?.at === "failed" && approval.code === "unavailable" ? <Btn variant="pri" big full icon="refresh" onClick={() => approve(approval.row)}>{tx(R.retry)}</Btn>
        : undefined}>
      {approval?.at === "working" ? <div className="cert-stack" aria-live="polite">
        <div className="cert-stamp-anim" aria-hidden="true">
          <div className="cert-paper busy" style={{ width: 170 }}><div className="cp-title" /><div className="cp-line s" style={{ marginTop: 10 }} /><div className="cp-name" /><div className="cp-line" /><div className="cp-line" /><div className="cp-line s" /></div>
          <span className="seal">VPPS<br />AMET</span>
        </div>
        <p className="cert-busy-text">{tx(R.approving)}</p>
      </div> : null}
      {approval?.at === "done" ? <div className="cert-done" aria-live="polite">
        <SuccessTick size={64} />
        <strong style={{ fontSize: 18 }}>{tx(R.approved)}</strong>
        <div className="cert-serial">{approval.serial}</div>
        <p className="cert-note" style={{ margin: 0 }}>{approval.row.requestedByName}: {tx(R.approvedBody)}</p>
        <div className="cert-actions" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
          <Btn icon="printer" onClick={() => { void printCertificate(approval.issueId); }}>{tx(R.print)}</Btn>
          <Btn icon="download" onClick={() => { void downloadCertificate(approval.issueId); }}>{tx(R.download)}</Btn>
          <Btn icon="history" href={`/school-office/certificates/${approval.issueId}`}>{tx(R.openIssue)}</Btn>
        </div>
      </div> : null}
      {approval?.at === "blocked" ? <div className="cert-stack" aria-live="polite">
        <strong>{tx(R.details)}</strong>
        <div className="cert-blockers">{approval.blockers.map((b, index) => <div key={`${b.field}:${b.reason}`} className="cert-blocker" style={{ animationDelay: `${index * 50}ms` }}><Ic n="alert" size={17} /><span>{tx(blockerText(b))}</span></div>)}</div>
        <Btn variant="pri" icon="edit" href={`/students/${approval.row.studentId}`}>{tx(R.fixRecord)}</Btn>
      </div> : null}
      {approval?.at === "failed" ? <div role="alert" className="cert-blocker"><Ic n="alert" size={17} /><span>{tx(requestError(approval.code))}</span></div> : null}
    </Sheet>

    <Sheet open={declining !== null} onClose={() => setDeclining(null)} title={tx(R.declineTitle)} sub={declining?.studentName} icon="x"
      footer={<Btn variant="danger" big full disabled={busy || reason.trim().length < 3} onClick={decline}>{busy ? "…" : tx(R.declineSend)}</Btn>}>
      <div className="cert-q">
        <span>{tx(R.reason)}</span>
        <div className="cert-chips">{DECLINE_REASONS.map((pair) => <button key={pair.en} type="button" className="cert-chip" aria-pressed={reason === tx(pair)} onClick={() => setReason(tx(pair))}>{tx(pair)}</button>)}</div>
        <textarea className="inp" rows={3} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  </section>;
}
