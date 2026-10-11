"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";

import { periodNumber } from "@/modules/timetable/domain/periods";
import { rupees, rupeesShort, dayMonth } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { type IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";
import { Seg } from "@/vx/ui/controls";
import { TopBar, Section, Grid } from "@/vx/ui/page";
import {
  BarChart,
  Btn,
  Card,
  CardHead,
  Donut,
  EmptyState,
  HeatGrid,
  IconTile,
  Kpi,
  Pill,
  Progress,
  Ring,
} from "@/vx/ui/primitives";
import { dailySeries, vsAverage, yearPace } from "@/vx/screens/admin/logic";
import type { CoverException, ScheduledActivity, ScheduledPeriod, ScheduleView, ScheduledTeacher } from "@/vx/screens/admin/schedule";
import { T } from "@/vx/screens/admin/text";
import { TD } from "@/vx/screens/admin/today-text";
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
};

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
  actions: { key: string; label: Pair; icon: IconName; href: string }[];
  /** Which screens behind the tiles this reader may open; a tile they cannot open is not a link. */
  links: { collect: boolean; attendance: boolean; substitutions: boolean; review: boolean; timetable: boolean };
  unavailable: boolean;
};

const MODE_COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--pri)"];

const KIND_ICON: Record<InboxItem["kind"], { icon: IconName; tone: "warn" | "info" | "acc" | "ok" | "bad" }> = {
  not_marked: { icon: "calCheck", tone: "warn" },
  cover: { icon: "swap", tone: "info" },
  submission: { icon: "clipboard", tone: "acc" },
  confirmations: { icon: "ticks", tone: "ok" },
  refund: { icon: "rupee", tone: "acc" },
  job: { icon: "alert", tone: "bad" },
};

const ACTION_OF: Partial<Record<InboxItem["kind"], Pair>> = {
  not_marked: T.remind,
  cover: { en: "Assign", hi: "दें" },
  submission: T.review,
  confirmations: T.accept,
  refund: T.review,
};

/** Kinds the teaching-exceptions card already shows, so the approvals card does not repeat them. */
const TEACHING_KINDS: ReadonlySet<InboxItem["kind"]> = new Set(["not_marked", "cover"]);

