"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyReturnAction, recordReturnOutcomeAction, resumeReturnAction, stageReturnAction } from "@/app/(app)/school-office/returns/actions";
import type { BatchEvent } from "@/modules/government-records/data/repo";
import type { GovernmentBatch } from "@/modules/government-records/domain/exchange";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { dateLabel } from "@/vx/format";
import { Btn, Pill, Progress } from "@/vx/ui/primitives";
import { O } from "./text";
import { C, enteredOf } from "./copilot-text";
import { G, PORTAL_LABELS, RETURN_STATE, returnReason } from "./return-text";
import "./office.css";
import "./returns.css";

const PORTAL_URL: Record<string, string> = { psp: "https://rajpsp.rajasthan.gov.in/", udise: "https://udiseplus.gov.in/", class5: "https://rajshaladarpan.rajasthan.gov.in/Class5th_8thExam/Home/HomePage.aspx", class8: "https://rajshaladarpan.rajasthan.gov.in/Class5th_8thExam/Home/HomePage.aspx", rbse10: "https://rajeduboard.rajasthan.gov.in/", rbse12: "https://rajeduboard.rajasthan.gov.in/" };
export type CopilotSummary = { total: number; entered: number; mismatches: { key: string; name: string; note: string }[]; open: boolean };
export function ReturnBatchDetail({ batch, events, canExport, canImport, copilot = null }: { batch: GovernmentBatch & { apply_receipt?: { applied: number; unchanged: number }; evidence_name?: string }; events: BatchEvent[]; canExport: boolean; canImport: boolean; copilot?: CopilotSummary | null }) {
  const { tx } = useVx(); const router = useRouter();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [outcome, setOutcome] = useState("submitted");
  const applyCommand = useRef<string | null>(null), importCommand = useRef<string | null>(null);
  const preview = batch.payload.preview ?? [], conflicts = preview.some((row) => row.state === "conflict" || row.state === "unmatched");
  async function apply() { if (busy) return; setBusy(true); setFailed(false); applyCommand.current ??= crypto.randomUUID(); try { const result = await applyReturnAction({ batchId: batch.id, commandId: applyCommand.current, revision: batch.revision }); if (result.ok) router.refresh(); else setFailed(true); } catch { setFailed(true); } finally { setBusy(false); } }
  async function upload(form: FormData) { if (busy) return; setBusy(true); setFailed(false); importCommand.current ??= crypto.randomUUID(); form.set("batchId", batch.direction === "import" ? batch.parent_batch_id! : batch.id); form.set("commandId", batch.direction === "import" ? batch.id : importCommand.current); try { const result = await stageReturnAction(form); if (result.ok) { router.push(`/school-office/returns/${result.id}`); router.refresh(); } else setFailed(true); } catch { setFailed(true); } finally { setBusy(false); } }
  async function record(form: FormData) { if (busy) return; setBusy(true); setFailed(false); form.set("batchId", batch.id); form.set("revision", String(batch.revision)); form.set("state", outcome); try { const result = await recordReturnOutcomeAction(form); if (result.ok) router.refresh(); else setFailed(true); } catch { setFailed(true); } finally { setBusy(false); } }
  async function retry() { setBusy(true); setFailed(false); try { if ((await resumeReturnAction(batch.id)).ok) router.refresh(); else setFailed(true); } finally { setBusy(false); } }
  return <>
    <div className="office-tools"><Btn href="/school-office/returns" icon="chevLeft">{tx(G.batches)}</Btn><Pill tone={batch.state === "accepted" || batch.state === "applied" ? "ok" : "mut"}>{tx(RETURN_STATE[batch.state])}</Pill></div>
    <div className="card" style={{ padding: 20 }}><h1 className="serif" style={{ margin: 0, fontSize: 27 }}>{tx(PORTAL_LABELS[batch.portal])} · {batch.module}</h1><p>{batch.session_label} · {dateLabel(batch.created_at)}</p><strong>{batch.adapter.mode === "manual_reference" ? tx(G.manual) : tx(G.verified)}</strong><p style={{ color: "var(--mut)", lineHeight: 1.6 }}>{tx(G.outcomeHint)}</p><div className="office-tools">{Object.entries(batch.payload.counts).map(([key, count]) => <Pill key={key} tone={key === "conflict" || key === "unmatched" || key === "excluded" ? "warn" : "mut"}>{count} {tx(({ ready: G.ready, selected: p("selected", "चुने हुए"), excluded: p("excluded", "छोड़े हुए"), unchanged: G.unchanged, conflict: G.conflict, unmatched: G.unmatched } as Record<string, ReturnType<typeof p>>)[key] ?? p(key, key))}</Pill>)}</div></div>
    <div className="office-tools">{batch.file_path ? <Btn variant="pri" icon="download" href={`/school-office/returns/${batch.id}/file`} prefetch={false}>{tx(G.download)}</Btn> : batch.direction === "export" && canExport ? <Btn disabled={busy} onClick={retry}>{tx(O.retry)}</Btn> : null}<Btn icon="globe" href={PORTAL_URL[batch.portal]} target="_blank">{tx(G.portal)}</Btn>{batch.parent_batch_id ? <Btn href={`/school-office/returns/${batch.parent_batch_id}`}>{tx(p("Original batch", "मूल सूची"))}</Btn> : null}</div>
    {copilot ? <div className="card rb-section">
      <div className="rb-row" style={{ justifyContent: "space-between" }}><strong>{tx(C.title)}</strong><Pill tone={copilot.entered === copilot.total && copilot.total > 0 ? "ok" : "info"}>{tx(enteredOf(copilot.entered, copilot.total))}</Pill></div>
      <Progress value={copilot.entered} max={copilot.total} tone="var(--ok)" />
      <p className="rb-meta" style={{ margin: 0 }}>{tx(C.honesty)} {tx(C.enteredMeaning)}</p>
      {copilot.open || copilot.entered + copilot.mismatches.length > 0 ? <div className="rb-row"><Btn variant={copilot.open ? "pri" : "sec"} className="wrap" icon="keyboard" href={`/school-office/returns/${batch.id}/copilot`}>{tx(C.open)}</Btn></div> : null}
      {copilot.mismatches.length ? <div style={{ display: "grid", gap: 8 }}><strong style={{ fontSize: 14 }}>{tx(C.mismatches)} · {copilot.mismatches.length}</strong>{copilot.mismatches.slice(0, 50).map((row) => <div key={row.key} style={{ fontSize: 13, borderTop: "1px solid var(--bd)", paddingTop: 8, overflowWrap: "anywhere" }}><strong>{row.name}</strong> — {row.note}</div>)}</div> : null}
    </div> : null}
    {failed ? <div className="office-note" role="alert">{tx(G.checkFailed)}<br />{tx(G.importHint)}</div> : null}
    {batch.direction === "import" ? <>
      <div className="office-note">{tx(G.conflictHint)}</div>
      <div className="card" style={{ overflow: "hidden" }}>{preview.map((row) => <div key={row.row} style={{ padding: 16, borderBottom: "1px solid var(--bd)" }}><div className="office-tools"><strong>{row.studentName || tx(G.unmatched)}</strong><Pill tone={row.state === "ready" ? "ok" : row.state === "unchanged" ? "mut" : "warn"}>{tx(({ ready: G.ready, unchanged: G.unchanged, conflict: G.conflict, unmatched: G.unmatched })[row.state])}</Pill></div>{Object.entries(row.changes).map(([field, value]) => <div key={field} style={{ fontSize: 13, paddingTop: 5 }}>{tx(field === "externalId" ? p("External registration ID", "बाहरी पंजीकरण पहचान") : p("Registration status", "पंजीकरण स्थिति"))}: {value}</div>)}{row.reasons.map((reason) => <div key={reason} style={{ color: "var(--warnfg)", fontSize: 13 }}>{tx(returnReason(reason))}</div>)}</div>)}</div>
      {batch.state === "staged" && canImport ? <Btn variant="pri" disabled={busy || conflicts || preview.length === 0} onClick={apply}>{tx(G.apply)}</Btn> : null}
      {batch.state === "applied" && batch.apply_receipt ? <div role="status" className="office-note">{batch.apply_receipt.applied} {tx(p("changes applied", "बदलाव लागू"))} · {batch.apply_receipt.unchanged} {tx(G.unchanged)}</div> : null}
    </> : null}
    {canImport && batch.adapter.mode === "verified_upload" && (batch.direction === "export" && batch.file_path || batch.direction === "import" && !batch.file_path) ? <form action={upload} className="card office-form" style={{ padding: 20 }}><h2 style={{ margin: 0 }}>{tx(G.import)}</h2><p style={{ margin: 0 }}>{tx(G.importHint)}</p><input className="inp" style={{ paddingTop: 8 }} type="file" name="file" required accept={batch.adapter.format === "xlsx" ? ".xlsx" : ".csv"} onChange={() => { importCommand.current = null; }} /><Btn type="submit" variant="pri" disabled={busy}>{tx(G.review)}</Btn></form> : null}
    {batch.direction === "export" && batch.file_path && canExport && !["accepted"].includes(batch.state) ? <form action={record} className="card office-form" style={{ padding: 20 }}>
      <h2 style={{ margin: 0 }}>{tx(G.outcome)}</h2><p style={{ margin: 0, fontSize: 14, color: "var(--mut)" }}>{tx(G.evidenceRequired)}</p>
      <select className="inp" aria-label={tx(O.status)} value={outcome} onChange={(e) => setOutcome(e.target.value)}>{batch.state === "exported" || batch.state === "rejected" ? <option value="submitted">{tx(G.submitted)}</option> : <><option value="submitted" disabled>{tx(G.submitted)}</option><option value="accepted">{tx(G.accepted)}</option><option value="partially_accepted">{tx(RETURN_STATE.partially_accepted)}</option><option value="rejected">{tx(G.rejected)}</option></>}</select>
      {outcome === "partially_accepted" ? <label className="field"><span>{tx(p("Accepted admission / SR numbers, one per line (exactly as in this batch)", "स्वीकृत प्रवेश / एसआर संख्याएँ, हर पंक्ति में एक (इसी सूची के अनुसार)"))}</span><textarea className="inp" name="acceptedAdmissionNumbers" required maxLength={20000} /></label> : null}
      <label className="field"><span>{tx(G.acknowledgement)}</span><textarea className="inp" name="acknowledgement" required minLength={3} maxLength={500} /></label>
      {outcome !== "submitted" ? <label className="field"><span>{tx(G.evidence)}</span><input className="inp" style={{ paddingTop: 8 }} type="file" name="evidence" required accept=".pdf,.png,.jpg,.jpeg" /></label> : null}
      <Btn type="submit" variant="pri" disabled={busy}>{tx(outcome === "submitted" ? G.submitted : outcome === "accepted" ? G.accepted : outcome === "partially_accepted" ? RETURN_STATE.partially_accepted : G.rejected)}</Btn>
    </form> : null}
    {batch.row_outcomes?.length ? <div className="card" style={{ padding: 16, display: "grid", gap: 10 }}>{batch.row_outcomes.map(row => <div key={row.studentId} style={{ overflowWrap: "anywhere" }}>{batch.payload.rows?.find(student => student.studentId === row.studentId)?.admissionNo} · {tx(row.state === "accepted" ? G.accepted : p("Not recorded as accepted", "स्वीकृति दर्ज नहीं"))}</div>)}</div> : null}
    {batch.acknowledgement ? <div className="office-note"><strong>{tx(G.acknowledgement)}</strong><p style={{ overflowWrap: "anywhere" }}>{batch.acknowledgement}</p>{batch.evidence_path ? <Btn href={`/school-office/returns/${batch.id}/file?evidence=1`} prefetch={false}>{tx(p("Download acknowledgement", "पावती डाउनलोड करें"))}</Btn> : null}</div> : null}
    <div className="card office-history"><strong>{tx(O.history)}</strong>{events.map((event) => <div key={event.id} style={{ fontSize: 13, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>{tx(RETURN_STATE[event.kind.replace(/_recorded$/, "")] ?? (event.kind === "import_applied" ? RETURN_STATE.applied : event.kind === "import_staged" ? RETURN_STATE.staged : p("File prepared", "फ़ाइल तैयार")))} · {dateLabel(event.created_at)}</div>)}</div>
  </>;
}
