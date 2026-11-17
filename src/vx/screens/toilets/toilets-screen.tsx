"use client";

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  addDays,
  buildWeek,
  type Chart,
  type ChartState,
  type Toilet,
  type ToiletSettings,
  type WeekRow,
} from "@/modules/toilets/domain/checks";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow } from "@/vx/ui/controls";
import { Banner, Section, TopBar, VxPage } from "@/vx/ui/page";
import { Btn, Card, EmptyState, IconTile, Kpi, Pill, SecHead, type Tone } from "@/vx/ui/primitives";

import { ManageSheet, PhotoSheet, UploadSheet } from "./sheets";
import { dayLabel, W, weekRange } from "./words";

/*
 * Toilet checks (owner, 17 Nov 2026, D-652). One week at a time: each toilet
 * with its chart's state (uploaded, still being checked, upload today, not
 * uploaded), the checks the uploader said were missed, and three buttons:
 * Print chart, Upload photo, See photo. What is waiting comes first, in a
 * card of its own, across the last eight weeks.
 */

export type GapRef = { toiletId: string; weekStart: string };

type Props = {
  sessionLabel: string;
  test: boolean;
  today: string;
  weeks: string[];
  initialWeek: string;
  toilets: Toilet[];
  charts: Chart[];
  settings: ToiletSettings;
  closedDays: string[];
  gaps: { late: GapRef[]; dueToday: GapRef[]; missedLastWeek: (GapRef & { count: number })[] };
  canUpload: boolean;
  canManage: boolean;
  openUpload: GapRef | null;
};

const STATE_TONE: Record<ChartState, Tone> = {
  done: "ok",
  this_week: "info",
  due_today: "warn",
  late: "bad",
  closed: "mut",
  not_needed: "mut",
};
const STATE_ICON = { done: "checkCircle", this_week: "clock", due_today: "upload", late: "alert", closed: "calMinus", not_needed: "minus" } as const;

export const chartHref = (weekStart: string, toiletId: string | "all") => `/toilets/chart?week=${weekStart}&toilet=${toiletId}`;

