"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { boardWorkspace } from "@/modules/official-results/data/repo";
import { latestResults, boardCounts, readinessFor, verifiedDeadline, cycleRoster, type OfficialResult, type Readiness } from "@/modules/official-results/domain/board";
import { useVx, Bi } from "@/vx/i18n";
import { Btn, EmptyState, Pill } from "@/vx/ui/primitives";
import { B, AUTHORITY, READINESS, RESULT, APPEARANCE } from "./text";
import { CandidateEditor, CycleEditor, ReadinessEditor, ResultEditor, Field } from "./forms";
import "./board.css";

type Workspace = Awaited<ReturnType<typeof boardWorkspace>>;
export function BoardWorkspace({ workspace, sessionLabel, canManage, mode, unavailable, studentId }: { workspace: Workspace | null; sessionLabel: string; canManage: boolean; mode: "board" | "results"; unavailable: boolean; studentId?: string }) {
 const { tx } = useVx(), router = useRouter(), [search, setSearch] = useState(""), [limit, setLimit] = useState(30);
 const { cycles = [], cycle = null, roster = null, sourceRevision = null, candidates = [], readiness = [], results = [], history = [] } = workspace ?? {};
 const base = mode === "board" ? "/exam-office/board" : "/exam-office/official-results";
 const current = latestResults(results), selected = cycle ? cycleRoster(cycle.config, roster ?? [], candidates, sourceRevision) : [], writable = canManage && roster !== null && sourceRevision !== null;
 const ids = new Set(selected.map(row => row.studentId));
 const verifiedIds = new Set(selected.filter(row => row.identityVerified).map(row => row.studentId)), candidateById = new Map(candidates.map(row => [row.student_id, row]));
 const scopedCandidates = candidates.filter(row => verifiedIds.has(row.student_id));
 const counts = boardCounts(selected.length, scopedCandidates, current), deadline = cycle ? verifiedDeadline(cycle.config) : null;
 const classes = [...new Map((roster ?? []).map(row => [row.classId, { id: row.classId, label: row.classLabel }])).values()];
 const cycleClasses = [...new Map([...classes, ...selected.map(row => ({ id: row.classId, label: row.classLabel }))].map(row => [row.id, row])).values()];
 const checksById = new Map<string, Readiness[]>();
 for (const row of readiness) if (row.cycle_revision === cycle?.revision) checksById.set(row.student_id, [...(checksById.get(row.student_id) ?? []), row]);
 const scoreById = new Map(selected.map(row => [row.studentId, readinessFor(cycle?.config.requirements ?? [], checksById.get(row.studentId) ?? []) === "needs_details" || !candidateById.get(row.studentId)?.verified ? 0 : 1]));
 const filtered = selected.filter(row => (!studentId || row.studentId === studentId) && `${row.studentName} ${row.admissionNo}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => (scoreById.get(a.studentId) ?? 0) - (scoreById.get(b.studentId) ?? 0) || a.studentName.localeCompare(b.studentName));
 function scopedPath(path: string, cycleId?: string, includeStudent = true) { const params = new URLSearchParams(); if (cycleId) params.set("cycle", cycleId); if (studentId && includeStudent) params.set("student", studentId); return `${path}${params.size ? `?${params}` : ""}`; }
 return <div className="board-stack">
  <div className="board-tools"><Btn href={scopedPath("/exam-office/board", cycle?.id)} variant={mode === "board" ? "pri" : "sec"}>{tx(B.board)}</Btn><Btn href={scopedPath("/exam-office/official-results", cycle?.id)} variant={mode === "results" ? "pri" : "sec"}>{tx(B.results)}</Btn></div>
  {studentId ? <div className="board-note board-tools"><span style={{ flex: 1 }}>{tx(B.studentFilter)}</span><Btn href={scopedPath(base, cycle?.id, false)}>{tx(B.clearStudent)}</Btn></div> : null}
  {unavailable ? <div className="board-note" role="alert">{tx(B.unavailable)}</div> : null}
  {!roster ? <div className="board-note" role="alert">{tx(B.sourceUnavailable)}</div> : null}
  {cycles.length ? <Field label={B.label}><select className="inp" value={cycle?.id ?? ""} onChange={event => { setSearch(""); setLimit(30); router.push(scopedPath(base, event.target.value)); }}>{cycles.map(row => <option key={row.id} value={row.id}>{tx(AUTHORITY[row.config.authority])} · {row.config.label} · {row.config.attemptLabel}</option>)}</select></Field> : <div className="card board-card"><EmptyState icon="clipboard" title={tx(B.empty)} body={tx(B.emptyHint)} /></div>}
  {cycle ? <>
   <div className="card board-card board-stack"><div className="board-tools"><h2 className="serif" style={{ margin: 0, flex: 1 }}>{cycle.config.label}</h2><Pill tone="info">{tx(AUTHORITY[cycle.config.authority])} · {cycle.config.attemptLabel}</Pill></div><div className="board-source">{cycle.config.sourceReference}<br />{tx(B.verifiedOn)}: {cycle.config.verifiedOn} · {cycle.config.responsible}</div>{deadline ? <div className="board-note"><strong>{tx(B.deadline)}: {deadline.date}</strong><br />{deadline.sourceReference}<br />{tx(B.verifiedOn)}: {deadline.verifiedOn}</div> : <div className="board-note">{tx(B.unverifiedDeadline)}</div>}
    <div className="board-metrics">{[{ label: B.candidates, value: counts.candidates }, { label: B.registered, value: `${counts.registered} / ${counts.candidates}` }, { label: B.appeared, value: `${counts.appeared} / ${counts.registered}` }, { label: B.unknown, value: counts.appearanceUnknown }, { label: B.available, value: `${counts.available} / ${counts.expectedSubjects}` }, { label: B.pending, value: `${counts.pending} / ${counts.expectedSubjects}` }].map((item, i) => <div className="board-metric" key={i}><strong>{roster ? item.value : "—"}</strong><Bi {...item.label} /></div>)}</div><div className="board-source">{tx(B.countHint)}</div>
    {writable && mode === "board" ? <details><summary className="board-summary">{tx(B.edit)}</summary><CycleEditor key={`${cycle.id}:${cycle.revision}`} sessionLabel={sessionLabel} cycle={cycle} classes={cycleClasses} scopeFrozen={candidates.length > 0} /></details> : null}
   </div>
   <div className="board-note">{tx(mode === "board" ? B.evidenceHint : B.resultHint)}</div>
   <Field label={B.search}><input className="inp" value={search} onChange={event => { setSearch(event.target.value); setLimit(30); }} type="search" /></Field>
   <div style={{ color: "var(--mut)", fontSize: 13 }}>{tx(B.needs)}</div>
   {filtered.slice(0, limit).map(student => {
    const candidate = candidateById.get(student.studentId), checks = checksById.get(student.studentId) ?? [], studentResults = current.filter(row => row.student_id === student.studentId), history = results.filter(row => row.student_id === student.studentId);
    const currentIdentity = (roster ?? []).find(row => row.studentId === student.studentId && row.identityVerified && cycle.config.classIds.includes(row.classId));
    const readinessState = candidate?.verified ? readinessFor(cycle.config.requirements, checks) : "needs_details";
    return <article className="card board-card board-stack" key={student.studentId}>
     <div className="board-tools"><div style={{ flex: 1, minWidth: 0 }}><a href={`/students/${student.studentId}`} style={{ fontWeight: 700 }}>{student.studentName}</a><div style={{ color: "var(--mut)", fontSize: 13 }}>{student.classLabel} · {student.admissionNo}</div></div><Pill tone={!student.identityVerified || readinessState === "conflict" ? "bad" : readinessState === "accepted" ? "ok" : "warn"}>{!student.identityVerified ? tx(B.identity) : tx(READINESS[readinessState])}</Pill><Pill tone={candidate?.verified ? "ok" : "mut"}>{tx(B.registration)}: {candidate?.registration ?? "—"} · {tx(B.roll)}: {candidate?.roll ?? "—"}</Pill></div>
     {mode === "board" ? <>
      <details><summary className="board-summary">{tx(B.mapping)}</summary>{writable && currentIdentity ? <CandidateEditor key={`${candidate?.revision ?? 0}:${cycle.revision}`} cycle={cycle} student={currentIdentity} candidate={candidate} frozen={history.length > 0} /> : candidate ? <div className="board-source">{candidate.subjects.join(" · ")}<br />{candidate.source_reference}</div> : <p>{tx(B.registrationNeeded)}</p>}</details>
      {cycle.config.requirements.length ? <details><summary className="board-summary">{tx(B.requirements)}</summary><div className="board-stack">{cycle.config.requirements.map(requirement => { const evidence = readiness.find(row => row.student_id === student.studentId && row.key === requirement.key); return writable ? <ReadinessEditor key={`${requirement.key}:${evidence?.revision ?? 0}:${cycle.revision}`} cycle={cycle} student={student} requirement={requirement} evidence={evidence} /> : <div key={requirement.key}><strong>{requirement.label}</strong> · {tx(READINESS[evidence?.cycle_revision === cycle.revision ? evidence.status : "missing"])}<div className="board-source">{evidence?.reference}</div></div>; })}</div></details> : <div className="board-note">{tx(B.noRequirements)}</div>}
     </> : <>
      {candidate?.verified ? <div className="board-tools">{candidate.subjects.map(code => { const result = studentResults.find(row => row.subject_code === code); return <Pill key={code} tone={result?.status === "available" ? "ok" : "warn"}>{code}: {result ? `${tx(RESULT[result.status])} · ${result.raw_value ?? result.raw_status}` : tx(RESULT.pending)}</Pill>; })}</div> : <div className="board-note">{tx(B.registrationNeeded)} <a href={scopedPath("/exam-office/board", cycle.id)}>{tx(B.board)}</a></div>}
      {writable && candidate?.verified ? <details><summary className="board-summary">{tx(B.results)}</summary><ResultEditor key={`${candidate.revision}:${cycle.revision}:${studentResults.map(row => row.revision).join(",")}`} cycle={cycle} student={student} candidate={candidate} results={studentResults} /></details> : null}
      <ResultHistory results={history} />
     </>}
    </article>;
   })}
   {filtered.length > limit ? <Btn onClick={() => setLimit(value => value + 30)}>{tx(B.more)}</Btn> : !filtered.length && roster ? <EmptyState icon="clipboard" title={tx(B.noCandidates)} /> : null}
   {mode === "results" && results.some(row => !ids.has(row.student_id) && (!studentId || row.student_id === studentId)) ? <div className="card board-card"><h2 className="sech">{tx(B.history)}</h2>{[...new Set(results.filter(row => !ids.has(row.student_id) && (!studentId || row.student_id === studentId)).map(row => row.student_id))].map(id => <details key={id}><summary className="board-summary">{id}</summary><ResultHistory results={results.filter(row => row.student_id === id)} /></details>)}</div> : null}
   {mode === "board" && history.length ? <div className="card board-card"><details><summary className="board-summary">{tx(B.history)}</summary>{history.filter(event => !studentId || event.kind === "cycle" || (event.receipt && typeof event.receipt === "object" && (event.receipt as Record<string, unknown>).student_id === studentId)).map(event => {
    const receipt = event.receipt && typeof event.receipt === "object" ? event.receipt as Record<string, unknown> : {}, config = receipt.config && typeof receipt.config === "object" ? receipt.config as Record<string, unknown> : {};
    const labels = { cycle: B.configure, candidate: B.mapping, readiness: B.requirements, result: B.results };
    return <div className="board-history" key={event.id}><strong>{tx(labels[event.kind as keyof typeof labels] ?? B.history)} · {String(receipt.revision ?? "")}</strong><div>{event.actor_id} · {event.created_at}</div><div className="board-source">{[receipt.student_id, receipt.registration, receipt.roll, receipt.key, receipt.status, receipt.reference, receipt.source_reference, config.sourceReference].filter(value => typeof value === "string").join(" · ")}</div></div>;
   })}</details></div> : null}
  </> : null}
  {canManage && roster && mode === "board" && !unavailable ? <div className="card board-card"><details open={!cycles.length}><summary className="board-summary">{tx(cycles.length ? B.newCycle : B.configure)}</summary><CycleEditor sessionLabel={sessionLabel} classes={classes} /></details></div> : null}
 </div>;
}
function ResultHistory({ results }: { results: OfficialResult[] }) {
 const { tx } = useVx(), current = new Set(latestResults(results).map(row => row.id));
 return <details><summary className="board-summary">{tx(B.history)} ({results.length})</summary>{!results.length ? <p className="board-source">{tx(B.noHistory)}</p> : [...results].sort((a, b) => b.verified_at.localeCompare(a.verified_at)).map(row => <div key={row.id} className="board-history"><div className="board-tools"><strong>{row.subject_code} · {tx(RESULT[row.status])} · {row.raw_value ?? "—"} · {row.raw_status}</strong><Pill tone={current.has(row.id) ? "info" : "mut"}>{tx(current.has(row.id) ? B.current : B.superseded)} · {row.revision}</Pill></div><div>{tx(B.appearance)}: {tx(APPEARANCE[row.appearance])}</div><div>{tx(B.verifiedBy)}: {row.verified_by} · {row.verified_at}</div><div className="board-source">{row.source_reference}</div>{row.evidence_path ? <a href={`/exam-office/official-results/evidence/${row.id}`} target="_blank" rel="noreferrer">{tx(B.download)}</a> : null}</div>)}</details>;
}
