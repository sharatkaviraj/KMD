"use client";

import { useVx } from "@/vx/i18n";
import { rupees, schoolToday } from "@/vx/format";
import type { DeskReceipt } from "@/modules/payments/vx/types";
import type { Pair } from "@/vx/text";

import { ampm, shortDate, timeAndDay, wordsOf } from "./look";
import { W } from "./words";

const MODE_TEXT: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank transfer", cheque: "Cheque" };

/** The receipt is a bilingual paper: Hindi first, then English, whatever the reader's language. */
const both = (pair: Pair) => (pair.hi ? `${pair.hi} · ${pair.en}` : pair.en);

/** "Installment 2" → "किस्त 2 · Installment 2"; a late-fee line likewise; anything else as written. */
function lineLabel(label: string): string {
  const inst = /^Installment\s+(\d+)(.*)$/i.exec(label.trim());
  if (inst) return `${both(W.rInstallment(inst[1]))}${inst[2]}`;
  if (/^late\s*fee/i.test(label.trim())) return `${W.rLateFee.hi} · ${label.trim()}`;
  if (/^old\s+balance/i.test(label.trim())) return `${W.oldBalance.hi} · ${label.trim()}`;
  return label;
}

/**
 * The bilingual fee receipt as the desk shows it right after saving
 * (PayDesk `rv`). The printable receipt is the Receipts module's
 * (`/receipts/<no>`); this is the same record, drawn small.
 */
