"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  checkFeesOfficeCommandAction, decideFeesRefundAction, processFeesRefundAction, reverseFeesReceiptAction, type OfficeResult,
} from "@/app/(app)/receipts/office-command-actions";
import { REVERSAL_REASONS, type OfficeCommandResult, type ReversalReason } from "@/platform/fees-bridge/office-command-contracts";
import { rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Input, Select } from "@/vx/ui/controls";
import { Sheet } from "@/vx/ui/overlays";
import { Btn } from "@/vx/ui/primitives";

/*
 * Reversal and refund decisions done in One, decided by Fees (review F01).
 * The payment desk's rules: the command is kept on this device before it is
 * sent; Saving… until Fees answers; a confirmed change shows what Fees did; a
 * refusal says why and changes nothing; a lost answer is checked by the same
 * id and only that id is ever sent again.
 */
const CODE: Record<string, Pair> = {
  already_reversed: p("This receipt has already been reversed.", "यह रसीद पहले ही रद्द हो चुकी है।"),
  refund_in_progress: p("A refund is open on this receipt. Decide it first.", "इस रसीद पर धन-वापसी खुली है। पहले उसे तय करें।"),
  receipt_number_mismatch: p("The receipt number typed does not match this receipt.", "लिखा गया रसीद नंबर इस रसीद से मेल नहीं खाता।"),
  refund_not_pending: p("This refund was already decided.", "यह धन-वापसी पहले ही तय हो चुकी है।"),
  refund_not_approved: p("This refund is not approved yet.", "यह धन-वापसी अभी मंज़ूर नहीं है।"),
  refund_exceeds_balance: p("The refund is more than what is left on the receipt.", "धन-वापसी रसीद पर बची राशि से ज़्यादा है।"),
  forbidden: p("Your account cannot do this from One yet. Ask an administrator, or do it in Fees.", "आपका खाता अभी One से यह नहीं कर सकता। व्यवस्थापक से पूछें, या Fees में करें।"),
  read_only: p("Fee changes from One are switched off. Use Fees.", "One से फ़ीस बदलाव बंद हैं। Fees का उपयोग करें।"),
  office_commands_disabled: p("Fee changes from One are switched off. Use Fees.", "One से फ़ीस बदलाव बंद हैं। Fees का उपयोग करें।"),
  idempotency_conflict: p("This request was already used for something else. Close it and start again.", "यह अनुरोध पहले किसी और काम में लग चुका है। बंद करके फिर शुरू करें।"),
  not_found: p("Fees cannot find this in this session.", "Fees इस सत्र में इसे नहीं ढूँढ पाया।"),
};
const W = {
  failed: p("Fees did not accept this. Nothing was changed.", "Fees ने इसे स्वीकार नहीं किया। कुछ नहीं बदला।"),
  saving: p("Saving in Fees…", "Fees में सहेजा जा रहा है…"),
  uncertain: p("The answer from Fees was lost. It may have been saved. Check before trying again.", "Fees का जवाब नहीं मिला। हो सकता है सहेज गया हो। दोबारा करने से पहले जाँचें।"),
  check: p("Check what happened", "जाँचें क्या हुआ"),
  notFound: p("Fees has no record of it, so nothing was saved. You can send the same request again.", "Fees में इसका कोई रिकॉर्ड नहीं, इसलिए कुछ नहीं सहेजा गया। वही अनुरोध फिर भेज सकते हैं।"),
  resend: p("Send the same request again", "वही अनुरोध फिर भेजें"),
};
export const officeWords = (code: string): Pair => CODE[code] ?? W.failed;

type Phase<T> =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done"; data: T }
  | { kind: "failed"; code: string }
  | { kind: "uncertain" }
  | { kind: "not_found" };

type Stored = { commandId: string; payload: unknown };

