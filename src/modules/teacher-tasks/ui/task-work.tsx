"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { m } from "@/messages";
import { primary, type Language } from "@/platform/i18n/language";
import { RequestForm } from "@/modules/collection/ui/request-form";
import type { CollectionRequest, RollRow } from "@/modules/collection/domain/requests";
import type { LinkState } from "@/modules/collection/domain/link-state";
import { attendanceLabels, attendanceStatuses } from "@/modules/attendance/domain/attendance";
import { marksRefusals } from "@/modules/assessments/domain/marks-command";
import type { AcademicWork } from "../data/repo";
import type { TaskSaveResult } from "../data/save";
import { academicDraftValue, type AcademicDraft } from "../domain/academic-draft";
import { useAcademicDraft } from "./use-academic-draft";
import { saveTeacherCollectionAction, saveTeacherTaskAction } from "@/app/(app)/teach/tasks/actions";
import type { PhotoCredential } from "@/modules/collection/domain/profile-photo";

export function TaskCollectionForm({ id, request, roll, language, token, draftScope, photoCredential }: {
  id: string; request: CollectionRequest; roll: RollRow[]; language: Language; token?: string; draftScope: string; photoCredential?: PhotoCredential;
}) {
  const submit = async (previous: LinkState, form: FormData): Promise<LinkState> => {
    if (!token) return saveTeacherCollectionAction(id, previous, form);
    try {
      const response = await fetch(`/t/tasks/${encodeURIComponent(token)}/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: JSON.parse(String(form.get("payload") ?? "[]")) }),
      });
      const result = await response.json();
      return result.status ? result : { status: "error", message: m.linkClosed };
    } catch { return { status: "error", message: m.notSaved }; }
  };
  return <>
    <p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm">{primary(m.taskApprovalNote, language)}</p>
    <RequestForm photoCredential={photoCredential??{kind:"task",id,token}} token="" draftScope={draftScope} sessionLabel={request.sessionLabel} fields={request.fields} roll={roll} language={language} submitAction={submit} />
  </>;
}

type AcademicProps = { work: AcademicWork; language: Language; token?: string };
export function TaskAcademicForm(props: AcademicProps) {
  // An actor/capability change remounts all state, including an outstanding read.
  return <AcademicEditor key={props.work.draftScope} {...props} />;
}

function AcademicEditor({ work, language, token }: AcademicProps) {
  const router = useRouter();
  const word = (value: { hi: string; en: string }) => primary(value, language);
  const [rows, setRows] = useState(work.rows);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<TaskSaveResult | null>(null);
  const [review, setReview] = useState<"draft" | "submit" | null>(null);
  const [command, setCommand] = useState<AcademicDraft["command"]>(null);
  const sending = useRef(false);
  const draft = useAcademicDraft(work);

  const edit = (nextRows: typeof rows, nextReason = reason) => {
    setRows(nextRows); setReason(nextReason); setReview(null); setResult(null); setCommand(null);
    void draft.persist(academicDraftValue(nextRows, nextReason, null));
  };
  const restore = () => {
    if (!draft.recovered) return;
    const value = draft.recovered.value;
    setRows(work.rows.map(row => ({ ...row, ...value.rows.find(r => r.id === row.id)! })));
    setReason(value.reason); setCommand(value.command);
    if (value.command) setResult({ ok: false, reason: "unknown" });
    draft.dismissRecovery();
  };
  const save = () => {
    if (sending.current || !draft.ready || draft.recovered) return;
    const payload = command?.payload ?? (work.kind === "marks" ? {
      commandId: crypto.randomUUID(), paperId: work.paperId,
      kind: work.submitted ? "correction" : review ?? "draft", expectedRevision: work.revision, reason,
      entries: rows.map(row => ({ studentId: row.id, state: row.state, value: row.state === "value" ? row.value : null })),
    } : {
      commandId: crypto.randomUUID(), classId: work.classId, day: work.day,
      kind: work.submitted ? "correction" : "save", expectedRevision: work.revision, reason,
      marks: rows.map(row => ({ studentId: row.id, status: row.state })),
    });
    sending.current = true;
    start(async () => {
      // Store the exact identity before sending. Reload during the request is
      // conservatively uncertain and only retries that original command id.
      const next = academicDraftValue(rows, reason, { payload });
      if (!await draft.persist(next)) { sending.current = false; return; }
      setCommand({ payload });
      try {
        const out: TaskSaveResult = token
          ? await fetch(`/t/tasks/${encodeURIComponent(token)}/save`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }),
          }).then(response => response.json())
          : await saveTeacherTaskAction(work.taskId, { kind: work.kind, session: work.session, payload });
        if (!out || typeof out.ok !== "boolean" || (!out.ok && typeof out.reason !== "string")) throw new Error("unknown_response");
        setResult(out);
        if (out.ok) {
          await draft.clear(); setReview(null); router.refresh();
        } else if (out.reason !== "unknown") {
          setCommand(null); setReview(null);
          await draft.persist(academicDraftValue(rows, reason, null));
        }
      } catch { setResult({ ok: false, reason: "unknown" }); }
      finally { sending.current = false; }
    });
  };
  const frozen = !draft.ready || !!draft.recovered || pending || result?.reason === "unknown" || result?.ok === true;
  const outstandingCommand = command ?? draft.recovered?.value.command;
  const localMessage = draft.status === "error" ? m.draftStorageError : draft.status === "writing" ? m.draftWriting : draft.status === "local" ? (outstandingCommand ? m.taskDraftUnconfirmed : m.draftLocal) : null;
  const refusal = work.kind === "marks" && result?.reason ? marksRefusals[result.reason] ?? m.taskRefused : m.taskRefused;

  return <section className="space-y-4">
    {draft.recovered && <div className="rounded-xl border border-primary p-3" role="status">
      <p>{word(draft.recovered.value.command ? m.taskUnknown : draft.changed ? m.draftChanged : m.draftFound)}</p>
      <button type="button" className="mr-4 py-2 text-primary" onClick={restore}>{word(m.draftRestore)}</button>
      {!draft.recovered.value.command && <button type="button" onClick={() => void draft.clear()}>{word(m.draftDiscard)}</button>}
    </div>}
    {localMessage && <p role="status" className="text-sm">{word(localMessage)}</p>}
    {!draft.online && <p className="text-sm">{word(m.draftOffline)}</p>}
    {result && <p role="status" className="rounded-xl bg-accent-soft p-3">
      {word(result.ok ? m.taskSaved : result.reason === "unknown" ? m.taskUnknown : refusal)}
      {result.revision ? ` · ${result.revision}` : ""}
    </p>}
    {work.day && <p>{work.day}</p>}
    {rows.map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <label htmlFor={`task-${row.id}`} className="min-w-0 text-sm font-medium">{row.name}</label>
      <div className="flex shrink-0 gap-2">
        {work.kind === "attendance" ? <select
          id={`task-${row.id}`} className="max-w-40 rounded-lg border border-border bg-background p-2 text-sm"
          disabled={frozen} value={row.state}
          onChange={event => edit(rows.map(r => r.id === row.id ? { ...r, state: event.target.value } : r))}
        >{attendanceStatuses.map(status => <option key={status} value={status}>{word(attendanceLabels[status])}</option>)}</select> : <>
          <input
            id={`task-${row.id}`} aria-label={`${row.name} ${word(m.taskMarks)}`}
            className="w-20 rounded-lg border border-border bg-background p-2" type="number" min={0} max={work.max} step={work.step}
            value={row.value ?? ""} disabled={frozen || row.state === "absent" || row.state === "exempt"}
            onChange={event => edit(rows.map(r => r.id === row.id ? { ...r, state: event.target.value === "" ? "blank" : "value", value: event.target.value === "" ? null : Number(event.target.value) } : r))}
          />
          <select
            aria-label={row.name} className="w-24 rounded-lg border border-border bg-background p-2 text-sm"
            value={row.state} disabled={frozen}
            onChange={event => edit(rows.map(r => r.id === row.id ? { ...r, state: event.target.value, value: event.target.value === "value" ? row.value ?? 0 : null } : r))}
          >
            <option value="blank">-</option><option value="value">{word(m.taskMarks)}</option>
            <option value="absent">{word(attendanceLabels.absent)}</option>
            {work.allowExempt && <option value="exempt">{word(m.marksExempt)}</option>}
          </select>
        </>}
      </div>
    </div>)}
    {work.submitted && <label className="block text-sm">{word(m.taskReason)}
      <textarea className="mt-1 w-full rounded-lg border border-border bg-background p-3" maxLength={300} disabled={frozen}
        value={reason} onChange={event => edit(rows, event.target.value)} />
    </label>}
    {!frozen && <div className="flex gap-2">
      <button type="button" className="rounded-xl border border-border px-4 py-3" disabled={work.submitted && !reason.trim()} onClick={() => setReview("draft")}>
        {word(work.kind === "marks" && !work.submitted ? m.taskDraft : m.taskReviewSave)}
      </button>
      {work.kind === "marks" && !work.submitted && <button type="button" className="rounded-xl bg-primary px-4 py-3 text-primary-foreground" onClick={() => setReview("submit")}>{word(m.taskSubmit)}</button>}
    </div>}
    {review && !result?.ok && result?.reason !== "unknown" && <div className="rounded-xl border border-primary p-4">
      <p>{rows.length} · {word(work.kind === "marks" ? m.taskMarks : m.taskAttendance)}</p>
      <button type="button" className="mt-3 w-full rounded-xl bg-primary px-4 py-3 text-primary-foreground" disabled={pending} onClick={save}>{word(m.taskReviewSave)}</button>
    </div>}
    {result?.reason === "unknown" && <button type="button" disabled={pending} className="rounded-xl border border-border px-4 py-3" onClick={save}>{word(m.taskRetry)}</button>}
  </section>;
}
