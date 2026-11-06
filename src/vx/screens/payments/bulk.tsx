"use client";

import "./paydesk.css";

import Link from "@/vx/ui/link";
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
import { rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Seg, SwitchRow } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Pill } from "@/vx/ui/primitives";

import { sessionDash, shortDate } from "./look";
import { W } from "./words";

const CHUNK = 25;
const MODE_PAIR: Record<DeskMode, Pair> = { cash: W.modeCash, upi: W.modeUpi, bank_transfer: W.modeBank, cheque: W.modeCheque };
const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque", online: "Online (Razorpay)" };
const LOOK = {
  ok: { icon: "checkCircle" as const, fg: "var(--ok)", bg: "transparent", pair: W.gReady },
  warn: { icon: "alert" as const, fg: "var(--warn)", bg: "var(--warns)", pair: W.gCheck },
  err: { icon: "x" as const, fg: "var(--bad)", bg: "var(--bads)", pair: W.gProblem },
};

type Stage = "edit" | "review" | "saving" | "done";

function blankRow(n: number, today: string): GridRow {
  return { key: `r${n}`, sr: "", amount: "", date: today, mode: "cash", reference: "" };
}

/**
 * Enter many payments (PayDesk `bulk`): a grid for old paper receipts, or an
 * Excel upload. Rows are checked here as they are typed, then on the server,
 * and only then saved — each row its own receipt.
 */
