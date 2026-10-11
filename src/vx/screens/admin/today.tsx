"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";

import { rupees, rupeesShort, dayMonth } from "@/vx/format";
import { Bi, useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
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
  Progress,
  Ring,
} from "@/vx/ui/primitives";
import { dailySeries, vsAverage, yearPace } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";
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
  actions: { key: string; label: Pair; icon: IconName; href: string }[];
  /** Which screens behind the tiles this reader may open; a tile they cannot open is not a link. */
  links: { collect: boolean; attendance: boolean; substitutions: boolean };
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

export function TodayScreen(props: TodayProps) {
  const { tx } = useVx();
  const [range, setRange] = useState<"14" | "30">("30");
  const { money, attendance, inbox } = props;

  const series = money ? dailySeries(money.days, props.today, Number(range)) : [];
  const avg = money ? vsAverage(dailySeries(money.days, props.today, 30), props.today) : null;
  const pace = money ? yearPace({ expected: money.expected, collected: money.collected, dueSoFar: money.dueSoFar }) : null;
  const awaiting = inbox ? inbox.length : 0;

  const kpis = (
    <Grid cols={4}>
      {money ? (
        <Kpi
          label={tx(T.feesToday)}
          value={rupees(money.today)}
          delta={avg?.deltaPct !== null && avg?.deltaPct !== undefined && money.today > 0 ? tx(T.vsAvg(avg.deltaPct)) : undefined}
          deltaTone={avg?.deltaPct !== null && (avg?.deltaPct ?? 0) < 0 ? "warn" : "ok"}
          sub={tx(T.receiptsSoFar(money.receiptsToday))}
          spark={dailySeries(money.days, props.today, 14).map((p) => p.amount)}
          href="/receipts"
          icon="rupee"
        />
      ) : null}
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
      {money ? (
        <Kpi
          label={tx(T.followUps)}
          value={money.followUps}
          href="/dues"
          icon="phone"
          sub={tx(T.followUpsSub)}
        />
      ) : null}
    </Grid>
  );

  const needs = inbox ? (
    <Card pad={false} style={{ overflow: "hidden" }}>
      <div style={{ padding: "16px 18px 10px" }}>
        <CardHead
          title={tx(T.needsYou)}
          badge={awaiting > 0 ? <span className="num" style={{ fontSize: 12, fontWeight: 700, minWidth: 22, height: 22, padding: "0 6px", borderRadius: 11, background: "var(--bad)", color: "var(--onsolid)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{awaiting}</span> : undefined}
          action={<Link href="/inbox" className="tap" style={{ color: "var(--accfg)", fontWeight: 600, fontSize: 14 }}>{tx(T.openInbox)}</Link>}
        />
      </div>
      {inbox.length === 0 ? (
        <EmptyState icon="checkCircle" title={tx(T.allClear)} body={tx(T.allClearSub)} style={{ padding: "18px 16px 26px" }} />
      ) : (
        inbox.slice(0, 4).map((item) => {
          const look = KIND_ICON[item.kind];
          const verb = ACTION_OF[item.kind] ?? T.open;
          return (
            <div key={item.id} className="row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)" }}>
              <IconTile icon={look.icon} tone={look.tone} size={38} />
              <Link href={`/inbox?item=${encodeURIComponent(item.id)}`} className="tap" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clip" style={{ fontWeight: 600 }}>{tx(item.title)}</span>
                <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(item.sub)}</span>
              </Link>
              <Btn variant="soft" href={`/inbox?item=${encodeURIComponent(item.id)}`} style={{ flex: "none" }}>
                {tx(verb)}
              </Btn>
            </div>
          );
        })
      )}
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

          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 18, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
              {kpis}
              {money && money.followUps > 0 ? (
                <Link href="/dues" className="only-m card tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "var(--accs)" }}>
                  <IconTile icon="phone" tone="acc" size={38} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <strong>{tx(T.familiesToCall(money.followUps))}</strong>
                    <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(T.followUpsSub)}</span>
                  </span>
                  <Ic n="chevRight" size={18} />
                </Link>
              ) : null}
              <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {needs}
              </div>
              {money ? (
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
              ) : props.moneyFailed ? (
                <Card><p style={{ margin: 0, color: "var(--mut)" }}>{tx(T.couldNotRead)}</p></Card>
              ) : null}
              {money ? (
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
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>{tx(T.moneyHidden)}</p>
              )}
              {quick}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
              <div className="only-d" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {needs}
              </div>
              {timeline}
              {paceCard}
            </div>
          </div>
        </Section>
      </main>
    </>
  );
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
