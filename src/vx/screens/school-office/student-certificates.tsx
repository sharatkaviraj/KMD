"use client";
import { useEffect, useState } from "react";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { dateLabel } from "@/vx/format";
import { Btn, Pill } from "@/vx/ui/primitives";
import { certificateKinds, type CertificateKind, type CertificateStatus } from "@/modules/certificates/domain/certificate";
import { CertificateSheet } from "./certificate-sheet";
import { CERTIFICATE_STATUS, KIND_LABELS, O } from "./text";
import "./cert.css";

type Row = { id: string; serial: string; status: CertificateStatus; kind?: CertificateKind; issuedAt?: string; ready?: boolean };
const asKind = (value: string | null): CertificateKind | undefined => (certificateKinds as readonly string[]).includes(value ?? "") ? value as CertificateKind : undefined;

/**
 * The student's certificates: a header action that opens the certificate sheet,
 * and, in the Documents tab, the school-issued list with the same action.
 * `?certificate=tc` on the profile URL opens the sheet on that kind.
 */
export function StudentCertificateTools({ studentId, studentName = "", sessionLabel, canIssue, mode = "action", editHref }: { studentId: string; studentName?: string; sessionLabel: string; canIssue: boolean; mode?: "action" | "list"; editHref?: string }) {
  const { tx } = useVx();
  // `?certificate=tc` opens the sheet on that kind; read once, on mount (this
  // component is client-only inside Student 360).
  const [initialKind] = useState<CertificateKind | undefined>(() => mode === "action" && canIssue && typeof window !== "undefined" ? asKind(new URLSearchParams(window.location.search).get("certificate")) : undefined);
  const [open, setOpen] = useState(() => Boolean(initialKind));
  const [rows, setRows] = useState<Row[] | null>(null); const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (mode !== "list") return;
    const controller = new AbortController();
    void fetch(`/school-office/certificates?student=${encodeURIComponent(studentId)}&session=${encodeURIComponent(sessionLabel)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Unavailable");
      const body = await response.json();
      if (!controller.signal.aborted) { setRows(body.rows); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [studentId, sessionLabel, mode, retry]);

  const sheet = canIssue ? <CertificateSheet open={open} onClose={() => { setOpen(false); if (mode === "list") setRetry((v) => v + 1); }} studentId={studentId} studentName={studentName} sessionLabel={sessionLabel} editHref={editHref} initialKind={initialKind} /> : null;
  if (mode === "action") return canIssue ? <><Btn icon="award" onClick={() => setOpen(true)}>{tx(O.certificate)}</Btn>{sheet}</> : null;

  return <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <strong style={{ flex: 1 }}>{tx(O.schoolIssued)}</strong>
      {canIssue ? <Btn variant="pri" icon="award" onClick={() => setOpen(true)}>{tx(O.certificate)}</Btn> : null}
    </div>
    {failed ? <div role="alert"><p>{tx(O.loadFailed)}</p><Btn onClick={() => setRetry((v) => v + 1)}>{tx(O.retry)}</Btn></div>
      : rows === null ? <span role="status" className="cert-busy-text" style={{ textAlign: "left" }}>{tx(O.loading)}</span>
      : rows.length ? <div style={{ display: "grid" }}>{rows.map((row, index) => <a key={row.id} href={`/school-office/certificates/${row.id}`} className="tray-row" style={{ padding: "11px 2px", animationDelay: `${index * 35}ms`, color: "var(--fg)" }}>
        <span className="cert-kind-ic" style={{ width: 34, height: 34, borderRadius: 10, background: "var(--s2)", color: "var(--pri)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}><Ic n="fileText" size={16} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: 13.5 }}>{tx(KIND_LABELS[row.kind ?? "study"])}</strong>
          <span className="num" style={{ fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>{row.serial}{row.issuedAt ? ` · ${dateLabel(row.issuedAt)}` : ""}</span>
        </span>
        <Pill tone={row.status === "issued" ? "ok" : row.status === "prepared" ? "warn" : "mut"}>{tx(CERTIFICATE_STATUS[row.status])}</Pill>
      </a>)}</div>
      : <p style={{ color: "var(--mut)", margin: 0 }}>{tx(O.noIssued)}</p>}
    <Btn href={`/school-office?student=${studentId}`}>{tx(O.openRegister)}</Btn>
    {sheet}
  </div>;
}
