"use client";

import { Crest } from "@/vx/screens/system/brand";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import { Field, Input, Seg, Select, SwitchRow } from "@/vx/ui/controls";
import { Confirm, Sheet, useToast } from "@/vx/ui/overlays";
import { Banner, VxPage } from "@/vx/ui/page";
import { Btn, EmptyState } from "@/vx/ui/primitives";

import { Dot, ExamsTop, FactRow, LogLine, XBar, XRing, type TopAct } from "./bits";
import type { CellCounts, CellState } from "./domain/board";
import { GROUP_KEYS, GROUP_LABELS, subjectPair, type GroupKey } from "./domain/groups";
import { waLink } from "./domain/messages";
import { supportLine, weightsLine } from "./domain/card-words";
import { paperMix, progressLine, READINESS_LABEL, type ClassReadiness, type PaperReadiness } from "./domain/progress";
import { RemindSheet, reminderFor, type TeacherRowView } from "./remind";
import type { ActionResult } from "./save-types";
import { useAct } from "./use-act";
import { when } from "./when";
import { ResultsAssist } from "@/vx/assist/results-assist";

export type ExamsView = "list" | "grid" | "cell" | "sampark" | "entry" | "reportcards" | "preview" | "analysis" | "create" | "remind";

type Act<I> = (input: I) => Promise<ActionResult>;

type CellView = { paperId: string; state: CellState; entered: number; total: number; late: boolean; teacher: string | null; /** Saved marks the paper cannot hold. */ invalid?: number };

