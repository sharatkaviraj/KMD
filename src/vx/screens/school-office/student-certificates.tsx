"use client";
import { useEffect, useState } from "react";
import { useVx } from "@/vx/i18n";
import { Btn } from "@/vx/ui/primitives";
import { StudyCertificateButton } from "./study-certificate-button";
import { O, CERTIFICATE_STATUS } from "./text";
import type { CertificateStatus } from "@/modules/certificates/domain/certificate";

type Row = { id: string; serial: string; status: CertificateStatus };
export function StudentCertificateTools({ studentId, sessionLabel, canIssue, mode = "action", editHref }: { studentId: string; sessionLabel: string; canIssue: boolean; mode?: "action" | "list"; editHref?: string }) {
  const { tx } = useVx(); const [rows, setRows] = useState<Row[] | null>(null); const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
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
  if (mode === "action") return canIssue ? <StudyCertificateButton studentId={studentId} sessionLabel={sessionLabel} editHref={editHref} /> : null;
  return <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
    <strong>{tx(O.schoolIssued)}</strong>
    {canIssue ? <StudyCertificateButton studentId={studentId} sessionLabel={sessionLabel} editHref={editHref} /> : null}
    {failed ? <div role="alert"><p>{tx(O.loadFailed)}</p><Btn onClick={() => setRetry((v) => v + 1)}>{tx(O.retry)}</Btn></div> : rows === null ? <span role="status">{tx(O.loading)}</span> : rows.length ? rows.map((row) => <a key={row.id} href={`/school-office/certificates/${row.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingTop: 10, borderTop: "1px solid var(--bd)", overflowWrap: "anywhere", fontSize: 13 }}><strong>{row.serial}</strong><span>{tx(CERTIFICATE_STATUS[row.status])}</span></a>) : <p style={{ color: "var(--mut)", margin: 0 }}>{tx(O.noIssued)}</p>}
    <Btn href={`/school-office?student=${studentId}`}>{tx(O.openRegister)}</Btn>
  </div>;
}
