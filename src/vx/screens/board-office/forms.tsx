"use client";
import { useRef, useState, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveBoardCycleAction, saveBoardCandidateAction, saveBoardReadinessAction, saveOfficialResultAction } from "@/app/(app)/exam-office/board/actions";
import type { ReturnStudent } from "@/modules/government-records/domain/exchange";
import { authorities, attempts, readinessStatuses, resultStatuses, type BoardCycle, type Candidate, type Readiness, type OfficialResult } from "@/modules/official-results/domain/board";
import { useVx, Bi } from "@/vx/i18n";
import { Btn } from "@/vx/ui/primitives";
import type { Pair } from "@/vx/text";
import { B, AUTHORITY, ATTEMPT, READINESS, RESULT, APPEARANCE } from "./text";

export function Field({ label, children }: { label: Pair; children: ReactNode }) { return <label className="field"><Bi {...label} />{children}</label>; }
function useSave() {
 const router = useRouter(), { tx } = useVx();
 const [busy, setBusy] = useState(false), [state, setState] = useState<"idle" | "saved" | "failed">("idle");
 const pending = useRef(false), ticket = useRef<{ signature: string; id: string } | null>(null);
 async function run(signature: unknown, operation: (id: string) => Promise<{ ok: boolean }>) {
  if (pending.current) return false; pending.current = true; setBusy(true); setState("idle");
  const serialized = JSON.stringify(signature);
  if (ticket.current?.signature !== serialized) ticket.current = { signature: serialized, id: crypto.randomUUID() };
  try { const result = await operation(ticket.current!.id); if (!result.ok) { setState("failed"); return false; } setState("saved"); router.refresh(); return true; }
  catch { setState("failed"); return false; } finally { pending.current = false; setBusy(false); }
 }
 return { busy, run, feedback: state === "failed" ? <div className="board-note" role="alert">{tx(B.failed)}</div> : state === "saved" ? <div role="status">{tx(B.saved)}</div> : null };
}
function pairs(value: FormDataEntryValue | null) { return String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const at = line.indexOf("|"); return { code: at < 0 ? line : line.slice(0, at).trim(), label: at < 0 ? line : line.slice(at + 1).trim() }; }); }
export function CycleEditor({ sessionLabel, classes, cycle, scopeFrozen = false }: { sessionLabel: string; classes: { id: string; label: string }[]; cycle?: BoardCycle; scopeFrozen?: boolean }) {
 const { tx } = useVx(), save = useSave(), router = useRouter(), config = cycle?.config;
 const cycleId = useRef<string | null>(cycle?.id ?? null);
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget); cycleId.current ??= crypto.randomUUID();
  const frozen = scopeFrozen && config;
  const payload = { expectedRevision: cycle?.revision ?? 0, config: {
   sessionLabel, label: String(form.get("label")), authority: frozen ? config.authority : String(form.get("authority")), attempt: frozen ? config.attempt : String(form.get("attempt")), attemptLabel: frozen ? config.attemptLabel : String(form.get("attemptLabel")),
   classIds: frozen ? config.classIds : form.getAll("classId").map(String), subjects: frozen ? config.subjects : pairs(form.get("subjects")), requirements: pairs(form.get("requirements")).map(row => ({ key: row.code, label: row.label, required: true })),
   sourceReference: String(form.get("sourceReference")), verifiedOn: String(form.get("verifiedOn")), responsible: String(form.get("responsible")),
   deadline: form.get("deadline") ? { date: String(form.get("deadline")), sourceReference: String(form.get("deadlineSource")), verifiedOn: String(form.get("deadlineVerifiedOn")), current: form.get("deadlineCurrent") === "on", conflict: form.get("deadlineConflict") === "on" } : null,
  } };
  if (await save.run(payload, commandId => saveBoardCycleAction({ cycleId: cycleId.current, commandId, payload }))) router.push(`/exam-office/board?cycle=${cycleId.current}`);
 }
 return <form className="board-form" onSubmit={submit}>
  <div className="board-note">{tx(B.emptyHint)}</div>
  {scopeFrozen ? <div className="board-note">{tx(B.scopeFrozen)}</div> : null}
  <Field label={B.label}><input className="inp" name="label" required minLength={3} maxLength={120} defaultValue={config?.label} /></Field>
  <div className="board-grid"><Field label={B.authority}><select className="inp" name="authority" disabled={scopeFrozen} defaultValue={config?.authority ?? "class5"}>{authorities.map(key => <option key={key} value={key}>{tx(AUTHORITY[key])}</option>)}</select></Field><Field label={B.attempt}><select className="inp" name="attempt" disabled={scopeFrozen} defaultValue={config?.attempt ?? "main"}>{attempts.map(key => <option key={key} value={key}>{tx(ATTEMPT[key])}</option>)}</select></Field></div>
  <Field label={B.attemptLabel}><input className="inp" name="attemptLabel" required minLength={2} maxLength={80} defaultValue={config?.attemptLabel} disabled={scopeFrozen} /></Field>
  <fieldset disabled={scopeFrozen}><legend><Bi {...B.classes} /></legend><div className="board-options">{classes.map(row => <label key={row.id}><input type="checkbox" name="classId" value={row.id} defaultChecked={config?.classIds.includes(row.id)} />{row.label}</label>)}</div></fieldset>
  <Field label={B.subjects}><textarea className="inp" name="subjects" required maxLength={12000} defaultValue={config?.subjects.map(row => `${row.code} | ${row.label}`).join("\n")} disabled={scopeFrozen} /></Field>
  <Field label={B.requirements}><textarea className="inp" name="requirements" maxLength={10000} defaultValue={config?.requirements.map(row => `${row.key} | ${row.label}`).join("\n")} /></Field>
  <Field label={B.circular}><textarea className="inp" name="sourceReference" required minLength={10} maxLength={1000} defaultValue={config?.sourceReference} /></Field>
  <div className="board-grid"><Field label={B.verifiedOn}><input className="inp" name="verifiedOn" type="date" required defaultValue={config?.verifiedOn} /></Field><Field label={B.responsible}><input className="inp" name="responsible" required minLength={2} maxLength={120} defaultValue={config?.responsible} /></Field></div>
  <details><summary className="board-summary">{tx(B.deadline)}</summary><div className="board-form">
   <Field label={B.deadline}><input className="inp" name="deadline" type="date" defaultValue={config?.deadline?.date} /></Field>
   <Field label={B.deadlineSource}><textarea className="inp" name="deadlineSource" maxLength={1000} defaultValue={config?.deadline?.sourceReference} /></Field>
   <Field label={B.verifiedOn}><input className="inp" name="deadlineVerifiedOn" type="date" defaultValue={config?.deadline?.verifiedOn} /></Field>
   <label><input type="checkbox" name="deadlineCurrent" defaultChecked={config?.deadline?.current ?? false} /> {tx(B.deadlineCurrent)}</label>
   <label><input type="checkbox" name="deadlineConflict" defaultChecked={config?.deadline?.conflict ?? false} /> {tx(B.deadlineConflict)}</label>
  </div></details>
  <Btn type="submit" variant="pri" disabled={save.busy || !classes.length || !sessionLabel}>{tx(save.busy ? B.saving : B.save)}</Btn>{save.feedback}
 </form>;
}
export function CandidateEditor({ cycle, student, candidate, frozen }: { cycle: BoardCycle; student: ReturnStudent; candidate?: Candidate; frozen: boolean }) {
 const { tx } = useVx(), save = useSave();
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const payload = { studentId: student.studentId, registration: frozen ? candidate?.registration : String(form.get("registration")), roll: frozen ? candidate?.roll : String(form.get("roll")), subjects: frozen ? candidate?.subjects : form.getAll("subject").map(String), verified: frozen ? candidate?.verified : form.get("verified") === "on", sourceReference: String(form.get("reference")), expectedRevision: candidate?.revision ?? 0, cycleRevision: cycle.revision, expectedSource: student.sourceRevision };
  await save.run(payload, commandId => saveBoardCandidateAction({ cycleId: cycle.id, commandId, payload }));
 }
 return <form className="board-form" onSubmit={submit}>
  <div className="board-grid"><Field label={B.registration}><input className="inp" name="registration" required maxLength={100} defaultValue={candidate?.registration} disabled={frozen} /></Field><Field label={B.roll}><input className="inp" name="roll" required maxLength={100} defaultValue={candidate?.roll} disabled={frozen} /></Field></div>
  <fieldset disabled={frozen}><legend><Bi {...B.selectedSubjects} /></legend><div className="board-options">{cycle.config.subjects.map(subject => <label key={subject.code}><input name="subject" type="checkbox" value={subject.code} defaultChecked={candidate?.subjects.includes(subject.code) ?? false} />{subject.code} · {subject.label}</label>)}</div></fieldset>
  <Field label={B.source}><textarea className="inp" name="reference" required minLength={10} maxLength={1000} defaultValue={candidate?.source_reference} /></Field>
  <label><input type="checkbox" name="verified" defaultChecked={candidate?.verified ?? false} disabled={frozen} /> {tx(B.mappingVerified)}</label>
  <Btn type="submit" disabled={save.busy || !student.identityVerified} variant="pri">{tx(save.busy ? B.saving : B.save)}</Btn>{save.feedback}
 </form>;
}
export function ReadinessEditor({ cycle, student, requirement, evidence }: { cycle: BoardCycle; student: ReturnStudent; requirement: { key: string; label: string }; evidence?: Readiness }) {
 const { tx } = useVx(), save = useSave(), stale = evidence && evidence.cycle_revision !== cycle.revision;
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const payload = { studentId: student.studentId, key: requirement.key, status: String(form.get("status")), reference: String(form.get("reference")), expectedRevision: evidence?.revision ?? 0, cycleRevision: cycle.revision, expectedSource: student.sourceRevision };
  await save.run(payload, commandId => saveBoardReadinessAction({ cycleId: cycle.id, commandId, payload }));
 }
 return <form className="board-form" onSubmit={submit} style={{ borderTop: "1px solid var(--bd)", paddingTop: 14 }}><strong>{requirement.label}</strong>{stale ? <div className="board-note">{tx(B.staleCheck)}</div> : null}<Field label={B.status}><select className="inp" name="status" defaultValue={stale ? "missing" : evidence?.status ?? "missing"}>{readinessStatuses.map(status => <option key={status} value={status}>{tx(READINESS[status])}</option>)}</select></Field><Field label={B.source}><textarea className="inp" name="reference" maxLength={1000} defaultValue={stale ? "" : evidence?.reference} /></Field><Btn type="submit" disabled={save.busy || !student.identityVerified}>{tx(save.busy ? B.saving : B.save)}</Btn>{save.feedback}</form>;
}
export function ResultEditor({ cycle, student, candidate, results }: { cycle: BoardCycle; student: ReturnStudent; candidate: Candidate; results: OfficialResult[] }) {
 const { tx } = useVx(), save = useSave();
 const [subjectCode, setSubject] = useState(candidate.subjects[0] ?? ""), [status, setStatus] = useState<OfficialResult["status"]>("pending");
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget), prior = results.find(row => row.subject_code === subjectCode);
  const payload = { studentId: student.studentId, subjectCode, status, rawValue: String(form.get("rawValue") ?? "").trim() || null, rawStatus: String(form.get("rawStatus")), appearance: String(form.get("appearance")), sourceReference: String(form.get("reference")), expectedRevision: prior?.revision ?? 0, candidateRevision: candidate.revision, cycleRevision: cycle.revision, expectedSource: student.sourceRevision };
  const file = form.get("evidence"), signature = { payload, file: file instanceof File && file.size ? { name: file.name, size: file.size, modified: file.lastModified } : null };
  await save.run(signature, async commandId => { const body = new FormData(); body.set("input", JSON.stringify({ cycleId: cycle.id, commandId, payload })); if (file instanceof File && file.size) body.set("evidence", file); return saveOfficialResultAction(body); });
 }
 return <form className="board-form" onSubmit={submit}>
  <div className="board-note">{tx(B.resultHint)}</div>
  <Field label={B.subject}><select className="inp" name="subjectCode" value={subjectCode} onChange={event => setSubject(event.target.value)}>{candidate.subjects.map(code => <option key={code} value={code}>{code} · {cycle.config.subjects.find(row => row.code === code)?.label}</option>)}</select></Field>
  <Field label={B.status}><select className="inp" name="status" value={status} onChange={event => setStatus(event.target.value as typeof status)}>{resultStatuses.map(key => <option key={key} value={key}>{tx(RESULT[key])}</option>)}</select></Field>
  <Field label={B.rawValue}><input className="inp" name="rawValue" maxLength={250} required={status === "available"} disabled={status === "pending" || status === "withheld"} /></Field>
  <Field label={B.rawStatus}><input className="inp" name="rawStatus" required maxLength={250} /></Field>
  <Field label={B.appearance}><select className="inp" name="appearance" defaultValue="unknown">{(Object.keys(APPEARANCE) as (keyof typeof APPEARANCE)[]).map(key => <option key={key} value={key}>{tx(APPEARANCE[key])}</option>)}</select></Field>
  <Field label={B.source}><textarea className="inp" name="reference" required minLength={10} maxLength={1000} /></Field>
  <Field label={B.evidence}><input className="inp" name="evidence" type="file" accept="application/pdf,image/png,image/jpeg" /></Field>
  <Btn type="submit" variant="pri" disabled={save.busy || !candidate.verified || !student.identityVerified}>{tx(save.busy ? B.saving : B.save)}</Btn>{save.feedback}
 </form>;
}
