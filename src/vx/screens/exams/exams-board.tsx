"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { agoP } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, Seg, Select, SwitchRow } from "@/vx/ui/controls";
import { Confirm, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { BarChart, Btn, Card, EmptyState, IconTile, Pill, Progress, Ring, SecHead, StackedBar } from "@/vx/ui/primitives";

import { cellMatches, type CellCounts, type CellFilter, type CellState } from "./domain/board";
import { GROUP_KEYS, GROUP_LABELS, type GroupKey } from "./domain/groups";
import { waLink } from "./domain/messages";
import { RemindSheet, reminderFor, type TeacherRowView } from "./remind";
import type { ActionResult } from "./save-types";
import { useAct } from "./use-act";

export type ExamsView = "list" | "grid" | "cell" | "sampark" | "entry" | "reportcards" | "preview" | "analysis" | "create" | "remind";

type Act<I> = (input: I) => Promise<ActionResult>;

type CellView = { paperId: string; state: CellState; entered: number; total: number; late: boolean; teacher: string | null };

export type ExamsProps = {
  view: ExamsView;
  manage: boolean;
  reports: boolean;
  scoped: boolean;
  fromName: string;
  sessionLabel: string;
  timeline: { id: string; name: Pair; dates: string; state: "now" | "done" | "later" | "past"; papers: number; sub: Pair }[];
  exam: {
    id: string;
    term: string;
    name: Pair;
    dates: string;
    open: boolean;
    dueLabel: string | null;
    entered: number;
    total: number;
    percent: number;
    notStarted: number;
    counts: CellCounts;
    graceGiven: number;
  } | null;
  activity: { id: string; text: Pair; at: string }[];
  bands: {
    key: GroupKey;
    label: Pair;
    subjects: { code: string; name: Pair }[];
    rows: { classId: string; label: string; teacher: string | null; children: number; percent: number; cells: Record<string, CellView> }[];
  }[];
  teachers: TeacherRowView[];
  cell: {
    paperId: string;
    classId: string;
    classLabel: string;
    subject: Pair;
    teacherId: string | null;
    teacherName: string | null;
    phoneMasked: string | null;
    maxMarks: number;
    entered: number;
    total: number;
    state: CellState;
    late: boolean;
    link: { url: string; createdAt: string; openedAt: string | null } | null;
    remindedAt: string | null;
    canEnter: boolean;
    classLocked: boolean;
    classReady: boolean;
    history: { text: Pair; at: string; tone: string }[];
  } | null;
  cards: {
    term: string;
    classes: { id: string; label: string; children: number; issued: number; locked: boolean }[];
    classId: string | null;
    students: { id: string; name: string; roll: string | null; issued: boolean }[];
  } | null;
  preview: {
    studentId: string;
    name: string;
    fatherName: string | null;
    classLabel: string;
    roll: string | null;
    admissionNo: string | null;
    issued: boolean;
    revision: number;
    remark: string | null;
    title: Pair;
    rows: { subject: Pair; outOf: number; scored: number; grade: string | null; grace: number }[];
    total: number;
    outOf: number;
    percent: number | null;
    grade: string | null;
    passed: boolean | null;
    attendance: number | null;
    prevId: string | null;
    nextId: string | null;
    position: number;
    of: number;
  } | null;
  analysis: {
    classes: { id: string; label: string }[];
    classId: string;
    classLabel: string;
    children: number;
    submitted: number;
    papers: number;
    subjects: { subjectCode: string; name: Pair; avgPct: number | null; sat: number }[];
    counted: number;
    passedAll: number;
    top: { studentId: string; name: string; percent: number }[];
    below: { studentId: string; name: string; fails: { subjectCode: string; value: number; maxMarks: number }[] }[];
    belowCount: number;
    prevName: Pair | null;
  } | null;
  terms: string[];
  actions: {
    remind: Act<{ examId: string; staffIds: string[] }>;
    marksLink: Act<{ examId: string; staffId: string; op: "make" | "renew" | "revoke" }>;
    lock: Act<{ examId: string; classIds: string[] }>;
    issueClass: Act<{ examId: string; classId: string; reissue?: boolean }>;
    create: Act<{
      nameEn: string;
      nameHi: string;
      term: string;
      kind: "formative" | "summative";
      startsOn: string;
      endsOn: string;
      marksDueOn: string;
      resultsOn: string;
      maxByGroup: Partial<Record<GroupKey, number>>;
      withPapers: boolean;
    }>;
  };
};

const STATE: Record<CellState, { label: Pair; color: string; soft: string }> = {
  locked: { label: p("Locked", "बंद"), color: "var(--pri)", soft: "var(--s2)" },
  done: { label: p("Done", "पूरा"), color: "var(--ok)", soft: "var(--oks)" },
  in_progress: { label: p("In progress", "जारी"), color: "var(--warn)", soft: "var(--infs, var(--s2))" },
  not_started: { label: p("Not started", "शुरू नहीं"), color: "var(--bad)", soft: "var(--bads, var(--s2))" },
  empty: { label: p("No children", "कोई बच्चा नहीं"), color: "var(--mut)", soft: "var(--s2)" },
};

const pct = (v: number) => `${Math.round(v)}%`;

export function ExamsBoard(props: ExamsProps) {
  const { view, exam, manage, reports } = props;
  const { tx } = useVx();
  const router = useRouter();
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindIds, setRemindIds] = useState<string[] | null>(null);
  const href = (v: ExamsView, extra = "") => `/exams?view=${v}${exam ? `&exam=${exam.id}` : ""}${extra}`;

  const titles: Record<ExamsView, Pair> = {
    list: p("Exams & marks", "परीक्षा व अंक"),
    grid: p("Marks tracker", "अंक ट्रैकर"),
    cell: props.cell ? { en: `${props.cell.classLabel} · ${props.cell.subject.en}`, hi: `${props.cell.classLabel} · ${props.cell.subject.hi ?? props.cell.subject.en}` } : p("Marks tracker", "अंक ट्रैकर"),
    sampark: p("Your marks links", "अंक लिंक"),
    entry: p("Enter marks", "अंक भरें"),
    reportcards: p("Report cards", "प्रगति पत्र"),
    preview: props.preview ? { en: props.preview.name } : p("Report card", "प्रगति पत्र"),
    analysis: p("Result analysis", "परिणाम विश्लेषण"),
    create: p("Exams & marks", "परीक्षा व अंक"),
    remind: p("Marks tracker", "अंक ट्रैकर"),
  };
  const examName = exam ? tx(exam.name) : "";
  const crumb =
    view === "list" || view === "create"
      ? `${tx(p("Academics", "शैक्षणिक"))} · ${tx(p("Session", "सत्र"))} ${props.sessionLabel}`
      : view === "preview"
        ? `${tx(p("Report card preview", "प्रगति पत्र"))} · ${props.preview?.classLabel ?? ""}`
        : `${tx(p("Exams", "परीक्षा"))} · ${examName}`;
  const back = view === "list" ? undefined : view === "cell" || view === "remind" ? href("grid") : view === "preview" ? href("reportcards", props.cards?.classId ? `&class=${props.cards.classId}` : "") : "/exams";

  const tabs: { v: ExamsView; label: Pair; show: boolean }[] = [
    { v: "grid", label: p("Tracker", "ट्रैकर"), show: true },
    { v: "sampark", label: p("Sampark", "संपर्क"), show: manage },
    { v: "reportcards", label: p("Cards", "कार्ड"), show: reports },
    { v: "analysis", label: p("Analysis", "विश्लेषण"), show: reports },
  ];
  const tabFor: Partial<Record<ExamsView, ExamsView>> = { grid: "grid", cell: "grid", remind: "grid", sampark: "sampark", reportcards: "reportcards", analysis: "analysis" };
  const tabBar =
    tabFor[view] && tabs.filter((t) => t.show).length > 1 ? (
      <Seg<ExamsView> label={tx(p("Part", "भाग"))} options={tabs.filter((t) => t.show).map((t) => ({ value: t.v, label: tx(t.label) }))} value={tabFor[view]!} onChange={(v) => router.push(href(v))} />
    ) : null;

  const actions = (
    <>
      {view === "list" && reports ? (
        <Btn variant="ghost" icon="chart" href={href("analysis")}>
          {tx(p("Result analysis", "परिणाम विश्लेषण"))}
        </Btn>
      ) : null}
      {view === "list" && manage ? (
        <Btn variant="pri" icon="plus" href="/exams?view=create">
          {tx(p("Create exam", "परीक्षा बनाएँ"))}
        </Btn>
      ) : null}
      {(view === "grid" || view === "cell") && manage ? (
        <Btn variant="ghost" icon="link" href={href("sampark")}>
          {tx(p("Sampark links", "संपर्क लिंक"))}
        </Btn>
      ) : null}
      {view === "reportcards" && props.cards?.classId && exam ? (
        <Btn variant="ghost" icon="printer" target="_blank" href={`/exams/report-card?class=${props.cards.classId}&term=${encodeURIComponent(exam.term)}`}>
          {tx(p("Print class", "पूरी कक्षा प्रिंट"))}
        </Btn>
      ) : null}
    </>
  );

  let body: React.ReactNode;
  if (!exam && view !== "list" && view !== "create") {
    body = <EmptyState icon="clipboard" title={tx(p("No exam has papers yet", "अभी किसी परीक्षा के पेपर नहीं"))} />;
  } else {
    switch (view) {
      case "grid":
      case "remind":
        body = <Grid {...props} href={href} onRemind={(ids) => { setRemindIds(ids); setRemindOpen(true); }} />;
        break;
      case "cell":
        body = (
          <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 16, alignItems: "start" }}>
            <div className="hide-m" style={{ minWidth: 0 }}>
              <Grid {...props} href={href} onRemind={(ids) => { setRemindIds(ids); setRemindOpen(true); }} compact />
            </div>
            <CellPanel {...props} href={href} onRemind={(id) => { setRemindIds([id]); setRemindOpen(true); }} />
          </div>
        );
        break;
      case "sampark":
        body = <Sampark {...props} />;
        break;
      case "reportcards":
        body = <ReportCards {...props} href={href} />;
        break;
      case "preview":
        body = <Preview {...props} href={href} />;
        break;
      case "analysis":
        body = <Analysis {...props} href={href} />;
        break;
      default:
        body = <ExamList {...props} href={href} />;
    }
  }

  const remindList = props.teachers.filter((t) => (remindIds ? remindIds.includes(t.id) : t.late || t.notStarted));

  return (
    <VxPage>
      <TopBar crumb={crumb} title={tx(titles[view])} mTitle={tx(titles[view])} mSub={view === "list" ? props.sessionLabel : examName} mBack={back} actions={actions} />
      <main>
        <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {tabBar}
          {body}
        </section>
      </main>
      {exam && manage ? (
        <RemindSheet
          open={(remindOpen || view === "remind") && remindList.length > 0}
          onClose={() => {
            setRemindOpen(false);
            setRemindIds(null);
            if (view === "remind") router.replace(href("grid"));
          }}
          teachers={remindList}
          exam={{ id: exam.id, en: exam.name.en, hi: exam.name.hi ?? exam.name.en }}
          dueLabel={exam.dueLabel ?? "—"}
          from={props.fromName}
          remind={props.actions.remind}
        />
      ) : null}
      {manage ? <CreateSheet {...props} open={view === "create"} onClose={() => router.replace("/exams")} /> : null}
    </VxPage>
  );
}

