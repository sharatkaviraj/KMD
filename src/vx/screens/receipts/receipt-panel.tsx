"use client";

import { Crest } from "@/vx/screens/system/brand";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { declineReversalRequestAction, reverseReceiptAction } from "@/app/(app)/receipts/actions";
import { deskModeOf, isReversalReason, REVERSAL_REASONS, type ReversalReason } from "@/modules/receipts/vx/domain/day-close";
import { humanizeReasonCode, splitReversalReason } from "@/modules/receipts/vx/domain/reversal-history";
import { canOpenReverse } from "@/modules/receipts/vx/domain/reverse-sheet";
import { shownSr } from "@/vx/domain/tell-apart";
import { amountInWords, dateLabel, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Field, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Pill, WhatsAppPreview, type Tone } from "@/vx/ui/primitives";

import { deskHref } from "./href";
import { PrintButton } from "./print-button";
import { deskDay, deskTime } from "./look";
import type { DeskProps, HistoryEvent, SelectedReceipt } from "./types";
import { fill, receiptModeWord, REASON_SUB, REASON_WORD, SHARE_FOOTER, shareLines, W } from "./words";

/** One labelled fact on the receipt: 11px label over a 600 value. */
function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <span style={{ color: "var(--mut)", fontSize: 11 }}>{k}</span>
      <span className="num" style={{ fontWeight: 600 }}>{v}</span>
    </span>
  );
}

/** "Rupees four thousand three hundred fifty only", lower-case as the design writes it. */
function inWords(n: number): string {
  return amountInWords(n).replace(/^Rupees (.*) only$/, (_, body: string) => `Rupees ${body.toLowerCase()} only`);
}

const HISTORY_DOT: Record<HistoryEvent["kind"], string> = { posted: "var(--acc)", asked: "var(--warn)", sent: "var(--ok)", read: "var(--ok)", reversed: "var(--bad)" };

