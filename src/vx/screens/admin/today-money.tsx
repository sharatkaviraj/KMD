"use client";

import { useState } from "react";

import { rupees, rupeesShort } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { dailySeries } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";
import { TD } from "@/vx/screens/admin/today-text";
import { dueColumns, kfmt, knownSpan, moneyChart } from "@/vx/screens/admin/today-logic";
import { PaceBar, PaceWords } from "@/vx/screens/admin/today-pace";
import type { TodayMoneyView } from "@/vx/screens/admin/today";

/*
 * The desk's money section on Today: money taken by day, the year's pace, how
 * families pay and what is still due by class. Only a desk shows it (the phone
 * has its own session card), so Today loads it as a chunk of its own rather
 * than carrying it in the home page's first JavaScript.
 */

const MODE_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--pri)"];

/**
 * Words only this section says. They live here rather than in `TD` so they ride
 * in this chunk and not in the home page's, which every route counts against its
 * first-load budget (D-510).
 */
const DM = {
  avgPill: (v: string): Pair => p(`avg ${v}`, `औसत ${v}`),
  nothingTaken: p("nothing taken", "कुछ जमा नहीं"),
  sunday: p("Sunday", "रविवार"),
  howTheyPaySub: p("Today · hover a slice", "आज · हिस्से पर रुकें"),
  oldBalance: p("Old", "पुराना"),
  total: p("Total", "कुल"),
  nothingPastDue: p("No installment is past its due date yet.", "अभी कोई किस्त अपनी तारीख़ से आगे नहीं गई।"),
  stillToCome: p("Still to come this year", "इस साल अभी आना बाकी"),
  dueByToday: p("Due by today", "आज तक जमा होना था"),
  modesAppear: p("Cash, UPI and cheques show here as the day's receipts come in.", "आज की रसीदें बनते ही नकद, UPI और चेक यहाँ दिखेंगे।"),
};

/** Payment modes by their stored code; an unknown code is shown as stored. */
const MODE_NAMES: Partial<Record<string, Pair>> = TD.modeName;
const modeName = (mode: string): Pair => MODE_NAMES[mode.toLowerCase()] ?? { en: mode };

type Pace = { percent: number; shouldPercent: number; behind: number };

/**
 * One arrangement, sized by the section's own width (`tdm` in today.css), not
 * the window's: the chart beside the year's pace and how they pay, the class
 * table under both; from 900px down the chart takes the whole width with the
 * two small cards side by side under it. Beside the pending table, how they
 * pay used to stretch to the table's height, ~650px of card around one line
 * (desk check, 7 Nov).
 */
export function DeskMoney({ money, pace, today, noHeat }: { money: TodayMoneyView; pace: Pace | null; today: string; noHeat: boolean }) {
  return (
    <div className="tdm">
      <MoneyTaken money={money} today={today} />
      <div className="tdm-side">
        {pace ? <PaceCard money={money} pace={pace} today={today} /> : null}
        <HowTheyPay money={money} />
      </div>
      {noHeat ? null : <PendingHeat money={money} today={today} />}
    </div>
  );
}

