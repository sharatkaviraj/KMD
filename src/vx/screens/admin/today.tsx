"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { periodNumber } from "@/modules/timetable/domain/periods";
import { rupees, rupeesShort, shortDay } from "@/vx/format";
import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { Grid } from "@/vx/ui/page";
import { Card, CardHead, IconTile, Kpi, Pill } from "@/vx/ui/primitives";
import { dailySeries, vsAverage, yearPace } from "@/vx/screens/admin/logic";
import { foldedKeys, type CoverException, type ScheduledActivity, type ScheduledPeriod, type ScheduleView, type ScheduledTeacher } from "@/vx/screens/admin/schedule";
import { T } from "@/vx/screens/admin/text";
import { TD } from "@/vx/screens/admin/today-text";
import { catchUp, dueColumns, kfmt, moneyChart, weekBars } from "@/vx/screens/admin/today-logic";
import type { InboxItem, TimelineItem } from "@/vx/screens/admin/types";

export type TodayMoneyView = {
  today: number;
  receiptsToday: number;
  days: { date: string; amount: number }[];
  modes: { mode: string; amount: number; receipts: number }[];
  matrix: { classLabel: string; cells: Record<string, number>; total: number }[];
  installments: string[];
  expected: number;
  collected: number;
  dueSoFar: number;
  followUps: number;
  /** Due date of each installment label; without it the heat table cannot tell what is past due. */
  dueDates?: Record<string, string | null>;
  /** Labels that are a previous session's balance. */
  carryForward?: string[];
};

/** The "+ New" menu's tile colours (`QUICK_ACTIONS` in `vx/nav.ts`). */
export type QuickTone = "pri" | "acc" | "info" | "ok" | "warn" | "plain";

export type TodayProps = {
  firstName: string;
  greeting: Pair;
  dayLine: string;
  status: Pair | null;
  today: string;
  money: TodayMoneyView | null;
  moneyFailed: boolean;
  attendance: { marked: number; total: number; percent: number | null; schoolOpen: boolean } | null;
  staffAway: number | null;
  cover: { needed: number; arranged: number } | null;
  inbox: InboxItem[] | null;
  timeline: TimelineItem[];
  /** Who is scheduled to teach now and next; null when this reader has no timetable. */
  schedule: ScheduleView | null;
  scheduleFailed: boolean;
  exceptions: { notMarked: string[] | null; cover: CoverException[] | null };
  /** Notes needing action, school-wide; null for a reader without the notes board. */
  support: { needsAction: number; due: number } | null;
  actions: { key: string; label: Pair; icon: IconName; href: string; tone?: QuickTone }[];
  /** Which screens behind the tiles this reader may open; a tile they cannot open is not a link. */
  links: { collect: boolean; attendance: boolean; substitutions: boolean; review: boolean; timetable: boolean };
  unavailable: boolean;
  /** The phone hero's brand line ("Admin · Session 2026–27"). */
  roleLine?: Pair;
  /** The reader's initials and where their avatar leads, for the phone hero. */
  me?: { initials: string; href: string };
  /** Present share of each school day before today this week; null when it could not be read. */
  week?: { day: string; percent: number | null }[] | null;
  /** Families who promised on a call to pay today; null when unknown. Money readers only. */
  promisedToday?: number | null;
};

const MODE_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--pri)"];

/** Payment modes by their stored code; an unknown code is shown as stored. */
const MODE_NAMES: Partial<Record<string, Pair>> = TD.modeName;
const modeName = (mode: string): Pair => MODE_NAMES[mode.toLowerCase()] ?? { en: mode };

/** The design's tile colours by kind (`typeMeta`, and the correction's pencil). */
const KIND_LOOK: Record<InboxItem["kind"], { icon: IconName; bg: string; fg: string }> = {
  not_marked: { icon: "calCheck", bg: "var(--warns)", fg: "var(--warnfg)" },
  cover: { icon: "swap", bg: "var(--infos)", fg: "var(--info)" },
  submission: { icon: "edit", bg: "var(--warns)", fg: "var(--warnfg)" },
  confirmations: { icon: "ticks", bg: "var(--oks)", fg: "var(--ok)" },
  refund: { icon: "rupee", bg: "var(--accs)", fg: "var(--accfg)" },
  job: { icon: "alert", bg: "var(--bads)", fg: "var(--bad)" },
};

/**
 * The button on each Needs-you row. It opens the item in the inbox, where the
 * decision is taken and held for Undo (UI-21); nothing is decided from Today.
 */
const ACTION_OF: Partial<Record<InboxItem["kind"], Pair>> = {
  not_marked: T.remind,
  cover: { en: "Assign", hi: "दें" },
  submission: T.review,
  confirmations: T.accept,
  refund: T.review,
};

const QUICK_LOOK: Record<QuickTone, { bg: string; fg: string }> = {
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  plain: { bg: "var(--s3)", fg: "var(--fg)" },
};

/** The design's light teal on the navy hero; the same in both themes, as drawn. */
const HERO_TEAL = "#81DAE4";
const HERO_INK = "#082F49";

/*
 * Layout rules the inline styles cannot say: the two-column desk becomes one
 * column under 985px of page (the design's 1060px window less its 76px icon
 * sidebar), the chart's hover tips, and the donut and heat cells' hover.
 */
const CSS = `
.vx .td-grid{display:grid;grid-template-columns:minmax(0,1fr) 356px;gap:24px;padding:24px 28px 40px;align-items:start}
.vx .td-two{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px}
@container vx (max-width:984px){.vx .td-grid,.vx .td-two{grid-template-columns:minmax(0,1fr)}}
@container vx (max-width:899px){.vx .td-grid{padding:24px 18px 8px;gap:16px}}
.vx .td-bar{position:relative;flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center}
.vx .td-bar .fill{width:70%;border-radius:6px 6px 3px 3px;transform-origin:bottom;transition:height .55s var(--ease),filter .15s ease;animation:xGrowY .7s var(--ease) both}
.vx .td-bar:hover .fill{filter:brightness(1.3)}
.vx .td-bar .tip{position:absolute;left:50%;transform:translate(-50%,6px);opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;background:var(--tbg);color:var(--tfg);font-size:12px;font-weight:600;padding:6px 9px;border-radius:9px;white-space:nowrap;z-index:3;box-shadow:var(--sh)}
.vx .td-bar:hover .tip{opacity:1;transform:translate(-50%,0)}
.vx .td-bar.end .tip{left:auto;right:0;transform:translate(0,6px)}
.vx .td-bar.end:hover .tip{transform:none}
.vx .td-donut .seg{transition:stroke-width .2s var(--ease),opacity .2s ease}
.vx .td-donut:hover .seg{opacity:.4}
.vx .td-donut .seg:hover{opacity:1;stroke-width:24}
.vx .td-cell{transition:transform .15s var(--ease)}
.vx .td-cell:hover{transform:scale(1.07);z-index:2}
.vx .td-hero-card{min-width:0;overflow:hidden}
@container vx (max-width:359px){.vx .td-ring svg{width:40px;height:40px}}
`;

