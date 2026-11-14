"use client";

import Link from "@/ui/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { agoP } from "@/vx/format";
import { Crest } from "@/vx/screens/system/crest";
import { p, type Pair } from "@/vx/text";
import { Field, Input, Seg, Select, Textarea } from "@/vx/ui/controls";
import { Confirm, Sheet } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

import { supportLine } from "./domain/card-words";
import { subjectPair } from "./domain/groups";
import { waLink } from "./domain/messages";
import { READINESS_LABEL, type ClassReadiness } from "./domain/progress";
import { resultsDay, type PipelineStep, type StepState } from "./domain/results";
import { OfficeTop, toneAvatar, type HelpContent } from "./office-ui";
import { RemindSheet, type TeacherRowView } from "./remind";
import type { ActionResult } from "./save-types";
import { useAct } from "./use-act";

/** "1 child", "3 children" — never "1 children" (coordinators B6). */
const kidsEn = (n: number) => (n === 1 ? "1 child" : `${n} children`);

/** "30 marked of 32 · 2 absent": who a paper's spread is out of, and who is left out of it. */
function satLine(paper: { sat: number; onRoll?: number; absent?: number; exempt?: number }): Pair {
  const roll = paper.onRoll ?? paper.sat;
  const extra: [string, string][] = [];
  if (paper.absent) extra.push([`${paper.absent} absent`, `${paper.absent} अनुपस्थित`]);
  if (paper.exempt) extra.push([`${paper.exempt} excused`, `${paper.exempt} को छूट`]);
  const tail = (i: 0 | 1) => (extra.length ? ` · ${extra.map((e) => e[i]).join(" · ")}` : "");
  return p(`${paper.sat} of ${roll} children marked${tail(0)}`, `${roll} में से ${paper.sat} बच्चों के अंक${tail(1)}`);
}

/**
 * A class's readiness and whether it may be locked. The page always sends
 * both (computed by `classReadiness`, the lock action's own rule); a view
 * built without them falls back to "every paper sent".
 */
const readinessOf = (c: { readiness?: ClassReadiness; allSubmitted: boolean }): ClassReadiness => c.readiness ?? (c.allSubmitted ? "ready_for_review" : "missing");
const lockable = (c: { readyToLock?: boolean; allSubmitted: boolean }): boolean => c.readyToLock ?? c.allSubmitted;

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
  /** Where the class stands from its persisted marks and their validity (domain/progress.ts). */
  readiness?: ClassReadiness;
  /** Every paper sent, every child marked, no mark its paper cannot hold — what the lock action requires. */
  readyToLock?: boolean;
  /** Saved marks their paper cannot hold. */
  invalid?: number;
  /** Which papers hold them, and how many each: "Hindi" with 11 (smoke 20 Oct: "Needs correction" named no paper). */
  fix?: { subjectCode: string; count: number }[];
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
  /** `MARKS_FINALISERS` / `MARKS_REOPENERS` (D-262). */
  canFinalise: boolean;
  canReopen: boolean;
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
      /** Saved marks this paper cannot hold. */
      invalid?: number;
      decision: "fine" | "recheck" | null;
      sat: number;
      /** Children on the paper, and of them absent and excused, so "30 children" is never read as the class (smoke 20 Oct). */
      onRoll?: number;
      absent?: number;
      exempt?: number;
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
      /** SR no. or father's name, when another child in the class has the same name. */
      hint?: string | null;
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
      /** The sample's class, so "Open the full preview" opens on it. */
      classId?: string;
      classLabel: string;
      issued: boolean;
      rows: { subject: string; scored: number; outOf: number; grade: string | null; grace: number; /** By `absentLine()`: the exams missed, counted as 0 (D-319). */ absent?: string }[];
      total: number;
      outOf: number;
      percent: number | null;
      grade: string | null;
      passed: boolean | null;
      /** Subject codes below the pass mark after grace, or missed (`cardResult`). */
      shortIn?: string[];
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
  /**
   * "Results are out" on WhatsApp (D-615), read only for the Publish step.
   * Practice in a test year: the owner's number for the practice children.
   */
  notice?: {
    template: "approved" | "pending" | "rejected" | "marketing" | "missing";
    practice: boolean;
    ownerSet: boolean;
    /** The exam is released (now, or its set time has passed). */
    released: boolean;
    /** Locked classes, each with the practice children on its roll who have an issued card. */
    classes: { id: string; label: string; issued: number; children: number; kids: { name: string; told: boolean }[] }[];
    /** The message as a parent sees it, in each language, and its one button. */
    preview: { hi: string; en: string };
    button: { hi: string; en: string };
  } | null;
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
    tellParents?: Act<{ examId: string; classId: string }>;
    addRecheck: Act<{ paperId: string; studentId: string; askedBy: string; note: string }>;
    recheckWithTeacher: Act<{ recheckId: string }>;
    resolveRecheck: Act<{ recheckId: string; delta: number }>;
    remind: Act<{ examId: string; staffIds: string[] }>;
  };
};

type Run = ReturnType<typeof useAct>["run"];

/** "Mohit Agarwal" -> "Ag", "Mr. Meena" -> "Me": the design's mark, from the last name. */
function ini(name: string): string {
  const t = name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "").trim().split(/\s+/).pop() ?? "";
  return t.slice(0, 1).toUpperCase() + t.slice(1, 2).toLowerCase();
}
type ToneKey = "s3" | "info" | "warn" | "ok" | "bad" | "acc";

/** The design's tones: a soft background and its ink. */
function tn(t: ToneKey): { background: string; color: string } {
  if (t === "s3") return { background: "var(--s3)", color: "var(--mut)" };
  if (t === "warn") return { background: "var(--warns)", color: "var(--warnfg)" };
  if (t === "acc") return { background: "var(--accs)", color: "var(--accfg)" };
  return { background: `var(--${t}s)`, color: `var(--${t})` };
}

function Tag({ tone, children, style }: { tone: ToneKey; children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="pill" style={{ ...tn(tone), ...style }}>
      {children}
    </span>
  );
}

/** "10:00" → "10 am", "09:30" → "9:30 am". */
function ampm(t: string | null, full = false): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return t;
  return `${h % 12 === 0 ? 12 : h % 12}${m || full ? `:${String(m || 0).padStart(2, "0")}` : ""} ${h >= 12 ? "pm" : "am"}`;
}

/**
 * A stored UTC instant as the school's wall clock ("YYYY-MM-DDTHH:mm" in
 * India time). The schedule used to be read by slicing the UTC string, so a
 * 17:50 release showed "12:20 pm" and reopening the schedule shifted it back
 * by 5½ hours on the next save (day-run 6 Nov 2026, E27).
 */
function schoolClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

const STEP_ORDER: PipelineStep[] = ["entered", "checked", "grace", "locked", "cards", "published"];
const TAB_FOR: Record<PipelineStep, ResultsView> = { entered: "pipeline", checked: "moderation", grace: "grace", locked: "lock", cards: "cards", published: "publish" };
const RECHECK_WORDS: Record<ResultsProps["rechecks"][number]["status"], { label: Pair; tone: ToneKey }> = {
  new: { label: p("New", "नया"), tone: "warn" },
  with_teacher: { label: p("With teacher", "शिक्षक के पास"), tone: "info" },
  changed: { label: p("Changed", "बदला"), tone: "ok" },
  no_change: { label: p("No change", "कोई बदलाव नहीं"), tone: "s3" },
};
const STEP_CHIPS: { view: ResultsView; label: Pair; n: number | null }[] = [
  { view: "moderation", label: p("Check marks", "अंक जाँचें"), n: 2 },
  { view: "grace", label: p("Grace", "ग्रेस"), n: 3 },
  { view: "lock", label: p("Lock", "बंद करें"), n: 4 },
  { view: "cards", label: p("Report cards", "प्रगति पत्र"), n: 5 },
  { view: "publish", label: p("Publish", "जारी करें"), n: 6 },
  { view: "recheck", label: p("Re-checks", "दोबारा जाँच"), n: null },
];
const STICKY_BOTTOM = "var(--vx-bottom-h, calc(76px + env(safe-area-inset-bottom)))";

