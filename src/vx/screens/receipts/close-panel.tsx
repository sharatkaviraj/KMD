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
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Field, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { Btn, Pill } from "@/vx/ui/primitives";

import { deskHref } from "./href";
import { deskDay, MODE_LOOK } from "./look";
import type { DeskProps } from "./types";
import { fill, MODE_WORD, receiptCount, W } from "./words";

/** The drawn tick on "Day closed": a soft disc, a ring and a check that draw in. */
function ClosedTick() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
      <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
      <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
      <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
    </svg>
  );
}

/** − count + for one note: 40px buttons around a number that can also be typed. */
function Count({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  const { tx } = useVx();
  return (
    <span role="group" aria-label={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" className="tap btn sec" aria-label={`${tx(W.oneLess)} ${label}`} onClick={() => onChange(Math.max(0, value - 1))} style={{ width: 40, height: 40, padding: 0 }}>
        <Ic n="minus" />
      </button>
      <input
        className="num"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(max, Math.max(0, Number.isFinite(n) ? n : 0)));
        }}
        style={{ width: 44, minWidth: 44, textAlign: "center", border: 0, background: "transparent", outline: "none", fontSize: 17, fontWeight: 700, color: "var(--fg)" }}
      />
      <button type="button" className="tap btn sec" aria-label={`${tx(W.oneMore)} ${label}`} onClick={() => onChange(Math.min(max, value + 1))} style={{ width: 40, height: 40, padding: 0 }}>
        <Ic n="plus" />
      </button>
    </span>
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

  const dayRows = useMemo(() => rows.filter((r) => r.paymentDate === anchor), [rows, anchor]);
  const day = useMemo(() => summarizeReceipts(dayRows), [dayRows]);
  const expectedCash = day.byMode.cash.amount;
  const counted = countedCash(counts);
  const diff = cashDiff(counted, expectedCash);
  const blocker = closeBlocker({ counted, expected: expectedCash, note, upiChecked: upi });
  const back = deskHref({ anchor, today, span }, {});
  const dayBookHref = `/fees/finance-controls/export?date=${anchor}&session=${encodeURIComponent(sessionLabel)}`;

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
    const d = cashDiff(e.cashCounted, e.cashExpected);
    const summary: [string, string][] = [
      [tx(W.collected), rupees(Number(e.expected.total ?? e.cashExpected))],
      [tx(W.cashCounted), `${rupees(e.cashCounted)}${d.kind === "match" ? "" : ` (${tx(d.kind === "short" ? W.short : W.over)} ${rupees(d.amount)})`}`],
      [tx(W.upi), `${rupees(Number(e.expected.upi ?? 0))} · ${e.upiChecked ? tx(W.matched) : tx(W.notChecked)}`],
      [tx(W.receipts), `${e.receiptCount} · ${e.reversedCount} ${tx(W.reversed).toLowerCase()}`],
    ];
    if (e.note) summary.push([tx(W.note), e.note]);
    return (
      <div className="pad" style={{ padding: "22px 28px 40px" }}>
        <div className="card fadein" style={{ maxWidth: 620, margin: "10px auto 0", padding: "32px 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
          <ClosedTick />
          <h2 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>{tx(W.dayClosed)} · {deskDay(e.paymentDate)}</h2>
          <span style={{ fontSize: 14, color: "var(--mut)" }}>
            {e.actorName ? tx(fill(W.closedBy, { name: e.actorName, time: clock(e.createdAt) })) : tx(fill(W.closedAtOnly, { time: clock(e.createdAt) }))} {tx(W.closeNoLock)}
          </span>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)", marginTop: 6 }}>
            {summary.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 2px", borderBottom: "1px solid var(--bd)", fontSize: 14 }}>
                <span style={{ color: "var(--mut)" }}>{k}</span>
                <span className="num" style={{ fontWeight: 700, textAlign: "right" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
            {perms.dayBook ? <Btn variant="pri" icon="download" href={dayBookHref} target="_blank">{tx(W.dayBook)}</Btn> : null}
            <Btn variant="sec" href={back}>{tx(W.back)}</Btn>
            {perms.reopen ? <Btn variant="ghost" onClick={() => setReopenOpen(true)} style={{ color: "var(--bad)" }}>{tx(W.reopen)}</Btn> : null}
          </div>
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

  const diffLook =
    diff.kind === "match"
      ? { bg: "var(--oks)", fg: "var(--ok)", text: tx(W.matches), icon: "check" as const }
      : diff.kind === "short"
        ? { bg: "var(--warns)", fg: "var(--warnfg)", text: `${tx(W.shortBy)} ${rupees(diff.amount)}`, icon: "alert" as const }
        : { bg: "var(--infos)", fg: "var(--info)", text: `${tx(W.overBy)} ${rupees(diff.amount)}`, icon: "alert" as const };
  const ready = blocker === null;

  return (
    <div className="pad" style={{ padding: "22px 28px 40px" }}>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {props.lastReopen ? (
            <Pill tone="warn" icon="refresh" style={{ alignSelf: "flex-start" }}>
              {tx(W.reopenedBy)} {clock(props.lastReopen.createdAt)}
              {props.lastReopen.actorName ? ` · ${props.lastReopen.actorName}` : ""}
            </Pill>
          ) : null}
          <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(W.expects)}</h2>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{deskDay(anchor)} · {tx(receiptCount(day.count))}</span>
            </div>
            {DESK_MODES.map((m, i) => {
                const look = MODE_LOOK[m];
                const n = day.byMode[m].count;
                return (
                  <div key={m} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderTop: i === 0 ? 0 : "1px solid var(--bd)" }}>
                    <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: look.bg, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Ic n={look.icon} />
                    </span>
                    <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(MODE_WORD[m])}</span>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{n ? tx(receiptCount(n)) : tx(W.noneToday)}</span>
                    </span>
                    <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>{rupees(day.byMode[m].amount)}</span>
                  </div>
                );
              })}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "2px solid var(--bd)" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(W.total)}</span>
              <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{rupees(day.net)}</span>
            </div>
          </div>
          <button type="button" className="tap card" role="switch" aria-checked={upi} onClick={() => setUpi((v) => !v)} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, textAlign: "left", color: "var(--fg)", width: "100%" }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(W.upiMatches)}</span>
              <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.expected)} {rupees(day.byMode.upi.amount)} · {upi ? tx(W.matched) : tx(W.notChecked)}</span>
            </span>
            <span className={`sw${upi ? " on" : ""}`} aria-hidden="true"><span /></span>
          </button>
          <Field label={tx(W.noteRecord)}>
            <Textarea value={note} maxLength={500} onChange={(ev) => setNote(ev.target.value)} placeholder={tx(W.notePlaceholderClose)} />
          </Field>
        </div>

        <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(W.countCash)}</h2>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.expected)} {rupees(expectedCash)}</span>
          </div>
          {DENOMINATIONS.map((d) => {
            const label = d === 1 ? tx(W.coins) : `₹${d}`;
            return (
              <div key={d} style={{ display: "grid", gridTemplateColumns: "74px minmax(0, 1fr) 96px", gap: 10, alignItems: "center", padding: "4px 0" }}>
                <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
                <Count label={label} value={counts[d] ?? 0} max={d === 1 ? 99999 : 9999} onChange={(v) => setCounts((c) => ({ ...c, [d]: v }))} />
                <span className="num" style={{ textAlign: "right", fontSize: 14, fontWeight: 600, color: "var(--mut)" }}>{rupees((counts[d] ?? 0) * d)}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 12, borderTop: "2px solid var(--bd)" }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.counted)}</span>
              <span className="num" aria-live="polite" style={{ fontSize: 26, fontWeight: 700 }}>{rupees(counted)}</span>
            </span>
            <span className="pill" style={{ height: 32, padding: "0 12px", fontSize: 13, background: diffLook.bg, color: diffLook.fg, animation: diff.kind === "match" ? "xPopIn .45s var(--spring) both" : "none" }}>
              <Ic n={diffLook.icon} size={15} />
              {diffLook.text}
            </span>
          </div>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{error}</span> : null}
          {perms.accounts ? (
            <>
              <button type="button" className="tap btn pri" disabled={busy || !ready} onClick={close} style={{ height: 48, fontSize: 15, marginTop: 6 }}>
                <Ic n="lock" />
                {tx(W.closeButton)}
              </button>
              <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>{tx(blocker === "upi" ? W.closeHintUpi : blocker === "note" ? W.closeHintNote : W.closeHintReady)}</span>
            </>
          ) : (
            <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>{tx(W.cannotClose)}</span>
          )}
          <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>{tx(W.closeNoLock)}</span>
        </div>
      </div>
    </div>
  );
}