/** One durable command per screen thing (a receipt, a refund), kept in this tab until Fees answers. */
export function useOfficeCommand<T extends OfficeCommandResult>(storageKey: string, dispatch: (payload: never) => Promise<OfficeResult<T>>) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase<T>>({ kind: "idle" });
  const stored = useRef<Stored | null>(null);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  });

  // A command left unanswered by an earlier visit is shown as uncertain, never resent by itself.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw) return;
        stored.current = JSON.parse(raw) as Stored;
        setPhase({ kind: "uncertain" });
      } catch {
        /* Nothing kept: nothing to recover. */
      }
    });
    return () => { active = false; };
  }, [storageKey]);

  const clear = () => {
    stored.current = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* the answer is already known */ }
  };

  async function deliver(entry: Stored) {
    setPhase({ kind: "saving" });
    let result: OfficeResult<T>;
    try {
      result = await dispatchRef.current(entry.payload as never);
    } catch {
      setPhase({ kind: "uncertain" });
      return;
    }
    if (result.ok) {
      clear();
      setPhase({ kind: "done", data: result.data });
      router.refresh();
    } else if (result.uncertain) {
      setPhase({ kind: "uncertain" });
    } else {
      clear();
      setPhase({ kind: "failed", code: result.code });
    }
  }

  /** Keep the command on this device, then send it; refuses to start while one is unresolved. */
  function send(payload: { commandId: string } & Record<string, unknown>) {
    if (stored.current) return;
    const entry: Stored = { commandId: payload.commandId, payload };
    try { sessionStorage.setItem(storageKey, JSON.stringify(entry)); } catch { setPhase({ kind: "failed", code: "storage" }); return; }
    stored.current = entry;
    void deliver(entry);
  }

  async function check() {
    const entry = stored.current;
    if (!entry) return;
    setPhase({ kind: "saving" });
    const result = await checkFeesOfficeCommandAction(entry.commandId).catch(() => null);
    if (!result || !result.ok) return setPhase({ kind: "uncertain" });
    if (result.data.status === "not_found") return setPhase({ kind: "not_found" });
    clear();
    setPhase({ kind: "done", data: result.data as T });
    router.refresh();
  }

  const resend = () => { if (stored.current) void deliver(stored.current); };
  const reset = () => { if (!stored.current) setPhase({ kind: "idle" }); };
  return { phase, send, check, resend, reset, busy: phase.kind === "saving" };
}

/** Saving, lost answer, not found, refusal — the shared lines under any office command. */
export function OfficeStatus<T>({ phase, check, resend }: { phase: Phase<T>; check: () => void; resend: () => void }) {
  const { tx } = useVx();
  if (phase.kind === "saving") return <p role="status" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}><Ic n="refresh" size={16} className="spin" />{tx(W.saving)}</p>;
  if (phase.kind === "uncertain") return <div role="alert" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", color: "var(--warnfg)" }}>{tx(W.uncertain)}<Btn onClick={check}>{tx(W.check)}</Btn></div>;
  if (phase.kind === "not_found") return <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>{tx(W.notFound)}<Btn variant="pri" onClick={resend}>{tx(W.resend)}</Btn></div>;
  if (phase.kind === "failed") return <p role="alert" style={{ margin: 0, color: "var(--bad)" }}>{tx(phase.code === "storage" ? p("This device could not keep the request safely, so it was not sent.", "यह डिवाइस अनुरोध सुरक्षित नहीं रख सका, इसलिए भेजा नहीं गया।") : officeWords(phase.code))}</p>;
  return null;
}

