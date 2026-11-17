"use client";

import { Crest } from "@/vx/screens/system/brand";
import Link from "@/ui/link";
import dynamic from "next/dynamic";
import { useId, useState, type CSSProperties, type ReactNode } from "react";

import { periodNumber } from "@/modules/timetable/domain/periods";
import { rupees, rupeesShort, shortDay } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { Face } from "@/vx/ui/face";
import { Card, IconTile, Pill } from "@/vx/ui/primitives";
import { CouldNotRead } from "@/vx/ui/read-state";
import { dailySeries, vsAverage, yearPace } from "@/vx/screens/admin/logic";
import { coverStanding, foldedKeys, type CoverException, type ScheduledActivity, type ScheduledPeriod, type ScheduleView, type ScheduledTeacher } from "@/vx/screens/admin/schedule";
import { T } from "@/vx/screens/admin/text";
import { TD } from "@/vx/screens/admin/today-text";
import { firstName, knownSpan, weekBars, type BirthdayChild, type ComingItem, type TodayGlance } from "@/vx/screens/admin/today-logic";
import type { InboxItem, TimelineItem } from "@/vx/screens/admin/types";
import { TodayBrief, type BriefFact } from "@/vx/assist/brief-assist";
import { ReadyForYou } from "@/vx/assist/lazy-ready";
import "./today.css";
import { PaceBar, PaceWords } from "@/vx/screens/admin/today-pace";

/** The desk's money section, its own chunk: a phone never shows it (D-510). */
const DeskMoney = dynamic(() => import("./today-money").then((m) => m.DeskMoney));
/** The desk's "+ New" menu, its own chunk for the same reason. */
const NewMenu = dynamic(() => import("./today-new").then((m) => m.NewMenu));

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
  /** "fees": the real session's figures, read from the Fees ledger (`moneyFromLedger`). */
  source?: "fees";
  /** When Fees read them, for "as of 11:10". */
  asOf?: string;
  /** The day series is only known from this day on; a chart reaches no further back. */
  knownFrom?: string | null;
};

/** The "+ New" menu's tile colours (`QUICK_ACTIONS` in `vx/nav.ts`). */
export type QuickTone = "pri" | "acc" | "info" | "ok" | "warn" | "plain";

export type LedgerToday = { total: number; count: number; byMode: { label: string; amount: number; count: number }[]; asOf: string };

export type TodayProps = {
  notice?: ReactNode;
  officeWork?: ReactNode;
  /** Morning: a part-day's money is not set against a whole average day (verification N7, as accountant B16). */
  beforeNoon?: boolean;
  firstName: string;
  greeting: Pair;
  dayLine: string;
  status: Pair | null;
  today: string;
  money: TodayMoneyView | null;
  moneyFailed: boolean;
  /** Under the live Fees connection: Fees' own "Today" figures, or "failed" when that read failed; absent when not offered. */
  ledgerToday?: LedgerToday | "failed" | null;
  attendance: { marked: number; total: number; percent: number | null; schoolOpen: boolean } | null;
  staffAway: number | null;
  cover: { needed: number; arranged: number; missed: number } | null;
  inbox: InboxItem[] | null;
  /** Needs-you sources that could not be read; the queue is then not "All clear" (T03). */
  inboxMissing?: readonly string[];
  /** Today's own reads that failed (board, cover, …), so a card can say so rather than show nothing. */
  todayMissing?: readonly string[];
  timeline: TimelineItem[];
  /** Who is scheduled to teach now and next; null when this reader has no timetable. */
  schedule: ScheduleView | null;
  scheduleFailed: boolean;
  exceptions: { notMarked: string[] | null; cover: CoverException[] | null };
  /** Notes needing action, school-wide; null for a reader without the notes board. */
  support: { needsAction: number; due: number } | null;
  actions: { key: string; label: Pair; icon: IconName; href: string; tone?: QuickTone }[];
  /** Which screens behind the tiles this reader may open; a tile they cannot open is not a link. */
  links: { collect: boolean; /** `fees:reports` (D-476): the "Day report" button opens Reports. */ reports: boolean; attendance: boolean; substitutions: boolean; review: boolean; timetable: boolean };
  unavailable: boolean;
  /** The phone hero's brand line ("Admin · Session 2026–27"). */
  roleLine?: Pair;
  /** The reader's initials and where their avatar leads, for the phone hero. */
  me?: { initials: string; href: string };
  /** Present share of each school day before today this week; null when it could not be read. */
  week?: { day: string; percent: number | null }[] | null;
  /** Families who promised on a call to pay today; null when unknown. Money readers only. */
  promisedToday?: number | null;
  /** Why school is closed, what is coming on the calendar, today's birthdays (7 Nov 2026). */
  glance?: TodayGlance | null;
};

/** The design's tile colours by kind (`typeMeta`, and the correction's pencil). */
const KIND_LOOK: Record<InboxItem["kind"], { icon: IconName; bg: string; fg: string }> = {
  not_marked: { icon: "calCheck", bg: "var(--warns)", fg: "var(--warnfg)" },
  cover: { icon: "swap", bg: "var(--infos)", fg: "var(--info)" },
  submission: { icon: "edit", bg: "var(--warns)", fg: "var(--warnfg)" },
  confirmations: { icon: "ticks", bg: "var(--oks)", fg: "var(--ok)" },
  refund: { icon: "rupee", bg: "var(--accs)", fg: "var(--accfg)" },
  job: { icon: "alert", bg: "var(--bads)", fg: "var(--bad)" },
  leave: { icon: "calendar", bg: "var(--infos)", fg: "var(--info)" },
  parent: { icon: "message", bg: "var(--oks)", fg: "var(--ok)" },
  toilets: { icon: "toilet", bg: "var(--warns)", fg: "var(--warnfg)" },
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
  leave: T.review,
  parent: T.review,
};

