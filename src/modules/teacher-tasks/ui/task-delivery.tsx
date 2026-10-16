"use client";
import {useState,useTransition} from "react";
import {useRouter} from "next/navigation";
import {primary,type Language} from "@/platform/i18n/language";
import {taskDeliveryMessages as text} from "@/messages/setup";
import {previewTaskDeliveryAction,confirmTaskDeliveryAction,reconcileTaskDeliveryAction} from "@/app/(app)/teach/tasks/delivery-actions";
import type {DeliveryPreview,DeliverySummary} from "../domain/delivery";

export function TaskDelivery({id,language,summary,availability}:{id:string;language:Language;summary:DeliverySummary;availability:"ready"|"unavailable"|"test_mode"}) {
  const [preview,setPreview]=useState<DeliveryPreview|null>(null);
  const [status,setStatus]=useState("");
  const [manualUrl,setManualUrl]=useState<string|null>(null);
  const [note,setNote]=useState("");
  const [uncertain,setUncertain]=useState(false);
  const [busy,start]=useTransition();
  const router=useRouter();
  const word=(pair:{hi:string;en:string})=>primary(pair,language);
  const unknown=summary.deliveries.find(d=>d.state==="unknown");
  const handled=summary.deliveries.some(d=>["accepted","manual_opened","human_confirmed"].includes(d.state));
  const button="min-h-11 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50";
  const confirm=(mode:"api"|"manual")=>start(async()=>{
    if(!preview)return;
    try {
      const result=await confirmTaskDeliveryAction(preview.id,preview.digest,mode);
      setPreview(null);
      if(result.ok){setStatus(word(text[result.state]));setManualUrl(result.url??null);}
      else {setStatus(word(text[result.reason]));if(result.reason==="reconcile")setUncertain(true);}
      router.refresh();
    } catch {setPreview(null);setUncertain(true);setStatus(word(text.failed));router.refresh();}
  });
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={word(text.title)}>
    <h2 className="font-semibold">{word(text.title)}</h2>
    <p className="text-sm">{word(summary.openedAt?text.opened:text.unopened)}{summary.openedAt?` · ${new Date(summary.openedAt).toLocaleString(language==="hi"?"hi-IN":"en-IN")}`:""}</p>
    {!!summary.expected&&<p className="text-sm">{word(text.answered)}: {summary.answered}/{summary.expected} · {word(text.approved)}: {summary.approved??0} · {word(text.rejectedCount)}: {summary.rejected??0}</p>}
    {availability!=="ready"&&<p className="rounded-lg bg-accent-soft p-3 text-sm">{word(text[availability])}</p>}
    <p className="text-sm text-muted-foreground">{word(text.noReceipt)}</p>
    {summary.deliveries.map(d=><div key={d.id} className="rounded-lg bg-accent-soft p-3 text-sm">
      <p>{word(text[d.state])} · +91 {d.phone}</p>
      {d.history.some(h=>h.event==="reconcile")&&<details><summary>{word(text.history)}</summary>{d.history.filter(h=>h.event==="reconcile").map((h,i)=><p key={i}>{h.at} · {h.actor} · {h.note}</p>)}</details>}
    </div>)}
    {(unknown||uncertain)&&<p role="alert" className="text-sm">{word(text.reconcile)}</p>}
    {unknown&&<div className="space-y-2"><label className="block text-sm">{word(text.note)}<textarea className="mt-1 w-full rounded-lg border border-border bg-background p-2" value={note} maxLength={500} onChange={e=>setNote(e.target.value)}/></label><div className="flex flex-wrap gap-2">{(["accepted","not_sent"] as const).map(resolution=><button className={button} disabled={busy||note.trim().length<5} key={resolution} onClick={()=>start(async()=>{
      try {const saved=await reconcileTaskDeliveryAction(unknown.id,unknown.attempt,resolution,note);setStatus(saved?word(text.refresh):word(text.failed));setPreview(null);setNote("");router.refresh();}catch{setStatus(word(text.failed));}
    })}>{word(resolution==="accepted"?text.confirmAccepted:text.confirmNotSent)}</button>)}</div></div>}
    {!unknown&&!uncertain&&summary.pending&&!preview&&<button className={button} disabled={busy} onClick={()=>start(async()=>{
      setManualUrl(null);try {const next=await previewTaskDeliveryAction(id,handled?"reminder":"initial");if(next.ok){setPreview(next);setStatus("");}else setStatus(word(text[next.reason]));}catch{setStatus(word(text.failed));}
    })}>{word(handled?text.remind:text.review)}</button>}
    {!unknown&&!uncertain&&summary.pending===false&&<p className="text-sm">{word(text.complete)}</p>}
    {preview&&!unknown&&!uncertain&&<div className="space-y-3 rounded-xl bg-accent-soft p-4">
      <p className="font-semibold">{preview.name} · <span className="font-mono">+91 {preview.phone}</span></p>
      <p>{preview.title}</p><p className="text-sm">{word(text.due)}: {preview.due??word(text.none)}</p>
      <p className="whitespace-pre-wrap text-sm">{preview.textEn}</p>
      <div className="flex flex-wrap gap-2"><button className={`${button} bg-primary text-primary-foreground`} disabled={busy||availability!=="ready"} onClick={()=>confirm("api")}>{word(text.api)}</button><button className={button} disabled={busy} onClick={()=>confirm("manual")}>{word(text.manual)}</button></div>
    </div>}
    {manualUrl&&<a className={`${button} inline-flex items-center text-primary`} href={manualUrl} target="_blank" rel="noopener noreferrer">{word(text.open)}</a>}
    {status&&<p role="status" className="text-sm">{status}</p>}
    {(uncertain||unknown)&&<button className={button} disabled={busy} onClick={()=>{setUncertain(false);router.refresh();}}>{word(text.refresh)}</button>}
  </section>;
}