const R = {
  open: p("Reverse receipt", "रसीद रद्द करें"),
  title: p("Reverse this receipt in Fees", "Fees में यह रसीद रद्द करें"),
  means: (amount: string) => p(`Takes back what is left of ${amount} on this receipt. Fees records it in your name and the dues return to the student. The family is not messaged.`, `इस रसीद की ${amount} में से बची राशि वापस ली जाएगी। Fees इसे आपके नाम दर्ज करेगा और बकाया विद्यार्थी पर लौटेगा। परिवार को संदेश नहीं जाएगा।`),
  reason: p("Reason", "कारण"),
  note: p("What happened", "क्या हुआ"),
  typeNumber: (number: string) => p(`Type the receipt number to confirm: ${number}`, `पुष्टि के लिए रसीद नंबर लिखें: ${number}`),
  confirm: p("Reverse in Fees", "Fees में रद्द करें"),
  cancel: p("Cancel", "रहने दें"),
  done: (amount: string) => p(`Reversed in Fees: ${amount} taken back.`, `Fees में रद्द: ${amount} वापस लिया गया।`),
};
const REASON_WORD: Record<ReversalReason, Pair> = {
  "Wrong fee entry": p("Wrong fee entry", "ग़लत फ़ीस दर्ज"),
  "Wrong student": p("Wrong student", "ग़लत विद्यार्थी"),
  "Duplicate receipt": p("Duplicate receipt", "दोहरी रसीद"),
  "Wrong amount": p("Wrong amount", "ग़लत राशि"),
  Other: p("Other", "अन्य"),
};

/** The Fees "Reverse this receipt" dialog, in One: reason, note and the typed number Fees asks for. */
export function ReverseReceiptButton({ receiptId, receiptNumber, sessionLabel, amount }: { receiptId: string; receiptNumber: string; sessionLabel: string; amount: number }) {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReversalReason>(REVERSAL_REASONS[0]);
  const [note, setNote] = useState("");
  const [typed, setTyped] = useState("");
  const command = useOfficeCommand(`vppsone:fees-office:reversal:${receiptId}`, reverseFeesReceiptAction);
  const ready = note.trim().length > 0 && typed.trim().toUpperCase() === receiptNumber.trim().toUpperCase();
  const done = command.phase.kind === "done" && command.phase.data.kind === "reversal" ? command.phase.data : null;
  const unresolved = command.phase.kind === "uncertain" || command.phase.kind === "not_found";
  return (
    <>
      <Btn icon="undo" onClick={() => setOpen(true)} disabled={done !== null}>{tx(R.open)}</Btn>
      {unresolved && !open ? <OfficeStatus phase={command.phase} check={command.check} resend={command.resend} /> : null}
      <Sheet open={open} onClose={() => { if (!command.busy) setOpen(false); }} dismissable={!command.busy} title={tx(R.title)} sub={tx(R.means(rupees(amount)))}
        footer={done ? <Btn variant="pri" onClick={() => setOpen(false)} style={{ flex: 1 }}>{tx(p("Close", "बंद करें"))}</Btn> : (
          <>
            <Btn disabled={command.busy} onClick={() => setOpen(false)} style={{ flex: 1 }}>{tx(R.cancel)}</Btn>
            <Btn variant="pri" disabled={!ready || command.busy || unresolved} onClick={() => command.send({ commandId: crypto.randomUUID(), sessionLabel, receiptId, receiptNumber: typed.trim(), reasonCode: reason, reasonNote: note.trim() })} style={{ flex: 1.4 }}>{tx(R.confirm)}</Btn>
          </>
        )}>
        {done ? (
          <p role="status" style={{ margin: 0, fontWeight: 600, color: "var(--ok)", display: "flex", gap: 8, alignItems: "center" }}><Ic n="check" />{tx(R.done(rupees(done.reversedAmount)))}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>{tx(R.reason)}
              <Select value={reason} onChange={(e) => setReason(e.target.value as ReversalReason)} disabled={command.busy}>
                {REVERSAL_REASONS.map((code) => <option key={code} value={code}>{tx(REASON_WORD[code])}</option>)}
              </Select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>{tx(R.note)}
              <textarea className="vx-ta" value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} disabled={command.busy} style={{ font: "inherit", padding: 10, borderRadius: 12, border: "1px solid var(--bds)", background: "var(--card)", color: "var(--fg)" }} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>{tx(R.typeNumber(receiptNumber))}
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} disabled={command.busy} />
            </label>
            <OfficeStatus phase={command.phase} check={command.check} resend={command.resend} />
          </div>
        )}
      </Sheet>
    </>
  );
}

