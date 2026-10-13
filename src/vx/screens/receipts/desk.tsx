"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  deskModeOf,
  DESK_MODES,
  filterReceipts,
  groupByDay,
  NO_DESK_FILTERS,
  postedAfterClose,
  summarizeReceipts,
  type DaySpan,
  type DeskFilters,
  type DeskMode,
} from "@/modules/receipts/vx/domain/day-close";
import { clock, rupees } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Chip, Seg } from "@/vx/ui/controls";
import { Banner, Grid, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, StackedBar } from "@/vx/ui/primitives";

import { ClosePanel } from "./close-panel";
import { deskHref } from "./href";
import { AVATAR_TONES, dayGroupLabel, deskDay, deskTime, MIX, MODE_LOOK, nameInitials } from "./look";
import { ReceiptPanel } from "./receipt-panel";
import type { DeskProps, DeskRow } from "./types";
import { MODE_WORD, receiptCount, W } from "./words";

/*
 * Receipts and the day close, drawn as the design's `Fees` module: KPI tiles,
 * "How it came in", the day/mode/staff filters, a grid table on a desk and a
 * card list on a phone, the receipt beside the list, and the close as its own
 * screen. The rows, totals and every action are the real ones.
 */

/** The table's tracks, as the design sets them. */
const TRACKS = "100px 76px minmax(190px, 2fr) 104px minmax(110px, 1fr) 104px 28px";

function initialFilters(i: DeskProps["initial"]): DeskFilters {
  const mode = (DESK_MODES as readonly string[]).includes(i.mode) ? (i.mode as DeskMode) : "all";
  return { mode, staff: i.staff || "all", query: i.query };
}

/** A design KPI tile: 12px label, 22px figure, 12px sub-line. */
function Tile({ label, value, sub, tone, delay }: { label: ReactNode; value: ReactNode; sub: ReactNode; tone?: string; delay: number }) {
  return (
    <div className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0, animationDelay: `${delay}ms` }}>
      <span style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>{label}</span>
      <span className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", color: tone ?? "var(--fg)" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
    </div>
  );
}

/** The search box: 40px in the desk's top bar, a 46px pill on a phone. */
function DeskSearch({ value, onChange, placeholder, label, phone }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; phone?: boolean }) {
  const box: CSSProperties = phone
    ? { position: "relative", height: 46, borderRadius: 23, border: "1px solid var(--bds)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 14px", color: "var(--mut)" }
    : { position: "relative", height: 40, width: 280, borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", color: "var(--mut)" };
  return (
    <label className={phone ? "only-m" : undefined} style={box}>
      <Ic n="search" />
      <span className="sr">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{ flex: 1, minWidth: 0, height: phone ? 40 : 36, border: 0, outline: "none", background: "transparent", fontSize: phone ? 16 : 14, color: "var(--fg)" }}
      />
    </label>
  );
}

/** The design's empty card: a soft circle, a line, a hint and an action. */
export function DeskEmpty({ icon, title, body, action }: { icon: "receipt" | "search"; title: ReactNode; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="card fadein" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ width: 56, height: 56, borderRadius: 28, background: "var(--s2)", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n={icon} size={26} />
      </span>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{body}</span>
      {action}
    </div>
  );
}