export function BulkEntry({ boot, previewing, collectable, initialRows }: { boot: BulkBoot; previewing: boolean; collectable: boolean; initialRows?: GridRow[] }) {
  const { tx } = useVx();
  const toast = useToast();
  const index = useMemo(() => indexStudentsBySr(boot.students), [boot.students]);
  const [tab, setTab] = useState<"grid" | "upload">("grid");
  const [rows, setRows] = useState<GridRow[]>(() => initialRows ?? Array.from({ length: 5 }, (_, i) => blankRow(i, boot.today)));
  const [stage, setStage] = useState<Stage>("edit");
  const [batch, setBatch] = useState<BulkBatch | null>(null);
  const [ackWarn, setAckWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<{ posted: number; failed: number } | null>(null);
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const seq = useRef(initialRows?.length ?? 5);

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

  const crumb = `${tx(W.money)} · ${tx(W.session)} ${sessionDash(boot.sessionLabel)} · ${shortDate(boot.today)}`;
  const today = boot.todayCollection;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <VxPage label={tx(W.many)}>
      <TopBar
        crumb={crumb}
        title={tx(W.many)}
        actions={
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {today ? (
              <Link href="/receipts" className="tap pd-today">
                <span className="pd-dot" />
                <span>{tx(W.todayPill)}: <b className="num">{rupees(today.amount)}</b> · {tx(W.receiptsN(today.count))}</span>
                <Ic n="chevRight" size={16} />
              </Link>
            ) : null}
            <Btn variant="ghost" icon="chevLeft" href="/payments">{tx(W.backToDesk)}</Btn>
          </span>
        }
        mTitle={tx(W.manyShort)}
        mSub={tx(W.manyMobileSub(boot.canBulk))}
        mBack="/payments"
      />
      <main>
        <div className="pad pd-c" style={{ padding: "22px 28px 0", gap: 14 }}>
          <div className="pd-f pd-j" style={{ gap: 12, flexWrap: "wrap" }}>
            <span className="pd-c">
              <span className="pd-f">
                <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{tx(W.many)}</span>
                {!boot.canBulk ? <span className="pill" style={{ height: 24, padding: "0 10px", background: "var(--warns)", color: "var(--warnfg)" }}>{tx(W.adminOnly)}</span> : null}
              </span>
              <span className="pd-m" style={{ fontSize: 13 }}>{tx(W.bulkSub)}</span>
            </span>
            {stage === "edit" ? (
              <div className="mfull" style={{ width: 300 }}>
                <Seg
                  label={tx(W.howToEnter)}
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "grid", label: tx(W.typeGrid) },
                    { value: "upload", label: tx(W.uploadExcel) },
                  ]}
                />
              </div>
            ) : null}
          </div>
          {previewing ? <Banner tone="info">{tx(W.previewing)}</Banner> : null}
          {!collectable ? <Banner tone="warn">{tx(W.readOnly)}</Banner> : null}

          {stage === "edit" && tab === "grid" ? (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="only-d pd-bk pd-bkhead">
                <span className="sech">#</span>
                <span className="sech">{tx(W.colSr)}</span>
                <span className="sech">{tx(W.colStudent)}</span>
                <span className="sech">{tx(W.colAmount)}</span>
                <span className="sech">{tx(W.colDate)}</span>
                <span className="sech">{tx(W.colMode)}</span>
                <span className="sech">{tx(W.colRef)}</span>
                <span className="sech">{tx(W.colCheck)}</span>
              </div>
              {rows.map((r, i) => {
                const c = filled[i] ? checks[i] : null;
                const who = lookupSr(index, r.sr);
                const msg = c ? checkText(c, tx) : "";
                const look = c ? LOOK[c.status] : null;
                return (
                  <div key={r.key} className="pd-bk pd-bkrow" style={{ background: look?.bg, animationDelay: `${Math.min(i, 12) * 32}ms` }}>
                    <span className="num pd-m hide-m">{i + 1}</span>
                    <label className="field">
                      <span className="only-m">{tx(W.colSr)}</span>
                      <input className="inp num" inputMode="numeric" aria-label={`${tx(W.colSr)} ${i + 1}`} value={r.sr} onChange={(e) => setRow(r.key, { sr: e.target.value })} />
                    </label>
                    <span className="pd-c pd-w2">
                      <span className="pd-b pd-e">{who ? who.name : "—"}</span>
                      <span className="pd-m pd-e">{who ? `${who.classLabel}${who.father ? ` · ${who.father}` : ""}` : tx(W.nameFills)}</span>
                    </span>
                    <label className="field">
                      <span className="only-m">{tx(W.colAmount)}</span>
                      <input className="inp num" inputMode="numeric" aria-label={`${tx(W.colAmount)} ${i + 1}`} value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="only-m">{tx(W.colDate)}</span>
                      <input className="inp" type="date" aria-label={`${tx(W.colDate)} ${i + 1}`} value={r.date} min={boot.sessionStart} max={boot.today} onChange={(e) => setRow(r.key, { date: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="only-m">{tx(W.colMode)}</span>
                      <select className="inp" aria-label={`${tx(W.colMode)} ${i + 1}`} value={r.mode} onChange={(e) => setRow(r.key, { mode: e.target.value as DeskMode })}>
                        {boot.modes.map((m) => (
                          <option key={m} value={m}>{tx(MODE_PAIR[m])}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="only-m">{tx(W.colRef)}</span>
                      <input className="inp num" aria-label={`${tx(W.colRef)} ${i + 1}`} value={r.reference} onChange={(e) => setRow(r.key, { reference: e.target.value })} placeholder={tx(W.refPh)} />
                    </label>
                    <span className="pd-f" style={{ justifyContent: "flex-end", gap: 2 }}>
                      {look ? <span role="img" aria-label={tx(look.pair)} style={{ display: "inline-flex", color: look.fg }}><Ic n={look.icon} size={22} /></span> : null}
                      <button type="button" className="tap btn ghost" style={{ width: 34, height: 34, padding: 0 }} aria-label={`${tx(W.removeRow)} ${i + 1}`} onClick={() => dropRow(r.key)}>
                        <Ic n="trash" size={16} />
                      </button>
                    </span>
                    {msg && look ? <span className="pd-bkmsg" role="alert" style={{ color: look.fg }}>{msg}</span> : null}
                  </div>
                );
              })}
              <div className="pd-f pd-j" style={{ flexWrap: "wrap", padding: "10px 14px", borderTop: "1px solid var(--bd)" }}>
                <Btn variant="ghost" icon="plus" onClick={addRow}>{tx(W.addRow)}</Btn>
                <span className="pd-f" style={{ gap: 6, flexWrap: "wrap" }}>
                  {totals.ready ? <Pill tone="ok">{tx(W.nReady(totals.ready))}</Pill> : null}
                  {totals.toCheck ? <Pill tone="warn">{tx(W.nToCheck(totals.toCheck))}</Pill> : null}
                  {totals.problems ? <Pill tone="bad">{tx(W.nProblems(totals.problems))}</Pill> : null}
                </span>
              </div>
            </div>
          ) : null}

          {stage === "edit" && tab === "upload" ? (
            <label
              className="card pd-cd fadein"
              style={{ alignItems: "center", textAlign: "center", padding: "32px 22px", border: `2px dashed ${over ? "var(--acc)" : "var(--bds)"}`, boxShadow: "none", background: over ? "var(--accs)" : undefined }}
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
              <span className="pd-av" style={{ width: 60, height: 60, borderRadius: 20, background: "var(--accs)", color: "var(--accfg)" }}>
                <Ic n="upload" size={28} />
              </span>
              <span className="pd-v" style={{ fontSize: 17 }}>{busy ? tx(W.reading) : tx(W.dropFile)}</span>
              <span className="pd-m" style={{ maxWidth: 460 }}>{tx(W.fileCols)}</span>
              {fileName ? <span className="num" style={{ fontSize: 13 }}>{fileName}</span> : null}
              <span className="tap btn pri" aria-disabled={!canSave || busy}>
                <Ic n="upload" /> {tx(W.chooseFile)}
              </span>
              <span className="pd-f" style={{ flexWrap: "wrap", justifyContent: "center" }}>
                <Link className="tap chip" href="/fees/payments/bulk/template" prefetch={false}>
                  <Ic n="download" size={16} /> {tx(W.template)}
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

          {stage === "review" && batch ? <ServerRows rows={batch.rows} tx={tx} /> : null}

          {stage === "saving" ? (
            <div className="card pd-cd fadein" aria-live="polite">
              <div className="pd-f pd-j">
                <span className="pd-v">{tx(W.saveProgress(Math.min(progress.done + 1, progress.total), progress.total))}</span>
                <span className="num pd-m">{pct}%</span>
              </div>
              <div className="pd-tr" style={{ height: 10 }}><span style={{ width: `${pct}%`, background: "var(--acc)" }} /></div>
            </div>
          ) : null}

          {stage === "done" && batch && summary ? (
            <div className="card pd-cd fadein" style={{ alignItems: "center", textAlign: "center", padding: "26px 22px" }}>
              <svg width="72" height="72" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
                <circle cx="48" cy="48" r="44" className="pd-tk0" />
                <circle cx="48" cy="48" r="44" className="pd-tk1" />
                <path d="M30 49l12 12 24-26" className="pd-tk2" />
              </svg>
              <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{tx(W.doneTitle(summary.posted))}</span>
              <span className="pd-m" style={{ fontSize: 13 }}>{tx(W.doneSub(summary.posted))}</span>
              {summary.failed ? <Banner tone="bad">{tx(W.bulkFailed(summary.failed))}</Banner> : null}
              <div className="pd-c" style={{ width: "100%", maxWidth: 640, textAlign: "left" }}>
                {batch.rows.filter((r) => r.receiptNumber || r.postError).map((r) => (
                  <div key={r.id} className="pd-f" style={{ gap: 10, padding: "10px 0", borderTop: "1px solid var(--bd)" }}>
                    <Ic n={r.receiptNumber ? "check" : "x"} style={{ color: r.receiptNumber ? "var(--ok)" : "var(--bad)", flex: "none" }} />
                    <span className="num pd-b">{r.receiptNumber ?? "—"}</span>
                    <span className="pd-e" style={{ flex: 1 }}>{r.studentName ?? "—"}{r.postError ? ` · ${r.postError}` : ""}</span>
                    <span className="pd-m hide-m">{r.mode ? (MODE_TEXT[r.mode] ?? r.mode) : ""}</span>
                    <b className="num">{rupees(r.amount ?? 0)}</b>
                  </div>
                ))}
              </div>
              <div className="pd-f" style={{ flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
                <Btn variant="pri" href="/receipts">{tx(W.openReceipts)}</Btn>
                <Btn variant="sec" onClick={reset}>{tx(W.enterMore)}</Btn>
                <Btn variant="ghost" href="/payments">{tx(W.backToDesk)}</Btn>
              </div>
            </div>
          ) : null}

          {stage === "edit" && tab === "grid" ? (
            <div className="glass pd-pbar full">
              <span className="pd-c" style={{ flex: 1 }}>
                <span className="pd-m" style={{ fontWeight: 600 }}>
                  {tx(W.nPayments(totals.saving))}{totals.problems ? ` · ${tx(W.nSkipped(totals.problems))}` : ""}
                </span>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{rupees(totals.amount)}</span>
              </span>
              <span className="pd-m hide-m" style={{ maxWidth: 300, textAlign: "right" }}>{canSave ? tx(W.serverChecked) : tx(W.onlyAdminBulk)}</span>
              <button type="button" className="tap btn pri pd-big" disabled={!canSave || busy || totals.saving === 0} onClick={checkGrid}>
                <Ic n="shield" size={20} /> {busy ? tx(W.reading) : tx(W.checkRows(totals.saving))}
              </button>
            </div>
          ) : null}

          {stage === "review" && batch ? (
            <div className="glass pd-pbar full">
              <span className="pd-c" style={{ flex: 1, gap: 4 }}>
                <span className="pd-m" style={{ fontWeight: 600 }}>{tx(W.nPayments(toPost.length))}</span>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{rupees(toPost.reduce((s, r) => s + Number(r.amount ?? 0), 0))}</span>
              </span>
              {batch.rows.some((r) => r.status === "warning") ? (
                <span style={{ minWidth: 240 }}>
                  <SwitchRow title={tx(W.serverWarnAck)} on={ackWarn} onChange={setAckWarn} />
                </span>
              ) : null}
              <Btn variant="sec" icon="edit" onClick={editRows}>{tx(W.editRows)}</Btn>
              <button type="button" className="tap btn pri pd-big" disabled={!canSave || toPost.length === 0} onClick={commit}>
                <Ic n="upload" size={20} /> {tx(W.saveN(toPost.length))}
              </button>
            </div>
          ) : null}
        </div>
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
    <div className="card" style={{ overflow: "hidden" }}>
      {rows.map((r, i) => {
        const tone = r.receiptNumber ? "ok" : r.postError || r.status === "error" ? "err" : r.status === "warning" ? "warn" : "ok";
        const look = LOOK[tone];
        return (
          <div key={r.id} className="pd-f" style={{ gap: 12, padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0, background: look.bg }}>
            <span className="num pd-m" style={{ width: 26 }}>{r.rowNumber}</span>
            <span className="pd-c" style={{ flex: 1 }}>
              <span className="pd-b pd-e">{r.studentName ?? "—"} <span className="pd-m">· SR {r.sr ?? "—"}</span></span>
              <span className="pd-m">
                {r.paymentDate ?? "—"} · {r.mode ? (MODE_TEXT[r.mode] ?? r.mode) : "—"}{r.remarks ? ` · ${r.remarks}` : ""}
              </span>
              {r.postError || r.messages.length ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: look.fg }}>{r.postError ?? r.messages.join(" · ")}</span>
              ) : null}
            </span>
            {r.receiptNumber ? <Pill tone="ok" icon="check">{r.receiptNumber}</Pill> : <Pill tone={tone === "err" ? "bad" : tone}>{tx(look.pair)}</Pill>}
            <b className="num">{rupees(r.amount ?? 0)}</b>
          </div>
        );
      })}
    </div>
  );
}
