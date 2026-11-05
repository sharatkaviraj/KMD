"use client";

import { useEffect, useState } from "react";

import { mc } from "@/messages/collect";
import { changeDue, checkSplit, NOTE_DENOMINATIONS, notesTotal, receivedSuggestions, shapeChequeDate, splitSuggestions, type CollectMode, type LedgerMode, type NoteCount } from "@/modules/collect/domain/cash";
import { dateStrip, daysBetween, monthBounds, monthGrid, shiftMonth } from "@/modules/collect/domain/dates";
import { buildStudentFeeUpiPayment } from "@/modules/payments/domain/upi";
import type { Localized } from "@/platform/i18n/language";
import { monthP } from "@/vx/format";

import { BackButton, CardShell, HoldButton, Icon, type IconName } from "../parts";
import { Bi, dayMonth, fill, money, useCx, weekday } from "../text";

export type PaySub = null | "notes" | "cal" | "qr";

const MODES: Array<{ mode: CollectMode; text: Localized; icon: IconName; key: string }> = [
  { mode: "cash", text: mc.modeCash, icon: "cash", key: "F1" },
  { mode: "upi", text: mc.modeUpi, icon: "upi", key: "F2" },
  { mode: "split", text: mc.modeSplit, icon: "split", key: "F5" },
  { mode: "bank_transfer", text: mc.modeBank, icon: "bank", key: "F3" },
  { mode: "cheque", text: mc.modeCheque, icon: "cheque", key: "F4" },
];
const BANKS = ["SBI", "Bank of Baroda", "PNB", "HDFC", "ICICI"];
const WEEK = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"];

