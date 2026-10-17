"use client";

import { PrivatePhoto } from "@/modules/collection/ui/private-photo";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { placePhotoAction, type PhotoResult } from "@/app/(app)/collection/photos/actions";
import { m } from "@/messages";
import { ms, photoMessages as words } from "@/messages/setup";
import {
  photoAmbiguityLabels,
  placePhotos,
  type PhotoMatch,
} from "@/modules/collection/domain/photo-placement";
import { loadDraft, saveDraft, removeDraft } from "@/platform/drafts/store";
import { readDraft } from "@/platform/drafts/policy";
import { primary, type Localized } from "@/platform/i18n/language";
import { useLanguage } from "@/platform/i18n/use-language";
import { Notice, Select } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { ProfilePhotoControl, compressPhoto, photoFile } from "./profile-photo-editor";

export type PhotoRosterChild = {
  studentId: string;
  name: string;
  srNo: string | null;
  externalId: string | null;
  photoId: string | null;
  photoUrl: string | null;
};

/** One child: the photograph or its absence, and the two ways to place one. */
export function PhotoTile({ child }: { child: PhotoRosterChild }) {
  const language = useLanguage();
  return <div data-photo-child={child.studentId} data-has-photo={child.photoId ? "yes" : "no"} className="space-y-2">
    <p className="font-medium">{child.name}</p>
    {child.photoUrl ? <PrivatePhoto src={child.photoUrl} alt={child.name} className="size-16 rounded-xl object-cover" /> : null}
    <ProfilePhotoControl credential={{kind:"student",id:child.studentId}} language={language} />
  </div>;
}

type Planned = { name: string; data: string; match: PhotoMatch; chosen: string; commandId: string | null; expected: string | null };
function isPlan(value: unknown): value is Planned[] {
  return Array.isArray(value) && value.every(e => e && typeof e.name === "string" && typeof e.chosen === "string"
    && typeof e.data === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(e.data) && e.data.length <= 280000
    && (e.commandId === null || typeof e.commandId === "string") && (e.expected === null || typeof e.expected === "string")
    && ["matched", "ambiguous", "none"].includes(e.match?.kind));
}