export function ToiletsScreen(props: Props) {
  const { tx } = useVx();
  const [week, setWeekState] = useState(props.initialWeek);
  const [upload, setUpload] = useState<{ toiletId: string; weekStart: string; key: number } | null>(
    props.openUpload ? { ...props.openUpload, key: 1 } : null,
  );
  const [photo, setPhoto] = useState<{ chartId: string } | null>(null);
  const [manage, setManage] = useState(false);
  // Each opening of the upload is a fresh sheet, with its own upload id.
  const uploads = useRef(1);

  const closed = useMemo(() => new Set(props.closedDays), [props.closedDays]);
  const isOpen = useMemo(() => (day: string) => !closed.has(day), [closed]);
  const board = useMemo(
    () => buildWeek({ toilets: props.toilets, charts: props.charts, weekStart: week, today: props.today, isOpen }),
    [props.toilets, props.charts, week, props.today, isOpen],
  );
  const active = props.toilets.filter((t) => !t.removedAt);
  const toiletName = (id: string) => props.toilets.find((t) => t.id === id)?.name ?? "—";
  const currentWeek = props.weeks[0];

  const setWeek = (next: string) => {
    cue("select");
    setWeekState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("week", next);
    url.searchParams.delete("upload");
    window.history.replaceState(window.history.state, "", url.toString());
  };

  const weekName = (w: string): Pair =>
    w === currentWeek ? W.thisWeek : w === addDays(currentWeek, -7) ? W.lastWeek : weekRange(w, addDays(w, 5));
  const lateIn = (w: string) => props.gaps.late.filter((g) => g.weekStart === w).length + props.gaps.dueToday.filter((g) => g.weekStart === w).length;

  const openUpload = (toiletId: string, weekStart: string) => {
    cue("tap");
    uploads.current += 1;
    setUpload({ toiletId, weekStart, key: uploads.current });
  };

  const chartFor = (toiletId: string, weekStart: string) => props.charts.find((c) => c.toiletId === toiletId && c.weekStart === weekStart) ?? null;
  const photoChart = photo ? props.charts.find((c) => c.id === photo.chartId) ?? null : null;
  const uploadToilet = upload ? props.toilets.find((t) => t.id === upload.toiletId) ?? null : null;

  const printAll = (
    <Btn icon="printer" href={chartHref(week, "all")} target="_blank" ariaLabel={tx(W.printAllHint)}>
      {tx(W.printAll)}
    </Btn>
  );
  const manageBtn = props.canManage ? (
    <Btn icon="settings" variant="ghost" onClick={() => { cue("tap"); setManage(true); }}>{tx(W.manage)}</Btn>
  ) : null;

  const gapsCount = props.gaps.late.length + props.gaps.dueToday.length + props.gaps.missedLastWeek.length;

  return (
    <VxPage label={tx(W.title)}>
      <TopBar
        crumb={tx(W.crumb)}
        title={tx(W.title)}
        mBack="/menu"
        actions={active.length ? <span style={{ display: "flex", gap: 8 }}>{manageBtn}{printAll}</span> : manageBtn}
        mAction={props.canManage ? (
          <button type="button" className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }} aria-label={tx(W.manage)} onClick={() => { cue("tap"); setManage(true); }}>
            <Ic n="settings" size={22} />
          </button>
        ) : undefined}
      />
      <Section>
        {props.test ? <Banner tone="warn">{tx(W.testYear)}</Banner> : null}

        {active.length === 0 ? (
          <EmptyState
            icon="toilet"
            title={tx(W.noToilets)}
            body={tx(props.canManage ? W.noToiletsBody : W.noToiletsAsk)}
            action={props.canManage ? <Btn variant="pri" big icon="plus" onClick={() => setManage(true)}>{tx(W.addToilet)}</Btn> : undefined}
          />
        ) : (
          <>
            <p style={{ margin: 0, color: "var(--mut)", fontSize: 15, lineHeight: 1.5 }}>{tx(W.lead)}</p>

            {gapsCount > 0 ? (
              <Card style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, borderColor: "var(--warn)" }}>
                <SecHead>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Ic n="bell" size={18} /> {tx(W.gapsTitle)} <Pill tone="warn">{gapsCount}</Pill>
                  </span>
                </SecHead>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {props.gaps.dueToday.map((g) => (
                    <GapLine key={`d-${g.toiletId}-${g.weekStart}`} tone="warn" text={tx(W.gapDue(toiletName(g.toiletId), weekRange(g.weekStart, addDays(g.weekStart, 5))))}
                      action={props.canUpload ? <Btn variant="pri" icon="camera" onClick={() => openUpload(g.toiletId, g.weekStart)}>{tx(W.upload)}</Btn> : null} />
                  ))}
                  {props.gaps.late.slice(0, 8).map((g) => (
                    <GapLine key={`l-${g.toiletId}-${g.weekStart}`} tone="bad" text={tx(W.gapLate(toiletName(g.toiletId), weekRange(g.weekStart, addDays(g.weekStart, 5))))}
                      action={props.canUpload ? <Btn icon="camera" onClick={() => openUpload(g.toiletId, g.weekStart)}>{tx(W.upload)}</Btn> : null} />
                  ))}
                  {props.gaps.missedLastWeek.map((g) => {
                    const chart = chartFor(g.toiletId, g.weekStart);
                    return (
                      <GapLine key={`m-${g.toiletId}`} tone="warn" text={tx(W.gapMissed(toiletName(g.toiletId), g.count))}
                        action={chart ? <Btn icon="image" onClick={() => { cue("tap"); setPhoto({ chartId: chart.id }); }}>{tx(W.seePhoto)}</Btn> : null} />
                    );
                  })}
                </ul>
              </Card>
            ) : (
              <Banner tone="ok">{tx(W.allGood)}</Banner>
            )}

            <ChipRow label={tx(W.weeksLabel)}>
              {props.weeks.map((w) => (
                <Chip key={w} on={w === week} onClick={() => setWeek(w)} count={lateIn(w) || undefined}>
                  {tx(weekName(w))}
                </Chip>
              ))}
            </ChipRow>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <Kpi icon="upload" label={tx(W.kpi.uploaded)} value={tx(W.kpi.uploadedOf(board.uploaded, board.expected))} sub={tx(weekName(week))} tone={board.uploaded === board.expected ? "var(--ok)" : undefined} />
              <Kpi icon="alert" label={tx(W.kpi.missed)} value={String(board.missedChecks)} sub={tx(W.kpi.missedSub(board.rows.filter((r) => r.state === "done").reduce((n, r) => n + r.checks, 0)))} tone={board.missedChecks ? "var(--bad)" : undefined} />
              <Kpi icon="calendar" label={tx(W.kpi.late)} value={String(props.gaps.late.length)} sub={tx(W.kpi.lateSub)} tone={props.gaps.late.length ? "var(--bad)" : undefined} />
            </div>

            <span className="only-m" style={{ display: "contents" }}>
              <Btn icon="printer" full href={chartHref(week, "all")} target="_blank">{tx(W.printAll)}</Btn>
            </span>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {board.rows.map((row, i) => (
                <ToiletCard
                  key={row.toilet.id}
                  row={row}
                  delay={i * 40}
                  canUpload={props.canUpload}
                  onUpload={() => openUpload(row.toilet.id, row.weekStart)}
                  onPhoto={() => { cue("tap"); if (row.chart) setPhoto({ chartId: row.chart.id }); }}
                />
              ))}
            </div>

            <HowItWorks />
          </>
        )}
      </Section>

      {upload && uploadToilet ? (
        <UploadSheet
          key={upload.key}
          sessionLabel={props.sessionLabel}
          test={props.test}
          toilet={uploadToilet}
          weekStart={upload.weekStart}
          isOpen={isOpen}
          replacing={chartFor(upload.toiletId, upload.weekStart) !== null}
          onClose={() => setUpload(null)}
        />
      ) : null}
      {photo && photoChart ? (
        <PhotoSheet
          sessionLabel={props.sessionLabel}
          chart={photoChart}
          toiletName={toiletName(photoChart.toiletId)}
          canManage={props.canManage}
          canUpload={props.canUpload}
          onUploadAgain={() => { setPhoto(null); openUpload(photoChart.toiletId, photoChart.weekStart); }}
          onClose={() => setPhoto(null)}
        />
      ) : null}
      {manage ? (
        <ManageSheet sessionLabel={props.sessionLabel} test={props.test} toilets={active} settings={props.settings} onClose={() => setManage(false)} />
      ) : null}
    </VxPage>
  );
}