export function ReceiptPanel(props: DeskProps & { receipt: SelectedReceipt; paper?: React.ReactNode }) {
  const { receipt: r, perms, anchor, today, span, paper } = props;
  const { tx, sub } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<"reverse" | "send" | null>(props.sheet);
  // Opened on a request (Needs you → Review): the accountant's reason is already chosen.
  const asked = r.pendingRequest && isReversalReason(r.pendingRequest.reasonCode) ? r.pendingRequest.reasonCode : null;
  const [reason, setReason] = useState<ReversalReason | null>(asked);
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const base = { anchor, today, span };
  const pdf = `/fees/receipts/${r.id}/pdf`;
  const remaining = Math.max(0, r.totalAmount - r.reversedAmount);
  const forgiven = (r.lateFeeWaived ?? 0) + (r.discountGiven ?? 0);
  const forgivenWhat = [r.lateFeeWaived ? tx(W.forgivenLateFee) : null, r.discountGiven ? tx(W.forgivenDiscount) : null].filter(Boolean).join(" + ");
  const mode = deskModeOf(r.paymentMode);
  const sent = r.share.status === "sent" || r.share.status === "delivered" || r.share.status === "read";

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
            : { tone: "warn", text: tx(W.notSent) };

  /** "Wrong amount typed — the note", never the stored code "wrong_amount" (smoke 20 Oct). */
  function reasonText(code: string | null | undefined, note: string | null | undefined): string {
    const word = code ? (REASON_WORD[code] ? tx(REASON_WORD[code]) : humanizeReasonCode(code)) : "";
    const plain = note?.trim() ?? "";
    const extra = plain && plain !== (code ? REASON_WORD[code]?.en : undefined) ? plain : "";
    return [word, extra].filter(Boolean).join(" — ");
  }
  const storedReason = (raw: string | null | undefined) => {
    const parts = splitReversalReason(raw);
    return reasonText(parts.code, parts.note);
  };

  function historyText(h: HistoryEvent): string {
    if (h.kind === "posted") return r.receivedBy ? tx(fill(W.hPosted, { name: r.receivedBy })) : tx(W.hPostedBare);
    if (h.kind === "sent") return r.fatherName ? tx(fill(W.hSent, { name: r.fatherName })) : tx(W.hSentBare);
    if (h.kind === "read") return tx(W.hRead);
    if (h.kind === "asked") {
      const why = reasonText(h.reasonCode, h.note);
      return `${h.byName ? tx(fill(W.hAsked, { name: h.byName })) : tx(W.hAskedBare)}${why ? ` · ${why}` : ""}`;
    }
    const why = storedReason(h.note);
    return `${h.byName ? tx(fill(W.hReversedBy, { name: h.byName })) : tx(W.hReversed)}${why ? ` · ${why}` : ""}${h.amount ? ` · ${rupees(h.amount)}` : ""}`;
  }

  function submitDecline() {
    setError(null);
    start(async () => {
      const res = await declineReversalRequestAction({ receiptNumber: r.receiptNumber, note: declineNote });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSheet(null);
      setDeclining(false);
      toast.show({ text: tx(W.doneDeclined), tone: "info" });
      const url = new URL(window.location.href);
      if (url.searchParams.has("sheet")) {
        url.searchParams.delete("sheet");
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      }
      router.refresh();
    });
  }

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
      // Drop `?sheet=reverse` from the URL, or a reload reopens the sheet on a
      // receipt that is now reversed (B08). Every other parameter stays.
      const url = new URL(window.location.href);
      if (url.searchParams.has("sheet")) {
        url.searchParams.delete("sheet");
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      }
      router.refresh();
    });
  }

  // Only a receipt that can still be reversed, with no request already
  // waiting, by someone who may ask (B08) — the same rule the URL is held to.
  const canAskReverse = canOpenReverse({ isReversed: r.isReversed, remaining, hasPendingRequest: Boolean(r.pendingRequest) }, perms.accounts, perms.reverse);
  const reversedLine = r.isReversed && r.reversal
    ? [
        tx(fill(W.reversedOn, { day: deskDay(r.reversal.at), time: deskTime(r.reversal.at) })),
        r.reversal.byName ? tx(fill(W.reversedBy, { name: r.reversal.byName })) : null,
        storedReason(r.reversal.note) || null,
      ].filter(Boolean).join(" · ")
    : null;
  const firstName = r.studentFullName.split(" ")[0] ?? r.studentFullName;
  const fatherFirst = r.fatherName?.split(" ")[0] ?? null;
  const sendLabel = sent ? tx(W.sendAgain) : fatherFirst ? tx(fill(W.sendTo, { name: fatherFirst })) : tx(W.sendWa);
  const modeLine = `${tx(receiptModeWord(r.paymentMode))}${r.referenceNumber ? ` · ${mode === "upi" ? `${tx(W.ref).toLowerCase()} ` : ""}${r.referenceNumber}` : ""}`;
  const tools = [perms.print, canAskReverse].filter(Boolean).length;

  return (
    <div style={{ padding: "18px 22px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="only-d" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Pill tone={status.tone} style={{ height: 26, padding: "0 10px", fontSize: 12 }}>{status.text}</Pill>
        <Btn variant="ghost" icon="x" href={deskHref(base, {})} ariaLabel={tx(W.closeReceipt)} style={{ width: 36, height: 36, padding: 0 }} />
      </div>

      {/* Only a page without the full receipt detail still draws this small card. */}
      {paper ? null : (
      <div className="card" style={{ position: "relative", padding: "20px 20px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1.5px dashed var(--bds)" }}>
          <Crest size={42} radius={12} still />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="serif" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>{W.school.en}</span>
            <span lang="hi" style={{ fontSize: 12, color: "var(--mut)" }}>{W.school.hi}</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--mut)" }}>{W.feeReceipt}</span>
          <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{r.receiptNumber}</span>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px 16px", fontSize: 13 }}>
          <Fact k={tx(W.student)} v={r.studentFullName} />
          {/* An office placeholder ("PENDING-SR-6752") is not an SR to print (smoke 21 Oct). */}
          {shownSr(r.admissionNo) ? <Fact k={tx(W.classSr)} v={`${r.classLabel} · ${shownSr(r.admissionNo)}`} /> : <Fact k={tx(W.classOnly)} v={r.classLabel} />}
          <Fact k={tx(W.father)} v={r.fatherName ?? "—"} />
          <Fact k={tx(W.dateTime)} v={`${tx(deskDay(r.paymentDate))} · ${tx(deskTime(r.createdAt))}`} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)" }}>
          {r.heads.map((h, i) => (
            <div key={`${h.label}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--bd)", fontSize: 13 }}>
              <span>{h.label}</span>
              <span className="num" style={{ fontWeight: 600 }}>{rupees(h.amount)}</span>
            </div>
          ))}
          {forgiven > 0 ? (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--bd)", fontSize: 13, color: "var(--mut)" }}>
              <span>{tx(W.forgivenLine)}{forgivenWhat ? ` · ${forgivenWhat}` : ""}</span>
              <span className="num" style={{ fontWeight: 600 }}>{rupees(forgiven)}</span>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 2px" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(W.totalReceived)}</span>
            <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{rupees(r.totalAmount)}</span>
          </div>
          <span style={{ fontSize: 12, color: "var(--mut)", fontStyle: "italic" }}>{inWords(r.totalAmount)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: "var(--mut)", paddingTop: 4, borderTop: "1.5px dashed var(--bds)" }}>
          <span className="num" style={{ minWidth: 0 }}>{modeLine}</span>
          <span style={{ textAlign: "right" }}>{tx(W.takenBy)} {r.receivedBy ?? "—"}</span>
        </div>
        {r.isReversed ? (
          // Two layers: xPopIn animates `transform`, so the tilt and centring sit on the outer one.
          <span aria-label={tx(W.reversed)} style={{ position: "absolute", top: "46%", left: "50%", transform: "translate(-50%, -50%) rotate(-14deg)", pointerEvents: "none" }}>
            <span style={{ display: "block", padding: "6px 18px", border: "3px solid var(--bad)", borderRadius: 10, color: "var(--bad)", fontSize: 26, fontWeight: 800, letterSpacing: ".12em", background: "var(--card)", opacity: 0.92, animation: "xPopIn .5s var(--spring) both" }}>
              REVERSED
            </span>
          </span>
        ) : null}
      </div>
      )}

      {reversedLine ? <Pill tone="bad" icon="undo" style={{ height: "auto", minHeight: 26, padding: "4px 10px", whiteSpace: "normal" }}><span id="rc-reversed-on">{reversedLine}</span></Pill> : null}
      {r.pendingRequest && !r.isReversed ? (
        <Pill tone="warn" icon="clock" style={{ height: "auto", minHeight: 26, padding: "4px 10px", whiteSpace: "normal" }}>
          {[tx(W.pendingReversal), r.pendingRequest.by, reasonText(r.pendingRequest.reasonCode, r.pendingRequest.note)].filter(Boolean).join(" · ")}
        </Pill>
      ) : null}

      {!r.isReversed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Btn variant="pri" icon="send" onClick={() => setSheet("send")} style={{ height: 46 }}>{sendLabel}</Btn>
          {paper ? (
            <>
              {/* The receipt is on screen, so Print A4 prints it here, on one
                  sheet — no new tab, no PDF viewer in between. */}
              {perms.print ? (
                <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                  <PrintButton variant="sec" label={tx(W.printA4)} busyLabel={tx(W.printBusy)} style={{ height: 46 }} />
                  <Btn variant="sec" icon="download" href={pdf} target="_blank" prefetch={false} style={{ height: 46 }}>{tx(W.downloadPdf)}</Btn>
                </div>
              ) : null}
              {canAskReverse ? <Btn variant="sec" icon="undo" onClick={() => setSheet("reverse")} style={{ color: "var(--bad)" }}>{tx(W.reverse)}</Btn> : null}
            </>
          ) : tools ? (
            <div className="g3" style={{ display: "grid", gridTemplateColumns: `repeat(${tools}, minmax(0, 1fr))`, gap: 8 }}>
              {/* Print and PDF were two buttons to the same PDF (accountant, UI). */}
              {perms.print ? <Btn variant="sec" icon="printer" href={pdf} target="_blank" prefetch={false}>{tx(W.printPdf)}</Btn> : null}
              {canAskReverse ? <Btn variant="sec" icon="undo" onClick={() => setSheet("reverse")} style={{ color: "var(--bad)" }}>{tx(W.reverse)}</Btn> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The receipt itself: the Fees receipt, as it prints (owner, 7 Nov
          2026), under the buttons that act on it. */}
      {paper ? <div className="vx-receipt-paper">{paper}</div> : null}

      <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column" }}>
        <h2 className="sech" style={{ marginBottom: 8 }}>{tx(W.history)}</h2>
        {r.history.map((h, i) => (
          <div key={`${h.kind}-${h.at}-${i}`} style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr) auto", gap: 10, alignItems: "start", padding: "6px 0", animation: `xIn .3s var(--ease) ${i * 60}ms both` }}>
            <span aria-hidden="true" style={{ width: 10, height: 10, marginTop: 4, borderRadius: 5, background: HISTORY_DOT[h.kind] }} />
            <span style={{ fontSize: 13 }}>{historyText(h)}</span>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{h.at.slice(0, 10) === r.paymentDate ? tx(deskTime(h.at)) : `${tx(deskDay(h.at))} · ${tx(deskTime(h.at))}`}</span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{tx(W.footnote)}</span>

      <Sheet
        open={sheet === "reverse" && canAskReverse}
        onClose={() => setSheet(null)}
        title={`${tx(W.reverse)} ${r.receiptNumber}?`}
        sub={`${r.studentFullName} · ${r.classLabel} · ${rupees(remaining)} · ${tx(receiptModeWord(r.paymentMode))}`}
        footer={
          declining ? (
            <>
              <Btn variant="sec" onClick={() => setDeclining(false)} style={{ flex: 1 }}>{tx(W.close)}</Btn>
              <Btn variant="pri" disabled={busy || declineNote.trim().length < 3} onClick={submitDecline} style={{ flex: 1.4 }}>{tx(W.declineConfirm)}</Btn>
            </>
          ) : (
            <>
              {/* With a request waiting, the admin's other answer is a real decline, not just closing the sheet. */}
              {perms.reverse && r.pendingRequest ? (
                <Btn variant="sec" onClick={() => setDeclining(true)} style={{ flex: 1 }}>{tx(W.decline)}</Btn>
              ) : (
                <Btn variant="sec" onClick={() => setSheet(null)} style={{ flex: 1 }}>{tx(W.keepReceipt)}</Btn>
              )}
              <Btn variant="danger" icon="undo" disabled={!reason || busy} onClick={submitReverse} style={{ flex: 1.4 }}>
                {perms.reverse ? `${tx(W.reverse)} ${rupees(remaining)}` : tx(W.askAdmin)}
              </Btn>
            </>
          )
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          {r.pendingRequest ? (
            <div id="rc-asked" style={{ padding: "12px 14px", borderRadius: 14, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>
                {r.pendingRequest.by
                  ? tx(fill(W.askedBy, { name: r.pendingRequest.by, when: `${deskDay(r.pendingRequest.at)} · ${deskTime(r.pendingRequest.at)}` }))
                  : tx(fill(W.askedBare, { when: `${deskDay(r.pendingRequest.at)} · ${deskTime(r.pendingRequest.at)}` }))}
              </span>
              <span>{tx(W.askedReason)}: {reasonText(r.pendingRequest.reasonCode, r.pendingRequest.note) || "—"}</span>
            </div>
          ) : null}
          {declining ? (
            <>
              <Field label={tx(W.declineWhy)}>
                <Textarea value={declineNote} maxLength={400} onChange={(e) => setDeclineNote(e.target.value)} style={{ minHeight: 72 }} />
              </Field>
              {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
            </>
          ) : (
          <>
          <h3 className="sech">{tx(W.why)}</h3>
          <div role="radiogroup" aria-label={tx(W.why)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {REVERSAL_REASONS.map((code) => {
              const on = reason === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="tap"
                  onClick={() => setReason(code)}
                  style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "10px 14px", borderRadius: 14, border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)", color: "var(--fg)", textAlign: "left" }}
                >
                  <span aria-hidden="true" style={{ flex: "none", width: 20, height: 20, borderRadius: 10, border: `2px solid ${on ? "var(--acc)" : "var(--bds)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: "var(--acc)", transform: `scale(${on ? 1 : 0})`, transition: "transform .25s var(--spring)" }} />
                  </span>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(REASON_WORD[code])}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(REASON_SUB[code])}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Field label={tx(W.noteOptional)} style={{ marginTop: 4 }}>
            <Textarea value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder={tx(perms.reverse ? W.notePlaceholderAdmin : W.notePlaceholderRequest)} style={{ minHeight: 72 }} />
          </Field>
          <div style={{ padding: "12px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", fontSize: 13, lineHeight: 1.5, display: "flex", gap: 10 }}>
            <Ic n="info" style={{ marginTop: 2 }} />
            <span>
              {perms.reverse
                ? tx(fill(W.impactAdmin, { amount: rupees(-remaining), no: r.receiptNumber, name: firstName, back: rupees(remaining), day: deskDay(r.paymentDate) }))
                : `${tx(W.impactRequest)} ${tx(W.impactRequestNote)}`}
              {forgiven > 0 ? (
                <>
                  <br />
                  {tx(fill(W.impactConcession, { forgiven: rupees(forgiven), what: forgivenWhat }))}
                </>
              ) : null}
              {perms.reverse && r.dayClosed ? (
                <>
                  <br />
                  {tx(fill(W.impactDayClosed, { day: deskDay(r.paymentDate) }))}
                </>
              ) : null}
            </span>
          </div>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
          </>
          )}
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
