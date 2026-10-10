"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { closeDayAction, reopenDayAction } from "@/app/(app)/receipts/actions";
import {
  cashDiff,
  closeBlocker,
  countedCash,
  DENOMINATIONS,
  DESK_MODES,
  summarizeReceipts,
  type DenominationCounts,
} from "@/modules/receipts/vx/domain/day-close";
import { clock, longDay, rupees } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Field, Stepper, SwitchRow, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Card, Pill, SecHead, SuccessTick } from "@/vx/ui/primitives";

import { deskHref } from "./href";
import type { DeskProps } from "./types";
import { MODE_WORD, W } from "./words";

function Row({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid var(--bd)", fontWeight: strong ? 700 : 500 }}>
      <span>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}

export function ClosePanel(props: DeskProps) {
  const { rows, anchor, today, span, closeEvent, perms, sessionLabel } = props;
  const { tx } = useVx();
  const router = useRouter();
  const toast = useToast();
  const [counts, setCounts] = useState<DenominationCounts>({});
  const [upi, setUpi] = useState(false);
  const [note, setNote] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const day = useMemo(() => summarizeReceipts(rows.filter((r) => r.paymentDate === anchor)), [rows, anchor]);
  const expectedCash = day.byMode.cash.amount;
  const counted = countedCash(counts);
  const diff = cashDiff(counted, expectedCash);
  const blocker = closeBlocker({ counted, expected: expectedCash, note, upiChecked: upi });
  const back = deskHref({ anchor, today, span }, {});

  function close() {
    setError(null);
    start(async () => {
      const res = await closeDayAction({ date: anchor, sessionLabel, denominations: counts, upiChecked: upi, note });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.show({ text: tx(W.closeDone) });
      router.refresh();
    });
  }

  function reopen() {
    setError(null);
    start(async () => {
      const res = await reopenDayAction({ date: anchor, sessionLabel, note: reopenNote });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReopenOpen(false);
      toast.show({ text: tx(W.reopenDone) });
      router.refresh();
    });
  }

  if (closeEvent) {
    const e = closeEvent;
    return (
      <div style={{ padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 14, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
          <SuccessTick />
          <strong className="serif" style={{ fontSize: 20 }}>{tx(W.dayClosed)} · {longDay(e.paymentDate)}</strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>
            {tx(W.closedAt)} {clock(e.createdAt)}
            {e.actorName ? ` · ${e.actorName}` : ""}
          </span>
        </div>
        <Card>
          <Row k={tx(W.collected)} v={rupees(Number(e.expected.total ?? e.cashExpected))} strong />
          <Row k={tx(W.cashCounted)} v={`${rupees(e.cashCounted)} / ${rupees(e.cashExpected)}`} />
          <Row k={tx(W.upi)} v={`${rupees(Number(e.expected.upi ?? 0))} · ${e.upiChecked ? tx(W.matched) : tx(W.notChecked)}`} />
          <Row k={tx(W.receipts)} v={`${e.receiptCount}${e.reversedCount ? ` · ${e.reversedCount} ${tx(W.reversed).toLowerCase()}` : ""}`} />
          {e.note ? <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--mut)" }}>{e.note}</p> : null}
        </Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {perms.dayBook ? (
            <Btn variant="sec" icon="download" href={`/fees/finance-controls/export?date=${anchor}&session=${encodeURIComponent(sessionLabel)}`} target="_blank" full>
              {tx(W.dayBook)}
            </Btn>
          ) : null}
          <Btn variant="pri" icon="chevLeft" href={back} full>{tx(W.back)}</Btn>
          {perms.reopen ? <Btn variant="ghost" icon="refresh" onClick={() => setReopenOpen(true)} full>{tx(W.reopen)}</Btn> : null}
        </div>
        <Sheet
          open={reopenOpen}
          onClose={() => setReopenOpen(false)}
          icon="refresh"
          title={tx(W.reopenTitle)}
          sub={longDay(anchor)}
          footer={
            <>
              <Btn variant="sec" full onClick={() => setReopenOpen(false)}>{tx(W.close)}</Btn>
              <Btn variant="danger" full disabled={busy || reopenNote.trim().length < 5} onClick={reopen}>{tx(W.reopen)}</Btn>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label={tx(W.reopenWhy)}>
              <Textarea value={reopenNote} rows={2} maxLength={500} onChange={(ev) => setReopenNote(ev.target.value)} />
            </Field>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.reopenImpact)}</span>
            {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div style={{ padding: "18px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <strong className="serif" style={{ fontSize: 20 }}><Bi {...W.closeTitle} /></strong>
        <span style={{ color: "var(--mut)", fontSize: 13 }}>{longDay(anchor)}</span>
      </div>
      {props.lastReopen ? (
        <Pill tone="warn" icon="refresh">
          {tx(W.reopenedBy)} {clock(props.lastReopen.createdAt)}
          {props.lastReopen.actorName ? ` · ${props.lastReopen.actorName}` : ""}
        </Pill>
      ) : null}

      <Card>
        <SecHead>{tx(W.expects)}</SecHead>
        {DESK_MODES.map((m) => (
          <Row key={m} k={`${tx(MODE_WORD[m])} · ${day.byMode[m].count}`} v={rupees(day.byMode[m].amount)} />
        ))}
        <Row k={tx(W.total)} v={rupees(day.net)} strong />
      </Card>

      <Card pad={false}>
        <SwitchRow
          icon="bank"
          title={tx(W.upiMatches)}
          sub={`${tx(W.expected)} ${rupees(day.byMode.upi.amount)} · ${upi ? tx(W.matched) : tx(W.notChecked)}`}
          on={upi}
          onChange={setUpi}
        />
      </Card>

      <Card>
        <SecHead action={<Pill tone={diff.kind === "match" ? "ok" : "warn"}>{diff.kind === "match" ? tx(W.matches) : `${tx(diff.kind === "short" ? W.shortBy : W.overBy)} ${rupees(diff.amount)}`}</Pill>}>
          {tx(W.countCash)}
        </SecHead>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {DENOMINATIONS.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--bd)" }}>
              <span className="num" style={{ width: 72, fontWeight: 700 }}>{d === 1 ? tx(W.coins) : `₹${d}`}</span>
              <Stepper label={d === 1 ? tx(W.coins) : `₹${d}`} value={counts[d] ?? 0} min={0} max={d === 1 ? 99999 : 9999} onChange={(v) => setCounts((c) => ({ ...c, [d]: v }))} />
              <span className="num" style={{ marginLeft: "auto", color: "var(--mut)" }}>{rupees((counts[d] ?? 0) * d)}</span>
            </div>
          ))}
          <Row k={tx(W.counted)} v={`${rupees(counted)} / ${rupees(expectedCash)}`} strong />
        </div>
      </Card>

      <Field label={tx(W.noteRecord)}>
        <Textarea value={note} rows={2} maxLength={500} onChange={(ev) => setNote(ev.target.value)} />
      </Field>

      {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
      {perms.collect ? (
        <>
          <Btn variant="pri" big full icon="lock" disabled={busy || blocker !== null} onClick={close}>{tx(W.closeButton)}</Btn>
          {blocker ? <span style={{ fontSize: 13, color: "var(--mut)", textAlign: "center" }}>{tx(blocker === "upi" ? W.closeHintUpi : W.closeHintNote)}</span> : null}
        </>
      ) : (
        <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.cannotClose)}</span>
      )}
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.closeNoLock)}</span>
      <Btn variant="ghost" icon="chevLeft" href={back}>{tx(W.back)}</Btn>
    </div>
  );
}
