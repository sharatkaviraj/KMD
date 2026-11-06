"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createTeacherTasksAction, previewTeacherTasksAction } from "@/app/(app)/teach/tasks/actions";
import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import type { Language } from "@/platform/i18n/language";
import { lead, p } from "@/vx/text";

import type { AssignmentContext, AssignmentInput, AssignmentPreview } from "../data/assignment";
import type { AssignmentMode, TaskKind } from "../domain/tasks";
import { PLAIN } from "./plain";

const inputClass = "w-full rounded-lg border border-border bg-background p-2 text-sm";

export function AssignmentEditor({ context, selectedIds, initialKind, initialMissing, language, close }: {
  context: AssignmentContext;
  selectedIds?: string[];
  initialKind: TaskKind;
  initialMissing: string;
  language: Language;
  close: () => void;
}) {
  const router = useRouter();
  const word = (v: {
    en: string;
    hi: string;
  }) => lead(v, language);
  const [kind, setKind] = useState<TaskKind>(initialKind);
  const [title, setTitle] = useState(word(initialKind === "marks" ? m.taskMarks : m.taskDetails));
  const [mode, setMode] = useState<AssignmentMode>(initialKind === "marks" ? "subject" : "class");
  const [teacher, setTeacher] = useState("");
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState("");
  const [day, setDay] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [paper, setPaper] = useState("");
  const [missing, setMissing] = useState(initialMissing);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedIds ?? []));
  const [fields, setFields] = useState<string[]>(() => context.fields.filter(f => f.key === (initialMissing === "photo" ? "student_photo" : initialMissing) || (!initialMissing && selectedIds?.length === 1 && !context.students.find(s => s.id === selectedIds[0])?.values[f.key])).map(f => f.id));
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"error" | "created" | "existing" | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    reused: boolean;
    teacherId: string;
  }[]>([]);
  const [scopeTask, setScopeTask] = useState<string | null>(null);
  const matching = context.students.filter(s => missing === "photo" ? !s.hasPhoto : missing ? !s.values[missing] : true);
  // One child chosen from their own page: only that child, never the whole school's list (smoke run, 20 Oct).
  const only = selectedIds?.length === 1 ? context.students.find(s => s.id === selectedIds[0]) ?? null : null;
  const choose = (id: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const requestPreview = () => {
    setStatus(null);
    setScopeTask(null);
    start(async () => {
      try {
        const input: AssignmentInput = {
          kind, title, mode, selectedIds: [...selected], fieldIds: fields,
          dueDate: due || null, overrides,
          ...(teacher ? { teacherId: teacher } : {}),
          ...(subject ? { subjectId: subject } : {}),
          ...(paper ? { paperId: paper } : {}), ...(day ? { day } : {}),
        };
        setPreview(await previewTeacherTasksAction(input));
      } catch { setStatus("error"); }
    });
  };
  const create = () => {
    if (!preview?.previewId || !preview.digest) return;
    setScopeTask(null);
    start(async () => {
      try {
        const result = await createTeacherTasksAction(preview.previewId!, preview.digest!);
        if (!result.ok) {
          if (result.reason === "scope_changed") setScopeTask(result.taskId);
          setStatus(result.reason === "recipient_changed" ? "existing" : "error");
          return;
        }
        setCreated(result.tasks);
        setStatus("created");
        router.refresh();
      } catch { setStatus("error"); }
    });
  };
  const changeOwner = (key: string, teacherId: string) => {
    if (key.startsWith("common:")) setTeacher(teacherId);
    else setOverrides(current => ({ ...current, [key]: teacherId }));
    setPreview(null);
  };
  return <div className="space-y-4 pb-6">
    {scopeTask && <Link href={`/inbox?task=${scopeTask}`} className="block rounded-xl border border-primary p-3">{word(ms.taskScopeChanged)}</Link>}
    {status && <p role="status" className="rounded-xl bg-accent-soft p-3">{status === "created" ? lead(PLAIN.created, language) : word(status === "existing" ? ms.taskExistingOther : ms.taskFailed)}</p>}
    {created.map(t => <Link className="block rounded-lg border border-border p-3" key={t.id} href={`/inbox?task=${t.id}`}>{context.owners.find(o => o.id === t.teacherId)?.name ?? word(ms.taskUnavailable)} - {lead(t.reused ? PLAIN.reused : PLAIN.assigned, language)}</Link>)}
    {!preview ? <>
      <label className="block text-sm">{word(ms.taskTitle)}<input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} maxLength={120} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>{word(m.taskDetails)}<select className={inputClass} value={kind} onChange={e => setKind(e.target.value as TaskKind)}>
          <option value="collection">{word(m.taskDetails)}</option>
          <option value="marks">{word(m.taskMarks)}</option>
          <option value="attendance">{word(m.taskAttendance)}</option>
        </select>
        </label>
        <label>{word(ms.taskDue)}<input className={inputClass} type="date" value={due} onChange={e => setDue(e.target.value)} />
        </label>
      </div>
      {kind === "collection" ? <>
        <label className="block">{word(ms.taskAssign)}<select className={inputClass} value={mode} onChange={e => setMode(e.target.value as AssignmentMode)}>{([["common", ms.taskCommon], ["class", ms.taskClass], ["house", ms.taskHouse], ["route", ms.taskRoute], ["subject", ms.taskSubject]] as const).map(([value, label]) => <option key={value} value={value}>{word(label)}</option>)}</select>
        </label>
        <fieldset>
          <legend>{word(ms.taskFields)}</legend>
          <div className="grid grid-cols-2 gap-2">{context.fields.map(f => <label key={f.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fields.includes(f.id)} onChange={() => setFields(cur => cur.includes(f.id) ? cur.filter(id => id !== f.id) : [...cur, f.id])} />{word({ hi: f.labelHi, en: f.labelEn })}</label>)}</div>
        </fieldset>
      </> : <p className="rounded-lg bg-accent-soft p-3 text-sm">{word(ms.taskWholeScope)}</p>}
      {kind === "collection" && mode === "common" && <label>{word(ms.taskChoose)}<select className={inputClass} value={teacher} onChange={e => setTeacher(e.target.value)}>
        <option value="">{word(ms.taskChoose)}</option>{context.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      </label>}
      {kind === "collection" && mode === "subject" && <select aria-label={word(ms.taskSubject)} className={inputClass} value={subject} onChange={e => setSubject(e.target.value)}>
        <option value="">{word(ms.taskSubject)}</option>{context.subjects.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}
      {kind === "marks" && <select aria-label={word(m.taskMarks)} className={inputClass} value={paper} onChange={e => setPaper(e.target.value)}>
        <option value="">{word(ms.taskChoose)}</option>{context.papers.filter(p => !selected.size || context.students.some(s => selected.has(s.id) && s.classId === p.classId)).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
      {kind === "attendance" && <input aria-label={word(m.taskAttendance)} className={inputClass} type="date" value={day} onChange={e => setDay(e.target.value)} />}
      {only ? <p className="rounded-lg border border-border p-3 text-sm">
        <span className="font-medium">{only.name} · {only.classLabel}</span>
        {kind === "collection" ? <span className="block text-muted-foreground">{lead(fields.length ? p("The details this child is missing are ticked above.", "इस बच्चे की जो जानकारी बाकी है, ऊपर चुनी गई है।") : p("Nothing is missing for this child. Tick what the teacher should check.", "इस बच्चे की कोई जानकारी बाकी नहीं। शिक्षक क्या जाँचें, ऊपर चुनें।"), language)}</span> : null}
      </p> : <>
      <label>{word(ms.taskMissing)}<select className={inputClass} value={missing} onChange={e => setMissing(e.target.value)}>
        <option value="">{word(ms.taskAll)}</option>
        <option value="photo">{word(ms.taskNoPhoto)}</option>{context.fields.map(f => <option key={f.key} value={f.key}>{word({ hi: f.labelHi, en: f.labelEn })}</option>)}</select>
      </label>
      <button type="button" className="text-sm font-medium text-primary" onClick={() => setSelected(new Set(matching.map(s => s.id)))}>{word(ms.taskSelectAll)} ({matching.length})</button>
      <p>{word(ms.taskSelected)}: {selected.size}</p>
      <div className="max-h-64 overflow-auto rounded-lg border border-border">{matching.map(s => <label key={s.id} className="flex min-h-11 items-center gap-3 border-b border-border px-3">
        <input type="checkbox" checked={selected.has(s.id)} onChange={() => choose(s.id)} />
        <span className="text-sm">{s.name} · {s.classLabel}</span>
      </label>)}</div>
      </>}
      <button type="button" className="w-full rounded-xl bg-primary px-4 py-3 text-primary-foreground" disabled={pending || !selected.size || !title} onClick={requestPreview}>{word(ms.taskPreview)}</button>
    </> : <>
      <p className="font-medium">{title} · {preview.dueDate ?? "—"}</p>
      <p className="text-sm">{preview.fields.join(" · ")}</p>
      {preview.groups.map(g => <section key={g.key} className="rounded-xl border border-border p-3">
        <p>{g.label} · {g.studentIds.length}</p>
        <select aria-label={word(ms.taskChoose)} className={inputClass} value={overrides[g.key] ?? g.teacherId} onChange={e => changeOwner(g.key, e.target.value)}>{context.owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <details className="mt-2 text-sm">
          <summary>{word(ms.taskSelected)}</summary>{preview.students.filter(s => g.studentIds.includes(s.id)).map(s => <p key={s.id}>{s.name} · {s.classLabel}</p>)}</details>
      </section>)}
      {preview.blocked.map(g => <section key={g.key} className="rounded-xl border border-warning p-3">
        <p>{g.label} · {g.studentIds.length}</p>
        <p className="text-sm">{word(kind === "collection" ? ms.taskBlocked : ms.taskAcademicBlocked)}</p>
        <select aria-label={word(ms.taskChoose)} className={inputClass} value={overrides[g.key] ?? ""} onChange={e => changeOwner(g.key, e.target.value)}>
          <option value="">{word(ms.taskChoose)}</option>{context.owners.filter(o => g.candidates.includes(o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      </section>)}
      {preview.unassigned.length > 0 && <p role="alert">{word(ms.taskUnassigned)} ({preview.unassigned.length})</p>}
      <div className="flex gap-2">
        <button className="rounded-xl border border-border px-4 py-3" type="button" disabled={pending} onClick={() => { setPreview(null); setStatus(null); }}>{word(ms.taskEdit)}</button>
        <button className="flex-1 rounded-xl bg-primary px-4 py-3 text-primary-foreground" type="button" disabled={pending || !preview.previewId || status === "created"} onClick={create}>{word(ms.taskCreate)}</button>
      </div>
    </>}
    <button type="button" className="text-sm text-muted-foreground" onClick={close}>{word(ms.taskCancel)}</button>
  </div>;
}
