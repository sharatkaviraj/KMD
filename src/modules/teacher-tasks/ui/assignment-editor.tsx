"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { createTeacherTasksAction, previewTeacherTasksAction } from "@/app/(app)/teach/tasks/actions";
import { ms } from "@/messages/setup";
import { byClassLabel } from "@/modules/academics/domain/class-order";
import { addDays, dayLabel } from "@/platform/dates";
import type { Language } from "@/platform/i18n/language";
import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { lead, p, type Pair } from "@/vx/text";
import { Avatar, Btn, Pill, SuccessTick } from "@/vx/ui/primitives";

import type { AssignmentContext, AssignmentInput, AssignmentPreview } from "../data/assignment";
import { autoTitle, missingAny, missingByField } from "../domain/collect";
import { ownsScope, planTasks, type AssignmentMode, type TaskKind, type TaskOwner, type TaskScope, type TaskStudent } from "../domain/tasks";
import type { SendQueue as SendQueueComponent } from "./send-queue";
import { CW } from "./collect-words";

/*
 * Ask teachers (D-522): the old form's selects and a whole-school checkbox
 * list, rebuilt as four numbered questions with big tiles. The first one is
 * also the "what is missing" view: every detail says how many children lack
 * it, so the office asks for exactly that and teachers see only those
 * children. The plan below the questions is worked out as you tap (the same
 * `planTasks` the server checks with), so "12 children · 3 teachers" is known
 * before anything is sent. After "Give work", the WhatsApp send list opens
 * right here.
 */

type DueChoice = "1" | "3" | "7" | "pick" | "none";

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: "14px 14px 16px", borderRadius: 18, border: "1px solid var(--bd)", background: "var(--card)" };
const tileBase: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "10px 14px", borderRadius: 14, border: "1.5px solid var(--bd)", background: "var(--card)", cursor: "pointer", transition: "border-color .18s ease, background-color .18s ease" };
const tileOn: CSSProperties = { borderColor: "var(--acc)", background: "var(--accs)" };
const check: CSSProperties = { width: 22, height: 22, flex: "none", accentColor: "var(--acc)", margin: 0 };

function kolkataToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** Teachers and groups the plan would make, worked out the way the server will check it. */
function planSummary(students: readonly TaskStudent[], owners: readonly TaskOwner[], targets: readonly string[], input: { mode: AssignmentMode; teacherId?: string; subjectId?: string; overrides: Record<string, string> }): { teachers: number; choose: number; orphan: number } | null {
  try {
    const set = new Set(targets);
    const result = planTasks(students.filter((s) => set.has(s.id)), owners, input);
    // A group with candidates is picked on the next step; one with none needs another way.
    const choose = result.blocked.filter((b) => b.candidates.length > 0).length;
    return { teachers: new Set(result.groups.map((g) => g.teacherId)).size, choose, orphan: result.blocked.length - choose + (result.unassigned.length ? 1 : 0) };
  } catch {
    return null;
  }
}