export function ResultsBoard(props: ResultsProps) {
  const { view, exam, actions } = props;
  const { tx } = useVx();
  const { pending, run } = useAct();
  const [remindOpen, setRemindOpen] = useState(false);
  const [lockConfirm, setLockConfirm] = useState(false);
  // Every step keeps the exam being looked at. Without it a step link or a
  // re-check row jumped back to the current exam (day-run 6 Nov 2026, E43).
  const href = (v: ResultsView, extra = "") => `/exam-office/results?view=${v}&exam=${encodeURIComponent(exam.id)}${extra}`;
  const openRecheck = view === "recheck" ? (props.rechecks.find((r) => r.id === props.recheckId) ?? null) : null;

  const titles: Record<ResultsView, Pair> = {
    pipeline: p("Results pipeline", "परिणाम की राह"),
    moderation: p("Check marks", "अंक जाँचें"),
    grace: p("Grace marks", "ग्रेस अंक"),
    lock: p("Lock marks", "अंक बंद करें"),
    cards: p("Report cards", "प्रगति पत्र"),
    publish: p("Publish results", "परिणाम जारी करें"),
    recheck: p("Re-check requests", "दोबारा जाँच के अनुरोध"),
  };
  const crumb = `${tx(p("Results", "परिणाम"))} · ${tx(exam.name)} ${exam.sessionLabel} · ${props.classes.length} ${tx(props.classes.length === 1 ? p("class", "कक्षा") : p("classes", "कक्षाएँ"))} · ${props.childrenTotal} ${tx(props.childrenTotal === 1 ? p("child", "बच्चा") : p("children", "बच्चे"))}`;
  const day = resultsDay(exam.daysToResults, exam.publishedAt);
  const lockedNow = props.classes.filter((c) => c.locked).length;
  const badge = exam.resultsLabel ? (
    day === "passed" ? (
      // Past results day with nothing sent: say so, and what to do (smoke 20 Oct).
      <Tag tone="bad">
        {tx(p(`Results day ${exam.resultsLabel} has passed · ${lockedNow} of ${props.classes.length} classes locked · set a new date`, `परिणाम दिवस ${exam.resultsLabel} बीत गया · ${props.classes.length} में से ${lockedNow} कक्षाएँ बंद · नई तारीख़ तय करें`))}
      </Tag>
    ) : (
      <Tag tone={day === "published" ? "ok" : "acc"}>
        {tx(p("Results day", "परिणाम दिवस"))} {exam.resultsLabel}
        {day === "today" ? ` · ${tx(p("today", "आज"))}` : day === "upcoming" ? ` · ${tx(p(`in ${exam.daysToResults} days`, `${exam.daysToResults} दिन में`))}` : ""}
      </Tag>
    )
  ) : null;
  /* The next step the office can act on; marks entry is the teachers' and has no tab here. */
  const nextStep = STEP_ORDER.find((s) => s !== "entered" && props.states[s] !== "done") ?? null;
  const locked = props.classes.filter((c) => c.locked).length;
  const passing = props.grace.rows.filter((g) => g.canPass).length;
  const openRechecks = props.rechecks.filter((r) => r.status === "new" || r.status === "with_teacher").length;
  const mSub: Record<ResultsView, string> = {
    pipeline: tx(p(`${props.overall.percent}% marks in${exam.resultsLabel ? ` · results ${exam.resultsLabel}` : ""}`, `${props.overall.percent}% अंक आए${exam.resultsLabel ? ` · परिणाम ${exam.resultsLabel}` : ""}`)),
    moderation: props.unusualOpen ? tx(p(`${props.unusualOpen} unusual ${props.unusualOpen === 1 ? "average" : "averages"}`, `${props.unusualOpen} असामान्य औसत`)) : tx(p("All averages look normal", "सब औसत सामान्य")),
    grace: tx(p(`${kidsEn(passing)} pass with grace`, `${passing} बच्चे ग्रेस से पास`)),
    lock: tx(p(`${locked} of ${props.classes.length} classes locked`, `${props.classes.length} में से ${locked} कक्षाएँ बंद`)),
    cards: tx(p(`${props.cards.issuedTotal} of ${props.childrenTotal} issued`, `${props.childrenTotal} में से ${props.cards.issuedTotal} जारी`)),
    publish: exam.publishedAt ? tx(p("Released", "जारी")) : exam.publishAt ? tx(p("Scheduled", "समय तय")) : tx(p("Not scheduled yet", "अभी समय तय नहीं")),
    recheck: openRecheck ? `${openRecheck.classLabel} · ${openRecheck.subjectCode}` : tx(p(`${openRechecks} open`, `${openRechecks} खुले`)),
  };
  const help: HelpContent = {
    title: tx(titles[view]),
    steps: [
      { icon: "list", title: tx(p("Six steps", "छह कदम")), body: tx(p("Entered, checked, grace, locked, report cards, published — in that order.", "भरे, जाँचे, ग्रेस, बंद, प्रगति पत्र, जारी — इसी क्रम में।")) },
      { icon: "alert", title: tx(p("Look at what moved", "जो बदला उसे देखें")), body: tx(p("A class average that moved a lot since the last exam is flagged.", "पिछली परीक्षा से बहुत बदला औसत दिखाया जाता है।")) },
      { icon: "lock", title: tx(p("Lock, then cards", "बंद करें, फिर कार्ड")), body: tx(p("Locked marks cannot change; cards are made from them.", "बंद अंक बदलते नहीं; कार्ड उन्हीं से बनते हैं।")) },
    ],
  };

  /* The lock screen's choice lives here so the phone bar can act on it. */
  const [lockPicked, setLockPicked] = useState<string[]>(() => props.classes.filter((c) => lockable(c) && !c.locked).map((c) => c.id));
  const lockChosen = props.classes.filter((c) => lockPicked.includes(c.id) && !c.locked);
  /* Publishing's choice, for the same reason. */
  const [when, setWhen] = useState<"now" | "scheduled">(exam.resultsOn ? "scheduled" : "now");
  const [at, setAt] = useState(exam.publishAt ? schoolClock(exam.publishAt) : exam.resultsOn ? `${exam.resultsOn}T09:00` : "");
  const [ptm, setPtm] = useState(exam.ptm);
  const publishNow = () => run(() => actions.publish({ examId: exam.id, when, at: when === "scheduled" ? new Date(`${at}:00+05:30`).toISOString() : null, ptm }));
  const atLabel = at ? new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(at)).replace(",", "") + ` · ${ampm(at.slice(11, 16), true)}` : "";

  let body: ReactNode;
  switch (view) {
    case "moderation":
      body = <Moderation {...props} pending={pending} run={run} />;
      break;
    case "grace":
      body = <Grace {...props} pending={pending} run={run} />;
      break;
    case "lock":
      body = <Lock {...props} pending={pending} run={run} picked={lockPicked} setPicked={setLockPicked} chosen={lockChosen} onLock={() => setLockConfirm(true)} />;
      break;
    case "cards":
      body = <Cards {...props} pending={pending} run={run} />;
      break;
    case "publish":
      body = <Publish {...props} pending={pending} run={run} when={when} setWhen={setWhen} at={at} setAt={setAt} atLabel={atLabel} ptm={ptm} setPtm={setPtm} onPublish={publishNow} />;
      break;
    case "recheck":
      body = null;
      break;
    default:
      body = <Pipeline {...props} href={href} onRemind={() => setRemindOpen(true)} />;
  }

  const phoneBar: ReactNode =
    view === "grace" && props.grace.open > 0 ? (
      <button type="button" className="tap btn pri xbig" disabled={pending} onClick={() => run(() => actions.giveGrace({ examId: exam.id }))}>
        {tx(p(`Give grace to ${kidsEn(props.grace.open)}`, `${props.grace.open} बच्चों को ग्रेस दें`))}
      </button>
    ) : view === "lock" && props.canFinalise && lockChosen.length ? (
      <button type="button" className="tap btn pri xbig" disabled={pending} onClick={() => setLockConfirm(true)}>
        {tx(p(`Lock ${lockChosen.length} ${lockChosen.length === 1 ? "class" : "classes"}`, `${lockChosen.length} कक्षाएँ बंद करें`))}
      </button>
    ) : view === "publish" && !exam.publishedAt ? (
      <button type="button" className="tap btn pri xbig" disabled={pending || (when === "scheduled" && !at) || (when === "now" && lockedNow === 0)} onClick={publishNow}>
        {when === "now" ? tx(p("Release results now", "परिणाम अभी जारी करें")) : tx(p(`Schedule for ${atLabel.replace(" · ", ", ")}`, `${atLabel.replace(" · ", ", ")} के लिए तय करें`))}
      </button>
    ) : null;

  return (
    <VxPage className="eor">
      <OfficeTop
        crumb={crumb}
        title={openRecheck ? openRecheck.name : tx(titles[view])}
        pill={badge}
        mTitle={openRecheck ? openRecheck.name : tx(titles[view])}
        mSub={mSub[view]}
        back={view === "pipeline" ? undefined : openRecheck ? href("recheck") : href("pipeline")}
        mBack={view === "pipeline" ? "/exam-office" : undefined}
        help={help}
        actions={
          view === "pipeline" && nextStep ? (
            <Link href={href(TAB_FOR[nextStep])} className="tap btn pri">
              <Ic n="arrowRight" size={18} />
              {tx(p("Next:", "अगला:"))} {tx(titles[TAB_FOR[nextStep]])}
            </Link>
          ) : null
        }
      />
      <main className="xmain" style={{ position: "relative" }}>
        {view !== "pipeline" ? (
          <div className={`pad${openRecheck ? " hide-m" : ""}`} style={{ padding: "14px 28px 0" }}>
            <div className="hs xr x6">
              {STEP_CHIPS.map((c, i) => {
                const on = view === c.view;
                const step = STEP_ORDER[i + 1];
                const done = c.n !== null && step && props.states[step] === "done";
                const n = c.n === null ? props.rechecks.filter((r) => r.status === "new").length : c.n;
                return (
                  <Link key={c.view} href={href(c.view)} className={`tap chip${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                    <span className="xi num x11" style={{ width: 20, height: 20, borderRadius: 10, background: on ? "var(--card)" : done ? "var(--ok)" : "var(--s3)", color: on ? "var(--fg)" : done ? "var(--onsolid, #fff)" : "var(--mut)" }}>
                      {done ? <Ic n="check" size={12} /> : n}
                    </span>
                    {tx(c.label)}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
        {view === "recheck" ? <Rechecks {...props} pending={pending} run={run} open={openRecheck} href={href} /> : <div className="pad xsc">{body}</div>}
        {phoneBar ? (
          <div className="only-m glass xmbar" style={{ bottom: STICKY_BOTTOM }}>
            {phoneBar}
          </div>
        ) : null}
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
      <Confirm
        open={lockConfirm}
        onClose={() => setLockConfirm(false)}
        busy={pending}
        title={tx(p(`Lock ${lockChosen.length} ${lockChosen.length === 1 ? "class" : "classes"}?`, `${lockChosen.length} कक्षाएँ बंद करें?`))}
        body={lockChosen.map((c) => c.label).join(", ")}
        confirmLabel={tx(p("Lock", "बंद करें"))}
        onConfirm={() => run(() => actions.lock({ examId: exam.id, classIds: lockChosen.map((c) => c.id) }), () => setLockConfirm(false))}
      />
    </VxPage>
  );
}

/* --------------------------------------------------------- pipeline */

function Pipeline(props: ResultsProps & { href: (v: ResultsView, extra?: string) => string; onRemind: () => void }) {
  const { tx } = useVx();
  const { exam, classes, overall, teachers, states } = props;
  const locked = classes.filter((c) => c.locked).length;
  const ready = classes.filter((c) => !c.locked && lockable(c)).length;
  const late = teachers.filter((t) => t.late);
  const canPass = props.grace.rows.filter((g) => g.canPass).length;
  // "All fine" only when every class has been compared — not while 18 of 19
  // still wait for their marks (coordinators B6).
  const checkedClasses = classes.filter((c) => readinessOf(c) === "ready_for_review" && !c.unusualOpen).length;
  const allChecked = classes.length > 0 && checkedClasses >= classes.length;
  const firstOpen = STEP_ORDER.findIndex((s) => states[s] !== "done");
  const dayState = resultsDay(exam.daysToResults, exam.publishedAt);
  const cards: Record<PipelineStep, { title: Pair; big: string; sub: string; btn: Pair; href: string; value: number }> = {
    entered: { title: p("Marks entered", "अंक भरे"), big: `${overall.percent}%`, sub: tx(p(`${overall.entered.toLocaleString("en-IN")} of ${overall.total.toLocaleString("en-IN")} marks · ${late.length} teachers late`, `${overall.total} में से ${overall.entered} · ${late.length} शिक्षक देर से`)), btn: p("Marks tracker", "अंक ट्रैकर"), href: "/exams?view=grid", value: overall.percent },
    checked: { title: p("Checked", "जाँचे"), big: props.unusualOpen ? tx(p(`${props.unusualOpen} unusual`, `${props.unusualOpen} असामान्य`)) : allChecked ? tx(p("All fine", "सब ठीक")) : tx(p(`${checkedClasses} of ${classes.length}`, `${classes.length} में से ${checkedClasses}`)), sub: props.unusualOpen ? tx(p(`Class averages that moved a lot${exam.prevName ? ` since ${exam.prevName.en}` : ""}`, "जिन कक्षाओं का औसत बहुत बदला")) : allChecked ? tx(p("Complete classes compared with the last exam", "पूरी कक्षाएँ पिछली परीक्षा से मिलाईं")) : tx(p("Classes checked · the rest wait for all their marks", "कक्षाएँ जाँचीं · बाकी सभी अंकों की प्रतीक्षा में")), btn: p("Check marks", "अंक जाँचें"), href: props.href("moderation"), value: props.unusualCount ? ((props.unusualCount - props.unusualOpen) / props.unusualCount) * 100 : states.checked === "done" ? 100 : 0 },
    grace: { title: p("Grace", "ग्रेस"), big: tx(p(`${canPass} ${canPass === 1 ? "child" : "children"}`, `${canPass} बच्चे`)), sub: states.grace === "done" ? tx(p("Passed with grace marks", "ग्रेस अंकों से पास")) : tx(p(`Can pass with up to ${props.grace.max} grace marks`, `${props.grace.max} तक ग्रेस से पास हो सकते`)), btn: p("Review grace", "ग्रेस देखें"), href: props.href("grace"), value: canPass ? (props.grace.rows.filter((g) => g.given).length / canPass) * 100 : 0 },
    locked: { title: p("Locked", "बंद"), big: tx(p(`${locked} of ${classes.length}`, `${classes.length} में से ${locked}`)), sub: locked ? tx(p("Classes locked · marks can’t change", "कक्षाएँ बंद · अंक नहीं बदलेंगे")) : tx(p(`${ready} ${ready === 1 ? "class" : "classes"} ready to lock`, `${ready} कक्षाएँ बंद करने को तैयार`)), btn: p("Lock marks", "अंक बंद करें"), href: props.href("lock"), value: classes.length ? (locked / classes.length) * 100 : 0 },
    cards: { title: p("Report cards", "प्रगति पत्र"), big: tx(p(`${props.cards.issuedTotal} of ${props.childrenTotal}`, `${props.childrenTotal} में से ${props.cards.issuedTotal}`)), sub: tx(p("Issued once a class is locked", "कक्षा बंद होने पर जारी")), btn: p("Report cards", "प्रगति पत्र"), href: props.href("cards"), value: props.childrenTotal ? (props.cards.issuedTotal / props.childrenTotal) * 100 : 0 },
    published: { title: p("Published", "जारी"), big: exam.publishedAt ? tx(p("Sent", "भेजा")) : (exam.resultsLabel ?? "—"), sub: dayState === "passed" ? tx(p("Results day has passed and nothing was sent · set a new date", "परिणाम दिवस बीत गया, कुछ नहीं भेजा · नई तारीख़ तय करें")) : exam.ptmAt ? tx(p(`Results day · PTM at ${ampm(exam.ptmAt)}`, `परिणाम दिवस · PTM ${ampm(exam.ptmAt)}`)) : tx(p("Results day", "परिणाम दिवस")), btn: p("Schedule", "समय तय करें"), href: props.href("publish"), value: exam.publishedAt ? 100 : 0 },
  };
  const dates = [
    exam.marksDue ? { k: p("MARKS DUE", "अंक अंतिम तिथि"), v: exam.marksDue, s: exam.daysToDue === null ? "" : exam.daysToDue >= 0 ? tx(p(`in ${exam.daysToDue} days`, `${exam.daysToDue} दिन में`)) : tx(p("passed", "बीत गई")), tone: "warn" as const } : null,
    exam.resultsLabel
      ? dayState === "passed"
        ? { k: p("RESULTS DAY", "परिणाम दिवस"), v: exam.resultsLabel, s: tx(p("passed · not sent", "बीत गया · नहीं भेजा")), tone: "bad" as const }
        : { k: p("RESULTS DAY", "परिणाम दिवस"), v: exam.resultsLabel, s: `${exam.publishAt ? ampm(schoolClock(exam.publishAt).slice(11, 16)) : "9 am"}${exam.ptmAt ? ` · PTM ${ampm(exam.ptmAt)}` : ""}`, tone: "acc" as const }
      : null,
  ].filter((d) => d !== null);
  const rq = [
    { n: props.rechecks.filter((r) => r.status === "new").length, label: p("new", "नए"), tone: "warn" as const },
    { n: props.rechecks.filter((r) => r.status === "with_teacher").length, label: p("with teachers", "शिक्षकों के पास"), tone: "info" as const },
    { n: props.rechecks.filter((r) => r.status === "changed" || r.status === "no_change").length, label: p("done", "पूरे"), tone: "ok" as const },
  ];
  return (
    <>
      <div className="card xr xw x14 xp2">
        <span className="xc xf" style={{ minWidth: 230 }}>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>{tx(p(`${exam.name.en} results`, `${exam.name.hi ?? exam.name.en} परिणाम`))}</span>
          <span className="xm">
            {tx(p("Exams", "परीक्षा"))} {exam.dates} · {tx(p("six steps from marks to parents", "अंकों से अभिभावकों तक छह कदम"))}
          </span>
        </span>
        {dates.map((d) => (
          <span key={d.k.en} className="xc" style={{ padding: "8px 14px", borderRadius: 14, background: tn(d.tone).background, minWidth: 136 }}>
            <span className="x11 xb" style={{ color: tn(d.tone).color }}>{tx(d.k)}</span>
            <b className="num">{d.v}</b>
            <span className="xm">{d.s}</span>
          </span>
        ))}
      </div>
      <div className="xstp">
        {STEP_ORDER.map((s, i) => {
          const c = cards[s];
          const st = states[s];
          const done = st === "done";
          const now = i === firstOpen;
          const can = !done && !now && st !== "waiting";
          // Results day gone by with nothing sent is overdue, not "waiting" (smoke 20 Oct).
          const overdue = s === "published" && !done && dayState === "passed";
          const stLabel = overdue ? p("Overdue", "देर हो गई") : done ? p("Done", "पूरा") : now ? (i === 0 ? p("In progress", "जारी") : p("Next", "अगला")) : can ? p("Can start", "शुरू कर सकते") : p("Waiting", "रुका");
          const stTone: ToneKey = overdue ? "bad" : done ? "ok" : now ? "acc" : can ? "info" : "s3";
          return (
            <div key={s} className="card xc x8 xp" style={{ animation: "xIn .3s var(--ease) both", animationDelay: `${i * 50}ms`, borderColor: now ? "var(--acc)" : "var(--bd)", boxShadow: now ? "var(--shh)" : "var(--sh)" }}>
              <span className="xr xj x6">
                <span className="xi num xb xs" style={{ width: 28, height: 28, borderRadius: 14, background: done ? "var(--ok)" : now ? "var(--pri)" : "var(--s3)", color: done || now ? "var(--prifg)" : "var(--mut)" }}>
                  {done ? <Ic n="check" size={14} /> : i + 1}
                </span>
                <Tag tone={stTone} style={stTone === "s3" ? { background: "var(--s2)" } : undefined}>
                  {tx(stLabel)}
                </Tag>
              </span>
              <b className="xt">{tx(c.title)}</b>
              <span className="num xb" style={{ fontSize: 22, lineHeight: 1.1, color: done ? "var(--ok)" : "var(--fg)" }}>{c.big}</span>
              <span className="xm" style={{ minHeight: 34 }}>{c.sub}</span>
              <span className="xbar" style={{ height: 6 }}>
                <span style={{ width: `${Math.round(c.value)}%`, background: done ? "var(--ok)" : "var(--acc)" }} />
              </span>
              <Link href={c.href} className={`tap btn ${i > 0 && now ? "pri" : "sec"}`} style={{ marginTop: 4 }}>
                {i === 0 ? (
                  <span className="only-d" style={{ display: "contents" }}>
                    <Ic n="clipboard" size={18} />
                  </span>
                ) : null}
                {tx(c.btn)}
                {i > 0 ? <Ic n="chevRight" size={18} /> : null}
              </Link>
            </div>
          );
        })}
      </div>
      <div className="stack xgd" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", gap: 14, alignItems: "start" }}>
        <div className="card xoh">
          <div className="xrr hide-m" style={{ background: "var(--s2)", minHeight: 42 }}>
            {[p("Class", "कक्षा"), p("Marks entered", "अंक भरे"), p("Late", "देर"), p("Checked", "जाँचे"), p("Grace", "ग्रेस"), p("Locked", "बंद"), p("Card", "कार्ड")].map((h) => (
              <span key={h.en} className="sech">
                {tx(h)}
              </span>
            ))}
          </div>
          <div className="xst">
            {classes.map((c) => {
              const final = c.children > 0 && c.issued >= c.children;
              return (
                <div key={c.id} className="xrr xd" style={{ background: c.locked && final ? "var(--oks)" : "transparent" }}>
                  <span className="xr x8 xn0">
                    <span className="xc xn0">
                      <b className="xe">{c.label}</b>
                      <span className="xm xe">
                        {c.teacher ?? "—"} · {c.children}
                      </span>
                    </span>
                  </span>
                  <span className="xr x8">
                    <span className="xbar xf" style={{ height: 7 }}>
                      <span style={{ width: `${c.percent}%`, background: c.percent === 100 ? "var(--ok)" : "var(--acc)" }} />
                    </span>
                    <b className="num xs" style={{ minWidth: 38, textAlign: "right" }}>{c.percent}%</b>
                  </span>
                  <span>{c.late ? <Tag tone="bad">{tx(p(`${c.late} late`, `${c.late} देर`))}</Tag> : <Tag tone="s3">{tx(p("On time", "समय पर"))}</Tag>}</span>
                  <span>
                    {readinessOf(c) === "needs_correction" ? (
                      <Tag tone="bad">
                        {tx(READINESS_LABEL.needs_correction)}
                        {c.fix?.length ? ` · ${c.fix.map((f) => `${tx(subjectPair(f.subjectCode))} ${f.count}`).join(", ")}` : ""}
                      </Tag>
                    ) : c.unusualOpen ? (
                      <Tag tone="warn">{tx(p(`${c.unusualOpen} to look at`, `${c.unusualOpen} देखने हैं`))}</Tag>
                    ) : readinessOf(c) === "ready_for_review" ? (
                      <Tag tone="ok">{tx(p("Checked", "जाँचा"))}</Tag>
                    ) : (
                      <Tag tone="s3">{tx(READINESS_LABEL[readinessOf(c)])}</Tag>
                    )}
                  </span>
                  <span>{c.graceNeeded ? <Tag tone="info">{tx(p(`${c.graceNeeded} need grace`, `${c.graceNeeded} को ग्रेस`))}</Tag> : <Tag tone="s3">{tx(p("No grace", "ग्रेस नहीं"))}</Tag>}</span>
                  <span>{c.locked ? <Tag tone="ok">{tx(p("Locked", "बंद"))}</Tag> : lockable(c) ? <Tag tone="info">{tx(p("Ready to lock", "बंद को तैयार"))}</Tag> : <Tag tone="s3">{tx(p("Not locked", "खुला"))}</Tag>}</span>
                  <span>{final ? <Tag tone="ok">{tx(p("Card final", "कार्ड पक्का"))}</Tag> : c.issued ? <Tag tone="warn">{`${c.issued}/${c.children}`}</Tag> : <Tag tone="s3">{tx(p("No card yet", "कार्ड नहीं"))}</Tag>}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="xc x14 xfirst">
          <div className="card xc xp">
            <div className="xr xj x8">
              <span className="xt">{late.length ? tx(p(`${late.length} ${late.length === 1 ? "teacher is" : "teachers are"} late`, `${late.length} शिक्षक देर से`)) : tx(p("Everyone is on time", "सब समय पर"))}</span>
              {exam.marksDue ? (
                <Tag tone="bad">
                  {tx(p("Due", "अंतिम"))} {exam.marksDue}
                </Tag>
              ) : null}
            </div>
            <div className="xst">
              {late.map((t) => {
                const av = { ...toneAvatar(t.name), name: t.name };
                const left = t.papers.filter((x) => x.status !== "done" && x.status !== "empty");
                return (
                  <div key={t.id} className="xr x10 xd" style={{ padding: "8px 0" }}>
                    <span className="xa" style={{ background: av.bg, color: av.fg }}>
                      {ini(av.name)}
                    </span>
                    <span className="xc xf">
                      <span className="x6w xe">{t.name}</span>
                      <span className="xm xe">
                        {left.map((x) => `${x.classLabel} ${x.subjectCode}`).join(", ")} · {t.entered ? tx(p(`${t.entered} of ${t.total}`, `${t.total} में से ${t.entered}`)) : tx(p("not started", "शुरू नहीं"))}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {late.length ? (
              <button type="button" className="tap btn pri" onClick={props.onRemind} style={{ marginTop: 8 }}>
                <Ic n="send" size={18} />
                {tx(p(`Remind all ${late.length} on WhatsApp`, `सभी ${late.length} को WhatsApp पर याद दिलाएँ`))}
              </button>
            ) : null}
            <Link href="/exams?view=grid" className="tap btn ghost" style={{ marginTop: 4 }}>
              {tx(p("Open the marks tracker", "अंक ट्रैकर खोलें"))}
            </Link>
          </div>
          <Link href={props.href("recheck")} className="tap card xc x8 xp lift" style={{ textAlign: "left", color: "var(--fg)", textDecoration: "none" }}>
            <span className="xr xj">
              <span className="xt">{tx(p("Re-check requests", "दोबारा जाँच के अनुरोध"))}</span>
              <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
            </span>
            <span className="xr xw x6">
              {rq.map((q) => (
                <Tag key={q.label.en} tone={q.tone} style={{ height: 26, padding: "0 10px", fontSize: 12 }}>
                  {q.n} {tx(q.label)}
                </Tag>
              ))}
            </span>
            <span className="xm">{tx(p("From parents after children saw their checked copies.", "बच्चों के जाँची कॉपी देखने के बाद अभिभावकों से।"))}</span>
          </Link>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------- moderation */

function Moderation(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const router = useRouter();
  const { moderation, actions, run, pending, exam } = props;
  const [picked, setPicked] = useState<string | null>(moderation.papers.find((x) => x.unusual && !x.decision)?.paperId ?? moderation.papers.find((x) => x.unusual)?.paperId ?? moderation.papers[0]?.paperId ?? null);
  const paper = moderation.papers.find((x) => x.paperId === picked) ?? null;
  const klass = props.classes.find((c) => c.id === moderation.classId);
  if (moderation.completeClasses.length === 0 && moderation.papers.length === 0) {
    return <EmptyState icon="clipboard" title={tx(p("No class has all its marks in yet", "अभी किसी कक्षा के सब अंक नहीं आए"))} body={tx(p("A class shows up here once every paper is submitted.", "हर पेपर जमा होने पर कक्षा यहाँ दिखती है।"))} />;
  }
  const prevName = exam.prevName ? tx(exam.prevName) : tx(p("Last exam", "पिछली परीक्षा"));
  const askText = paper
    ? `नमस्ते ${paper.teacherName ?? ""} जी, ${klass?.label ?? ""} ${paper.subjectCode} (${exam.name.hi ?? exam.name.en}) का औसत ${paper.avgPct ?? "—"}% है${paper.baseline !== null ? `, पहले ${paper.baseline}% था` : ""}। कृपया कॉपियाँ एक बार फिर जाँच लें।\n\nThe ${klass?.label ?? ""} ${paper.subjectCode} average is ${paper.avgPct ?? "—"}%${paper.baseline !== null ? ` (was ${paper.baseline}%)` : ""}. Please re-check the copies once.\n— ${props.fromName}`
    : "";
  const passPct = paper && paper.passMarks !== null ? Math.round((paper.passMarks / paper.maxMarks) * 100) : 33;
  const binMax = paper ? Math.max(1, ...paper.spread) : 1;
  const change = paper && paper.avgPct !== null && paper.prevPct !== null ? Math.round(paper.avgPct - paper.prevPct) : null;
  return (
    <>
      <div className="xr xw x8">
        <div className="hs xr x6 xf">
          {moderation.completeClasses.map((c) => (
            <button key={c.id} type="button" className={`tap chip${c.id === moderation.classId ? " on" : ""}`} aria-pressed={c.id === moderation.classId} onClick={() => router.push(`/exam-office/results?view=moderation&class=${c.id}`)}>
              <span className="xdt" style={{ background: c.unusual ? "var(--warn)" : "var(--ok)" }} />
              {c.label}
            </button>
          ))}
        </div>
        {moderation.still ? <span className="xm">{tx(p(`${moderation.still} classes still entering marks · they show up here when complete`, `${moderation.still} कक्षाओं के अंक आ रहे हैं · पूरे होने पर यहाँ दिखेंगी`))}</span> : null}
      </div>
      {moderation.flagged.map((f) => (
        <Link key={f.paperId} href={`/exam-office/results?view=moderation&class=${f.classId}`} className="tap xno xl" style={{ background: "var(--warns)", color: "var(--warnfg)", animation: "xIn .3s var(--ease) both", textDecoration: "none" }}>
          <Ic n={f.delta < 0 ? "alert" : "trend"} size={18} />
          <span className="xc xf">
            <b>{tx(p(`${f.classLabel} ${f.subjectCode} average ${f.delta < 0 ? "dropped" : "rose"} ${Math.abs(f.delta)}%`, `${f.classLabel} ${f.subjectCode} का औसत ${Math.abs(f.delta)}% ${f.delta < 0 ? "गिरा" : "बढ़ा"}`))}</b>
            <span className="xs">
              {f.basis === "previous" ? prevName : tx(p("School average", "स्कूल औसत"))} {f.baseline}% → {tx(p("now", "अब"))} {f.avgPct}%{f.teacherName ? ` · ${f.teacherName}` : ""}
            </span>
          </span>
          <Ic n="chevRight" size={18} />
        </Link>
      ))}
      <div className="stack xgd" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
        <div className="card xoh">
          <div className="xmod" style={{ background: "var(--s2)", minHeight: 42 }}>
            <span className="sech">{tx(p("Subject", "विषय"))}</span>
            <span className="sech xtr">{prevName}</span>
            <span className="sech xtr">{tx(p("Now", "अब"))}</span>
            <span className="sech xtr">{tx(p("Change", "बदलाव"))}</span>
            <span className="sech">{tx(p("Last → now", "पहले → अब"))}</span>
          </div>
          <div className="xst">
            {moderation.papers.map((x) => {
              const d = x.avgPct !== null && x.prevPct !== null ? Math.round(x.avgPct - x.prevPct) : null;
              const tone: ToneKey = x.unusual ? (x.decision ? "ok" : "warn") : "s3";
              const c = x.unusual ? (d !== null && d < 0 ? "var(--bad)" : "var(--warn)") : "var(--c2)";
              const last = x.prevPct ?? x.avgPct ?? 0;
              const now = x.avgPct ?? 0;
              return (
                <button key={x.paperId} type="button" className={`tap row xmod xd${x.paperId === picked ? " sel" : ""}`} aria-pressed={x.paperId === picked} onClick={() => setPicked(x.paperId)} style={x.paperId === picked ? { background: "var(--accs)" } : undefined}>
                  <span className="xc xn0">
                    <b className="xe">{x.subjectCode}</b>
                    <span className="xm xe">
                      {x.teacherName ?? "—"}
                      {x.decision === "recheck" ? tx(p(" · re-check asked", " · दोबारा जाँच कही")) : x.decision === "fine" ? tx(p(" · marked fine", " · ठीक माना")) : ""}
                    </span>
                  </span>
                  <span className="num xmu xtr">{x.prevPct === null ? "—" : `${x.prevPct}%`}</span>
                  <b className="num xtr">{x.avgPct === null ? "—" : `${x.avgPct}%`}</b>
                  <span className="xtr">{d === null ? "—" : <Tag tone={tone}>{`${d > 0 ? "+" : ""}${d}%`}</Tag>}</span>
                  <span className="xrl" style={{ height: 16 }}>
                    <span style={{ position: "absolute", top: 7, left: 0, right: 0, height: 2, background: "var(--s3)" }} />
                    {x.prevPct !== null ? (
                      <>
                        <span style={{ position: "absolute", top: 6, height: 4, borderRadius: 2, left: `${Math.min(last, now)}%`, width: `${Math.abs(now - last)}%`, background: c }} />
                        <span className="xdb" style={{ left: `${last}%`, background: "var(--bds)" }} />
                      </>
                    ) : null}
                    {x.avgPct !== null ? <span className="xdb" style={{ left: `${now}%`, background: c }} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {paper ? (
          <div className="card xc x12 xp2">
            <div className="xr xj x8">
              <span className="xc">
                <span className="xt">
                  {klass?.label} · {paper.subjectCode}
                </span>
                <span className="xm">
                  {paper.teacherName ?? "—"} · {tx(p(`out of ${paper.maxMarks} · `, `पूर्णांक ${paper.maxMarks} · `))}
                  {tx(satLine(paper))}
                </span>
              </span>
              {paper.invalid ? (
                // "Normal" is only about the average; a mark the paper cannot hold comes first (B04).
                <Tag tone="bad">{tx(p(`Needs correction · ${paper.invalid}`, `सुधार चाहिए · ${paper.invalid}`))}</Tag>
              ) : (
                <Tag tone={paper.unusual && !paper.decision ? "warn" : "ok"}>{paper.unusual ? (paper.decision === "recheck" ? tx(p("Re-check asked", "दोबारा जाँच कही")) : paper.decision === "fine" ? tx(p("Marked fine", "ठीक माना")) : tx(p("Unusual", "असामान्य"))) : tx(p("Average normal", "औसत सामान्य"))}</Tag>
              )}
            </div>
            <span className="sech">{tx(p("How the marks are spread", "अंक कैसे फैले हैं"))}</span>
            <div className="xr xrl" style={{ height: 130, alignItems: "flex-end", gap: 5, borderBottom: "1px solid var(--bd)" }}>
              <span style={{ position: "absolute", top: 0, bottom: 0, left: `${passPct}%`, borderLeft: "1.5px dashed var(--bad)", opacity: 0.6 }} />
              {paper.spread.map((n, i) => (
                <span key={i} className="xf" style={{ height: `${Math.max(2, Math.round((n / binMax) * 100))}%`, borderRadius: "6px 6px 2px 2px", background: (i + 1) * 10 <= passPct ? "var(--c3)" : "var(--c2)", transformOrigin: "bottom", animation: "xGrowY .6s var(--ease) both", animationDelay: `${i * 35}ms` }} />
              ))}
            </div>
            <div className="xr xj xm num">
              <span>0%</span>
              <span style={{ color: "var(--bad)" }}>{tx(p(`${passPct}% pass`, `${passPct}% पास`))}</span>
              <span>50%</span>
              <span>100%</span>
            </div>
            <div className="xc">
              {[
                { k: p("Average now", "अब का औसत"), v: `${paper.avgPct ?? "—"}%${paper.prevPct !== null ? tx(p(` · ${exam.prevName?.en ?? "Last exam"} was ${paper.prevPct}%`, ` · ${exam.prevName?.hi ?? exam.prevName?.en ?? "पिछली"} में ${paper.prevPct}%`)) : ""}`, c: change !== null && Math.abs(change) >= 15 ? "var(--warnfg)" : "var(--fg)" },
                { k: p(`Below ${passPct}%`, `${passPct}% से कम`), v: tx(p(`${kidsEn(paper.below)}`, `${paper.below} बच्चे`)), c: paper.below ? "var(--bad)" : "var(--ok)" },
                { k: p("Highest", "सबसे ज़्यादा"), v: paper.highest === null ? "—" : tx(p(`${paper.highest} of ${paper.maxMarks}`, `${paper.maxMarks} में ${paper.highest}`)), c: "var(--fg)" },
              ].map((f) => (
                <div key={f.k.en} className="xfa xd">
                  <span className="xmu">{tx(f.k)}</span>
                  <b className="num" style={{ color: f.c }}>{f.v}</b>
                </div>
              ))}
            </div>
            {paper.decision ? (
              <div className="xno fadein" style={{ ...tn(paper.decision === "fine" ? "ok" : "info") }}>
                <Ic n="checkCircle" size={18} />
                <span>{paper.decision === "fine" ? tx(p("Marked fine · no re-check.", "ठीक माना · दोबारा जाँच नहीं।")) : tx(p(`Re-check asked from ${paper.teacherName ?? "the teacher"}.`, `${paper.teacherName ?? "शिक्षक"} से दोबारा जाँच कही।`))}</span>
              </div>
            ) : (
              <div className="xc x8">
                <button
                  type="button"
                  className="tap btn pri xbig"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => actions.moderate({ paperId: paper.paperId, decision: "recheck", note: null }),
                      () => window.open(waLink(paper.teacherPhone, askText), "_blank", "noopener"),
                    )
                  }
                >
                  <Ic n="send" size={18} />
                  {tx(p(`Ask ${paper.teacherName ?? "the teacher"} to re-check`, `${paper.teacherName ?? "शिक्षक"} से दोबारा जाँच कहें`))}
                </button>
                <button type="button" className="tap btn ghost" disabled={pending} onClick={() => run(() => actions.moderate({ paperId: paper.paperId, decision: "fine", note: null }))}>
                  {tx(p("Looks fine — no re-check", "ठीक है — दोबारा जाँच नहीं"))}
                </button>
              </div>
            )}
          </div>
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
  const fits = (g: ResultsProps["grace"]["rows"][number]) => g.needs.length <= Number(subjects) && g.needs.every((n) => n.grace <= max);
  const passing = grace.rows.filter(fits).sort((a, b) => a.total - b.total);
  const short = grace.rows.filter((g) => !fits(g));
  const given = grace.rows.filter((g) => g.given).length;
  return (
    <div className="stack xgd" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.25fr)", gap: 14, alignItems: "start" }}>
      <div className="card xc x14 xp2">
        <span className="xr x10">
          <span className="xi" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)" }}>
            <Ic n="shield" size={20} />
          </span>
          <span className="xc">
            <b className="xt">{tx(p("The school rule", "स्कूल का नियम"))}</b>
            <span className="xm">{tx(p("For this exam · the card shows grace as G", "इस परीक्षा के लिए · कार्ड पर ग्रेस G दिखता है"))}</span>
          </span>
        </span>
        <div className="xno" style={{ background: "var(--s2)", fontSize: 15, color: "var(--fg)" }}>
          {tx(
            p(
              `A child who is short of the pass mark by up to ${max} marks in ${subjects === "1" ? "one subject" : "up to two subjects"} gets those marks and passes.`,
              `जो बच्चा ${subjects === "1" ? "एक विषय" : "दो विषयों तक"} में पास अंक से ${max} अंक तक कम है, उसे वे अंक मिलते हैं और वह पास होता है।`,
            ),
          )}
        </div>
        <div className="field">
          <span>{tx(p("Most grace marks", "सबसे ज़्यादा ग्रेस"))}</span>
          <div className="xr x8">
            <button type="button" className="tap btn sec" aria-label={tx(p("Fewer grace marks", "कम ग्रेस अंक"))} disabled={max <= 0} onClick={() => setMax(Math.max(0, max - 1))} style={{ width: 44, padding: 0 }}>
              <Ic n="minus" size={18} />
            </button>
            <span className="num xb xtc" style={{ minWidth: 48, fontSize: 20 }}>{max}</span>
            <button type="button" className="tap btn sec" aria-label={tx(p("More grace marks", "ज़्यादा ग्रेस अंक"))} disabled={max >= 10} onClick={() => setMax(Math.min(10, max + 1))} style={{ width: 44, padding: 0 }}>
              <Ic n="plus" size={18} />
            </button>
            <span className="xm">{tx(p("marks per subject", "अंक प्रति विषय"))}</span>
          </div>
        </div>
        <div className="field">
          <span>{tx(p("In how many subjects", "कितने विषयों में"))}</span>
          <Seg
            value={subjects}
            onChange={setSubjects}
            label={tx(p("Subjects", "विषय"))}
            options={[
              { value: "1", label: tx(p("One subject", "एक विषय")) },
              { value: "2", label: tx(p("Up to two", "दो तक")) },
            ]}
          />
        </div>
        <span className="xm" style={{ lineHeight: 1.5 }}>{tx(p("Grace shows as “G” on the report card. It only lifts a child to the pass mark, never higher.", "ग्रेस प्रगति पत्र पर “G” दिखता है। यह बच्चे को सिर्फ़ पास अंक तक लाता है, उससे ऊपर नहीं।"))}</span>
        {changed ? (
          <button type="button" className="tap btn sec xbig" disabled={pending} onClick={() => run(() => actions.saveGraceRule({ examId: exam.id, max, subjects: Number(subjects) }))}>
            <Ic n="check" size={18} />
            {tx(p("Save the rule", "नियम सहेजें"))}
          </button>
        ) : grace.open ? (
          <button type="button" className="tap btn pri xbig hide-m" disabled={pending} onClick={() => run(() => actions.giveGrace({ examId: exam.id }))}>
            <Ic n="check" size={18} />
            {tx(p(`Give grace to ${kidsEn(grace.open)}`, `${grace.open} बच्चों को ग्रेस दें`))}
          </button>
        ) : given ? (
          <div className="xr x12 fadein" style={{ padding: "10px 12px", borderRadius: 14, background: "var(--oks)", color: "var(--ok)" }}>
            <svg className="xtk" width="44" height="44" viewBox="0 0 96 96" aria-hidden="true">
              <circle className="a" cx="48" cy="48" r="44" />
              <circle className="b" cx="48" cy="48" r="44" />
              <path d="M30 49l12 12 24-26" />
            </svg>
            <span className="xc xf">
              <b>{tx(p(`Grace given to ${kidsEn(given)}`, `${given} बच्चों को ग्रेस दिया`))}</b>
              <span className="xs">{tx(p("Kept beside each mark, not added into it", "हर अंक के साथ रखा, उसमें जोड़ा नहीं"))}</span>
            </span>
          </div>
        ) : null}
      </div>
      <div className="card xc x10 xp2">
        <div className="xr x12">
          <span className="num xb" style={{ fontSize: 42, lineHeight: 1, color: "var(--ok)" }}>{passing.length}</span>
          <span className="xc">
            <b className="xt">{tx(p(`${kidsEn(passing.length)} pass with grace`, `${passing.length} बच्चे ग्रेस से पास`))}</b>
            <span className="xm">{tx(p(`${short.length} more are still short · they need remedial classes`, `${short.length} अब भी कम · इन्हें अतिरिक्त कक्षा चाहिए`))}</span>
          </span>
        </div>
        <div className="xst">
          {[...passing, ...short].map((g) => {
            const ok = fits(g);
            const canTakeBack = ok && g.given && !g.locked;
            const pill = ok ? `${g.given ? "G " : ""}+${g.total}` : tx(p(`short ${g.total}`, `${g.total} कम`));
            const pillStyle: CSSProperties = { ...tn(ok ? "ok" : "s3"), ...(ok ? {} : { background: "var(--s2)" }), minWidth: 64, justifyContent: "center" };
            return (
              <div key={g.studentId} className="xr x10 xd" style={{ padding: "9px 0", opacity: ok ? 1 : 0.55, transition: "opacity .3s ease" }}>
                <span className="xc xf">
                  <span className="x6w xe">
                    {g.name}
                    {g.hint ? <span className="xm"> · {g.hint}</span> : null}
                  </span>
                  <span className="xm xe">
                    {g.classLabel} · {g.needs.map((n) => tx(subjectPair(n.subjectCode))).join(", ")}
                  </span>
                </span>
                <span className="num xs xtr">
                  {g.needs.map((n) => (ok ? `${n.value}→${n.passMarks}` : `${n.value}`)).join(", ")} / {g.needs[0]?.maxMarks}
                </span>
                {canTakeBack ? (
                  <button type="button" className="tap pill" aria-label={tx(p(`Take back ${g.name}’s grace`, `${g.name} का ग्रेस वापस लें`))} disabled={pending} onClick={() => g.needs.forEach((n) => run(() => actions.removeGrace({ paperId: n.paperId, studentId: g.studentId })))} style={{ ...pillStyle, border: 0, cursor: "pointer" }}>
                    {pill}
                  </button>
                ) : (
                  <span className="pill" style={pillStyle}>
                    {pill}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {grace.rows.length === 0 ? <EmptyState icon="checkCircle" title={tx(p("Nobody is below the pass mark", "कोई पास अंक से नीचे नहीं"))} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- lock */

function Lock(props: ResultsProps & { pending: boolean; run: Run; picked: string[]; setPicked: (ids: string[]) => void; chosen: ClassRowView[]; onLock: () => void }) {
  const { tx } = useVx();
  const { classes, exam, actions, run, pending, picked, setPicked, chosen } = props;
  const kids = chosen.reduce((a, c) => a + c.children, 0);
  const allLocked = classes.length > 0 && classes.every((c) => c.locked);
  const lockedN = classes.filter((c) => c.locked).length;
  return (
    <div className="xc x14" style={{ maxWidth: 880, width: "100%", margin: "0 auto" }}>
      <div className="card xc xac x10" style={{ padding: "26px 22px", textAlign: "center" }}>
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="56" style={{ fill: allLocked ? "var(--oks)" : "var(--s2)", transition: "fill .4s ease" }} />
          {allLocked ? <circle cx="60" cy="60" r="56" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: 352, strokeDasharray: 352, animation: "xDraw .8s .25s var(--ease) both" } as CSSProperties} /> : null}
          <path d="M44 56V44a16 16 0 0 1 32 0v12" style={{ fill: "none", stroke: allLocked ? "var(--ok)" : "var(--acc)", strokeWidth: 7, strokeLinecap: "round", transformOrigin: "76px 56px", transform: allLocked ? "none" : "translateY(-10px) rotate(28deg)", transition: "transform .5s var(--spring)" }} />
          <rect x="34" y="54" width="52" height="40" rx="9" style={{ fill: allLocked ? "var(--ok)" : "var(--acc)", transition: "fill .3s ease" }} />
          <circle cx="60" cy="72" r="5" style={{ fill: "var(--card)" }} />
        </svg>
        <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{allLocked ? tx(p("All marks are locked", "सब अंक बंद हैं")) : tx(p("Lock the marks?", "अंक बंद करें?"))}</span>
        <span style={{ fontSize: 16, maxWidth: 520, lineHeight: 1.5 }}>{tx(p("After locking, teachers can’t change marks. Only the admin can unlock.", "बंद करने के बाद शिक्षक अंक नहीं बदल सकते। केवल प्रशासक खोल सकते हैं।"))}</span>
      </div>
      <div className="card xc x10 xp2">
        <div className="xr xj x8">
          <b className="xt">{tx(p("Which classes?", "कौन-सी कक्षाएँ?"))}</b>
          <span className="xm">{tx(p(`${chosen.length} ${chosen.length === 1 ? "class" : "classes"} · ${kidsEn(kids)}`, `${chosen.length} कक्षाएँ · ${kids} बच्चे`))}</span>
        </div>
        <div className="xr xw x6">
          {classes.map((c) => {
            if (c.locked) {
              return (
                <span key={c.id} className="xr x4">
                  <span className="chip" style={{ ...tn("ok"), borderColor: "transparent" }}>
                    <Ic n="lock" size={14} />
                    {c.label}
                  </span>
                  {props.canReopen ? (
                    <button type="button" className="tap btn ghost" disabled={pending} onClick={() => run(() => actions.unlock({ examId: exam.id, classId: c.id }))} style={{ height: 36 }}>
                      {tx(p("Unlock", "खोलें"))}
                    </button>
                  ) : null}
                </span>
              );
            }
            const on = picked.includes(c.id);
            return (
              <button key={c.id} type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on} disabled={!lockable(c)} title={lockable(c) ? undefined : tx(READINESS_LABEL[readinessOf(c)])} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])} style={{ opacity: lockable(c) ? 1 : 0.55 }}>
                {on ? <Ic n="check" size={14} /> : null}
                {c.label}
                <span className="num" style={{ opacity: 0.7 }}>{lockable(c) ? `${c.percent}%` : tx(READINESS_LABEL[readinessOf(c)])}</span>
              </button>
            );
          })}
        </div>
        <span className="xm">{tx(p("Only classes with every mark in, every paper submitted and no mark needing correction can be locked. Tap a class to leave it out.", "जिन कक्षाओं के सब अंक आ गए, सब पेपर जमा हैं और कोई अंक सुधारना बाकी नहीं, वही बंद हो सकती हैं। किसी कक्षा को छोड़ने के लिए उसे दबाएँ।"))}</span>
      </div>
      {chosen.length ? (
        <>
          <div className="xno" style={{ ...tn("info") }}>
            <Ic n="info" size={18} style={{ marginTop: 2, flex: "none" }} />
            <span>
              {props.grace.open ? tx(p("Grace is not given yet — you can still give it after locking. ", "ग्रेस अभी नहीं दिया — बंद करने के बाद भी दे सकते हैं। ")) : tx(p("Grace is already given. ", "ग्रेस दिया जा चुका है। "))}
              {tx(p("Report cards for these classes can be issued once they are locked.", "बंद होने पर इन कक्षाओं के प्रगति पत्र जारी हो सकते हैं।"))}
            </span>
          </div>
          {props.canFinalise ? (
            <button type="button" className="tap btn pri xbig hide-m" disabled={pending} onClick={props.onLock}>
              <Ic n="lock" size={18} />
              {tx(p(`Lock ${chosen.length} ${chosen.length === 1 ? "class" : "classes"}`, `${chosen.length} कक्षाएँ बंद करें`))}
            </button>
          ) : (
            <div className="xno" style={{ ...tn("warn") }}>
              <Ic n="shield" size={18} style={{ marginTop: 2, flex: "none" }} />
              <span>{tx(p("Only the admin finalises marks. Classes with every paper submitted are ready for the admin to lock.", "अंक केवल प्रशासक अंतिम करते हैं। जिन कक्षाओं के सभी पेपर जमा हैं, वे प्रशासक के बंद करने को तैयार हैं।"))}</span>
            </div>
          )}
        </>
      ) : null}
      {lockedN ? (
        <div className="card xr xw x12 xp fadein" style={{ background: "var(--oks)", color: "var(--ok)", borderColor: "var(--okm, var(--bd))" }}>
          <span className="xc xf" style={{ minWidth: 220 }}>
            <b>{tx(p(`${lockedN} of ${classes.length} classes locked`, `${classes.length} में से ${lockedN} कक्षाएँ बंद`))}</b>
            <span className="xs">{tx(p("Their report cards can be issued now.", "इनके प्रगति पत्र अब जारी हो सकते हैं।"))}</span>
          </span>
          <Link href="/exam-office/results?view=cards" className="tap btn pri mfull">
            {tx(p("See report cards", "प्रगति पत्र देखें"))}
            <Ic n="chevRight" size={18} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ cards */

function Cards(props: ResultsProps & { pending: boolean; run: Run }) {
  const { tx } = useVx();
  const { classes, cards, exam, actions, run, pending, childrenTotal } = props;
  const termQ = `term=${encodeURIComponent(exam.term)}&exam=${encodeURIComponent(exam.id)}`;
  const share = childrenTotal ? cards.issuedTotal / childrenTotal : 0;
  const len = Math.max(0.5, 263.9 * share);
  const sample = cards.sample;
  return (
    <div className="stack xgd" style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: 14, alignItems: "start" }}>
      <div className="xc x14 xn0">
        <div className="card xr xw x14 xp2">
          <div className="xrl" style={{ flex: "none", width: 84, height: 84 }}>
            <svg width="84" height="84" viewBox="0 0 100 100" className="xg" aria-hidden="true">
              <circle cx="50" cy="50" r="42" style={{ stroke: "var(--s3)", strokeWidth: 11 }} />
              <circle cx="50" cy="50" r="42" className="q1" style={{ stroke: "var(--ok)", strokeWidth: 11, strokeDasharray: `${len.toFixed(1)} 263.9`, ["--len" as string]: len.toFixed(1) } as CSSProperties} />
            </svg>
            <span className="xc xac xjc" style={{ position: "absolute", inset: 0 }}>
              <b className="num" style={{ fontSize: 19, lineHeight: 1 }}>{cards.issuedTotal}</b>
              <span className="xm x11">{tx(p(`of ${childrenTotal}`, `${childrenTotal} में`))}</span>
            </span>
          </div>
          <span className="xc xf" style={{ minWidth: 200, gap: 2 }}>
            <span className="xh">{tx(p(`${cards.issuedTotal} report cards issued`, `${cards.issuedTotal} प्रगति पत्र जारी`))}</span>
            <span className="xm">{tx(p("Not final = marks still coming. A card turns Final when its class is locked and issued.", "कच्चा = अंक अभी आ रहे हैं। कक्षा बंद होकर जारी होने पर कार्ड पक्का होता है।"))}</span>
          </span>
          <div className="xc x8 mfull" style={{ width: 250 }}>
            <Link href="/exam-office/results?view=publish" className="tap btn pri">
              {tx(p("Publish to parents", "अभिभावकों को जारी करें"))}
              <Ic n="chevRight" size={18} />
            </Link>
          </div>
        </div>
        <div className="card xoh xst">
          {classes.map((c) => {
            const final = c.children > 0 && c.issued >= c.children;
            const w = c.locked ? (c.children ? (c.issued / c.children) * 100 : 0) : c.percent;
            const tone: ToneKey = final ? "ok" : c.percent > 0 ? "warn" : "s3";
            return (
              <div key={c.id} className="xr x12 xd" style={{ padding: "9px 16px" }}>
                <span className="xc" style={{ flex: "none", width: 118 }}>
                  <b className="xe">{c.label}</b>
                  <span className="xm">{tx(p(`${kidsEn(c.children)}`, `${c.children} बच्चे`))}</span>
                </span>
                <span className="xbar xf" style={{ height: 8 }}>
                  <span style={{ width: `${Math.round(w)}%`, background: c.locked ? "var(--ok)" : "var(--acc)" }} />
                </span>
                {c.locked && !final ? (
                  <button type="button" className="tap btn sec" disabled={pending} onClick={() => run(() => actions.issueClass({ examId: exam.id, classId: c.id }))} style={{ height: 32, padding: "0 12px", fontSize: 13 }}>
                    {tx(p("Issue cards", "कार्ड जारी करें"))}
                  </button>
                ) : (
                  <Tag tone={tone} style={{ minWidth: 66, justifyContent: "center" }}>
                    {final ? tx(p("Final", "पक्का")) : c.percent > 0 ? tx(p("Not final", "कच्चा")) : tx(p("Waiting", "रुका"))}
                  </Tag>
                )}
                <a className="tap btn ghost hide-m" href={`/exams/report-card?class=${c.id}&${termQ}`} target="_blank" rel="noopener noreferrer" aria-label={tx(p(`Print ${c.label} cards`, `${c.label} के कार्ड छापें`))} style={{ width: 34, height: 34, padding: 0 }}>
                  <Ic n="printer" size={16} />
                </a>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card xc x12 xp2">
        <span className="sech">
          {tx(p("Sample", "नमूना"))}
          {sample ? ` · ${sample.name}, ${sample.classLabel}` : ""}
        </span>
        {sample ? (
          <>
            <div className="card xc x8" style={{ padding: 16, boxShadow: "var(--shh)", transform: "rotate(-1deg)", animation: "xRise .5s var(--ease) both" }}>
              <div className="xr x8" style={{ paddingBottom: 8, borderBottom: "2px solid var(--fg)" }}>
                {/* The school's logo, as on the issued card (D-369); the name beside it says the school, so it is decorative. */}
                <Crest size={32} radius={9} still />
                <span className="xc">
                  <span className="x11 x6w">{SCHOOL.hi}</span>
                  <span className="serif x11 x6w">{SCHOOL.en}</span>
                </span>
              </div>
              <span className="x11 xb xtc" style={{ padding: 4, borderRadius: 6, background: "var(--s2)" }}>
                {exam.name.hi ?? exam.name.en} प्रगति पत्र · {exam.name.en.toUpperCase()} REPORT CARD{sample.issued ? "" : ` · ${tx(p("NOT ISSUED", "अभी जारी नहीं"))}`}
              </span>
              <div className="xc">
                {sample.rows.map((r) => (
                  <div key={r.subject} className="xr xj x11 xd" style={{ padding: "4px 0" }}>
                    <span>
                      {subjectPair(r.subject).hi ? `${subjectPair(r.subject).hi} · ` : ""}
                      {r.subject}
                    </span>
                    <span className="num xb">
                      {r.scored}
                      {r.grace ? ` +${r.grace}G` : ""}/{r.outOf}
                      {r.absent ? <span style={{ color: "var(--bad)" }} title={r.absent}>*</span> : null} · {r.grade ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="xr xj xs xb" style={{ paddingTop: 6, borderTop: "2px solid var(--bds)" }}>
                <span>
                  कुल · Total {sample.total}/{sample.outOf}
                </span>
                <span style={{ color: sample.passed === false ? "var(--bad)" : "var(--ok)" }}>
                  {sample.percent ?? "—"}% · {sample.grade ?? "—"}
                  {sample.passed === null ? "" : sample.passed ? " · Pass · उत्तीर्ण" : ` · ${supportLine((sample.shortIn ?? []).map(subjectPair))}`}
                </span>
              </div>
            </div>
            <Link href={`/exams?view=preview&exam=${exam.id}${sample.classId ? `&class=${sample.classId}` : ""}&student=${sample.studentId}`} className="tap btn sec only-d">
              <Ic n="eye" size={18} />
              {tx(p("Open the full preview", "पूरी झलक खोलें"))}
            </Link>
            <span className="only-m xm">{tx(p("The full-size preview opens on a computer.", "पूरी झलक कंप्यूटर पर खुलती है।"))}</span>
          </>
        ) : (
          <span className="xm">{tx(p("A sample appears once a class has all its marks.", "किसी कक्षा के सब अंक आने पर नमूना दिखेगा।"))}</span>
        )}
      </div>
    </div>
  );
}

/** The printed card carries both names, as the design does. */
const SCHOOL = p("Shri Veer Patta Sr. Sec. School", "श्री वीर पत्ता सी. सै. स्कूल, आमेट");

/* ---------------------------------------------------------- publish */

function Publish(props: ResultsProps & { pending: boolean; run: Run; when: "now" | "scheduled"; setWhen: (w: "now" | "scheduled") => void; at: string; setAt: (v: string) => void; atLabel: string; ptm: boolean; setPtm: (v: boolean) => void; onPublish: () => void }) {
  const { tx } = useVx();
  const { exam, classes, pending, when, setWhen, at, setAt, atLabel, ptm, setPtm } = props;
  const [editAt, setEditAt] = useState(false);
  const unlocked = classes.filter((c) => !c.locked).length;
  const lockedKids = classes.filter((c) => c.locked).reduce((a, c) => a + c.children, 0);
  const tellParents = props.notice ? <TellParents notice={props.notice} examId={exam.id} pending={pending} run={props.run} tell={props.actions.tellParents} /> : null;
  const whenS =
    when === "now"
      ? lockedKids
        ? tx(p(`Only the ${classes.length - unlocked} locked classes can go now · ${lockedKids} parents.`, `अभी सिर्फ़ ${classes.length - unlocked} बंद कक्षाएँ जा सकती हैं · ${lockedKids} अभिभावक।`))
        : tx(p("No class is locked yet, so nothing can go now. Lock marks first.", "अभी कोई कक्षा बंद नहीं, इसलिए कुछ नहीं जाएगा। पहले अंक बंद करें।"))
      : tx(p("Classes not locked by then wait until they are locked.", "तब तक जो कक्षाएँ बंद नहीं होंगी, वे बंद होने तक रुकेंगी।"));
  return (
    <div className="stack xgd" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
      <div className="xc x14">
        {exam.publishedAt ? (
          <div className="card xc xac x8 fadein" style={{ padding: 22, textAlign: "center", background: "var(--oks)", borderColor: "var(--okm, var(--bd))" }}>
            <svg className="xtk" width="84" height="84" viewBox="0 0 96 96" aria-hidden="true">
              <circle className="a" cx="48" cy="48" r="44" style={{ fill: "var(--card)" }} />
              <circle className="b" cx="48" cy="48" r="44" />
              <path d="M30 49l12 12 24-26" />
            </svg>
            <span className="serif" style={{ fontSize: 22, fontWeight: 600, color: "var(--ok)" }}>{tx(p("Results released", "परिणाम जारी"))}</span>
            <span className="xs" style={{ color: "var(--ok)" }}>{tx(agoP(exam.publishedAt))}</span>
          </div>
        ) : null}
        {/* Once released, telling parents is the next step, so it comes first. */}
        {props.notice && exam.publishedAt ? tellParents : null}
        <div className="card xc x10 xp2">
          <b className="xt">{tx(p("When should parents get it?", "अभिभावकों को कब मिले?"))}</b>
          <div className="xr xw x8">
            <button type="button" className={`tap chip${when === "now" ? " on" : ""}`} aria-pressed={when === "now"} onClick={() => setWhen("now")} style={{ height: 42, padding: "0 16px", fontSize: 14 }}>
              <Ic n="send" size={16} />
              {tx(p("Now", "अभी"))}
            </button>
            <button type="button" className={`tap chip${when === "scheduled" ? " on" : ""}`} aria-pressed={when === "scheduled"} onClick={() => setWhen("scheduled")} style={{ height: 42, padding: "0 16px", fontSize: 14 }}>
              <Ic n="clock" size={16} />
              {atLabel || tx(p("At a set time", "तय समय पर"))}
            </button>
          </div>
          {when === "scheduled" && (editAt || !at) ? (
            <Field label={tx(p("Date and time", "तिथि और समय"))}>
              <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          ) : null}
          <span className="xm" style={{ lineHeight: 1.5 }}>
            {whenS}
            {when === "scheduled" && at && !editAt ? (
              <>
                {" "}
                <button type="button" className="tap" onClick={() => setEditAt(true)} style={{ border: 0, padding: 0, background: "transparent", color: "var(--acc)", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  {tx(p("Change the time", "समय बदलें"))}
                </button>
              </>
            ) : null}
          </span>
        </div>
        <button type="button" className="tap card xr x12 xp" role="switch" aria-checked={ptm} onClick={() => setPtm(!ptm)} style={{ width: "100%", textAlign: "left", color: "var(--fg)" }}>
          <span className="xc xf">
            <b>{tx(p("Results also shown at the PTM", "PTM पर भी परिणाम दिखाएँ"))}</b>
            {exam.ptmAt ? <span className="xm">{tx(p(`${exam.resultsLabel ?? ""}, ${ampm(exam.ptmAt)} · class teachers show each card to the parent`, `${exam.resultsLabel ?? ""}, ${ampm(exam.ptmAt)} · कक्षा अध्यापक हर कार्ड दिखाएँगे`))}</span> : null}
          </span>
          <span className={`sw${ptm ? " on" : ""}`}>
            <span />
          </span>
        </button>
        <div className="card xc" style={{ padding: "4px 16px" }}>
          {[
            { k: p("To", "किसे"), v: tx(p(`${props.childrenTotal} parents · one card per child`, `${props.childrenTotal} अभिभावक · हर बच्चे का एक कार्ड`)) },
            { k: p("Cards issued", "कार्ड जारी"), v: `${props.cards.issuedTotal} / ${props.childrenTotal}` },
            { k: p("Sent through", "किससे"), v: tx(p("WhatsApp · the card on a tap", "WhatsApp · टैप पर कार्ड")) },
          ].map((f) => (
            <div key={f.k.en} className="xfa xd">
              <span className="xmu">{tx(f.k)}</span>
              <span className="num xb xtr">{f.v}</span>
            </div>
          ))}
        </div>
        {exam.publishedAt ? null : (
          <button type="button" className="tap btn pri xbig hide-m" disabled={pending || (when === "scheduled" && !at) || (when === "now" && !lockedKids)} onClick={props.onPublish}>
            <Ic n={when === "now" ? "send" : "clock"} size={18} />
            {when === "now" ? tx(p("Release results now", "परिणाम अभी जारी करें")) : tx(p(`Schedule for ${atLabel.replace(" · ", ", ")}`, `${atLabel.replace(" · ", ", ")} के लिए तय करें`))}
          </button>
        )}
        {props.notice && !exam.publishedAt ? tellParents : null}
      </div>
      <div className="xc x10">
        <NoticePreview notice={props.notice ?? null} />
      </div>
    </div>
  );
}

type Notice = NonNullable<ResultsProps["notice"]>;

const NOTICE_STATE: Record<Notice["template"], { tone: ToneKey; label: Pair; line: Pair | null }> = {
  approved: { tone: "ok", label: p("Approved by Meta", "Meta ने मंज़ूर किया"), line: null },
  pending: { tone: "warn", label: p("Waiting for Meta", "Meta की मंज़ूरी बाकी"), line: p("Meta is checking the message. The button works once Meta approves it, usually within a day.", "Meta संदेश जाँच रहा है। मंज़ूरी के बाद बटन चलेगा, आमतौर पर एक दिन में।") },
  rejected: { tone: "bad", label: p("Meta said no", "Meta ने मना किया"), line: p("Meta did not approve the message. We will reword it and send it again.", "Meta ने संदेश मंज़ूर नहीं किया। हम शब्द बदलकर फिर भेजेंगे।") },
  marketing: { tone: "bad", label: p("Filed as marketing", "मार्केटिंग में डाला"), line: p("Meta filed it as marketing, which costs about 7 times more. We will reword it so it goes as a school message.", "Meta ने इसे मार्केटिंग में डाला, जो लगभग 7 गुना महँगा है। हम शब्द बदलेंगे ताकि यह स्कूल संदेश बने।") },
  missing: { tone: "s3", label: p("Not set up", "तैयार नहीं"), line: p("The WhatsApp message could not be read. Reload the page.", "WhatsApp संदेश पढ़ा नहीं गया। पेज फिर खोलें।") },
};

/** "Results are out" for each released class (D-615): practice only, to the owner's number. */
function TellParents({ notice, examId, pending, run, tell }: { notice: Notice; examId: string; pending: boolean; run: Run; tell?: ResultsProps["actions"]["tellParents"] }) {
  const { tx } = useVx();
  const state = NOTICE_STATE[notice.template];
  const ready = notice.template === "approved" && notice.released && notice.ownerSet && Boolean(tell);
  return (
    <div className="card xc x10 xp2">
      <div className="xr x10">
        <span className="xi" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--wabg)", color: "var(--wafg)" }}>
          <Ic n="message" size={20} />
        </span>
        <span className="xc xf x4" style={{ minWidth: 0 }}>
          <span className="xr xw x8">
            <b className="xt">{tx(p("Tell parents on WhatsApp", "WhatsApp पर अभिभावकों को बताएँ"))}</b>
            <Tag tone={state.tone}>{tx(state.label)}</Tag>
          </span>
          <span className="xm">{tx(p("“Results are out”, one message per child, with a Get report card button.", "“परिणाम घोषित”, हर बच्चे का एक संदेश, रिपोर्ट कार्ड भेजें बटन के साथ।"))}</span>
        </span>
      </div>
      {state.line ? <span className="xm" style={{ lineHeight: 1.5 }}>{tx(state.line)}</span> : null}
      {!notice.practice ? (
        <span className="xm" style={{ lineHeight: 1.5 }}>{tx(p("Real families are not switched on yet, so nothing goes from here. When the owner switches them on, this tells every family of a released class.", "असली परिवारों के लिए अभी चालू नहीं, इसलिए यहाँ से कुछ नहीं जाता। मालिक के चालू करने पर यह जारी कक्षा के हर परिवार को बताएगा।"))}</span>
      ) : (
        <>
          <span className="xr x8 xs" style={{ padding: "8px 10px", borderRadius: 10, background: "var(--s2)", lineHeight: 1.45 }}>
            <Ic n="flask" size={16} />
            {tx(p("Practice: it goes only to the owner’s number, for the practice children.", "अभ्यास: यह केवल मालिक के नंबर पर जाता है, अभ्यास वाले बच्चों के लिए।"))}
          </span>
          {!notice.released ? <span className="xm">{tx(p("Release the results first. Then each locked class can be told.", "पहले परिणाम जारी करें। फिर हर बंद कक्षा को बताया जा सकता है।"))}</span> : null}
          {notice.classes.length === 0 ? (
            <span className="xm">{tx(p("No class is locked with issued cards yet.", "अभी कोई कक्षा जारी कार्ड के साथ बंद नहीं।"))}</span>
          ) : (
            <div className="card xc xoh">
              {notice.classes.map((c) => {
                const told = c.kids.length > 0 && c.kids.every((k) => k.told);
                return (
                  <div key={c.id} className="xr x10 xd" style={{ padding: "9px 12px" }}>
                    <span className="xc xf" style={{ minWidth: 0 }}>
                      <b className="xe">{c.label}</b>
                      <span className="xm">
                        {c.kids.length
                          ? c.kids.map((k) => `${k.name}${k.told ? " ✓" : ""}`).join(", ")
                          : tx(p("No practice child in this class", "इस कक्षा में अभ्यास वाला बच्चा नहीं"))}
                      </span>
                    </span>
                    {c.kids.length ? (
                      told ? (
                        <Tag tone="ok" style={{ flex: "none" }}>
                          <Ic n="check" size={14} />
                          {tx(p("Told", "बताया"))}
                        </Tag>
                      ) : (
                        <button type="button" className="tap btn pri" disabled={pending || !ready} onClick={() => tell && run(() => tell({ examId, classId: c.id }))} style={{ flex: "none", height: 40, padding: "0 14px" }}>
                          <Ic n="send" size={16} />
                          {tx(p("Tell parents", "बताएँ"))}
                        </button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The message as a parent sees it in WhatsApp, with its button and what a tap does. */
function NoticePreview({ notice }: { notice: Notice | null }) {
  const { tx } = useVx();
  const [lang, setLang] = useState<"hi" | "en">("hi");
  if (!notice) return null;
  const lines = notice.preview[lang].split("\n");
  return (
    <>
      <div className="xr xj x8">
        <span className="xb x11 xm">{tx(p("Preview · each parent gets only their own child’s", "झलक · हर अभिभावक को केवल अपने बच्चे का"))}</span>
        <Seg value={lang} onChange={setLang} label={tx(p("Preview language", "झलक की भाषा"))} style={{ width: 170, flex: "none" }} options={[{ value: "hi", label: "हिंदी" }, { value: "en", label: "English" }]} />
      </div>
      <div className="xwa">
        <div className="xwb" style={{ whiteSpace: "normal" }}>
          {lines.map((line, i) => {
            const bold = /^\*(.+)\*$/.exec(line);
            return <div key={i} style={{ minHeight: line ? undefined : 8 }}>{bold ? <b>{bold[1]}</b> : line}</div>;
          })}
        </div>
        <div className="xwq">
          <Ic n="undo" size={14} />
          {notice.button[lang]}
        </div>
        <div className="xwb xwo">{notice.button[lang]}</div>
        <div className="xwb xwp">
          <span className="xr x8 x6w">
            <Ic n="file" size={18} />
            {tx(p("Report card.pdf · 1 page", "प्रगति पत्र.pdf · 1 पेज"))}
          </span>
        </div>
      </div>
      <span className="xm" style={{ lineHeight: 1.5 }}>{tx(p("A tap on the button sends that child’s issued report card as a PDF, at once, and only once its results are out.", "बटन दबाते ही उस बच्चे का जारी प्रगति पत्र PDF में तुरंत आता है, और केवल परिणाम जारी होने के बाद।"))}</span>
    </>
  );
}

/* ---------------------------------------------------------- recheck */

function Rechecks(props: ResultsProps & { pending: boolean; run: Run; open: ResultsProps["rechecks"][number] | null; href: (v: ResultsView, extra?: string) => string }) {
  const { tx } = useVx();
  const router = useRouter();
  const { rechecks, actions, run, pending, exam, open: r } = props;
  const [delta, setDelta] = useState(0);
  const [mode, setMode] = useState<"none" | "changed">("changed");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ classId: "", paperId: "", studentId: "", askedBy: "", note: "" });
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
    setDelta(0);
    setMode("changed");
    router.push(props.href("recheck", `&recheck=${id}`), { scroll: false });
  };
  const outcome = (x: ResultsProps["rechecks"][number]) => (x.status === "changed" && x.oldValue !== null && x.newValue !== null ? `${tx(RECHECK_WORDS.changed.label)} ${x.newValue - x.oldValue > 0 ? "+" : ""}${x.newValue - x.oldValue}` : tx(RECHECK_WORDS[x.status].label));
  const dateOf = (iso: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)).replace(",", "");
  const resolved = r ? r.status === "changed" || r.status === "no_change" : false;
  return (
    <div className="stack xgd" style={{ gridTemplateColumns: r ? "minmax(0,1fr) 400px" : "minmax(0,1fr)", alignItems: "start" }}>
      <section className={`pad xsc xn0${r ? " hide-m" : ""}`}>
        <div className="xr xw x8">
          {[
            { n: counts.new, label: p("new", "नए"), tone: "warn" as const },
            { n: counts.with_teacher, label: p("with teachers", "शिक्षकों के पास"), tone: "info" as const },
            { n: counts.done, label: p("done", "पूरे"), tone: "ok" as const },
          ].map((q) => (
            <Tag key={q.label.en} tone={q.tone} style={{ height: 28, padding: "0 12px", fontSize: 12 }}>
              {q.n} {tx(q.label)}
            </Tag>
          ))}
          <span className="xf" />
          <button type="button" className="tap btn sec" onClick={() => setAdding(true)} style={{ height: 36 }}>
            <Ic n="plus" size={16} />
            {tx(p("Add a request", "अनुरोध जोड़ें"))}
          </button>
        </div>
        <div className="card xoh xst">
          {rechecks.length === 0 ? <EmptyState icon="inbox" title={tx(p("No re-check requests", "कोई दोबारा जाँच अनुरोध नहीं"))} /> : null}
          {rechecks.map((x) => {
            const av = { ...toneAvatar(x.name), name: x.name };
            const tone: ToneKey = x.status === "changed" ? "ok" : RECHECK_WORDS[x.status].tone;
            return (
              <button key={x.id} type="button" className={`tap row xl xd${x.id === r?.id ? " sel" : ""}`} aria-current={x.id === r?.id ? "true" : undefined} onClick={() => pick(x.id)} style={{ padding: "12px 16px", background: x.id === r?.id ? "var(--accs)" : undefined }}>
                <span className="xa" style={{ background: av.bg, color: av.fg }}>
                  {ini(av.name)}
                </span>
                <span className="xc xf">
                  <span className="x6w xe">{x.name}</span>
                  <span className="xm xe">
                    {x.classLabel} · {x.subjectCode}
                  </span>
                </span>
                <span className="xm xe hide-m" style={{ flex: 1.2, fontStyle: "italic" }}>
                  “{x.note ?? ""}”
                </span>
                <Tag tone={tone}>{outcome(x)}</Tag>
                <Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />
              </button>
            );
          })}
        </div>
        <span className="xm">{tx(p("Requests come from parents on WhatsApp or through the class teacher. The subject teacher checks the copy again.", "अनुरोध अभिभावकों से WhatsApp या कक्षा अध्यापक के ज़रिये आते हैं। विषय-अध्यापक कॉपी दोबारा जाँचते हैं।"))}</span>
      </section>
      {r ? (
        <aside className="unstick xside" style={{ animation: "xPush .36s var(--ease) both" }}>
          <div className="xc x14" style={{ padding: "18px 22px 28px" }}>
            <div className="only-d xr xj">
              <Tag tone={r.status === "changed" ? "ok" : RECHECK_WORDS[r.status].tone} style={{ height: 26, padding: "0 10px", fontSize: 12 }}>
                {resolved ? tx(p("Done", "पूरा")) : tx(RECHECK_WORDS[r.status].label)}
              </Tag>
              <Link href={props.href("recheck")} scroll={false} className="tap btn ghost xq" aria-label={tx(p("Close the request", "अनुरोध बंद करें"))} style={{ height: 36 }}>
                <Ic n="x" size={18} />
              </Link>
            </div>
            <div className="card xc x8 xp2">
              <span className="xh">{r.name}</span>
              <span className="xm">
                {r.classLabel} · {r.subjectCode} · {tx(exam.name)}
              </span>
              {r.note ? (
                <div className="xno" style={{ background: "var(--s2)", fontStyle: "italic" }}>
                  “{r.note}”
                </div>
              ) : null}
              <span className="xm">
                {r.askedBy} · {dateOf(r.createdAt)}
              </span>
              <div className="xr xj">
                <span className="xmu">{tx(p("Marks now", "अभी अंक"))}</span>
                <b className="num" style={{ fontSize: 20 }}>
                  {r.mark ?? "—"} / {r.maxMarks}
                </b>
              </div>
            </div>
            <div className="card xc x10 xp2">
              <span className="sech">{tx(p("1 · Ask the subject teacher", "1 · विषय-अध्यापक से कहें"))}</span>
              <span className="xr x10">
                <span className="xa" style={{ background: "var(--accs)", color: "var(--accfg)" }}>
                  {ini(r.teacherName ?? "?")}
                </span>
                <span className="xc xf">
                  <b>{r.teacherName ?? tx(p("No teacher on the timetable", "समय-सारणी में शिक्षक नहीं"))}</b>
                  <span className="xm">{tx(p(`${r.subjectCode} teacher · ${r.status === "new" ? "not asked yet" : "asked"}`, `${r.subjectCode} शिक्षक · ${r.status === "new" ? "अभी नहीं कहा" : "कहा गया"}`))}</span>
                </span>
              </span>
              {resolved ? null : (
                <button
                  type="button"
                  className={`tap btn ${r.status === "new" ? "pri" : "soft"}`}
                  disabled={pending}
                  onClick={() => {
                    window.open(waLink(r.teacherPhone, ask), "_blank", "noopener");
                    if (r.status === "new") run(() => actions.recheckWithTeacher({ recheckId: r.id }));
                  }}
                >
                  <Ic n="send" size={18} />
                  {r.status === "new" ? tx(p(`Ask ${r.teacherName ?? "the teacher"} to re-check`, `${r.teacherName ?? "शिक्षक"} से दोबारा जाँच कहें`)) : tx(p("Ask again", "फिर कहें"))}
                </button>
              )}
            </div>
            <div className="card xc x10 xp2" style={{ opacity: r.status === "new" ? 0.6 : 1 }}>
              <span className="sech">{tx(p("2 · What changed?", "2 · क्या बदला?"))}</span>
              {resolved ? (
                <div className="xr x10 fadein" style={{ padding: "10px 12px", borderRadius: 12, background: "var(--oks)", color: "var(--ok)" }}>
                  <Ic n="checkCircle" size={18} />
                  <b className="xf">{r.status === "changed" ? tx(p(`Changed from ${r.oldValue} to ${r.newValue}.`, `${r.oldValue} से ${r.newValue} किया।`)) : tx(p("Checked again — no change.", "दोबारा जाँचा — कोई बदलाव नहीं।"))}</b>
                </div>
              ) : (
                <>
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
                    <div className="xr x8">
                      <button type="button" className="tap btn sec" aria-label={tx(p("One mark less", "एक अंक कम"))} onClick={() => setDelta(Math.max(-20, delta - 1))} style={{ width: 44, padding: 0 }}>
                        <Ic n="minus" size={18} />
                      </button>
                      <span className="num xb xtc" style={{ minWidth: 52, fontSize: 20 }}>{delta > 0 ? `+${delta}` : delta}</span>
                      <button type="button" className="tap btn sec" aria-label={tx(p("One mark more", "एक अंक ज़्यादा"))} onClick={() => setDelta(Math.min(20, delta + 1))} style={{ width: 44, padding: 0 }}>
                        <Ic n="plus" size={18} />
                      </button>
                      <span className="num xb" style={{ marginLeft: "auto" }}>
                        {r.mark ?? "—"} → {r.mark === null ? "—" : r.mark + delta} / {r.maxMarks}
                      </span>
                    </div>
                  ) : null}
                  {r.locked && mode === "changed" ? (
                    <div className="xno" style={{ ...tn("warn") }}>
                      <Ic n="lock" size={18} style={{ flex: "none", marginTop: 2 }} />
                      <span>{tx(p("This class is locked. The admin unlocks it before a mark can change.", "यह कक्षा बंद है। अंक बदलने से पहले प्रशासक खोलेंगे।"))}</span>
                    </div>
                  ) : null}
                  <button type="button" className="tap btn pri" disabled={pending || r.status === "new" || (mode === "changed" && delta === 0)} onClick={() => run(() => actions.resolveRecheck({ recheckId: r.id, delta: mode === "changed" ? delta : 0 }))}>
                    <Ic n="check" size={18} />
                    {mode === "changed" ? tx(p("Save the new mark", "नए अंक सहेजें")) : tx(p("Close · no change", "बंद करें · कोई बदलाव नहीं"))}
                  </button>
                </>
              )}
            </div>
            <div className="card xc xp">
              <span className="sech" style={{ marginBottom: 6 }}>{tx(p("History", "इतिहास"))}</span>
              <div className="xst">
                <div className="xlg">
                  <i style={{ background: "var(--warn)" }} />
                  <span>{tx(p(`Request from ${r.askedBy}`, `${r.askedBy} से अनुरोध`))}</span>
                  <span className="num xm">{dateOf(r.createdAt)}</span>
                </div>
                {r.status !== "new" ? (
                  <div className="xlg">
                    <i style={{ background: "var(--info)" }} />
                    <span>{tx(p(`Asked ${r.teacherName ?? "the teacher"} to re-check`, `${r.teacherName ?? "शिक्षक"} से दोबारा जाँच कही`))}</span>
                    <span />
                  </div>
                ) : null}
                {resolved ? (
                  <div className="xlg">
                    <i style={{ background: "var(--ok)" }} />
                    <span>{outcome(r)}</span>
                    <span />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      ) : null}
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        icon="plus"
        title={tx(p("Add a re-check request", "दोबारा जाँच अनुरोध जोड़ें"))}
        footer={
          <button
            type="button"
            className="tap btn pri"
            style={{ flex: 1 }}
            disabled={pending || !form.paperId || !form.studentId || form.askedBy.trim().length < 2}
            onClick={() => run(() => actions.addRecheck({ paperId: form.paperId, studentId: form.studentId, askedBy: form.askedBy, note: form.note }), () => setAdding(false))}
          >
            <Ic n="check" size={18} />
            {tx(p("Add request", "अनुरोध जोड़ें"))}
          </button>
        }
      >
        <div className="xc x12">
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
    </div>
  );
}

