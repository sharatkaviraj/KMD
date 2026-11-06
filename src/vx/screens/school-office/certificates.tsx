"use client";
import Link from "@/ui/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { handOverManyAction } from "@/app/(app)/school-office/actions";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { dateLabel } from "@/vx/format";
import { DataList } from "@/vx/ui/page";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, EmptyState, Pill } from "@/vx/ui/primitives";
import { certificateKinds, type CertificateIssue } from "@/modules/certificates/domain/certificate";
import type { DeskCounts } from "@/modules/certificates/data/repo";
import { bundleHref } from "./artifact";
import { CERTIFICATE_STATUS, COLLECTORS, KIND_LABELS, O } from "./text";
import "./office.css";
import "./cert.css";

export function CertificateRegister({ rows, count, page, query, status, kind = "", studentId, sessionLabel, canManage, canGovernment, canIssue = false, unavailable, counts = null, tray = [] }: {
  rows: CertificateIssue[]; count: number; page: number; query: string; status: string; kind?: string; studentId?: string; sessionLabel: string; canManage: boolean; canGovernment: boolean; canIssue?: boolean; unavailable: boolean;
  counts?: DeskCounts | null; tray?: CertificateIssue[];
}) {
  const { tx } = useVx();
  const href = (next: number) => { const sp = new URLSearchParams({ q: query, status, kind, page: String(next), ...(studentId ? { student: studentId } : {}) }); return `/school-office?${sp}`; };
  return <>
    <div className="office-mobile-h"><h1 className="serif" style={{ margin: "0 0 2px", fontSize: 30 }}>{tx(O.title)}</h1><span style={{ fontSize: 13, color: "var(--mut)" }}>{sessionLabel}</span></div>
    <div className="office-tools">
      <Link className="chip on" href="/school-office" aria-current="page">{tx(O.certificates)}</Link>
      {canGovernment ? <Link className="chip" href="/school-office/returns">{tx(O.returns)}</Link> : null}
      <span style={{ flex: 1 }} />
      <Btn icon="search" href="/students">{tx(O.find)}</Btn>
      {canIssue ? <Btn icon="users" href="/school-office/batch">{tx(O.batch)}</Btn> : null}
      {canManage ? <Btn icon="settings" href="/school-office/template">{tx(O.setup)}</Btn> : null}
    </div>

    {counts ? <div className="desk-kpis">
      {[[counts.today, O.today, ""], [counts.tray, O.awaiting, counts.tray ? "warn" : ""], [counts.handedThisMonth, O.handedMonth, ""], [counts.total, O.issuedTotal, ""]].map(([value, label, tone], index) =>
        // A tile that reads 0 is off the phone: four zero tiles filled the first screen (UX review 6 Nov 2026).
        <div key={index} className={`desk-kpi ${tone}${value === 0 ? " hide-m" : ""}`} style={{ animationDelay: `${index * 55}ms` }}><b className="num">{value as number}</b><span>{tx(label as typeof O.today)}</span></div>)}
    </div> : null}

    {canIssue && tray.length ? <SigningTray tray={tray} /> : null}

    <div className="card" style={{ overflow: "hidden" }}>
      <form key={`${query}:${status}:${kind}:${studentId ?? ""}`} className="office-filters" style={{ gridTemplateColumns: undefined }} action="/school-office">
        {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
        <input className="inp" type="search" name="q" defaultValue={query} aria-label={tx(O.search)} placeholder={tx(O.search)} />
        <select className="inp" name="kind" defaultValue={kind} aria-label={tx(O.kind)}><option value="">{tx(O.allKinds)}</option>{certificateKinds.map((key) => <option key={key} value={key}>{tx(KIND_LABELS[key])}</option>)}</select>
        <select className="inp" name="status" defaultValue={status} aria-label={tx(O.status)}><option value="">{tx(O.all)}</option>{Object.entries(CERTIFICATE_STATUS).map(([key, label]) => <option key={key} value={key}>{tx(label)}</option>)}</select>
        <Btn type="submit" variant="pri">{tx(O.searchButton)}</Btn>
      </form>
      {unavailable ? <div role="alert" style={{ padding: 18 }}><p>{tx(O.loadFailed)}</p><Btn href={href(page)}>{tx(O.retry)}</Btn></div> : <DataList rows={rows} rowKey={(row) => row.id} href={(row) => `/school-office/certificates/${row.id}`} caption={tx(O.register)}
        columns={[
          { key: "student", label: tx(O.student), width: "minmax(0,1.3fr)", cell: (row) => <span style={{ overflowWrap: "anywhere", fontWeight: 600 }}>{row.snapshot.facts.studentName}<small style={{ display: "block", color: "var(--mut)", fontWeight: 400 }}>{row.snapshot.facts.classLabel} · SR {row.snapshot.facts.admissionNo}</small></span> },
          { key: "kind", label: tx(O.kind), width: "minmax(0,.9fr)", cell: (row) => <span className="kind-pill">{tx(KIND_LABELS[row.kind ?? "study"])}</span> },
          { key: "serial", label: tx(O.number), width: "minmax(0,1.3fr)", cell: (row) => <span className="num" style={{ overflowWrap: "anywhere" }}>{row.serial}</span> },
          { key: "date", label: tx(O.prepared), width: "100px", cell: (row) => dateLabel(row.issued_at) },
          { key: "status", label: tx(O.status), width: "minmax(0,1fr)", cell: (row) => <Pill tone={row.artifact_state !== "ready" ? "bad" : row.status === "prepared" ? "warn" : row.status === "issued" ? "ok" : "mut"}>{row.artifact_state !== "ready" ? tx(O.retry) : tx(CERTIFICATE_STATUS[row.status])}</Pill> },
        ]} empty={<div style={{ padding: 25 }}><EmptyState icon="award" title={tx(O.empty)} body={tx(O.emptySub)} action={<Btn variant="pri" icon="search" href="/students">{tx(O.find)}</Btn>} /></div>} />}
    </div>
    {!unavailable && count > 0 ? <div className="office-tools" style={{ justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "var(--mut)" }}>{(page - 1) * 30 + 1}–{Math.min(page * 30, count)} / {count}</span><span className="office-tools">{page > 1 ? <Btn href={href(page - 1)}>{tx(O.previous)}</Btn> : null}{page * 30 < count ? <Btn href={href(page + 1)}>{tx(O.next)}</Btn> : null}</span></div> : null}
  </>;
}

/** The principal's pile: print once, sign the stack, mark it handed over together. */
function SigningTray({ tray }: { tray: CertificateIssue[] }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(tray.map((row) => row.id)));
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [collector, setCollector] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const commands = useRef(new Map<string, string>());
  const visible = useMemo(() => tray.filter((row) => !gone.has(row.id)), [tray, gone]);
  const picked = visible.filter((row) => chosen.has(row.id));
  const toggle = (id: string) => setChosen((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function handOver() {
    if (busy || !picked.length || collector.trim().length < 2) return;
    setBusy(true);
    const items = picked.slice(0, 60).map((row) => { if (!commands.current.has(row.id)) commands.current.set(row.id, crypto.randomUUID()); return { issueId: row.id, commandId: commands.current.get(row.id)! }; });
    try {
      const result = await handOverManyAction({ items, collectedBy: collector.trim() });
      const nextGone = new Set([...gone, ...result.done]);
      setGone(nextGone);
      // Let the rows slide out before the card itself folds away.
      if (tray.every((row) => nextGone.has(row.id))) window.setTimeout(() => setClosed(true), 480);
      setAsking(false);
      toast.show({ text: `${tx(O.handedDone)} · ${result.done.length}`, tone: result.ok ? "ok" : "bad" });
      window.setTimeout(() => router.refresh(), 500);
    } catch { toast.show({ text: tx(O.unavailable), tone: "bad" }); }
    finally { setBusy(false); }
  }

  if (closed) return null;
  return <section className="card" aria-label={tx(O.tray)} style={{ overflow: "hidden", animation: visible.length ? "xRise .42s var(--ease) both" : "xOut .3s var(--ease) .2s forwards" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 12px", flexWrap: "wrap" }}>
      <span style={{ width: 40, height: 40, borderRadius: 13, background: "var(--warns)", color: "var(--warn)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Ic n="notePen" size={19} /></span>
      <div style={{ flex: 1, minWidth: 200 }}><h2 className="serif" style={{ margin: 0, fontSize: 21 }}>{tx(O.tray)} <span className="num" style={{ color: "var(--warn)" }}>{visible.length}</span></h2><p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--mut)" }}>{tx(O.trayHint)}</p></div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><input type="checkbox" style={{ width: 18, height: 18, accentColor: "var(--pri)" }} checked={picked.length === visible.length} onChange={(e) => setChosen(e.target.checked ? new Set(visible.map((row) => row.id)) : new Set())} />{tx(O.selectAll)}</label>
    </div>
    <div style={{ maxHeight: 360, overflow: "auto" }}>
      {tray.map((row, index) => <label key={row.id} className={`tray-row${gone.has(row.id) ? " gone" : ""}`} style={{ animationDelay: gone.has(row.id) ? "0ms" : `${Math.min(index, 12) * 30}ms`, cursor: "pointer" }}>
        <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} />
        <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: "block", fontSize: 14, overflowWrap: "anywhere" }}>{row.snapshot.facts.studentName}</strong><span style={{ fontSize: 12, color: "var(--mut)" }}>{row.snapshot.facts.classLabel} · <span className="num">{row.serial}</span></span></span>
        <span className="kind-pill">{tx(KIND_LABELS[row.kind ?? "study"])}</span>
      </label>)}
    </div>
    {picked.length ? <div className="tray-bar" style={{ margin: 12 }}>
      <strong className="num" style={{ fontSize: 14 }}>{picked.length} {tx(O.selected)}</strong><span style={{ flex: 1 }} />
      <Btn icon="printer" href={bundleHref(picked.slice(0, 60).map((row) => row.id))} target="_blank">{tx(O.printTray)}</Btn>
      <Btn variant="pri" icon="check" onClick={() => setAsking(true)}>{tx(O.markHanded)}</Btn>
    </div> : null}
    <Sheet open={asking} onClose={() => setAsking(false)} title={tx(O.markHanded)} sub={`${picked.length} ${tx(O.selected)}`} icon="check"
      footer={<Btn variant="pri" big full disabled={busy || collector.trim().length < 2} onClick={handOver}>{busy ? tx(O.preparing) : tx(O.markHanded)}</Btn>}>
      <div className="cert-q"><span>{tx(O.collectedBy)}</span>
        <div className="cert-chips">{COLLECTORS.map((pair) => <button key={pair.en} type="button" className="cert-chip" aria-pressed={collector === pair.en} onClick={() => setCollector(pair.en)}>{tx(pair)}</button>)}</div>
        <input className="inp" value={collector} maxLength={60} onChange={(e) => setCollector(e.target.value)} />
      </div>
      <p className="cert-note" style={{ marginTop: 14 }}>{tx(O.manual)}</p>
    </Sheet>
  </section>;
}