/** Filename matching remains office-only. Persist each exact command before sending. */
export function FolderPlacement({ roster, recoveryScope }: { roster: PhotoRosterChild[]; recoveryScope: string }) {
  const language = useLanguage(), router = useRouter();
  const key = `vpps:photo-folder:${recoveryScope}`;
  const [planned, setPlanned] = useState<Planned[]>([]), [recovered, setRecovered] = useState<Planned[] | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState<Localized | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const byId = useMemo(() => new Map(roster.map(c => [c.studentId, c])), [roster]);
  useEffect(() => {
    let cancelled = false;
    loadDraft(key).then(raw => { if (!cancelled) { const saved=readDraft(raw,isPlan)?.value; setRecovered(saved?.length ? saved : null); setReady(true); } }).catch(() => { if (!cancelled) setError(words.storage); });
    return () => { cancelled = true; };
  },[key]);
  const persist = (value: Planned[]) => value.length ? saveDraft(key,{version:1,baseline:"photo-folder",value,updatedAt:Date.now()}) : removeDraft(key);
  const uncertain = planned.some(p => p.commandId);
  const selected = planned.filter(p => p.chosen && byId.has(p.chosen));
  const read = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files=[...(event.target.files ?? [])]; event.target.value="";
    if (!ready || pending || recovered || uncertain) return;
    startTransition(async()=>{
      setError(null); setProgress(null);
      try {
        const matches=placePhotos(files.map(f=>f.name),roster);
        const next=await Promise.all(matches.map(async(entry,index):Promise<Planned>=>({name:files[index].name,data:await compressPhoto(files[index]),match:entry.match,chosen:entry.match.kind==="matched"?entry.match.studentId:"",commandId:null,expected:null})));
        await persist(next);setPlanned(next);
      } catch { setError(words.invalid); }
    });
  };
  const place = () => startTransition(async()=>{
    setError(null);setProgress({done:0,total:selected.length});
    let remaining=[...planned];
    for (const [index,entry] of selected.entries()) {
      const command=entry.commandId?entry:{...entry,commandId:crypto.randomUUID(),expected:byId.get(entry.chosen)?.photoId??null};
      const before=remaining;
      remaining=remaining.map(e=>e===entry?command:e);
      try { await persist(remaining); } catch { remaining=before; setPlanned(remaining);setError(words.storage);return; }
      setPlanned(remaining);
      const form=new FormData();form.set("photo",photoFile(command.data));form.set("commandId",command.commandId!);
      form.set("studentId",command.chosen);form.set("expectedCurrent",command.expected??"");form.set("source","folder");form.set("sourceRef",command.name);
      let result: PhotoResult;
      try { result=await placePhotoAction(form); if (!result || typeof result.ok!=="boolean") result={ok:false,reason:"unknown",message:words.unknown}; } catch { result={ok:false,reason:"unknown",message:words.unknown}; }
      if (result.ok) remaining=remaining.filter(e=>e!==command);
      else if (result.reason!=="unknown") remaining=remaining.map(e=>e===command?{...command,commandId:null}:e);
      setPlanned(remaining);setProgress({done:index+1,total:selected.length});
      try { await persist(remaining); } catch { setError(words.storage);return; }
      if (!result.ok) { setError(result.reason==="unknown"?words.unknown:result.message); break; }
    }
    router.refresh();
  });
  return <div className="space-y-3" data-photo-folder>
    {recovered ? <button type="button" className="min-h-11 text-accent" onClick={()=>{setPlanned(recovered);setRecovered(null);}}>{primary(words.restore,language)}</button> : null}
    <label className="block text-[13px] font-medium">{primary(ms.photoFolder,language)}<input type="file" multiple accept="image/jpeg,image/png,image/webp" className="mt-1 block text-[13px]" disabled={!ready||pending||Boolean(recovered)||uncertain} onChange={read} name="folder"/></label>
    {planned.length ? <ul className="space-y-2" data-photo-plan>{planned.map((entry,index)=><li key={index} className="flex flex-wrap items-center gap-2" data-photo-file={entry.name} data-match={entry.match.kind}>
      <span className="text-sm">{entry.name}</span>
      <PrivatePhoto src={entry.data} alt={primary(words.preview,language)} className="size-14 rounded-lg object-cover"/>
      {entry.match.kind==="matched" ? <span>{byId.get(entry.chosen)?.name}</span> : <>
        <span>{primary(entry.match.kind==="ambiguous"?photoAmbiguityLabels[entry.match.why]:ms.photoNoMatch,language)}</span>
        <Select aria-label={primary(ms.photoWhichChild,language)} value={entry.chosen} disabled={pending||Boolean(entry.commandId)} onChange={e=>setPlanned(current=>current.map((p,i)=>i===index?{...p,chosen:e.target.value}:p))}>
          <option value="">{primary(ms.photoLeaveOut,language)}</option>{roster.map(c=><option key={c.studentId} value={c.studentId}>{c.name}</option>)}
        </Select></>}
    </li>)}</ul>:null}
    {planned.some(p=>p.match.kind!=="matched")?<Notice tone="warning" text={ms.photoTrayHint} language={language}/>:null}
    {planned.length ? <div className="flex gap-2"><Button type="button" onClick={place} loading={pending} loadingText={primary(m.saving,language)} disabled={!selected.length||Boolean(recovered)}>{primary(uncertain?words.retry:ms.photoPlaceAll,language)} ({selected.length})</Button><Button type="button" disabled={pending||uncertain} onClick={()=>startTransition(async()=>{try{await removeDraft(key);setPlanned([]);}catch{setError(words.storage);}})}>{primary(words.cancel,language)}</Button></div>:null}
    {error?<p role="status" className="text-sm text-destructive">{primary(error,language)}</p>:null}
    {progress?<p role="status" data-photo-progress>{progress.done} / {progress.total}</p>:null}
  </div>;
}