function GapLine({ tone, text, action }: { tone: "bad" | "warn"; text: string; action: ReactNode }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: `var(--${tone})`, flex: "none" }} aria-hidden="true" />
      <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 15, overflowWrap: "anywhere" }}>{text}</span>
      {action}
    </li>
  );
}

/* The icon stays beside the words: the words are one span, so a narrow card wraps them, never the icon onto a line of its own. */
const rowLine: CSSProperties = { fontSize: 14, color: "var(--mut)", display: "flex", alignItems: "flex-start", gap: 6 };
const rowIcon: CSSProperties = { flex: "none", display: "inline-flex", marginTop: 2 };

function ToiletCard({ row, delay, canUpload, onUpload, onPhoto }: { row: WeekRow; delay: number; canUpload: boolean; onUpload: () => void; onPhoto: () => void }) {
  const { tx } = useVx();
  const tone = STATE_TONE[row.state];
  const t = row.toilet;
  const chart = row.chart;
  const nextMonday = addDays(row.weekStart, 7);
  const when = chart ? stamp(chart.storedAt) : null;

  return (
    <article className="card rise" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, animationDelay: `${delay}ms`, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <IconTile icon="toilet" tone={tone === "mut" ? "mut" : "pri"} size={44} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.25, overflowWrap: "anywhere" }}>{t.name}</h2>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {tx(W.usedBy[t.usedBy])}{t.place ? ` · ${t.place}` : ""}
          </span>
        </div>
        <Pill tone={tone} icon={STATE_ICON[row.state]}>{tx(W.state[row.state])}</Pill>
      </div>

      {chart && when ? (
        <>
          <span style={rowLine}><span style={rowIcon}><Ic n="user" size={15} /></span><span>{tx(W.uploadedBy(chart.uploadedByName, when))} · {tx(W.pages(chart.pages))}</span></span>
          <span style={{ ...rowLine, color: row.missed.length ? "var(--bad)" : "var(--ok)", fontWeight: 600 }}>
            <span style={rowIcon}><Ic n={row.missed.length ? "alert" : "checkCircle"} size={15} /></span><span>{tx(W.missedLine(row.missed.length))}</span>
          </span>
          {row.missed.length ? (
            <span style={{ fontSize: 13, color: "var(--mut)" }}>
              {row.missed.map((m) => `${tx(dayLabel(m.day))} ${tx(W.slot[m.slot]).toLowerCase()}`).join(", ")}
            </span>
          ) : null}
        </>
      ) : row.state === "this_week" ? (
        <span style={rowLine}><span style={rowIcon}><Ic n="clock" size={15} /></span><span>{tx(W.checksSoFar(row.checks))} · {tx(W.dueBy(dayLabel(nextMonday)))}</span></span>
      ) : row.state === "due_today" || row.state === "late" ? (
        <span style={{ ...rowLine, color: row.state === "late" ? "var(--bad)" : "var(--warnfg)", fontWeight: 600 }}>
          <span style={rowIcon}><Ic n="alert" size={15} /></span><span>{tx(W.dueBy(dayLabel(nextMonday)))}</span>
        </span>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {row.state !== "closed" ? (
          <Btn icon="printer" href={chartHref(row.weekStart, t.id)} target="_blank" style={{ flex: "1 1 120px" }}>{tx(W.printChart)}</Btn>
        ) : null}
        {chart ? (
          <Btn icon="image" variant={canUpload ? "sec" : "pri"} onClick={onPhoto} style={{ flex: "1 1 120px" }}>{tx(W.seePhoto)}</Btn>
        ) : canUpload && row.state !== "closed" ? (
          <Btn icon="camera" variant={row.state === "this_week" ? "sec" : "pri"} onClick={onUpload} style={{ flex: "1 1 120px" }}>{tx(W.upload)}</Btn>
        ) : null}
      </div>
    </article>
  );
}

function HowItWorks() {
  const { tx } = useVx();
  return (
    <Card style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, background: "var(--s2)" }}>
      {W.how.map((step, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconTile icon={step.icon} tone="info" size={36} />
          <span style={{ fontSize: 14, lineHeight: 1.4 }}>{tx(step.text)}</span>
        </div>
      ))}
    </Card>
  );
}

/** "Mon 17 Nov, 4:05 pm", from a stored time, in IST. */
export function stamp(iso: string): Pair {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(d).toLowerCase();
  const label = dayLabel(day);
  return p(`${label.en}, ${time}`, `${label.hi}, ${time}`);
}
