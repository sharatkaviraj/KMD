"use client";

import "./paydesk.css";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { commitBulkRowsAction, createBulkBatchAction } from "@/app/(app)/payments/actions";
import {
  checkGridRows,
  gridRowFromImport,
  gridToCsv,
  gridTotals,
  indexStudentsBySr,
  lookupSr,
  type GridCheck,
  type GridRow,
} from "@/modules/payments/vx/domain/bulk-grid";
import type { DeskMode } from "@/modules/payments/vx/domain/desk";
import type { BulkBatch, BulkBoot, BulkServerRow } from "@/modules/payments/vx/types";
import { rupees, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Seg, SwitchRow } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, Pill, Progress, SuccessTick } from "@/vx/ui/primitives";

import { W } from "./words";

const CHUNK = 25;
const MODE_PAIR: Record<DeskMode, Pair> = { cash: W.modeCash, upi: W.modeUpi, bank_transfer: W.modeBank, cheque: W.modeCheque };
const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };

type Stage = "edit" | "review" | "saving" | "done";

function blankRow(n: number, today: string): GridRow {
  return { key: `r${n}`, sr: "", amount: "", date: today, mode: "cash", reference: "" };
}

export function BulkEntry({ boot, previewing, collectable }: { boot: BulkBoot; previewing: boolean; collectable: boolean }) {
  const { tx } = useVx();
  const toast = useToast();
  const index = useMemo(() => indexStudentsBySr(boot.students), [boot.students]);
  const [tab, setTab] = useState<"grid" | "upload">("grid");
  const [rows, setRows] = useState<GridRow[]>(() => Array.from({ length: 5 }, (_, i) => blankRow(i, boot.today)));
  const [stage, setStage] = useState<Stage>("edit");
  const [batch, setBatch] = useState<BulkBatch | null>(null);
  const [ackWarn, setAckWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ posted: number; failed: number } | null>(null);
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const seq = useRef(5);

  const canSave = boot.canBulk && !previewing && collectable;
  const checks = checkGridRows(rows, index, { today: boot.today, sessionStart: boot.sessionStart });
  const filled = rows.map((r) => Boolean(r.sr.trim() || r.amount.trim() || r.reference.trim()));
  const liveRows = rows.filter((_, i) => filled[i]);
  const liveChecks = checks.filter((_, i) => filled[i]);
  const totals = gridTotals(liveRows, liveChecks);

  const setRow = (key: string, patch: Partial<GridRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    seq.current += 1;
    const last = rows[rows.length - 1];
    setRows((all) => [...all, { ...blankRow(seq.current, boot.today), date: last?.date ?? boot.today, mode: last?.mode ?? "cash" }]);
  };
  const dropRow = (key: string) => setRows((all) => (all.length > 1 ? all.filter((r) => r.key !== key) : all));

  async function stage1(fd: FormData) {
    setBusy(true);
    fd.set("sessionLabel", boot.sessionLabel);
    const res = await createBulkBatchAction(fd).catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : "Not checked." }));
    setBusy(false);
    if (!res.ok) {
      toast.show({ text: res.message, tone: "bad", ms: 8000 });
      return;
    }
    setBatch(res.batch);
    setAckWarn(false);
    setStage("review");
  }

  function checkGrid() {
    const { csv, included } = gridToCsv(liveRows, liveChecks);
    if (!included.length) {
      toast.show({ text: tx(W.fix), tone: "bad" });
      return;
    }
    const fd = new FormData();
    fd.set("csv", csv);
    void stage1(fd);
  }

  function upload(file: File | null | undefined) {
    if (!file) return;
    setFileName(file.name);
    const fd = new FormData();
    fd.set("file", file);
    void stage1(fd);
  }

  const toPost = (batch?.rows ?? []).filter((r) => !r.receiptNumber && (r.status === "valid" || (ackWarn && r.status === "warning")));

  async function commit() {
    if (!batch || !toPost.length || !canSave) return;
    setStage("saving");
    const ids = toPost.map((r) => r.id);
    const ack = ackWarn ? toPost.filter((r) => r.status === "warning").map((r) => r.id) : [];
    let posted = 0;
    let failed = 0;
    let latest: BulkBatch = batch;
    setProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await commitBulkRowsAction({ batchId: batch.batchId, rowIds: chunk, acknowledgedRowIds: ack.filter((id) => chunk.includes(id)), receivedBy: boot.me }).catch(
        (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : "Not saved." }),
      );
      if (!res.ok) {
        toast.show({ text: res.message, tone: "bad", ms: 8000 });
        failed += chunk.length;
        break;
      }
      posted += res.posted;
      failed += res.failed;
      latest = res.batch;
      setProgress({ done: Math.min(ids.length, i + chunk.length), total: ids.length });
    }
    setBatch(latest);
    setSummary({ posted, failed });
    setStage("done");
    if (posted) toast.show({ text: `${tx(W.doneTitle(posted))} · ${tx(W.doneSub(posted))}` });
  }

  function reset() {
    setRows(Array.from({ length: 5 }, (_, i) => blankRow(i + seq.current, boot.today)));
    seq.current += 5;
    setBatch(null);
    setSummary(null);
    setStage("edit");
    setFileName("");
  }

  function editRows() {
    if (!batch) return;
    setRows(batch.rows.map((r, i) => gridRowFromImport({ admissionNo: r.sr, amount: r.amount, paymentDate: r.paymentDate, paymentMode: r.mode, remarks: r.remarks }, `u${i}-${batch.batchId.slice(0, 6)}`)));
    setTab("grid");
    setStage("edit");
  }

  const crumb = `${tx(W.money)} · ${tx(W.session)} ${boot.sessionLabel} · ${shortDay(boot.today)}`;

  return (
    <VxPage label={tx(W.many)}>
      <TopBar
        crumb={crumb}
        title={tx(W.many)}
        actions={<Btn variant="ghost" icon="chevLeft" href="/payments">{tx(W.backToDesk)}</Btn>}
        mTitle={tx(W.many)}
        mSub={boot.sessionLabel}
        mBack="/payments"
      />
      <main>
        <div className="pad" style={{ padding: "22px 28px 0", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 className="serif" style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{tx(W.many)}</h2>
                <Pill tone="warn">{tx(W.adminOnly)}</Pill>
              </span>
              <span style={{ color: "var(--mut)" }}>{tx(W.bulkSub)}</span>
            </div>
            {stage === "edit" ? (
              <Seg
                label={tx(W.many)}
                value={tab}
                onChange={setTab}
                style={{ minWidth: 300 }}
                options={[
                  { value: "grid", label: tx(W.typeGrid) },
                  { value: "upload", label: tx(W.uploadExcel) },
                ]}
              />
            ) : null}
          </div>
          {previewing ? <Banner tone="info">{tx(W.previewing)}</Banner> : null}
          {!boot.canBulk ? <Banner tone="warn">{tx(W.onlyAdminBulk)}</Banner> : null}
          {!collectable ? <Banner tone="warn">{tx(W.readOnly)}</Banner> : null}

          {stage === "edit" && tab === "grid" ? (
            <Card pad={false} style={{ overflow: "hidden" }}>
              <div className="pd-bk head" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--mut)", borderBottom: "1px solid var(--bd)" }}>
                <span>#</span>
                <span>{tx(W.colSr)}</span>
                <span>{tx(W.colStudent)}</span>
                <span>{tx(W.colAmount)}</span>
                <span>{tx(W.colDate)}</span>
                <span>{tx(W.colMode)}</span>
                <span>{tx(W.colRef)}</span>
                <span style={{ textAlign: "right" }}>{tx(W.colCheck)}</span>
              </div>
              {rows.map((r, i) => {
                const c = filled[i] ? checks[i] : null;
                const who = lookupSr(index, r.sr);
                const msg = c ? checkText(c, tx) : "";
                const cls = c?.status === "err" ? " err" : c?.status === "warn" ? " warn" : "";
                return (
                  <div key={r.key} className={`pd-bkrow${cls}`} style={{ borderTop: i ? undefined : 0 }}>
                    <div className="pd-bk">
                      <span className="a-n num" style={{ color: "var(--mut)", fontSize: 13 }}>{i + 1}</span>
                      <input className="inp num a-sr" aria-label={`${tx(W.colSr)} ${i + 1}`} value={r.sr} onChange={(e) => setRow(r.key, { sr: e.target.value })} placeholder={tx(W.colSr)} />
                      <span className="a-who" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <strong className="clip">{who ? who.name : "—"}</strong>
                        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{who ? `${who.classLabel}${who.father ? ` · ${who.father}` : ""}` : tx(W.nameFills)}</span>
                      </span>
                      <input className="inp num a-amt" inputMode="numeric" aria-label={`${tx(W.colAmount)} ${i + 1}`} value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} placeholder="0" />
                      <input className="inp a-date" type="date" aria-label={`${tx(W.colDate)} ${i + 1}`} value={r.date} min={boot.sessionStart} max={boot.today} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                      <select className="inp a-mode" aria-label={`${tx(W.colMode)} ${i + 1}`} value={r.mode} onChange={(e) => setRow(r.key, { mode: e.target.value as DeskMode })}>
                        {boot.modes.map((m) => (
                          <option key={m} value={m}>{tx(MODE_PAIR[m])}</option>
                        ))}
                      </select>
                      <input className="inp a-ref" aria-label={`${tx(W.colRef)} ${i + 1}`} value={r.reference} onChange={(e) => setRow(r.key, { reference: e.target.value })} placeholder={tx(W.refPh)} />
                      <span className="a-c" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        {c ? (
                          <Ic n={c.status === "ok" ? "checkCircle" : c.status === "warn" ? "alert" : "x"} size={20} style={{ color: c.status === "ok" ? "var(--acc)" : c.status === "warn" ? "var(--warn)" : "var(--bad)" }} />
                        ) : null}
                        <button type="button" className="tap icon-btn" style={{ width: 32, height: 32 }} aria-label={`${tx(W.removeRow)} ${i + 1}`} onClick={() => dropRow(r.key)}>
                          <Ic n="trash" size={16} />
                        </button>
                      </span>
                    </div>
                    {msg ? <div className="pd-bkmsg" role="alert" style={{ color: c?.status === "err" ? "var(--bad)" : "var(--warnfg)" }}>{msg}</div> : null}
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--bd)", flexWrap: "wrap" }}>
                <Btn variant="ghost" icon="plus" onClick={addRow}>{tx(W.addRow)}</Btn>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Pill tone="ok">{tx(W.nReady(totals.ready))}</Pill>
                  {totals.toCheck ? <Pill tone="warn">{tx(W.nToCheck(totals.toCheck))}</Pill> : null}
                  {totals.problems ? <Pill tone="bad">{tx(W.nProblems(totals.problems))}</Pill> : null}
                </span>
              </div>
            </Card>
          ) : null}

          {stage === "edit" && tab === "upload" ? (
            <label
              className={`pd-drop${over ? " over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                upload(e.dataTransfer.files?.[0]);
              }}
            >
              <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n="upload" size={26} />
              </span>
              <strong>{busy ? tx(W.reading) : tx(W.dropFile)}</strong>
              <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(W.fileCols)}</span>
              {fileName ? <span className="num" style={{ fontSize: 13 }}>{fileName}</span> : null}
              <span style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <span className="tap btn pri" aria-disabled={!canSave || busy}>
                  <Ic n="file" /> {tx(W.chooseFile)}
                </span>
                <Link className="tap btn sec" href="/fees/payments/bulk/template" prefetch={false}>
                  <Ic n="download" /> {tx(W.template)}
                </Link>
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr"
                disabled={!canSave || busy}
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
          ) : null}

          {stage === "review" && batch ? (
            <ServerRows rows={batch.rows} tx={tx} />
          ) : null}

          {stage === "saving" ? (
            <Card style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-live="polite">
              <strong>{tx(W.saveProgress(progress.done, progress.total))}</strong>
              <Progress value={progress.done} max={Math.max(1, progress.total)} />
            </Card>
          ) : null}

          {stage === "done" && batch && summary ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Card className="rise" style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <SuccessTick size={64} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <strong className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{tx(W.doneTitle(summary.posted))}</strong>
                  <span style={{ color: "var(--mut)" }}>{tx(W.doneSub(summary.posted))}</span>
                </span>
              </Card>
              {summary.failed ? <Banner tone="bad">{tx(W.bulkFailed(summary.failed))}</Banner> : null}
              <ServerRows rows={batch.rows.filter((r) => r.receiptNumber || r.postError)} tx={tx} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Btn variant="pri" icon="receipt" href="/receipts">{tx(W.openReceipts)}</Btn>
                <Btn variant="sec" icon="plus" onClick={reset}>{tx(W.enterMore)}</Btn>
                <Btn variant="ghost" icon="chevLeft" href="/payments">{tx(W.backToDesk)}</Btn>
              </div>
            </div>
          ) : null}
        </div>

        {stage === "edit" && tab === "grid" ? (
          <div className="pad" style={{ padding: "16px 28px 0" }}>
            <div className="pd-pbar glass" style={{ margin: 0 }}>
              <span style={{ display: "flex", flexDirection: "column", flex: "1 1 auto" }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {tx(W.nPayments(totals.saving))}{totals.problems ? ` · ${tx(W.nSkipped(totals.problems))}` : ""}
                </span>
                <strong className="num" style={{ fontSize: 22 }}>{rupees(totals.amount)}</strong>
              </span>
              <span className="hide-m" style={{ fontSize: 13, color: "var(--mut)" }}>{canSave ? tx(W.serverChecked) : tx(W.onlyAdminBulk)}</span>
              <Btn variant="pri" big icon="shield" disabled={!canSave || busy || totals.saving === 0} onClick={checkGrid}>
                {busy ? tx(W.reading) : tx(W.checkRows(totals.saving))}
              </Btn>
            </div>
          </div>
        ) : null}

        {stage === "review" && batch ? (
          <div className="pad" style={{ padding: "16px 28px 0" }}>
            <div className="pd-pbar glass" style={{ margin: 0 }}>
              <span style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", gap: 4 }}>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.nPayments(toPost.length))}</span>
                <strong className="num" style={{ fontSize: 22 }}>{rupees(toPost.reduce((s, r) => s + Number(r.amount ?? 0), 0))}</strong>
              </span>
              {batch.rows.some((r) => r.status === "warning") ? (
                <span style={{ minWidth: 240 }}>
                  <SwitchRow title={tx(W.serverWarnAck)} on={ackWarn} onChange={setAckWarn} />
                </span>
              ) : null}
              <Btn variant="sec" icon="edit" onClick={editRows}>{tx(W.editRows)}</Btn>
              <Btn variant="pri" big icon="check" disabled={!canSave || toPost.length === 0} onClick={commit}>
                {tx(W.saveN(toPost.length))}
              </Btn>
            </div>
          </div>
        ) : null}
        <div style={{ height: 28 }} />
      </main>
    </VxPage>
  );
}

function checkText(c: GridCheck, tx: (p: Pair | string) => string): string {
  if (c.status === "ok") return "";
  if (c.status === "warn") return c.reason === "repeat" ? tx(W.gWarnRepeat(c.row)) : tx(W.gWarnCheque);
  switch (c.reason) {
    case "sr-missing":
      return tx(W.gErrSrMissing);
    case "sr-unknown":
      return tx(W.gErrSrUnknown(c.sr));
    case "sr-ambiguous":
      return tx(W.gErrSrAmbiguous(c.sr));
    case "amount":
      return tx(W.gErrAmount);
    case "date":
      return tx(W.gErrDate);
  }
}

function ServerRows({ rows, tx }: { rows: BulkServerRow[]; tx: (p: Pair | string) => string }) {
  return (
    <Card pad={false} style={{ overflow: "hidden" }}>
      {rows.map((r, i) => {
        const tone = r.receiptNumber ? "ok" : r.postError || r.status === "error" ? "bad" : r.status === "warning" ? "warn" : "ok";
        return (
          <div key={r.id} className={`pd-bkrow${tone === "bad" ? " err" : tone === "warn" && !r.receiptNumber ? " warn" : ""}`} style={{ borderTop: i ? undefined : 0, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center" }}>
            <span className="num" style={{ color: "var(--mut)", fontSize: 13, width: 28 }}>{r.rowNumber}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <strong className="clip">{r.studentName ?? "—"} <span style={{ fontWeight: 500, color: "var(--mut)" }}>· SR {r.sr ?? "—"}</span></strong>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {r.paymentDate ?? "—"} · {r.mode ? (MODE_TEXT[r.mode] ?? r.mode) : "—"}{r.remarks ? ` · ${r.remarks}` : ""}
              </span>
              {r.postError || r.messages.length ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: tone === "bad" ? "var(--bad)" : "var(--warnfg)" }}>{r.postError ?? r.messages.join(" · ")}</span>
              ) : null}
            </span>
            {r.receiptNumber ? <Pill tone="ok" icon="check">{r.receiptNumber}</Pill> : <Pill tone={tone}>{tx(tone === "bad" ? W.gProblem : tone === "warn" ? W.gCheck : W.gReady)}</Pill>}
            <b className="num">{rupees(r.amount ?? 0)}</b>
          </div>
        );
      })}
    </Card>
  );
}
