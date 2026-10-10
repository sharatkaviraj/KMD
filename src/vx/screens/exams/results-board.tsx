"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { ago, initials } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Input, Seg, Select, Stepper, SwitchRow, Textarea } from "@/vx/ui/controls";
import { Confirm, HelpButton, Sheet } from "@/vx/ui/overlays";
import { Banner, TopBar, VxPage } from "@/vx/ui/page";
import { Avatar, avatarColor, BarChart, Btn, Card, EmptyState, IconTile, Pill, Progress, Ring, SecHead, WhatsAppPreview, type Tone } from "@/vx/ui/primitives";

import { waLink } from "./domain/messages";
import type { PipelineStep, StepState } from "./domain/results";
import { RemindSheet, type TeacherRowView } from "./remind";
import type { ActionResult } from "./save-types";
import { useAct } from "./use-act";

export type ResultsView = "pipeline" | "moderation" | "grace" | "lock" | "cards" | "publish" | "recheck";

type Act<I> = (input: I) => Promise<ActionResult>;

type ClassRowView = {
  id: string;
  label: string;
  sort: number;
  teacher: string | null;
  children: number;
  percent: number;
  allSubmitted: boolean;
  late: number;
  unusual: number;
  unusualOpen: number;
  graceNeeded: number;
  locked: boolean;
  issued: number;
};

export type ResultsProps = {
  view: ResultsView;
  isAdmin: boolean;
  fromName: string;
  exam: {
    id: string;
    term: string;
    name: Pair;
    dates: string;
    sessionLabel: string;
    prevName: Pair | null;
    marksDue: string | null;
    daysToDue: number | null;
    resultsOn: string | null;
    resultsLabel: string | null;
    daysToResults: number | null;
    ptmAt: string | null;
    publishAt: string | null;
    publishedAt: string | null;
    ptm: boolean;
  };
  overall: { entered: number; total: number; percent: number; done: number; papers: number };
  teachers: TeacherRowView[];
  states: Record<PipelineStep, StepState>;
  classes: ClassRowView[];
  childrenTotal: number;
  unusualCount: number;
  unusualOpen: number;
  moderation: {
    classId: string | null;
    completeClasses: { id: string; label: string; unusual: number }[];
    still: number;
    flagged: { paperId: string; classId: string; classLabel: string; subjectCode: string; avgPct: number | null; baseline: number; delta: number; basis: "previous" | "school"; teacherName: string | null }[];
    papers: {
      paperId: string;
      subjectCode: string;
      teacherId: string | null;
      teacherName: string | null;
      teacherPhone: string | null;
      maxMarks: number;
      passMarks: number | null;
      avgPct: number | null;
      prevPct: number | null;
      baseline: number | null;
      basis: "previous" | "school" | null;
      delta: number | null;
      unusual: boolean;
      decision: "fine" | "recheck" | null;
      sat: number;
      below: number;
      highest: number | null;
      spread: number[];
    }[];
  };
  grace: {
    max: number;
    subjects: number;
    open: number;
    rows: {
      studentId: string;
      name: string;
      classId: string;
      classLabel: string;
      canPass: boolean;
      total: number;
      given: boolean;
      locked: boolean;
      needs: { paperId: string; subjectCode: string; value: number; passMarks: number; grace: number; maxMarks: number }[];
    }[];
  };
  cards: {
    issuedTotal: number;
    sample: {
      studentId: string;
      name: string;
      classLabel: string;
      issued: boolean;
      rows: { subject: string; scored: number; outOf: number; grade: string | null; grace: number }[];
      total: number;
      outOf: number;
      percent: number | null;
      grade: string | null;
      passed: boolean | null;
    } | null;
  };
  rechecks: {
    id: string;
    studentId: string;
    name: string;
    paperId: string;
    classLabel: string;
    subjectCode: string;
    maxMarks: number;
    mark: number | null;
    askedBy: string;
    note: string | null;
    status: "new" | "with_teacher" | "changed" | "no_change";
    oldValue: number | null;
    newValue: number | null;
    createdAt: string;
    teacherName: string | null;
    teacherPhone: string | null;
    locked: boolean;
  }[];
  paperChoices: { id: string; classId: string; label: string }[];
  rollChoices: Record<string, { id: string; name: string; roll: string | null }[]>;
  recheckId: string | null;
  actions: {
    moderate: Act<{ paperId: string; decision: "fine" | "recheck"; note?: string | null }>;
    saveGraceRule: Act<{ examId: string; max: number; subjects: number }>;
    giveGrace: Act<{ examId: string }>;
    removeGrace: Act<{ paperId: string; studentId: string }>;
    lock: Act<{ examId: string; classIds: string[] }>;
    unlock: Act<{ examId: string; classId: string }>;
    issueClass: Act<{ examId: string; classId: string; reissue?: boolean }>;
    publish: Act<{ examId: string; when: "now" | "scheduled"; at: string | null; ptm: boolean }>;
    addRecheck: Act<{ paperId: string; studentId: string; askedBy: string; note: string }>;
    recheckWithTeacher: Act<{ recheckId: string }>;
    resolveRecheck: Act<{ recheckId: string; delta: number }>;
    remind: Act<{ examId: string; staffIds: string[] }>;
  };
};

const STEP_ORDER: PipelineStep[] = ["entered", "checked", "grace", "locked", "cards", "published"];
const STATE_WORDS: Record<StepState, { label: Pair; tone: Tone }> = {
  done: { label: p("Done", "पूरा"), tone: "ok" },
  active: { label: p("In progress", "जारी"), tone: "ok" },
  can_start: { label: p("Can start", "शुरू कर सकते"), tone: "info" },
  waiting: { label: p("Waiting", "रुका"), tone: "mut" },
};
const TAB_FOR: Record<PipelineStep, ResultsView> = { entered: "pipeline", checked: "moderation", grace: "grace", locked: "lock", cards: "cards", published: "publish" };
const RECHECK_WORDS: Record<ResultsProps["rechecks"][number]["status"], { label: Pair; tone: Tone }> = {
  new: { label: p("New", "नया"), tone: "warn" },
  with_teacher: { label: p("With teacher", "शिक्षक के पास"), tone: "info" },
  changed: { label: p("Changed", "बदला"), tone: "ok" },
  no_change: { label: p("No change", "कोई बदलाव नहीं"), tone: "mut" },
};

