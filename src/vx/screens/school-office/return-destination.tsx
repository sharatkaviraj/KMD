"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareReturnAction } from "@/app/(app)/school-office/returns/actions";
import type { ManualProgress } from "@/modules/government-records/data/readiness";
import type { GovernmentBatch } from "@/modules/government-records/domain/exchange";
import { CONFLICT_REASONS, type BlockedStudent, type Destination, type ReadinessCounts, type ReadinessGrid } from "@/modules/government-records/domain/readiness";
import { useVx } from "@/vx/i18n";
import { dateLabel } from "@/vx/format";
import { Btn, EmptyState, HeatGrid, Pill } from "@/vx/ui/primitives";
import { C } from "./copilot-text";
import { G, R, RETURN_STATE, blockedLine, excludedLine, issueLabel, issueShort, manualProgressLine, readyOf, studentCount, verifiedFormat } from "./return-text";
import { ReadinessBar, ReturnsNav, destinationTitle } from "./returns";
import "./office.css";
import "./returns.css";

export type BatchSummary = Pick<GovernmentBatch, "id" | "state" | "created_at" | "direction"> & { mode: GovernmentBatch["adapter"]["mode"] };

/** Labels made unique, because HeatGrid keys its rows and columns by label. */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => { const n = (seen.get(label) ?? 0) + 1; seen.set(label, n); return n === 1 ? label : `${label} (${n})`; });
}