export function TodayScreen(props: TodayProps) {
  const { tx } = useVx();
  const [range, setRange] = useState<"14" | "30">("30");
  const { money, attendance, inbox } = props;

  const series = money ? dailySeries(money.days, props.today, Number(range)) : [];
  const avg = money ? vsAverage(dailySeries(money.days, props.today, 30), props.today) : null;
  const pace = money ? yearPace({ expected: money.expected, collected: money.collected, dueSoFar: money.dueSoFar }) : null;
  const awaiting = inbox ? inbox.length : 0;
  const dataChanges = inbox
    ? inbox.reduce((n, item) => n + (item.kind === "submission" || item.kind === "confirmations" ? (item.submissionIds?.length ?? 1) : 0), 0)
    : 0;

  /* -------------------------------------------- 1. Scheduled now / Next */

  const scheduleCard =
    props.schedule || props.scheduleFailed ? (
      <Card>
        <CardHead
          title={tx(TD.scheduledNow)}
          sub={tx(TD.scheduledSub)}
          action={
            props.links.timetable ? (
              <Link href="/timetable" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap" }}>
                {tx(TD.fullDay)}
              </Link>
            ) : undefined
          }
        />
        <div style={{ marginTop: 12 }}>{props.schedule ? <ScheduleBody view={props.schedule} /> : <Quiet>{tx(T.couldNotRead)}</Quiet>}</div>
      </Card>
    ) : null;

  const timeline = (
    <Card>
      <CardHead title={tx(T.todayAtSchool)} />
      {props.timeline.length === 0 ? (
        <p style={{ margin: "12px 0 0", color: "var(--mut)", fontSize: 14 }}>{attendance && !attendance.schoolOpen ? tx(T.schoolClosed) : tx(T.noTimeline)}</p>
      ) : (
        <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column" }}>
          {props.timeline.map((item, i) => {
            const dot =
              item.state === "alert" ? "var(--warn)" : item.state === "now" ? "var(--acc)" : item.state === "done" ? "var(--sub)" : "transparent";
            return (
              <li key={`${item.time}-${i}`} style={{ display: "grid", gridTemplateColumns: "52px 18px minmax(0,1fr)", gap: 8, minHeight: 48 }}>
                <span className="num" style={{ fontSize: 13, color: item.state === "now" ? "var(--accfg)" : "var(--mut)", fontWeight: item.state === "now" ? 700 : 500 }}>{item.time}</span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ width: 11, height: 11, marginTop: 3, borderRadius: 6, background: dot, border: `2px solid ${dot === "transparent" ? "var(--sub)" : dot}` }} />
                  {i < props.timeline.length - 1 ? <span style={{ flex: 1, width: 2, background: "var(--bd)", marginTop: 3 }} /> : null}
                </span>
                <span style={{ display: "flex", flexDirection: "column", paddingBottom: 10 }}>
                  <strong style={{ fontSize: 14, fontWeight: 600 }}>{tx(item.title)}</strong>
                  {item.sub ? <span style={{ fontSize: 12.5, color: item.state === "alert" ? "var(--warnfg)" : "var(--mut)" }}>{item.state === "done" && !item.sub ? tx(T.done) : tx(item.sub)}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );

  /* ---------------------- 2–4. Exceptions, student support, approvals */

  const schoolKpis = (
    <Grid cols={4}>
      {attendance ? (
        <MaybeLink href={props.links.attendance ? "/attendance" : null} className="card rise tap lift" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <Ring value={attendance.marked} max={Math.max(1, attendance.total)} size={58} stroke={8} />
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(T.attendance)}</span>
            <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
              {attendance.marked}/{attendance.total}
            </span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {attendance.schoolOpen ? `${tx(T.classesMarked)} · ${tx(T.presentPct(attendance.percent))}` : tx(T.schoolClosed)}
            </span>
          </span>
        </MaybeLink>
      ) : null}
      {props.staffAway !== null ? (
        <Kpi
          label={tx(T.teachersOnLeave)}
          value={props.staffAway}
          href={props.links.substitutions ? "/substitutions" : undefined}
          icon="calMinus"
          sub={
            props.cover && props.cover.needed > 0 ? (
              <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ display: "flex", gap: 4 }} aria-hidden="true">
                  {Array.from({ length: Math.min(props.cover.needed, 8) }, (_, i) => (
                    <span key={i} style={{ width: 22, height: 5, borderRadius: 3, background: i < props.cover!.arranged ? "var(--acc)" : "var(--s3)" }} />
                  ))}
                </span>
                {tx(T.periodsCovered(props.cover.arranged, props.cover.needed))}
              </span>
            ) : (
              tx(T.noCoverNeeded)
            )
          }
        />
      ) : null}
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
          sub={dataChanges > 0 ? tx(TD.reviewChanges) : tx(TD.noDataChanges)}
        />
      ) : null}
    </Grid>
  );

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

  // The approvals card: what is waiting beyond the teaching day, compact. The
  // full queue is the inbox; attendance and cover are already shown above.
  const waiting = inbox ? inbox.filter((item) => !TEACHING_KINDS.has(item.kind)) : [];
  const needs = inbox ? (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 10px" }}>
        <CardHead
          title={tx(T.needsYou)}
          badge={awaiting > 0 ? <span className="num" style={{ fontSize: 12, fontWeight: 700, minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, background: "var(--s3)", color: "var(--fg)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{awaiting}</span> : undefined}
          action={<Link href="/inbox" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.openInbox)}</Link>}
        />
      </div>
      {props.links.review && dataChanges > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 16px 12px" }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{tx(TD.dataChanges(dataChanges))}</span>
          <Btn variant="soft" href="/collection/review" style={{ flex: "none" }}>{tx(TD.reviewChanges)}</Btn>
        </div>
      ) : null}
      {awaiting === 0 ? (
        <EmptyState icon="checkCircle" title={tx(T.allClear)} body={tx(T.allClearSub)} style={{ padding: "10px 16px 20px" }} />
      ) : (
        <>
          {waiting.slice(0, 2).map((item) => {
            const look = KIND_ICON[item.kind];
            const verb = ACTION_OF[item.kind] ?? T.open;
            return (
              <div key={item.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
                <IconTile icon={look.icon} tone={look.tone} size={34} />
                <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontWeight: 600, fontSize: 14 }}>{tx(item.title)}</span>
                  <span className="clip" style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(item.sub)}</span>
                </Link>
                <Btn variant="soft" href={`/inbox?item=${encodeURIComponent(item.id)}`} style={{ flex: "none" }}>
                  {tx(verb)}
                </Btn>
              </div>
            );
          })}
          {awaiting > Math.min(2, waiting.length) ? (
            <Link href="/inbox" className="tap" style={{ display: "block", padding: "10px 16px 14px", borderTop: "1px solid var(--bd)", fontSize: 13, color: "var(--mut)" }}>
              {tx(TD.moreInInbox(awaiting - Math.min(2, waiting.length)))}
            </Link>
          ) : null}
        </>
      )}
    </Card>
  ) : null;

  /* ----------------------------------------------------- 5. Money */

  const moneyKpis = money ? (
    <Grid cols={2}>
      <Kpi
        label={tx(T.feesToday)}
        value={rupees(money.today)}
        delta={avg?.deltaPct !== null && avg?.deltaPct !== undefined && money.today > 0 ? tx(T.vsAvg(avg.deltaPct)) : undefined}
        deltaTone={avg?.deltaPct !== null && (avg?.deltaPct ?? 0) < 0 ? "warn" : "ok"}
        sub={tx(T.receiptsSoFar(money.receiptsToday))}
        spark={dailySeries(money.days, props.today, 14).map((point) => point.amount)}
        href="/receipts"
        icon="rupee"
      />
      <Kpi label={tx(T.followUps)} value={money.followUps} href="/dues" icon="phone" sub={tx(T.followUpsSub)} />
    </Grid>
  ) : null;

  const paceCard =
    money && pace && money.expected > 0 ? (
      <Card>
        <CardHead title={tx(T.yearPace)} action={<span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.ofTotal(rupeesShort(money.collected), rupeesShort(money.expected)))}</span>} />
        <div style={{ position: "relative", marginTop: 14 }}>
          <Progress value={money.collected} max={money.expected} height={10} />
          <span aria-hidden="true" style={{ position: "absolute", top: -4, left: `${Math.min(100, pace.shouldPercent)}%`, width: 2, height: 18, background: "var(--fg)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--mut)", marginTop: 8 }}>
          <span>{tx(T.pctCollected(pace.percent))}</span>
          <span>{tx(T.shouldBe(pace.shouldPercent))}</span>
        </div>
        <p style={{ margin: "10px 0 0", fontWeight: 600, fontSize: 14, color: pace.behind > 0 ? "var(--warnfg)" : "var(--ok)" }}>
          {pace.behind > 0 ? tx(T.behindBy(rupees(pace.behind))) : tx(T.onPace)}
        </p>
      </Card>
    ) : null;

  const moneyCharts = money ? (
    <>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 18, alignItems: "start" }}>
        <Card>
          <CardHead
            title={tx(T.moneyTaken)}
            sub={avg ? tx(T.moneyTakenSub(rupees(avg.average), rupees(avg.best), avg.emptyDays)) : undefined}
            action={
              <Seg
                options={[
                  { value: "14", label: tx(T.days14) },
                  { value: "30", label: tx(T.days30) },
                ]}
                value={range}
                onChange={setRange}
                label={tx(T.moneyTaken)}
                style={{ width: 180 }}
              />
            }
          />
          <div style={{ marginTop: 14 }}>
            <BarChart
              data={series.map((point) => ({
                label: point.date === props.today ? tx(T.today) : dayMonth(point.date),
                value: point.amount,
                highlight: point.date === props.today,
                title: `${dayMonth(point.date)} · ${rupees(point.amount)}`,
              }))}
              avg={avg?.average}
              labelEvery={range === "30" ? 4 : 2}
            />
          </div>
        </Card>
        {paceCard ?? <span />}
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 18 }}>
        <Card>
          <CardHead title={tx(T.pendingByClass)} sub={tx(T.pendingByClassSub)} />
          <div style={{ marginTop: 10 }}>
            {money.matrix.length === 0 ? (
              <p style={{ margin: 0, color: "var(--mut)" }}>—</p>
            ) : (
              <HeatGrid
                rows={money.matrix.map((row) => row.classLabel)}
                cols={money.installments}
                cell={(r, c) => money.matrix.find((row) => row.classLabel === r)?.cells[c] ?? null}
                total={(r) => money.matrix.find((row) => row.classLabel === r)?.total ?? 0}
                caption={tx(T.pendingByClass)}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHead title={tx(T.howTheyPay)} sub={tx(T.howTheyPaySub)} />
          {money.modes.length === 0 || money.today <= 0 ? (
            <p style={{ margin: "16px 0 0", color: "var(--mut)" }}>{tx(T.nothingTakenToday)}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 12 }}>
              <Donut parts={money.modes.map((m, i) => ({ label: m.mode, value: m.amount, color: MODE_COLORS[i % MODE_COLORS.length] }))}>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <strong className="num" style={{ fontSize: 18 }}>{rupeesShort(money.today)}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(T.collected)}</span>
                </span>
              </Donut>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                {money.modes.map((m, i) => (
                  <li key={m.mode} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: MODE_COLORS[i % MODE_COLORS.length] }} />
                    <span style={{ flex: 1, textTransform: "capitalize" }}>{m.mode}</span>
                    <span className="num" style={{ color: "var(--mut)" }}>{m.receipts}</span>
                    <span className="num" style={{ fontWeight: 600 }}>{rupees(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  ) : null;

  const quick = props.actions.length ? (
    <Card>
      <CardHead title={tx(T.quickActions)} />
      <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 12 }}>
        {props.actions.map((a) => (
          <Link key={a.key} href={a.href} className="tap lift" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--bd)", minHeight: 52 }}>
            <IconTile icon={a.icon} tone="acc" size={34} />
            <span style={{ fontWeight: 600, fontSize: 14 }}><Bi en={a.label.en} hi={a.label.hi} /></span>
          </Link>
        ))}
      </div>
    </Card>
  ) : null;

  return (
    <>
      <TopBar crumb={props.dayLine} title={tx(T.today)} mTitle={tx(T.today)} mSub={props.dayLine} />
      <main>
        <Section gap={18}>
          {props.unavailable ? (
            <div role="status" style={{ fontSize: 13, color: "var(--warnfg)", background: "var(--warns)", padding: "8px 12px", borderRadius: 12 }}>{tx(T.couldNotRead)}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: "var(--mut)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--acc)" }} />
                {props.dayLine}
                {props.status ? ` · ${tx(props.status)}` : ""}
              </span>
              <h2 className="serif" style={{ margin: 0, fontSize: 32, fontWeight: 600, lineHeight: 1.15 }}>
                {tx(props.greeting)}, {props.firstName}
              </h2>
            </div>
            {money ? (
              <div style={{ display: "flex", gap: 10 }} className="only-d">
                <Btn icon="fileText" href="/reports">{tx(T.dayReport)}</Btn>
                {props.links.collect ? <Btn icon="rupee" variant="pri" href="/payments">{tx(T.paymentDesk)}</Btn> : null}
              </div>
            ) : null}
          </div>

          {/* 1 — the school day: who is scheduled now and next, beside the day's bells. */}
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 18, alignItems: "start" }}>
            {scheduleCard ?? <span />}
            {/* On a phone the bells follow the exceptions instead, so what needs doing comes first. */}
            <div className="only-d" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              {timeline}
            </div>
          </div>

          {/* 2–4 — teaching exceptions, student support, approvals. */}
          {schoolKpis}
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 18, alignItems: "start" }}>
            {exceptionsCard}
            {needs ?? <span />}
          </div>
          <div className="only-m" style={{ display: "flex", flexDirection: "column" }}>
            {timeline}
          </div>

          {/* 5 — money, for the readers who see it, below the school day. */}
          {money ? (
            <>
              {moneyKpis}
              {moneyCharts}
            </>
          ) : props.moneyFailed ? (
            <Card><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.couldNotRead)}</p></Card>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyHidden)}</p>
          )}
          {quick}
        </Section>
      </main>
    </>
  );
}