export function ReceiptCard({
  receipt,
  balance,
  balanceAt,
  removed,
}: {
  receipt: DeskReceipt;
  /**
   * The student's balance now, from the live ledger, when this desk just read
   * it (B07). Never a snapshot figure: without a live read it is null, and the
   * card shows only what the receipt itself recorded.
   */
  balance: { pendingToday: number; dueToday?: number; notDueYet: number; lateFee: number } | null;
  /** When `balance` was read (ISO). */
  balanceAt: string | null;
  removed: boolean;
}) {
  const { tx } = useVx();
  // The day it was entered, in the school's timezone: slicing the UTC timestamp
  // called an entry made before 5:30 am IST a day earlier than it was.
  const back = receipt.createdAt ? receipt.paymentDate < schoolToday(new Date(receipt.createdAt)) : false;
  const kv: [string, string][] = [
    [both(W.rStudent), receipt.studentName],
    [both(W.rClass), `${receipt.classLabel} · SR ${receipt.sr}`],
    [both(W.rFather), receipt.father ?? "—"],
    [both(W.rPaidOn), `${shortDate(receipt.paymentDate)}${!back && receipt.createdAt ? ` · ${ampm(receipt.createdAt)}` : ""}`],
  ];
  if (back && receipt.createdAt) kv.push([both(W.rEntered), `${shortDate(receipt.createdAt)} · ${ampm(receipt.createdAt)}`]);
  const mode = MODE_TEXT[receipt.mode] ?? receipt.mode;
  const modeLine = `${tx(W.rMode)}: ${mode}${receipt.reference ? ` · ${receipt.mode === "cheque" ? tx(W.rChequeNo) : tx(W.rRef)} ${receipt.reference}` : ""}`;
  const readAt = balanceAt ? timeAndDay(balanceAt) : "";
  // A removed receipt's dues are back on the student; the balance read before the removal is not "now".
  const now = removed || receipt.isReversed ? null : balance;

  return (
    <article className="card pd-rc" aria-label={`${tx(W.feeReceipt)} ${receipt.receiptNumber}`}>
      <header className="pd-f" style={{ gap: 10, paddingBottom: 10, borderBottom: "1.5px dashed var(--bds)" }}>
        <span className="serif pd-av" style={{ borderRadius: 11, background: "#082F49", color: "#F7F6F3", fontSize: 14 }}>VP</span>
        <span className="pd-c">
          <span className="pd-b" lang="hi">{W.school.hi}</span>
          <span className="serif" style={{ fontSize: 13, color: "var(--mut)" }}>{W.school.en}</span>
        </span>
      </header>
      <div className="pd-f pd-j">
        <span className="pd-m" style={{ fontWeight: 700 }}>{both(W.feeReceipt)}</span>
        <span className="num pd-v">{receipt.receiptNumber}</span>
      </div>
      <div className="pd-tiles" style={{ gap: "6px 14px", fontSize: 13 }}>
        {kv.map(([k, v]) => (
          <span key={k} className="pd-c">
            <span style={{ fontSize: 11, color: "var(--mut)" }}>{k}</span>
            <span style={{ fontWeight: 600 }}>{v}</span>
          </span>
        ))}
      </div>
      <div className="pd-c">
        {receipt.lines.map((l, i) => (
          <div key={`${l.label}-${i}`} className="pd-ln">
            <span>{lineLabel(l.label)}</span>
            <span className="num" style={{ fontWeight: 600 }}>{rupees(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="pd-f pd-j">
        <span style={{ fontWeight: 700 }}>{both(W.rTotal)}</span>
        <span className="num" style={{ fontWeight: 700, fontSize: 20 }}>{rupees(receipt.total)}</span>
      </div>
      <span className="pd-m" style={{ fontStyle: "italic" }}>{wordsOf(receipt.total)}</span>
      {receipt.lateFeeWaived > 0 ? <span className="pd-m">{tx(W.rLateWaived(rupees(receipt.lateFeeWaived)))}</span> : null}
      {receipt.concession ? <span className="pd-m">{tx(W.concession)}: {rupees(receipt.concession)}</span> : null}
      <div className="pd-bx">
        {/* What the receipt recorded when it was posted: a fact about the receipt, never relabelled as the balance now. */}
        <div id="pd-at-receipt" className="pd-f pd-j num" style={{ fontSize: 13 }}><span>{tx(W.rAtReceipt)}</span><b>{rupees(receipt.outstandingAfter)}</b></div>
        {now ? (
          <div id="pd-balance-now" className="pd-c" style={{ gap: 2, marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{tx(W.rNowHead(readAt))}</span>
            <div className="pd-f pd-j num" style={{ fontSize: 13 }}><span>{tx(W.feesPendingToday)}</span><b>{rupees(now.pendingToday)}</b></div>
            {now.dueToday ? <div className="pd-f pd-j num" style={{ fontSize: 13 }}><span>{tx(W.dueToday)}</span><b>{rupees(now.dueToday)}</b></div> : null}
            <div className="pd-f pd-j num" style={{ fontSize: 13 }}><span>{tx(W.notDueYet)}</span><b>{rupees(now.notDueYet)}</b></div>
            <div className="pd-f pd-j num" style={{ fontSize: 13 }}><span>{tx(W.lateFeeSep)}</span><b>{rupees(now.lateFee)}</b></div>
          </div>
        ) : null}
      </div>
      {receipt.notes ? <span style={{ fontSize: 12 }}>{tx(W.rNote)}: {receipt.notes}</span> : null}
      <footer className="pd-c pd-m" style={{ gap: 3, paddingTop: 8, borderTop: "1.5px dashed var(--bds)" }}>
        <span>{modeLine}</span>
        <span>
          {tx(W.rReceivedBy)} {receipt.receivedBy ?? "—"}
          {receipt.createdAt ? ` · ${shortDate(receipt.createdAt).replace(/^\S+\s/, "")}, ${ampm(receipt.createdAt)}` : ""}
        </span>
      </footer>
      {receipt.mode === "cheque" ? <span className="pill" style={{ alignSelf: "flex-start", background: "var(--warns)", color: "var(--warnfg)" }}>{both(W.rClearing)}</span> : null}
      {removed || receipt.isReversed ? <span className="pd-stamp" aria-hidden="true">{tx(W.removed)}</span> : null}
    </article>
  );
}