const F = {
  approve: p("Approve", "मंज़ूर करें"),
  reject: p("Reject", "अस्वीकार करें"),
  note: p("Note (optional)", "टिप्पणी (वैकल्पिक)"),
  process: (amount: string) => p(`Mark processed: post the ${amount} refund`, `पूरा हुआ दर्ज करें: ${amount} की धन-वापसी दर्ज करें`),
  confirmProcess: (amount: string) => p(`Tap again to post ${amount} back to the family`, `परिवार को ${amount} लौटाने के लिए फिर टैप करें`),
  approved: p("Approved in Fees.", "Fees में मंज़ूर।"),
  rejected: p("Rejected in Fees.", "Fees में अस्वीकार।"),
  processed: (amount: string) => p(`Refund posted in Fees: ${amount}.`, `Fees में धन-वापसी दर्ज: ${amount}।`),
};

/** A Fees refund request decided from Needs you: approve or reject it, or post an approved one. */
export function FeesRefundActions({ refundId, kind, sessionLabel, amount, big = false }: { refundId: string; kind: "refund_approval" | "refund_processing"; sessionLabel: string; amount: number; big?: boolean }) {
  const { tx } = useVx();
  const [note, setNote] = useState("");
  const [arming, setArming] = useState(false);
  const decide = useOfficeCommand(`vppsone:fees-office:refund-decision:${refundId}`, (payload: never) => decideFeesRefundAction(refundId, payload));
  const post = useOfficeCommand(`vppsone:fees-office:refund-process:${refundId}`, (payload: never) => processFeesRefundAction(refundId, payload));
  const style = big ? { height: 48 } : undefined;
  if (kind === "refund_approval") {
    const done = decide.phase.kind === "done" && decide.phase.data.kind === "refund_decision" ? decide.phase.data : null;
    if (done) return <p role="status" style={{ margin: 0, fontWeight: 600, color: "var(--ok)", display: "flex", gap: 8, alignItems: "center" }}><Ic n="check" />{tx(done.refundStatus === "approved" ? F.approved : F.rejected)}</p>;
    const busy = decide.busy || decide.phase.kind === "uncertain" || decide.phase.kind === "not_found";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>{tx(F.note)}
          <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="pri" style={style} disabled={busy} onClick={() => decide.send({ commandId: crypto.randomUUID(), sessionLabel, decision: "approve", ...(note.trim() ? { note: note.trim() } : {}) })}>{tx(F.approve)}</Btn>
          <Btn style={style} disabled={busy} onClick={() => decide.send({ commandId: crypto.randomUUID(), sessionLabel, decision: "reject", ...(note.trim() ? { note: note.trim() } : {}) })}>{tx(F.reject)}</Btn>
        </div>
        <OfficeStatus phase={decide.phase} check={decide.check} resend={decide.resend} />
      </div>
    );
  }
  const done = post.phase.kind === "done" && post.phase.data.kind === "refund_process" ? post.phase.data : null;
  if (done) return <p role="status" style={{ margin: 0, fontWeight: 600, color: "var(--ok)", display: "flex", gap: 8, alignItems: "center" }}><Ic n="check" />{tx(F.processed(rupees(done.reversedAmount)))}</p>;
  const busy = post.busy || post.phase.kind === "uncertain" || post.phase.kind === "not_found";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Posting money back takes two deliberate taps. */}
      <Btn variant="pri" style={style} disabled={busy} onClick={() => { if (!arming) { setArming(true); return; } setArming(false); post.send({ commandId: crypto.randomUUID(), sessionLabel }); }}>
        {tx(arming ? F.confirmProcess(rupees(amount)) : F.process(rupees(amount)))}
      </Btn>
      <OfficeStatus phase={post.phase} check={post.check} resend={post.resend} />
    </div>
  );
}
