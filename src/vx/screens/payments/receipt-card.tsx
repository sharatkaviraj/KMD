"use client";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { amountInWords, clock, dateLabel, rupees } from "@/vx/format";
import type { DeskReceipt } from "@/modules/payments/vx/types";

import { W } from "./words";

const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };

/**
 * The bilingual fee receipt as the desk shows it right after saving. The
 * printable receipt is the Receipts module's (`/receipts/<no>`); this is the
 * same record, drawn small.
 */
export function ReceiptCard({
  receipt,
  balance,
  frozenAt,
  removed,
}: {
  receipt: DeskReceipt;
  /** The three numbers frozen at posting, when this desk posted it. */
  balance: { pendingToday: number; notDueYet: number; lateFee: number } | null;
  frozenAt: string | null;
  removed: boolean;
}) {
  const { tx } = useVx();
  const back = receipt.createdAt ? receipt.paymentDate < receipt.createdAt.slice(0, 10) : false;
  const both = (pair: { en: string; hi?: string }) => (pair.hi ? `${pair.hi} · ${pair.en}` : pair.en);
  const kv: [string, string][] = [
    [both(W.rStudent), receipt.studentName],
    [both(W.rClass), `${receipt.classLabel} · SR ${receipt.sr}`],
    [both(W.rFather), receipt.father ?? "—"],
    [both(W.rPaidOn), `${dateLabel(receipt.paymentDate)}${!back && receipt.createdAt ? ` · ${clock(receipt.createdAt)}` : ""}`],
  ];
  if (back && receipt.createdAt) kv.push([both(W.rEntered), `${dateLabel(receipt.createdAt)} · ${clock(receipt.createdAt)}`]);
  const mode = MODE_TEXT[receipt.mode] ?? receipt.mode;
  const modeLine = `${tx(W.rMode)}: ${mode}${receipt.reference ? ` · ${receipt.mode === "cheque" ? tx(W.rChequeNo) : tx(W.rRef)} ${receipt.reference}` : ""}`;

  return (
    <article className="pd-receipt rise" aria-label={`${tx(W.feeReceipt)} ${receipt.receiptNumber}`}>
      {removed || receipt.isReversed ? <span className="pd-stamp" aria-hidden="true">{tx(W.removed)}</span> : null}
      <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10, borderBottom: "1px dashed var(--bds)" }}>
        <span className="serif" style={{ width: 40, height: 40, borderRadius: 10, background: "var(--nav)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flex: "none" }}>VP</span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <strong className="serif clip" lang="hi" style={{ fontSize: 15 }}>{W.school.hi}</strong>
          <span className="serif clip" style={{ fontSize: 13, color: "var(--mut)" }}>{W.school.en}</span>
        </span>
      </header>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{both(W.feeReceipt)}</span>
        <strong className="num" style={{ fontSize: 15 }}>{receipt.receiptNumber}</strong>
      </div>
      <div className="kv">
        {kv.map(([k, v]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 11, color: "var(--mut)" }}>{k}</span>
            <span className="clip" style={{ fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 6 }}>
        {receipt.lines.map((l, i) => (
          <div key={`${l.label}-${i}`} className="ln">
            <span>{l.label}</span>
            <span className="num">{rupees(l.amount)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid var(--bd)", paddingTop: 8 }}>
        <strong>{both(W.rTotal)}</strong>
        <strong className="num" style={{ fontSize: 22 }}>{rupees(receipt.total)}</strong>
      </div>
      <em style={{ fontSize: 13, color: "var(--mut)" }}>{amountInWords(receipt.total)}</em>
      {receipt.lateFeeWaived > 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.rLateWaived(rupees(receipt.lateFeeWaived)))}</span> : null}
      {balance ? (
        <div className="pd-after" style={{ fontSize: 13 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{tx(W.rAfterHead(frozenAt ?? ""))}</span>
          <div><span>{tx(W.feesPendingToday)}</span><b className="num">{rupees(balance.pendingToday)}</b></div>
          <div><span>{tx(W.notDueYet)}</span><b className="num">{rupees(balance.notDueYet)}</b></div>
          <div><span>{tx(W.lateFeeSep)}</span><b className="num">{rupees(balance.lateFee)}</b></div>
        </div>
      ) : (
        <div className="pd-after" style={{ fontSize: 13 }}>
          <div><span>{tx(W.rOutstanding)}</span><b className="num">{rupees(receipt.outstandingAfter)}</b></div>
        </div>
      )}
      <footer style={{ borderTop: "1px dashed var(--bds)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)" }}>
        {receipt.notes ? <span>{tx(W.rNote)}: {receipt.notes}</span> : null}
        <span>{modeLine}</span>
        <span>
          {tx(W.rReceivedBy)} {receipt.receivedBy ?? "—"}
          {receipt.createdAt ? ` · ${dateLabel(receipt.createdAt)}, ${clock(receipt.createdAt)}` : ""}
        </span>
        {receipt.mode === "cheque" ? (
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warnfg)", fontWeight: 600 }}>
            <Ic n="info" size={14} /> {both(W.rClearing)}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