export function ResultsBoard(props: ResultsProps) {
  const { view, exam, actions } = props;
  const { tx } = useVx();
  const { pending, run } = useAct();
  const [remindOpen, setRemindOpen] = useState(false);
  const href = (v: ResultsView, extra = "") => `/exam-office/results?view=${v}${extra}`;

  const titles: Record<ResultsView, Pair> = {
    pipeline: p("Results pipeline", "परिणाम की राह"),
    moderation: p("Check marks", "अंक जाँचें"),
    grace: p("Grace marks", "ग्रेस अंक"),
    lock: p("Lock marks", "अंक बंद करें"),
    cards: p("Report cards", "प्रगति पत्र"),
    publish: p("Publish results", "परिणाम जारी करें"),
    recheck: p("Re-checks", "दोबारा जाँच"),
  };
  const crumb = `${tx(p("Results", "परिणाम"))} · ${tx(exam.name)} ${exam.sessionLabel} · ${props.classes.length} ${tx(p("classes", "कक्षाएँ"))} · ${props.childrenTotal} ${tx(p("children", "बच्चे"))}`;
  const badge = exam.resultsLabel ? (
    <Pill tone="ok">
      {tx(p("Results day", "परिणाम दिवस"))} {exam.resultsLabel}
      {exam.daysToResults !== null && exam.daysToResults >= 0 ? ` · ${exam.daysToResults} ${tx(p("days", "दिन"))}` : ""}
    </Pill>
  ) : null;
  const nextStep = STEP_ORDER.find((s) => props.states[s] !== "done") ?? "published";
  const help = (
    <HelpButton
      title={tx(titles[view])}
      steps={[
        { icon: "list", title: tx(p("Six steps", "छह कदम")), body: tx(p("Entered, checked, grace, locked, report cards, published — in that order.", "भरे, जाँचे, ग्रेस, बंद, प्रगति पत्र, जारी — इसी क्रम में।")) },
        { icon: "alert", title: tx(p("Look at what moved", "जो बदला उसे देखें")), body: tx(p("A class average that moved a lot since the last exam is flagged.", "पिछली परीक्षा से बहुत बदला औसत दिखाया जाता है।")) },
        { icon: "lock", title: tx(p("Lock, then cards", "बंद करें, फिर कार्ड")), body: tx(p("Locked marks cannot change; cards are made from them.", "बंद अंक बदलते नहीं; कार्ड उन्हीं से बनते हैं।")) },
      ]}
    />
  );

  const tabs = (
    <ChipRow label={tx(p("Steps", "कदम"))}>
      {(["moderation", "grace", "lock", "cards", "publish", "recheck"] as ResultsView[]).map((v, i) => {
        const step = STEP_ORDER[i + 1];
        const n = v === "recheck" ? props.rechecks.filter((r) => !["changed", "no_change"].includes(r.status)).length : i + 2;
        const done = step && props.states[step] === "done";
        return (
          <Link key={v} href={href(v)} className={`tap chip${view === v ? " on" : ""}`}>
            <span className="num" style={{ width: 20, height: 20, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: view === v ? "rgba(255,255,255,.25)" : "var(--s3)" }}>
              {done ? <Ic n="check" size={12} /> : n}
            </span>
            {tx(titles[v])}
          </Link>
        );
      })}
    </ChipRow>
  );

  let body: React.ReactNode;
  switch (view) {
    case "moderation":
      body = <Moderation {...props} pending={pending} run={run} />;
      break;
    case "grace":
      body = <Grace {...props} pending={pending} run={run} />;
      break;
    case "lock":
      body = <Lock {...props} pending={pending} run={run} />;
      break;
    case "cards":
      body = <Cards {...props} pending={pending} run={run} />;
      break;
    case "publish":
      body = <Publish {...props} pending={pending} run={run} />;
      break;
    case "recheck":
      body = <Rechecks {...props} pending={pending} run={run} />;
      break;
    default:
      body = <Pipeline {...props} href={href} onRemind={() => setRemindOpen(true)} />;
  }

  return (
    <VxPage>
      <TopBar
        crumb={crumb}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {tx(titles[view])} {badge}
          </span>
        }
        mTitle={tx(titles[view])}
        mSub={view === "lock" ? `${props.classes.filter((c) => c.locked).length} ${tx(p("of", "में से"))} ${props.classes.length} ${tx(p("classes locked", "कक्षाएँ बंद"))}` : `${tx(exam.name)}${exam.resultsLabel ? ` · ${exam.resultsLabel}` : ""}`}
        mBack={view === "pipeline" ? "/exam-office" : href("pipeline")}
        actions={
          <>
            {view !== "pipeline" ? (
              <Btn variant="ghost" icon="chevLeft" href={href("pipeline")}>
                {tx(p("Pipeline", "राह"))}
              </Btn>
            ) : null}
            {help}
            {view === "pipeline" && nextStep !== "entered" ? (
              <Btn variant="pri" icon="arrowRight" href={href(TAB_FOR[nextStep])}>
                {tx(p("Next:", "अगला:"))} {tx(titles[TAB_FOR[nextStep]])}
              </Btn>
            ) : null}
          </>
        }
        mAction={help}
      />
      <main>
        <section className="pad" style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {view !== "pipeline" ? tabs : null}
          {body}
        </section>
      </main>
      <RemindSheet
        open={remindOpen}
        onClose={() => setRemindOpen(false)}
        teachers={props.teachers.filter((t) => t.late || !t.remindedAt)}
        exam={{ id: exam.id, en: exam.name.en, hi: exam.name.hi ?? exam.name.en }}
        dueLabel={exam.marksDue ?? "—"}
        from={props.fromName}
        remind={actions.remind}
      />
    </VxPage>
  );
}

type Run = ReturnType<typeof useAct>["run"];

/* --------------------------------------------------------- pipeline */

