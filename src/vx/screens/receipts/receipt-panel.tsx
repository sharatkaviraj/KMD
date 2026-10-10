"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { reverseReceiptAction } from "@/app/(app)/receipts/actions";
import { deskModeOf, REVERSAL_REASONS, type ReversalReason } from "@/modules/receipts/vx/domain/day-close";
import { amountInWords, clock, dateLabel, rupees, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { Field, RadioCard, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Card, Pill, SecHead, WhatsAppPreview, type Tone } from "@/vx/ui/primitives";

import { deskHref } from "./href";
import type { DeskProps, HistoryEvent, SelectedReceipt } from "./types";
import { MODE_WORD, REASON_WORD, SHARE_FOOTER, shareLines, W } from "./words";

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "3px 0" }}>
      <span style={{ color: "var(--mut)" }}>{k}</span>
      <span style={{ textAlign: "right", fontWeight: 600, minWidth: 0 }}>{v}</span>
    </div>
  );
}

const HISTORY_ICON: Record<HistoryEvent["kind"], IconName> = { posted: "receipt", reversed: "undo", sent: "send", read: "ticks" };

export function ReceiptPanel(props: DeskProps & { receipt: SelectedReceipt }) {
  const { receipt: r, perms, anchor, today, span } = props;
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<"reverse" | "send" | null>(props.sheet);
  const [reason, setReason] = useState<ReversalReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const base = { anchor, today, span };
  const pdf = `/fees/receipts/${r.id}/pdf`;
  const remaining = Math.max(0, r.totalAmount - r.reversedAmount);

  const status: { tone: Tone; text: string } = r.isReversed
    ? { tone: "bad", text: tx(W.reversed) }
    : r.share.status === "read"
      ? { tone: "ok", text: tx(W.sentRead) }
      : r.share.status === "delivered"
        ? { tone: "ok", text: tx(W.delivered) }
        : r.share.status === "sent"
          ? { tone: "info", text: tx(W.sent) }
          : r.share.status === "failed"
            ? { tone: "warn", text: tx(W.failed) }
            : { tone: "mut", text: tx(W.notSent) };

  const historyWord: Record<HistoryEvent["kind"], { en: string; hi?: string }> = { posted: W.hPosted, reversed: W.hReversed, sent: W.hSent, read: W.hRead };

  function submitReverse() {
    if (!reason) return;
    setError(null);
    start(async () => {
      const res = await reverseReceiptAction({ receiptNumber: r.receiptNumber, reasonCode: reason, note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSheet(null);
      toast.show({ text: tx(res.kind === "reversed" ? W.doneReversed : res.kind === "exists" ? W.doneExists : W.doneRequested), tone: res.kind === "exists" ? "info" : "ok" });
      router.refresh();
    });
  }

  const canAskReverse = perms.collect && !r.isReversed && !r.pendingRequest;
  const firstName = r.studentFullName.split(" ")[0] ?? r.studentFullName;

  return (
    <div style={{ padding: "18px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Pill tone={status.tone} icon={r.isReversed ? "undo" : r.share.status === "not_sent" ? "clock" : "ticks"}>{status.text}</Pill>
        <span style={{ flex: 1 }} />
        <Btn variant="ghost" icon="x" href={deskHref(base, {})} ariaLabel={tx(W.close)} style={{ width: 40, padding: 0 }} />
      </div>

      <Card style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 2 }}>
          <strong className="serif" style={{ fontSize: 15 }}>{W.school.en}</strong>
          <span lang="hi" style={{ fontSize: 13, color: "var(--mut)" }}>{W.school.hi}</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: "var(--accfg)", marginTop: 4 }}>{W.feeReceipt}</span>
          <span className="num" style={{ fontWeight: 700, fontSize: 16 }}>{r.receiptNumber}</span>
        </div>
        <div style={{ borderTop: "1px dashed var(--bd)", margin: "6px 0" }} />
        <Line k={tx(W.student)} v={r.studentFullName} />
        <Line k={tx(W.classSr)} v={`${r.classLabel} · ${r.admissionNo}`} />
        {r.fatherName ? <Line k={tx(W.father)} v={r.fatherName} /> : null}
        <Line k={tx(W.dateTime)} v={`${dateLabel(r.paymentDate)} · ${clock(r.createdAt)}`} />
        <div style={{ borderTop: "1px dashed var(--bd)", margin: "6px 0" }} />
        {r.heads.map((h, i) => (
          <Line key={`${h.label}-${i}`} k={h.label} v={rupees(h.amount)} />
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
          <span style={{ fontWeight: 700 }}>{tx(W.totalReceived)}</span>
          <span className="num" style={{ fontWeight: 800, fontSize: 22, textDecoration: r.isReversed ? "line-through" : undefined }}>{rupees(r.totalAmount)}</span>
        </div>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{amountInWords(r.totalAmount)}</span>
        <Line k={tx(W.mode)} v={`${tx(MODE_WORD[deskModeOf(r.paymentMode)])}${r.referenceNumber ? ` · ${tx(W.ref)} ${r.referenceNumber}` : ""}`} />
        <Line k={tx(W.takenBy)} v={r.receivedBy ?? "—"} />
        {r.isReversed ? (
          <span
            aria-label={tx(W.reversed)}
            style={{ position: "absolute", top: "42%", left: "50%", transform: "translate(-50%,-50%) rotate(-14deg)", border: "3px solid var(--bad)", color: "var(--bad)", borderRadius: 10, padding: "4px 16px", fontWeight: 800, fontSize: 22, letterSpacing: ".12em", opacity: 0.85, pointerEvents: "none" }}
          >
            REVERSED
          </span>
        ) : null}
      </Card>

      {r.pendingRequest ? <Pill tone="warn" icon="clock">{tx(W.pendingReversal)}{r.pendingRequest.by ? ` · ${r.pendingRequest.by}` : ""}</Pill> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
        <Btn variant="pri" icon="message" onClick={() => setSheet("send")} disabled={r.isReversed}>{tx(W.send)}</Btn>
        {perms.print ? <Btn variant="sec" icon="printer" href={pdf} target="_blank">{tx(W.print)}</Btn> : null}
        {perms.print ? <Btn variant="sec" icon="download" href={pdf} target="_blank">{tx(W.pdf)}</Btn> : null}
        {canAskReverse ? <Btn variant="danger" icon="undo" onClick={() => setSheet("reverse")}>{tx(W.reverse)}</Btn> : null}
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SecHead>{tx(W.history)}</SecHead>
        <Card pad={false}>
          {r.history.map((h, i) => (
            <div key={`${h.kind}-${h.at}-${i}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderTop: i ? "1px solid var(--bd)" : 0 }}>
              <Ic n={HISTORY_ICON[h.kind]} size={16} style={{ color: h.kind === "reversed" ? "var(--bad)" : "var(--mut)" }} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600 }}>
                  {tx(historyWord[h.kind])}
                  {h.amount ? ` · ${rupees(h.amount)}` : ""}
                </span>
                {h.note ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{h.note}</span> : null}
              </span>
              <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{shortDay(h.at)} · {clock(h.at)}</span>
            </div>
          ))}
        </Card>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.footnote)}</span>
      </section>

      <Sheet
        open={sheet === "reverse"}
        onClose={() => setSheet(null)}
        icon="undo"
        title={`${tx(W.reverse)} ${r.receiptNumber}?`}
        sub={`${r.studentFullName} · ${r.classLabel} · ${rupees(remaining)} · ${tx(MODE_WORD[deskModeOf(r.paymentMode)])}`}
        footer={
          <>
            <Btn variant="sec" full onClick={() => setSheet(null)}>{tx(W.keepReceipt)}</Btn>
            <Btn variant="danger" full disabled={!reason || busy} onClick={submitReverse}>
              {perms.reverse ? `${tx(W.reverse)} ${rupees(remaining)}` : tx(W.askAdmin)}
            </Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SecHead>{tx(W.why)}</SecHead>
          {REVERSAL_REASONS.map((code) => (
            <RadioCard key={code} name="reverse-reason" checked={reason === code} onSelect={() => setReason(code)} title={<Bi {...REASON_WORD[code]} />} />
          ))}
          <Field label={tx(W.noteOptional)}>
            <Textarea value={note} maxLength={400} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(perms.reverse ? W.impactAdmin : W.impactRequest)}</span>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
        </div>
      </Sheet>

      <Sheet
        open={sheet === "send"}
        onClose={() => setSheet(null)}
        icon="message"
        title={tx(W.shareTitle)}
        sub={sub(W.shareTitle) ?? undefined}
        footer={
          <>
            <Btn variant="sec" full onClick={() => setSheet(null)}>{tx(W.close)}</Btn>
            <Btn variant="pri" full icon="arrowRight" href={`/fees/receipts/${r.id}`}>{tx(W.openClassic)}</Btn>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <WhatsAppPreview
            lines={shareLines(firstName, rupees(r.totalAmount), r.receiptNumber, dateLabel(r.paymentDate))}
            footer={SHARE_FOOTER}
            count={1}
            cost={1}
          />
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.sharePreviewOnly)}</span>
        </div>
      </Sheet>
    </div>
  );
}