export type ExamsProps = {
  view: ExamsView;
  manage: boolean;
  /** `MARKS_FINALISERS` (D-262): who may lock a class's marks. */
  canFinalise: boolean;
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
  activity: { id: string; kind?: string; text: Pair; at: string }[];
  bands: {
    key: string;
    label: Pair;
    subjects: { code: string; name: Pair }[];
    rows: { classId: string; label: string; teacher: string | null; children: number; percent: number; cells: Record<string, CellView> }[];
  }[];
  /** The class the phone tracker opens on (`?class=`). */
  gridClassId?: string | null;
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
    /** Every paper of the class sent, every child marked, no mark its paper cannot hold. */
    classReady: boolean;
    /** This paper from its persisted marks and their validity (domain/progress.ts). */
    readiness?: PaperReadiness;
    /** Saved marks this paper cannot hold. */
    invalid?: number;
    /** Of the children on the paper: marked absent, excused, and with nothing yet. */
    absent?: number;
    exempt?: number;
    blank?: number;
    /** Whether a child may be excused from this paper, and whether that can still be switched off. */
    allowExempt?: boolean;
    exemptLocked?: boolean;
    classReadiness?: ClassReadiness;
    history: { text: Pair; at: string; tone: string }[];
  } | null;
  cards: {
    term: string;
    /** `remarks`: children whose card has the class teacher's remark. */
    classes: { id: string; label: string; children: number; issued: number; locked: boolean; teacher?: string | null; remarks?: number }[];
    classId: string | null;
    classTeacher?: string | null;
    subjects?: number;
    /**
     * The term card's own figures (`classTermCards`): the same percentage, grade and result the
     * card prints. `shortIn`: subjects below the pass mark or missed.
     */
    students: { id: string; name: string; roll: string | null; issued: boolean; percent?: number | null; grade?: string | null; passed?: boolean | null; shortIn?: string[]; missing?: string[]; absent?: number; remark?: boolean }[];
    /** This exam's papers of the class that keep its cards from being ready (`paperBlockers`). */
    blockers?: { subject: Pair; reason: "needs_correction" | "missing" | "not_sent"; count: number }[];
  } | null;
  preview: {
    /** The school's name as receipts and parent documents print it (`schoolProfile.name`). */
    school: string;
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
    /** `percent`: the row's own percentage, the one its grade comes from (weighted when the exams' weights differ). */
    /** `absent`: the exams this child missed, by `absentLine()` — they count as 0 (D-319), and the card says so beside the marks. */
    rows: { subject: Pair; outOf: number; scored: number; grade: string | null; percent?: number | null; grace: number; state?: "value" | "absent" | "missing" | "exempt"; absent?: string }[];
    /** The lines under the table, by `cardNotes()`: what * means, and why a subject is out of less. */
    notes?: { en: string; hi: string }[];
    total: number;
    outOf: number;
    percent: number | null;
    /** True when the exams' weights differ, so the percentage is not simply total ÷ out of (`totalsFor`). */
    weighted?: boolean;
    /** Each exam's weight when they differ, printed under the percentage so a parent can check it. */
    weights?: { name: Pair; weight: number }[];
    grade: string | null;
    passed: boolean | null;
    /** Subjects below the pass mark after grace, or missed without being excused (`cardResult`). */
    shortIn?: Pair[];
    attendance: number | null;
    present?: number | null;
    counted?: number | null;
    /** "1 day on leave · 1 day not marked", both languages (`attendanceNote`). */
    attendanceNote?: string | null;
    classTeacher?: string | null;
    coordinator?: string | null;
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
    /** The pass line as a share of the maximum, when every paper of the class has the same one. */
    passPct?: number;
    locked?: boolean;
  } | null;
  terms: string[];
  actions: {
    remind: Act<{ examId: string; staffIds: string[] }>;
    marksLink: Act<{ examId: string; staffId: string; op: "make" | "renew" | "revoke" }>;
    lock: Act<{ examId: string; classIds: string[] }>;
    issueClass: Act<{ examId: string; classId: string; reissue?: boolean }>;
    setExempt?: Act<{ paperId: string; allow: boolean }>;
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

/* The design's look for each cell state (Exams.dc.html `LOOK`). */
const LOOK: Record<CellState, { bg: string; fg: string; bd: string; icon: IconName; label: Pair }> = {
  locked: { bg: "var(--s2)", fg: "var(--mut)", bd: "var(--bd)", icon: "lock", label: p("Locked", "बंद") },
  done: { bg: "var(--oks)", fg: "var(--ok)", bd: "var(--okm)", icon: "check", label: p("Done", "पूरा") },
  in_progress: { bg: "var(--infos)", fg: "var(--info)", bd: "transparent", icon: "clock", label: p("In progress", "जारी") },
  not_started: { bg: "var(--bads)", fg: "var(--bad)", bd: "transparent", icon: "alert", label: p("Not started", "शुरू नहीं") },
  empty: { bg: "var(--s2)", fg: "var(--mut)", bd: "var(--bd)", icon: "minus", label: p("No children", "कोई बच्चा नहीं") },
};

/* The stacked bar's four parts: locked, done, in progress, not started. */
const PARTS: { state: Exclude<CellState, "empty">; color: string }[] = [
  { state: "locked", color: "var(--c1)" },
  { state: "done", color: "var(--c2)" },
  { state: "in_progress", color: "var(--c3)" },
  { state: "not_started", color: "var(--bad)" },
];

type Filter = "all" | "not_started" | "in_progress" | "done";
const shows = (filter: Filter, state: CellState) => filter === "all" || filter === state || (filter === "done" && state === "locked");

const nf = (n: number) => n.toLocaleString("en-IN");
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const display = (session: string) => session.replace(/(\d{4})-(\d{2})/, "$1–$2");

/* Layout the design keeps in its own stylesheet: rows that re-flow at the 900px container switch. */
const CSS = `
.xsr{display:grid;grid-template-columns:minmax(170px,1.1fr) minmax(190px,1.6fr) 150px 130px 168px;gap:12px;align-items:center;padding:10px 16px}
.xd+.xd{border-top:1px solid var(--bd)}
@container vx (max-width:899px){.xsr{grid-template-columns:minmax(0,1fr) auto;padding:14px}.xsr>:nth-child(2),.xsr>:nth-child(4),.xsr>:nth-child(5){grid-column:1/-1}.xsr>:nth-child(2){order:2}.xsr>:nth-child(4){order:3}.xsr>:nth-child(5){order:4;justify-content:flex-start!important}}
`;

export function ExamsBoard(props: ExamsProps) {
  const { view, exam, manage, reports } = props;
  const { tx } = useVx();
  const router = useRouter();
  const [remindIds, setRemindIds] = useState<string[] | null>(null);
  const href = (v: ExamsView, extra = "") => `/exams?view=${v}${exam ? `&exam=${exam.id}` : ""}${extra}`;
  const examName = exam ? tx(exam.name) : "";
  const cellOpen = view === "cell" && Boolean(props.cell);

  /* ------------------------------------------------ the top bar, per screen */
  const lateTeachers = props.teachers.filter((t) => t.late || t.notStarted);
  const notOpened = props.teachers.filter((t) => !t.link?.openedAt);
  const cardsClass = props.cards?.classes.find((c) => c.id === props.cards?.classId) ?? null;
  const ready = props.cards ? readyCards(props.cards) : 0;
  const examCrumb = `${tx(p("Exams", "परीक्षा"))} · ${examName}`;
  let top: { crumb: string; title: string; back?: string; acts: TopAct[]; mSub?: string; mBack?: string; mActs: TopAct[] };
  switch (view) {
    case "grid":
    case "cell":
    case "remind":
      top = {
        crumb: examCrumb,
        title: cellOpen && props.cell ? `${props.cell.classLabel} · ${tx(props.cell.subject)}` : tx(p("Marks tracker", "अंक ट्रैकर")),
        back: cellOpen ? href("grid") : "/exams",
        acts: manage ? [{ label: tx(p("Sampark links", "संपर्क लिंक")), icon: "link", href: href("sampark") }] : [],
        mSub: cellOpen && props.cell ? (props.cell.teacherName ?? "") : exam ? `${exam.percent}% ${tx(p("entered", "भरे"))}${exam.dueLabel ? ` · ${tx(p("due", "अंतिम"))} ${exam.dueLabel}` : ""}` : undefined,
        mBack: cellOpen ? href("grid") : "/exams",
        mActs: [],
      };
      break;
    case "sampark":
      top = {
        crumb: examCrumb,
        title: tx(p("Sampark links", "संपर्क लिंक")),
        back: "/exams",
        acts: manage && notOpened.length ? [{ label: tx(p(`Send links to ${notOpened.length} not opened`, `${notOpened.length} न खोले लिंक भेजें`)), icon: "send", variant: "pri", onClick: () => setRemindIds(notOpened.map((t) => t.id)) }] : [],
        mSub: tx(p(`${props.teachers.length} teachers · no login needed`, `${props.teachers.length} शिक्षक · लॉगिन की ज़रूरत नहीं`)),
        mBack: "/exams",
        mActs: manage && notOpened.length ? [{ label: tx(p(`Send ${notOpened.length}`, `${notOpened.length} भेजें`)), icon: "send", onClick: () => setRemindIds(notOpened.map((t) => t.id)) }] : [],
      };
      break;
    case "reportcards":
      top = {
        crumb: examCrumb,
        title: tx(p("Report cards", "प्रगति पत्र")),
        back: "/exams",
        acts: [],
        mSub: cardsClass ? tx(p(`${cardsClass.label} · ${ready} of ${cardsClass.children} ready`, `${cardsClass.label} · ${cardsClass.children} में से ${ready} तैयार`)) : examName,
        mBack: "/exams",
        mActs: [],
      };
      break;
    case "preview":
      top = {
        crumb: `${tx(p("Report card preview", "प्रगति पत्र झलक"))} · ${props.preview?.classLabel ?? ""}`,
        title: props.preview?.name ?? tx(p("Report card", "प्रगति पत्र")),
        back: href("reportcards", props.cards?.classId ? `&class=${props.cards.classId}` : ""),
        acts: [],
        mSub: props.preview ? `${props.preview.classLabel}${props.preview.roll ? ` · ${tx(p("Roll", "रोल"))} ${props.preview.roll}` : ""}` : undefined,
        mBack: href("reportcards", props.cards?.classId ? `&class=${props.cards.classId}` : ""),
        mActs: [],
      };
      break;
    case "analysis":
      top = {
        crumb: examCrumb,
        title: tx(p("Result analysis", "परिणाम विश्लेषण")),
        back: "/exams",
        acts: [],
        mSub: props.analysis ? `${props.analysis.classLabel} · ${examName}` : examName,
        mBack: "/exams",
        mActs: [],
      };
      break;
    default:
      top = {
        crumb: `${tx(p("Academics", "शैक्षणिक"))} · ${tx(p("Session", "सत्र"))} ${display(props.sessionLabel)}`,
        title: tx(p("Exams & marks", "परीक्षा व अंक")),
        acts: [
          ...(reports ? [{ label: tx(p("Result analysis", "परिणाम विश्लेषण")), icon: "chart" as const, href: href("analysis") }] : []),
          ...(manage ? [{ label: tx(p("Create exam", "परीक्षा बनाएँ")), icon: "plus" as const, variant: "pri" as const, href: "/exams?view=create" }] : []),
        ],
        mSub: exam ? `${examName} · ${exam.percent}% ${tx(p("marks entered", "अंक भरे"))}` : display(props.sessionLabel),
        mBack: "/menu",
        mActs: manage ? [{ label: tx(p("New exam", "नई परीक्षा")), icon: "plus", href: "/exams?view=create" }] : [],
      };
  }

  /* ------------------------------------------------ the four parts */
  const tabs: { v: ExamsView; label: Pair; show: boolean }[] = [
    { v: "grid", label: p("Tracker", "ट्रैकर"), show: true },
    { v: "sampark", label: p("Sampark", "संपर्क"), show: manage },
    { v: "reportcards", label: p("Cards", "कार्ड"), show: reports },
    { v: "analysis", label: p("Analysis", "विश्लेषण"), show: reports },
  ];
  const tabFor: Partial<Record<ExamsView, ExamsView>> = { grid: "grid", cell: "grid", remind: "grid", sampark: "sampark", reportcards: "reportcards", analysis: "analysis" };
  const shownTabs = tabs.filter((t) => t.show);
  const tabBar =
    tabFor[view] && shownTabs.length > 1 ? (
      <div className={`pad${cellOpen ? " hide-m" : ""}`} style={{ padding: "16px 28px 0" }}>
        <div className="mfull" style={{ width: 560, maxWidth: "100%" }}>
          <Seg<ExamsView> label={tx(p("Part", "भाग"))} options={shownTabs.map((t) => ({ value: t.v, label: tx(t.label) }))} value={tabFor[view]!} onChange={(v) => router.push(href(v))} />
        </div>
      </div>
    ) : null;

  let body: React.ReactNode;
  if (!exam && view !== "list" && view !== "create") {
    body = (
      <div className="pad" style={{ padding: "16px 28px 40px" }}>
        <EmptyState icon="clipboard" title={tx(p("No exam has papers yet", "अभी किसी परीक्षा के पेपर नहीं"))} />
      </div>
    );
  } else {
    switch (view) {
      case "grid":
      case "remind":
      case "cell":
        body = <Tracker {...props} href={href} cellOpen={cellOpen} onRemind={(ids) => setRemindIds(ids ?? lateTeachers.map((t) => t.id))} />;
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

  const remindOpen = remindIds !== null || (view === "remind" && lateTeachers.length > 0);
  const remindList = props.teachers.filter((t) => (remindIds ? remindIds.includes(t.id) : t.late || t.notStarted));

  return (
    <VxPage>
      <style href="vx-exams-board" precedence="default">{CSS}</style>
      <ExamsTop crumb={top.crumb} title={top.title} back={top.back} acts={top.acts} mSub={top.mSub} mBack={top.mBack} mActs={top.mActs} />
      <main>
        {tabBar}
        {body}
      </main>
      {exam && manage ? (
        <RemindSheet
          open={remindOpen && remindList.length > 0}
          onClose={() => {
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

function partsOf(counts: CellCounts) {
  const cells = counts.locked + counts.done + counts.in_progress + counts.not_started;
  return PARTS.map((x) => ({ key: x.state, w: cells ? (counts[x.state] / cells) * 100 : 0, color: x.color, n: counts[x.state], state: x.state }));
}

/* ------------------------------------------------------------- list */

const TIMELINE_LOOK: Record<"done" | "later" | "past", { bg: string; fg: string; dot: string; icon: IconName; pill: Pair }> = {
  done: { bg: "var(--oks)", fg: "var(--ok)", dot: "var(--ok)", icon: "checkCircle", pill: p("Results sent ✓", "परिणाम भेजे ✓") },
  later: { bg: "var(--s2)", fg: "var(--mut)", dot: "var(--bds)", icon: "calendar", pill: p("Not started", "शुरू नहीं") },
  past: { bg: "var(--infos)", fg: "var(--info)", dot: "var(--info)", icon: "calCheck", pill: p("Marks in", "अंक आए") },
};

const ACTIVITY_DOT: Record<string, string> = {
  locked: "var(--ok)",
  cards: "var(--ok)",
  results: "var(--ok)",
  published: "var(--ok)",
  submitted: "var(--acc)",
  grace: "var(--acc)",
  moderation: "var(--acc)",
  reminded: "var(--warn)",
  call: "var(--warn)",
  unlocked: "var(--warn)",
};

function ExamList(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { exam, timeline, href } = props;
  const parts = exam ? partsOf(exam.counts) : [];
  return (
    <div className="pad stack" style={{ padding: "22px 28px 40px", display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 22, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="sech" style={{ marginBottom: 10 }}>
          {tx(p("Session", "सत्र"))} {display(props.sessionLabel)} · {timeline.length} {tx(timeline.length === 1 ? p("exam", "परीक्षा") : p("exams", "परीक्षाएँ"))}
        </span>
        {timeline.length === 0 ? <EmptyState icon="calendar" title={tx(p("No exams this session yet", "इस सत्र अभी कोई परीक्षा नहीं"))} /> : null}
        {timeline.map((t, i) => {
          const hero = t.state === "now" && exam;
          const look = t.state === "now" ? null : TIMELINE_LOOK[t.state];
          const dot = hero ? "var(--acc)" : (look?.dot ?? "var(--bds)");
          return (
            <div key={t.id} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr)", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <span aria-hidden="true" style={{ width: 16, height: 16, marginTop: hero ? 26 : 22, borderRadius: 8, background: dot, border: "3px solid var(--bg)", boxShadow: `0 0 0 2px ${dot}`, animation: hero ? "xPulse 1.8s ease infinite" : undefined, boxSizing: "border-box" }} />
                <span aria-hidden="true" style={{ flex: 1, width: 2, marginTop: 4, background: i === timeline.length - 1 ? "transparent" : "var(--bd)" }} />
              </div>
              <div style={{ minWidth: 0, paddingBottom: 14 }}>
                {hero && exam ? (
                  <div className="card" style={{ padding: 20, borderColor: "var(--acc)", boxShadow: "var(--shh)", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18 }}>
                      <XRing pct={exam.percent} size={112} stroke={8.9}>
                        <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{exam.percent}%</span>
                        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("entered", "भरे"))}</span>
                      </XRing>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                          {exam.open ? (
                            <span className="pill" style={{ background: "var(--accs)", color: "var(--accfg)" }}>
                              <Dot color="var(--acc)" pulse />
                              {tx(p("Marks entry open", "अंक भरना जारी"))}
                            </span>
                          ) : (
                            <span className="pill" style={{ background: "var(--s3)", color: "var(--fg)" }}>{tx(p("Marks entry closed", "अंक भरना बंद"))}</span>
                          )}
                          <span style={{ fontSize: 12, color: "var(--mut)" }}>
                            {exam.dates}
                            {exam.dueLabel ? `${exam.dates ? " · " : ""}${tx(p("due", "अंतिम"))} ${exam.dueLabel}` : ""}
                          </span>
                        </div>
                        <span className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.1 }}>{tx(exam.name)}</span>
                        <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>
                          {tx(p(`${nf(exam.entered)} of ${nf(exam.total)} marks entered`, `${nf(exam.total)} में से ${nf(exam.entered)} अंक भरे`))}
                          {props.manage && exam.notStarted ? ` · ${tx(p(`${exam.notStarted} teachers not started`, `${exam.notStarted} शिक्षकों ने शुरू नहीं किया`))}` : ""}
                        </span>
                        <XBar height={10} parts={parts} style={{ marginTop: 4 }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <Link href={href("grid")} className="tap btn pri mfull" style={{ height: 46 }}>
                        <Ic n="grid" />
                        {tx(p("Open marks tracker", "अंक ट्रैकर खोलें"))}
                      </Link>
                      {props.manage ? <HeroLink href={href("sampark")} icon="link" label={tx(p("Sampark links", "संपर्क लिंक"))} /> : null}
                      {props.reports ? <HeroLink href={href("reportcards")} icon="file" label={tx(p("Report cards", "प्रगति पत्र"))} /> : null}
                      {props.reports ? <HeroLink href={href("analysis")} icon="chart" label={tx(p("Analysis", "विश्लेषण"))} /> : null}
                    </div>
                  </div>
                ) : (
                  <Link href={`/exams?view=grid&exam=${t.id}`} className="tap card lift" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px", color: "var(--fg)", textAlign: "left" }}>
                    <span style={{ flex: "none", width: 42, height: 42, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", background: look!.bg, color: look!.fg }}>
                      <Ic n={look!.icon} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(t.name)}</span>
                      <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>
                        {t.dates ? `${t.dates} · ` : ""}
                        {tx(t.sub)}
                      </span>
                    </span>
                    <span className="pill" style={{ background: look!.bg, color: look!.fg }}>{tx(look!.pill)}</span>
                    <Ic n="chevRight" style={{ color: "var(--sub)", flex: "none" }} />
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </section>
      {props.reports ? (
        <aside style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", padding: "14px 16px" }}>
            <span className="sech" style={{ marginBottom: 8 }}>{tx(p("Recent activity · who did what", "हाल की गतिविधि · किसने क्या किया"))}</span>
            {props.activity.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)", padding: "6px 0" }}>{tx(p("Nothing yet.", "अभी कुछ नहीं।"))}</span> : null}
            {props.activity.map((a) => (
              <LogLine key={a.id} dot={ACTIVITY_DOT[a.kind ?? ""] ?? "var(--info)"} text={tx(a.text)} time={tx(when(a.at, { short: true }))} />
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function HeroLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} className="tap btn sec" style={{ flex: 1 }}>
      <Ic n={icon} />
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------- tracker */

function Tracker(props: ExamsProps & { href: Href; cellOpen: boolean; onRemind: (ids: string[] | null) => void }) {
  const { tx, language: lang } = useVx();
  const { exam, bands, href, cellOpen } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const rows = bands.flatMap((b) => b.rows.map((r) => ({ band: b, row: r })));
  const firstOpen = rows.find(({ row }) => Object.values(row.cells).some((c) => c.state === "not_started" || c.state === "in_progress"))?.row.classId;
  const [mClass, setMClass] = useState<string | null>(props.gridClassId ?? props.cell?.classId ?? firstOpen ?? rows[0]?.row.classId ?? null);
  if (!exam) return null;
  const c = exam.counts;
  const parts = partsOf(c);
  const lateTeachers = props.teachers.filter((t) => t.late || t.notStarted);
  const cols = Math.max(7, ...bands.map((b) => b.subjects.length));
  // A subject column never narrower than its count ("12/18") on one line; the grid scrolls sideways instead (smoke 20 Oct).
  const template = `${cellOpen ? "92px" : "150px"} repeat(${cols}, minmax(${cellOpen ? 46 : 54}px,1fr)) ${cellOpen ? "44px" : "64px"}`;
  const chips: { v: Filter; label: Pair; n: number | null; dot: string }[] = [
    { v: "all", label: p("All", "सभी"), n: null, dot: "var(--bds)" },
    { v: "not_started", label: LOOK.not_started.label, n: c.not_started, dot: "var(--bad)" },
    { v: "in_progress", label: LOOK.in_progress.label, n: c.in_progress, dot: "var(--c3)" },
    { v: "done", label: LOOK.done.label, n: c.done + c.locked, dot: "var(--ok)" },
  ];
  const classDot = (cells: Record<string, CellView>) => {
    const states = Object.values(cells).map((x) => x.state);
    return states.includes("not_started") ? "var(--bad)" : states.includes("in_progress") ? "var(--c3)" : "var(--ok)";
  };
  const picked = rows.find(({ row }) => row.classId === mClass) ?? rows[0];

  const section = (
    <section className={`pad${cellOpen ? " hide-m" : ""}`} style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
        <XRing pct={exam.percent} size={64} stroke={10.9}>
          <span className="num" style={{ fontSize: 15, fontWeight: 700 }}>{exam.percent}%</span>
        </XRing>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <span className="num" style={{ fontWeight: 700 }}>
            {tx(p(`${nf(exam.entered)} of ${nf(exam.total)} marks entered`, `${nf(exam.total)} में से ${nf(exam.entered)} अंक भरे`))}
            {props.manage && exam.notStarted ? ` · ${tx(p(`${exam.notStarted} teachers not started`, `${exam.notStarted} शिक्षकों ने शुरू नहीं किया`))}` : ""}
          </span>
          <XBar parts={parts} />
          <div className="hide-m" style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12 }}>
            {parts.map((x) => (
              <span key={x.state} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--mut)" }}>
                <Dot color={x.color} square />
                {tx(LOOK[x.state].label)}
                <b className="num" style={{ color: "var(--fg)" }}>{x.n}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      {props.scoped ? <Banner tone="info">{tx(p("Your papers, and your own class if you are its class teacher.", "आपके पेपर, और आपकी कक्षा यदि आप कक्षा अध्यापक हैं।"))}</Banner> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div className="hs" role="group" aria-label={tx(p("Show", "दिखाएँ"))} style={{ display: "flex", gap: 6, flex: 1, minWidth: 0 }}>
          {chips.map((f) => (
            <button key={f.v} type="button" className={`tap chip${filter === f.v ? " on" : ""}`} aria-pressed={filter === f.v} onClick={() => setFilter(f.v)}>
              <Dot color={f.dot} />
              {tx(f.label)}
              {f.n !== null ? <span className="num" style={{ opacity: 0.7 }}>{f.n}</span> : null}
            </button>
          ))}
        </div>
        {props.manage && lateTeachers.length ? (
          <button type="button" className="tap btn pri mfull" onClick={() => props.onRemind(null)}>
            <Ic n="send" />
            {tx(p(`Remind all late teachers on WhatsApp (${lateTeachers.length})`, `सभी देर वाले शिक्षकों को WhatsApp पर याद दिलाएँ (${lateTeachers.length})`))}
          </button>
        ) : null}
      </div>
      {bands.length === 0 ? <EmptyState icon="grid" title={tx(p("No papers to show", "कोई पेपर नहीं"))} /> : null}

      {bands.length ? (
        <div className="only-d card" style={{ overflowX: "auto", overflowY: "hidden" }}>
          {bands.map((band, bi) => (
            <div key={band.key} style={{ minWidth: "fit-content" }}>
              <div style={{ display: "grid", gridTemplateColumns: template, gap: 6, alignItems: "center", minHeight: 42, padding: "0 14px", background: "var(--s2)", borderTop: bi ? "1px solid var(--bd)" : undefined }}>
                <span className="sech clip">{tx(band.label)}</span>
                {Array.from({ length: cols }, (_, i) => band.subjects[i]).map((s, i) => (
                  // Break between words, or hyphenate a long one ("Accoun-tancy"), never "Englis h" (smoke 20 Oct).
                  <span key={s?.code ?? `pad-${i}`} lang={lang === "hi" ? "hi" : "en"} title={s ? tx(s.name) : undefined} style={{ minWidth: 0, fontSize: 11, fontWeight: 700, lineHeight: 1.15, color: "var(--mut)", textAlign: "center", overflowWrap: "normal", wordBreak: "normal", hyphens: "auto" }}>{s ? tx(s.name) : ""}</span>
                ))}
                <span className="sech" style={{ textAlign: "right" }} title={tx(p("Share of marks entered; a paper is Done only when sent with none to correct", "भरे गए अंकों का हिस्सा; पेपर तभी पूरा जब भेजा गया हो और कोई सुधार बाकी न हो"))}>{tx(p("Entered", "भरे"))}</span>
              </div>
              {band.rows.map((row) => (
                <div key={row.classId} style={{ display: "grid", gridTemplateColumns: template, gap: 6, alignItems: "center", minHeight: 54, padding: "6px 14px", borderTop: "1px solid var(--bd)" }}>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span className="clip" style={{ fontWeight: 700 }}>{row.label}</span>
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{row.teacher ?? "—"} · {row.children}</span>
                  </span>
                  {Array.from({ length: cols }, (_, i) => band.subjects[i]).map((s, i) => {
                    const cell = s ? row.cells[s.code] : undefined;
                    if (!s || !cell) return <span key={s?.code ?? `pad-${i}`} />;
                    return <CellChip key={s.code} cell={cell} compact={cellOpen} selected={props.cell?.paperId === cell.paperId} dim={!shows(filter, cell.state)} href={href("cell", `&paper=${cell.paperId}`)} label={`${row.label} ${tx(s.name)}`} />;
                  })}
                  <span className="num" style={{ fontSize: 13, fontWeight: 700, textAlign: "right", color: Object.values(row.cells).every((x) => x.state === "done" || x.state === "locked") ? "var(--ok)" : "var(--fg)" }}>{row.percent}%</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {picked ? (
        <div className="only-m" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="hs" role="group" aria-label={tx(p("Class", "कक्षा"))} style={{ display: "flex", gap: 6 }}>
            {rows.map(({ row }) => (
              <button key={row.classId} type="button" className={`tap chip${row.classId === picked.row.classId ? " on" : ""}`} aria-pressed={row.classId === picked.row.classId} onClick={() => setMClass(row.classId)}>
                <Dot color={classDot(row.cells)} />
                {row.label}
              </button>
            ))}
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {picked.band.subjects.map((s, i) => {
              const cell = picked.row.cells[s.code];
              if (!cell) return null;
              const look = LOOK[cell.state];
              const label = cell.state === "in_progress" ? tx(p(`${cell.entered} of ${cell.total}`, `${cell.total} में से ${cell.entered}`)) : tx(look.label);
              return (
                <Link key={s.code} href={href("cell", `&paper=${cell.paperId}`)} className="tap row" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", lineHeight: 1.25, color: "var(--fg)", borderTop: i ? "1px solid var(--bd)" : undefined, opacity: shows(filter, cell.state) ? 1 : 0.35 }}>
                  <span style={{ flex: "none", width: 38, height: 38, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: look.bg, color: look.fg }}>
                    <Ic n={look.icon} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span className="clip" style={{ fontSize: 15, fontWeight: 600 }}>{tx(s.name)}</span>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: look.fg }}>{label}</span>
                    </span>
                    <XBar height={6} parts={[{ w: pctOf(cell.entered, cell.total), color: look.fg }]} />
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{cell.teacher ?? "—"} · {tx(look.label)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: cellOpen ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start", minHeight: "100%" }}>
      {section}
      {cellOpen ? <CellPanel {...props} onRemind={(id) => props.onRemind([id])} /> : null}
    </div>
  );
}

function CellChip({ cell, selected, href, label, compact, dim }: { cell: CellView; selected: boolean; href: string; label: string; compact: boolean; dim: boolean }) {
  const { tx } = useVx();
  const look = LOOK[cell.state];
  const part = cell.state === "in_progress";
  // Marks to correct say so in the cell, so a sent paper is never read as finished (smoke 20 Oct).
  const fix = cell.state !== "locked" && (cell.invalid ?? 0) > 0;
  const text = fix ? tx(p(`Fix ${cell.invalid}`, `${cell.invalid} सुधारें`)) : part ? `${cell.entered}/${cell.total}` : compact ? "" : tx(look.label);
  const style: CSSProperties = {
    position: "relative",
    flex: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 0,
    height: 40,
    padding: "0 6px",
    borderRadius: 10,
    border: `1px solid ${selected ? "var(--acc)" : look.bd}`,
    background: fix ? "var(--bads)" : look.bg,
    color: fix ? "var(--bad)" : look.fg,
    fontSize: 12,
    fontWeight: 700,
    overflow: "hidden",
    opacity: dim ? 0.22 : 1,
    boxShadow: selected ? "0 0 0 2px var(--acc)" : undefined,
  };
  return (
    <Link href={href} className="tap" aria-label={`${label} · ${cell.teacher ?? "—"} · ${fix ? text : part ? `${cell.entered} of ${cell.total}` : tx(look.label)}`} style={style}>
      {fix ? <Ic n="alert" size={14} /> : part ? null : <Ic n={look.icon} size={14} />}
      {/* Two short lines rather than "Not s…" in a narrow column (coordinators U3). */}
      {/* A count stays on one line: "9/1 8" read like 9/1 (smoke 20 Oct). */}
      {text ? <span className="num" style={{ minWidth: 0, fontSize: part ? 12 : 11, lineHeight: 1.1, textAlign: "center", ...(part || fix ? { whiteSpace: "nowrap" } : { overflowWrap: "normal", hyphens: "auto" }) }}>{text}</span> : null}
      {part ? <span aria-hidden="true" style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${pctOf(cell.entered, cell.total)}%`, background: "currentColor", opacity: 0.5 }} /> : null}
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
  if (!cell || !exam) return null;
  const look = LOOK[cell.state];
  const percent = pctOf(cell.entered, cell.total);
  const pendingWork = cell.state !== "done" && cell.state !== "locked";
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
  const last = cell.history[0];
  const link = cell.link
    ? { text: `${tx(p("Active", "चालू"))} · ${cell.link.openedAt ? `${tx(p("opened", "खोला"))} ${tx(when(cell.link.openedAt)).toLowerCase()}` : tx(p("not opened yet", "अभी नहीं खोला"))}`, tone: cell.link.openedAt ? "var(--ok)" : "var(--warnfg)" }
    : { text: tx(p("No link yet", "अभी लिंक नहीं")), tone: "var(--bad)" };

  return (
    <aside className="unstick" style={{ position: "sticky", top: 64, height: "calc(100dvh - 64px)", overflowY: "auto", borderLeft: "1px solid var(--bd)", background: "var(--bg)", animation: "xPush .36s var(--ease) both" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "18px 22px 28px" }}>
        <div className="only-d" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Link href={href("grid")} className="tap btn ghost" aria-label={tx(p("Close", "बंद करें"))} style={{ width: 40, height: 36, padding: 0 }}>
            <Ic n="x" />
          </Link>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <XRing pct={percent} size={76} stroke={10.5} tone={look.fg}>
              <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>{percent}%</span>
            </XRing>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{cell.classLabel} · {tx(cell.subject)}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {cell.teacherName ?? tx(p("No teacher set", "शिक्षक तय नहीं"))} · {tx(p("out of", "पूर्णांक"))} {cell.maxMarks}
              </span>
              <span className="num" style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{tx(p(`${cell.entered} of ${cell.total} entered`, `${cell.total} में से ${cell.entered} भरे`))}</span>
              {cell.absent !== undefined ? (
                // What the entered count is made of, so a paper can be checked at a glance (smoke 20 Oct).
                <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>
                  {tx(paperMix({ marks: cell.entered - (cell.absent ?? 0) - (cell.exempt ?? 0), absent: cell.absent ?? 0, exempt: cell.exempt ?? 0, blank: cell.blank ?? 0 }))}
                </span>
              ) : null}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--bd)" }}>
            {props.manage ? <FactRow k={tx(p("Phone", "फ़ोन"))} v={cell.phoneMasked || "—"} /> : null}
            {cell.readiness ? <FactRow k={tx(p("Status", "स्थिति"))} v={cell.invalid ? `${tx(READINESS_LABEL[cell.readiness])} · ${cell.invalid}` : tx(READINESS_LABEL[cell.readiness])} tone={cell.readiness === "needs_correction" ? "var(--bad)" : undefined} /> : null}
            <FactRow k={tx(p("Last activity", "पिछली गतिविधि"))} v={last ? `${tx(when(last.at))} · ${tx(last.text)}` : tx(progressLine(cell.entered, cell.total))} />
            {props.manage ? <FactRow k={tx(p("Sampark link", "संपर्क लिंक"))} v={link.text} tone={link.tone} /> : null}
            {props.manage && cell.remindedAt ? <FactRow k={tx(p("Reminded", "याद दिलाया"))} v={tx(when(cell.remindedAt))} /> : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {props.manage && cell.teacherId && pendingWork ? (
            <button type="button" className={`tap btn ${cell.remindedAt ? "soft" : "pri"}`} style={{ height: 46 }} onClick={() => props.onRemind(cell.teacherId!)}>
              <Ic n={cell.remindedAt ? "checkCircle" : "send"} />
              {cell.remindedAt
                ? tx(p(`Reminded ${cell.teacherName ?? ""} · remind again`, `${cell.teacherName ?? ""} को याद दिलाया · फिर याद दिलाएँ`))
                : tx(p(`Remind ${cell.teacherName ?? "the teacher"} on WhatsApp`, `${cell.teacherName ?? "शिक्षक"} को WhatsApp पर याद दिलाएँ`))}
            </button>
          ) : null}
          <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
            {props.manage && cell.teacherId ? (
              cell.link ? (
                <Btn variant="sec" icon="copy" onClick={copy}>{tx(p("Copy link", "लिंक कॉपी"))}</Btn>
              ) : (
                <Btn variant="sec" icon="link" disabled={pending} onClick={() => run(() => props.actions.marksLink({ examId: exam.id, staffId: cell.teacherId!, op: "make" }))}>
                  {tx(p("Make link", "लिंक बनाएँ"))}
                </Btn>
              )
            ) : null}
            {cell.canEnter && cell.state !== "locked" ? (
              <Btn variant="sec" icon="edit" href={enterHref}>
                {tx(props.manage ? p("Enter marks myself", "अंक खुद भरें") : p("Enter marks", "अंक भरें"))}
              </Btn>
            ) : null}
          </div>
          {props.manage && props.actions.setExempt && cell.allowExempt !== undefined && cell.state !== "locked" ? (
            // Per paper, by the exam office: may a child be excused (smoke 20 Oct). Off is refused once marks are typed.
            <SwitchRow
              title={tx(p("A child may be excused from this paper", "इस पेपर में बच्चे को छूट दी जा सकती है"))}
              sub={cell.allowExempt && cell.exemptLocked ? tx(p("Marks are being entered, so this can no longer be switched off.", "अंक भरे जा रहे हैं, इसलिए अब बंद नहीं हो सकता।")) : undefined}
              on={cell.allowExempt}
              onChange={(on) => {
                if (pending || (cell.allowExempt && cell.exemptLocked)) return;
                run(() => props.actions.setExempt!({ paperId: cell.paperId, allow: on }));
              }}
            />
          ) : null}
          {props.manage && props.canFinalise ? (
            <Btn variant="sec" icon="lock" disabled={cell.classLocked || !cell.classReady || pending} onClick={() => setLockOpen(true)}>
              {cell.classLocked ? tx(p(`${cell.classLabel} is locked`, `${cell.classLabel} बंद है`)) : tx(p(`Lock ${cell.classLabel} marks`, `${cell.classLabel} के अंक बंद करें`))}
            </Btn>
          ) : null}
          {props.manage && !props.canFinalise && !cell.classLocked ? (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Only the admin finalises marks.", "अंक केवल प्रशासक अंतिम करते हैं।"))}</span>
          ) : null}
          {props.manage && props.canFinalise && !cell.classLocked && !cell.classReady ? (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {tx(p("A class can be locked once every subject teacher has sent marks, every child has one, and none needs correction.", "सभी विषय-अध्यापकों के अंक भेजने, हर बच्चे के अंक आने और कोई सुधार बाकी न रहने पर ही कक्षा बंद होती है।"))}
              {cell.classReadiness ? ` · ${tx(READINESS_LABEL[cell.classReadiness])}` : ""}
            </span>
          ) : null}
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", padding: "14px 16px" }}>
          <span className="sech" style={{ marginBottom: 8 }}>{tx(p("History", "इतिहास"))}</span>
          {cell.history.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--mut)", padding: "6px 0" }}>
              {cell.entered > 0
                ? tx(p(`Not sent yet · ${cell.entered} marks saved so far.`, `अभी भेजे नहीं · अब तक ${cell.entered} अंक सहेजे।`))
                : tx(p("Nothing yet.", "अभी कुछ नहीं।"))}
            </span>
          ) : null}
          {cell.history.map((h, i) => (
            <LogLine key={i} dot={h.tone} text={tx(h.text)} time={tx(when(h.at))} />
          ))}
        </div>
      </div>
      <Confirm
        open={lockOpen}
        onClose={() => setLockOpen(false)}
        busy={pending}
        title={tx(p(`Lock ${cell.classLabel}?`, `${cell.classLabel} बंद करें?`))}
        body={tx(p("Marks for every subject of this class are frozen. Changes after this need the admin to unlock.", "इस कक्षा के सभी विषयों के अंक रुक जाएँगे। बाद में बदलाव के लिए एडमिन को खोलना होगा।"))}
        confirmLabel={tx(p("Lock marks", "अंक बंद करें"))}
        onConfirm={() => run(() => props.actions.lock({ examId: exam.id, classIds: [cell.classId] }), () => setLockOpen(false))}
      />
    </aside>
  );
}

/* ------------------------------------------------------------- sampark */

const AVATAR_TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** "Mr. Rawal" → "Ra", "Asha Purohit" → "AP". */
function shortInitials(name: string): string {
  const words = name.replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

/** Her classes and subjects the way a person says them: "Science · Classes 9, 10". */
function itemsText(papers: TeacherRowView["papers"]): string {
  const subjects = [...new Set(papers.map((x) => subjectPair(x.subjectCode).en))];
  const classes = [...new Set(papers.map((x) => x.classLabel))];
  if (subjects.length === 1) {
    const plain = classes.every((c) => /^Class \d+$/.test(c));
    return `${subjects[0]} · ${classes.length > 1 && plain ? `Classes ${classes.map((c) => c.slice(6)).join(", ")}` : classes.join(", ")}`;
  }
  if (classes.length === 1) return `${classes[0]} · ${subjects.join(", ")}`;
  return papers.map((x) => `${x.classLabel} ${subjectPair(x.subjectCode).en}`).join(", ");
}

function Sampark(props: ExamsProps) {
  const { tx } = useVx();
  const toast = useToast();
  const { pending, run } = useAct();
  const [revoke, setRevoke] = useState<TeacherRowView | null>(null);
  const { exam } = props;
  if (!exam) return null;
  const name = { id: exam.id, en: exam.name.en, hi: exam.name.hi ?? exam.name.en };
  const rank = (t: TeacherRowView) => (!t.link ? 0 : !t.link.openedAt ? 1 : 2) * 10 + t.entered / Math.max(1, t.total);
  const rows = [...props.teachers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ text: tx(p("Link copied", "लिंक कॉपी हुआ")) });
    } catch {
      toast.show({ text: url });
    }
  };
  const ghost: CSSProperties = { width: 40, padding: 0 };
  return (
    <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, padding: "16px 18px" }}>
        <span style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Teachers enter marks from this link — no login needed", "शिक्षक इस लिंक से अंक भरते हैं — लॉगिन की ज़रूरत नहीं"))}</span>
          <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>
            {tx(p(
              "Each teacher gets one private link for her own classes. It stops working once it is renewed or revoked.",
              "हर शिक्षक को अपनी कक्षाओं का एक निजी लिंक मिलता है। नया बनाने या बंद करने पर यह काम करना बंद कर देता है।",
            ))}
          </span>
        </span>
      </div>
      {rows.length === 0 ? <EmptyState icon="link" title={tx(p("No teacher has papers in this exam", "इस परीक्षा में किसी शिक्षक के पेपर नहीं"))} /> : null}
      {rows.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="only-d xsr" style={{ minHeight: 42, padding: "0 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
            <span className="sech">{tx(p("Teacher", "शिक्षक"))}</span>
            <span className="sech">{tx(p("Classes and subjects", "कक्षाएँ और विषय"))}</span>
            <span className="sech">{tx(p("Link", "लिंक"))}</span>
            <span className="sech">{tx(p("Marks", "अंक"))}</span>
            <span className="sech" style={{ textAlign: "right" }}>{tx(p("Actions", "काम"))}</span>
          </div>
          <div>
            {rows.map((t) => {
              const [abg, afg] = AVATAR_TONES[Math.floor(hashOf(t.name) * AVATAR_TONES.length)];
              const status = !t.link ? { text: p("No link", "लिंक नहीं"), bg: "var(--bads)", fg: "var(--bad)" } : !t.link.openedAt ? { text: p("Not opened", "नहीं खोला"), bg: "var(--warns)", fg: "var(--warnfg)" } : { text: p("Active", "चालू"), bg: "var(--oks)", fg: "var(--ok)" };
              const seen = t.link?.openedAt ? `${tx(p("Opened", "खोला"))} ${tx(when(t.link.openedAt)).replace(/^(Today|Yesterday)/, (m) => m.toLowerCase())}` : t.link ? tx(p("Never opened", "कभी नहीं खोला")) : tx(p("Make a link to send it", "भेजने के लिए लिंक बनाएँ"));
              const done = t.entered >= t.total;
              const live = t.link;
              return (
                <div key={t.id} className="row xsr xd">
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ flex: "none", width: 34, height: 34, borderRadius: 17, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: abg, color: afg }}>{shortInitials(t.name)}</span>
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span className="clip" style={{ fontWeight: 600 }}>{t.name}</span>
                      <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{t.phoneMasked || "—"}</span>
                    </span>
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>{itemsText(t.papers)}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    <span className="pill" style={{ background: status.bg, color: status.fg, animation: "xPopIn .4s var(--spring) both" }}>{tx(status.text)}</span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{seen}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{tx(p(`${nf(t.entered)} of ${nf(t.total)} marks`, `${nf(t.total)} में से ${nf(t.entered)} अंक`))}</span>
                    <XBar height={6} parts={[{ w: pctOf(t.entered, t.total), color: done ? "var(--ok)" : "var(--acc)" }]} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }}>
                    <button type="button" className="tap btn ghost" style={ghost} aria-label={tx(p(`Copy link for ${t.name}`, `${t.name} का लिंक कॉपी करें`))} disabled={!live} onClick={() => live && void copy(live.url)}>
                      <Ic n="copy" />
                    </button>
                    {live && t.phone ? (
                      <a className="tap btn ghost" style={{ ...ghost, color: "var(--acc)" }} aria-label={tx(p(`Send link to ${t.name} on WhatsApp`, `${t.name} को WhatsApp पर लिंक भेजें`))} href={waLink(t.phone, reminderFor(t, name, exam.dueLabel ?? "—", props.fromName, live.url))} target="_blank" rel="noopener noreferrer">
                        <Ic n="send" />
                      </a>
                    ) : (
                      <button type="button" className="tap btn ghost" style={{ ...ghost, color: "var(--acc)" }} aria-label={tx(p(`Send link to ${t.name} on WhatsApp`, `${t.name} को WhatsApp पर लिंक भेजें`))} disabled>
                        <Ic n="send" />
                      </button>
                    )}
                    <button type="button" className="tap btn ghost" style={ghost} aria-label={tx(live ? p(`Make a new link for ${t.name}`, `${t.name} का नया लिंक बनाएँ`) : p(`Make a link for ${t.name}`, `${t.name} का लिंक बनाएँ`))} disabled={pending} onClick={() => run(() => props.actions.marksLink({ examId: exam.id, staffId: t.id, op: live ? "renew" : "make" }))}>
                      <Ic n="refresh" />
                    </button>
                    <button type="button" className="tap btn ghost" style={{ ...ghost, color: "var(--bad)" }} aria-label={tx(p(`Revoke the link of ${t.name}`, `${t.name} का लिंक बंद करें`))} disabled={!live || pending} onClick={() => setRevoke(t)}>
                      <Ic n="x" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <Confirm
        open={Boolean(revoke)}
        onClose={() => setRevoke(null)}
        busy={pending}
        title={tx(p(`Revoke ${revoke?.name ?? ""}'s link?`, `${revoke?.name ?? ""} का लिंक बंद करें?`))}
        body={tx(p("The link stops working at once. Marks already entered stay saved; she can still enter marks after signing in.", "लिंक तुरंत बंद हो जाएगा। भरे हुए अंक सहेजे रहेंगे; साइन-इन करके वे अंक भर सकती हैं।"))}
        confirmLabel={tx(p("Revoke link", "लिंक बंद करें"))}
        onConfirm={() => revoke && run(() => props.actions.marksLink({ examId: exam.id, staffId: revoke.id, op: "revoke" }), () => setRevoke(null))}
      />
    </div>
  );
}

/* ------------------------------------------------------------- report cards */

/**
 * Cards ready to issue: none while a paper of the class is unsent, has a blank or a mark to
 * correct (`paperBlockers`), and otherwise the children whose card has no blank.
 */
function readyCards(cards: NonNullable<ExamsProps["cards"]>): number {
  if ((cards.blockers ?? []).length) return 0;
  return cards.students.filter((s) => !(s.missing ?? []).length).length;
}

const BLOCKER_TEXT = (b: { subject: Pair; reason: "needs_correction" | "missing" | "not_sent"; count: number }): Pair =>
  b.reason === "needs_correction"
    ? p(`${b.subject.en}: ${b.count} ${b.count === 1 ? "mark needs" : "marks need"} correction`, `${b.subject.hi ?? b.subject.en}: ${b.count} अंक सुधारने हैं`)
    : b.reason === "missing"
      ? p(`${b.subject.en}: ${b.count} ${b.count === 1 ? "child has" : "children have"} no mark`, `${b.subject.hi ?? b.subject.en}: ${b.count} बच्चों के अंक नहीं`)
      : p(`${b.subject.en}: not sent yet`, `${b.subject.hi ?? b.subject.en}: अभी भेजा नहीं`);

/** The exam coordinator's look across classes: whose cards still have no class-teacher remark. */
function RemarksOverview({ classes }: { classes: NonNullable<ExamsProps["cards"]>["classes"] }) {
  const { tx } = useVx();
  const short = classes.filter((c) => c.remarks !== undefined && c.children > 0 && c.remarks < c.children);
  if (!classes.some((c) => c.remarks !== undefined)) return null;
  return (
    <details className="card" style={{ padding: "12px 16px" }}>
      <summary className="tap" style={{ cursor: "pointer", fontWeight: 700, minHeight: 44, display: "flex", alignItems: "center", gap: 8 }}>
        <Ic n="notePen" />
        {short.length
          ? tx(p(`Class teacher's remarks · ${short.length} ${short.length === 1 ? "class has" : "classes have"} cards without one`, `कक्षा अध्यापक की टिप्पणी · ${short.length} कक्षाओं के कुछ कार्ड बिना टिप्पणी`))
          : tx(p("Class teacher's remarks · every card has one", "कक्षा अध्यापक की टिप्पणी · हर कार्ड पर है"))}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
        {classes.filter((c) => c.children > 0).map((c) => {
          const done = c.remarks ?? 0;
          const left = c.children - done;
          return (
            <div key={c.id} className="xd" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "4px 0" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="clip" style={{ fontWeight: 600 }}>{c.label}</span>
                <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{c.teacher ?? tx(p("No class teacher set", "कक्षा अध्यापक तय नहीं"))}</span>
              </span>
              <span className="num" style={{ fontSize: 13, fontWeight: 700, color: left ? "var(--warnfg)" : "var(--ok)" }}>
                {left ? tx(p(`${left} without a remark · ${done} of ${c.children} written`, `${left} बिना टिप्पणी · ${c.children} में से ${done} लिखी`)) : tx(p(`All ${c.children} written`, `सभी ${c.children} लिखी`))}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ReportCards(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { pending, run } = useAct();
  const [issueOpen, setIssueOpen] = useState(false);
  const { cards, exam, href } = props;
  if (!cards || !exam) return null;
  const klass = cards.classes.find((c) => c.id === cards.classId) ?? null;
  const rowOf = new Map(props.bands.flatMap((b) => b.rows.map((r) => [r.classId, r] as const)));
  const dotOf = (classId: string) => {
    const states = Object.values(rowOf.get(classId)?.cells ?? {}).map((x) => x.state);
    return states.includes("not_started") ? "var(--bad)" : states.includes("in_progress") ? "var(--c3)" : "var(--ok)";
  };
  const ready = readyCards(cards);
  const blockers = cards.blockers ?? [];
  const missing = cards.students.filter((s) => (s.missing ?? []).length).length;
  const allIssued = klass ? klass.issued > 0 && klass.issued >= klass.children : false;
  const printHref = klass ? `/exams/report-card?class=${klass.id}&term=${encodeURIComponent(cards.term)}` : "#";
  const hasRoll = cards.students.some((s) => s.roll);
  return (
    <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <RemarksOverview classes={cards.classes} />
      <div className="hs" role="group" aria-label={tx(p("Class", "कक्षा"))} style={{ display: "flex", gap: 6 }}>
        {cards.classes.map((c) => (
          <Link key={c.id} href={href("reportcards", `&class=${c.id}`)} className={`tap chip${c.id === cards.classId ? " on" : ""}`} aria-pressed={c.id === cards.classId}>
            <Dot color={dotOf(c.id)} />
            {c.label}
          </Link>
        ))}
      </div>
      {klass ? (
        <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, padding: "18px 20px" }}>
          <XRing pct={pctOf(ready, Math.max(1, cards.students.length))} size={84} stroke={10.7} tone="var(--ok)">
            <span className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{ready}/{cards.students.length}</span>
            <span style={{ fontSize: 11, color: "var(--mut)" }}>{tx(p("ready", "तैयार"))}</span>
          </XRing>
          <span style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 3 }}>
            <span className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{klass.label} · {tx(exam.name)}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {cards.classTeacher ? `${cards.classTeacher} (${tx(p("class teacher", "कक्षा अध्यापक"))}) · ` : ""}
              {tx(p(`${klass.children} students`, `${klass.children} विद्यार्थी`))}
              {cards.subjects ? ` · ${tx(p(`${cards.subjects} subjects`, `${cards.subjects} विषय`))}` : ""}
            </span>
          </span>
          {allIssued ? (
            <div className="mfull" style={{ width: 340, display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "var(--ok)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" style={{ fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 22, strokeDasharray: 22, animation: "xDraw .45s .1s var(--ease) both" }} />
                </svg>
                {tx(p(`${klass.issued} report cards issued`, `${klass.issued} प्रगति पत्र जारी`))}
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
                <Btn variant="sec" icon="printer" target="_blank" href={printHref}>{tx(p("Print all", "सब प्रिंट"))}</Btn>
                {props.manage ? (
                  <Btn variant="sec" icon="refresh" disabled={pending} onClick={() => setIssueOpen(true)}>{tx(p("Issue again", "फिर से जारी करें"))}</Btn>
                ) : (
                  <Btn variant="sec" icon="download" target="_blank" href={printHref}>{tx(p("Download PDF", "PDF डाउनलोड"))}</Btn>
                )}
              </div>
            </div>
          ) : (
            <div className="mfull" style={{ width: 300, display: "flex", flexDirection: "column", gap: 6 }}>
              {props.manage ? (
                <button type="button" className="tap btn pri" style={{ height: 48, fontSize: 15 }} disabled={!klass.locked || pending} onClick={() => setIssueOpen(true)}>
                  <Ic n="file" />
                  {tx(p(`Issue ${klass.children} report cards`, `${klass.children} प्रगति पत्र जारी करें`))}
                </button>
              ) : (
                <Btn variant="sec" icon="printer" target="_blank" href={printHref}>{tx(p("Print all", "सब प्रिंट"))}</Btn>
              )}
              <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center" }}>
                {!klass.locked
                  ? tx(p(`Cards are issued once ${klass.label}'s marks are locked`, `${klass.label} के अंक बंद होने पर कार्ड जारी होते हैं`))
                  : missing
                    ? tx(p(`${missing} cards will show “Not entered” for missing marks`, `${missing} कार्ड में छूटे अंक “नहीं भरे” दिखेंगे`))
                    : tx(p("All marks are in", "सभी अंक आ गए"))}
              </span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon="file" title={tx(p("No classes in this exam", "इस परीक्षा में कोई कक्षा नहीं"))} />
      )}
      {klass && blockers.length ? (
        <Banner tone="warn">
          {tx(p(`${klass.label}'s cards are not ready until these papers are finished:`, `${klass.label} के कार्ड तभी तैयार होंगे जब ये पेपर पूरे हों:`))}{" "}
          {blockers.map((b) => tx(BLOCKER_TEXT(b))).join(" · ")}
        </Banner>
      ) : null}
      {cards.students.length ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 16px", background: "var(--s2)", borderBottom: "1px solid var(--bd)" }}>
            <span className="sech">{tx(p("Students · tap one to preview", "विद्यार्थी · झलक के लिए दबाएँ"))}</span>
            <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{tx(p(`${ready} of ${cards.students.length} ready`, `${cards.students.length} में से ${ready} तैयार`))}</span>
          </div>
          <div>
            {cards.students.map((s) => {
              const miss = s.missing ?? [];
              const status = s.issued
                ? { t: p("Issued", "जारी"), bg: "var(--oks)", fg: "var(--ok)" }
                : miss.length
                  ? { t: p(`Missing ${miss.length} ${miss.length === 1 ? "subject" : "subjects"}`, `${miss.length} विषय बाकी`), bg: "var(--warns)", fg: "var(--warnfg)" }
                  : blockers.length
                    ? { t: p("Waiting for papers", "पेपर पूरे होने बाकी"), bg: "var(--warns)", fg: "var(--warnfg)" }
                    : { t: p("Ready", "तैयार"), bg: "var(--oks)", fg: "var(--ok)" };
              const names = (codes: string[]) => codes.map((m) => tx(subjectPair(m))).join(", ");
              // The term card's own percentage, grade and result (`classTermCards`), so it matches the card.
              const sub = miss.length
                ? `${tx(p("Missing", "बाकी"))} ${names(miss)}`
                : s.percent !== null && s.percent !== undefined
                  ? `${s.percent.toFixed(1)}%${s.grade ? ` · ${s.grade}` : ""}${s.absent ? ` · ${tx(p(`absent in ${s.absent}`, `${s.absent} में अनुपस्थित`))}` : ""}${s.passed === false && (s.shortIn ?? []).length ? ` · ${tx(p(`needs support in ${names(s.shortIn ?? [])}`, `${names(s.shortIn ?? [])} में सहायता चाहिए`))}` : ""}${s.remark === false ? ` · ${tx(p("no remark yet", "टिप्पणी बाकी"))}` : ""}`
                  : "—";
              return (
                <Link key={s.id} href={href("preview", `&class=${cards.classId}&student=${s.id}`)} className="tap row xd" style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 58, padding: "8px 16px", color: "var(--fg)" }}>
                  {/* No roll numbers set for the class: no column of dashes (smoke 20 Oct). */}
                  {hasRoll ? <span className="num" style={{ width: 22, flex: "none", fontSize: 12, fontWeight: 700, color: "var(--mut)" }}>{s.roll ?? "—"}</span> : null}
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span className="clip" style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
                  </span>
                  <span className="pill" style={{ background: status.bg, color: status.fg }}>{tx(status.t)}</span>
                  <Ic n="chevRight" className="hide-m" style={{ color: "var(--sub)", flex: "none" }} />
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
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

/* ------------------------------------------------------------- preview */

/* The card is a bilingual document: both languages print on every copy, whatever the reader's own setting. */
const CARD = {
  schoolHi: "श्री वीर पत्ता सीनियर सेकेंडरी स्कूल, आमेट",
  place: "Amet, Rajsamand, Rajasthan",
  student: "छात्र / Student",
  father: "पिता / Father",
  klass: "कक्षा / Class",
  sr: "एस.आर. नं. / SR no.",
  subject: ["विषय", "Subject"],
  max: ["पूर्णांक", "Max"],
  marks: ["प्राप्तांक", "Marks"],
  grade: ["ग्रेड", "Grade"],
  total: "कुल · Total",
  percent: "प्रतिशत / Percentage",
  weighted: "परीक्षा के भार से · Weighted by exam",
  result: "परिणाम / Result",
  attendance: "उपस्थिति / Attendance",
  remark: "कक्षा अध्यापक की टिप्पणी · Class teacher’s remark",
  pass: "Pass · उत्तीर्ण",
  support: "Needs support · पूरक कक्षाएँ",
  pending: "Marks still coming · अंक आने बाकी",
  classTeacher: "कक्षा अध्यापक · Class teacher",
  coordinator: "परीक्षा प्रभारी · Exam coordinator",
  principal: "प्रधानाचार्य · Principal",
  notEntered: "Not entered · नहीं भरे",
  absent: "Absent · अनुपस्थित",
} as const;

function Preview(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { preview: c, exam, href, cards } = props;
  if (!c || !exam) {
    return (
      <div className="pad" style={{ padding: "16px 28px 40px" }}>
        <EmptyState icon="file" title={tx(p("No report card yet", "अभी प्रगति पत्र नहीं"))} />
      </div>
    );
  }
  const go = (id: string | null) => (id ? href("preview", `&class=${cards?.classId ?? ""}&student=${id}`) : undefined);
  const [en, hi] = (c.remark ?? "").split("\n");
  const pending = c.rows.some((r) => r.state === "missing");
  // A failed or missed paper decides it even while another mark is still coming (`cardResult`).
  const result =
    c.passed === false
      ? { t: supportLine(c.shortIn ?? []), c: "var(--bad)" }
      : pending
        ? { t: CARD.pending, c: "var(--warnfg)" }
        : c.passed === null
          ? null
          : { t: CARD.pass, c: "var(--ok)" };
  const weights = weightsLine(c.weights ?? []);
  const tiles = [
    { k: c.weighted ? `${CARD.percent} · ${CARD.weighted}` : CARD.percent, v: c.percent === null ? "—" : `${c.percent.toFixed(1)}%`, c: "var(--fg)" },
    ...(result ? [{ k: CARD.result, v: result.t, c: result.c }] : []),
    { k: CARD.attendance, v: c.attendance === null ? "—" : `${c.attendance}%${c.present !== null && c.present !== undefined && c.counted ? ` · ${c.present}/${c.counted}` : ""}`, c: "var(--fg)" },
  ];
  const signs = [
    { n: c.classTeacher ?? "", r: CARD.classTeacher },
    { n: c.coordinator ?? "", r: CARD.coordinator },
    { n: "", r: CARD.principal },
  ];
  const navBtn: CSSProperties = { width: 44, padding: 0, flex: "none" };
  const [titleEn, titleHi] = [c.title.en.toUpperCase(), c.title.hi ?? c.title.en];
  return (
    <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, width: "100%", maxWidth: 760, margin: "0 auto" }}>
        <div className="mfull" style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <Btn variant="sec" icon="chevLeft" href={go(c.prevId)} disabled={!c.prevId} ariaLabel={tx(p("Previous student", "पिछला विद्यार्थी"))} style={navBtn} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span className="clip" style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${c.position} of ${c.of}`, `${c.of} में से ${c.position}`))} · {c.classLabel}</span>
          </span>
          <Btn variant="sec" icon="chevRight" href={go(c.nextId)} disabled={!c.nextId} ariaLabel={tx(p("Next student", "अगला विद्यार्थी"))} style={navBtn} />
        </div>
        <a className="tap btn sec mfull" href={`/exams/report-card?student=${c.studentId}&term=${encodeURIComponent(exam.term)}`} target="_blank" rel="noopener noreferrer">
          <Ic n="printer" />
          {tx(p("Print this card", "यह कार्ड प्रिंट करें"))}
        </a>
      </div>
      {!c.issued ? (
        <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
          <Banner tone="warn">{tx(p("Not issued yet — this card shows the marks as they stand today.", "अभी जारी नहीं — यह कार्ड आज तक के अंक दिखाता है।"))}</Banner>
        </div>
      ) : null}
      <article className="card pad" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 760, margin: "0 auto", padding: "30px 36px", borderRadius: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 14, borderBottom: "2px solid var(--fg)" }}>
          <Crest size={54} radius={14} still />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span lang="hi" style={{ fontSize: 17, fontWeight: 600 }}>{CARD.schoolHi}</span>
            <span className="serif" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.25 }}>{c.school}, Amet</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{CARD.place} · Session {display(props.sessionLabel)}</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: 8, borderRadius: 8, background: "var(--s2)" }}>
          <span lang="hi" style={{ fontSize: 15, fontWeight: 600 }}>{titleHi}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)", letterSpacing: ".08em" }}>{titleEn}</span>
        </div>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "10px 20px" }}>
          {[
            [CARD.student, c.name],
            [CARD.father, c.fatherName ?? "—"],
            [CARD.klass, `${c.classLabel}${c.roll ? ` · Roll ${c.roll}` : ""}`],
            [CARD.sr, c.admissionNo ?? "—"],
          ].map(([k, v]) => (
            <span key={k} style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>{k}</span>
              <span style={{ fontWeight: 600 }}>{v}</span>
            </span>
          ))}
        </div>
        <div style={{ overflow: "hidden", border: "1px solid var(--bds)", borderRadius: 8 }}>
          <div style={{ ...CARD_ROW, fontWeight: 700, background: "var(--s2)", fontSize: 11, color: "var(--mut)", alignItems: "end", lineHeight: 1.3 }}>
            {[CARD.subject, CARD.max, CARD.marks, CARD.grade].map(([h, e], i) => (
              <span key={e} style={{ display: "flex", flexDirection: "column", textAlign: i ? "center" : undefined }}>
                <span lang="hi">{h}</span>
                <span>{e}</span>
              </span>
            ))}
          </div>
          {c.rows.map((r) => {
            const state = r.state ?? "value";
            // Coloured by the row's own percentage — the figure its grade comes from — so a
            // weighted row is never red beside a passing grade (U01). The plain sum when there is none.
            const pctRow = r.percent ?? (r.outOf ? (r.scored / r.outOf) * 100 : 0);
            const tone = state === "missing" ? "var(--warnfg)" : state === "absent" || (state === "value" && pctRow < 33) ? "var(--bad)" : "var(--fg)";
            return (
              <div key={r.subject.en} style={{ ...CARD_ROW, borderTop: "1px solid var(--bd)" }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.subject.en}</span>
                  {r.subject.hi ? <span lang="hi" style={{ fontSize: 11, color: "var(--mut)" }}>{r.subject.hi}</span> : null}
                </span>
                <span className="num" style={{ textAlign: "center", color: "var(--mut)" }}>{r.outOf}</span>
                <span className="num" style={{ textAlign: "center", fontWeight: 700, color: tone }}>
                  {state === "missing" ? "—" : r.scored}
                  {r.grace ? <span style={{ fontSize: 11, color: "var(--warn)" }}> +{r.grace}G</span> : null}
                  {r.absent && state === "value" ? <span style={{ color: "var(--bad)" }}>*</span> : null}
                  {r.absent && state === "value" ? <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--bad)" }}>{r.absent}</span> : null}
                </span>
                <span style={{ textAlign: "center", fontWeight: 700, fontSize: 13, color: tone }}>{state === "missing" ? CARD.notEntered : state === "absent" ? CARD.absent : (r.grade ?? "—")}</span>
              </div>
            );
          })}
          <div style={{ ...CARD_ROW, fontWeight: 700, background: "var(--s2)", padding: "10px 12px", borderTop: "2px solid var(--bds)" }}>
            <span lang="hi">{CARD.total}</span>
            <span className="num" style={{ textAlign: "center" }}>{c.outOf}</span>
            <span className="num" style={{ textAlign: "center" }}>{c.total}</span>
            <span style={{ textAlign: "center" }}>{c.grade ?? "—"}</span>
          </div>
        </div>
        {c.notes?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "var(--mut)" }}>
            {c.notes.map((n) => (
              <span key={n.en}>
                {n.en} · <span lang="hi">{n.hi}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div className="g3" style={{ display: "grid", gridTemplateColumns: `repeat(${tiles.length},minmax(0,1fr))`, gap: 10 }}>
          {tiles.map((t) => (
            <div key={t.k} style={{ display: "flex", flexDirection: "column", borderRadius: 10, border: "1px solid var(--bd)", padding: "10px 12px" }}>
              <span lang="hi" style={{ fontSize: 11, color: "var(--mut)" }}>{t.k}</span>
              <span className="num" style={{ fontSize: 15, fontWeight: 700, color: t.c }}>{t.v}</span>
            </div>
          ))}
        </div>
        {weights ? <span style={{ fontSize: 11, color: "var(--mut)", marginTop: -8 }}>{weights}</span> : null}
        {c.attendanceNote ? <span style={{ fontSize: 11, color: "var(--mut)", marginTop: weights ? -12 : -8 }}>{CARD.attendance}: {c.attendanceNote}</span> : null}
        {c.remark ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, borderRadius: 10, padding: "12px 14px", border: "1.5px dashed var(--bds)" }}>
            <span lang="hi" style={{ fontSize: 11, fontWeight: 700, color: "var(--mut)" }}>{CARD.remark}</span>
            {hi ? <span lang="hi">{hi}</span> : null}
            <span style={{ fontSize: 13, color: "var(--mut)", fontStyle: "italic" }}>{en}</span>
          </div>
        ) : null}
        <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 18, paddingTop: 22 }}>
          {signs.map((g) => (
            <span key={g.r} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", fontSize: 12, paddingTop: 6, borderTop: "1px solid var(--fg)" }}>
              <span style={{ fontWeight: 600, minHeight: 18 }}>{g.n}</span>
              <span lang="hi" style={{ fontSize: 11, color: "var(--mut)" }}>{g.r}</span>
            </span>
          ))}
        </div>
      </article>
    </div>
  );
}

const CARD_ROW: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 58px 66px 60px", gap: 8, alignItems: "center", padding: "8px 12px" };

/* ------------------------------------------------------------- analysis */

const MEDALS: [string, string][] = [
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
  ["var(--accs)", "var(--accfg)"],
  ["var(--s2)", "var(--mut)"],
  ["var(--s2)", "var(--mut)"],
];

function Analysis(props: ExamsProps & { href: Href }) {
  const { tx } = useVx();
  const { analysis: a, href } = props;
  if (!a) {
    return (
      <div className="pad" style={{ padding: "16px 28px 40px" }}>
        <EmptyState icon="chart" title={tx(p("No marks to analyse yet", "विश्लेषण के लिए अभी अंक नहीं"))} />
      </div>
    );
  }
  const pass = a.passPct ?? 33;
  const passPct = pctOf(a.passedAll, a.counted);
  const avgs = a.subjects.map((s) => s.avgPct).filter((v): v is number => v !== null && v > 0);
  const lowest = avgs.length ? Math.min(...avgs) : null;
  const coverage = pctOf(a.submitted, a.papers);
  return (
    <div className="pad" style={{ padding: "16px 28px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="hs" role="group" aria-label={tx(p("Class", "कक्षा"))} style={{ display: "flex", gap: 6 }}>
        {a.classes.map((c) => (
          <Link key={c.id} href={href("analysis", `&class=${c.id}`)} className={`tap chip${c.id === a.classId ? " on" : ""}`} aria-pressed={c.id === a.classId}>
            {c.label}
          </Link>
        ))}
      </div>
      <ResultsAssist
        key={a.classId}
        facts={{ exam: props.exam?.name.en ?? "", classLabel: a.classLabel, children: a.children, counted: a.counted, passedAll: a.passedAll, belowCount: a.belowCount, passPct: pass, previousExam: a.prevName?.en ?? null, subjects: a.subjects }}
      />
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: 14 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 18px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(p("Subject averages", "विषय औसत"))}</span>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("% of maximum marks", "पूर्णांक का %"))}</span>
          </div>
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 10, height: 200, borderBottom: "1px solid var(--bd)" }}>
            <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: `${pass}%`, borderTop: "1.5px dashed var(--bad)", opacity: 0.55 }} />
            <span style={{ position: "absolute", right: 0, bottom: `calc(${pass}% + 3px)`, fontSize: 10, fontWeight: 700, color: "var(--bad)" }}>{tx(p(`Pass ${pass}%`, `उत्तीर्ण ${pass}%`))}</span>
            {a.subjects.map((s, i) => (
              <div key={s.subjectCode} title={`${tx(s.name)} · ${s.sat}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, flex: 1, minWidth: 0, height: "100%" }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{s.avgPct === null ? "—" : `${Math.round(s.avgPct)}%`}</span>
                <span style={{ width: "100%", maxWidth: 48, height: `${Math.max(2, Math.round(s.avgPct ?? 0))}%`, borderRadius: "8px 8px 3px 3px", background: s.avgPct !== null && s.avgPct === lowest ? "var(--c3)" : "var(--c2)", transformOrigin: "bottom", animation: "xGrowY .7s var(--ease) both", animationDelay: `${i * 60}ms`, transition: "height .5s var(--ease)" }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {a.subjects.map((s) => (
              <span key={s.subjectCode} className="clip" style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: "var(--mut)", textAlign: "center" }}>{tx(s.name)}</span>
            ))}
          </div>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "16px 18px" }}>
          <span style={{ alignSelf: "stretch", fontSize: 15, fontWeight: 700 }}>{tx(p("Passed every subject", "हर विषय में उत्तीर्ण"))}</span>
          <XRing pct={passPct} size={150} stroke={10.7} tone="var(--ok)" track="var(--bads)" butt>
            <span className="num" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{passPct}%</span>
            <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${a.passedAll} of ${a.counted} students`, `${a.counted} में से ${a.passedAll} विद्यार्थी`))}</span>
          </XRing>
        </div>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, alignItems: "start" }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", padding: "16px 18px" }}>
          <span style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{tx(p(`Top 5 · ${a.classLabel}`, `शीर्ष 5 · ${a.classLabel}`))}</span>
          {a.top.length === 0 ? <span style={{ color: "var(--mut)", fontSize: 13, padding: "8px 0" }}>—</span> : null}
          <div>
            {a.top.map((t, i) => {
              const [bg, fg] = MEDALS[Math.min(i, MEDALS.length - 1)];
              return (
                <div key={t.studentId} className="xd" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                  <span className="num" style={{ flex: "none", width: 30, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: bg, color: fg }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="clip" style={{ fontWeight: 600 }}>{t.name}</span>
                    <XBar height={5} parts={[{ w: Math.round(t.percent), color: "var(--c2)" }]} />
                  </span>
                  <span className="num" style={{ fontWeight: 700 }}>{t.percent.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(a.passPct !== undefined ? p(`Below ${pass}% in any subject`, `किसी विषय में ${pass}% से कम`) : p("Below the pass mark in any subject", "किसी विषय में उत्तीर्ण अंक से कम"))}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Plan remedial classes for them", "इनके लिए अतिरिक्त कक्षाएँ रखें"))}</span>
            </span>
            <span className="pill num" style={{ height: 26, padding: "0 10px", fontSize: 13, background: "var(--bads)", color: "var(--bad)" }}>{a.belowCount}</span>
          </div>
          {a.below.length === 0 ? <span style={{ fontSize: 12, color: "var(--mut)", textAlign: "center", padding: "14px 0" }}>{tx(p("Nobody is below the pass mark in this class.", "इस कक्षा में कोई उत्तीर्ण अंक से नीचे नहीं।"))}</span> : null}
          <div>
            {a.below.map((b) => (
              <div key={b.studentId} className="xd" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 0" }}>
                <span style={{ flex: 1, minWidth: 120, fontWeight: 600 }}>{b.name}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {b.fails.map((f) => (
                    <span key={f.subjectCode} className="pill num" style={{ background: "var(--bads)", color: "var(--bad)" }}>{subjectPair(f.subjectCode).en} {f.value}/{f.maxMarks}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>
        {a.locked
          ? tx(p(`All marks are locked for ${a.classLabel}. Averages count only students who sat the paper.`, `${a.classLabel} के सभी अंक बंद हैं। औसत में केवल पेपर देने वाले विद्यार्थी गिने गए हैं।`))
          : a.submitted < a.papers
            ? tx(p(`Based on ${coverage}% of ${a.classLabel} papers · subjects still being entered move these numbers.`, `${a.classLabel} के ${coverage}% पेपरों पर आधारित · बाकी विषयों के अंक आने पर ये आँकड़े बदलेंगे।`))
            : tx(p(`Every ${a.classLabel} paper is in. Averages count only students who sat the paper.`, `${a.classLabel} के सभी पेपर आ गए। औसत में केवल पेपर देने वाले विद्यार्थी गिने गए हैं।`))}
      </span>
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
      wide
      title={tx(p("Create an exam", "परीक्षा बनाएँ"))}
      sub={tx(p("Papers fill in by themselves from each class's subjects", "पेपर हर कक्षा के विषयों से अपने आप बनते हैं"))}
      footer={
        <>
          <Btn variant="sec" onClick={props.onClose} style={{ flex: 1 }}>{tx(p("Cancel", "रद्द करें"))}</Btn>
          <Btn variant="pri" icon="check" disabled={!ok || pending} onClick={submit} style={{ flex: 1.6 }}>{tx(p("Create exam", "परीक्षा बनाएँ"))}</Btn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="g2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={tx(p("Exam name", "परीक्षा का नाम"))}>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder={tx(p("For example: Unit Test 2", "जैसे: Unit Test 2"))} maxLength={80} />
          </Field>
          <Field label={tx(p("Name in Hindi", "हिंदी में नाम"))}>
            <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} placeholder="इकाई परीक्षा 2" maxLength={80} />
          </Field>
          <Field label={tx(p("Type", "प्रकार"))}>
            <Seg<"formative" | "summative"> label={tx(p("Type", "प्रकार"))} value={kind} onChange={setKind} options={[{ value: "formative", label: tx(p("Unit test", "इकाई परीक्षा")) }, { value: "summative", label: tx(p("Term exam", "सत्र परीक्षा")) }]} />
          </Field>
          <Field label={tx(p("Term", "टर्म"))}>
            <Select value={term} onChange={(e) => setTerm(e.target.value)}>
              {props.terms.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
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
          icon="zap"
          title={tx(p("Add papers from the timetable", "समय-सारणी से पेपर जोड़ें"))}
          sub={tx(p("One paper for each class-subject a teacher is assigned to. Sports and notebook checking are left out.", "हर कक्षा-विषय का एक पेपर जिसका शिक्षक तय है। खेल व कॉपी जाँच नहीं।"))}
          on={withPapers}
          onChange={setWithPapers}
        />
        {withPapers ? (
          <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
            {GROUP_KEYS.map((g) => (
              <Field key={g} label={`${tx(GROUP_LABELS[g])} · ${tx(p("maximum marks", "पूर्णांक"))}`}>
                <Input type="number" inputMode="numeric" min={5} max={200} value={max[g]} onChange={(e) => setMax({ ...max, [g]: Number(e.target.value) })} />
              </Field>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
