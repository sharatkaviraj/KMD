"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { decideWriteOffAction, requestWriteOffAction } from "@/app/(app)/dues/actions";
import { isWriteOffReason, validWriteOffAmount, WRITE_OFF_REASONS, type WriteOffReason } from "@/modules/defaulters/vx/domain/families";
import { rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Field, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

import { Choice, Inset } from "./bits";
import { duesHref } from "./href";
import type { LeftView } from "./types";
import { fill, W, WRITE_OFF_SUB, WRITE_OFF_WORD } from "./words";

/**
 * Staff who cannot write off send a request to Needs you. An admin opening the
 * same sheet (from Needs you or the Left list) decides instead: the request's
 * reason and amount are filled in, and they write it off or decline it.
 * Nothing is written off from a request; money moves only on the admin's
 * decision, through the fee app's action (UI-65).
 */
export function WriteOffSheet({ row, sessionLabel, open, canDecide }: { row: LeftView; sessionLabel: string; open: boolean; canDecide: boolean }) {
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const owed = Math.round(row.owed);
  const asked = row.writeOff?.status === "pending" ? row.writeOff : null;
  const [reason, setReason] = useState<WriteOffReason | null>(asked && isWriteOffReason(asked.reasonCode) ? asked.reasonCode : null);
  const [amount, setAmount] = useState(String(asked ? Math.min(Math.round(asked.amount), owed) : owed));
  const [note, setNote] = useState(asked?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const value = Number(amount);
  const amountOk = validWriteOffAmount(value, owed);
  const close = () => router.push(duesHref("left"));

  function send() {
    if (!reason || !amountOk) return;
    setError(null);
    start(async () => {
      const res = await requestWriteOffAction({ studentId: row.studentId, sessionLabel, amount: value, reasonCode: reason, note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ text: tx(res.message === "exists" ? W.woExists : W.woSent), tone: res.message === "exists" ? "info" : "ok" });
      router.push(duesHref("left"));
      router.refresh();
    });
  }

  function decide(decision: "approve" | "decline") {
    if (decision === "approve" && (!reason || !amountOk)) return;
    setError(null);
    start(async () => {
      const res = await decideWriteOffAction({ studentId: row.studentId, sessionLabel, decision, amount: value, reasonCode: reason ?? "", note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ text: tx(decision === "approve" ? W.woDone : W.woDeclinedToast), tone: decision === "approve" ? "ok" : "info" });
      router.push(duesHref("left"));
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(canDecide ? W.woDecideTitle : W.woTitle)}
      sub={tx(fill(W.woSubLine, { name: row.fullName, cls: row.classLabel ?? "—", amt: rupees(owed) }))}
      footer={
        canDecide ? (
          <>
            {asked ? (
              <Btn variant="sec" disabled={busy} onClick={() => decide("decline")} style={{ flex: 1 }}>{tx(W.woDecline)}</Btn>
            ) : (
              <Btn variant="sec" onClick={close} style={{ flex: 1 }}>{tx(W.woKeep)}</Btn>
            )}
            <Btn variant="danger" icon="check" disabled={!reason || !amountOk || busy} onClick={() => decide("approve")} style={{ flex: 1.6 }}>
              {tx(W.woApprove)} {amountOk ? rupees(value) : ""}
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="sec" onClick={close} style={{ flex: 1 }}>{tx(W.woKeep)}</Btn>
            <Btn variant="danger" icon="inbox" disabled={!reason || !amountOk || busy} onClick={send} style={{ flex: 1.6 }}>{tx(W.woSend)}</Btn>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
        {canDecide && asked ? (
          <span style={{ fontSize: 13 }}>
            {tx(W.woAskedBy)}: <strong>{asked.by ?? "—"}</strong> · {rupees(asked.amount)}
          </span>
        ) : null}
        <h3 className="sech">{tx(W.woWhy)}</h3>
        <div role="radiogroup" aria-label={tx(W.woWhy)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {WRITE_OFF_REASONS.map((code) => (
            <Choice key={code} on={reason === code} onPick={() => setReason(code)} label={tx(WRITE_OFF_WORD[code])} sub={tx(WRITE_OFF_SUB[code])} />
          ))}
        </div>
        <Field label={tx(W.woAmount)} style={{ marginTop: 4 }}>
          <input className={`inp${amountOk ? "" : " err"}`} inputMode="numeric" aria-invalid={amountOk ? undefined : true} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        {amountOk ? null : (
          <span role="alert" className="fadein" style={{ fontSize: 12, fontWeight: 600, color: "var(--bad)", marginTop: -4 }}>{tx(fill(W.woAmountErr, { amt: rupees(owed) }))}</span>
        )}
        <Field label={tx(W.woNoteLabel)}>
          <Textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={tx(W.woNotePh)} style={{ minHeight: 64 }} />
        </Field>
        <Inset icon="info" bg="var(--warns)" fg="var(--warnfg)">
          {canDecide ? tx(W.woImpactAdmin) : tx(fill(W.woImpact, { amt: rupees(owed), name: row.fullName }))}
        </Inset>
        {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
      </div>
    </Sheet>
  );
}
