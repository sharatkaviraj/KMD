"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { decideWriteOffAction, requestWriteOffAction } from "@/app/(app)/dues/actions";
import { isWriteOffReason, validWriteOffAmount, WRITE_OFF_REASONS, type WriteOffReason } from "@/modules/defaulters/vx/domain/families";
import { rupees } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Field, Input, RadioCard, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, SecHead } from "@/vx/ui/primitives";

import { duesHref } from "./href";
import type { LeftView } from "./types";
import { W, WRITE_OFF_WORD } from "./words";

/**
 * Staff who cannot write off send a request to Needs you. An admin opening the
 * same sheet (from Needs you or the Left list) decides instead: the request's
 * reason and amount are filled in, and they write it off or decline it.
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
      icon="flag"
      title={tx(canDecide ? W.woDecideTitle : W.woTitle)}
      sub={`${row.fullName} · ${row.classLabel ?? "—"} · ${tx(W.owes)} ${rupees(owed)}`}
      footer={
        canDecide ? (
          <>
            {asked ? (
              <Btn variant="sec" full disabled={busy} onClick={() => decide("decline")}>{tx(W.woDecline)}</Btn>
            ) : (
              <Btn variant="sec" full onClick={close}>{tx(W.woKeep)}</Btn>
            )}
            <Btn variant="danger" full disabled={!reason || !amountOk || busy} onClick={() => decide("approve")}>
              {tx(W.woApprove)} {amountOk ? rupees(value) : ""}
            </Btn>
          </>
        ) : (
          <>
            <Btn variant="sec" full onClick={close}>{tx(W.woKeep)}</Btn>
            <Btn variant="pri" full disabled={!reason || !amountOk || busy} onClick={send}>{tx(W.woSend)}</Btn>
          </>
        )
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {canDecide && asked ? (
          <span style={{ fontSize: 13 }}>
            {tx(W.woAskedBy)}: <strong>{asked.by ?? "—"}</strong> · {rupees(asked.amount)}
          </span>
        ) : null}
        <SecHead>{tx(W.woWhy)}</SecHead>
        {WRITE_OFF_REASONS.map((code) => (
          <RadioCard key={code} name="wo-reason" checked={reason === code} onSelect={() => setReason(code)} title={<Bi {...WRITE_OFF_WORD[code]} />} />
        ))}
        <Field label={tx(W.woAmount)} error={amountOk ? undefined : `Enter an amount from ₹1 to ${rupees(owed)}.`}>
          <Input inputMode="numeric" value={amount} invalid={!amountOk} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label={tx(W.note)}>
          <Textarea value={note} rows={2} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(canDecide ? W.woImpactAdmin : W.woImpact)}</span>
        {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
      </div>
    </Sheet>
  );
}