/** The school's real UPI QR, drawn only when asked for (the qrcode library loads with it). */
function UpiQr({ amount, sr, big, show }: { amount: number; sr: string; big?: boolean; show: boolean }) {
  const { p } = useCx();
  const [src, setSrc] = useState<{ key: string; url: string } | null>(null);
  const uri = show && amount > 0 ? buildStudentFeeUpiPayment({ admissionNo: sr, amount }).uri : "";
  useEffect(() => {
    if (!uri) return;
    let live = true;
    void import("qrcode")
      .then((qr) => qr.toDataURL(uri, { margin: 1, width: big ? 360 : 224, errorCorrectionLevel: "M" }))
      .then((url) => {
        if (live) setSrc({ key: uri, url });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uri, big]);
  if (!show) return <span className="ph"><small>{p(mc.upiTestOnly)}</small></span>;
  // eslint-disable-next-line @next/next/no-img-element
  return src && src.key === uri ? <img src={src.url} alt="UPI QR" /> : <span className="ph"><Icon name="qr" size={28} /></span>;
}

export type PayEffect =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "failed" }
  | { kind: "over"; max: number }
  | { kind: "late"; onDate: number; today: number }
  | { kind: "same"; days: number };

export function PayCard(props: {
  total: number;
  sr: string;
  mode: CollectMode;
  modes: readonly LedgerMode[];
  canSplit: boolean;
  showRealQr: boolean;
  received: number | null;
  notes: NoteCount | null;
  splitCash: number | null;
  cheque: { number: string; bank: string; date: string };
  date: string;
  today: string;
  sessionStart: string;
  calMonth: string;
  sub: PaySub;
  effect: PayEffect;
  needsCheck: boolean;
  ready: boolean;
  canPost: boolean;
  holdRef: React.RefObject<{ start: () => void; stop: () => void } | null>;
  onMode: (mode: CollectMode) => void;
  onReceived: (amount: number) => void;
  onNote: (denomination: (typeof NOTE_DENOMINATIONS)[number], by: number) => void;
  onSplitCash: (cash: number | null) => void;
  onCheque: (patch: Partial<{ number: string; bank: string; date: string }>) => void;
  onDate: (date: string) => void;
  onCalMonth: (month: string) => void;
  onSub: (sub: PaySub) => void;
  onAmount: () => void;
  onBack: () => void;
  onNext: () => void;
  onSave: () => void;
}) {
  const { p, f } = useCx();
  const tot = props.total;
  const rule = { today: props.today, sessionStart: props.sessionStart };

  if (props.sub === "notes") {
    const counted = notesTotal(props.notes ?? {});
    const ch = changeDue(counted, tot);
    return (
      <CardShell eyebrow={mc.countNotesTitle} title={mc.countNotesTitle} foot={<button type="button" className="cx-btn pri" onClick={() => props.onSub(null)}><Bi text={mc.doneCounting} /></button>}>
        <div className="cx-notes">
          {NOTE_DENOMINATIONS.map((d) => (
            <div className="cx-note" key={d}>
              <span className="d">₹{d}</span>
              <button type="button" aria-label={f(fill(mc.oneLess, { a: `₹${d}` }))} onClick={() => props.onNote(d, -1)}>−</button>
              <span className="c">{props.notes?.[d] ?? 0}</span>
              <button type="button" aria-label={f(fill(mc.oneMore, { a: `₹${d}` }))} onClick={() => props.onNote(d, 1)}>+</button>
            </div>
          ))}
        </div>
        <div className="cx-ntot"><span><Bi text={mc.counted} inline /></span><span>{money(counted)}</span></div>
        <div className={`cx-change${ch > 0 ? " give" : ch < 0 ? " short" : ""}`}>
          <span className="lab"><Bi text={ch > 0 ? mc.giveBack : ch < 0 ? mc.shortBy : mc.exactAmount} /></span>
          <span className="big">{ch === 0 ? <Icon name="check" size={26} /> : money(Math.abs(ch))}</span>
        </div>
      </CardShell>
    );
  }

  if (props.sub === "qr") {
    const upi = props.mode === "split" ? tot - (props.splitCash ?? 0) : tot;
    return (
      <CardShell eyebrow={mc.modeUpi} title={fill(mc.qrTitle, { a: money(upi) })} foot={<button type="button" className="cx-btn pri" onClick={() => props.onSub(null)}><Bi text={mc.qrDone} /></button>}>
        <div className="cx-upi big">
          <UpiQr amount={upi} sr={props.sr} big show={props.showRealQr} />
          <p><Bi text={mc.qrNote} /></p>
        </div>
      </CardShell>
    );
  }

  if (props.sub === "cal") {
    const bounds = monthBounds(props.calMonth, rule);
    const cells = monthGrid(props.calMonth, rule);
    const title = monthP(`${props.calMonth}-15`);
    return (
      <CardShell eyebrow={mc.calEyebrow} title={mc.calTitle} foot={<button type="button" className="cx-btn sec" style={{ flex: 1 }} onClick={() => props.onSub(null)}><Bi text={mc.calBack} /></button>}>
        <div className="cx-calhead">
          <button type="button" disabled={!bounds.prev} aria-label={f(mc.prevMonth)} onClick={() => props.onCalMonth(shiftMonth(props.calMonth, -1))}><Icon name="chevl" /></button>
          <b><Bi text={{ hi: title.hi, en: title.en }} inline /></b>
          <button type="button" disabled={!bounds.next} aria-label={f(mc.nextMonth)} onClick={() => props.onCalMonth(shiftMonth(props.calMonth, 1))}><Icon name="chev" /></button>
        </div>
        <div className="cx-cal">
          {WEEK.map((d) => (
            <span className="wd" key={d}>{p(weekday(d))}</span>
          ))}
          {cells.map((cell, i) =>
            cell ? (
              <button type="button" key={cell.date} disabled={!cell.pickable} className={`${cell.today ? "today" : ""}${cell.date === props.date ? " on" : ""}`} onClick={() => props.onDate(cell.date)}>
                {cell.day}
              </button>
            ) : (
              <span className="blank" key={`b${i}`} />
            ),
          )}
        </div>
        <div className="cx-hint"><Bi text={mc.calHint} inline /></div>
      </CardShell>
    );
  }

  const accepted = (m: CollectMode) => (m === "split" ? props.canSplit && props.modes.includes("cash") && props.modes.includes("upi") : props.modes.includes(m));
  let detail: React.ReactNode;
  if (props.mode === "cash") {
    const rec = props.received ?? tot;
    const ch = changeDue(rec, tot);
    detail = (
      <>
        <div className="cx-dl"><Bi text={mc.receivedFrom} inline /></div>
        <div className="cx-recv">
          <button type="button" className={`cx-chip${rec === tot && props.notes === null ? " on" : ""}`} onClick={() => props.onReceived(tot)}><Bi text={mc.exact} inline /></button>
          {receivedSuggestions(tot).map((v) => (
            <button type="button" key={v} className={`cx-chip${rec === v && props.notes === null ? " on" : ""}`} onClick={() => props.onReceived(v)}>{money(v)}</button>
          ))}
          <button type="button" className={`cx-chip${props.notes !== null ? " on" : ""}`} onClick={() => props.onSub("notes")}>
            <Icon name="notes" size={15} />
            <Bi text={mc.countNotes} inline />
          </button>
        </div>
        <div className={`cx-change${ch > 0 ? " give" : ch < 0 ? " short" : ""}`}>
          <span className="lab"><Bi text={ch > 0 ? mc.giveBack : ch < 0 ? mc.shortBy : mc.exactAmount} /></span>
          <span className="big">{ch === 0 ? <Icon name="check" size={26} /> : money(Math.abs(ch))}</span>
        </div>
      </>
    );
  } else if (props.mode === "upi") {
    detail = (
      <>
        <div className="cx-upi">
          <UpiQr amount={tot} sr={props.sr} show={props.showRealQr} />
          <p><b>{p(fill(mc.upiShow, { a: money(tot) }))}</b></p>
        </div>
        <div className="cx-dl"><Bi text={mc.upiNoRef} inline /></div>
      </>
    );
  } else if (props.mode === "split") {
    const split = checkSplit(tot, props.splitCash);
    detail = !props.canSplit ? (
      <div className="cx-dl"><Bi text={mc.splitUnavailable} inline /></div>
    ) : (
      <>
        <div className="cx-tender">
          <Icon name="cash" size={22} />
          <span className="tn"><Bi text={mc.cashPart} inline /></span>
          <input
            className="cx-inp"
            inputMode="numeric"
            autoComplete="off"
            placeholder="₹ 0"
            aria-label={f(mc.cashPart)}
            value={props.splitCash ?? ""}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(0, 7);
              props.onSplitCash(d === "" ? null : Number(d));
            }}
          />
        </div>
        <div className="cx-recv sm">
          {splitSuggestions(tot).map((v) => (
            <button type="button" key={v} className={`cx-chip${props.splitCash === v ? " on" : ""}`} onClick={() => props.onSplitCash(v)}>{money(v)}</button>
          ))}
        </div>
        <div className="cx-tender">
          <Icon name="upi" size={22} />
          <span className="tn">
            <Bi text={mc.upiRest} inline />
            {split.ok ? (
              <small><button type="button" className="cx-rsn" style={{ color: "var(--acc)" }} onClick={() => props.onSub("qr")}>{p(mc.showQr)}</button></small>
            ) : null}
          </span>
          <span className="ta">{split.ok ? money(split.upi) : "—"}</span>
        </div>
        <div className={`cx-tsum${split.ok ? " ok" : props.splitCash !== null ? " bad" : ""}`}>
          <span><Bi text={mc.together} inline /></span>
          <span>{split.ok ? `${money(split.cash)} + ${money(split.upi)} = ${money(tot)} ✓` : !split.ok && split.reason === "covers_all" ? p(mc.cashCovers) : money(tot)}</span>
        </div>
      </>
    );
  } else if (props.mode === "cheque") {
    detail = (
      <>
        <div className="cx-row2">
          <div className="cx-fld">
            <label htmlFor="cx-chq"><Bi text={mc.chequeNo} inline /></label>
            <input id="cx-chq" className="cx-inp" inputMode="numeric" maxLength={6} autoComplete="off" placeholder="000000" value={props.cheque.number} onChange={(e) => props.onCheque({ number: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
          </div>
          <div className="cx-fld">
            <label htmlFor="cx-chqd"><Bi text={mc.chequeDate} inline /></label>
            <input id="cx-chqd" className="cx-inp" inputMode="numeric" maxLength={10} autoComplete="off" placeholder="DD/MM/YYYY" value={props.cheque.date} onChange={(e) => props.onCheque({ date: shapeChequeDate(e.target.value) })} />
          </div>
        </div>
        <div className="cx-recv" role="group" aria-label={f(mc.chequeBank)}>
          {BANKS.map((b) => (
            <button type="button" key={b} className={`cx-chip${props.cheque.bank === b ? " on" : ""}`} onClick={() => props.onCheque({ bank: b })}>{b}</button>
          ))}
          <button type="button" className={`cx-chip${props.cheque.bank === mc.otherBank.en ? " on" : ""}`} onClick={() => props.onCheque({ bank: mc.otherBank.en })}>{p(mc.otherBank)}</button>
        </div>
      </>
    );
  } else {
    detail = <div className="cx-dl"><Bi text={mc.bankNote} inline /></div>;
  }

  const days = dateStrip(props.today);
  const inStrip = days.includes(props.date);
  const backdated = props.date !== props.today;
  const effect = props.effect;

  return (
    <CardShell
      eyebrow={mc.stepPay}
      title={fill(mc.payTitle, { a: money(tot) })}
      foot={
        <>
          <BackButton onClick={props.onBack} />
          {props.needsCheck ? (
            <button type="button" className="cx-btn pri" disabled={!props.ready} onClick={props.onNext}><Bi text={mc.nextCheck} /></button>
          ) : (
            <HoldButton label={props.canPost ? fill(mc.holdSave, { a: money(tot) }) : mc.savingClosed} disabled={!props.ready || !props.canPost} onDone={props.onSave} holdRef={props.holdRef} />
          )}
        </>
      }
    >
      <div className="cx-modes" role="group" aria-label={f(mc.cardPay)}>
        {MODES.map((m) => (
          <button type="button" key={m.mode} className={`cx-mt${props.mode === m.mode ? " on" : ""}`} aria-pressed={props.mode === m.mode} disabled={!accepted(m.mode)} title={accepted(m.mode) ? undefined : f(m.mode === "split" && !props.canSplit ? mc.splitUnavailable : mc.modeNotTaken)} onClick={() => props.onMode(m.mode)}>
            <span className="cx-k deskonly">{m.key}</span>
            <Icon name={m.icon} size={22} />
            <span><Bi text={m.text} /></span>
          </button>
        ))}
      </div>
      <div className="cx-detail">{detail}</div>
      <div className="cx-when">
        <div className="wl">
          <span><Bi text={mc.paidOn} inline /></span>
          <span className={`cx-badge ${backdated ? "back" : "today"}`}>{p(backdated ? fill(mc.badgeBack, { d: dayMonth(props.date) }) : mc.badgeToday)}</span>
        </div>
        <div className="cx-mdays">
          {days.map((d) => (
            <button type="button" key={d} className={`cx-mday${d === props.date ? " on" : ""}`} aria-label={d} aria-pressed={d === props.date} onClick={() => props.onDate(d)} disabled={d < props.sessionStart}>
              <span className="w">{p(d === props.today ? mc.today : weekday(d))}</span>
              <span className="d">{Number(d.slice(8))}</span>
            </button>
          ))}
          <button type="button" className={`cx-mday mcal${inStrip ? "" : " on"}`} aria-label={f(mc.earlierDate)} onClick={() => props.onSub("cal")}>
            <Icon name="cal" size={20} />
          </button>
        </div>
      </div>
      {effect.kind === "over" ? (
        <div className="cx-effect bad">
          <Icon name="alert" />
          <div>{p(fill(mc.moreThanDue, { a: money(tot), d: dayMonth(props.date) }))}</div>
          <button type="button" className="cx-btn sec sm" onClick={props.onAmount}>{p(mc.changeAmount)}</button>
        </div>
      ) : effect.kind === "checking" ? (
        <div className="cx-effect"><Icon name="info" /><div>{p(fill(mc.checkingDate, { d: dayMonth(props.date) }))}</div></div>
      ) : effect.kind === "failed" ? (
        <div className="cx-effect bad"><Icon name="alert" /><div>{p(mc.dateFailed)}</div></div>
      ) : effect.kind === "late" ? (
        <div className="cx-effect warn"><Icon name="info" /><div>{p(fill(mc.lateOnDate, { d: dayMonth(props.date), a: money(effect.onDate), name: money(effect.today) }))}</div></div>
      ) : effect.kind === "same" ? (
        <div className="cx-effect deskonly"><Icon name="info" /><div>{p(fill(mc.backdatedSame, { n: effect.days }))}</div></div>
      ) : null}
    </CardShell>
  );
}

export function backdatedDays(date: string, today: string): number {
  return daysBetween(date, today);
}