const QUICK_LOOK: Record<QuickTone, { bg: string; fg: string }> = {
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  plain: { bg: "var(--s3)", fg: "var(--fg)" },
};

/** One look for every widget's icon tile, so the cards read as one family (7 Nov 2026). */
type WidgetTone = "acc" | "warn" | "info" | "ok" | "bad" | "pri" | "plain";
const WIDGET_TONE: Record<WidgetTone, { bg: string; fg: string }> = {
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  bad: { bg: "var(--bads)", fg: "var(--bad)" },
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
  plain: { bg: "var(--s3)", fg: "var(--fg)" },
};

/** The design's light teal on the navy hero; the same in both themes, as drawn. */
const HERO_TEAL = "#81DAE4";
const HERO_INK = "#082F49";

export function TodayScreen(props: TodayProps) {
  const { tx } = useVx();
  const { money, attendance, inbox } = props;
  // A day series known only from a later day (the real session's, from Fees) is never averaged over days it was not told.
  const span = money ? knownSpan(props.today, money.knownFrom, 30) : 30;
  const avg = money ? vsAverage(dailySeries(money.days, props.today, span), props.today) : null;
  const pace = money && money.expected > 0 ? yearPace({ expected: money.expected, collected: money.collected, dueSoFar: money.dueSoFar }) : null;
  const awaiting = inbox ? inbox.length : 0;
  // A queue with a source that could not be read is never reported as nought.
  const inboxMissing = props.inboxMissing ?? [];
  const todayMissing = props.todayMissing ?? [];
  const inboxIncomplete = inboxMissing.length > 0;
  const dataChanges = inbox
    ? inbox.reduce((n, item) => n + (item.kind === "submission" || item.kind === "confirmations" ? (item.submissionIds?.length ?? 1) : 0), 0)
    : 0;
  const greeting = `${tx(props.greeting)}, ${props.firstName}`;
  const statusText = props.status ? ` · ${tx(props.status)}` : "";
  const glance = props.glance ?? null;
  const closed = glance?.closed ?? null;
  const schoolClosed = closed !== null || (attendance !== null && !attendance.schoolOpen);
  const birthdays = glance?.birthdays ?? [];
  const coming = glance?.coming ?? [];

  // The page's own figures, for the AI brief (D-328): the AI writes words around
  // `<<slots>>` and these values fill them, so no number in the brief is the AI's.
  const weekDays = (props.week ?? []).filter((d) => d.percent !== null);
  const briefFacts: BriefFact[] = [
    { key: "classes_marked", label: "Classes whose attendance is marked today", value: attendance ? `${attendance.marked} of ${attendance.total}` : null },
    { key: "present_today", label: "Children present today", value: attendance?.percent != null ? `${Math.round(attendance.percent)}%` : null },
    { key: "week_attendance", label: "Children present on each earlier school day this week", value: weekDays.length ? weekDays.map((d) => `${shortDay(d.day)} ${Math.round(d.percent ?? 0)}%`).join(", ") : null },
    { key: "classes_not_marked", label: "Classes not marked yet", value: props.exceptions.notMarked?.length ? props.exceptions.notMarked.slice(0, 8).join(", ") : null },
    { key: "staff_away", label: "Teachers away today", value: props.staffAway != null ? String(props.staffAway) : null },
    { key: "cover_arranged", label: "Periods needing cover, and how many are arranged", value: props.cover ? `${props.cover.arranged} of ${props.cover.needed} arranged` : null },
    { key: "cover_missed", label: "Periods that went without cover", value: props.cover?.missed ? String(props.cover.missed) : null },
    { key: "needs_you", label: "Items waiting in Needs you", value: inbox && !inboxIncomplete ? String(awaiting) : null },
    { key: "notes_action", label: "Notes on children needing action", value: props.support ? String(props.support.needsAction) : null },
    { key: "notes_due", label: "Note follow-ups due", value: props.support ? String(props.support.due) : null },
    { key: "collected_today", label: "Fees collected today", value: money ? `${rupees(money.today)} in ${money.receiptsToday} receipts` : null },
    { key: "session_collected", label: "Fees collected this session, of what is expected", value: money && money.expected > 0 ? `${rupees(money.collected)} of ${rupees(money.expected)}` : null },
    { key: "families_follow_up", label: "Families to follow up for fees", value: money ? String(money.followUps) : null },
    { key: "promised_today", label: "Families who promised to pay today", value: props.promisedToday != null ? String(props.promisedToday) : null },
    { key: "birthdays_today", label: "Children whose birthday is today", value: glance?.birthdays ? String(birthdays.length) : null },
  ];

  /* ------------------------------------------- after the design: later cards */

  // On a phone a closed day's "School is closed" cards say what the hero already says, so they step aside.
  const scheduleCard =
    props.schedule || props.scheduleFailed ? (
      <section className={`card td-widget${props.schedule?.state === "closed" ? " only-d" : ""}`}>
        <WidgetHead
          icon="clock"
          tone="acc"
          title={tx(TD.scheduledNow)}
          sub={<span className="only-d">{tx(TD.scheduledSub)}</span>}
          action={props.links.timetable ? <WidgetLink href="/timetable" label={tx(TD.fullDay)} /> : undefined}
        />
        <div>{props.schedule ? <ScheduleBody view={props.schedule} /> : <Quiet>{tx(T.couldNotRead)}</Quiet>}</div>
        {/* On a phone the "not a record of teaching" line moves under the list, small. */}
        {props.schedule ? <p className="only-m" style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{tx(TD.scheduledSub)}</p> : null}
      </section>
    ) : null;

  const notMarked = props.exceptions.notMarked ?? [];
  const coverRows = props.exceptions.cover ?? [];
  const exceptionsUnread = ["board", "calendar", "cover"].some((key) => todayMissing.includes(key));
  // A phone's Needs you already lists the unmarked classes and the cover to arrange.
  const exceptionsCard = (
    <section className={`card td-widget${inbox || schoolClosed ? " only-d" : ""}`}>
      <WidgetHead
        icon="swap"
        tone="info"
        title={tx(TD.exceptions)}
        action={
          props.links.substitutions && coverRows.length > 0 ? (
            <WidgetLink href="/substitutions" label={tx(TD.arrangeCover)} />
          ) : props.links.attendance && notMarked.length > 0 ? (
            <WidgetLink href="/attendance?f=pending" label={tx(TD.openBoard)} />
          ) : undefined
        }
      />
      {notMarked.length === 0 && coverRows.length === 0 && exceptionsUnread ? (
        <CouldNotRead />
      ) : notMarked.length === 0 && coverRows.length === 0 ? (
        <p style={{ margin: 0, color: "var(--mut)", fontSize: 14 }}>
          {attendance && !attendance.schoolOpen ? tx(T.schoolClosed) : tx(TD.noExceptions)}
        </p>
      ) : (
        <ul className="td-wlist">
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
    </section>
  );

  // Student support and approvals: two tiles in the same look as every other widget.
  const laterTiles =
    props.support || (inbox && props.links.review) ? (
      <div className="td-stats">
        {props.support ? (
          <StatTile
            icon="note"
            tone={props.support.needsAction > 0 ? "warn" : "ok"}
            label={tx(TD.support)}
            value={props.support.needsAction}
            valueColor={props.support.needsAction > 0 ? "var(--warnfg)" : undefined}
            href="/notes"
            sub={props.support.needsAction > 0 ? tx(TD.followUpsDue(props.support.due)) : tx(TD.nothingNeedsAction)}
          />
        ) : null}
        {inbox && props.links.review ? (
          <StatTile
            icon="clipboard"
            tone={dataChanges > 0 ? "info" : "ok"}
            label={tx(TD.approvals)}
            value={inboxMissing.includes("submissions") && dataChanges === 0 ? "—" : dataChanges}
            href="/collection/review"
            sub={inboxMissing.includes("submissions") ? tx(T.couldNotRead) : dataChanges > 0 ? tx(TD.dataChanges(dataChanges)) : tx(TD.noDataChanges)}
          />
        ) : null}
      </div>
    ) : null;

  // The plain ledger tile is only for a Fees that sends no session figures; the phone hero already shows it.
  const ledgerCard = props.ledgerToday ? <LedgerTodayCard today={props.ledgerToday} /> : null;
  const moneyNote = money ? null : ledgerCard ? <div className="only-d">{ledgerCard}</div> : props.moneyFailed ? (
    <Card className="only-d"><p style={{ margin: 0, color: "var(--mut)" }}>{tx(TD.feesUnavailable)}</p></Card>
  ) : props.notice ? null : (
    <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyHidden)}</p>
  );
  // On a fees-ledger session there is no class table: the year's pace and how they pay stand beside the chart.
  const noHeat = money?.source === "fees" && money.matrix.length === 0;
  const timelineEmptyClosed = schoolClosed && props.timeline.length === 0;

  /* ------------------------------------------------------------ the frames */

  return (
    <>
      <DeskTopBar crumb={props.dayLine} actions={props.actions} />
      <div className="vx-pmain">
        {props.unavailable ? (
          <div role="status" style={{ margin: "12px 18px 0", fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{tx(T.couldNotRead)}</div>
        ) : null}

        {/* The phone, top half: hero, what needs you, the calls, quick actions and today's small widgets.
            The phone frame sets its text at 1.4, a touch under the kit's 1.45. */}
        <div className="only-m" style={{ lineHeight: 1.4 }}>
          <PhoneHero {...props} hello={greeting} statusText={statusText} closed={closed} />
          <PhoneNeeds inbox={inbox} incomplete={inboxIncomplete} />
          <PhoneCalls money={money} promisedToday={props.promisedToday} />
          {props.officeWork ? <div style={{ padding: "16px 18px 0" }}>{props.officeWork}</div> : null}
          <PhoneQuick actions={props.actions} />
          {birthdays.length || coming.length ? (
            <div style={{ padding: "16px 18px 0", display: "flex", flexDirection: "column", gap: 16 }}>
              {birthdays.length ? <BirthdaysWidget kids={birthdays} /> : null}
              {coming.length ? <ComingWidget items={coming} /> : null}
            </div>
          ) : null}
          <ReadyForYou wrap={{ padding: "16px 18px 0" }} />
          <TodayBrief facts={briefFacts} style={{ padding: "16px 18px 0" }} />
        </div>

        {/* The school day and action queue share the first row. On a desk the fee analysis follows
            the teaching cards in the wide column while the rail runs beside both. */}
        <div className="td-grid">
          <div className="td-wide td-stack only-d">
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--mut)" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--acc)", animation: "xPulse 2.2s infinite" }} />
                  {tx(props.dayLine)}
                  {statusText}
                </span>
                <h2 className="serif" style={{ margin: 0, fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>{greeting}</h2>
              </div>
              {money ? (
                <div style={{ display: "flex", gap: 8 }}>
                  {props.links.reports ? <Link href="/reports" className="tap btn sec"><Ic n="receipt" />{tx(T.dayReport)}</Link> : null}
                  {props.links.collect ? <Link href="/payments" className="tap btn pri"><Ic n="rupee" />{tx(T.paymentDesk)}</Link> : null}
                </div>
              ) : null}
            </div>
            {closed ? <ClosedBanner closed={closed} today={props.today} /> : null}
            <DeskKpis {...props} avgDelta={avg?.deltaPct ?? null} />
          </div>
          <div className="td-stack td-main">
            {scheduleCard}
            {exceptionsCard}
            {/* A desk keeps the day's small widgets under the teaching cards, beside the rail. */}
            {birthdays.length || coming.length ? (
              <div className={`only-d${birthdays.length && coming.length ? " td-two" : ""}`} style={{ alignItems: "start" }}>
                {coming.length ? <ComingWidget items={coming} /> : null}
                {birthdays.length ? <BirthdaysWidget kids={birthdays} /> : null}
              </div>
            ) : null}
          </div>
          {/* On a desk the rail runs down beside the teaching cards and the money below them (today.css). */}
          <aside className="td-stack td-rail">
            <div className="only-d td-stack">
              {inbox ? <RailNeeds inbox={inbox} awaiting={awaiting} incomplete={inboxIncomplete} /> : null}
              <DeskQuick actions={props.actions} />
              {props.officeWork}
            </div>
            {laterTiles}
            <div className="only-d td-stack">
              <section className="card td-widget" style={{ animationDelay: ".15s" }}>
                <WidgetHead icon="flag" tone="acc" title={tx(T.todayAtSchool)} />
                <Timeline items={props.timeline} closed={schoolClosed} />
              </section>
              <ReadyForYou />
              <TodayBrief facts={briefFacts} />
            </div>
          </aside>
          <div className="td-stack td-main">
            {props.notice ? <div className="only-d">{props.notice}</div> : null}
            {moneyNote}
            {money ? (
              <section aria-label={tx(TD.financeToday)} className="only-d td-stack td-fees">
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{tx(TD.financeToday)}</h2>
                <DeskMoney money={money} pace={pace} today={props.today} noHeat={noHeat} />
              </section>
            ) : null}
          </div>
        </div>

        {/* The phone, lower half: the day's timeline and this session, then where the money is kept. */}
        <div className="only-m" style={{ lineHeight: 1.4, padding: "16px 18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          {timelineEmptyClosed ? null : (
            <section className="card td-widget">
              <WidgetHead icon="flag" tone="acc" title={tx(T.todayAtSchool)} />
              <Timeline items={props.timeline} closed={schoolClosed} phone />
            </section>
          )}
          <PhoneSession money={money} pace={pace} today={props.today} attendance={attendance} week={props.week ?? null} linkAttendance={props.links.attendance} />
          {props.notice ? <div className="vx-today-notice" style={{ padding: 0 }}>{props.notice}</div> : null}
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
      {actions.length ? <NewMenu actions={actions} looks={QUICK_LOOK} /> : null}
    </header>
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

/**
 * The away tile's line: "3 periods with no teacher" in warning colour while
 * any lesson is short, "2 of 2 periods covered" when none is, and "No cover
 * needed" only when nothing is needed — begun periods with nobody count.
 */
function CoverLine({ cover, color }: { cover: TodayProps["cover"]; color: string }) {
  const { tx } = useVx();
  if (!cover) return null;
  const standing = coverStanding(cover);
  if (standing.tone === "warn") {
    return <span style={{ fontSize: 12, fontWeight: 700, color: "var(--warnfg)", background: "var(--warns)", borderRadius: 6, padding: "1px 6px", alignSelf: "flex-start" }}>{tx(T.periodsShort(standing.short))} · {tx(T.periodsCovered(cover.arranged, cover.needed))}</span>;
  }
  return <span style={{ fontSize: 12, color }}>{standing.tone === "ok" ? tx(T.periodsCovered(cover.arranged, cover.needed)) : tx(T.noCoverNeeded)}</span>;
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

function PhoneHero(props: TodayProps & { hello: string; statusText: string; closed: TodayGlance["closed"] }) {
  const { tx } = useVx();
  const { money, cover, closed } = props;
  // On a closed day the register and cover tiles have nothing to say; the closed tile says why and when school opens.
  const attendance = closed ? null : props.attendance;
  const staffAway = closed ? null : props.staffAway;
  const heroCard: CSSProperties = { border: "1px solid var(--navb)", background: "var(--navs)", color: "var(--navfg)", borderRadius: 20 };
  const label: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", fontSize: 12, color: "var(--navm)" };
  // The design draws these tiles as buttons, which set their text at the browser's "normal" leading.
  const tileText: CSSProperties = { lineHeight: "normal" };
  return (
    <section style={{ background: "var(--nav)", color: "var(--navfg)", padding: "14px 18px 20px", borderRadius: "0 0 30px 30px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {/* Beside the app's name, not the school's: here the crest is the school's only mark, so it is named (T01). */}
          <Crest size={38} radius={12} named />
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
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--navm)" }}>
          <span aria-hidden="true" style={{ flex: "none", width: 8, height: 8, borderRadius: 4, background: HERO_TEAL, animation: "xPulse 2.2s infinite" }} />
          {tx(shortDay(props.today))}
          {props.statusText}
        </span>
        <h1 className="serif" style={{ margin: 0, fontSize: 30, fontWeight: 600, lineHeight: 1.12, color: "var(--navfg)" }}>{props.hello}</h1>
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {money ? (
          <div className="td-hero-card" style={{ ...heroCard, gridColumn: "1 / -1", padding: "14px 16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ fontSize: 12, color: "var(--navm)" }}>{tx(TD.feesCollectedToday)}</span>
              <span className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{rupees(money.today)}</span>
              <span style={{ fontSize: 12, color: "var(--navm)" }}>
                {receiptsLine(money, tx)}
                {money.source === "fees" && money.asOf ? ` · ${tx(TD.asOf(asOfTime(money.asOf)))}` : ""}
              </span>
            </span>
            {/* The week's running total rose to a high dot beside "₹0 today" and read as money coming in (UX review 6 Nov 2026). */}
            {money.today > 0 ? <Spark values={weekRunning(money, props.today)} w={128} h={54} color={HERO_TEAL} stroke={2.5} dot={4.5} end={[124, 6]} /> : null}
          </div>
        ) : props.ledgerToday && props.ledgerToday !== "failed" ? (
          <div className="td-hero-card" style={{ ...heroCard, gridColumn: "1 / -1", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 12, color: "var(--navm)" }}>{tx(TD.feesCollectedToday)}</span>
            <span className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{rupees(props.ledgerToday.total)}</span>
            <span style={{ fontSize: 12, color: "var(--navm)" }}>{tx(TD.ledgerLine(props.ledgerToday.count, asOfTime(props.ledgerToday.asOf)))}</span>
          </div>
        ) : props.ledgerToday === "failed" || props.moneyFailed ? (
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
        {staffAway !== null ? (
          <TileLink href={props.links.substitutions ? "/substitutions" : null} className="td-hero-card" style={{ ...heroCard, ...tileText, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={label}>
              {tx(T.teachersOnLeave)}
              {props.links.substitutions ? <Ic n="chevRight" size={16} /> : null}
            </span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{staffAway}</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cover && cover.needed > 0 ? <Dashes needed={cover.needed} arranged={cover.arranged} on={HERO_TEAL} off="var(--navb)" width={18} /> : null}
              <CoverLine cover={cover} color="var(--navm)" />
            </span>
          </TileLink>
        ) : null}
        {closed ? (
          <div className="td-hero-card" style={{ ...heroCard, gridColumn: "1 / -1", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <span aria-hidden="true" style={{ flex: "none", width: 46, height: 46, borderRadius: 23, background: HERO_TEAL, color: HERO_INK, display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
              <Ic n="sun" size={22} />
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>{tx(closedTitle(closed))}</span>
              {closed.reopens ? <span style={{ fontSize: 13, color: "var(--navm)" }}>{tx(TD.opensAgain(shortDay(closed.reopens), daysUntil(props.today, closed.reopens)))}</span> : null}
              <span style={{ fontSize: 12, color: "var(--navm)" }}>{tx(TD.closedRest)}</span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * "Families to call" under Needs you, not inside the hero: in the hero it pushed
 * the "Needs you" heading to the last line of the phone's first screen (UX
 * review 6 Nov 2026).
 */
function PhoneCalls({ money, promisedToday }: { money: TodayMoneyView | null; promisedToday?: number | null }) {
  const { tx } = useVx();
  if (!money) return null;
  return (
    <div style={{ padding: "16px 18px 0" }}>
      <Link href="/dues" className="tap lift" style={{ lineHeight: "normal", background: HERO_TEAL, color: HERO_INK, borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <span aria-hidden="true" style={{ flex: "none", width: 36, height: 36, borderRadius: 12, background: "rgba(8,47,73,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n="phone" />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.familiesToCall(money.followUps))}</span>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{tx(TD.callsSub(promisedToday ?? null))}</span>
        </span>
        <Ic n="chevRight" />
      </Link>
    </div>
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

function PhoneNeeds({ inbox, incomplete }: { inbox: InboxItem[] | null; incomplete: boolean }) {
  const { tx } = useVx();
  if (!inbox) return null;
  return (
    <section style={{ padding: "18px 18px 0" }}>
      <div className="card td-widget">
        <WidgetHead
          icon="inbox"
          tone={inbox.length > 0 ? "bad" : "ok"}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {tx(T.needsYou)}
              {inbox.length > 0 ? <CountPill n={inbox.length} /> : null}
            </span>
          }
          action={<WidgetLink href="/inbox" label={tx(T.seeAll)} />}
        />
        {inbox.length > 0 ? (
          <ul className="td-wlist" style={incomplete ? { marginBottom: 0 } : undefined}>
            {inbox.slice(0, 3).map((item, i) => (
              <li key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", animation: `xRise .44s var(--ease) ${i * 35}ms both` }}>
                <NeedTile item={item} size={42} radius={14} />
                <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tx(needTitle(item))}</span>
                  <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(item.sub)}</span>
                </Link>
                <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap btn soft" style={{ flex: "none", padding: "0 14px" }}>{tx(ACTION_OF[item.kind] ?? T.open)}</Link>
              </li>
            ))}
          </ul>
        ) : null}
        {incomplete ? <CouldNotRead partial={inbox.length > 0} /> : inbox.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, animation: "xIn .3s var(--ease) both" }}>
            <span aria-hidden="true" style={{ flex: "none", width: 38, height: 38, borderRadius: 19, background: "var(--oks)", color: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center", animation: "xPopIn .5s var(--spring) both" }}>
              <Ic n="check" />
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(T.allClear)}</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(TD.allClearSub)}</span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Clock time in the school's zone, for "as of 11:05". */
function asOfTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

/** Fees' own "Today" (Dashboard) figures, with when they were read; a failed read says so and offers Try again. */
function LedgerTodayCard({ today }: { today: LedgerToday | "failed" }) {
  const { tx } = useVx();
  if (today === "failed") return <CouldNotRead message={TD.feesUnavailable} />;
  return (
    <Card>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(TD.feesCollectedToday)}</span>
      <div className="num" style={{ fontSize: 28, fontWeight: 700, margin: "4px 0" }}>{rupees(today.total)}</div>
      <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(TD.ledgerLine(today.count, asOfTime(today.asOf)))}</span>
      {today.byMode.length ? (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 13 }}>
          {today.byMode.map((m) => <li key={m.label}><strong>{m.label}</strong> <span className="num">{rupees(m.amount)}</span> <span style={{ color: "var(--mut)" }}>· {m.count}</span></li>)}
        </ul>
      ) : null}
    </Card>
  );
}

function PhoneQuick({ actions }: { actions: TodayProps["actions"] }) {
  const { tx } = useVx();
  const four = actions.slice(0, 4);
  if (four.length === 0) return null;
  return (
    <section aria-label={tx(T.quickActions)} style={{ padding: "18px 18px 0" }}>
      <div className="td-mquick">
        {four.map((a, i) => {
          // Every tile the same shape, each in its action's own colour: none looks "chosen" over the others.
          const look = QUICK_LOOK[a.tone ?? "acc"];
          return (
            <Link key={a.key} href={a.href} className="tap rise card lift" style={{ padding: "12px 4px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--fg)", fontSize: 12, fontWeight: 600, textAlign: "center", lineHeight: 1.25, animationDelay: `${i * 35}ms` }}>
              <span aria-hidden="true" style={{ width: 46, height: 46, borderRadius: 15, background: look.bg, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={a.icon} size={22} />
              </span>
              {tx(TD.quickShort[a.key] ?? a.label)}
            </Link>
          );
        })}
      </div>
    </section>
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
    <>
      {money && pace ? (
        <section className="card td-widget">
          <WidgetHead icon="trend" tone="acc" title={tx(TD.feesThisSession)} sub={<span className="num">{tx(T.ofTotal(rupeesShort(money.collected), rupeesShort(money.expected)))}</span>} />
          <PaceBar pace={pace} />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--mut)" }}>
            <span className="num">{tx(T.pctCollected(pace.percent))}</span>
            <span>{tx(TD.shouldBeByToday(pace.shouldPercent))}</span>
          </div>
          <PaceWords pace={pace} today={today} size={13} />
        </section>
      ) : null}
      {bars ? (
        <TileLink href={linkAttendance ? "/attendance" : null} className="card td-widget" style={{ color: "var(--fg)" }}>
          <WidgetHead icon="calCheck" tone="info" title={tx(TD.attendanceThisWeek)} sub={tx(TD.presentShare)} action={linkAttendance ? <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} /> : undefined} />
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
    </>
  );
}

/* --------------------------------------------------------- the day, both */

function timelineLook(state: TimelineItem["state"]) {
  switch (state) {
    case "done":
      // A past item is quieter, but its time still reads at full contrast (axe, 7 Nov 2026).
      return { time: "var(--mut)", title: "var(--mut)", dot: "var(--bds)", ring: "0", pulse: false };
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
  if (!money && !attendance && props.staffAway === null) return null;
  return (
    <div className="td-kpis">
      {money ? (
        <TileLink href="/receipts" className="card lift" style={{ ...tile, animation: "xRise .45s var(--ease) both" }}>
          <span style={{ ...label, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%" }}>
            {tx(T.feesToday)}
            {props.avgDelta !== null && money.today > 0 && !props.beforeNoon ? (
              <span className="pill" style={{ background: up ? "var(--oks)" : "var(--bads)", color: up ? "var(--ok)" : "var(--bad)" }}>{tx(T.vsAvg(props.avgDelta))}</span>
            ) : null}
          </span>
          <span className="num" style={{ ...big, letterSpacing: "-0.02em" }}>{rupees(money.today)}</span>
          <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.receiptsSoFar(money.receiptsToday))}</span>
            {money.today > 0 ? <Spark values={weekRunning(money, props.today)} w={96} h={34} color="var(--acc)" stroke={2.4} dot={3.5} end={[92, 3]} /> : null}
          </span>
        </TileLink>
      ) : null}
      {attendance ? (
        // The heading has the tile's full width and the ring sits beside the count:
        // side by side with the ring, a narrow desktop column cut it to "Attendan" (smoke run, 20 Oct).
        <TileLink href={props.links.attendance ? "/attendance" : null} className="card lift" style={{ ...tile, animation: "xRise .45s .05s var(--ease) both" }}>
          <span style={label}>{tx(T.attendance)}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{ flex: "none", display: "flex" }}>
              <DrawnRing size={52} r={21} stroke={7} value={attendance.marked} max={Math.max(1, attendance.total)} tone={attendance.schoolOpen ? "var(--acc)" : "var(--s3)"} track="var(--s3)" />
            </span>
            <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15, minWidth: 0 }}>{attendance.schoolOpen ? `${attendance.marked}/${attendance.total}` : "—"}</span>
          </span>
          {/* Under the ring, with the tile's full width: beside it, the narrow
              1280px column broke "classes · 95% present" mid-word (smoke 21 Oct). */}
          <span style={{ fontSize: 12, color: "var(--mut)", minWidth: 0, overflowWrap: "normal", wordBreak: "normal" }}>
            {attendance.schoolOpen
              ? attendance.marked < attendance.total ? tx(TD.classesNotMarked(attendance.total - attendance.marked)) : tx(T.classesMarked)
              : tx(T.schoolClosed)}
            {attendance.schoolOpen && attendance.percent !== null ? ` · ${tx(T.presentPct(attendance.percent))}` : null}
          </span>
        </TileLink>
      ) : null}
      {props.staffAway !== null ? (
        <TileLink href={props.links.substitutions ? "/substitutions" : null} className="card lift" style={{ ...tile, animation: "xRise .45s .1s var(--ease) both" }}>
          <span style={label}>{tx(T.teachersOnLeave)}</span>
          <span className="num" style={big}>{props.staffAway}</span>
          {cover && cover.needed > 0 ? <Dashes needed={cover.needed} arranged={cover.arranged} on="var(--acc)" off="var(--s3)" width={22} /> : null}
          <CoverLine cover={cover} color="var(--mut)" />
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

function DeskQuick({ actions }: { actions: TodayProps["actions"] }) {
  const shortcuts = ["mark", "cover", "note", "certificate", "collect", "admit", "notice"]
    .flatMap((key) => actions.filter((action) => action.key === key)).slice(0, 4);
  if (!shortcuts.length) return null;
  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 16 }}><Bi {...T.quickActions} /></h3>
      <div className="td-shortcuts">
        {shortcuts.map((action) => (
          <Link key={action.key} href={action.href} className="tap td-shortcut">
            <Ic n={action.icon} size={17} style={{ flex: "none", color: "var(--accfg)" }} />
            <Bi {...action.label} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function RailNeeds({ inbox, awaiting, incomplete }: { inbox: InboxItem[]; awaiting: number; incomplete: boolean }) {
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
      {awaiting > 4 ? (
        <Link href="/inbox" className="tap btn ghost" style={{ justifyContent: "flex-start", paddingInline: 18, color: "var(--accfg)" }}>
          {tx(TD.moreInInbox(awaiting - 4))}
        </Link>
      ) : null}
      {incomplete ? (
        <div style={{ padding: "12px 18px 16px", borderTop: "1px solid var(--bd)" }}><CouldNotRead partial={awaiting > 0} /></div>
      ) : awaiting === 0 ? <div style={{ padding: "14px 18px 18px", fontSize: 13, color: "var(--mut)", borderTop: "1px solid var(--bd)" }}>{tx(TD.allClearRail)}</div> : null}
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
  const style: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" };
  return <li>{href ? <Link href={href} className="row tap" style={style}>{body}</Link> : <div style={style}>{body}</div>}</li>;
}

/* ------------------------------------------------------ the widget family */

/**
 * Every Today card opens the same way (7 Nov 2026): a coloured icon tile, a
 * plain title, an optional line under it and one link on the right. The
 * cards were drawn one by one before, and read as unrelated boxes.
 */
function WidgetHead({ icon, tone, title, sub, action, iconClass }: { icon: IconName; tone: WidgetTone; title: ReactNode; sub?: ReactNode; action?: ReactNode; iconClass?: string }) {
  const look = WIDGET_TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, width: "100%" }}>
      <span aria-hidden="true" className="td-wicon" style={{ background: look.bg, color: look.fg }}>
        <Ic n={icon} size={19} className={iconClass} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>{title}</h3>
        {sub ? <span style={{ fontSize: 12.5, color: "var(--mut)", lineHeight: 1.35 }}>{sub}</span> : null}
      </span>
      {action}
    </div>
  );
}

function WidgetLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="tap td-wlink">
      {label}
      <Ic n="chevRight" size={16} />
    </Link>
  );
}

/** A count with its line: Student support, Approvals. Same height side by side. */
function StatTile({ icon, tone, label, value, valueColor, sub, href }: { icon: IconName; tone: WidgetTone; label: string; value: ReactNode; valueColor?: string; sub: string; href: string | null }) {
  const look = WIDGET_TONE[tone];
  return (
    <TileLink href={href} className="card lift td-stat" style={{ animation: "xRise .45s .1s var(--ease) both" }}>
      {/* The label on its own line, so two tiles side by side keep their numbers level however long the label. */}
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span aria-hidden="true" className="td-wicon sm" style={{ background: look.bg, color: look.fg }}>
          <Ic n={icon} size={16} />
        </span>
        {href ? <Ic n="chevRight" size={18} style={{ flex: "none", color: "var(--sub)" }} /> : null}
      </span>
      <span className="clip" style={{ fontSize: 13, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
      <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: valueColor, marginTop: -4 }}>{value}</span>
      <span style={{ fontSize: 12.5, color: "var(--mut)", lineHeight: 1.35 }}>{sub}</span>
    </TileLink>
  );
}

/** How many to show before "+3 more": one row of names on a phone. */
const BIRTHDAYS_SHOWN = 4;

/**
 * Today's birthdays: each child a big tap target that opens their page. A
 * cake that wiggles twice on arrival is the widget's one flourish.
 */
function BirthdaysWidget({ kids }: { kids: readonly BirthdayChild[] }) {
  const { tx } = useVx();
  const [all, setAll] = useState(false);
  const shown = all ? kids : kids.slice(0, BIRTHDAYS_SHOWN);
  const hidden = kids.length - shown.length;
  return (
    <section className="card td-widget">
      <WidgetHead icon="cake" tone="warn" iconClass="td-cake" title={tx(TD.birthdaysToday)} sub={tx(TD.birthdaysSub(kids.length))} />
      <div className="td-kids">
        {shown.map((kid, i) => (
          <Link key={kid.id} href={`/students/${kid.id}`} className="tap td-kid" style={{ animation: `xPopIn .4s var(--spring) ${i * 50}ms both` }}>
            <Face className="av" student={kid.id} zoom={kid.name} zoomSub={kid.classLabel}>{firstName(kid.name).slice(0, 1).toUpperCase()}</Face>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.2 }}>
              <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{kid.name}</span>
              {kid.classLabel ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{kid.classLabel}</span> : null}
            </span>
          </Link>
        ))}
        {hidden > 0 ? (
          <button type="button" className="tap td-kid" onClick={() => setAll(true)} style={{ border: 0, padding: "4px 14px", fontWeight: 600, fontSize: 14, color: "var(--accfg)" }}>
            {tx(TD.moreBirthdays(hidden))}
          </button>
        ) : null}
      </div>
    </section>
  );
}

const COMING_LOOK: Record<ComingItem["kind"], WidgetTone> = { holiday: "ok", vacation: "ok", exam: "warn", event: "info" };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayParts = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return { date: d.getUTCDate(), month: d.getUTCMonth() };
};

/** "9–12 Nov", "30 Nov – 2 Dec", or one day's "Mon 7 Dec"; a Hindi reader's lead() says them in Hindi. */
function rangeText(from: string, to: string): string {
  if (from === to) return shortDay(from);
  const a = dayParts(from);
  const b = dayParts(to);
  return a.month === b.month ? `${a.date}–${b.date} ${MONTH_SHORT[b.month]}` : `${a.date} ${MONTH_SHORT[a.month]} – ${b.date} ${MONTH_SHORT[b.month]}`;
}

function daysUntil(today: string, day: string): number {
  return Math.round((new Date(`${day}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
}

/** What the next six weeks hold: holidays, breaks, exams and events, each with its date on a small calendar leaf. */
function ComingWidget({ items }: { items: readonly ComingItem[] }) {
  const { tx } = useVx();
  return (
    <section className="card td-widget">
      <WidgetHead icon="calendar" tone="info" title={tx(TD.comingUp)} sub={tx(TD.comingSub)} action={<WidgetLink href="/calendar" label={tx(TD.openCalendar)} />} />
      <ul className="td-wlist">
        {items.map((item, i) => {
          const look = WIDGET_TONE[COMING_LOOK[item.kind]];
          const start = dayParts(item.from);
          return (
            <li key={`${item.kind}-${item.from}-${item.en}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", animation: `xRise .4s var(--ease) ${i * 40}ms both` }}>
              <span className="td-date num" aria-hidden="true" style={{ background: look.bg, color: look.fg }}>
                <b>{start.date}</b>
                <span>{tx(p(MONTH_SHORT[start.month], TD.month[start.month].hi))}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{tx(p(item.en, item.hi ?? item.en))}</span>
                <span style={{ fontSize: 13, color: "var(--mut)" }}>
                  {tx(TD.comingKind[item.kind])} · {tx(rangeText(item.from, item.to))}
                </span>
              </span>
              <Pill tone={item.inDays <= 3 ? "acc" : "mut"} style={{ flex: "none" }}>{tx(TD.inDays(item.inDays))}</Pill>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function closedTitle(closed: NonNullable<TodayGlance["closed"]>): Pair {
  if (closed.en) return p(closed.en, closed.hi ?? closed.en);
  return closed.sunday ? TD.sundayClosed : TD.closedToday;
}

/** A desk's line under the greeting on a closed day: why, and when school opens again. */
function ClosedBanner({ closed, today }: { closed: NonNullable<TodayGlance["closed"]>; today: string }) {
  const { tx } = useVx();
  return (
    <div className="card" role="status" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, background: "var(--oks)", borderColor: "transparent", animation: "xRise .4s var(--ease) both" }}>
      <span aria-hidden="true" className="td-wicon" style={{ background: "var(--ok)", color: "var(--onsolid)", borderRadius: 19 }}>
        <Ic n="sun" size={20} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <strong style={{ fontSize: 16 }}>{tx(closedTitle(closed))}</strong>
        <span style={{ fontSize: 13, color: "var(--mut)" }}>
          {closed.reopens ? `${tx(TD.opensAgain(shortDay(closed.reopens), daysUntil(today, closed.reopens)))} · ` : ""}
          {tx(TD.closedRest)}
        </span>
      </span>
    </div>
  );
}