export function ReturnDestination({ sessionLabel, destination, counts, grid, selected, students, sourceRevision, batches, manual, askHref, canExport, canManage }: {
  sessionLabel: string; destination: Destination; counts: ReadinessCounts | null; grid: ReadinessGrid | null;
  selected: { classId: string | null; issue: string | null } | null; students: BlockedStudent[]; sourceRevision: string;
  batches: BatchSummary[]; manual: ManualProgress | null; askHref: string | null; canExport: boolean; canManage: boolean;
}) {
  const { tx } = useVx(); const router = useRouter();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const command = useRef<string | null>(null);
  const base = `/school-office/returns/d/${destination.key}`;
  const manualMode = destination.mode === "manual_reference";
  const blocked = counts ? counts.needsDetails + counts.conflict : 0;

  async function prepare() {
    if (busy || !counts) return;
    setBusy(true); setFailed(false);
    // Kept across an uncertain failure so a retry is the same command, not a second list.
    command.current ??= crypto.randomUUID();
    try {
      const result = await prepareReturnAction({ portal: destination.portal, module: destination.module, sessionLabel, schoolCode: destination.schoolCode, classIds: [], ...(destination.adapterId ? { adapterId: destination.adapterId } : {}), commandId: command.current, expectedSource: sourceRevision, excludeBlocked: manualMode });
      if (!result.ok) { setFailed(true); return; }
      command.current = null;
      if (manualMode) router.push(`/school-office/returns/${result.id}/copilot`);
      else {
        // The stored file downloads; the batch opens, because recording the portal's outcome happens there.
        const link = document.createElement("a");
        link.href = `/school-office/returns/${result.id}/file`; link.download = ""; document.body.append(link); link.click(); link.remove();
        router.push(`/school-office/returns/${result.id}`);
      }
    } catch { setFailed(true); } finally { setBusy(false); }
  }

  const classLabels = grid ? uniqueLabels(grid.classes.map((c) => c.label)) : [];
  const issueLabels = grid ? uniqueLabels(grid.issues.map((issue) => tx(issueShort(issue)))) : [];
  const classByLabel = new Map(classLabels.map((label, i) => [label, grid!.classes[i].id]));
  const issueByLabel = new Map(issueLabels.map((label, i) => [label, grid!.issues[i]]));
  const selectedClass = grid?.classes.find((c) => c.id === selected?.classId) ?? null;

  const primary = !canExport ? null : manualMode
    ? manual
      ? <><Btn variant="pri" big className="wrap" icon="keyboard" href={`/school-office/returns/${manual.batchId}/copilot`}>{tx(R.continueManual)}</Btn><Btn className="wrap" disabled={busy || !counts?.ready} onClick={prepare}>{busy ? tx(R.working) : tx(R.freshList)}</Btn></>
      : <Btn variant="pri" big className="wrap" icon="keyboard" disabled={busy || !counts?.ready} onClick={prepare}>{busy ? tx(R.working) : tx(R.startManual)}</Btn>
    : <Btn variant="pri" big className="wrap" icon="download" disabled={busy || !counts?.ready || blocked > 0} onClick={prepare}>{busy ? tx(R.working) : tx(R.downloadUpload)}</Btn>;

  return <>
    <ReturnsNav canManage={false} />
    <div className="rb-flow">
      <header className="card rb-head">
        <div className="rb-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            <h1 className="serif">{destinationTitle(tx, destination)}</h1>
            <div className="rb-meta">{sessionLabel}</div>
          </div>
          {canManage ? <Btn icon="settings" href="/school-office/returns/formats">{tx(R.settings)}</Btn> : null}
        </div>
        <div className="rb-row">
          <Pill tone={destination.mode === "verified_upload" ? "ok" : "mut"}>{destination.mode === "verified_upload" ? tx(verifiedFormat(destination.version)) : tx(R.referenceSheet)}</Pill>
          <Pill tone="warn" icon="calendar">{tx(R.deadlineUnverified)}</Pill>
        </div>
        {counts ? <>
          <div className="rb-count"><strong className="num">{tx(readyOf(counts.ready, counts.total))}</strong><span className="rb-meta">{tx(blockedLine(counts.needsDetails, counts.conflict))}</span></div>
          <ReadinessBar counts={counts} height={12} />
          <div className="rb-legend" aria-hidden="true"><span><i style={{ background: "var(--ok)" }} />{tx(G.ready)} {counts.ready}</span><span><i style={{ background: "var(--warn)" }} />{tx(G.blocked)} {counts.needsDetails}</span><span><i style={{ background: "var(--bad)" }} />{tx(R.conflict)} {counts.conflict}</span></div>
        </> : <div className="office-note" role="alert">{tx(R.source)}</div>}
        {manualMode ? <p className="rb-meta" style={{ margin: 0 }}>{tx(G.manualHint)} {tx(C.honesty)}</p> : null}
        {canExport && manual ? <div className="rb-meta"><Pill tone="info" icon="keyboard">{tx(manualProgressLine(manual.entered, manual.total))}</Pill></div> : null}
        {canExport && counts && manualMode && blocked > 0 && counts.ready > 0 ? <div className="rb-meta">{tx(excludedLine(blocked))}</div> : null}
        {canExport && counts && !manualMode && blocked > 0 ? <div className="rb-meta">{tx(R.uploadBlocked)}</div> : null}
        {canExport && counts && counts.ready === 0 ? <div className="rb-meta">{tx(R.nothingReady)}</div> : null}
      </header>

      {/* The primary action: second on a desk, a sticky bar above the tabs on a phone. */}
      {primary ? <div className="card rb-main rb-act rb-sticky">
        <div className="rb-row">{primary}</div>
        {failed ? <div className="office-note" role="alert">{tx(G.checkFailed)}</div> : null}
      </div> : null}

      {grid ? <section className="card rb-section" aria-labelledby="rb-grid-h">
        <h2 id="rb-grid-h" className="serif">{tx(R.whoMissing)}</h2>
        {grid.classes.length ? <>
          <p className="rb-meta" style={{ margin: 0 }}>{tx(R.gridHint)}</p>
          <HeatGrid rows={classLabels} cols={issueLabels} rowLabel={tx(G.class)} caption={tx(R.whoMissing)} format={String}
            cell={(row, col) => grid.counts[classByLabel.get(row)!]?.[issueByLabel.get(col)!] ?? null}
            hrefFor={(row, col) => `${base}?${new URLSearchParams({ class: classByLabel.get(row)!, issue: issueByLabel.get(col)! })}#students`} />
          {askHref ? <div className="rb-row" style={{ alignItems: "flex-start" }}>
            <Btn icon="users" className="wrap" href={askHref}>{tx(R.askTeachers)}</Btn>
            <span className="rb-meta" style={{ flex: "1 1 240px" }}>{tx(R.askHint)}</span>
          </div> : null}
        </> : <EmptyState icon="checkCircle" title={tx(R.allReady)} />}
      </section> : null}

      {selected && grid ? <section id="students" className="card rb-section" aria-live="polite">
        <div className="rb-row" style={{ justifyContent: "space-between" }}>
          <h2 className="serif">{[selectedClass?.label, selected.issue ? tx(issueLabel(selected.issue)) : null].filter(Boolean).join(" · ")}</h2>
          <Btn icon="x" href={base}>{tx(R.close)}</Btn>
        </div>
        <div className="rb-meta">{tx(studentCount(students.length))}</div>
        <div className="rb-students">
          {students.map((student, i) => <Link key={student.studentId} href={`/students/${student.studentId}?tab=info`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{student.studentName}</strong>
              <span className="rb-meta">{[student.classLabel, student.admissionNo].filter(Boolean).join(" · ")}</span>
              <span className="rb-row">{student.reasons.map((reason) => <Pill key={reason} tone={CONFLICT_REASONS.has(reason) ? "bad" : "warn"}>{tx(issueLabel(reason))}</Pill>)}</span>
            </span>
          </Link>)}
        </div>
      </section> : null}

      <section className="rb-section" style={{ padding: 0 }} aria-labelledby="rb-batches-h">
        <h2 id="rb-batches-h" className="serif">{tx(G.batches)}</h2>
        {batches.length ? <div style={{ display: "grid", gap: 10 }}>{batches.map((batch) => <Link key={batch.id} href={`/school-office/returns/${batch.id}`} className="card row" style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, color: "inherit", textDecoration: "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}><strong>{dateLabel(batch.created_at)}</strong><div className="rb-meta">{batch.direction === "import" ? tx(G.import) : batch.mode === "manual_reference" ? tx(R.referenceSheet) : tx(G.verified)}</div></div>
          <Pill tone={batch.state === "accepted" || batch.state === "applied" ? "ok" : batch.state === "rejected" ? "bad" : "mut"}>{tx(RETURN_STATE[batch.state])}</Pill>
        </Link>)}</div> : <div className="rb-meta">{tx(R.noBatchesHere)}</div>}
      </section>
    </div>
  </>;
}
