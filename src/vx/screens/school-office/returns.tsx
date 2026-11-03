"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkReturnAction, prepareReturnAction } from "@/app/(app)/school-office/returns/actions";
import type { AdapterRow } from "@/modules/government-records/data/repo";
import { portals, type GovernmentAdapter, type GovernmentBatch } from "@/modules/government-records/domain/exchange";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { dateLabel } from "@/vx/format";
import { Btn, EmptyState, Pill } from "@/vx/ui/primitives";
import { O } from "./text";
import { G, PORTAL_LABELS, RETURN_STATE, returnReason } from "./return-text";
import "./office.css";

export function GovernmentReturns({ sessionLabel, batches, adapters, classes, canExport, canManage, unavailable, sourceUnavailable }: { sessionLabel: string; batches: GovernmentBatch[]; adapters: AdapterRow[]; classes: { id: string; label: string }[]; canExport: boolean; canManage: boolean; unavailable: boolean; sourceUnavailable: boolean }) {
  const { tx } = useVx(); const router = useRouter();
  const [portal, setPortal] = useState<GovernmentAdapter["portal"]>("psp"), [module, setModule] = useState("Student records"), [code, setCode] = useState(""), [classId, setClassId] = useState(""), [adapterId, setAdapter] = useState("");
  const [checked, setChecked] = useState<Extract<Awaited<ReturnType<typeof checkReturnAction>>, { ok: true }> | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [exclude, setExclude] = useState(false);
  const command = useRef<string | null>(null);
  function changed() { command.current = null; setChecked(null); setFailed(false); }
  function input() { command.current ??= crypto.randomUUID(); return { portal, module, sessionLabel, schoolCode: code, classIds: classId ? [classId] : [], ...(adapterId ? { adapterId } : {}), commandId: command.current, excludeBlocked: exclude }; }
  async function check() { if (busy) return; setBusy(true); setFailed(false); try { const result = await checkReturnAction(input()); if (result.ok) setChecked(result); else { setFailed(true); setChecked(null); } } catch { setFailed(true); } finally { setBusy(false); } }
  async function prepare() { if (busy || !checked) return; setBusy(true); setFailed(false); try { const result = await prepareReturnAction({ ...input(), expectedSource: checked.sourceRevision }); if (result.ok) router.push(`/school-office/returns/${result.id}`); else setFailed(true); } catch { setFailed(true); } finally { setBusy(false); } }
  const ready = checked?.rows.filter((row) => row.state === "ready").length ?? 0, blocked = checked?.rows.filter((row) => row.state === "blocked") ?? [];
  return <>
    <div className="office-tools"><Link className="chip" href="/school-office">{tx(O.certificates)}</Link><Link className="chip on" href="/school-office/returns" aria-current="page">{tx(G.title)}</Link><span style={{ flex: 1 }} />{canManage ? <Btn icon="settings" href="/school-office/returns/formats">{tx(G.adapter)}</Btn> : null}</div>
    <div className="office-note">{tx(G.outcomeHint)}</div>
    {sourceUnavailable ? <div className="office-note" role="alert">{tx(O.source)}</div> : null}
    {canExport ? <div className="card office-form" style={{ padding: 20 }}>
      <h2 className="serif" style={{ margin: 0 }}>{tx(G.prepare)}</h2>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><label className="field"><span>{tx(G.destination)}</span><select className="inp" value={portal} onChange={(e) => { changed(); setPortal(e.target.value as typeof portal); setAdapter(""); }}>{portals.map((key) => <option key={key} value={key}>{tx(PORTAL_LABELS[key])}</option>)}</select></label><label className="field"><span>{tx(G.class)}</span><select className="inp" value={classId} onChange={(e) => { changed(); setClassId(e.target.value); }}><option value="">{tx(G.allClasses)}</option>{classes.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label></div>
      <label className="field"><span>{tx(G.format)}</span><select className="inp" value={adapterId} onChange={(e) => { changed(); const id = e.target.value; setAdapter(id); const a = adapters.find(row => row.id === id)?.adapter; if (a) { setModule(a.module); setCode(a.schoolCode); } }}><option value="">{tx(G.manual)}</option>{adapters.filter(row => row.adapter.portal === portal).map(row => <option key={row.id} value={row.id}>{row.adapter.module} · {row.adapter.schoolCode} · v{row.version}</option>)}</select></label>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><label className="field"><span>{tx(G.module)}</span><input className="inp" value={module} maxLength={80} disabled={!!adapterId} onChange={(e) => { changed(); setModule(e.target.value); }} /></label><label className="field"><span>{tx(G.schoolCode)}</span><input className="inp" value={code} maxLength={50} disabled={!!adapterId} onChange={(e) => { changed(); setCode(e.target.value); }} /></label></div>
      {!adapterId ? <div className="office-note">{tx(G.manualHint)}</div> : null}
      <Btn variant="pri" onClick={check} disabled={busy || sourceUnavailable}>{busy ? tx(O.preparing) : tx(G.check)}</Btn>
      {checked ? <><div aria-live="polite" className="office-tools"><Pill tone="ok">{ready} {tx(G.ready)}</Pill><Pill tone={blocked.length ? "warn" : "mut"}>{blocked.length} {tx(G.blocked)}</Pill></div>{blocked.length ? <div style={{ display: "grid", gap: 10 }}>{blocked.slice(0, 30).map((row) => <div key={row.studentId} style={{ borderTop: "1px solid var(--bd)", paddingTop: 10 }}><a href={`/students/${row.studentId}?tab=info`} style={{ fontWeight: 600 }}>{row.name}</a><div style={{ color: "var(--warnfg)", fontSize: 13 }}>{row.reasons.map((reason) => tx(returnReason(reason))).join(" · ")}</div></div>)}{checked.mode === "manual_reference" ? <label style={{ display: "flex", alignItems: "center", gap: 10 }}><input type="checkbox" checked={exclude} onChange={(e) => { command.current = null; setExclude(e.target.checked); }} />{tx(G.exclude)}</label> : null}</div> : null}<Btn variant="pri" onClick={prepare} disabled={busy || ready === 0 || (blocked.length > 0 && (!exclude || checked.mode !== "manual_reference"))}>{tx(G.make)}</Btn></> : null}
      {failed ? <div role="alert" className="office-note">{tx(G.checkFailed)}</div> : null}
    </div> : null}
    <h2 className="serif" style={{ margin: "6px 0 0" }}>{tx(G.batches)}</h2>
    {unavailable ? <div role="alert" className="office-note">{tx(G.checkFailed)}</div> : batches.length ? <div style={{ display: "grid", gap: 12 }}>{batches.map((batch) => <a key={batch.id} href={`/school-office/returns/${batch.id}`} className="card row" style={{ display: "flex", alignItems: "center", gap: 14, padding: 18 }}><div style={{ flex: 1, minWidth: 0 }}><strong>{tx(PORTAL_LABELS[batch.portal] ?? p(batch.portal, batch.portal))} · {batch.module}</strong><div style={{ fontSize: 13, color: "var(--mut)", paddingTop: 4 }}>{dateLabel(batch.created_at)} · {batch.direction === "import" ? tx(G.import) : batch.adapter.mode === "manual_reference" ? tx(G.manual) : tx(G.verified)}</div></div><Pill tone={batch.state === "accepted" || batch.state === "applied" ? "ok" : batch.state === "rejected" ? "bad" : "mut"}>{tx(RETURN_STATE[batch.state])}</Pill></a>)}</div> : <div className="card" style={{ padding: 24 }}><EmptyState icon="fileText" title={tx(G.noBatches)} body={tx(G.noBatchesSub)} /></div>}
  </>;
}
