"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ms } from "@/messages/setup";
import type { Language } from "@/platform/i18n/language";
import { lead } from "@/vx/text";
import { PLAIN } from "./plain";
import { delegateTeacherTaskListAction, restartTeacherTaskAction, manageTeacherTaskAction, teacherTaskLinkAction, taskAssignmentContextAction } from "@/app/(app)/teach/tasks/actions";
export function ManageTask({ id, language, collection = false }: {
  id: string;
  language: Language;
  collection?: boolean;
}) {
  const [owners, setOwners] = useState<{
    id: string;
    name: string;
  }[]>([]);
  const [chosen, setChosen] = useState("");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState("");
  const router = useRouter();
  const word = (v: {
    hi: string;
    en: string;
  }) => lead(v, language);
  const change = (teacher: string | null) => start(async () => {
    try {
      await manageTeacherTaskAction(id, teacher);
      setStatus(lead(PLAIN.created, language));
      router.refresh();
    }
    catch {
      setStatus(word(collection ? ms.taskBlocked : ms.taskAcademicBlocked));
    }
  });
  return <section className="rounded-xl border border-border bg-card p-4"><div className="flex flex-wrap gap-3">
    <button type="button" disabled={pending} onClick={() => start(async () => {
      try {
        const path = await teacherTaskLinkAction(id);
        await navigator.clipboard.writeText(`${location.origin}${path}`);
        setStatus(word(ms.taskCopied));
      }
      catch {
        setStatus(word(ms.taskFailed));
      }
    })}>{lead(PLAIN.copy, language)}</button>
    <button type="button" disabled={pending} onClick={() => change(null)}>{lead(PLAIN.revoke, language)}</button>
    <button type="button" disabled={pending} onClick={() => start(async () => {
      try {
        setOwners((await taskAssignmentContextAction()).owners);
      }
      catch {
        setStatus(word(ms.taskFailed));
      }
    })}>{lead(PLAIN.reassign, language)}</button></div>
    {collection && <button className="mt-4 block text-primary" disabled={pending} type="button" onClick={() => start(async () => {
      try {
        const next = await restartTeacherTaskAction(id);
        router.push(`/inbox?task=${next}`);
        router.refresh();
      }
      catch {
        setStatus(word(ms.taskFailed));
      }
    })}>{lead(PLAIN.askAgain, language)}</button>}
    {owners.length > 0 && <div className="mt-3 flex gap-3"><select aria-label={word(ms.taskChoose)} value={chosen} onChange={e => setChosen(e.target.value)} className="rounded border border-border bg-background p-2"><option value="">{word(ms.taskChoose)}</option>{owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><button disabled={pending || !chosen} type="button" onClick={() => change(chosen)}>{lead(PLAIN.reassign, language)}</button></div>}
    {collection && owners.length > 0 && <button className="mt-4 block text-primary" disabled={pending || !chosen} type="button" onClick={() => start(async () => {
      try {
        await delegateTeacherTaskListAction(id, chosen);
        setStatus(lead(PLAIN.created, language));
        router.refresh();
      }
      catch {
        setStatus(word(ms.taskFailed));
      }
    })}>{word(ms.taskDelegateList)}</button>}
    {status && <p className="mt-3 text-sm" role="status">{status}</p>}
  </section>;
}
