"use client";

import { useLayoutEffect, useRef } from "react";

import { mc } from "@/messages/collect";
import { childTotals, type ChildMoney, type SplitRule, type Suggestion } from "@/modules/collect/domain/family";
import { amountInWords } from "@/modules/collect/domain/words";
import { isOverdueOn, orderForSettlement, walkPayment } from "@/modules/payments/vx/domain/desk";
import type { Localized } from "@/platform/i18n/language";

import { rollNumber } from "../motion";
import { allocText, BackButton, CardShell, firstName, YearBar } from "../parts";
import { Bi, dayMonth, fill, money, useCx } from "../text";

export type AmountChild = ChildMoney & { name: string; classLabel: string };

const SUGGESTION_TEXT: Record<Suggestion["kind"], { one: Localized; family: Localized }> = {
  overdue: { one: mc.sugOverdue, family: mc.sugOverdueFamily },
  next: { one: mc.sugNext, family: mc.sugNextFamily },
  year: { one: mc.sugYear, family: mc.sugYearFamily },
  last: { one: mc.sugLast, family: mc.sugLast },
};

export function AmountCard({ amountRef, ...props }: {
  kids: AmountChild[];
  total: number;
  shares: number[];
  max: number;
  ok: boolean;
  rule: SplitRule;
  focus: string | null;
  suggestions: Suggestion[];
  rollFrom: number | null;
  onDate: string;
  onSuggestion: (amount: number) => void;
  onKey: (key: string) => void;
  onRule: (rule: SplitRule) => void;
  onFocus: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  amountRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { p, language } = useCx();
  const family = props.kids.length > 1;
  const manual = family && props.rule === "manual";
  const value = useRef<HTMLSpanElement>(null);
  const one = props.kids[0];

  // The big figure rolls when a suggestion is tapped; typing sets it at once.
  useLayoutEffect(() => {
    const draw = (n: number) => {
      if (value.current) value.current.textContent = n ? n.toLocaleString("en-IN") : "0";
    };
    if (props.rollFrom === null) {
      draw(props.total);
      return;
    }
    return rollNumber(props.rollFrom, props.total, draw);
  }, [props.total, props.rollFrom]);

  const words = props.total ? amountInWords(props.total) : manual ? mc.amountManual : mc.amountEmpty;
  let status: { tone: string; text: Localized | null };
  if (!props.total) status = { tone: "mut", text: fill(mc.upTo, { a: money(props.max) }) };
  else if (!manual && props.total > props.max) status = { tone: "bad", text: fill(mc.overBy, { a: money(props.total - props.max) }) };
  else if (props.total === props.max) status = { tone: "ok", text: family ? mc.clearsYearAll : mc.clearsYear };
  else if (family) status = { tone: "mut", text: null };
  else {
    const walk = walkPayment(one.rows, props.total, { paymentDate: props.onDate, today: props.onDate, waiveLate: !one.takeLate, authoritative: true });
    const left = walk.after.pendingToday + walk.after.dueToday + walk.after.notDueYet;
    const nextRow = orderForSettlement(one.rows).find((r) => {
      const line = walk.lines.find((l) => l.row.id === r.id);
      return r.feesPending > (line?.feesPaid ?? 0) && !isOverdueOn(r, props.onDate);
    });
    status = { tone: "mut", text: nextRow ? fill(mc.leavesNext, { a: money(left), d: dayMonth(nextRow.dueDate) }) : fill(mc.leaves, { a: money(left) }) };
  }

  const keys = family ? ["1", "2", "3", "⌫", "4", "5", "6", "00", "7", "8", "9", "0"] : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

  return (
    <CardShell
      eyebrow={mc.stepAmount}
      title={family ? mc.amountTitleFamily : mc.amountTitle}
      className={family ? "cx-fammode" : undefined}
      foot={
        <>
          <BackButton onClick={props.onBack} />
          <button type="button" className="cx-btn pri" disabled={!props.ok} onClick={props.onNext}>
            <Bi text={mc.nextPayment} />
          </button>
        </>
      }
    >
      <div className="cx-amtbox">
        <div className={`cx-amt${props.total ? "" : " empty"}${props.total && !props.ok ? " bad" : ""}`} ref={amountRef} aria-live="polite">
          <span className="cur">₹</span>
          <span className="v" ref={value} />
          {manual ? null : <span className="caret deskonly" />}
        </div>
        <div className="cx-words">{props.total ? <Bi text={words} /> : <span style={{ color: "var(--sub)" }}>{p(words)}</span>}</div>
      </div>
      <div className="cx-dyn">
        {!manual && props.suggestions.length ? (
          <div className={`cx-chips${family ? " c3" : ""}`}>
            {props.suggestions.map((s) => (
              <button type="button" key={s.key} className={`cx-qc${props.total === s.amount ? " on" : ""}`} onClick={() => props.onSuggestion(s.amount)}>
                <span className="ql">
                  <span className="cx-k deskonly">{s.key}</span>
                  <Bi text={fill(family ? SUGGESTION_TEXT[s.kind].family : SUGGESTION_TEXT[s.kind].one, { n: s.installmentNo ?? "" })} />
                </span>
                <b>{money(s.amount)}</b>
              </button>
            ))}
          </div>
        ) : null}
        {family ? (
          <>
            <div className="cx-seg cx-rule" role="group" aria-label={p(mc.ruleLabel)}>
              {(["oldest", "child", "manual"] as const).map((r) => (
                <button type="button" key={r} className={props.rule === r ? "on" : ""} aria-pressed={props.rule === r} onClick={() => props.onRule(r)}>
                  {p(r === "oldest" ? mc.ruleOldest : r === "child" ? mc.ruleChild : mc.ruleManual)}
                </button>
              ))}
            </div>
            <div className="cx-crows">
              {props.kids.map((c, i) => {
                const amount = props.shares[i] ?? 0;
                const max = childTotals(c, props.onDate).max;
                const over = amount > max;
                const focused = manual && props.focus === c.id;
                return (
                  <button
                    type="button"
                    key={c.id}
                    className={`cx-crow${focused ? " focus" : ""}${over ? " over" : ""}`}
                    tabIndex={manual ? 0 : -1}
                    onClick={() => manual && props.onFocus(c.id)}
                  >
                    <span className="cn">
                      {firstName(c.name)} · {c.classLabel}
                      {focused ? <span className="arrow"> ◂ {p(mc.typing)}</span> : null}
                    </span>
                    <span className="ca">{money(amount)}</span>
                    <span className="cs">{p(over ? fill(mc.onlyDue, { a: money(max) }) : allocText(c.rows, amount, c.takeLate, props.onDate))}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
        {status.text ? <div className={`cx-status ${status.tone}`}><Bi text={status.text} inline /></div> : null}
      </div>
      {family ? null : <YearBar rows={one.rows} pay={props.ok ? props.total : 0} takeLate={one.takeLate} onDate={props.onDate} slim={false} />}
      <div className="cx-pad phoneonly">
        {keys.map((k) => (
          <button type="button" key={k} onClick={() => props.onKey(k)} aria-label={k === "⌫" ? p(mc.deleteKey) : k}>
            {k}
          </button>
        ))}
      </div>
      <div className="cx-hint deskonly" style={{ marginTop: "auto" }} data-lang={language}>
        <span>{p(mc.hintType)}</span>
        {!manual ? (
          <span>
            <span className="cx-k">O</span> <span className="cx-k">N</span> <span className="cx-k">Y</span> <span className="cx-k">L</span> {p(mc.hintSuggestions)}
          </span>
        ) : null}
        {manual ? (
          <span>
            <span className="cx-k">Tab</span> {p(mc.hintNextChild)}
          </span>
        ) : null}
      </div>
    </CardShell>
  );
}