function MoneyTaken({ money, today }: { money: TodayMoneyView; today: string }) {
  const { tx } = useVx();
  const [range, setRange] = useState<"14" | "30">("30");
  // Fees sends its latest collection days only: a 30-day chart would draw noughts it was never told.
  const span = knownSpan(today, money.knownFrom, 30);
  const chart = moneyChart(dailySeries(money.days, today, Math.min(Number(range), span)), today);
  return (
    <section className="card" style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 14, animation: "xRise .45s .1s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.moneyTaken)}</h3>
          <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyTakenSub(rupees(chart.average), rupees(chart.best), chart.emptyDays))}</span>
        </div>
        {span >= 30 ? (
          <Seg
            options={[
              { value: "14", label: tx(T.days14) },
              { value: "30", label: tx(T.days30) },
            ]}
            value={range}
            onChange={setRange}
            label={tx(T.moneyTaken)}
            style={{ width: 148 }}
          />
        ) : null}
      </div>
      {/* The chart takes whatever height its row gives the card, never less than 210px. */}
      <div style={{ position: "relative", flex: "1 0 210px", minHeight: 210, marginLeft: 48 }}>
        {chart.grid.map((g) => (
          <span key={g.at}>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${g.at}%`, borderTop: "1px dashed var(--bd)" }} />
            <span className="num" style={{ position: "absolute", left: -48, bottom: `${g.at}%`, transform: "translateY(50%)", fontSize: 11, color: "var(--sub)" }}>{g.label}</span>
          </span>
        ))}
        {chart.average > 0 ? (
          <>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${chart.averageAt}%`, borderTop: "2px dashed var(--warn)", opacity: 0.8, transition: "bottom .5s var(--ease)" }} />
            <span className="pill num" style={{ position: "absolute", right: 0, bottom: `${chart.averageAt}%`, transform: "translateY(-4px)", background: "var(--warns)", color: "var(--warnfg)", transition: "bottom .5s var(--ease)", zIndex: 1 }}>{tx(DM.avgPill(kfmt(chart.average)))}</span>
          </>
        ) : null}
        <div role="list" aria-label={tx(T.moneyTaken)} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "stretch", gap: 3 }}>
          {chart.bars.map((b, i) => {
            const tip = `${b.day} · ${b.amount > 0 ? rupees(b.amount) : b.sunday ? tx(DM.sunday) : tx(DM.nothingTaken)}`;
            return (
              // The last bars' tips open leftwards, so none runs past the card's edge.
              <div key={b.date} role="listitem" aria-label={tip} className={i >= chart.bars.length - 3 ? "td-bar end" : "td-bar"}>
                <span className="tip" style={{ bottom: `calc(${b.height}% + 8px)` }}>{tip}</span>
                <span className="fill" style={{ height: `${b.height}%`, background: b.isToday ? "var(--acc)" : b.amount > 0 ? "var(--pri)" : "var(--s3)", animationDelay: `${i * 18}ms` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div aria-hidden="true" style={{ display: "flex", gap: 3, marginLeft: 48 }}>
        {chart.bars.map((b) => (
          <span key={b.date} className="num" style={{ flex: 1, textAlign: "center", fontSize: 11, color: b.isToday ? "var(--fg)" : "var(--sub)", fontWeight: b.isToday ? 700 : 500, opacity: b.showLabel ? 1 : 0, whiteSpace: "nowrap" }}>
            {b.isToday ? tx(T.today) : b.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function PendingHeat({ money, today }: { money: TodayMoneyView; today: string }) {
  const { tx } = useVx();
  // Only what is already past due: an installment not due yet never joins "pending" (RULES B).
  const cols = dueColumns(money.installments, money.dueDates, money.carryForward, today) ?? money.installments.map((key) => ({ key, label: key, title: key, carry: false }));
  const rows = money.matrix
    .map((row) => ({ label: row.classLabel, cells: cols.map((c) => row.cells[c.key] ?? 0), total: cols.reduce((s, c) => s + (row.cells[c.key] ?? 0), 0) }))
    .filter((row) => row.total > 0);
  const max = Math.max(1, ...rows.flatMap((row) => row.cells));
  return (
    <section className="card tdm-heat" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, animation: "xRise .45s .15s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.pendingByClass)}</h3>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.pendingByClassSub)}</span>
      </div>
      {cols.length === 0 || rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(DM.nothingPastDue)}</p>
      ) : (
        // Each amount keeps room to be read ("₹1.3L", never "₹1.3" cut off); a narrow phone scrolls the table, not the page (smoke run, 20 Oct).
        <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
        <div role="table" aria-label={tx(T.pendingByClass)} style={{ display: "grid", gridTemplateColumns: `minmax(84px, 112px) repeat(${cols.length}, minmax(52px, 1fr)) minmax(56px, 76px)`, gap: 5, alignItems: "center", minWidth: 84 + cols.length * 57 + 61 }}>
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader" />
            {cols.map((c) => (
              <span key={c.key} role="columnheader" className="sech" title={c.title} style={{ textAlign: "center", whiteSpace: "nowrap", padding: "0 2px" }}>{c.carry ? tx(DM.oldBalance) : c.label}</span>
            ))}
            <span role="columnheader" className="sech" style={{ textAlign: "right" }}>{tx(DM.total)}</span>
          </div>
          {rows.map((row, ri) => (
            <div key={row.label} role="row" style={{ display: "contents" }}>
              <span role="rowheader" className="clip" style={{ fontSize: 13, fontWeight: 600 }}>{row.label}</span>
              {row.cells.map((v, ci) => {
                const a = v ? 0.12 + (0.8 * v) / max : 0.04;
                return (
                  <span
                    key={cols[ci].key}
                    role="cell"
                    className="td-cell num"
                    title={`${row.label} · ${cols[ci].title} · ${v ? rupees(v) : "—"}`}
                    style={{ position: "relative", height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, color: a > 0.55 ? "var(--onsolid)" : "var(--fg)", background: `rgba(var(--heat), ${a.toFixed(2)})`, animation: `xFade .5s ease ${(ri * 3 + ci) * 25}ms both` }}
                  >
                    {kfmt(v)}
                  </span>
                );
              })}
              <span role="cell" className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{kfmt(row.total)}</span>
            </div>
          ))}
        </div>
        </div>
      )}
    </section>
  );
}

function HowTheyPay({ money }: { money: TodayMoneyView }) {
  const { tx } = useVx();
  const total = money.modes.reduce((s, m) => s + m.amount, 0);
  const C = 2 * Math.PI * 56;
  const segs = money.modes.map((m, i) => {
    const frac = total > 0 ? m.amount / total : 0;
    const len = frac * C;
    // Where this slice starts: the length of every slice before it.
    const before = total > 0 ? (money.modes.slice(0, i).reduce((s, x) => s + x.amount, 0) / total) * C : 0;
    return { key: m.mode, label: tx(modeName(m.mode)), color: MODE_COLORS[i % MODE_COLORS.length], pct: Math.round(frac * 100), amount: m.amount, dash: `${Math.max(0, len - 2).toFixed(1)} ${C.toFixed(1)}`, off: (-before).toFixed(1) };
  });
  return (
    <section className="card tdm-pay" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, animation: "xRise .45s .2s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.howTheyPay)}</h3>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(DM.howTheyPaySub)}</span>
      </div>
      {total <= 0 ? (
        // An empty ring where the slices will be, the same size as a full one, so the card neither
        // reads as broken nor jumps when the first receipt of the day comes in.
        <div className="tdp-body">
          <div className="tdp-ring">
            <svg viewBox="0 0 150 150" aria-hidden="true">
              <circle cx="75" cy="75" r="56" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 20, strokeDasharray: "5 7" }} />
            </svg>
            <span className="num" aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "var(--mut)" }}>{rupeesShort(0)}</span>
          </div>
          <p style={{ flex: 1, minWidth: 150, margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--mut)" }}>
            <b style={{ display: "block", color: "var(--fg)", fontSize: 14, marginBottom: 2 }}>{tx(T.nothingTakenToday)}</b>
            {tx(DM.modesAppear)}
          </p>
        </div>
      ) : (
        <div className="tdp-body">
          <div className="tdp-ring">
            <svg className="td-donut" viewBox="0 0 150 150" aria-hidden="true" style={{ transform: "rotate(-90deg)", animation: "xSpin .8s var(--ease) both" }}>
              {segs.map((g) => (
                <circle key={g.key} className="seg" cx="75" cy="75" r="56" style={{ fill: "none", stroke: g.color, strokeWidth: 20, strokeDasharray: g.dash, strokeDashoffset: g.off }}>
                  <title>{`${g.label} · ${g.pct}% · ${rupees(g.amount)}`}</title>
                </circle>
              ))}
            </svg>
            <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{rupeesShort(total)}</span>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(T.collected)}</span>
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 8 }}>
            {segs.map((g) => (
              <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: g.color }} />
                <span style={{ flex: 1 }}>{g.label}</span>
                <span className="num" style={{ fontWeight: 700 }}>{g.pct}%</span>
                <span className="num" style={{ color: "var(--mut)", width: 64, textAlign: "right" }}>{kfmt(g.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PaceCard({ money, pace, today }: { money: TodayMoneyView; pace: { percent: number; shouldPercent: number; behind: number }; today: string }) {
  const { tx } = useVx();
  return (
    <section className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, animation: "xRise .45s .2s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.yearPace)}</h3>
        <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.ofTotal(rupeesShort(money.collected), rupeesShort(money.expected)))}</span>
      </div>
      <PaceBar pace={pace} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--mut)" }}>
        <span className="num">{tx(T.pctCollected(pace.percent))}</span>
        <span>{tx(T.shouldBe(pace.shouldPercent))}</span>
      </div>
      <PaceWords pace={pace} today={today} size={12} />
      {/* Two figures at the card's foot, so beside How they pay it ends in numbers, not a gap. */}
      <dl className="tdm-figs">
        <div>
          <dt>{tx(DM.stillToCome)}</dt>
          <dd className="num">{rupeesShort(Math.max(0, money.expected - money.collected))}</dd>
        </div>
        <div>
          <dt>{tx(DM.dueByToday)}</dt>
          <dd className="num">{rupeesShort(money.dueSoFar)}</dd>
        </div>
      </dl>
    </section>
  );
}