type Href = (v: ExamsView, extra?: string) => string;

/* ------------------------------------------------------------- list */

function ExamList(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { exam, timeline, href } = props;
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <SecHead>
          {tx(p("Session", "सत्र"))} {props.sessionLabel} · {timeline.length} {tx(p("exams", "परीक्षाएँ"))}
        </SecHead>
        {timeline.length === 0 ? <EmptyState icon="calendar" title={tx(p("No exams this session yet", "इस सत्र अभी कोई परीक्षा नहीं"))} /> : null}
        {timeline.map((t) =>
          t.state === "now" && exam ? (
            <Card key={t.id} style={{ border: "2px solid var(--acc)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                <Ring value={exam.percent} max={100} size={96} stroke={10}>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <b className="num" style={{ fontSize: 22 }}>{exam.percent}%</b>
                    <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("entered", "भरे"))}</span>
                  </span>
                </Ring>
                <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--mut)" }}>
                    <Pill tone={exam.open ? "ok" : "mut"}>{tx(exam.open ? p("Marks entry open", "अंक भरना जारी") : p("Closed", "बंद"))}</Pill>
                    {exam.dates}
                    {exam.dueLabel ? ` · ${tx(p("due", "अंतिम"))} ${exam.dueLabel}` : ""}
                  </div>
                  <h2 className="serif" style={{ margin: 0, fontSize: 26 }}>{tx(exam.name)}</h2>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>
                    {tx(p(`${exam.entered.toLocaleString("en-IN")} of ${exam.total.toLocaleString("en-IN")} marks entered`, `${exam.total.toLocaleString("en-IN")} में से ${exam.entered.toLocaleString("en-IN")} अंक भरे`))}
                    {props.manage && exam.notStarted ? ` · ${tx(p(`${exam.notStarted} teachers not started`, `${exam.notStarted} शिक्षकों ने शुरू नहीं किया`))}` : ""}
                  </span>
                  <StateBar counts={exam.counts} legend={false} />
                </div>
              </div>
              <div className="g4" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                <Btn variant="pri" icon="grid" href={href("grid")}>{tx(p("Open marks tracker", "अंक ट्रैकर खोलें"))}</Btn>
                {props.manage ? <Btn variant="ghost" icon="link" href={href("sampark")}>{tx(p("Sampark links", "संपर्क लिंक"))}</Btn> : null}
                {props.reports ? <Btn variant="ghost" icon="file" href={href("reportcards")}>{tx(p("Report cards", "प्रगति पत्र"))}</Btn> : null}
                {props.reports ? <Btn variant="ghost" icon="chart" href={href("analysis")}>{tx(p("Analysis", "विश्लेषण"))}</Btn> : null}
              </div>
            </Card>
          ) : (
            <Link key={t.id} href={`/exams?view=grid&exam=${t.id}`} className="tap card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
              <IconTile icon={t.state === "done" ? "checkCircle" : "calendar"} tone={t.state === "done" ? "ok" : "mut"} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <b className="clip">{tx(t.name)}</b>
                <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>
                  {t.dates ? `${t.dates} · ` : ""}
                  {tx(t.sub)}
                </span>
              </span>
              <Pill tone={t.state === "done" ? "ok" : t.state === "later" ? "mut" : "info"}>
                {tx(t.state === "done" ? p("Results sent", "परिणाम भेजे") : t.state === "later" ? p("Not started", "शुरू नहीं") : p("Marks in", "अंक आए"))}
              </Pill>
              <Ic n="chevRight" size={18} />
            </Link>
          ),
        )}
      </div>
      {props.reports ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SecHead>{tx(p("Recent activity · who did what", "हाल की गतिविधि"))}</SecHead>
          {props.activity.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Nothing yet.", "अभी कुछ नहीं।"))}</span> : null}
          {props.activity.map((a) => (
            <div key={a.id} style={{ display: "flex", gap: 10, fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--acc)", marginTop: 6, flex: "none" }} />
              <span style={{ flex: 1 }}>{tx(a.text)}</span>
              <span style={{ color: "var(--mut)", whiteSpace: "nowrap" }}>{tx(agoP(a.at))}</span>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function StateBar({ counts, legend = true }: { counts: CellCounts; legend?: boolean }) {
  const { tx } = useVx();
  const order: CellState[] = ["locked", "done", "in_progress", "not_started"];
  return <StackedBar height={10} showLegend={legend} format={(v) => String(v)} parts={order.map((s) => ({ label: tx(STATE[s].label), value: counts[s], color: STATE[s].color }))} />;
}

/* ------------------------------------------------------------- grid */

function Grid(props: ExamsProps & { href: Href; onRemind: (ids: string[] | null) => void; compact?: boolean }) {
  const { tx } = useVx();
  const { exam, bands, href } = props;
  const [filter, setFilter] = useState<CellFilter>("all");
  if (!exam) return null;
  const c = exam.counts;
  const lateTeachers = props.teachers.filter((t) => t.late || t.notStarted);
  const filters: { v: CellFilter; label: Pair; n: number }[] = [
    { v: "all", label: p("All", "सभी"), n: c.all },
    { v: "not_started", label: STATE.not_started.label, n: c.not_started },
    { v: "in_progress", label: STATE.in_progress.label, n: c.in_progress },
    { v: "done", label: STATE.done.label, n: c.done },
    { v: "locked", label: STATE.locked.label, n: c.locked },
    { v: "late", label: p("Late", "देर"), n: c.late },
  ];
  const show = (cell: CellView) => cellMatches(filter, cell.state, cell.late);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {props.compact ? null : (
        <Card style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Ring value={exam.percent} max={100} size={72} stroke={8}>
            <b className="num">{exam.percent}%</b>
          </Ring>
          <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <b>
              {tx(p(`${exam.entered.toLocaleString("en-IN")} of ${exam.total.toLocaleString("en-IN")} marks entered`, `${exam.total.toLocaleString("en-IN")} में से ${exam.entered.toLocaleString("en-IN")} अंक भरे`))}
              {props.manage && exam.notStarted ? ` · ${tx(p(`${exam.notStarted} teachers not started`, `${exam.notStarted} शिक्षकों ने शुरू नहीं किया`))}` : ""}
            </b>
            <StateBar counts={c} />
          </div>
        </Card>
      )}
      {props.scoped ? <Banner tone="info">{tx(p("Your papers, and your own class if you are its class teacher.", "आपके पेपर, और आपकी कक्षा यदि आप कक्षा अध्यापक हैं।"))}</Banner> : null}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <ChipRow label={tx(p("Show", "दिखाएँ"))} style={{ flex: 1, minWidth: 0 }}>
          {filters.map((f) => (
            <Chip key={f.v} on={filter === f.v} count={f.n} onClick={() => setFilter(f.v)}>
              {tx(f.label)}
            </Chip>
          ))}
        </ChipRow>
        {props.manage && lateTeachers.length ? (
          <Btn variant="pri" icon="send" onClick={() => props.onRemind(null)}>
            {tx(p(`Remind all late teachers on WhatsApp (${lateTeachers.length})`, `सभी देर वाले शिक्षकों को याद दिलाएँ (${lateTeachers.length})`))}
          </Btn>
        ) : null}
      </div>
      {bands.length === 0 ? <EmptyState icon="grid" title={tx(p("No papers to show", "कोई पेपर नहीं"))} /> : null}
      {bands.map((band) => (
        <Card key={band.key} pad={false} style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 140 + band.subjects.length * 78 }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase" }}>{tx(band.label)}</th>
                {band.subjects.map((s) => (
                  <th key={s.code} style={{ padding: "10px 4px", fontWeight: 600, fontSize: 12, color: "var(--mut)" }}>{tx(s.name)}</th>
                ))}
                <th style={{ textAlign: "right", padding: "10px 14px", fontSize: 12, textTransform: "uppercase" }}>{tx(p("Done", "पूरा"))}</th>
              </tr>
            </thead>
            <tbody>
              {band.rows.map((row) => (
                <tr key={row.classId} style={{ borderTop: "1px solid var(--bd)" }}>
                  <td style={{ padding: "8px 14px", whiteSpace: "nowrap" }}>
                    <b>{row.label}</b>
                    <div className="clip" style={{ fontSize: 12, color: "var(--mut)", maxWidth: 140 }}>
                      {row.teacher ?? "—"} · {row.children}
                    </div>
                  </td>
                  {band.subjects.map((s) => {
                    const cell = row.cells[s.code];
                    if (!cell) return <td key={s.code} />;
                    const selected = props.cell?.paperId === cell.paperId;
                    return (
                      <td key={s.code} style={{ padding: 4, opacity: show(cell) ? 1 : 0.25 }}>
                        <CellChip cell={cell} selected={selected} href={href("cell", `&paper=${cell.paperId}`)} label={`${row.label} ${s.code}`} />
                      </td>
                    );
                  })}
                  <td className="num" style={{ textAlign: "right", padding: "8px 14px", fontWeight: 700, color: row.percent === 100 ? "var(--ok)" : undefined }}>{row.percent}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function CellChip({ cell, selected, href, label }: { cell: CellView; selected: boolean; href: string; label: string }) {
  const { tx } = useVx();
  const st = STATE[cell.state];
  const warn = cell.late && (cell.state === "not_started" || cell.state === "in_progress");
  return (
    <Link
      href={href}
      className="tap"
      aria-label={`${label}: ${tx(st.label)} ${cell.entered}/${cell.total}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        height: 40,
        minWidth: 66,
        borderRadius: 10,
        border: selected ? "2px solid var(--pri)" : "1px solid var(--bd)",
        background: cell.state === "done" ? "var(--oks)" : warn ? "var(--bads, var(--s2))" : "var(--s2)",
        color: cell.state === "done" ? "var(--ok)" : warn ? "var(--bad)" : "var(--fg)",
        fontWeight: 700,
        fontSize: 12,
      }}
    >
      {cell.state === "locked" ? (
        <Ic n="lock" size={14} />
      ) : cell.state === "done" ? (
        <Ic n="check" size={14} />
      ) : cell.state === "not_started" ? (
        warn ? <Ic n="alert" size={14} /> : <span className="num">0/{cell.total}</span>
      ) : cell.state === "empty" ? (
        "—"
      ) : (
        <>
          <span className="num">{cell.entered}/{cell.total}</span>
          <span style={{ width: 40, height: 3, borderRadius: 2, background: "var(--s3)", overflow: "hidden" }}>
            <span style={{ display: "block", height: 3, width: `${cell.total ? (cell.entered / cell.total) * 100 : 0}%`, background: st.color }} />
          </span>
        </>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------- cell */

function CellPanel(props: ExamsProps & { href: Href; onRemind: (id: string) => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const { pending, run } = useAct();
  const [lockOpen, setLockOpen] = useState(false);
  const { cell, exam, href } = props;
  if (!cell || !exam) {
    return (
      <Card>
        <EmptyState icon="grid" title={tx(p("Pick a class and subject", "कक्षा और विषय चुनें"))} />
      </Card>
    );
  }
  const percent = cell.total ? Math.round((cell.entered / cell.total) * 100) : 0;
  const teacherLate = props.teachers.find((t) => t.id === cell.teacherId);
  const copy = async () => {
    if (!cell.link) return;
    try {
      await navigator.clipboard.writeText(cell.link.url);
      toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) });
    } catch {
      toast.show({ text: cell.link.url });
    }
  };
  const enterHref = props.manage ? href("entry", `&paper=${cell.paperId}`) : `/teach/marks?paper=${cell.paperId}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }} className="hide-m">
        <Link href={href("grid")} className="tap icon-btn" aria-label={tx(p("Close", "बंद करें"))}>
          <Ic n="x" size={20} />
        </Link>
      </div>
      <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Ring value={percent} max={100} size={76} stroke={8} tone={STATE[cell.state].color}>
            <b className="num">{percent}%</b>
          </Ring>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <b className="serif" style={{ fontSize: 20 }}>
              {cell.classLabel} · {tx(cell.subject)}
            </b>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {cell.teacherName ?? tx(p("No teacher set", "शिक्षक तय नहीं"))} · {tx(p("out of", "पूर्णांक"))} {cell.maxMarks}
            </span>
            <b style={{ fontSize: 15 }}>{tx(p(`${cell.entered} of ${cell.total} entered`, `${cell.total} में से ${cell.entered} भरे`))}</b>
          </div>
        </div>
        <Pill tone={cell.state === "done" || cell.state === "locked" ? "ok" : cell.late ? "bad" : "warn"}>{tx(STATE[cell.state].label)}{cell.late && cell.state !== "done" && cell.state !== "locked" ? ` · ${tx(p("late", "देर"))}` : ""}</Pill>
        {props.manage ? (
          <div style={{ display: "flex", flexDirection: "column", fontSize: 13 }}>
            <Line k={p("Phone", "फ़ोन")} v={cell.phoneMasked || "—"} />
            <Line k={p("Reminded", "याद दिलाया")} v={cell.remindedAt ? tx(agoP(cell.remindedAt)) : "—"} />
            <Line
              k={p("Sampark link", "संपर्क लिंक")}
              v={cell.link ? `${tx(p("Active", "चालू"))}${cell.link.openedAt ? ` · ${tx(p("opened", "खोला"))} ${tx(agoP(cell.link.openedAt))}` : ` · ${tx(p("not opened", "नहीं खोला"))}`}` : tx(p("None yet", "अभी नहीं"))}
              tone={cell.link ? "var(--ok)" : undefined}
            />
          </div>
        ) : null}
      </Card>
      {props.manage && cell.teacherId && teacherLate && cell.state !== "done" && cell.state !== "locked" ? (
        <Btn variant="pri" big full icon="send" onClick={() => props.onRemind(cell.teacherId!)}>
          {tx(p(`Remind ${cell.teacherName ?? "the teacher"} on WhatsApp`, `${cell.teacherName ?? "शिक्षक"} को WhatsApp पर याद दिलाएँ`))}
        </Btn>
      ) : null}
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {props.manage && cell.teacherId ? (
          cell.link ? (
            <Btn variant="ghost" icon="copy" onClick={copy}>{tx(p("Copy link", "लिंक कॉपी"))}</Btn>
          ) : (
            <Btn variant="ghost" icon="link" disabled={pending} onClick={() => run(() => props.actions.marksLink({ examId: exam.id, staffId: cell.teacherId!, op: "make" }))}>
              {tx(p("Make link", "लिंक बनाएँ"))}
            </Btn>
          )
        ) : null}
        {cell.canEnter && cell.state !== "locked" ? (
          <Btn variant="ghost" icon="edit" href={enterHref}>
            {tx(props.manage ? p("Enter marks myself", "अंक खुद भरें") : p("Enter marks", "अंक भरें"))}
          </Btn>
        ) : null}
      </div>
      {props.manage ? (
        <Btn variant="ghost" full icon="lock" disabled={cell.classLocked || !cell.classReady || pending} onClick={() => setLockOpen(true)}>
          {cell.classLocked ? tx(p(`${cell.classLabel} is locked`, `${cell.classLabel} बंद है`)) : tx(p(`Lock ${cell.classLabel} marks`, `${cell.classLabel} के अंक बंद करें`))}
        </Btn>
      ) : null}
      {props.manage && !cell.classLocked && !cell.classReady ? (
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("A class can be locked once every subject teacher has sent marks.", "सभी विषय-अध्यापकों के अंक भेजने के बाद ही कक्षा बंद होती है।"))}</span>
      ) : null}
      <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SecHead>{tx(p("History", "इतिहास"))}</SecHead>
        {cell.history.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Nothing yet.", "अभी कुछ नहीं।"))}</span> : null}
        {cell.history.map((h, i) => (
          <div key={i} style={{ display: "flex", gap: 10, fontSize: 13, alignItems: "baseline" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: h.tone, flex: "none" }} />
            <span style={{ flex: 1 }}>{tx(h.text)}</span>
            <span style={{ color: "var(--mut)", whiteSpace: "nowrap" }}>{tx(agoP(h.at))}</span>
          </div>
        ))}
      </Card>
      <Confirm
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        busy={pending}
        title={tx(p(`Lock ${cell.classLabel}?`, `${cell.classLabel} बंद करें?`))}
        body={tx(p("Marks for every subject of this class are frozen. Changes after this need the admin to unlock.", "इस कक्षा के सभी विषयों के अंक रुक जाएँगे। बाद में बदलाव के लिए एडमिन को खोलना होगा।"))}
        confirmLabel={tx(p("Lock marks", "अंक बंद करें"))}
        onConfirm={() => run(() => props.actions.lock({ examId: exam.id, classIds: [cell.classId] }), () => setLockOpen(false))}
      />
    </div>
  );
}

function Line({ k, v, tone }: { k: Pair; v: string; tone?: string }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
      <span style={{ color: "var(--mut)" }}>{tx(k)}</span>
      <b style={{ color: tone, textAlign: "right" }}>{v}</b>
    </div>
  );
}

/* ------------------------------------------------------------- sampark */

function Sampark(props: ExamsProps) {
  const { tx } = useVx();
  const toast = useToast();
  const { pending, run } = useAct();
  const [revoke, setRevoke] = useState<TeacherRowView | null>(null);
  const { exam } = props;
  if (!exam) return null;
  const name = { id: exam.id, en: exam.name.en, hi: exam.name.hi ?? exam.name.en };
  const live = props.teachers.filter((t) => t.link).length;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) });
    } catch {
      toast.show({ text: url });
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Banner tone="info">
        {tx(p(
          "Each teacher gets one link for this exam. It opens only her own class-subjects, with no login. Renew a link if it was shared by mistake — the old one stops working.",
          "हर शिक्षक को इस परीक्षा का एक लिंक मिलता है। इसमें केवल उनके अपने कक्षा-विषय खुलते हैं, बिना लॉगिन। गलती से साझा हुआ हो तो नया बनाएँ — पुराना बंद हो जाएगा।",
        ))}
      </Banner>
      <SecHead>
        {tx(p(`${live} of ${props.teachers.length} teachers have a live link`, `${props.teachers.length} में से ${live} शिक्षकों के पास चालू लिंक`))}
      </SecHead>
      {props.teachers.length === 0 ? <EmptyState icon="link" title={tx(p("No teacher has papers in this exam", "इस परीक्षा में किसी शिक्षक के पेपर नहीं"))} /> : null}
      {props.teachers.map((t) => (
        <Card key={t.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <b>{t.name}</b>
              <div style={{ fontSize: 12, color: "var(--mut)" }}>
                {t.papers.map((x) => `${x.classLabel} ${x.subjectCode}`).join(" · ")}
              </div>
            </div>
            <Pill tone={t.link ? (t.link.openedAt ? "ok" : "info") : "mut"}>
              {t.link ? (t.link.openedAt ? `${tx(p("Opened", "खोला"))} ${tx(agoP(t.link.openedAt))}` : tx(p("Not opened yet", "अभी नहीं खोला"))) : tx(p("No link", "लिंक नहीं"))}
            </Pill>
          </div>
          <Progress value={t.entered} max={Math.max(1, t.total)} tone={t.late ? "var(--bad)" : "var(--ok)"} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {t.link ? (
              <>
                <Btn variant="ghost" icon="copy" onClick={() => copy(t.link!.url)}>{tx(p("Copy", "कॉपी"))}</Btn>
                <Btn variant="ghost" icon="send" href={waLink(t.phone, reminderFor(t, name, exam.dueLabel ?? "—", props.fromName, t.link.url))} disabled={!t.phone} target="_blank">
                  {tx(p("Send on WhatsApp", "WhatsApp पर भेजें"))}
                </Btn>
                <Btn variant="ghost" icon="refresh" disabled={pending} onClick={() => run(() => props.actions.marksLink({ examId: exam.id, staffId: t.id, op: "renew" }))}>
                  {tx(p("Renew", "नया बनाएँ"))}
                </Btn>
                <Btn variant="ghost" icon="x" disabled={pending} onClick={() => setRevoke(t)}>
                  {tx(p("Stop", "बंद करें"))}
                </Btn>
              </>
            ) : (
              <Btn variant="pri" icon="link" disabled={pending} onClick={() => run(() => props.actions.marksLink({ examId: exam.id, staffId: t.id, op: "make" }))}>
                {tx(p("Make link", "लिंक बनाएँ"))}
              </Btn>
            )}
          </div>
        </Card>
      ))}
      <Confirm
        open={Boolean(revoke)}
        onClose={() => setRevoke(null)}
        busy={pending}
        title={tx(p(`Stop ${revoke?.name ?? ""}'s link?`, `${revoke?.name ?? ""} का लिंक बंद करें?`))}
        body={tx(p("The link stops opening at once. She can still enter marks after signing in.", "लिंक तुरंत बंद हो जाएगा। साइन-इन करके वे अंक भर सकती हैं।"))}
        confirmLabel={tx(p("Stop link", "लिंक बंद करें"))}
        onConfirm={() => revoke && run(() => props.actions.marksLink({ examId: exam.id, staffId: revoke.id, op: "revoke" }), () => setRevoke(null))}
      />
    </div>
  );
}

/* ------------------------------------------------------------- report cards */

function ReportCards(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { pending, run } = useAct();
  const [issueOpen, setIssueOpen] = useState(false);
  const { cards, exam, href } = props;
  if (!cards || !exam) return null;
  const klass = cards.classes.find((c) => c.id === cards.classId) ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ChipRow label={tx(p("Class", "कक्षा"))}>
        {cards.classes.map((c) => (
          <Link key={c.id} href={href("reportcards", `&class=${c.id}`)} className={`tap chip${c.id === cards.classId ? " on" : ""}`}>
            {c.locked ? <Ic n="lock" size={13} /> : null}
            {c.label}
            <span className="num" style={{ fontSize: 11, opacity: 0.8 }}>{c.issued}/{c.children}</span>
          </Link>
        ))}
      </ChipRow>
      {klass ? (
        <Card style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <Ring value={klass.issued} max={Math.max(1, klass.children)} size={76} stroke={8} tone="var(--ok)">
            <b className="num">{klass.issued}/{klass.children}</b>
          </Ring>
          <div style={{ flex: 1, minWidth: 200 }}>
            <b className="serif" style={{ fontSize: 20 }}>{klass.label}</b>
            <div style={{ fontSize: 13, color: "var(--mut)" }}>
              {klass.locked ? tx(p("Marks locked — cards can be issued.", "अंक बंद — कार्ड जारी हो सकते हैं।")) : tx(p("Cards are issued once the class's marks are locked. Until then they are drafts.", "कक्षा के अंक बंद होने पर कार्ड जारी होते हैं। तब तक ये ड्राफ्ट हैं।"))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn variant="ghost" icon="printer" target="_blank" href={`/exams/report-card?class=${klass.id}&term=${encodeURIComponent(cards.term)}`}>{tx(p("Print all", "सब प्रिंट"))}</Btn>
            {props.manage ? (
              <Btn variant="pri" icon="file" disabled={!klass.locked || pending} onClick={() => setIssueOpen(true)}>
                {klass.issued ? tx(p("Issue again", "फिर से जारी करें")) : tx(p("Issue cards", "कार्ड जारी करें"))}
              </Btn>
            ) : null}
          </div>
        </Card>
      ) : (
        <EmptyState icon="file" title={tx(p("No classes in this exam", "इस परीक्षा में कोई कक्षा नहीं"))} />
      )}
      <Card pad={false}>
        {cards.students.map((s) => (
          <Link key={s.id} href={href("preview", `&class=${cards.classId}&student=${s.id}`)} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)" }}>
            <span className="num" style={{ width: 30, color: "var(--mut)", fontSize: 13 }}>{s.roll ?? "—"}</span>
            <span className="clip" style={{ flex: 1, fontWeight: 600 }}>{s.name}</span>
            <Pill tone={s.issued ? "ok" : "mut"}>{tx(s.issued ? p("Issued", "जारी") : p("Draft", "ड्राफ्ट"))}</Pill>
            <Ic n="chevRight" size={16} />
          </Link>
        ))}
      </Card>
      {klass ? (
        <Confirm
          open={issueOpen}
          onClose={() => setIssueOpen(false)}
          busy={pending}
          title={tx(p(`Issue ${klass.label} report cards?`, `${klass.label} के प्रगति पत्र जारी करें?`))}
          body={tx(p(`A card is made for each of ${klass.children} children from the locked marks. An issued card does not change by itself later.`, `${klass.children} बच्चों के कार्ड बंद अंकों से बनेंगे। जारी कार्ड बाद में अपने आप नहीं बदलता।`))}
          confirmLabel={tx(p("Issue", "जारी करें"))}
          onConfirm={() => run(() => props.actions.issueClass({ examId: exam.id, classId: klass.id, reissue: klass.issued > 0 }), () => setIssueOpen(false))}
        />
      ) : null}
    </div>
  );
}

function Preview(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { preview: c, exam, href, cards } = props;
  if (!c || !exam) return <EmptyState icon="file" title={tx(p("No report card yet", "अभी प्रगति पत्र नहीं"))} />;
  const go = (id: string | null) => (id ? href("preview", `&class=${cards?.classId ?? ""}&student=${id}`) : undefined);
  const [en, hi] = (c.remark ?? "").split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760, width: "100%", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn variant="ghost" icon="chevLeft" href={go(c.prevId)} disabled={!c.prevId} ariaLabel={tx(p("Previous child", "पिछला बच्चा"))} />
        <div style={{ flex: 1, textAlign: "center" }}>
          <b>{c.name}</b>
          <div style={{ fontSize: 12, color: "var(--mut)" }}>
            {tx(p(`${c.position} of ${c.of}`, `${c.of} में से ${c.position}`))} · {c.classLabel}
          </div>
        </div>
        <Btn variant="ghost" icon="chevRight" href={go(c.nextId)} disabled={!c.nextId} ariaLabel={tx(p("Next child", "अगला बच्चा"))} />
        <Btn variant="ghost" icon="printer" target="_blank" href={`/exams/report-card?student=${c.studentId}&term=${encodeURIComponent(exam.term)}`}>
          <span className="hide-m">{tx(p("Print this card", "यह कार्ड प्रिंट करें"))}</span>
        </Btn>
      </div>
      {!c.issued ? <Banner tone="warn">{tx(p("Draft — this card has not been issued. It shows the marks as they stand today.", "ड्राफ्ट — यह कार्ड जारी नहीं हुआ। आज के अंक दिखाता है।"))}</Banner> : null}
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ textAlign: "center", padding: 10, borderRadius: 10, background: "var(--s2)" }}>
          <b>{c.title.hi ?? c.title.en}</b>
          <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)" }}>{c.title.en}</div>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
          <Field2 k="छात्र / Student" v={c.name} />
          <Field2 k="पिता / Father" v={c.fatherName ?? "—"} />
          <Field2 k="कक्षा / Class" v={`${c.classLabel}${c.roll ? ` · Roll ${c.roll}` : ""}`} />
          <Field2 k="एस.आर. नं. / SR no." v={c.admissionNo ?? "—"} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--s2)", fontSize: 12 }}>
                <th style={{ textAlign: "left", padding: "8px 12px" }}>विषय<br />Subject</th>
                <th style={{ padding: 8 }}>पूर्णांक<br />Max</th>
                <th style={{ padding: 8 }}>प्राप्तांक<br />Marks</th>
                <th style={{ padding: 8 }}>ग्रेड<br />Grade</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.subject.en} style={{ borderTop: "1px solid var(--bd)" }}>
                  <td style={{ padding: "8px 12px" }}>
                    <b>{r.subject.en}</b>
                    {r.subject.hi ? <div style={{ fontSize: 12, color: "var(--mut)" }}>{r.subject.hi}</div> : null}
                  </td>
                  <td className="num" style={{ textAlign: "center", color: "var(--mut)" }}>{r.outOf}</td>
                  <td className="num" style={{ textAlign: "center", fontWeight: 700 }}>
                    {r.scored}
                    {r.grace ? <span style={{ fontSize: 11, color: "var(--warn)" }}> +{r.grace}G</span> : null}
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 600 }}>{r.grade ?? "—"}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid var(--bd)", background: "var(--s2)", fontWeight: 700 }}>
                <td style={{ padding: "8px 12px" }}>कुल · Total</td>
                <td className="num" style={{ textAlign: "center" }}>{c.outOf}</td>
                <td className="num" style={{ textAlign: "center" }}>{c.total}</td>
                <td style={{ textAlign: "center" }}>{c.grade ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <span>प्रतिशत / Percent: <b className="num">{c.percent === null ? "—" : `${c.percent}%`}</b></span>
          {c.attendance !== null ? <span>उपस्थिति / Attendance: <b className="num">{c.attendance}%</b></span> : null}
          {c.passed !== null ? <Pill tone={c.passed ? "ok" : "bad"}>{c.passed ? "उत्तीर्ण / Passed" : "अनुत्तीर्ण / Not passed"}</Pill> : null}
        </div>
        {c.remark ? (
          <div style={{ fontSize: 13, borderTop: "1px solid var(--bd)", paddingTop: 10 }}>
            <span style={{ color: "var(--mut)" }}>कक्षा अध्यापक की टिप्पणी / Class teacher&apos;s remark</span>
            <div>{hi || en}</div>
            {hi && en ? <div style={{ color: "var(--mut)" }}>{en}</div> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Field2({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--mut)" }}>{k}</div>
      <b>{v}</b>
    </div>
  );
}

/* ------------------------------------------------------------- analysis */

function Analysis(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { analysis: a, href } = props;
  if (!a) return <EmptyState icon="chart" title={tx(p("No marks to analyse yet", "विश्लेषण के लिए अभी अंक नहीं"))} />;
  const passPct = a.counted ? Math.round((a.passedAll / a.counted) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ChipRow label={tx(p("Class", "कक्षा"))}>
        {a.classes.map((c) => (
          <Link key={c.id} href={href("analysis", `&class=${c.id}`)} className={`tap chip${c.id === a.classId ? " on" : ""}`}>
            {c.label}
          </Link>
        ))}
      </ChipRow>
      {a.submitted < a.papers ? (
        <Banner tone="warn">{tx(p(`${a.papers - a.submitted} of ${a.papers} subjects still to send — these numbers will move.`, `${a.papers} में से ${a.papers - a.submitted} विषयों के अंक बाकी — ये आँकड़े बदलेंगे।`))}</Banner>
      ) : null}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 14, alignItems: "start" }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SecHead>{tx(p(`${a.classLabel} · subject averages`, `${a.classLabel} · विषय औसत`))}</SecHead>
          <BarChart height={220} format={pct} data={a.subjects.map((s) => ({ label: s.subjectCode, value: s.avgPct ?? 0, highlight: (s.avgPct ?? 100) < 50, title: `${tx(s.name)} ${s.avgPct ?? "—"}% · ${s.sat}` }))} />
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <Ring value={passPct} max={100} size={120} stroke={12} tone={passPct >= 80 ? "var(--ok)" : "var(--warn)"}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <b className="num" style={{ fontSize: 24 }}>{passPct}%</b>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("passed all", "सबमें उत्तीर्ण"))}</span>
            </span>
          </Ring>
          <span style={{ fontSize: 13, color: "var(--mut)", textAlign: "center" }}>
            {tx(p(`${a.passedAll} of ${a.counted} children passed every subject`, `${a.counted} में से ${a.passedAll} बच्चे हर विषय में उत्तीर्ण`))}
          </span>
        </Card>
      </div>
      <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>{tx(p("Top of the class", "कक्षा में सबसे आगे"))}</SecHead>
          {a.top.length === 0 ? <span style={{ color: "var(--mut)", fontSize: 13 }}>—</span> : null}
          {a.top.map((t, i) => (
            <div key={t.studentId} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="num" style={{ width: 22, color: "var(--mut)" }}>{i + 1}</span>
              <span className="clip" style={{ flex: 1 }}>{t.name}</span>
              <b className="num">{t.percent}%</b>
            </div>
          ))}
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SecHead>
            {tx(p("Below the pass line", "उत्तीर्ण रेखा से नीचे"))} · {a.belowCount}
          </SecHead>
          {a.below.length === 0 ? <span style={{ color: "var(--ok)", fontSize: 13 }}>{tx(p("Nobody — every child passed every subject.", "कोई नहीं — हर बच्चा हर विषय में उत्तीर्ण।"))}</span> : null}
          {a.below.map((b) => (
            <div key={b.studentId} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13 }}>
              <span className="clip" style={{ flex: 1, fontWeight: 600 }}>{b.name}</span>
              <span style={{ color: "var(--bad)" }}>{b.fails.map((f) => `${f.subjectCode} ${f.value}/${f.maxMarks}`).join(", ")}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- create */

function CreateSheet(props: ExamsProps & { open: boolean; onClose: () => void }) {
  const { tx } = useVx();
  const { pending, run } = useAct();
  const router = useRouter();
  const [nameEn, setNameEn] = useState("");
  const [nameHi, setNameHi] = useState("");
  const [term, setTerm] = useState(props.terms[0] ?? "Term 1");
  const [kind, setKind] = useState<"formative" | "summative">("formative");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [marksDueOn, setMarksDueOn] = useState("");
  const [resultsOn, setResultsOn] = useState("");
  const [withPapers, setWithPapers] = useState(true);
  const [max, setMax] = useState<Record<GroupKey, number>>({ pre: 25, c1_5: 50, c6_8: 80, c9_10: 80, c11_12: 70 });
  const ok = nameEn.trim().length > 1 && term && startsOn && endsOn;
  const submit = () =>
    run(
      () => props.actions.create({ nameEn: nameEn.trim(), nameHi: nameHi.trim(), term, kind, startsOn, endsOn, marksDueOn, resultsOn, maxByGroup: max, withPapers }),
      (r) => router.replace(`/exams?view=grid${typeof r.data?.id === "string" ? `&exam=${r.data.id}` : ""}`),
    );
  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      icon="plus"
      wide
      title={tx(p("Create exam", "परीक्षा बनाएँ"))}
      sub={tx(p(`Session ${props.sessionLabel}`, `सत्र ${props.sessionLabel}`))}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="ghost" onClick={props.onClose}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" icon="check" disabled={!ok || pending} onClick={submit}>{tx(p("Create exam", "परीक्षा बनाएँ"))}</Btn>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={tx(p("Name in English", "अंग्रेज़ी में नाम"))}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Unit Test 3" maxLength={80} />
          </Field>
          <Field label={tx(p("Name in Hindi", "हिंदी में नाम"))}>
            <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} placeholder="इकाई परीक्षा 3" maxLength={80} />
          </Field>
          <Field label={tx(p("Term", "टर्म"))}>
            <Select value={term} onChange={(e) => setTerm(e.target.value)}>
              {props.terms.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label={tx(p("Kind", "प्रकार"))}>
            <Seg<"formative" | "summative"> label={tx(p("Kind", "प्रकार"))} value={kind} onChange={setKind} options={[{ value: "formative", label: tx(p("Unit test", "इकाई परीक्षा")) }, { value: "summative", label: tx(p("Term exam", "सत्र परीक्षा")) }]} />
          </Field>
          <Field label={tx(p("First paper", "पहला पेपर"))}>
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label={tx(p("Last paper", "आखिरी पेपर"))}>
            <Input type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field label={tx(p("Marks due", "अंक देय"))}>
            <Input type="date" value={marksDueOn} min={endsOn || undefined} onChange={(e) => setMarksDueOn(e.target.value)} />
          </Field>
          <Field label={tx(p("Results day", "परिणाम दिवस"))}>
            <Input type="date" value={resultsOn} min={marksDueOn || undefined} onChange={(e) => setResultsOn(e.target.value)} />
          </Field>
        </div>
        <SwitchRow
          icon="grid"
          title={tx(p("Add papers from the timetable", "समय-सारणी से पेपर जोड़ें"))}
          sub={tx(p("One paper for each class-subject a teacher is assigned to. Sports and notebook checking are left out.", "हर कक्षा-विषय का एक पेपर जिसका शिक्षक तय है। खेल व कॉपी जाँच नहीं।"))}
          on={withPapers}
          onChange={setWithPapers}
        />
        {withPapers ? (
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
            {GROUP_KEYS.map((g) => (
              <Field key={g} label={`${tx(GROUP_LABELS[g])} · ${tx(p("out of", "पूर्णांक"))}`}>
                <Input type="number" inputMode="numeric" min={5} max={200} value={max[g]} onChange={(e) => setMax({ ...max, [g]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
