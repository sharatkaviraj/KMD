"use client";
import { useMemo, useRef, useState } from "react";
import { generateCertificateAction } from "@/app/(app)/school-office/actions";
import { conductGrades, type CertificateBlocker, type CertificateKind } from "@/modules/certificates/domain/certificate";
import type { RosterStudent } from "@/modules/certificates/data/repo";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Btn, Ring, SuccessTick } from "@/vx/ui/primitives";
import { bundleHref } from "./artifact";
import { CONDUCT_LABELS, EXTRA_LABELS, FIELD_LABELS, KIND_HINTS, KIND_LABELS, O, PURPOSES } from "./text";
import "./office.css";
import "./cert.css";

type Outcome = { studentId: string; state: "ok"; issueId: string; serial: string } | { studentId: string; state: "blocked"; blockers: CertificateBlocker[] } | { studentId: string; state: "failed" };
const BATCH_KINDS: CertificateKind[] = ["study", "character", "dob"];

/**
 * One document for every child in a class, prepared one at a time so the
 * office watches it happen and can stop. Each child gets the ordinary command:
 * a child who already has a current document of this kind gets that copy back.
 */
export function CertificateBatch({ sessionLabel, roster }: { sessionLabel: string; roster: RosterStudent[] }) {
  const { tx } = useVx();
  const classes = useMemo(() => [...new Map(roster.map((row) => [row.classId, row.classLabel])).entries()], [roster]);
  const [classId, setClassId] = useState(classes[0]?.[0] ?? "");
  const [kind, setKind] = useState<CertificateKind>("study");
  const [purpose, setPurpose] = useState("");
  const [conduct, setConduct] = useState<string>("good");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const students = roster.filter((row) => row.classId === classId);
  const names = useMemo(() => new Map(roster.map((row) => [row.studentId, row])), [roster]);
  const ready = outcomes.filter((o): o is Extract<Outcome, { state: "ok" }> => o.state === "ok");
  const finished = !running && outcomes.length > 0;

  async function run() {
    if (running || !students.length) return;
    stop.current = false; setRunning(true); setOutcomes([]);
    for (const student of students) {
      if (stop.current) break;
      let outcome: Outcome;
      try {
        const result = await generateCertificateAction({ studentId: student.studentId, sessionLabel, commandId: crypto.randomUUID(), kind,
          ...(kind !== "dob" && purpose.trim().length >= 2 ? { purpose: purpose.trim() } : {}), ...(kind === "character" ? { extras: { conduct } } : {}) });
        outcome = result.ok ? { studentId: student.studentId, state: "ok", issueId: result.issueId, serial: result.serial ?? "" }
          : result.code === "blocked" ? { studentId: student.studentId, state: "blocked", blockers: result.blockers ?? [] } : { studentId: student.studentId, state: "failed" };
      } catch { outcome = { studentId: student.studentId, state: "failed" }; }
      setOutcomes((old) => [...old, outcome]);
    }
    setRunning(false);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ready.length; i += 60) chunks.push(ready.slice(i, i + 60).map((o) => o.issueId));
  const reason = (blockers: CertificateBlocker[]) => blockers.map((b) => tx(b.field in FIELD_LABELS ? FIELD_LABELS[b.field as keyof typeof FIELD_LABELS] : b.field in EXTRA_LABELS ? EXTRA_LABELS[b.field as keyof typeof EXTRA_LABELS] : O.identity)).join(" · ");

  return <div style={{ display: "grid", gap: 16, maxWidth: 860 }}>
    <div className="office-note">{tx(O.batchHint)}</div>
    <div className="card office-form" style={{ padding: 20 }}>
      <label className="cert-q"><span>{tx(O.chooseClass)}</span>
        <select className="inp" value={classId} disabled={running} onChange={(e) => { setClassId(e.target.value); setOutcomes([]); }}>{classes.map(([id, label]) => <option key={id} value={id}>{label} ({roster.filter((row) => row.classId === id).length})</option>)}</select>
      </label>
      <div className="cert-q"><span>{tx(O.chooseKind)}</span>
        <div className="cert-kinds">{BATCH_KINDS.map((key, index) => <button key={key} type="button" disabled={running} className="cert-kind" aria-pressed={kind === key} style={{ animationDelay: `${index * 45}ms` }} onClick={() => { setKind(key); setOutcomes([]); }}>
          <span className="cert-kind-ic"><Ic n={key === "study" ? "book" : key === "character" ? "award" : "cake"} size={19} /></span>
          <span style={{ minWidth: 0 }}><strong>{tx(KIND_LABELS[key])}</strong><small>{tx(KIND_HINTS[key])}</small></span>
        </button>)}</div>
      </div>
      {kind !== "dob" ? <label className="cert-q"><span>{tx(O.purpose)}</span>
        <div className="cert-chips">{PURPOSES.map((pair) => <button key={pair.en} type="button" className="cert-chip" disabled={running} aria-pressed={purpose === pair.en} onClick={() => setPurpose(purpose === pair.en ? "" : pair.en)}>{tx(pair)}</button>)}</div>
        <input className="inp" value={purpose} maxLength={80} disabled={running} onChange={(e) => setPurpose(e.target.value)} placeholder={tx(O.purposeHint)} />
      </label> : null}
      {kind === "character" ? <div className="cert-q"><span>{tx(EXTRA_LABELS.conduct)}</span>
        <div className="cert-chips">{conductGrades.map((grade) => <button key={grade} type="button" className="cert-chip" disabled={running} aria-pressed={conduct === grade} onClick={() => setConduct(grade)}>{tx(CONDUCT_LABELS[grade])}</button>)}</div>
      </div> : null}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {running ? <Btn icon="x" onClick={() => { stop.current = true; }}>{tx(O.stop)}</Btn> : <Btn variant="pri" big icon="award" disabled={!students.length} onClick={run}>{tx(O.startBatch)} · {students.length}</Btn>}
      </div>
    </div>

    {outcomes.length || running ? <section className="card" style={{ overflow: "hidden", animation: "xRise .4s var(--ease) both" }} aria-live="polite">
      <div className="batch-progress" style={{ gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", display: "grid", gap: 16 }}>
        {finished && ready.length === students.length ? <SuccessTick size={64} /> : <Ring value={outcomes.length} max={Math.max(1, students.length)} size={64}><span className="num" style={{ fontSize: 13, fontWeight: 700 }}>{outcomes.length}/{students.length}</span></Ring>}
        <div>
          <strong style={{ fontSize: 16 }}>{finished ? tx(O.batchDone) : tx(O.preparing)}</strong>
          <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 3 }}>{ready.length} {tx(O.ready)} · {outcomes.filter((o) => o.state !== "ok").length} {tx(O.blocked)}</div>
          {finished && chunks.length ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>{chunks.map((ids, index) => <Btn key={index} variant={index ? "sec" : "pri"} icon="printer" href={bundleHref(ids)} target="_blank">{tx(O.printAll)}{chunks.length > 1 ? ` ${index + 1}` : ""} · {ids.length}</Btn>)}<Btn icon="history" href="/school-office">{tx(O.tray)}</Btn></div> : null}
        </div>
      </div>
      <div className="batch-list">{outcomes.map((o) => { const s = names.get(o.studentId); return <a key={o.studentId} className="batch-item" href={o.state === "ok" ? `/school-office/certificates/${o.issueId}` : `/students/${o.studentId}?certificate=${kind}`} style={{ color: "var(--fg)" }}>
        <span style={{ minWidth: 0 }}><strong>{s?.studentName}</strong><span style={{ color: "var(--mut)" }}> · SR {s?.admissionNo}</span>{o.state === "blocked" ? <span style={{ display: "block", color: "var(--warnfg)", fontSize: 12.5 }}>{reason(o.blockers)}</span> : null}</span>
        <span className="num" style={{ color: o.state === "ok" ? "var(--ok)" : o.state === "blocked" ? "var(--warn)" : "var(--bad)", display: "inline-flex", gap: 6, alignItems: "center", flex: "none" }}><Ic n={o.state === "ok" ? "checkCircle" : "alert"} size={15} />{o.state === "ok" ? o.serial.split("/").pop() : o.state === "blocked" ? tx(O.blocked) : tx(O.retry)}</span>
      </a>; })}</div>
    </section> : null}
  </div>;
}
