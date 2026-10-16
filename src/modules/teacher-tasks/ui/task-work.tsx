"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { m } from "@/messages";
import { primary, type Language } from "@/platform/i18n/language";
import { RequestForm } from "@/modules/collection/ui/request-form";
import type { CollectionRequest, RollRow } from "@/modules/collection/domain/requests";
import type { LinkState } from "@/modules/collection/domain/link-state";
import { attendanceLabels, attendanceStatuses } from "@/modules/attendance/domain/attendance";
import type { AcademicWork } from "../data/repo";
import type { TaskSaveResult } from "../data/save";
import { saveTeacherCollectionAction, saveTeacherTaskAction } from "@/app/(app)/teach/tasks/actions";

export function TaskCollectionForm({id,request,roll,language,token}:{id:string;request:CollectionRequest;roll:RollRow[];language:Language;token?:string}) {
  const submit=async(previous:LinkState,form:FormData):Promise<LinkState>=>{
    if(!token)return saveTeacherCollectionAction(id,previous,form);
    try{const response=await fetch(`/t/tasks/${encodeURIComponent(token)}/save`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload:JSON.parse(String(form.get("payload")??"[]"))})});const result=await response.json();return result.status?result:{status:"error",message:m.linkClosed};}catch{return {status:"error",message:m.notSaved};}
  };
  return <><p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm">{primary(m.taskApprovalNote,language)}</p><RequestForm token="" draftScope={`task:${id}`} sessionLabel={request.sessionLabel} fields={request.fields} roll={roll} language={language} submitAction={submit}/></>;
}
export function TaskAcademicForm({work,language,token}:{work:AcademicWork;language:Language;token?:string}) {
  const router=useRouter();const word=(v:{hi:string;en:string})=>primary(v,language);
  const [rows,setRows]=useState(work.rows);const [reason,setReason]=useState("");const [pending,start]=useTransition();const [result,setResult]=useState<TaskSaveResult|null>(null);
  const [review,setReview]=useState<"draft"|"submit"|null>(null);const [command,setCommand]=useState<{payload:unknown}|null>(null);
  const edit=(id:string,patch:Partial<AcademicWork["rows"][number]>)=>{setRows(rows.map(r=>r.id===id?{...r,...patch}:r));setReview(null);setResult(null);setCommand(null);};
  const save=()=>{
    const payload=command?.payload??(work.kind==="marks"?{commandId:crypto.randomUUID(),paperId:work.paperId,kind:work.submitted?"correction":review??"draft",expectedRevision:work.revision,reason,entries:rows.map(r=>({studentId:r.id,state:r.state,value:r.state==="value"?r.value:null}))}:{commandId:crypto.randomUUID(),classId:work.classId,day:work.day,kind:work.submitted?"correction":"save",expectedRevision:work.revision,reason,marks:rows.map(r=>({studentId:r.id,status:r.state}))});
    setCommand({payload});start(async()=>{try{let out:TaskSaveResult;if(token){const r=await fetch(`/t/tasks/${encodeURIComponent(token)}/save`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload})});out=await r.json();}else out=await saveTeacherTaskAction(work.taskId,{kind:work.kind,session:work.session,payload});setResult(out);if(out.ok){setReview(null);router.refresh();}else if(out.reason!=="unknown")setCommand(null);}catch{setResult({ok:false,reason:"unknown"});}});
  };
  const frozen=pending||result?.reason==="unknown"||result?.ok===true;
  return <section className="space-y-4">
    {result&&<p role="status" className="rounded-xl bg-accent-soft p-3">{word(result.ok?m.taskSaved:result.reason==="unknown"?m.taskUnknown:m.taskRefused)}{result.revision?` · ${result.revision}`:""}</p>}
    {work.day&&<p>{work.day}</p>}
    {rows.map(row=><div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"><label htmlFor={`task-${row.id}`} className="min-w-0 text-sm font-medium">{row.name}</label><div className="flex shrink-0 gap-2">
      {work.kind==="attendance"?<select id={`task-${row.id}`} className="max-w-40 rounded-lg border border-border bg-background p-2 text-sm" disabled={frozen} value={row.state} onChange={e=>edit(row.id,{state:e.target.value})}>{attendanceStatuses.map(s=><option key={s} value={s}>{word(attendanceLabels[s])}</option>)}</select>:<>
        <input id={`task-${row.id}`} aria-label={`${row.name} ${word(m.taskMarks)}`} className="w-20 rounded-lg border border-border bg-background p-2" type="number" min={0} max={work.max} step={work.step} value={row.value??""} disabled={frozen||row.state==="absent"||row.state==="exempt"} onChange={e=>edit(row.id,{state:e.target.value===""?"blank":"value",value:e.target.value===""?null:Number(e.target.value)})}/>
        <select aria-label={row.name} className="w-24 rounded-lg border border-border bg-background p-2 text-sm" value={row.state} disabled={frozen} onChange={e=>edit(row.id,{state:e.target.value,value:e.target.value==="value"?row.value??0:null})}><option value="blank">—</option><option value="value">{word(m.taskMarks)}</option><option value="absent">{word(attendanceLabels.absent)}</option>{work.allowExempt&&<option value="exempt">{word(m.marksExempt)}</option>}</select>
      </>}
    </div></div>)}
    {work.submitted&&<label className="block text-sm">{word(m.taskReason)}<textarea className="mt-1 w-full rounded-lg border border-border bg-background p-3" disabled={frozen} value={reason} onChange={e=>{setReason(e.target.value);setReview(null);}}/></label>}
    {!frozen&&<div className="flex gap-2"><button type="button" className="rounded-xl border border-border px-4 py-3" disabled={pending||(work.submitted&&!reason.trim())} onClick={()=>setReview("draft")}>{word(work.kind==="marks"&&!work.submitted?m.taskDraft:m.taskReviewSave)}</button>{work.kind==="marks"&&!work.submitted&&<button type="button" className="rounded-xl bg-primary px-4 py-3 text-primary-foreground" onClick={()=>setReview("submit")}>{word(m.taskSubmit)}</button>}</div>}
    {review&&!result?.ok&&<div className="rounded-xl border border-primary p-4"><p>{rows.length} · {word(work.kind==="marks"?m.taskMarks:m.taskAttendance)}</p><button type="button" className="mt-3 w-full rounded-xl bg-primary px-4 py-3 text-primary-foreground" disabled={pending} onClick={save}>{word(m.taskReviewSave)}</button></div>}
    {result?.reason==="unknown"&&<button type="button" disabled={pending} className="rounded-xl border border-border px-4 py-3" onClick={save}>{word(m.taskRetry)}</button>}
  </section>;
}