function Question({ n, title, sub, children }: { n: number; title: string; sub?: string; children: ReactNode }) {
  return (
    <section style={{ ...box, animation: `xIn .35s var(--ease) ${n * 60}ms both` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden="true" className="num" style={{ flex: "none", width: 28, height: 28, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--acc)", color: "#fff", fontSize: 14, fontWeight: 700 }}>{n}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}>{title}</h3>
          {sub ? <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.4 }}>{sub}</span> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Choice({ on, onPick, icon, title, sub, type = "radio", name }: { on: boolean; onPick: () => void; icon?: IconName; title: string; sub?: string; type?: "radio" | "checkbox"; name: string }) {
  return (
    <label className="tap" style={{ ...tileBase, ...(on ? tileOn : null) }}>
      <input type={type} name={name} checked={on} onChange={onPick} style={check} />
      {icon ? <Ic n={icon} size={20} style={{ color: on ? "var(--acc)" : "var(--mut)" }} /> : null}
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{title}</span>
        {sub ? <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.35 }}>{sub}</span> : null}
      </span>
    </label>
  );
}

export function AssignmentEditor({ context, selectedIds, initialKind, initialMissing, language, close }: {
  context: AssignmentContext;
  selectedIds?: string[];
  initialKind: TaskKind;
  initialMissing: string;
  language: Language;
  close: () => void;
}) {
  const router = useRouter();
  const say = (pair: Pair) => lead(pair, language);
  const word = (v: { en: string; hi: string }) => lead(v, language);
  const fieldWord = (f: { labelEn: string; labelHi: string }) => (language === "hi" ? f.labelHi || f.labelEn : f.labelEn);

  // One child chosen from their own page: only that child, never the whole school's list (smoke run, 20 Oct).
  const only = selectedIds?.length === 1 ? context.students.find((s) => s.id === selectedIds[0]) ?? null : null;
  const picked = selectedIds && selectedIds.length > 1 ? new Set(selectedIds) : null;

  const [today] = useState(() => context.today ?? kolkataToday());
  const [kind, setKind] = useState<TaskKind>(initialKind);
  const [fields, setFields] = useState<string[]>(() => context.fields.filter((f) => f.key === (initialMissing === "photo" ? "student_photo" : initialMissing) || (!initialMissing && selectedIds?.length === 1 && !context.students.find((s) => s.id === selectedIds[0])?.values[f.key])).map((f) => f.id));
  const [scope, setScope] = useState<"missing" | "all">("missing");
  const [classes, setClasses] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<AssignmentMode>(initialKind === "marks" ? "subject" : "class");
  const [teacher, setTeacher] = useState("");
  const [subject, setSubject] = useState("");
  const [more, setMore] = useState(false);
  const [dueChoice, setDueChoice] = useState<DueChoice>("3");
  const [pickedDue, setPickedDue] = useState("");
  const [paper, setPaper] = useState("");
  const [day, setDay] = useState(today);
  const [attendanceClasses, setAttendanceClasses] = useState<ReadonlySet<string>>(() => new Set(only ? [only.classId] : []));
  const [ownTitle, setOwnTitle] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  // A changed teacher re-checks the list in place; until it is back, "Give work" waits.
  const [stale, setStale] = useState(false);
  const [changing, setChanging] = useState<ReadonlySet<string>>(new Set());
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"error" | "existing" | null>(null);
  const [created, setCreated] = useState<{ id: string; reused: boolean; teacherId: string }[] | null>(null);
  const [scopeTask, setScopeTask] = useState<string | null>(null);
  const [SendList, setSendList] = useState<{ C: typeof SendQueueComponent } | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  /* ---------------------------------------------------- who is in it */
  // School order from the server; an older context falls back to the numeric order of the names.
  const classOptions: [string, string][] = context.classes
    ? context.classes.map((c) => [c.id, c.label])
    : [...new Map(context.students.map((s) => [s.classId, s.classLabel])).entries()].sort((a, b) => byClassLabel(a[1], b[1]));
  const pool = only ? [only] : picked ? context.students.filter((s) => picked.has(s.id)) : context.students.filter((s) => classes.size === 0 || classes.has(s.classId));
  const chosenFields = context.fields.filter((f) => fields.includes(f.id));
  const missing = missingByField(pool, context.fields);
  const missingIds = missingAny(pool, chosenFields);
  const chosenPaper = context.papers.find((x) => x.id === paper) ?? null;
  const papers = context.papers.filter((x) => (only ? x.classId === only.classId : picked ? pool.some((s) => s.classId === x.classId) : true));

  const targets: string[] = kind === "collection"
    ? (only || picked || scope === "all" ? pool.map((s) => s.id) : missingIds)
    : kind === "marks"
      ? (chosenPaper ? context.students.filter((s) => s.classId === chosenPaper.classId).map((s) => s.id) : [])
      : context.students.filter((s) => attendanceClasses.has(s.classId)).map((s) => s.id);

  const effectiveMode: AssignmentMode = kind === "marks" ? "subject" : kind === "attendance" ? "class" : mode;
  const effectiveSubject = kind === "marks" ? chosenPaper?.subjectId : subject || undefined;
  const plan = planSummary(context.students, context.owners, targets, { mode: effectiveMode, teacherId: teacher || undefined, subjectId: effectiveSubject, overrides });

  const autoName = kind === "collection" ? autoTitle(chosenFields, language === "hi" ? "hi" : "en") || say(CW.kindDetails) : kind === "marks" ? (chosenPaper ? word(chosenPaper.label) : say(CW.kindMarks)) : day;
  const title = (ownTitle ?? autoName).trim();
  const due = dueChoice === "none" ? null : dueChoice === "pick" ? pickedDue || null : addDays(today, Number(dueChoice));

  const ready = targets.length > 0 && title.length > 0 && !pending && (
    kind === "collection" ? chosenFields.length > 0 && (mode !== "common" || !!teacher) && (mode !== "subject" || !!subject)
      : kind === "marks" ? !!chosenPaper
        : !!day && attendanceClasses.size > 0);

  const requestPreview = (next: { overrides?: Record<string, string>; teacher?: string } = {}) => {
    const useOverrides = next.overrides ?? overrides;
    const useTeacher = next.teacher ?? teacher;
    setStatus(null);
    setScopeTask(null);
    start(async () => {
      try {
        const input: AssignmentInput = {
          kind, title: title.slice(0, 120), mode: effectiveMode, selectedIds: targets, fieldIds: kind === "collection" ? fields : [],
          dueDate: due, overrides: useOverrides,
          ...(effectiveMode === "common" && useTeacher ? { teacherId: useTeacher } : {}),
          ...(kind === "collection" && mode === "subject" && subject ? { subjectId: subject } : {}),
          ...(kind === "marks" && paper ? { paperId: paper } : {}),
          ...(kind === "attendance" && day ? { day } : {}),
        };
        setPreview(await previewTeacherTasksAction(input));
        setStale(false);
        cue("ready");
      } catch {
        // A list that could not be re-checked is never sent as it was: back to the questions.
        setPreview(null);
        setStale(false);
        setStatus("error");
        cue("error");
      }
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
          cue("warn");
          return;
        }
        setCreated(result.tasks);
        cue("done");
        router.refresh();
      } catch {
        setStatus("error");
        cue("error");
      }
    });
  };

  const openSendList = () => {
    setSendFailed(false);
    import("./send-queue").then(({ SendQueue }) => setSendList({ C: SendQueue }), () => setSendFailed(true));
  };

  const changeOwner = (key: string, teacherId: string) => {
    const common = key.startsWith("common:");
    const nextOverrides = common ? overrides : { ...overrides, [key]: teacherId };
    if (common) setTeacher(teacherId);
    else setOverrides(nextOverrides);
    setChanging(new Set());
    setStale(true);
    cue("select");
    requestPreview(common ? { teacher: teacherId } : { overrides: nextOverrides });
  };

  const toggle = (set: ReadonlySet<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const ownerName = (id: string) => context.owners.find((o) => o.id === id)?.name ?? word(ms.taskUnavailable);
  const statusLine = status ? <p role="status" style={{ margin: 0, padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 14 }}>{word(status === "existing" ? ms.taskExistingOther : ms.taskFailed)}</p> : null;
  const scopeLink = scopeTask ? (
    <Link href={`/inbox?view=collect&task=${scopeTask}`} style={{ display: "block", padding: "12px 14px", borderRadius: 14, border: "1.5px solid var(--acc)", color: "var(--fg)", fontSize: 14 }}>{word(ms.taskScopeChanged)}</Link>
  ) : null;

  /* ------------------------------------------------------ given: send */
  if (created) {
    const teachers = new Set(created.map((t) => t.teacherId)).size;
    const Queue = SendList?.C;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 16 }}>
        <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "12px 8px 4px", textAlign: "center", animation: "xPopIn .5s var(--ease) both" }}>
          <SuccessTick size={68} />
          <strong style={{ fontSize: 19 }}>{say(CW.given(teachers))}</strong>
          <span style={{ fontSize: 14, color: "var(--mut)", maxWidth: 420, lineHeight: 1.45 }}>{say(CW.givenSub)}</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
          {created.map((t) => (
            <li key={t.id}><Pill tone={t.reused ? "mut" : "ok"} icon={t.reused ? undefined : "check"}>{`${ownerName(t.teacherId)}${t.reused ? ` · ${say(CW.hadIt)}` : ""}`}</Pill></li>
          ))}
        </ul>
        {Queue ? (
          <Queue kind="initial" ids={created.map((t) => t.id)} language={language} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn variant="pri" icon="send" big full onClick={openSendList} style={{ background: "#1FA855" }}>{say(CW.sendNow)}</Btn>
            {sendFailed ? <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--bad)" }}>{say(CW.loadFailed)}</p> : null}
            <Btn variant="ghost" full onClick={close}>{say(CW.later)}</Btn>
          </div>
        )}
        {Queue ? <Btn variant="sec" big full onClick={close}>{say(CW.close)}</Btn> : null}
      </div>
    );
  }

  /* --------------------------------------------- preview: who gets it */
  if (preview) {
    const teachersInPreview = new Set(preview.groups.map((g) => overrides[g.key] ?? g.teacherId)).size;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 16 }}>
        {scopeLink}
        {statusLine}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong style={{ fontSize: 17, overflowWrap: "anywhere" }}>{title}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{[preview.fields.join(", ").toLowerCase() === title.toLowerCase() ? null : preview.fields.join(" · ") || null, preview.dueDate ? say(CW.due(lead(dayLabel(preview.dueDate), language))) : say(CW.dueNone)].filter(Boolean).join(" · ")}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{say(CW.whoGets)}</h3>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{say(CW.whoGetsSub)}</span>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {preview.groups.map((g, i) => {
            const owner = overrides[g.key] ?? g.teacherId;
            // Only teachers the server will accept for this group are offered (a class's own teacher, say).
            const scope: TaskScope | undefined = g.scope;
            const choices = scope ? context.owners.filter((o) => ownsScope(o, scope)) : context.owners;
            return (
              <li key={g.key} style={{ ...box, gap: 10, animation: `xIn .3s var(--ease) ${Math.min(i * 50, 300)}ms both` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Avatar text={initials(ownerName(owner))} seed={owner} size={40} />
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{ownerName(owner)}</strong>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{`${g.label} · ${say(CW.childrenOf(g.studentIds.length))}`}</span>
                  </div>
                  {changing.has(g.key) || choices.length < 2 ? null : <Btn variant="ghost" icon="refresh" disabled={pending} onClick={() => setChanging((cur) => toggle(cur, g.key))}>{say(CW.change)}</Btn>}
                </div>
                {changing.has(g.key) ? (
                  <select aria-label={word(ms.taskChoose)} className="inp" value={owner} disabled={pending} onChange={(e) => changeOwner(g.key, e.target.value)}>
                    {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                ) : null}
                <details style={{ fontSize: 13 }}>
                  <summary className="tap" style={{ cursor: "pointer", color: "var(--acc)", fontWeight: 600, minHeight: 32, display: "flex", alignItems: "center" }}>{say(CW.seeChildren(g.studentIds.length))}</summary>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
                    {preview.students.filter((s) => g.studentIds.includes(s.id)).map((s) => <li key={s.id}>{s.name} · {s.classLabel}</li>)}
                  </ul>
                </details>
              </li>
            );
          })}
          {preview.blocked.map((g) => (
            <li key={g.key} style={{ ...box, borderColor: "var(--warn, #d9a400)", background: "var(--warns)", gap: 8 }}>
              <strong style={{ fontSize: 15 }}>{`${g.label} · ${say(CW.childrenOf(g.studentIds.length))}`}</strong>
              <span style={{ fontSize: 13 }}>{g.candidates.length ? say(CW.needsTeacher) : word(kind === "collection" ? ms.taskBlocked : ms.taskAcademicBlocked)}</span>
              {g.candidates.length ? (
                <select aria-label={word(ms.taskChoose)} className="inp" value={overrides[g.key] ?? ""} onChange={(e) => changeOwner(g.key, e.target.value)}>
                  <option value="">{word(ms.taskChoose)}</option>
                  {context.owners.filter((o) => g.candidates.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : null}
            </li>
          ))}
        </ul>
        {preview.unassigned.length > 0 ? <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--bad)" }}>{word(ms.taskUnassigned)} ({preview.unassigned.length})</p> : null}
        {preview.blocked.length > 0 && !stale ? <p role="status" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--warnfg)" }}>{say(CW.pickAllFirst)}</p> : null}
        <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, paddingTop: 8, background: "var(--card)" }}>
          <Btn variant="sec" big icon="chevLeft" disabled={pending} onClick={() => { setPreview(null); setStatus(null); setScopeTask(null); setChanging(new Set()); }}>{say(CW.back)}</Btn>
          <Btn variant="pri" big full disabled={pending || stale || !preview.previewId || !!scopeTask} onClick={create}>{pending ? say(stale ? CW.checking : CW.giving) : say(CW.give(teachersInPreview))}</Btn>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------- the four questions */
  const kinds: { kind: TaskKind; icon: IconName; label: Pair }[] = [
    { kind: "collection", icon: "clipboard", label: CW.kindDetails },
    { kind: "marks", icon: "award", label: CW.kindMarks },
    { kind: "attendance", icon: "calCheck", label: CW.kindAttendance },
  ];
  const dueChips: { key: DueChoice; label: Pair }[] = [
    { key: "1", label: CW.dueTomorrow }, { key: "3", label: CW.dueIn3 }, { key: "7", label: CW.dueWeek }, { key: "pick", label: CW.duePick }, { key: "none", label: CW.dueNone },
  ];
  // The questions are numbered as the office sees them: four for details, fewer for marks and attendance.
  const number = { what: 1, which: 2, who: 3, when: kind === "collection" ? 4 : kind === "marks" ? 2 : 3 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 16 }}>
      {scopeLink}
      {statusLine}
      <div role="group" aria-label={say(CW.q1)} style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, padding: 4, borderRadius: 14, background: "var(--s3)" }}>
        {kinds.map((k) => (
          <button key={k.kind} type="button" className="tap" aria-pressed={kind === k.kind ? "true" : "false"} onClick={() => { setKind(k.kind); setPreview(null); }} style={{ minHeight: 44, border: 0, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 14, fontWeight: 700, background: kind === k.kind ? "var(--card)" : "transparent", color: kind === k.kind ? "var(--fg)" : "var(--mut)", boxShadow: kind === k.kind ? "var(--sh)" : "none" }}>
            <Ic n={k.icon} size={16} />
            {say(k.label)}
          </button>
        ))}
      </div>

      {kind === "collection" ? (
        <Question n={number.what} title={say(CW.q1)} sub={say(CW.q1Sub)}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {context.fields.map((f) => {
              const on = fields.includes(f.id);
              const lacking = missing[f.id] ?? 0;
              return (
                <label key={f.id} className="tap" style={{ ...tileBase, ...(on ? tileOn : null) }}>
                  <input type="checkbox" checked={on} onChange={() => setFields((cur) => (cur.includes(f.id) ? cur.filter((id) => id !== f.id) : [...cur, f.id]))} style={check} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "break-word", maxWidth: "100%" }}>{fieldWord(f)}</span>
                    <span className="num" style={{ fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: lacking ? "var(--warns)" : "var(--oks)", color: lacking ? "var(--warnfg)" : "var(--ok)" }}>{say(CW.missingN(lacking))}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Question>
      ) : kind === "marks" ? (
        <Question n={number.what} title={say(CW.paper)}>
          {papers.length === 0 ? <p style={{ margin: 0, fontSize: 14, color: "var(--mut)" }}>{say(CW.noPapers)}</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
              {papers.map((x) => <Choice key={x.id} name="paper" on={paper === x.id} onPick={() => setPaper(x.id)} icon="award" title={word(x.label)} />)}
            </div>
          )}
        </Question>
      ) : (
        <Question n={number.what} title={say(CW.attendanceDay)}>
          <input aria-label={say(CW.attendanceDay)} className="inp" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Question>
      )}

      {kind === "collection" ? (
        <Question n={number.which} title={say(CW.q2)}>
          {only ? (
            <p style={{ margin: 0, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>{only.name} · {only.classLabel}</span>
              <span style={{ display: "block", color: "var(--mut)", marginTop: 2 }}>{lead(fields.length ? p("The details this child is missing are ticked above.", "इस बच्चे की जो जानकारी बाकी है, ऊपर चुनी गई है।") : p("Nothing is missing for this child. Tick what the teacher should check.", "इस बच्चे की कोई जानकारी बाकी नहीं। शिक्षक क्या जाँचें, ऊपर चुनें।"), language)}</span>
            </p>
          ) : picked ? (
            <p style={{ margin: 0, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", fontSize: 15, fontWeight: 600 }}>{say(CW.picked(pool.length))}</p>
          ) : (
            <>
              <Choice name="who" on={scope === "missing"} onPick={() => setScope("missing")} icon="filter" title={say(CW.onlyMissing(missingIds.length))} sub={say(CW.onlyMissingSub)} />
              <Choice name="who" on={scope === "all"} onPick={() => setScope("all")} icon="users" title={say(CW.everyone(pool.length))} sub={say(CW.everyoneSub)} />
              {chosenFields.length > 0 && scope === "missing" && missingIds.length === 0 ? <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ok)" }}>{say(CW.nobodyMissing)}</p> : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>{say(CW.classes)}</span>
                <div className="hs" role="group" aria-label={say(CW.classes)} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" className={`tap chip${classes.size === 0 ? " on" : ""}`} aria-pressed={classes.size === 0 ? "true" : "false"} onClick={() => setClasses(new Set())}>{say(CW.allClasses)}</button>
                  {classOptions.map(([id, label]) => (
                    <button key={id} type="button" className={`tap chip${classes.has(id) ? " on" : ""}`} aria-pressed={classes.has(id) ? "true" : "false"} onClick={() => setClasses((cur) => toggle(cur, id))}>{label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Question>
      ) : kind === "attendance" ? (
        <Question n={number.which} title={say(CW.attendanceClasses)}>
          <div role="group" aria-label={say(CW.attendanceClasses)} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {classOptions.map(([id, label]) => (
              <button key={id} type="button" className={`tap chip${attendanceClasses.has(id) ? " on" : ""}`} aria-pressed={attendanceClasses.has(id) ? "true" : "false"} onClick={() => setAttendanceClasses((cur) => toggle(cur, id))}>{label}</button>
            ))}
          </div>
        </Question>
      ) : null}

      {kind === "collection" ? (
        <Question n={number.who} title={say(CW.q3)}>
          <Choice name="mode" on={mode === "class"} onPick={() => setMode("class")} icon="users" title={say(CW.byClassTeacher)} sub={say(CW.byClassTeacherSub)} />
          <Choice name="mode" on={mode === "common"} onPick={() => setMode("common")} icon="user" title={say(CW.oneTeacher)} sub={say(CW.oneTeacherSub)} />
          {mode === "common" ? (
            <select aria-label={say(CW.pickTeacher)} className="inp" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
              <option value="">{say(CW.pickTeacher)}</option>
              {context.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : null}
          {more || mode === "house" || mode === "route" || mode === "subject" ? (
            <>
              <Choice name="mode" on={mode === "house"} onPick={() => setMode("house")} title={word(ms.taskHouse)} />
              <Choice name="mode" on={mode === "route"} onPick={() => setMode("route")} title={word(ms.taskRoute)} />
              <Choice name="mode" on={mode === "subject"} onPick={() => setMode("subject")} title={word(ms.taskSubject)} />
              {mode === "subject" ? (
                <select aria-label={word(ms.taskSubject)} className="inp" value={subject} onChange={(e) => setSubject(e.target.value)}>
                  <option value="">{word(ms.taskSubject)}</option>
                  {context.subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              ) : null}
            </>
          ) : (
            <button type="button" className="tap" onClick={() => setMore(true)} style={{ alignSelf: "flex-start", minHeight: 40, border: 0, background: "transparent", color: "var(--acc)", fontSize: 14, fontWeight: 600, padding: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {say(CW.moreWays)} <Ic n="chevDown" size={16} />
            </button>
          )}
        </Question>
      ) : null}

      <Question n={number.when} title={say(CW.q4)}>
        <div role="group" aria-label={say(CW.q4)} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {dueChips.map((c) => (
            <button key={c.key} type="button" className={`tap chip${dueChoice === c.key ? " on" : ""}`} aria-pressed={dueChoice === c.key ? "true" : "false"} onClick={() => setDueChoice(c.key)}>
              {say(c.label)}{c.key !== "pick" && c.key !== "none" ? <span style={{ opacity: 0.7, fontWeight: 500 }}>{` · ${say(dayLabel(addDays(today, Number(c.key))))}`}</span> : null}
            </button>
          ))}
        </div>
        {dueChoice === "pick" ? <input aria-label={say(CW.duePick)} className="inp" type="date" min={today} value={pickedDue} onChange={(e) => setPickedDue(e.target.value)} /> : null}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--mut)" }}>
          {say(CW.name)}
          <input className="inp" value={ownTitle ?? autoName} maxLength={120} onChange={(e) => setOwnTitle(e.target.value)} style={{ color: "var(--fg)", fontWeight: 500 }} />
        </label>
      </Question>

      <div style={{ position: "sticky", bottom: 0, display: "flex", flexDirection: "column", gap: 8, margin: "0 -2px", padding: "12px 2px 4px", background: "var(--card)", borderTop: "1px solid var(--bd)", boxShadow: "0 -10px 16px -14px rgba(0,0,0,.25)" }}>
        {kind === "collection" && chosenFields.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)", textAlign: "center" }}>{say(CW.pickSomething)}</span> : null}
        {plan && targets.length > 0 ? (
          <span className="num" aria-live="polite" style={{ fontSize: 14, fontWeight: 700, textAlign: "center" }}>
            {say(CW.summary(targets.length, plan.teachers))}
          </span>
        ) : null}
        {plan && plan.choose > 0 && targets.length > 0 ? <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>{say(CW.summaryChoose(plan.choose))}</span> : null}
        {plan && plan.orphan > 0 && targets.length > 0 ? <span style={{ fontSize: 12, color: "var(--warnfg)", textAlign: "center" }}>{say(CW.summaryNoOwner(plan.orphan))}</span> : null}
        <Btn variant="pri" big full icon={pending ? undefined : "users"} disabled={!ready} onClick={() => requestPreview()}>{pending ? say(CW.checking) : say(CW.seeWho)}</Btn>
        <Btn variant="ghost" full onClick={close}>{word(ms.taskCancel)}</Btn>
      </div>
    </div>
  );
}