/* ------------------------------------------------------- Scheduled now */

function ScheduleBody({ view }: { view: ScheduleView }) {
  const { tx } = useVx();
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
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <PeriodList label={TD.now} period={view.now} now />
          {view.next ? (
            <PeriodList label={TD.next} period={view.next} />
          ) : (
            <Quiet>
              {tx(TD.lastPeriod)}
            </Quiet>
          )}
        </div>
      );
  }
}

function PeriodList({ label, period, now = false }: { label: Pair; period: ScheduledPeriod; now?: boolean }) {
  const { tx } = useVx();
  return (
    <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }} aria-label={`${tx(label)} · ${tx(TD.periodAt(period.number, period.starts, period.ends))}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
        <Pill tone={now ? "acc" : "mut"}>{tx(label)}</Pill>
        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{tx(TD.periodAt(period.number, period.starts, period.ends))}</span>
        {period.uncovered > 0 ? <Pill tone="warn" icon="alert">{tx(TD.needSubstitute(period.uncovered))}</Pill> : null}
      </div>
      {period.activities.length === 0 ? (
        <Quiet>{tx(TD.nothingThisPeriod)}</Quiet>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 340, overflowY: "auto", borderTop: "1px solid var(--bd)" }}>
          {period.activities.map((activity) => (
            <ActivityRow key={activity.key} activity={activity} />
          ))}
        </ul>
      )}
    </section>
  );
}

const KIND_LABEL: Record<Exclude<ScheduledActivity["kind"], "single">, Pair> = {
  combined: TD.combined,
  shared: TD.shared,
  parallel: TD.parallel,
};

function ActivityRow({ activity }: { activity: ScheduledActivity }) {
  const { tx } = useVx();
  return (
    <li style={{ display: "grid", gridTemplateColumns: "minmax(0,96px) minmax(0,1fr)", gap: 10, padding: "8px 2px", borderBottom: "1px solid var(--bd)" }}>
      <strong style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>{activity.classes.map((c) => c.label).join(", ")}</strong>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13.5, fontWeight: 600 }}>
          {activity.subjects.join(" / ")}
          {activity.kind !== "single" ? <Pill tone="info" style={{ fontSize: 11 }}>{tx(KIND_LABEL[activity.kind])}</Pill> : null}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {activity.teachers.map((teacher) => (
            <TeacherLine key={teacher.id} teacher={teacher} showSubject={activity.kind === "parallel"} />
          ))}
        </span>
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

function MaybeLink({ href, className, style, children }: { href: string | null; className: string; style: CSSProperties; children: ReactNode }) {
  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <div className={className.replace(/\b(tap|lift)\b/g, "").trim()} style={style}>
      {children}
    </div>
  );
}