function Pipeline(props: ResultsProps & { href: (v: ResultsView, extra?: string) => string; onRemind: () => void }) {
  const { tx } = useVx();
  const { exam, classes, overall, teachers } = props;
  const locked = classes.filter((c) => c.locked).length;
  const ready = classes.filter((c) => !c.locked && c.allSubmitted).length;
  const cards: Record<PipelineStep, { title: Pair; big: string; sub: string; btn: Pair; href: string; value: number }> = {
    entered: { title: p("Marks entered", "अंक भरे"), big: `${overall.percent}%`, sub: tx(p(`${overall.entered} of ${overall.total} marks · ${teachers.filter((t) => t.late).length} teachers late`, `${overall.total} में से ${overall.entered} · ${teachers.filter((t) => t.late).length} शिक्षक देर से`)), btn: p("Marks tracker", "अंक ट्रैकर"), href: "/exams?view=grid", value: overall.percent },
    checked: { title: p("Checked", "जाँचे"), big: props.unusualOpen ? tx(p(`${props.unusualOpen} unusual`, `${props.unusualOpen} असामान्य`)) : tx(p("All fine", "सब ठीक")), sub: tx(p(`Class averages that moved a lot${exam.prevName ? ` since ${exam.prevName.en}` : ""}`, "जिन कक्षाओं का औसत बहुत बदला")), btn: p("Check marks", "अंक जाँचें"), href: props.href("moderation"), value: props.unusualCount ? ((props.unusualCount - props.unusualOpen) / props.unusualCount) * 100 : 100 },
    grace: { title: p("Grace", "ग्रेस"), big: tx(p(`${props.grace.rows.filter((g) => g.canPass).length} children`, `${props.grace.rows.filter((g) => g.canPass).length} बच्चे`)), sub: tx(p(`Can pass with up to ${props.grace.max} grace marks`, `${props.grace.max} तक ग्रेस से पास हो सकते`)), btn: p("Review grace", "ग्रेस देखें"), href: props.href("grace"), value: props.grace.rows.length ? (props.grace.rows.filter((g) => g.given).length / Math.max(1, props.grace.rows.filter((g) => g.canPass).length)) * 100 : 0 },
    locked: { title: p("Locked", "बंद"), big: `${locked} ${tx(p("of", "में से"))} ${classes.length}`, sub: tx(p(`${ready} classes ready to lock`, `${ready} कक्षाएँ बंद करने को तैयार`)), btn: p("Lock marks", "अंक बंद करें"), href: props.href("lock"), value: classes.length ? (locked / classes.length) * 100 : 0 },
    cards: { title: p("Report cards", "प्रगति पत्र"), big: `${props.cards.issuedTotal} ${tx(p("of", "में से"))} ${props.childrenTotal}`, sub: tx(p("Issued once a class is locked", "कक्षा बंद होने पर जारी")), btn: p("Report cards", "प्रगति पत्र"), href: props.href("cards"), value: props.childrenTotal ? (props.cards.issuedTotal / props.childrenTotal) * 100 : 0 },
    published: { title: p("Published", "जारी"), big: exam.publishedAt ? tx(p("Released", "जारी")) : (exam.resultsLabel ?? "—"), sub: exam.ptmAt ? tx(p(`Results day · PTM at ${exam.ptmAt}`, `परिणाम दिवस · PTM ${exam.ptmAt}`)) : tx(p("Results day", "परिणाम दिवस")), btn: p("Schedule", "समय तय करें"), href: props.href("publish"), value: exam.publishedAt ? 100 : 0 },
  };
  return (
    <>
      <Card style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 280px" }}>
          <strong className="serif" style={{ fontSize: 26, display: "block" }}>{tx(p(`${exam.name.en} results`, `${exam.name.hi ?? exam.name.en} परिणाम`))}</strong>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>
            {tx(p("Exams", "परीक्षा"))} {exam.dates} · {tx(p("six steps from marks to parents", "अंकों से अभिभावकों तक छह कदम"))}
          </span>
        </span>
        {exam.marksDue ? (
          <span style={{ padding: "10px 14px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em" }}>{tx(p("MARKS DUE", "अंक अंतिम तिथि"))}</span>
            <strong style={{ display: "block" }}>{exam.marksDue}</strong>
            {exam.daysToDue !== null ? <span style={{ fontSize: 12 }}>{exam.daysToDue >= 0 ? tx(p(`in ${exam.daysToDue} days`, `${exam.daysToDue} दिन में`)) : tx(p("passed", "बीत गई"))}</span> : null}
          </span>
        ) : null}
        {exam.resultsLabel ? (
          <span style={{ padding: "10px 14px", borderRadius: 14, background: "var(--infos)", color: "var(--info)" }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em" }}>{tx(p("RESULTS DAY", "परिणाम दिवस"))}</span>
            <strong style={{ display: "block" }}>{exam.resultsLabel}</strong>
            {exam.ptmAt ? <span style={{ fontSize: 12 }}>PTM {exam.ptmAt}</span> : null}
          </span>
        ) : null}
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {STEP_ORDER.map((s, i) => {
          const c = cards[s];
          const st = STATE_WORDS[props.states[s]];
          return (
            <Card key={s} style={{ display: "flex", flexDirection: "column", gap: 8, border: props.states[s] === "active" ? "2px solid var(--pri)" : undefined }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <span className="num" style={{ width: 26, height: 26, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, background: props.states[s] === "active" ? "var(--pri)" : "var(--s3)", color: props.states[s] === "active" ? "#fff" : "var(--fg)" }}>
                  {props.states[s] === "done" ? <Ic n="check" size={14} /> : i + 1}
                </span>
                <span style={{ flex: 1 }} />
                <Pill tone={st.tone}>{tx(st.label)}</Pill>
              </div>
              <strong>{tx(c.title)}</strong>
              <strong style={{ fontSize: 24 }}>{c.big}</strong>
              <span style={{ fontSize: 12, color: "var(--mut)", minHeight: 32 }}>{c.sub}</span>
              <Progress value={c.value} max={100} tone="var(--pri)" height={5} />
              <Btn variant="sec" href={c.href}>
                {tx(c.btn)} <Ic n="chevRight" size={16} />
              </Btn>
            </Card>
          );
        })}
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 330px", gap: 16, alignItems: "start" }}>
        <Card pad={false} style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--s2)", color: "var(--mut)", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>
                {[p("Class", "कक्षा"), p("Marks entered", "भरे"), p("Late", "देर"), p("Checked", "जाँचे"), p("Grace", "ग्रेस"), p("Locked", "बंद"), p("Card", "कार्ड")].map((h) => (
                  <th key={h.en} style={{ textAlign: "left", padding: "12px 10px" }}>
                    {tx(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--bd)" }}>
                  <td style={{ padding: "10px" }}>
                    <strong style={{ display: "block" }}>{c.label}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>
                      {c.teacher ?? "—"} · {c.children}
                    </span>
                  </td>
                  <td style={{ padding: 10, width: 140 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Progress value={c.percent} max={100} tone="var(--pri)" height={5} style={{ flex: 1 }} />
                      <strong className="num">{c.percent}%</strong>
                    </span>
                  </td>
                  <td style={{ padding: 10 }}>{c.late ? <Pill tone="bad">{c.late} {tx(p("late", "देर"))}</Pill> : <Pill>{tx(p("On time", "समय पर"))}</Pill>}</td>
                  <td style={{ padding: 10 }}>{c.unusualOpen ? <Pill tone="warn">{tx(p("Needs a look", "देखना है"))}</Pill> : c.allSubmitted ? <Pill tone="ok">{tx(p("Checked", "जाँचा"))}</Pill> : <Pill>{tx(p("Not checked", "नहीं जाँचा"))}</Pill>}</td>
                  <td style={{ padding: 10 }}>{c.graceNeeded ? <Pill tone="info">{c.graceNeeded} {tx(p("need grace", "को ग्रेस"))}</Pill> : <Pill>{tx(p("No grace", "ग्रेस नहीं"))}</Pill>}</td>
                  <td style={{ padding: 10 }}>{c.locked ? <Pill tone="ok" icon="lock">{tx(p("Locked", "बंद"))}</Pill> : c.allSubmitted ? <Pill tone="info">{tx(p("Ready to lock", "बंद को तैयार"))}</Pill> : <Pill>{tx(p("Not locked", "खुला"))}</Pill>}</td>
                  <td style={{ padding: 10 }}>{c.issued ? <Pill tone={c.issued >= c.children ? "ok" : "warn"}>{c.issued}/{c.children}</Pill> : <Pill>{tx(p("No card yet", "कार्ड नहीं"))}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <strong style={{ flex: 1 }}>{tx(p(`${teachers.filter((t) => t.late).length} teachers are late`, `${teachers.filter((t) => t.late).length} शिक्षक देर से`))}</strong>
            {exam.marksDue ? <Pill tone="bad">{tx(p("Due", "अंतिम"))} {exam.marksDue}</Pill> : null}
          </div>
          {teachers.slice(0, 8).map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--bd)" }}>
              <Avatar text={initials(t.name)} bg={avatarColor(t.id)} size={32} />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="clip" style={{ fontSize: 14 }}>{t.name}</strong>
                <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>
                  {t.papers.filter((x) => x.status !== "done").map((x) => `${x.classLabel} ${x.subjectCode}`).join(", ")} · {t.entered} {tx(p("of", "में से"))} {t.total}
                </span>
              </span>
            </div>
          ))}
          {teachers.length === 0 ? <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("Everyone has finished.", "सबने पूरा किया।"))}</span> : null}
          {teachers.length ? (
            <Btn variant="pri" icon="send" onClick={props.onRemind}>
              {tx(p("Remind on WhatsApp", "WhatsApp पर याद दिलाएँ"))}
            </Btn>
          ) : null}
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------- moderation */

function Moderation(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const router = useRouter();
  const { moderation, actions, run, pending, exam } = props;
  const [picked, setPicked] = useState<string | null>(moderation.papers.find((x) => x.unusual)?.paperId ?? moderation.papers[0]?.paperId ?? null);
  const paper = moderation.papers.find((x) => x.paperId === picked) ?? null;
  const klass = props.classes.find((c) => c.id === moderation.classId);
  if (moderation.completeClasses.length === 0 && moderation.papers.length === 0) {
    return <EmptyState icon="clipboard" title={tx(p("No class has all its marks in yet", "अभी किसी कक्षा के सब अंक नहीं आए"))} body={tx(p("A class shows up here once every paper is submitted.", "हर पेपर जमा होने पर कक्षा यहाँ दिखती है।"))} />;
  }
  const askText = paper
    ? `नमस्ते ${paper.teacherName ?? ""} जी, ${klass?.label ?? ""} ${paper.subjectCode} (${exam.name.hi ?? exam.name.en}) का औसत ${paper.avgPct ?? "—"}% है${paper.baseline !== null ? `, पहले ${paper.baseline}% था` : ""}। कृपया कॉपियाँ एक बार फिर जाँच लें।\n\nThe ${klass?.label ?? ""} ${paper.subjectCode} average is ${paper.avgPct ?? "—"}%${paper.baseline !== null ? ` (was ${paper.baseline}%)` : ""}. Please re-check the copies once.\n— ${props.fromName}`
    : "";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ChipRow label={tx(p("Complete classes", "पूरी कक्षाएँ"))} style={{ flex: 1 }}>
          {moderation.completeClasses.map((c) => (
            <Chip key={c.id} on={c.id === moderation.classId} onClick={() => router.push(`/exam-office/results?view=moderation&class=${c.id}`)}>
              <span style={{ width: 7, height: 7, borderRadius: 4, background: c.unusual ? "var(--warn)" : "var(--ok)", display: "inline-block" }} />
              {c.label}
            </Chip>
          ))}
        </ChipRow>
        {moderation.still ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${moderation.still} classes still entering marks · they show up here when complete`, `${moderation.still} कक्षाओं के अंक आ रहे हैं · पूरे होने पर यहाँ दिखेंगी`))}</span> : null}
      </div>
      {moderation.flagged.map((f) => (
        <Link key={f.paperId} href={`/exam-office/results?view=moderation&class=${f.classId}`} className="tap" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)", textDecoration: "none" }}>
          <Ic n={f.delta < 0 ? "alert" : "trend"} size={20} />
          <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <strong>{tx(p(`${f.classLabel} ${f.subjectCode} average ${f.delta < 0 ? "dropped" : "rose"} ${Math.abs(f.delta)}%`, `${f.classLabel} ${f.subjectCode} का औसत ${Math.abs(f.delta)}% ${f.delta < 0 ? "गिरा" : "बढ़ा"}`))}</strong>
            <span style={{ fontSize: 13 }}>
              {f.basis === "previous" ? (exam.prevName ? tx(exam.prevName) : tx(p("Last exam", "पिछली परीक्षा"))) : tx(p("School average", "स्कूल औसत"))} {f.baseline}% → {tx(p("now", "अब"))} {f.avgPct}%{f.teacherName ? ` · ${f.teacherName}` : ""}
            </span>
          </span>
          <Ic n="chevRight" size={16} />
        </Link>
      ))}
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 440px", gap: 16, alignItems: "start" }}>
        <Card pad={false} style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
            <thead>
              <tr style={{ background: "var(--s2)", color: "var(--mut)", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: 12 }}>{tx(p("Subject", "विषय"))}</th>
                <th style={{ textAlign: "right", padding: 12 }}>{exam.prevName ? tx(exam.prevName) : tx(p("Before", "पहले"))}</th>
                <th style={{ textAlign: "right", padding: 12 }}>{tx(p("Now", "अब"))}</th>
                <th style={{ textAlign: "right", padding: 12 }}>{tx(p("Change", "बदलाव"))}</th>
              </tr>
            </thead>
            <tbody>
              {moderation.papers.map((x) => {
                const change = x.avgPct !== null && x.prevPct !== null ? Math.round((x.avgPct - x.prevPct) * 10) / 10 : null;
                return (
                  <tr key={x.paperId} onClick={() => setPicked(x.paperId)} className="tap" style={{ borderTop: "1px solid var(--bd)", cursor: "pointer", background: x.paperId === picked ? "var(--accs)" : undefined }}>
                    <td style={{ padding: 12 }}>
                      <strong style={{ display: "block" }}>{x.subjectCode}</strong>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{x.teacherName ?? "—"}</span>
                    </td>
                    <td style={{ padding: 12, textAlign: "right", color: "var(--mut)" }}>{x.prevPct === null ? "—" : `${x.prevPct}%`}</td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      <strong>{x.avgPct === null ? "—" : `${x.avgPct}%`}</strong>
                    </td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      {x.decision ? <Pill tone={x.decision === "fine" ? "ok" : "warn"}>{x.decision === "fine" ? tx(p("Fine", "ठीक")) : tx(p("Re-check", "दोबारा"))}</Pill> : change === null ? "—" : <Pill tone={x.unusual ? "bad" : "mut"}>{change > 0 ? `+${change}` : change}%</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        {paper ? (
          <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
              <span style={{ flex: 1 }}>
                <strong style={{ fontSize: 17, display: "block" }}>
                  {klass?.label} · {paper.subjectCode}
                </strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {paper.teacherName ?? "—"} · {tx(p("out of", "पूर्णांक"))} {paper.maxMarks} · {paper.sat} {tx(p("children", "बच्चे"))}
                </span>
              </span>
              {paper.unusual ? <Pill tone="warn">{tx(p("Unusual", "असामान्य"))}</Pill> : null}
            </div>
            <SecHead>{tx(p("How the marks are spread", "अंक कैसे फैले हैं"))}</SecHead>
            <BarChart data={paper.spread.map((v, i) => ({ label: `${i * 10}%`, value: v, highlight: paper.passMarks !== null && (i + 1) * 10 <= (paper.passMarks / paper.maxMarks) * 100 }))} height={150} format={(v) => String(v)} labelEvery={2} />
            {[
              [p("Average now", "अब का औसत"), `${paper.avgPct ?? "—"}%${paper.prevPct !== null ? ` · ${exam.prevName ? tx(exam.prevName) : ""} ${paper.prevPct}%` : ""}`],
              [p("Below pass", "पास से कम"), `${paper.below} ${tx(p("children", "बच्चे"))}`],
              [p("Highest", "सबसे ज़्यादा"), paper.highest === null ? "—" : `${paper.highest} / ${paper.maxMarks}`],
            ].map(([k, v]) => (
              <div key={(k as Pair).en} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
                <span style={{ color: "var(--mut)" }}>{tx(k as Pair)}</span>
                <strong>{v as string}</strong>
              </div>
            ))}
            <Btn
              variant="pri"
              icon="send"
              disabled={pending}
              onClick={() =>
                run(
                  () => actions.moderate({ paperId: paper.paperId, decision: "recheck", note: null }),
                  () => window.open(waLink(paper.teacherPhone, askText), "_blank", "noopener"),
                )
              }
            >
              {tx(p(`Ask ${paper.teacherName ?? "the teacher"} to re-check`, `${paper.teacherName ?? "शिक्षक"} से दोबारा जाँच कहें`))}
            </Btn>
            <Btn variant="ghost" disabled={pending} onClick={() => run(() => actions.moderate({ paperId: paper.paperId, decision: "fine", note: null }))}>
              {tx(p("Looks fine — no re-check", "ठीक है — दोबारा जाँच नहीं"))}
            </Btn>
          </Card>
        ) : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------ grace */

function Grace(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { grace, exam, actions, run, pending } = props;
  const [max, setMax] = useState(grace.max);
  const [subjects, setSubjects] = useState<"1" | "2">(grace.subjects === 1 ? "1" : "2");
  const changed = max !== grace.max || Number(subjects) !== grace.subjects;
  // Live preview with the rule as set on screen.
  const passing = grace.rows.filter((g) => g.needs.length <= Number(subjects) && g.needs.every((n) => n.grace <= max) && !g.needs.some(() => false) && (g.canPass || (g.needs.length <= Number(subjects) && g.needs.every((n) => n.grace <= max))));
  const short = grace.rows.filter((g) => !passing.includes(g));
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "460px minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <IconTile icon="shield" tone="info" size={38} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong>{tx(p("The school rule", "स्कूल का नियम"))}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("For this exam · the card shows grace as G", "इस परीक्षा के लिए · कार्ड पर ग्रेस G दिखता है"))}</span>
          </span>
        </div>
        <div style={{ padding: 14, borderRadius: 14, background: "var(--s2)", fontSize: 15 }}>
          {tx(
            p(
              `A child who is short of the pass mark by up to ${max} marks in ${subjects === "1" ? "one subject" : "up to two subjects"} gets those marks and passes.`,
              `जो बच्चा ${subjects === "1" ? "एक विषय" : "दो विषयों तक"} में पास अंक से ${max} अंक तक कम है, उसे वे अंक मिलते हैं और वह पास होता है।`,
            ),
          )}
        </div>
        <Field label={tx(p("Most grace marks", "सबसे ज़्यादा ग्रेस"))}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Stepper value={max} min={0} max={10} onChange={setMax} label={tx(p("grace marks", "ग्रेस अंक"))} />
            <strong style={{ fontSize: 20 }}>{max}</strong>
            <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("marks per subject", "अंक प्रति विषय"))}</span>
          </span>
        </Field>
        <Field label={tx(p("In how many subjects", "कितने विषयों में"))}>
          <Seg
            value={subjects}
            onChange={setSubjects}
            label={tx(p("Subjects", "विषय"))}
            options={[
              { value: "1", label: tx(p("One subject", "एक विषय")) },
              { value: "2", label: tx(p("Up to two", "दो तक")) },
            ]}
          />
        </Field>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Grace only lifts a child to the pass mark, never higher. It is kept beside the mark, not added into it.", "ग्रेस बच्चे को सिर्फ़ पास अंक तक लाता है, उससे ऊपर नहीं। यह अंक के साथ रखा जाता है, उसमें जोड़ा नहीं जाता।"))}</span>
        {changed ? (
          <Btn variant="sec" icon="check" disabled={pending} onClick={() => run(() => actions.saveGraceRule({ examId: exam.id, max, subjects: Number(subjects) }))}>
            {tx(p("Save the rule", "नियम सहेजें"))}
          </Btn>
        ) : (
          <Btn variant="pri" icon="check" disabled={pending || grace.open === 0} onClick={() => run(() => actions.giveGrace({ examId: exam.id }))}>
            {grace.open ? tx(p(`Give grace to ${grace.open} children`, `${grace.open} बच्चों को ग्रेस दें`)) : tx(p("Grace is up to date", "ग्रेस पूरे"))}
          </Btn>
        )}
      </Card>
      <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 8 }}>
          <strong className="serif" style={{ fontSize: 44, color: "var(--ok)" }}>{passing.length}</strong>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <strong>{tx(p(`${passing.length} children pass with grace`, `${passing.length} बच्चे ग्रेस से पास`))}</strong>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p(`${short.length} more are still short · they need remedial classes`, `${short.length} अब भी कम · इन्हें अतिरिक्त कक्षा चाहिए`))}</span>
          </span>
        </div>
        {[...passing, ...short].map((g) => {
          const ok = passing.includes(g);
          return (
            <div key={g.studentId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong className="clip">{g.name}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>
                  {g.classLabel} · {g.needs.map((n) => n.subjectCode).join(", ")}
                </span>
              </span>
              <span className="num" style={{ fontSize: 13 }}>{g.needs.map((n) => (ok ? `${n.value}→${n.passMarks}` : `${n.value}`)).join(", ")} / {g.needs[0]?.maxMarks}</span>
              {ok ? (
                g.given ? (
                  <Btn variant="ghost" disabled={pending || g.locked} onClick={() => g.needs.forEach((n) => run(() => actions.removeGrace({ paperId: n.paperId, studentId: g.studentId })))}>
                    <Pill tone="ok" icon="check">+{g.total} G</Pill>
                  </Btn>
                ) : (
                  <Pill tone="ok">+{g.total}</Pill>
                )
              ) : (
                <Pill>{tx(p("short", "कम"))} {g.total}</Pill>
              )}
            </div>
          );
        })}
        {grace.rows.length === 0 ? <EmptyState icon="checkCircle" title={tx(p("Nobody is below the pass mark", "कोई पास अंक से नीचे नहीं"))} /> : null}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- lock */

function Lock(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { classes, exam, actions, run, pending } = props;
  const [picked, setPicked] = useState<string[]>(() => classes.filter((c) => c.allSubmitted && !c.locked).map((c) => c.id));
  const [confirm, setConfirm] = useState(false);
  const chosen = classes.filter((c) => picked.includes(c.id));
  const kids = chosen.reduce((a, c) => a + c.children, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center", padding: 24 }}>
        <IconTile icon="lock" tone="acc" size={72} />
        <strong className="serif" style={{ fontSize: 24 }}>{tx(p("Lock the marks?", "अंक बंद करें?"))}</strong>
        <span style={{ color: "var(--mut)", maxWidth: 440 }}>{tx(p("After locking, teachers can't change marks — not from this app or the old one. Only the admin can unlock.", "बंद करने के बाद शिक्षक अंक नहीं बदल सकते — न इस ऐप से, न पुराने से। केवल प्रशासक खोल सकते हैं।"))}</span>
      </Card>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <strong style={{ flex: 1 }}>{tx(p("Which classes?", "कौन-सी कक्षाएँ?"))}</strong>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>
            {chosen.length} {tx(p("classes", "कक्षाएँ"))} · {kids} {tx(p("children", "बच्चे"))}
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {classes.map((c) => {
            const on = picked.includes(c.id);
            if (c.locked) {
              return (
                <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Pill tone="ok" icon="lock">
                    {c.label}
                  </Pill>
                  {props.isAdmin ? (
                    <Btn variant="ghost" disabled={pending} onClick={() => run(() => actions.unlock({ examId: exam.id, classId: c.id }))}>
                      {tx(p("Unlock", "खोलें"))}
                    </Btn>
                  ) : null}
                </span>
              );
            }
            return (
              <Chip key={c.id} on={on} icon={on ? "check" : undefined} onClick={() => c.allSubmitted && setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])} style={{ opacity: c.allSubmitted ? 1 : 0.55 }}>
                {c.label} <span className="num" style={{ fontSize: 12 }}>{c.percent}%</span>
              </Chip>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("A class can be locked once every paper is submitted.", "हर पेपर जमा होने पर ही कक्षा बंद हो सकती है।"))}</span>
      </Card>
      <Btn variant="pri" big icon="lock" disabled={pending || chosen.length === 0} onClick={() => setConfirm(true)}>
        {tx(p(`Lock ${chosen.length} classes`, `${chosen.length} कक्षाएँ बंद करें`))}
      </Btn>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={pending}
        title={tx(p(`Lock ${chosen.length} classes?`, `${chosen.length} कक्षाएँ बंद करें?`))}
        body={chosen.map((c) => c.label).join(", ")}
        confirmLabel={tx(p("Lock", "बंद करें"))}
        onConfirm={() => run(() => actions.lock({ examId: exam.id, classIds: picked }), () => setConfirm(false))}
      />
    </div>
  );
}

/* ------------------------------------------------------------ cards */

function Cards(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { classes, cards, exam, actions, run, pending, childrenTotal } = props;
  const termQ = `term=${encodeURIComponent(exam.term)}`;
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 440px", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Ring value={cards.issuedTotal} max={Math.max(1, childrenTotal)} size={86} stroke={9} tone="var(--ok)">
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <strong className="num" style={{ fontSize: 18 }}>{cards.issuedTotal}</strong>
              <span style={{ fontSize: 11, color: "var(--mut)" }}>
                {tx(p("of", "में से"))} {childrenTotal}
              </span>
            </span>
          </Ring>
          <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column" }}>
            <strong className="serif" style={{ fontSize: 22 }}>{tx(p(`${cards.issuedTotal} report cards issued`, `${cards.issuedTotal} प्रगति पत्र जारी`))}</strong>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Draft = marks still coming. A card is issued (final) once its class is locked.", "ड्राफ़्ट = अंक आ रहे हैं। कक्षा बंद होने पर कार्ड जारी (पक्का) होता है।"))}</span>
          </span>
          <Btn variant="pri" href="/exam-office/results?view=publish">
            {tx(p("Publish to parents", "अभिभावकों को जारी करें"))} <Ic n="chevRight" size={16} />
          </Btn>
        </Card>
        <Card pad={false}>
          {classes.map((c) => {
            const final = c.children > 0 && c.issued >= c.children;
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderTop: "1px solid var(--bd)", flexWrap: "wrap" }}>
                <span style={{ width: 120, display: "flex", flexDirection: "column" }}>
                  <strong>{c.label}</strong>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {c.children} {tx(p("children", "बच्चे"))}
                  </span>
                </span>
                <Progress value={c.locked ? c.issued : c.percent} max={c.locked ? Math.max(1, c.children) : 100} tone={final ? "var(--ok)" : "var(--info)"} style={{ flex: "1 1 120px" }} />
                <Pill tone={final ? "ok" : c.issued ? "warn" : "mut"}>{final ? tx(p("Final", "पक्का")) : c.issued ? `${c.issued}/${c.children}` : tx(p("Draft", "ड्राफ़्ट"))}</Pill>
                <a className="tap btn ghost" href={`/exams/report-card?class=${c.id}&${termQ}`} target="_blank" rel="noopener noreferrer" aria-label={tx(p("Print the class's cards", "कक्षा के कार्ड छापें"))}>
                  <Ic n="printer" size={16} />
                </a>
                {c.locked && !final ? (
                  <Btn variant="sec" disabled={pending} onClick={() => run(() => actions.issueClass({ examId: exam.id, classId: c.id }))}>
                    {tx(p("Issue cards", "कार्ड जारी करें"))}
                  </Btn>
                ) : null}
              </div>
            );
          })}
        </Card>
      </div>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SecHead>
          {tx(p("Sample", "नमूना"))} · {cards.sample ? `${cards.sample.name}, ${cards.sample.classLabel}` : ""}
        </SecHead>
        {cards.sample ? (
          <>
            <div style={{ border: "1px solid var(--bd)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <strong className="serif" style={{ borderBottom: "2px solid var(--fg)", paddingBottom: 6 }}>
                {process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}
              </strong>
              <span style={{ textAlign: "center", fontWeight: 600, background: "var(--s2)", borderRadius: 8, padding: 4 }}>
                {exam.name.hi} · {exam.name.en} · {tx(p("Report card", "प्रगति पत्र"))} {cards.sample.issued ? "" : `(${tx(p("draft", "ड्राफ़्ट"))})`}
              </span>
              {cards.sample.rows.map((r) => (
                <div key={r.subject} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 4 }}>
                  <span>{r.subject}</span>
                  <strong className="num">
                    {r.scored}
                    {r.grace ? ` +${r.grace}G` : ""}/{r.outOf} · {r.grade ?? "—"}
                  </strong>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid var(--fg)", paddingTop: 6 }}>
                <strong>
                  {tx(p("Total", "कुल"))} {cards.sample.total}/{cards.sample.outOf}
                </strong>
                <strong style={{ color: "var(--ok)" }}>
                  {cards.sample.percent ?? "—"}% · {cards.sample.grade ?? "—"}
                  {cards.sample.passed === null ? "" : cards.sample.passed ? ` · ${tx(p("Pass", "उत्तीर्ण"))}` : ""}
                </strong>
              </div>
            </div>
            <Btn variant="sec" icon="eye" href={`/exams?view=preview&student=${cards.sample.studentId}`}>
              {tx(p("Open the full preview", "पूरी झलक खोलें"))}
            </Btn>
            <a className="tap btn soft" href={`/exams/report-card?student=${cards.sample.studentId}&${termQ}`} target="_blank" rel="noopener noreferrer">
              <Ic n="download" size={16} /> PDF
            </a>
          </>
        ) : (
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{tx(p("A sample appears once a class has all its marks.", "किसी कक्षा के सब अंक आने पर नमूना दिखेगा।"))}</span>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- publish */

function Publish(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { exam, actions, run, pending, classes } = props;
  const defaultAt = exam.resultsOn ? `${exam.resultsOn}T09:00` : "";
  const [when, setWhen] = useState<"now" | "scheduled">(exam.resultsOn ? "scheduled" : "now");
  const [at, setAt] = useState(exam.publishAt ? exam.publishAt.slice(0, 16) : defaultAt);
  const [ptm, setPtm] = useState(exam.ptm);
  const unlocked = classes.filter((c) => !c.locked).length;
  const lines = [
    "प्रिय अभिभावक,",
    `${exam.name.hi ?? exam.name.en} का परिणाम तैयार है। प्रगति पत्र ${ptm && exam.ptmAt ? `PTM (${exam.resultsLabel ?? ""}, ${exam.ptmAt}) पर कक्षा अध्यापक दिखाएँगे।` : "स्कूल से मिलेगा।"}`,
    "",
    `Dear parent, the ${exam.name.en} result is ready.${ptm && exam.ptmAt ? ` The class teacher will show the card at the PTM (${exam.resultsLabel ?? ""}, ${exam.ptmAt}).` : ""}`,
  ];
  return (
    <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 420px", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {exam.publishedAt ? <Banner tone="ok">{tx(p(`Released ${ago(exam.publishedAt)}.`, `${ago(exam.publishedAt)} जारी।`))}</Banner> : exam.publishAt ? <Banner tone="info">{tx(p(`Scheduled for ${new Date(exam.publishAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`, "समय तय है।"))}</Banner> : null}
        {unlocked ? <Banner tone="warn">{tx(p(`${unlocked} classes are not locked yet — their cards wait until they are.`, `${unlocked} कक्षाएँ अभी बंद नहीं — उनके कार्ड रुकेंगे।`))}</Banner> : null}
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <strong style={{ fontSize: 17 }}>{tx(p("When should results go out?", "परिणाम कब जारी हों?"))}</strong>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Chip on={when === "now"} icon="send" onClick={() => setWhen("now")}>
              {tx(p("Now", "अभी"))}
            </Chip>
            <Chip on={when === "scheduled"} icon="clock" onClick={() => setWhen("scheduled")}>
              {tx(p("At a set time", "तय समय पर"))}
            </Chip>
          </div>
          {when === "scheduled" ? (
            <Field label={tx(p("Date and time", "तिथि और समय"))}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          ) : null}
        </Card>
        <Card>
          <SwitchRow
            icon="users"
            on={ptm}
            onChange={setPtm}
            title={tx(p("Results also shown at the PTM", "PTM पर भी परिणाम दिखाएँ"))}
            sub={exam.ptmAt ? tx(p(`${exam.resultsLabel ?? ""} ${exam.ptmAt} · class teachers show each card to the parent`, `${exam.resultsLabel ?? ""} ${exam.ptmAt} · कक्षा अध्यापक हर कार्ड दिखाएँगे`)) : undefined}
          />
        </Card>
        <Card style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            [p("To", "किसे"), tx(p(`${props.childrenTotal} families · one card per child`, `${props.childrenTotal} परिवार · हर बच्चे का एक कार्ड`))],
            [p("Cards issued", "कार्ड जारी"), `${props.cards.issuedTotal} / ${props.childrenTotal}`],
            [p("Message to families", "परिवारों को संदेश"), tx(p("From Notices, approved before it leaves", "सूचनाओं से, भेजने से पहले मंज़ूरी"))],
          ].map(([k, v]) => (
            <div key={(k as Pair).en} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid var(--bd)" }}>
              <span style={{ color: "var(--mut)" }}>{tx(k as Pair)}</span>
              <strong style={{ textAlign: "right" }}>{v as string}</strong>
            </div>
          ))}
        </Card>
        <Btn
          variant="pri"
          big
          icon={when === "now" ? "send" : "clock"}
          disabled={pending || (when === "scheduled" && !at)}
          onClick={() => run(() => actions.publish({ examId: exam.id, when, at: when === "scheduled" ? new Date(at).toISOString() : null, ptm }))}
        >
          {when === "now" ? tx(p("Release results now", "परिणाम अभी जारी करें")) : tx(p("Schedule the release", "जारी करने का समय तय करें"))}
        </Btn>
      </div>
      <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SecHead>{tx(p("Preview · each parent gets only their own child's card", "झलक · हर अभिभावक को केवल अपने बच्चे का कार्ड"))}</SecHead>
        <WhatsAppPreview title={tx(p("To parents", "अभिभावकों को"))} lines={lines} footer={`📎 ${tx(p("Report card", "प्रगति पत्र"))} · PDF`} />
        <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("This screen records when results are released. The WhatsApp to families goes from Notices.", "यह स्क्रीन जारी करने का समय दर्ज करती है। परिवारों को WhatsApp सूचनाओं से जाता है।"))}</span>
        <Btn variant="sec" icon="megaphone" href="/messages">
          {tx(p("Open Notices", "सूचनाएँ खोलें"))}
        </Btn>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------- recheck */

function Rechecks(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { rechecks, actions, run, pending, exam } = props;
  const [openId, setOpenId] = useState<string | null>(props.recheckId ?? rechecks.find((r) => r.status === "new")?.id ?? null);
  const [delta, setDelta] = useState(0);
  const [mode, setMode] = useState<"none" | "changed">("none");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ classId: "", paperId: "", studentId: "", askedBy: "", note: "" });
  const r = rechecks.find((x) => x.id === openId) ?? null;
  const counts = { new: 0, with_teacher: 0, done: 0 };
  for (const x of rechecks) {
    if (x.status === "new") counts.new += 1;
    else if (x.status === "with_teacher") counts.with_teacher += 1;
    else counts.done += 1;
  }
  const classOptions = [...new Map(props.paperChoices.map((c) => [c.classId, c.label.split(" · ")[0]])).entries()];
  const ask = r
    ? `नमस्ते ${r.teacherName ?? ""} जी, ${r.name} (${r.classLabel}) की ${r.subjectCode} कॉपी (${exam.name.hi ?? exam.name.en}) दोबारा जाँचने का अनुरोध है: "${r.note ?? ""}"। अभी अंक ${r.mark ?? "—"}/${r.maxMarks} हैं।\n\nRe-check request for ${r.name}, ${r.classLabel} ${r.subjectCode}: "${r.note ?? ""}". Marks now ${r.mark ?? "—"}/${r.maxMarks}.\n— ${props.fromName}`
    : "";
  const pick = (id: string) => {
    setOpenId(id);
    setDelta(0);
    setMode("none");
  };
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone="warn">
          {counts.new} {tx(p("new", "नए"))}
        </Pill>
        <Pill tone="info">
          {counts.with_teacher} {tx(p("with teachers", "शिक्षकों के पास"))}
        </Pill>
        <Pill tone="ok">
          {counts.done} {tx(p("done", "पूरे"))}
        </Pill>
        <span style={{ flex: 1 }} />
        <Btn variant="sec" icon="plus" onClick={() => setAdding(true)}>
          {tx(p("Add a request", "अनुरोध जोड़ें"))}
        </Btn>
      </div>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: r ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Card pad={false}>
            {rechecks.length === 0 ? <EmptyState icon="inbox" title={tx(p("No re-check requests", "कोई दोबारा जाँच अनुरोध नहीं"))} /> : null}
            {rechecks.map((x) => {
              const w = RECHECK_WORDS[x.status];
              const changeText = x.status === "changed" && x.oldValue !== null && x.newValue !== null ? ` ${x.newValue - x.oldValue > 0 ? "+" : ""}${x.newValue - x.oldValue}` : "";
              return (
                <button key={x.id} type="button" className="tap row" onClick={() => pick(x.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--bd)", background: x.id === openId ? "var(--accs)" : "transparent", border: "none", textAlign: "left", cursor: "pointer", color: "inherit" }}>
                  <Avatar text={initials(x.name)} bg={avatarColor(x.studentId)} size={34} />
                  <span style={{ width: 170, display: "flex", flexDirection: "column" }}>
                    <strong className="clip">{x.name}</strong>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>
                      {x.classLabel} · {x.subjectCode}
                    </span>
                  </span>
                  <em className="clip hide-m" style={{ flex: 1, color: "var(--mut)", fontSize: 13 }}>
                    “{x.note ?? ""}”
                  </em>
                  <Pill tone={w.tone}>
                    {tx(w.label)}
                    {changeText}
                  </Pill>
                  <Ic n="chevRight" size={16} />
                </button>
              );
            })}
          </Card>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("Requests come from parents on WhatsApp or through the class teacher. The subject teacher checks the copy again.", "अनुरोध अभिभावकों से WhatsApp या कक्षा अध्यापक के ज़रिये आते हैं। विषय-अध्यापक कॉपी दोबारा जाँचते हैं।"))}</span>
        </div>
        {r ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Pill tone={RECHECK_WORDS[r.status].tone}>{tx(RECHECK_WORDS[r.status].label)}</Pill>
                <span style={{ flex: 1 }} />
                <Btn variant="ghost" icon="x" ariaLabel={tx(p("Close", "बंद करें"))} onClick={() => setOpenId(null)} />
              </div>
              <strong className="serif" style={{ fontSize: 22 }}>{r.name}</strong>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>
                {r.classLabel} · {r.subjectCode} · {tx(exam.name)}
              </span>
              {r.note ? <div style={{ padding: 10, borderRadius: 12, background: "var(--s2)", fontStyle: "italic" }}>“{r.note}”</div> : null}
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {r.askedBy} · {ago(r.createdAt)}
              </span>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: "var(--mut)" }}>{tx(p("Marks now", "अभी अंक"))}</span>
                <strong className="num" style={{ fontSize: 24 }}>
                  {r.mark ?? "—"} / {r.maxMarks}
                </strong>
              </div>
            </Card>
            {r.status === "new" || r.status === "with_teacher" ? (
              <>
                <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <SecHead>{tx(p("1 · Ask the subject teacher", "1 · विषय-अध्यापक से कहें"))}</SecHead>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar text={initials(r.teacherName ?? "?")} bg={avatarColor(r.teacherName ?? "?")} size={32} />
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <strong>{r.teacherName ?? tx(p("No teacher on the timetable", "समय-सारणी में शिक्षक नहीं"))}</strong>
                      <span style={{ fontSize: 12, color: "var(--mut)" }}>{r.status === "with_teacher" ? tx(p("Asked", "कहा गया")) : tx(p("Not asked yet", "अभी नहीं कहा"))}</span>
                    </span>
                  </span>
                  <Btn
                    variant={r.status === "new" ? "pri" : "soft"}
                    icon="send"
                    disabled={pending}
                    onClick={() => {
                      window.open(waLink(r.teacherPhone, ask), "_blank", "noopener");
                      if (r.status === "new") run(() => actions.recheckWithTeacher({ recheckId: r.id }));
                    }}
                  >
                    {r.status === "new" ? tx(p(`Ask ${r.teacherName ?? "the teacher"} to re-check`, `${r.teacherName ?? "शिक्षक"} से दोबारा जाँच कहें`)) : tx(p("Ask again", "फिर कहें"))}
                  </Btn>
                </Card>
                <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <SecHead>{tx(p("2 · What changed?", "2 · क्या बदला?"))}</SecHead>
                  <Seg
                    value={mode}
                    onChange={(v) => {
                      setMode(v);
                      if (v === "none") setDelta(0);
                    }}
                    label={tx(p("Outcome", "नतीजा"))}
                    options={[
                      { value: "none", label: tx(p("No change", "कोई बदलाव नहीं")) },
                      { value: "changed", label: tx(p("Marks changed", "अंक बदले")) },
                    ]}
                  />
                  {mode === "changed" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Stepper value={delta + 20} min={0} max={40} onChange={(v) => setDelta(v - 20)} label={tx(p("marks", "अंक"))} />
                      <strong style={{ fontSize: 20 }}>{delta > 0 ? `+${delta}` : delta}</strong>
                      <span className="num" style={{ color: "var(--mut)" }}>
                        {r.mark ?? "—"} → {r.mark === null ? "—" : r.mark + delta} / {r.maxMarks}
                      </span>
                    </div>
                  ) : null}
                  {r.locked && mode === "changed" ? <Banner tone="warn">{tx(p("This class is locked. The admin unlocks it before a mark can change.", "यह कक्षा बंद है। अंक बदलने से पहले प्रशासक खोलेंगे।"))}</Banner> : null}
                  <Btn variant="pri" icon="check" disabled={pending || (mode === "changed" && delta === 0)} onClick={() => run(() => actions.resolveRecheck({ recheckId: r.id, delta: mode === "changed" ? delta : 0 }))}>
                    {mode === "changed" ? tx(p("Save the new mark", "नए अंक सहेजें")) : tx(p("Close · no change", "बंद करें · कोई बदलाव नहीं"))}
                  </Btn>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(p("A changed mark is saved as a correction with its reason, like any change after submission.", "बदला अंक कारण के साथ सुधार के रूप में सहेजा जाता है।"))}</span>
                </Card>
              </>
            ) : (
              <Card>
                <span>
                  {r.status === "changed" ? tx(p(`Changed from ${r.oldValue} to ${r.newValue}.`, `${r.oldValue} से ${r.newValue} किया।`)) : tx(p("Checked again — no change.", "दोबारा जाँचा — कोई बदलाव नहीं।"))}
                </span>
              </Card>
            )}
          </div>
        ) : null}
      </div>
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        icon="plus"
        title={tx(p("Add a re-check request", "दोबारा जाँच अनुरोध जोड़ें"))}
        footer={
          <Btn
            variant="pri"
            full
            icon="check"
            disabled={pending || !form.paperId || !form.studentId || form.askedBy.trim().length < 2}
            onClick={() => run(() => actions.addRecheck({ paperId: form.paperId, studentId: form.studentId, askedBy: form.askedBy, note: form.note }), () => setAdding(false))}
          >
            {tx(p("Add request", "अनुरोध जोड़ें"))}
          </Btn>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label={tx(p("Class", "कक्षा"))}>
            <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, paperId: "", studentId: "" })}>
              <option value="">—</option>
              {classOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tx(p("Subject", "विषय"))}>
            <Select value={form.paperId} onChange={(e) => setForm({ ...form, paperId: e.target.value })} disabled={!form.classId}>
              <option value="">—</option>
              {props.paperChoices
                .filter((c) => c.classId === form.classId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={tx(p("Child", "बच्चा"))}>
            <Select value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} disabled={!form.classId}>
              <option value="">—</option>
              {(props.rollChoices[form.classId] ?? []).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.roll ? `${k.roll}. ` : ""}
                  {k.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tx(p("Who asked", "किसने कहा"))}>
            <Input value={form.askedBy} onChange={(e) => setForm({ ...form, askedBy: e.target.value })} placeholder={tx(p("Father, on WhatsApp", "पिता, WhatsApp पर"))} />
          </Field>
          <Field label={tx(p("What they said", "क्या कहा"))}>
            <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} maxLength={300} />
          </Field>
        </div>
      </Sheet>
    </>
  );
}
