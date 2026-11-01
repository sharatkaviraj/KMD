"use client";
import Link from "next/link";
import { useVx } from "@/vx/i18n";
import { dateLabel } from "@/vx/format";
import { DataList } from "@/vx/ui/page";
import { Btn, EmptyState, Pill } from "@/vx/ui/primitives";
import type { CertificateIssue } from "@/modules/certificates/domain/certificate";
import { CERTIFICATE_STATUS, O } from "./text";
import "./office.css";

export function CertificateRegister({ rows, count, page, query, status, studentId, sessionLabel, canManage, canGovernment, unavailable }: {
  rows: CertificateIssue[]; count: number; page: number; query: string; status: string; studentId?: string; sessionLabel: string; canManage: boolean; canGovernment: boolean; unavailable: boolean;
}) {
  const { tx } = useVx();
  const href = (next: number) => { const sp = new URLSearchParams({ q: query, status, page: String(next), ...(studentId ? { student: studentId } : {}) }); return `/school-office?${sp}`; };
  return <>
    <div className="office-mobile-h"><h1 className="serif" style={{ margin: "0 0 8px", fontSize: 30 }}>{tx(O.title)}</h1></div>
    <div className="office-tools">
      <Link className="chip on" href="/school-office" aria-current="page">{tx(O.certificates)}</Link>
      {canGovernment ? <Link className="chip" href="/school-office/returns">{tx(O.returns)}</Link> : null}
      <span style={{ flex: 1 }} /><Btn icon="search" href="/students">{tx(O.find)}</Btn>
      {canManage ? <Btn icon="settings" href="/school-office/template">{tx(O.setup)}</Btn> : null}
    </div>
    <div className="office-note">{sessionLabel} · {tx(O.manual)}</div>
    <div className="card" style={{ overflow: "hidden" }}>
      <form key={`${query}:${status}:${studentId ?? ""}`} className="office-filters" action="/school-office">
        {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
        <input className="inp" type="search" name="q" defaultValue={query} aria-label={tx(O.search)} placeholder={tx(O.search)} />
        <select className="inp" name="status" defaultValue={status} aria-label={tx(O.status)}><option value="">{tx(O.all)}</option>{Object.entries(CERTIFICATE_STATUS).map(([key, label]) => <option key={key} value={key}>{tx(label)}</option>)}</select>
        <Btn type="submit" variant="pri">{tx(O.searchButton)}</Btn>
      </form>
      {unavailable ? <div role="alert" style={{ padding: 18 }}><p>{tx(O.loadFailed)}</p><Btn href={href(page)}>{tx(O.retry)}</Btn></div> : <DataList rows={rows} rowKey={(row) => row.id} href={(row) => `/school-office/certificates/${row.id}`} caption={tx(O.register)}
        columns={[
          { key: "student", label: tx(O.student), width: "minmax(0,1.3fr)", cell: (row) => <span style={{ overflowWrap: "anywhere", fontWeight: 600 }}>{row.snapshot.facts.studentName}<small style={{ display: "block", color: "var(--mut)", fontWeight: 400 }}>{row.snapshot.facts.classLabel} · SR {row.snapshot.facts.admissionNo}</small></span> },
          { key: "serial", label: tx(O.number), width: "minmax(0,1.3fr)", cell: (row) => <span className="num" style={{ overflowWrap: "anywhere" }}>{row.serial}</span> },
          { key: "date", label: tx(O.prepared), width: "100px", cell: (row) => dateLabel(row.issued_at) },
          { key: "status", label: tx(O.status), width: "minmax(0,1fr)", cell: (row) => <Pill tone={row.artifact_state !== "ready" ? "bad" : row.status === "prepared" ? "warn" : row.status === "issued" ? "ok" : "mut"}>{row.artifact_state !== "ready" ? tx(O.retry) : tx(CERTIFICATE_STATUS[row.status])}</Pill> },
        ]} empty={<div style={{ padding: 25 }}><EmptyState icon="fileText" title={tx(O.empty)} body={tx(O.emptySub)} /></div>} />}
    </div>
    {!unavailable && count > 0 ? <div className="office-tools" style={{ justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "var(--mut)" }}>{(page - 1) * 30 + 1}–{Math.min(page * 30, count)} / {count}</span><span className="office-tools">{page > 1 ? <Btn href={href(page - 1)}>{tx(O.previous)}</Btn> : null}{page * 30 < count ? <Btn href={href(page + 1)}>{tx(O.next)}</Btn> : null}</span></div> : null}
  </>;
}