export function TodayScreen(props: TodayProps) {
  const { tx } = useVx();
  const { money, attendance, inbox } = props;
  const avg = money ? vsAverage(dailySeries(money.days, props.today, 30), props.today) : null;
  const pace = money && money.expected > 0 ? yearPace({ expected: money.expected, collected: money.collected, dueSoFar: money.dueSoFar }) : null;
  const awaiting = inbox ? inbox.length : 0;
  const dataChanges = inbox
    ? inbox.reduce((n, item) => n + (item.kind === "submission" || item.kind === "confirmations" ? (item.submissionIds?.length ?? 1) : 0), 0)
    : 0;
  const greeting = `${tx(props.greeting)}, ${props.firstName}`;
  const statusText = props.status ? ` · ${tx(props.status)}` : "";

  /* ------------------------------------------- after the design: later cards */

  const scheduleCard =
    props.schedule || props.scheduleFailed ? (
      <Card>
        <CardHead
          title={tx(TD.scheduledNow)}
          sub={<span className="only-d">{tx(TD.scheduledSub)}</span>}
          action={
            props.links.timetable ? (
              <Link href="/timetable" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
                {tx(TD.fullDay)}
              </Link>
            ) : undefined
          }
        />
        <div style={{ marginTop: 12 }}>{props.schedule ? <ScheduleBody view={props.schedule} /> : <Quiet>{tx(T.couldNotRead)}</Quiet>}</div>
        {/* On a phone the "not a record of teaching" line moves under the list, small. */}
        {props.schedule ? <p className="only-m" style={{ margin: "10px 0 0", fontSize: 12, color: "var(--mut)" }}>{tx(TD.scheduledSub)}</p> : null}
      </Card>
    ) : null;

  const notMarked = props.exceptions.notMarked ?? [];
  const coverRows = props.exceptions.cover ?? [];
  const exceptionsCard = (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 10px" }}>
        <CardHead
          title={tx(TD.exceptions)}
          action={
            props.links.substitutions && coverRows.length > 0 ? (
              <Link href="/substitutions" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(TD.arrangeCover)}</Link>
            ) : props.links.attendance && notMarked.length > 0 ? (
              <Link href="/attendance?f=pending" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(TD.openBoard)}</Link>
            ) : undefined
          }
        />
      </div>
      {notMarked.length === 0 && coverRows.length === 0 ? (
        <p style={{ margin: 0, padding: "0 18px 16px", color: "var(--mut)", fontSize: 14 }}>
          {attendance && !attendance.schoolOpen ? tx(T.schoolClosed) : tx(TD.noExceptions)}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {notMarked.length > 0 ? (
            <ExceptionRow
              icon="calCheck"
              tone="warn"
              href={props.links.attendance ? "/attendance?f=pending" : null}
              title={tx(T.notMarkedYet(notMarked.length))}
              sub={notMarked.join(", ")}
              pill={<Pill tone="warn">{tx(TD.notMarked)}</Pill>}
            />
          ) : null}
          {coverRows.map((row) => (
            <ExceptionRow
              key={`${row.period}-${row.classes}-${row.subject}-${row.away}`}
              icon="swap"
              tone={row.state === "needed" ? "warn" : "info"}
              href={props.links.substitutions ? "/substitutions" : null}
              title={`${row.time ? `${row.time} · ` : ""}${tx(TD.coverLine(periodNumber(row.period), row.classes, row.subject))}`}
              sub={tx(TD.awayLine(row.away))}
              pill={
                row.state === "needed" ? <Pill tone="warn">{tx(T.needsSubstitute)}</Pill> : <Pill tone="ok">{tx(T.coveredBy(row.by ?? "—"))}</Pill>
              }
            />
          ))}
        </ul>
      )}
    </Card>
  );

  // Student support and approvals: counts the design does not draw, kept after its sections.
  const laterTiles =
    props.support || (inbox && props.links.review) ? (
      <Grid cols={2}>
        {props.support ? (
          <Kpi
            label={tx(TD.support)}
            value={props.support.needsAction}
            href="/notes"
            icon="note"
            tone={props.support.needsAction > 0 ? "var(--warnfg)" : undefined}
            sub={props.support.needsAction > 0 ? tx(TD.followUpsDue(props.support.due)) : tx(TD.nothingNeedsAction)}
          />
        ) : null}
        {inbox && props.links.review ? (
          <Kpi
            label={tx(TD.approvals)}
            value={dataChanges}
            href="/collection/review"
            icon="clipboard"
            sub={dataChanges > 0 ? tx(TD.dataChanges(dataChanges)) : tx(TD.noDataChanges)}
          />
        ) : null}
      </Grid>
    ) : null;

  const moneyNote = money ? null : props.moneyFailed ? (
    <Card><p style={{ margin: 0, color: "var(--mut)" }}>{tx(TD.feesUnavailable)}</p></Card>
  ) : (
    <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyHidden)}</p>
  );

  /* ------------------------------------------------------------ the frames */

  return (
    <>
      <style href="vx-today" precedence="default">{CSS}</style>
      <DeskTopBar crumb={props.dayLine} actions={props.actions} />
      <div className="vx-pmain">
        {props.unavailable ? (
          <div role="status" style={{ margin: "12px 18px 0", fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{tx(T.couldNotRead)}</div>
        ) : null}

        {/* F01 / F14 — the phone, as drawn: hero, Needs you, quick actions, the day, this session.
            The phone frame sets its text at 1.4, a touch under the kit's 1.45. */}
        <div className="only-m" style={{ lineHeight: 1.4 }}>
          <PhoneHero {...props} hello={greeting} statusText={statusText} />
          <PhoneNeeds inbox={inbox} />
          <PhoneQuick actions={props.actions} />
          <section style={{ padding: "26px 18px 0", display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{tx(T.todayAtSchool)}</h2>
            <div className="card" style={{ padding: "6px 16px" }}>
              <Timeline items={props.timeline} closed={attendance !== null && !attendance.schoolOpen} phone />
            </div>
          </section>
          <PhoneSession money={money} pace={pace} today={props.today} attendance={attendance} week={props.week ?? null} linkAttendance={props.links.attendance} />
        </div>

        {/* Desktop, D08, D09 — greeting, KPI row, money; the rail with Needs you, the day, the year. */}
        <div className="td-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
            <div className="only-d" style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mut)" }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--acc)", animation: "xPulse 2.2s infinite" }} />
                    {props.dayLine}
                    {statusText}
                  </span>
                  <h2 className="serif" style={{ margin: 0, fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>{greeting}</h2>
                </div>
                {money ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Link href="/reports" className="tap btn sec"><Ic n="receipt" />{tx(T.dayReport)}</Link>
                    {props.links.collect ? <Link href="/payments" className="tap btn pri"><Ic n="rupee" />{tx(T.paymentDesk)}</Link> : null}
                  </div>
                ) : null}
              </div>
              <DeskKpis {...props} avgDelta={avg?.deltaPct ?? null} />
              {money ? (
                <>
                  <MoneyTaken money={money} today={props.today} />
                  <div className="td-two">
                    <PendingHeat money={money} today={props.today} />
                    <HowTheyPay money={money} />
                  </div>
                </>
              ) : null}
            </div>
            {scheduleCard}
            {exceptionsCard}
          </div>
          <aside style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            <div className="only-d" style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              {inbox ? <RailNeeds inbox={inbox} awaiting={awaiting} /> : null}
              <section className="card" style={{ padding: "14px 18px 8px", animation: "xRise .45s .15s var(--ease) both" }}>
                <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>{tx(T.todayAtSchool)}</h3>
                <Timeline items={props.timeline} closed={attendance !== null && !attendance.schoolOpen} />
              </section>
              {money && pace ? <PaceCard money={money} pace={pace} today={props.today} /> : null}
            </div>
            {laterTiles}
            {moneyNote}
          </aside>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ top bar (desk) */

/**
 * The glass top bar on a desk (Desktop.dc.html header): crumb and serif title,
 * the search field that opens Ctrl K, and "+ New". A phone has the hero instead.
 */
function DeskTopBar({ crumb, actions }: { crumb: string; actions: TodayProps["actions"] }) {
  const { tx } = useVx();
  return (
    <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 12, padding: "0 24px", borderBottom: "1px solid var(--bd)" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{crumb}</span>
        <h1 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{tx(T.today)}</h1>
      </div>
      <button
        type="button"
        className="tap"
        aria-label={tx(TD.searchEverything)}
        onClick={() => window.dispatchEvent(new Event("vx:search"))}
        style={{ height: 40, width: 320, maxWidth: "34vw", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", color: "var(--mut)", display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 12px", fontSize: 14 }}
      >
        <Ic n="search" />
        <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden" }}>{tx(TD.searchPlaceholder)}</span>
        <span className="k">Ctrl K</span>
      </button>
      {actions.length ? <NewMenu actions={actions} /> : null}
    </header>
  );
}

function NewMenu({ actions }: { actions: TodayProps["actions"] }) {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="tap btn pri" aria-expanded={open} aria-controls={menuId} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <Ic n="plus" style={{ transform: `rotate(${open ? 45 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
        {tx(TD.newMenu)}
      </button>
      {open ? (
        <div id={menuId} role="menu" style={{ position: "absolute", right: 0, top: 48, width: 260, zIndex: 30, padding: 6, borderRadius: 16, background: "var(--card)", border: "1px solid var(--bd)", boxShadow: "var(--shh)", transformOrigin: "top right", animation: "xMenu .22s var(--ease) both" }}>
          {actions.map((a, i) => {
            const look = QUICK_LOOK[a.tone ?? "acc"];
            const sub = TD.quickSub[a.key];
            return (
              <Link
                key={a.key}
                href={a.href}
                role="menuitem"
                className="tap ghost"
                onClick={() => setOpen(false)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, color: "var(--fg)", animation: `xRise .3s var(--ease) ${i * 35}ms both` }}
              >
                <span aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: 10, background: look.bg, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={a.icon} />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(a.label)}</span>
                  {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(sub)}</span> : null}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- phone */

/** "14 receipts · UPI 9 · Cash 5", the rest as "Other", as the design writes it. */
function receiptsLine(money: TodayMoneyView, tx: (pair: Pair) => string): string {
  const of = (mode: string) => money.modes.filter((m) => m.mode.toLowerCase() === mode).reduce((n, m) => n + m.receipts, 0);
  const upi = of("upi");
  const cash = of("cash");
  const other = money.modes.reduce((n, m) => n + m.receipts, 0) - upi - cash;
  const parts = [tx(TD.receiptsLine(money.receiptsToday))];
  if (upi) parts.push(`${tx(TD.modeName.upi)} ${upi}`);
  if (cash) parts.push(`${tx(TD.modeName.cash)} ${cash}`);
  if (other > 0) parts.push(`${tx(TD.otherModes)} ${other}`);
  return parts.join(" · ");
}

/** The week's takings adding up day by day, ending with today: the hero and KPI sparkline. */
function weekRunning(money: TodayMoneyView, today: string): number[] {
  let sum = 0;
  return dailySeries(money.days, today, 7).map((p) => (sum += p.amount));
}

function Spark({ values, w, h, color, stroke, dot, end }: { values: number[]; w: number; h: number; color: string; stroke: number; dot: number; end: [number, number] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const [xEnd, yTop] = end;
  const yBottom = h - 2;
  const pts = values.map((v, i) => [2 + (i * (xEnd - 2)) / (values.length - 1), yBottom - ((v - min) / span) * (yBottom - yTop)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: "0 1 auto", maxWidth: "45%", overflow: "visible" }}>
      <polyline
        points={pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}
        pathLength={1}
        style={{ fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", strokeDasharray: 1, ["--len" as string]: 1, animation: "xDraw 1.2s var(--ease) both" }}
      />
      <circle cx={last[0]} cy={last[1]} r={dot} style={{ fill: color, animation: "xPopIn .4s 1s var(--spring) both" }} />
    </svg>
  );
}

/** A ring drawn as the design draws it: radius and stroke given, not derived. */
function DrawnRing({ size, r, stroke, value, max, tone, track }: { size: number; r: number; stroke: number; value: number; max: number; tone: string; track: string }) {
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: "none", transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} style={{ fill: "none", stroke: track, strokeWidth: stroke }} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        style={{ fill: "none", stroke: tone, strokeWidth: stroke, strokeLinecap: "round", strokeDasharray: c, strokeDashoffset: c * (1 - frac), ["--len" as string]: c, animation: "xDraw 1s var(--ease) both" }}
      />
    </svg>
  );
}

function Dashes({ needed, arranged, on, off, width }: { needed: number; arranged: number; on: string; off: string; width: number }) {
  return (
    <span aria-hidden="true" style={{ display: "flex", gap: 5, minWidth: 0 }}>
      {Array.from({ length: Math.min(needed, 8) }, (_, i) => (
        <span key={i} style={{ flex: `0 1 ${width}px`, minWidth: 6, height: 6, borderRadius: 3, background: i < arranged ? on : off, transition: "background-color .4s ease" }} />
      ))}
    </span>
  );
}

/** Wraps a tile in a link only when the reader may open the screen behind it. */
function TileLink({ href, className, style, children }: { href: string | null; className: string; style: CSSProperties; children: ReactNode }) {
  if (href) {
    return (
      <Link href={href} className={`tap ${className}`} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}

function PhoneHero(props: TodayProps & { hello: string; statusText: string }) {
  const { tx } = useVx();
  const { money, attendance, cover } = props;
  const heroCard: CSSProperties = { border: "1px solid var(--navb)", background: "var(--navs)", color: "var(--navfg)", borderRadius: 20 };
  const label: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", fontSize: 12, color: "var(--navm)" };
  // The design draws these tiles as buttons, which set their text at the browser's "normal" leading.
  const tileText: CSSProperties = { lineHeight: "normal" };
  return (
    <section style={{ background: "var(--nav)", color: "var(--navfg)", padding: "14px 18px 20px", borderRadius: "0 0 30px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span className="serif" aria-hidden="true" style={{ flex: "none", width: 38, height: 38, borderRadius: 12, background: "#F7F6F3", color: HERO_INK, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>VP</span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>VPPS One</span>
            {props.roleLine ? <span className="clip" style={{ fontSize: 12, color: "var(--navm)" }}>{tx(props.roleLine)}</span> : null}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "none" }}>
          <button
            type="button"
            className="tap"
            aria-label={tx(TD.searchEverything)}
            onClick={() => window.dispatchEvent(new Event("vx:search"))}
            style={{ width: 44, height: 44, borderRadius: 22, border: "1px solid var(--navb)", background: "var(--navs)", color: "var(--navfg)", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Ic n="search" />
          </button>
          {props.me ? (
            <Link href={props.me.href} className="tap" aria-label={tx(TD.account)} style={{ width: 44, height: 44, borderRadius: 22, background: HERO_TEAL, color: HERO_INK, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {props.me.initials}
            </Link>
          ) : null}
        </div>
      </div>
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--navm)" }}>
          <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: HERO_TEAL, animation: "xPulse 2.2s infinite" }} />
          {shortDay(props.today)}
          {props.statusText}
        </span>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600, lineHeight: 1.12, color: "var(--navfg)" }}>{props.hello}</h1>
      </div>
      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {money ? (
          <div className="td-hero-card" style={{ ...heroCard, gridColumn: "1 / -1", padding: "14px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: "var(--navm)" }}>{tx(TD.feesCollectedToday)}</span>
              <span className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{rupees(money.today)}</span>
              <span style={{ fontSize: 12, color: "var(--navm)" }}>{receiptsLine(money, tx)}</span>
            </span>
            <Spark values={weekRunning(money, props.today)} w={128} h={54} color={HERO_TEAL} stroke={2.5} dot={4.5} end={[124, 6]} />
          </div>
        ) : props.moneyFailed ? (
          <div className="td-hero-card" style={{ ...heroCard, gridColumn: "1 / -1", padding: "14px 16px", fontSize: 13, color: "var(--navm)" }}>{tx(TD.feesUnavailable)}</div>
        ) : null}
        {attendance ? (
          <TileLink href={props.links.attendance ? "/attendance" : null} className="td-hero-card" style={{ ...heroCard, ...tileText, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={label}>
              {tx(T.attendance)}
              {props.links.attendance ? <Ic n="chevRight" size={16} /> : null}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="td-ring" style={{ display: "flex", flex: "none" }}>
                <DrawnRing size={54} r={22} stroke={7} value={attendance.marked} max={Math.max(1, attendance.total)} tone={HERO_TEAL} track="var(--navb)" />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{attendance.marked}/{attendance.total}</span>
                <span style={{ fontSize: 12, color: "var(--navm)" }}>
                  {attendance.schoolOpen ? `${tx(T.classesMarked)} · ${tx(T.presentPct(attendance.percent))}` : tx(T.schoolClosed)}
                </span>
              </span>
            </span>
          </TileLink>
        ) : null}
        {props.staffAway !== null ? (
          <TileLink href={props.links.substitutions ? "/substitutions" : null} className="td-hero-card" style={{ ...heroCard, ...tileText, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={label}>
              {tx(T.teachersOnLeave)}
              {props.links.substitutions ? <Ic n="chevRight" size={16} /> : null}
            </span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{props.staffAway}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cover && cover.needed > 0 ? <Dashes needed={cover.needed} arranged={cover.arranged} on={HERO_TEAL} off="var(--navb)" width={18} /> : null}
              <span style={{ fontSize: 12, color: "var(--navm)" }}>{cover && cover.needed > 0 ? tx(T.periodsCovered(cover.arranged, cover.needed)) : tx(T.noCoverNeeded)}</span>
            </span>
          </TileLink>
        ) : null}
        {money ? (
          <Link href="/dues" className="tap" style={{ ...tileText, gridColumn: "1 / -1", background: HERO_TEAL, color: HERO_INK, borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
            <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 12, background: "rgba(8,47,73,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n="phone" />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.familiesToCall(money.followUps))}</span>
              <span style={{ fontSize: 12, fontWeight: 500 }}>{tx(TD.callsSub(props.promisedToday ?? null))}</span>
            </span>
            <Ic n="chevRight" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function needTitle(item: InboxItem): Pair {
  return item.kind === "not_marked" && item.classIds ? TD.classesNotMarked(item.classIds.length) : item.title;
}

function NeedTile({ item, size, radius }: { item: InboxItem; size: number; radius: number }) {
  const look = KIND_LOOK[item.kind];
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: radius, display: "flex", alignItems: "center", justifyContent: "center", background: look.bg, color: look.fg }}>
      <Ic n={look.icon} />
    </span>
  );
}

function CountPill({ n }: { n: number }) {
  return <span className="pill num" style={{ minWidth: 22, justifyContent: "center", background: "var(--bad)", color: "var(--onsolid)" }}>{n}</span>;
}

function PhoneNeeds({ inbox }: { inbox: InboxItem[] | null }) {
  const { tx } = useVx();
  if (!inbox) return null;
  return (
    <section style={{ padding: "24px 18px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {tx(T.needsYou)}
          {inbox.length > 0 ? <CountPill n={inbox.length} /> : null}
        </h2>
        <Link href="/inbox" className="tap" style={{ height: 44, padding: "0 0 0 12px", display: "inline-flex", alignItems: "center", color: "var(--acc)", fontSize: 14, fontWeight: 600 }}>{tx(T.seeAll)}</Link>
      </div>
      {inbox.length > 0 ? (
        <div className="card" style={{ overflow: "hidden" }}>
          {inbox.slice(0, 3).map((item, i) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderTop: i === 0 ? 0 : "1px solid var(--bd)", animation: `xRise .44s var(--ease) ${i * 35}ms both` }}>
              <NeedTile item={item} size={42} radius={14} />
              <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tx(needTitle(item))}</span>
                <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(item.sub)}</span>
              </Link>
              <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap btn soft" style={{ flex: "none", padding: "0 14px" }}>{tx(ACTION_OF[item.kind] ?? T.open)}</Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 14, animation: "xIn .3s var(--ease) both" }}>
          <span aria-hidden="true" style={{ flex: "none", width: 44, height: 44, borderRadius: 22, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
            <Ic n="check" />
          </span>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.allClear)}</span>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(TD.allClearSub)}</span>
          </span>
        </div>
      )}
    </section>
  );
}

function PhoneQuick({ actions }: { actions: TodayProps["actions"] }) {
  const { tx } = useVx();
  const four = actions.slice(0, 4);
  if (four.length === 0) return null;
  return (
    <section style={{ padding: "24px 18px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {four.map((a, i) => (
          <Link key={a.key} href={a.href} className="tap rise" style={{ padding: "4px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--fg)", fontSize: 12, fontWeight: 600, textAlign: "center", animationDelay: `${i * 35}ms` }}>
            <span aria-hidden="true" style={{ width: 58, height: 58, borderRadius: 20, background: i === 0 ? "var(--pri)" : "var(--card)", color: i === 0 ? "var(--prifg)" : "var(--pri)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--sh)" }}>
              <Ic n={a.icon} size={24} />
            </span>
            {tx(TD.quickShort[a.key] ?? a.label)}
          </Link>
        ))}
      </div>
    </section>
  );
}

function PaceBar({ pace }: { pace: { percent: number; shouldPercent: number } }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pace.percent} style={{ position: "relative", height: 12, borderRadius: 6, background: "var(--s3)" }}>
      <div style={{ height: 12, borderRadius: 6, width: `${Math.min(100, pace.percent)}%`, background: "var(--acc)", transformOrigin: "left", animation: "xGrowX .9s var(--ease) both", transition: "width .6s var(--ease)" }} />
      <span aria-hidden="true" style={{ position: "absolute", top: -4, bottom: -4, left: `${Math.min(100, pace.shouldPercent)}%`, width: 2, borderRadius: 1, background: "var(--fg)" }} />
    </div>
  );
}

function PaceWords({ pace, today, size }: { pace: { behind: number }; today: string; size: number }) {
  const { tx } = useVx();
  const more = catchUp(pace.behind, today);
  return (
    <>
      <span style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 600, color: pace.behind > 0 ? "var(--warnfg)" : "var(--ok)" }}>
        {pace.behind > 0 ? tx(T.behindBy(rupees(pace.behind))) : tx(T.onPace)}
      </span>
      {more ? <span style={{ fontSize: size, lineHeight: 1.5, color: "var(--mut)" }}>{tx(TD.catchUp(rupees(more.perDay), more.daysLeft, TD.month[more.month]))}</span> : null}
    </>
  );
}

function PhoneSession({
  money,
  pace,
  today,
  attendance,
  week,
  linkAttendance,
}: {
  money: TodayMoneyView | null;
  pace: { percent: number; shouldPercent: number; behind: number } | null;
  today: string;
  attendance: TodayProps["attendance"];
  week: { day: string; percent: number | null }[] | null;
  linkAttendance: boolean;
}) {
  const { tx } = useVx();
  const bars = attendance && week !== null ? weekBars(today, week, attendance.schoolOpen ? attendance.percent : null) : null;
  if (!(money && pace) && !bars) return null;
  return (
    <section style={{ padding: "26px 18px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{tx(T.thisSession)}</h2>
      {money && pace ? (
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(TD.feesCollected)}</span>
            <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.ofTotal(rupeesShort(money.collected), rupeesShort(money.expected)))}</span>
          </div>
          <PaceBar pace={pace} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--mut)" }}>
            <span className="num">{tx(T.pctCollected(pace.percent))}</span>
            <span>{tx(TD.shouldBeByToday(pace.shouldPercent))}</span>
          </div>
          <PaceWords pace={pace} today={today} size={13} />
        </div>
      ) : null}
      {bars ? (
        <TileLink href={linkAttendance ? "/attendance" : null} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, color: "var(--fg)" }}>
          <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", width: "100%" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(TD.attendanceThisWeek)}</span>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(TD.presentShare)}</span>
          </span>
          <span style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10, alignItems: "end", height: 92, width: "100%" }}>
            {bars.map((b, i) => (
              <span key={b.day} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 5, height: 92 }}>
                <span className="num" style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{b.percent === null ? "–" : b.percent}</span>
                <span style={{ width: "100%", height: b.percent === null ? 6 : Math.round(b.percent * 0.56), borderRadius: 8, background: b.isToday ? "var(--acc)" : b.percent === null ? "var(--s3)" : "var(--pri)", transformOrigin: "bottom", animation: `xGrowY .7s var(--ease) ${i * 60}ms both` }} />
                <span style={{ fontSize: 11, color: b.isToday ? "var(--fg)" : "var(--mut)", fontWeight: b.isToday ? 700 : 500 }}>{b.isToday ? tx(T.today) : tx(TD.weekday[b.weekday])}</span>
              </span>
            ))}
          </span>
        </TileLink>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------- the day, both */

function timelineLook(state: TimelineItem["state"]) {
  switch (state) {
    case "done":
      return { time: "var(--sub)", title: "var(--mut)", dot: "var(--bds)", ring: "0", pulse: false };
    case "alert":
      return { time: "var(--fg)", title: "var(--fg)", dot: "var(--warn)", ring: "0", pulse: false };
    case "now":
      return { time: "var(--acc)", title: "var(--fg)", dot: "var(--acc)", ring: "0", pulse: true };
    case "next":
      return { time: "var(--fg)", title: "var(--fg)", dot: "var(--card)", ring: "2px solid var(--bds)", pulse: false };
  }
}

/** "Today at school": a phone draws it a size up from the desk's rail. */
function Timeline({ items, closed, phone = false }: { items: TimelineItem[]; closed: boolean; phone?: boolean }) {
  const { tx } = useVx();
  if (items.length === 0) {
    return <p style={{ margin: phone ? "10px 0" : "4px 0 10px", color: "var(--mut)", fontSize: 14 }}>{closed ? tx(T.schoolClosed) : tx(T.noTimeline)}</p>;
  }
  const dot = phone ? 12 : 11;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((item, i) => {
        const look = timelineLook(item.state);
        return (
          <li
            key={`${item.time}-${i}`}
            style={{ display: "grid", gridTemplateColumns: phone ? "46px 16px minmax(0, 1fr)" : "44px 14px minmax(0, 1fr)", gap: 10, alignItems: "start", padding: phone ? "10px 0" : "8px 0" }}
          >
            <span className="num" style={{ fontSize: phone ? 13 : 12, fontWeight: 700, color: look.time, paddingTop: 1 }}>{item.time}</span>
            <span aria-hidden="true" style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
              <span style={{ flex: "none", width: dot, height: dot, borderRadius: 6, marginTop: 4, background: look.dot, border: look.ring, animation: look.pulse ? "xPulse 2s infinite" : undefined }} />
              <span style={{ flex: 1, width: 2, marginTop: 4, marginBottom: phone ? -14 : -12, borderRadius: 1, background: "var(--bd)", opacity: i === items.length - 1 ? 0 : 1 }} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: phone ? 1 : 0, paddingBottom: phone ? 2 : 0 }}>
              <span style={{ fontSize: phone ? 15 : 14, fontWeight: 600, color: look.title }}>{tx(item.title)}</span>
              {item.sub ? <span style={{ fontSize: phone ? 13 : 12, color: item.state === "alert" ? "var(--warnfg)" : "var(--mut)" }}>{tx(item.sub)}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ----------------------------------------------------------------- desk */

function DeskKpis(props: TodayProps & { avgDelta: number | null }) {
  const { tx } = useVx();
  const { money, attendance, cover } = props;
  const tile: CSSProperties = { padding: 16, display: "flex", flexDirection: "column", gap: 6, color: "var(--fg)", minWidth: 0 };
  const label: CSSProperties = { fontSize: 13, color: "var(--mut)", fontWeight: 600 };
  const big: CSSProperties = { fontSize: 28, fontWeight: 700, lineHeight: 1.15 };
  const up = (props.avgDelta ?? 0) >= 0;
  const promised = props.promisedToday ?? null;
  return (
    <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
      {money ? (
        <TileLink href="/receipts" className="card lift" style={{ ...tile, animation: "xRise .45s var(--ease) both" }}>
          <span style={{ ...label, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%" }}>
            {tx(T.feesToday)}
            {props.avgDelta !== null && money.today > 0 ? (
              <span className="pill" style={{ background: up ? "var(--oks)" : "var(--bads)", color: up ? "var(--ok)" : "var(--bad)" }}>{tx(T.vsAvg(props.avgDelta))}</span>
            ) : null}
          </span>
          <span className="num" style={{ ...big, letterSpacing: "-0.02em" }}>{rupees(money.today)}</span>
          <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.receiptsSoFar(money.receiptsToday))}</span>
            <Spark values={weekRunning(money, props.today)} w={96} h={34} color="var(--acc)" stroke={2.4} dot={3.5} end={[92, 3]} />
          </span>
        </TileLink>
      ) : null}
      {attendance ? (
        <TileLink href={props.links.attendance ? "/attendance" : null} className="card lift" style={{ ...tile, flexDirection: "row", alignItems: "center", gap: 14, animation: "xRise .45s .05s var(--ease) both" }}>
          <DrawnRing size={64} r={26} stroke={8} value={attendance.marked} max={Math.max(1, attendance.total)} tone="var(--acc)" track="var(--s3)" />
          <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={label}>{tx(T.attendance)}</span>
            <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>{attendance.marked}/{attendance.total}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {attendance.schoolOpen ? `${tx(T.classesMarked)} · ${tx(T.presentPct(attendance.percent))}` : tx(T.schoolClosed)}
            </span>
          </span>
        </TileLink>
      ) : null}
      {props.staffAway !== null ? (
        <TileLink href={props.links.substitutions ? "/substitutions" : null} className="card lift" style={{ ...tile, animation: "xRise .45s .1s var(--ease) both" }}>
          <span style={label}>{tx(T.teachersOnLeave)}</span>
          <span className="num" style={big}>{props.staffAway}</span>
          {cover && cover.needed > 0 ? <Dashes needed={cover.needed} arranged={cover.arranged} on="var(--acc)" off="var(--s3)" width={22} /> : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{cover && cover.needed > 0 ? tx(T.periodsCovered(cover.arranged, cover.needed)) : tx(T.noCoverNeeded)}</span>
        </TileLink>
      ) : null}
      {money ? (
        <TileLink href="/dues" className="card lift" style={{ ...tile, animation: "xRise .45s .15s var(--ease) both" }}>
          <span style={label}>{tx(T.followUps)}</span>
          <span className="num" style={big}>{money.followUps}</span>
          {promised !== null ? (
            <span aria-hidden="true" style={{ height: 6, borderRadius: 3, background: "var(--s3)", overflow: "hidden", display: "block" }}>
              <span style={{ display: "block", height: 6, width: `${money.followUps > 0 ? Math.min(100, (promised / money.followUps) * 100) : 0}%`, background: "var(--warn)", transformOrigin: "left", animation: "xGrowX .8s var(--ease) both" }} />
            </span>
          ) : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{promised !== null ? tx(TD.promisedToPay(promised)) : tx(T.followUpsSub)}</span>
        </TileLink>
      ) : null}
    </div>
  );
}

function MoneyTaken({ money, today }: { money: TodayMoneyView; today: string }) {
  const { tx } = useVx();
  const [range, setRange] = useState<"14" | "30">("30");
  const chart = moneyChart(dailySeries(money.days, today, Number(range)), today);
  return (
    <section className="card" style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 14, animation: "xRise .45s .1s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.moneyTaken)}</h3>
          <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyTakenSub(rupees(chart.average), rupees(chart.best), chart.emptyDays))}</span>
        </div>
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
      </div>
      <div style={{ position: "relative", height: 210, marginLeft: 48 }}>
        {chart.grid.map((g) => (
          <span key={g.at}>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${g.at}%`, borderTop: "1px dashed var(--bd)" }} />
            <span className="num" style={{ position: "absolute", left: -48, bottom: `${g.at}%`, transform: "translateY(50%)", fontSize: 11, color: "var(--sub)" }}>{g.label}</span>
          </span>
        ))}
        {chart.average > 0 ? (
          <>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${chart.averageAt}%`, borderTop: "2px dashed var(--warn)", opacity: 0.8, transition: "bottom .5s var(--ease)" }} />
            <span className="pill num" style={{ position: "absolute", right: 0, bottom: `${chart.averageAt}%`, transform: "translateY(-4px)", background: "var(--warns)", color: "var(--warnfg)", transition: "bottom .5s var(--ease)", zIndex: 1 }}>{tx(TD.avgPill(kfmt(chart.average)))}</span>
          </>
        ) : null}
        <div role="list" aria-label={tx(T.moneyTaken)} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "stretch", gap: 3 }}>
          {chart.bars.map((b, i) => {
            const tip = `${b.day} · ${b.amount > 0 ? rupees(b.amount) : b.sunday ? tx(TD.sunday) : tx(TD.nothingTaken)}`;
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
    <section className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, animation: "xRise .45s .15s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.pendingByClass)}</h3>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.pendingByClassSub)}</span>
      </div>
      {cols.length === 0 || rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(TD.nothingPastDue)}</p>
      ) : (
        <div role="table" aria-label={tx(T.pendingByClass)} style={{ display: "grid", gridTemplateColumns: `112px repeat(${cols.length}, minmax(0, 1fr)) 76px`, gap: 5, alignItems: "center" }}>
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader" />
            {cols.map((c) => (
              <span key={c.key} role="columnheader" className="sech" title={c.title} style={{ textAlign: "center" }}>{c.carry ? tx(TD.oldBalance) : c.label}</span>
            ))}
            <span role="columnheader" className="sech" style={{ textAlign: "right" }}>{tx(TD.total)}</span>
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
                    style={{ position: "relative", height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: a > 0.55 ? "var(--onsolid)" : "var(--fg)", background: `rgba(var(--heat), ${a.toFixed(2)})`, animation: `xFade .5s ease ${(ri * 3 + ci) * 25}ms both` }}
                  >
                    {kfmt(v)}
                  </span>
                );
              })}
              <span role="cell" className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right" }}>{kfmt(row.total)}</span>
            </div>
          ))}
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
    <section className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0, animation: "xRise .45s .2s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{tx(T.howTheyPay)}</h3>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(TD.howTheyPaySub)}</span>
      </div>
      {total <= 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(T.nothingTakenToday)}</p>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 150, height: 150, flex: "none" }}>
            <svg className="td-donut" width="150" height="150" viewBox="0 0 150 150" aria-hidden="true" style={{ transform: "rotate(-90deg)", animation: "xSpin .8s var(--ease) both" }}>
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

function RailNeeds({ inbox, awaiting }: { inbox: InboxItem[]; awaiting: number }) {
  const { tx } = useVx();
  return (
    <section className="card" style={{ overflow: "hidden", animation: "xRise .45s .1s var(--ease) both" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 10px" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          {tx(T.needsYou)}
          {awaiting > 0 ? <CountPill n={awaiting} /> : null}
        </h3>
        <Link href="/inbox" className="tap btn ghost" style={{ height: 32, padding: "0 10px", color: "var(--acc)", fontSize: 13 }}>{tx(T.openInbox)}</Link>
      </div>
      {inbox.slice(0, 4).map((item, i) => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderTop: "1px solid var(--bd)", animation: `xIn .4s var(--ease) ${i * 35}ms both` }}>
          <NeedTile item={item} size={36} radius={11} />
          <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{tx(needTitle(item))}</span>
            <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(item.sub)}</span>
          </Link>
          <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap btn soft" style={{ flex: "none", height: 32, padding: "0 12px", fontSize: 13 }}>{tx(ACTION_OF[item.kind] ?? T.open)}</Link>
        </div>
      ))}
      {awaiting === 0 ? <div style={{ padding: "14px 18px 18px", fontSize: 13, color: "var(--mut)", borderTop: "1px solid var(--bd)" }}>{tx(TD.allClearRail)}</div> : null}
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
    </section>
  );
}

/* ------------------------------------------------------- Scheduled now */

/**
 * A phone shows one period at a time, and only its first few classes until
 * asked for the rest; a desktop shows Now and Next side by side in full.
 * Rows a phone hides carry `only-d`, so the desktop layout is unchanged.
 */
const PHONE_ROWS = 5;

function ScheduleBody({ view }: { view: ScheduleView }) {
  const { tx } = useVx();
  const [tab, setTab] = useState<"now" | "next">("now");
  switch (view.state) {
    case "closed":
      return <Quiet>{tx(T.schoolClosed)}</Quiet>;
    case "no_teaching":
      return <Quiet>{tx(TD.noTeachingToday)}</Quiet>;
    case "no_timetable":
      return <Quiet>{tx(TD.noTimetable)}</Quiet>;
    case "after":
      return (
        <Quiet>
          <strong style={{ color: "var(--fg)" }}>{tx(TD.dayFinished)}</strong> · {tx(TD.lastBellAt(view.lastEnds))}
        </Quiet>
      );
    case "before":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <strong style={{ fontSize: 15 }}>{tx(TD.firstPeriodAt(view.next.starts))}</strong>
          <PeriodList label={TD.next} period={view.next} />
        </div>
      );
    case "break":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <strong style={{ fontSize: 15 }}>{tx(TD.breakThenAt(view.next.number, view.next.starts))}</strong>
          <PeriodList label={TD.next} period={view.next} />
        </div>
      );
    case "during":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {view.next ? (
            <div className="only-m">
              <Seg
                options={[
                  { value: "now", label: `${tx(TD.now)} · ${view.now.starts}` },
                  { value: "next", label: `${tx(TD.next)} · ${view.next.starts}` },
                ]}
                value={tab}
                onChange={setTab}
                label={tx(TD.whichPeriod)}
                style={{ width: "100%" }}
              />
            </div>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
            <PeriodList label={TD.now} period={view.now} now tabbed={view.next !== null} phoneHidden={view.next !== null && tab !== "now"} />
            {view.next ? (
              <PeriodList label={TD.next} period={view.next} tabbed phoneHidden={tab !== "next"} />
            ) : (
              <Quiet>
                {tx(TD.lastPeriod)}
              </Quiet>
            )}
          </div>
        </div>
      );
  }
}

function PeriodList({
  label,
  period,
  now = false,
  tabbed = false,
  phoneHidden = false,
}: {
  label: Pair;
  period: ScheduledPeriod;
  now?: boolean;
  /** A phone picks this period with the Now/Next switch, which already says which it is. */
  tabbed?: boolean;
  phoneHidden?: boolean;
}) {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const visible = foldedKeys(period.activities, PHONE_ROWS);
  const folds = visible.size < period.activities.length;
  const classCount = period.activities.reduce((n, a) => n + a.classes.length, 0);
  return (
    <section className={phoneHidden ? "only-d" : undefined} style={{ display: "flex", flexDirection: "column", minWidth: 0 }} aria-label={`${tx(label)} · ${tx(TD.periodAt(period.number, period.starts, period.ends))}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
        <span className={tabbed ? "only-d" : undefined} style={{ display: "inline-flex" }}>
          <Pill tone={now ? "acc" : "mut"}>{tx(label)}</Pill>
        </span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{tx(TD.periodAt(period.number, period.starts, period.ends))}</span>
        {period.uncovered > 0 ? <Pill tone="warn" icon="alert">{tx(TD.needSubstitute(period.uncovered))}</Pill> : null}
      </div>
      {period.activities.length === 0 ? (
        <Quiet>{tx(TD.nothingThisPeriod)}</Quiet>
      ) : (
        <>
          <ul id={listId} className="sched-scroll" style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--bd)" }}>
            {period.activities.map((activity) => (
              <ActivityRow key={activity.key} activity={activity} phoneHidden={!open && !visible.has(activity.key)} />
            ))}
          </ul>
          {folds ? (
            <button
              type="button"
              className="only-m tap"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
              style={{ marginTop: 8, minHeight: 44, border: 0, borderRadius: 12, background: "var(--s2)", color: "var(--accfg)", fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              {open ? tx(TD.showFewer) : tx(TD.showAllClasses(classCount))}
              <Ic n={open ? "chevUp" : "chevDown"} size={16} />
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

const KIND_LABEL: Record<Exclude<ScheduledActivity["kind"], "single">, Pair> = {
  combined: TD.combined,
  shared: TD.shared,
  parallel: TD.parallel,
};

/**
 * One class's lesson. Without a cover change it is one line — class, subject,
 * teacher — wrapping only when the names are long; a teacher who is away gets
 * a line of their own with who covers.
 */
function ActivityRow({ activity, phoneHidden }: { activity: ScheduledActivity; phoneHidden: boolean }) {
  const { tx } = useVx();
  const changed = activity.teachers.some((teacher) => teacher.cover !== null);
  const parallel = activity.kind === "parallel";
  return (
    <li className={phoneHidden ? "only-d" : undefined} style={{ display: "grid", gridTemplateColumns: "minmax(0,72px) minmax(0,1fr)", gap: 10, padding: "7px 2px", borderBottom: "1px solid var(--bd)", alignItems: "baseline" }}>
      <strong style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{activity.classes.map((c) => c.label).join(", ")}</strong>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          <span style={{ fontWeight: 600 }}>{activity.subjects.join(" / ")}</span>
          {activity.kind !== "single" ? <Pill tone="info" style={{ fontSize: 11, marginLeft: 6, verticalAlign: "1px" }}>{tx(KIND_LABEL[activity.kind])}</Pill> : null}
          {changed ? null : (
            <span style={{ color: "var(--mut)" }}>
              {" · "}
              {activity.teachers.map((teacher) => (parallel ? `${teacher.name} (${teacher.subjectCode})` : teacher.name)).join(", ")}
            </span>
          )}
        </span>
        {changed ? (
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {activity.teachers.map((teacher) => (
              <TeacherLine key={teacher.id} teacher={teacher} showSubject={parallel} />
            ))}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function TeacherLine({ teacher, showSubject }: { teacher: ScheduledTeacher; showSubject: boolean }) {
  const { tx } = useVx();
  const away = teacher.cover !== null;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, color: "var(--mut)" }}>
      <span style={{ textDecoration: away ? "line-through" : undefined }}>
        {teacher.name}
        {showSubject ? ` (${teacher.subjectCode})` : ""}
      </span>
      {teacher.cover?.state === "covered" ? <Pill tone="ok">{tx(T.coveredBy(teacher.cover.by))}</Pill> : null}
      {teacher.cover?.state === "needed" ? <Pill tone="warn">{tx(T.needsSubstitute)}</Pill> : null}
      {teacher.cover?.state === "away" ? <Pill tone="bad">{tx(TD.onLeave)}</Pill> : null}
    </span>
  );
}

/* ------------------------------------------------------------- pieces */

function Quiet({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>{children}</p>;
}

function ExceptionRow({ icon, tone, href, title, sub, pill }: { icon: IconName; tone: "warn" | "info"; href: string | null; title: string; sub: string; pill: ReactNode }) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} size={34} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        <span className="clip" style={{ fontSize: 12.5, color: "var(--mut)" }}>{sub}</span>
      </span>
      <span style={{ flex: "none" }}>{pill}</span>
    </>
  );
  const style: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)" };
  return <li>{href ? <Link href={href} className="row tap" style={style}>{body}</Link> : <div style={style}>{body}</div>}</li>;
}
