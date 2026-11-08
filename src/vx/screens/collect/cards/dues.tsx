"use client";

import { useRef } from "react";

import { mc } from "@/messages/collect";
import { childTotals } from "@/modules/collect/domain/family";
import type { WaiverReason } from "@/modules/collect/domain/remarks";
import type { CollectDues, CollectReceiptRow } from "@/modules/collect/domain/types";
import type { Localized } from "@/platform/i18n/language";

import { Face } from "@/vx/ui/face";
import { avatarTone, BackButton, CardShell, firstName, Icon, initialsOf, tail, useFit, YearBar } from "../parts";
import { Bi, dayMonth, fill, money, useCx } from "../text";

export type SiblingView = { id: string; name: string; classLabel: string; ticked: boolean; dues: CollectDues | null; loading: boolean; outstanding: number | null };

export const REASON_TEXT: Record<WaiverReason, Localized> = {
  desk: mc.reasonDesk,
  hardship: mc.reasonHardship,
  sibling: mc.reasonSibling,
  principal: mc.reasonPrincipal,
};

export function DuesCard(props: {
  dues: CollectDues;
  today: string;
  paidToday: CollectReceiptRow | null;
  siblings: SiblingView[];
  familyCount: number;
  canWaive: boolean;
  choice: "waive" | "collect";
  reason: WaiverReason;
  familyLate: number;
  /** A ticked sibling's dues are still on their way: the family total is not known yet. */
  waiting?: "loading" | "failed" | null;
  onLate: (choice: "waive" | "collect") => void;
  onReason: () => void;
  onSibling: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { p, language } = useCx();
  const { dues } = props;
  const totals = childTotals({ id: dues.student.id, rows: dues.rows, takeLate: true }, props.today);
  const box = useRef<HTMLDivElement>(null);
  const cut = useFit(box, ".cx-rcl", [dues.student.id, dues.receipts.length, props.siblings.length, props.familyCount, language]);
  const older = cut + dues.olderReceipts;
  const family = props.familyCount > 1;
  const anyDue = totals.fees > 0 || family;
  const showLate = props.familyLate > 0 && !dues.onPlan;

  return (
    <CardShell
      eyebrow={mc.stepDues}
      title={mc.duesTitle}
      foot={
        <>
          <BackButton onClick={props.onBack} />
          <button type="button" className="cx-btn pri" disabled={!anyDue || Boolean(props.waiting)} onClick={props.onNext}>
            <Bi text={props.waiting === "failed" ? mc.siblingFailed : props.waiting ? mc.loadingNow : family ? fill(mc.collectForN, { n: props.familyCount }) : fill(mc.collectFrom, { name: firstName(dues.student.name) })} />
          </button>
        </>
      }
    >
      <div className="cx-who">
        <Face className={`cx-av ${avatarTone(dues.student.id)}`} student={dues.student.id} zoom={dues.student.name} zoomSub={dues.student.classLabel}>{initialsOf(dues.student.name)}</Face>
        <div>
          <div className="nm" title={dues.student.name}>{dues.student.name}</div>
          <div className="meta">
            {p(mc.classWord)} {dues.student.classLabel} · SR {dues.student.sr}
            {dues.student.father ? ` · ${dues.student.father}` : ""}
            {tail(dues.student.phone) ? ` · ${tail(dues.student.phone)}` : ""}
          </div>
        </div>
      </div>
      {props.paidToday || dues.onPlan ? (
        <div className="cx-flags">
          {props.paidToday ? (
            <span className="cx-flag warn">
              <Icon name="alert" size={14} />
              <Bi text={fill(mc.paidTodayFlag, { a: money(props.paidToday.amount) })} inline />
            </span>
          ) : null}
          {dues.onPlan ? (
            <span className="cx-flag info">
              <Icon name="info" size={14} />
              <Bi text={mc.emiFlag} inline />
            </span>
          ) : null}
        </div>
      ) : null}
      {totals.fees > 0 ? (
        <>
          <YearBar rows={dues.rows} takeLate={props.choice === "collect"} onDate={props.today} />
          <div className="cx-duo">
            <div className="cx-tile">
              <div className="lab"><Bi text={mc.feesPending} inline /></div>
              <div className="val">{money(totals.fees)}</div>
              <div className="sub">{p(totals.overdueFees ? fill(mc.overdueAmount, { a: money(totals.overdueFees) }) : mc.nothingOverdue)}</div>
            </div>
            <div className={`cx-tile late${totals.late ? "" : " zero"}`}>
              <div className="lab"><Bi text={mc.lateFee} inline /></div>
              <div className="val">{money(totals.late)}</div>
              <div className="sub">{p(mc.lateApart)}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="cx-clear">
          <div className="big"><Icon name="check" size={30} /></div>
          <h3><Bi text={mc.yearClear} /></h3>
        </div>
      )}
      {props.siblings.map((s) => {
        const t = s.dues ? childTotals({ id: s.id, rows: s.dues.rows, takeLate: true }, props.today) : null;
        const owes = t ? t.fees > 0 : (s.outstanding ?? 1) > 0;
        return (
          <button type="button" key={s.id} className={`cx-fam${s.ticked ? " on" : ""}`} aria-pressed={s.ticked} disabled={!owes && !s.ticked} onClick={() => props.onSibling(s.id)}>
            <span className="cx-cbx"><Icon name="check" size={14} /></span>
            <span style={{ minWidth: 0 }}>
              <span className="fn">{s.name} · {s.classLabel}</span>
              <span className="fs">{p(s.ticked ? mc.siblingIn : owes ? mc.siblingTick : mc.siblingClear)}</span>
            </span>
            <b>
              {t ? money(t.fees) : s.loading ? p(mc.loadingNow) : s.outstanding !== null ? money(s.outstanding) : ""}
              {t && t.late ? <small>{p(mc.lateShort)} {money(t.late)}</small> : null}
            </b>
          </button>
        );
      })}
      {showLate ? (
        !props.canWaive ? (
          <div className="cx-lrow">
            <span className="lt">
              <Bi text={fill(mc.lateWillCollect, { a: money(props.familyLate) })} inline />
              <small>{p(mc.lateCannotWaive)}</small>
            </span>
          </div>
        ) : (
          <div className="cx-lrow">
            <span className="lt">
              {p(family ? mc.lateFamily : mc.lateFee)} {money(props.familyLate)}
              <small>
                {props.choice === "waive" ? (
                  <button type="button" className="cx-rsn" onClick={props.onReason}>
                    {p(mc.reasonWord)}: {p(REASON_TEXT[props.reason])} ▾
                  </button>
                ) : (
                  p(mc.lateAfterFees)
                )}
              </small>
            </span>
            <div className="cx-seg" role="group" aria-label={p(mc.lateFee)}>
              <button type="button" className={props.choice === "waive" ? "on" : ""} aria-pressed={props.choice === "waive"} onClick={() => props.onLate("waive")}>
                {p(mc.waive)}
              </button>
              <button type="button" className={props.choice === "collect" ? "on" : ""} aria-pressed={props.choice === "collect"} onClick={() => props.onLate("collect")}>
                {p(mc.collect)}
              </button>
            </div>
          </div>
        )
      ) : null}
      <div className="cx-rcpts" ref={box}>
        <h5>
          <b><Bi text={mc.pastReceipts} inline /></b>
          <span>{older > 0 ? p(fill(mc.olderReceipts, { n: older })) : ""}</span>
        </h5>
        {dues.receipts.length ? (
          dues.receipts.map((r) => (
            <div key={r.id} className={`cx-rcl${r.date === props.today ? " today" : ""}${r.reversed ? " rev" : ""}`}>
              <span className="mono">{r.number.slice(-9)}</span>
              <span>
                {p(dayMonth(r.date))} · {r.mode}
                {r.reversed ? ` · ${p(mc.reversedTag)}` : ""}
              </span>
              <b>{money(r.amount)}</b>
            </div>
          ))
        ) : (
          <div className="cx-rcl">
            <span />
            <span>{p(mc.noReceipts)}</span>
            <b />
          </div>
        )}
      </div>
    </CardShell>
  );
}