export function ReceiptsDesk(props: DeskProps) {
  const { rows, anchor, today, span, view, selected, closeEvent, perms, sessionLabel } = props;
  const { tx } = useVx();
  const router = useRouter();
  const [filters, setFilters] = useState<DeskFilters>(() => initialFilters(props.initial));

  const summary = useMemo(() => summarizeReceipts(rows), [rows]);
  const shown = useMemo(() => filterReceipts(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByDay(shown), [shown]);
  const staffNames = useMemo(() => [...new Set(rows.map((r) => r.receivedBy).filter((s): s is string => Boolean(s)))].sort(), [rows]);
  const late = useMemo(() => postedAfterClose(rows.filter((r) => r.paymentDate === anchor), closeEvent?.createdAt ?? null), [rows, anchor, closeEvent]);
  // Avatar tones follow the day's full list, so a filter does not repaint a child.
  const toneOf = useMemo(() => new Map(rows.map((r, i) => [r.id, AVATAR_TONES[i % AVATAR_TONES.length]])), [rows]);

  const base = { anchor, today, span };
  const isClose = view === "close";
  const spanLabel = span === "today" ? (anchor === today ? tx(W.today) : deskDay(anchor)) : span === "yesterday" ? tx(W.yesterday) : tx(W.last3);
  const closeHref = deskHref(base, { view: "close" });
  const listHref = deskHref(base, {});
  const session = sessionLabel.replace("-", "–");
  const dayBookHref = `/fees/finance-controls/export?date=${anchor}&session=${encodeURIComponent(sessionLabel)}`;
  const kpiLabel = span === "today" ? (anchor === today ? tx(W.collectedToday) : `${tx(W.collected)} · ${deskDay(anchor)}`) : span === "yesterday" ? tx(W.collectedYesterday) : tx(W.last3);
  const query = filters.query;
  const setQuery = (q: string) => setFilters((f) => ({ ...f, query: q }));
  // Rows animate in one after another down the whole table, as in the design.
  const order = useMemo(() => new Map(groups.flatMap((g) => g.receipts).map((r, i) => [r.id, i])), [groups]);

  const list = (
    <section className={`pad${selected ? " hide-m" : ""}`} style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      <Grid cols={4}>
        <Tile label={kpiLabel} value={rupees(summary.net)} sub={tx(receiptCount(summary.count))} delay={0} />
        <Tile label={tx(W.cash)} value={rupees(summary.byMode.cash.amount)} sub={`${tx(receiptCount(summary.byMode.cash.count))} · ${tx(W.toCount)}`} delay={28} />
        <Tile label={tx(W.upi)} value={rupees(summary.byMode.upi.amount)} sub={tx(receiptCount(summary.byMode.upi.count))} delay={56} />
        <Tile label={tx(W.reversed)} value={summary.reversedCount} sub={tx(W.reversedSub)} tone={summary.reversedCount ? "var(--bad)" : undefined} delay={84} />
      </Grid>

      <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{tx(W.howItCameIn)}</span>
          <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{rupees(summary.net)} {tx(W.net)}</span>
        </div>
        <StackedBar parts={MIX.map((m) => ({ label: tx(MODE_WORD[m.mode]), value: summary.byMode[m.mode].amount, color: m.color }))} />
      </div>

      {closeEvent ? (
        <Banner tone="ok" action={<Btn variant="ghost" href={closeHref}>{tx(W.seeClose)}</Btn>}>
          {tx(W.dayClosed)} · {deskDay(anchor)} · {clock(closeEvent.createdAt)}
          {closeEvent.actorName ? ` · ${closeEvent.actorName}` : ""}
        </Banner>
      ) : null}
      {late.length > 0 ? (
        <Banner tone="warn">
          {late.length} {tx(W.receipts).toLowerCase()} {tx(W.afterClose)}: {late.map((r) => r.receiptNumber).join(", ")}
        </Banner>
      ) : null}
      {props.truncated ? <Banner tone="info">{tx(W.truncated)}</Banner> : null}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Seg<DaySpan>
          label={tx(W.title)}
          value={span}
          onChange={(v) => router.push(deskHref({ ...base, span: v }, {}))}
          style={{ width: 300, maxWidth: "100%" }}
          options={[
            { value: "today", label: anchor === today ? tx(W.today) : deskDay(anchor) },
            { value: "yesterday", label: tx(W.yesterday) },
            { value: "3d", label: tx(W.last3) },
          ]}
        />
        <div className="hs" role="group" aria-label={tx(W.mode)} style={{ display: "flex", gap: 6, flex: 1, minWidth: 0 }}>
          <Chip on={filters.mode === "all"} onClick={() => setFilters((f) => ({ ...f, mode: "all" }))}>{tx(W.allModes)}</Chip>
          {DESK_MODES.map((m) => (
            <Chip key={m} on={filters.mode === m} onClick={() => setFilters((f) => ({ ...f, mode: f.mode === m ? "all" : m }))}>{tx(MODE_WORD[m])}</Chip>
          ))}
          {staffNames.length > 0 ? (
            <>
              <span aria-hidden="true" style={{ flex: "none", width: 1, background: "var(--bd)", margin: "4px 2px" }} />
              <Chip on={filters.staff === "all"} onClick={() => setFilters((f) => ({ ...f, staff: "all" }))}>{tx(W.everyone)}</Chip>
              {staffNames.map((s) => (
                <Chip key={s} on={filters.staff === s} onClick={() => setFilters((f) => ({ ...f, staff: f.staff === s ? "all" : s }))}>{s}</Chip>
              ))}
            </>
          ) : null}
        </div>
      </div>

      <DeskSearch phone value={query} onChange={setQuery} placeholder={tx(W.search)} label={tx(W.searchLabel)} />

      {rows.length === 0 ? (
        <DeskEmpty
          icon="receipt"
          title={tx(W.emptyDay)}
          body={tx(W.emptyDayBody)}
          action={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {props.lastDate ? <Btn variant="sec" icon="history" href={deskHref({ ...base, anchor: props.lastDate, span: "today" }, {})}>{tx(W.lastDay)} · {deskDay(props.lastDate)}</Btn> : null}
              {perms.collect ? <Btn variant="pri" icon="rupee" href="/payments">{tx(W.takeFee)}</Btn> : null}
            </div>
          }
        />
      ) : shown.length === 0 ? (
        <DeskEmpty icon="receipt" title={tx(W.noMatch)} body={tx(W.noMatchBody)} action={<Btn variant="sec" onClick={() => setFilters(NO_DESK_FILTERS)}>{tx(W.clearFilters)}</Btn>} />
      ) : (
        <>
          {/* desk: one grid table, the days as bands inside it */}
          <div className="only-d card" role="table" aria-label={tx(W.title)} style={{ overflow: "hidden" }}>
            <div role="row" style={{ display: "grid", gridTemplateColumns: TRACKS, gap: 8, alignItems: "center", height: 42, padding: "0 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
              <span role="columnheader" className="sech">{tx(W.receipt)}</span>
              <span role="columnheader" className="sech">{tx(W.time)}</span>
              <span role="columnheader" className="sech">{tx(W.student)}</span>
              <span role="columnheader" className="sech">{tx(W.mode)}</span>
              <span role="columnheader" className="sech">{tx(W.takenBy)}</span>
              <span role="columnheader" className="sech" style={{ textAlign: "right" }}>{tx(W.amount)}</span>
              <span />
            </div>
            {groups.map((g) => (
              <div key={g.date} role="rowgroup">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 6px", background: "var(--card)", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(dayGroupLabel(g.date, today))}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{rupees(g.net)} · {tx(receiptCount(g.receipts.length))}</span>
                </div>
                {g.receipts.map((r) => (
                  <DeskTableRow key={r.id} r={r} delay={Math.min(order.get(r.id) ?? 0, 14) * 28} tone={toneOf.get(r.id) ?? AVATAR_TONES[0]} sel={r.receiptNumber === selected?.receiptNumber} href={deskHref(base, {}, `/receipts/${encodeURIComponent(r.receiptNumber)}`)} />
                ))}
              </div>
            ))}
          </div>

          {/* phone: a card per day */}
          <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {groups.map((g) => (
              <div key={g.date} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0 4px" }}>
                  <span className="sech">{tx(dayGroupLabel(g.date, today))}</span>
                  <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{rupees(g.net)} · {tx(receiptCount(g.receipts.length))}</span>
                </div>
                <div className="card" style={{ overflow: "hidden" }}>
                  {g.receipts.map((r, i) => (
                    <DeskCardRow key={r.id} r={r} first={i === 0} delay={Math.min(order.get(r.id) ?? 0, 14) * 28} href={deskHref(base, {}, `/receipts/${encodeURIComponent(r.receiptNumber)}`)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );

  const closeButton = closeEvent ? tx(W.dayClosed) : tx(W.closeDay);

  return (
    <VxPage>
      <TopBar
        crumb={isClose ? `${tx(W.money)} · ${deskDay(anchor)}` : `${tx(W.crumb)} ${session}`}
        title={isClose ? tx(W.closeTitle) : tx(W.title)}
        mTitle={isClose ? tx(W.closeTitle) : selected ? selected.receiptNumber : tx(W.title)}
        mSub={isClose ? tx(W.closeSub) : selected ? selected.studentFullName : `${spanLabel} · ${rupees(summary.net)}`}
        mBack={isClose || selected ? listHref : "/menu"}
        actions={
          isClose ? (
            <Btn variant="ghost" icon="chevLeft" href={listHref}>{tx(W.back)}</Btn>
          ) : (
            <>
              <DeskSearch value={query} onChange={setQuery} placeholder={tx(W.search)} label={tx(W.searchLabel)} />
              {perms.dayBook ? <Btn variant="sec" icon="download" href={dayBookHref} target="_blank">{tx(W.export)}</Btn> : null}
              {perms.accounts ? <Btn variant="pri" icon="lock" href={closeHref}>{closeButton}</Btn> : null}
            </>
          )
        }
        mAction={
          !isClose && perms.accounts ? (
            <Btn variant="soft" href={closeHref} style={{ height: 40, padding: "0 12px", fontSize: 13 }}>
              <Ic n="lock" size={16} />
              {closeEvent ? tx(W.dayClosed) : tx(W.closeDayShort)}
            </Btn>
          ) : null
        }
      />
      <main>
        {isClose ? (
          <ClosePanel {...props} />
        ) : (
          <div className="stack" style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1fr) 460px" : "minmax(0, 1fr)", alignItems: "start", minHeight: "100%" }}>
            {list}
            {selected ? (
              <aside className="unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", animation: "xPush .36s var(--ease) both" }}>
                <ReceiptPanel {...props} receipt={selected} />
              </aside>
            ) : null}
          </div>
        )}
      </main>
    </VxPage>
  );
}

function DeskTableRow({ r, delay, tone, sel, href }: { r: DeskRow; delay: number; tone: [string, string]; sel: boolean; href: string }) {
  const { tx } = useVx();
  const mode = deskModeOf(r.paymentMode);
  const look = MODE_LOOK[mode];
  const strike = r.isReversed ? "line-through" : "none";
  return (
    <Link
      href={href}
      role="row"
      className={`tap row${sel ? " sel" : ""}`}
      aria-current={sel ? "true" : undefined}
      style={{ width: "100%", display: "grid", gridTemplateColumns: TRACKS, gap: 8, alignItems: "center", minHeight: 56, padding: "0 16px", borderTop: "1px solid var(--bd)", color: "var(--fg)", opacity: r.isReversed ? 0.55 : 1, animation: `xIn .32s var(--ease) ${delay}ms both` }}
    >
      <span role="cell" className="num" style={{ fontSize: 13, fontWeight: 700, textDecoration: strike }}>{r.receiptNumber}</span>
      <span role="cell" className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{deskTime(r.createdAt)}</span>
      <span role="cell" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span aria-hidden="true" style={{ flex: "none", width: 32, height: 32, borderRadius: 16, background: tone[0], color: tone[1], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{nameInitials(r.studentFullName)}</span>
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{r.studentFullName}</span>
          <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{r.classLabel}</span>
        </span>
      </span>
      <span role="cell">
        <span className="pill" style={{ background: r.isReversed ? "var(--bads)" : look.bg, color: r.isReversed ? "var(--bad)" : look.fg }}>{r.isReversed ? tx(W.reversed) : tx(MODE_WORD[mode])}</span>
      </span>
      <span role="cell" className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{r.receivedBy ?? "—"}</span>
      <span role="cell" className="num" style={{ fontSize: 14, fontWeight: 700, textAlign: "right", textDecoration: strike }}>{rupees(r.totalAmount)}</span>
      <Ic n="chevRight" style={{ color: "var(--sub)" }} />
    </Link>
  );
}

function DeskCardRow({ r, first, delay, href }: { r: DeskRow; first: boolean; delay: number; href: string }) {
  const { tx } = useVx();
  const mode = deskModeOf(r.paymentMode);
  const look = MODE_LOOK[mode];
  return (
    <Link
      href={href}
      className="tap row"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: first ? 0 : "1px solid var(--bd)", color: "var(--fg)", opacity: r.isReversed ? 0.55 : 1, animation: `xIn .32s var(--ease) ${delay}ms both` }}
    >
      <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: look.bg, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Ic n={look.icon} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{r.studentFullName}</span>
        <span className="num clip" style={{ fontSize: 12, color: "var(--mut)" }}>{r.receiptNumber} · {r.classLabel} · {deskTime(r.createdAt)}</span>
      </span>
      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <span className="num" style={{ fontSize: 15, fontWeight: 700, textDecoration: r.isReversed ? "line-through" : "none" }}>{rupees(r.totalAmount)}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: r.isReversed ? "var(--bad)" : "var(--mut)" }}>{r.isReversed ? tx(W.reversed) : tx(MODE_WORD[mode])}</span>
      </span>
    </Link>
  );
}

