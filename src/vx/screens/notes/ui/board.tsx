"use client";

import Link from "@/ui/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { shortDayHi } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import type { ChildChoice, SupportPlan } from "../data";
import {
  boardKpis,
  countP,
  filterBoard,
  noteSubject,
  knownPair,
  isSensitiveNote,
  monthInsight,
  monthStats,
  noteStage,
  NOTE_TAGS,
  planProgress,
  planProgressText,
  TAG_TEXT,
  tagMix,
  weekEndOf,
  type BoardNote,
  type BoardTab,
  type NoteTag,
} from "../domain/notes";
import { NOTE_CARD_HELP, NoteCards, noteCardTop, useNoteCards } from "./cards";
import { useComposer, useUndo } from "./compose";
import { BoardNoteAside } from "./detail";
import { BOARD_TAG, day, followSoon, HelpSteps, ini, MIX_COLOR, NotesTop, noteWhen, relationText, replaceParams, Seg, StagePill, useBoth, useNoteWords, type HelpStep } from "./look";
import { BoardPlan } from "./plan";
import type { NotesProps } from "./workspace";
import { ClassDigest } from "@/vx/assist/summary-assist";

/*
 * The notes board for the office and the coordinator (design `Notes`, and
 * `AD-Notes` for the academic menu): what needs action, follow-ups, support
 * plans, every note; one note beside the board; one child's page; adding a
 * note, card by card (D-486); a support plan. Every state is a URL.
 */

const HELP: Record<"board" | "student" | "plan", HelpStep[]> = {
  board: [
    { icon: "list", title: p("Pick a note", "नोट चुनें"), body: p("Read it and the replies.", "उसे और जवाब पढ़ें।") },
    { icon: "users", title: p("Give it to someone", "किसी को सौंपें"), body: p("Change the status or who follows up.", "स्थिति बदलें, या कौन फिर से देखेगा।") },
    { icon: "layers", title: p("Make a plan", "योजना बनाएँ"), body: p("Steps with owners and dates.", "कदम, हर एक के साथ व्यक्ति और तारीख़।") },
  ],
  student: [
    { icon: "clock", title: p("Whole story", "पूरी कहानी"), body: p("All teachers’ notes, newest first.", "सब अध्यापकों के नोट, नए पहले।") },
    { icon: "tag", title: p("Filter", "छाँटें"), body: p("Tap a tag to see only those.", "सिर्फ़ वही देखने के लिए टैग दबाएँ।") },
    { icon: "mic", title: p("Add a note", "नोट लिखें"), body: p("The class teacher sees it too.", "कक्षा अध्यापक भी देखेंगे।") },
  ],
  plan: [
    { icon: "check", title: p("Tick steps", "कदम पूरे करें"), body: p("The ring moves by itself.", "घेरा अपने-आप बढ़ता है।") },
    { icon: "plus", title: p("Add a step", "कदम जोड़ें"), body: p("It gets an owner and a date.", "हर कदम को व्यक्ति और तारीख़ मिलती है।") },
    { icon: "send", title: p("Tell parents", "अभिभावक को बताएँ"), body: p("Hindi first, cost shown first.", "पहले हिंदी, पहले लागत।") },
  ],
};

/** "Thu 8 – Sun 11 Oct". */
function rangeLabel(from: string, to: string): string {
  const a = day(from).replace(/,/g, "").split(" ");
  const b = day(to).replace(/,/g, "");
  return from.slice(0, 7) === to.slice(0, 7) && a.length === 3 ? `${a[0]} ${a[1]} – ${b}` : `${day(from)} – ${b}`;
}

function KpiTile({ label, value, sub, icon, bg, fg, tone, on, onPick, delay }: { label: string; value: number; sub: string; icon: IconName; bg: string; fg: string; tone: string; on: boolean; onPick: () => void; delay: number }) {
  return (
    <button type="button" className="tap card rise nx-c" aria-pressed={on} onClick={onPick} style={{ padding: "14px 16px", gap: 2, textAlign: "left", color: "var(--fg)", borderColor: on ? "var(--acc)" : "var(--bd)", boxShadow: on ? "0 0 0 1px var(--acc), var(--sh)" : "var(--sh)", animationDelay: `${delay}ms`, font: "inherit" }}>
      <span className="nx-f" style={{ justifyContent: "space-between" }}>
        <span className="nx-m" style={{ fontWeight: 600 }}>{label}</span>
        <span className="nx-ib" style={{ width: 30, height: 30, borderRadius: 10, background: bg, color: fg }}>
          <Ic n={icon} size={16} />
        </span>
      </span>
      <span className="num" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: tone }}>{value}</span>
      <span className="nx-m hide-m">{sub}</span>
    </button>
  );
}

/** A note on the board (design `card()`). */
function BoardCard({ note, plan, today, href, selected, delay, viewerId }: { note: BoardNote; plan: SupportPlan | null; today: string; href: string; selected: boolean; delay: number; viewerId: string }) {
  const { tx } = useVx();
  const words = useNoteWords(viewerId);
  const hint = words.hint(note);
  const look = BOARD_TAG[note.tags[0] ?? "studies"];
  const stage = noteStage(note);
  const rel = relationText(note.authorRelation);
  const hasFollow = note.needsFollowUp && note.followUpOn && stage !== "done" && stage !== "noting";
  // Who follows up by name, "You" only for the reader's own (smoke 20 Oct: "Me" on other teachers' notes).
  const who = words.who(note);
  const prog = plan ? planProgress(plan.steps) : null;
  return (
    <Link href={href} scroll={false} className="tap card nx-nc" aria-current={selected ? "true" : undefined} style={{ borderColor: selected ? "var(--acc)" : "var(--bd)", background: selected ? "var(--accs)" : "var(--card)", animationDelay: `${delay}ms` }}>
      <span className="nx-f" style={{ gap: 10, width: "100%" }}>
        <span className="nx-ib" style={{ borderRadius: 19, background: look.bg, color: look.fg }}>{words.initials(note)}</span>
        <span className="nx-c" style={{ flex: 1 }}>
          <span className="nx-b nx-e" style={{ fontSize: 15 }}>{words.name(note)}</span>
          <span className="nx-m nx-e">{[note.classLabel, hint, note.writtenByName, rel ? tx(rel) : null].filter(Boolean).join(" · ")}</span>
        </span>
        <StagePill stage={stage} />
      </span>
      <span className="nx-nt">{note.body}</span>
      <span className="nx-f" style={{ flexWrap: "wrap", gap: 6, width: "100%" }}>
        {note.tags.map((t) => (
          <span key={t} className="pill" style={{ background: BOARD_TAG[t].bg, color: BOARD_TAG[t].fg }}>
            <Ic n={BOARD_TAG[t].icon} size={12} />
            {tx(TAG_TEXT[t])}
          </span>
        ))}
        {hasFollow ? (
          <span className="pill" style={{ background: "var(--s2)", color: followSoon(note, today) ? "var(--bad)" : "var(--mut)" }}>
            <Ic n="calendar" size={12} />
            {tx(p(day(note.followUpOn!), shortDayHi(note.followUpOn!)))}
            {who ? ` · ${who}` : ""}
          </span>
        ) : null}
        {note.visibility === "private" ? (
          <span className="pill" style={{ background: "var(--s2)", color: "var(--mut)" }}>
            <Ic n="lock" size={12} />
            {tx(p("Only me", "सिर्फ़ मैं"))}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {prog ? (
          <span className="nx-m nx-f" style={{ gap: 4 }}>
            <Ic n="layers" size={13} />
            {tx(p(`${prog.done} of ${prog.total} steps`, `${prog.total} में से ${prog.done} कदम`))}
          </span>
        ) : null}
        {note.replies ? (
          <span className="nx-m nx-f" style={{ gap: 4 }}>
            <Ic n="message" size={13} />
            {note.replies}
          </span>
        ) : null}
        <span className="nx-m num">{tx(noteWhen(note.createdAt, today))}</span>
      </span>
    </Link>
  );
}

/** A plan with no note on the board (made from Student 360 or before notes had plans). */
function PlanCard({ plan, href }: { plan: SupportPlan; href: string }) {
  const { tx } = useVx();
  const prog = planProgress(plan.steps);
  return (
    <Link href={href} scroll={false} className="tap card nx-nc">
      <span className="nx-f" style={{ justifyContent: "space-between", width: "100%" }}>
        <span className="nx-b">{plan.studentName} · {plan.classLabel}</span>
        <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(p("Running", "चल रही है"))}</span>
      </span>
      <span className="nx-nt">{plan.goal}</span>
      <span className="nx-m nx-f" style={{ gap: 4 }}>
        <Ic n="layers" size={13} />
        {tx(p(`${prog.done} of ${prog.total} steps`, `${prog.total} में से ${prog.done} कदम`))} · {plan.createdByName}
      </span>
    </Link>
  );
}

type Screen = "board" | "student" | "add" | "plan";

/** Notes board (coordinator / admin). */
export function NotesBoard(props: NotesProps & { tab: BoardTab; classes: { id: string; label: string }[]; teachers: { id: string; name: string }[] }) {
  const { tx, language } = useVx();
  const both = useBoth();
  const router = useRouter();
  const base = "/notes";
  const people = props.people ?? { classTeachers: {}, coordinator: null, admin: null };
  const scope = props.scope ?? null;
  const studentId = scope?.studentId ?? null;
  const home = studentId ? `${base}?student=${studentId}` : base;
  const at = (param: string) => (studentId ? `${base}?student=${studentId}&${param}` : `${base}?${param}`);
  const [adding, setAdding] = useState(props.initialSheet === "add");
  // A tab or link that drops `?sheet=add` closes the form (smoke 6 Nov, teacher 16).
  const sheetParam = useSearchParams()?.get("sheet") ?? null;
  const [lastSheet, setLastSheet] = useState(sheetParam);
  if (lastSheet !== sheetParam) {
    setLastSheet(sheetParam);
    if (lastSheet === "add" && sheetParam !== "add" && adding) setAdding(false);
  }
  const [help, setHelp] = useState(false);
  const [tab, setTabState] = useState<BoardTab>(props.tab);
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [tag, setTag] = useState<NoteTag | null>(null);
  const [kidTag, setKidTag] = useState<NoteTag | null>(null);
  const focus = props.focus;
  const open = focus?.kind === "note" ? focus : null;
  const screen: Screen = adding ? "add" : focus?.kind === "plan" || focus?.kind === "new-plan" ? "plan" : scope ? "student" : "board";

  const composer = useComposer({
    kids: props.kids,
    notes: props.notes,
    viewer: props.viewer,
    initialStudent: props.initialStudent,
    initialStep: props.initialStep,
    lang: language === "hi" ? "hi-IN" : "en-IN",
    today: props.today,
    testSession: props.testSession,
    // No tag is chosen for the writer: a default "studies" read as the last
    // note's tag carried over (20-teacher day, 6 Nov). Speech still suggests one.
    ownerFor: (child) => (child && props.viewer.heldClassIds.includes(child.classId) ? "me" : "class_teacher"),
  });
  const { undo, pending: undoing } = useUndo();
  // The card on the screen (D-486), and the note it has just saved.
  const flow = useNoteCards(composer, composer.child ? "write" : "child");
  const [saved, setSaved] = useState<{ id: string; child: ChildChoice } | null>(null);

  const openAdd = () => {
    const kid = scope && props.kids.some((k) => k.id === scope.studentId) ? scope.studentId : open?.note.studentId && props.kids.some((k) => k.id === open.note.studentId) ? open.note.studentId : null;
    // Every note starts empty: the last one's tags and words never carry over
    // to the next child. A note left unsaved is kept (RULES G) and offered on
    // the card with "Continue this note", never filled in by itself.
    composer.reset(false);
    if (kid) composer.pickChild(kid);
    composer.checkDraft();
    setSaved(null);
    setAdding(true);
    flow.start(kid ? "write" : "child");
    replaceParams({ sheet: "add" });
  };
  const closeAdd = () => {
    if (composer.speech.listening) composer.speech.stop();
    setAdding(false);
    setSaved(null);
    // The stored draft stays; only the open form is cleared.
    composer.reset(false);
    replaceParams({ sheet: null, step: null, saved: null });
  };
  const setTab = (t: BoardTab) => {
    setTabState(t);
    replaceParams({ tab: t === "action" ? null : t, note: null });
    if (open) router.push(t === "action" ? base : `${base}?tab=${t}`, { scroll: false });
  };

  const onSaved = (id: string, child: ChildChoice) => {
    setSaved({ id, child });
    flow.go("saved");
    router.refresh();
  };
  /** Done on the saved card: the child's page, with the new note marked. */
  const doneSaved = () => {
    const s = saved;
    closeAdd();
    if (s) router.push(`${base}?student=${s.child.id}&saved=${s.id}`, { scroll: false });
  };

  const planOf = (n: BoardNote) => (n.planId ? (props.plans.find((pl) => pl.id === n.planId) ?? null) : null);
  const running = props.plans.filter((pl) => pl.status === "active" || pl.status === "draft");
  const kpis = boardKpis(props.notes, running.length, props.today);
  const stats = monthStats(props.notes, props.today);
  const insight = monthInsight(props.notes, props.today);
  const mixAll = tagMix(props.notes);
  const mixTotal = mixAll.reduce((s, m) => s + m.count, 0);
  const counts = {
    action: filterBoard(props.notes, { tab: "action" }, props.today).length,
    followups: filterBoard(props.notes, { tab: "followups" }, props.today).length,
    plans: filterBoard(props.notes, { tab: "plans" }, props.today).length,
    all: props.notes.length,
  };
  const shown = filterBoard(props.notes, { tab, classId: classId || null, teacherId: teacherId || null, tag }, props.today);
  const filtered = Boolean(classId || teacherId || tag);
  const orphanPlans = tab === "plans" ? running.filter((pl) => !pl.noteId || !props.notes.some((n) => n.id === pl.noteId)).filter((pl) => (classId ? pl.classId === classId : true)) : [];
  const me = props.viewer.isCoordinator ? props.viewer.name : null;

  /* ---------------------------------------------------------- the header */
  let top: { crumb: string; title: string; mTitle: string; mSub?: string; dBack?: { href: string } | { onClick: () => void } | null; mBack: { href: string } | { onClick: () => void } | null; add: boolean };
  const boardTitle = tx(p("Notes on children", "बच्चों के नोट्स"));
  const kidName = scope?.name ?? tx(p("One child", "एक बच्चा"));
  const kidNotes = studentId ? props.notes.filter((n) => n.studentId === studentId) : [];
  if (screen === "add") {
    const t = noteCardTop(flow.card, composer.child ?? saved?.child ?? null);
    const listening = composer.step === "listening";
    const title = listening ? tx(p("Listening…", "सुन रहे हैं…")) : tx(t.title);
    // Back leaves the note (its words are kept); while listening it only stops the mic.
    const back = { onClick: listening ? () => composer.cancelListening("add") : flow.card === "saved" ? doneSaved : closeAdd };
    top = { crumb: boardTitle, title, mTitle: title, mSub: t.sub ? tx(t.sub) : undefined, dBack: back, mBack: back, add: false };
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    const name = focus.kind === "plan" ? focus.plan.studentName : focus.note.studentName;
    const goal = focus.kind === "plan" ? focus.plan.goal : tx(p("New support plan", "नई सहायता योजना"));
    const prog = planProgressText(focus.kind === "plan" ? focus.plan.steps : null);
    const back = focus.kind === "plan" ? (focus.plan.noteId ? at(`note=${focus.plan.noteId}`) : home) : at(`note=${focus.note.id}`);
    top = { crumb: `${boardTitle} · ${tx(p("support plan", "सहायता योजना"))}`, title: `${goal} · ${name.split(" ")[0]}`, mTitle: tx(p("Support plan", "सहायता योजना")), mSub: `${name} · ${tx(prog)}`, dBack: { href: back }, mBack: { href: back }, add: false };
  } else if (screen === "student") {
    top = { crumb: `${boardTitle} · ${tx(p("one child", "एक बच्चा"))}`, title: kidName, mTitle: kidName, mSub: `${scope?.classLabel ?? ""} · ${tx(countP(kidNotes.length, "note", "notes", "नोट"))}`, dBack: { href: base }, mBack: { href: base }, add: props.viewer.canWrite };
  } else {
    top = { crumb: `${tx(p("Academics", "शैक्षणिक"))} · ${me ?? tx(day(props.today))}`, title: boardTitle, mTitle: boardTitle, mSub: tx(p(`${kpis.needsAction} need action · ${counts.followups} to follow up`, `${kpis.needsAction} पर कार्रवाई · ${counts.followups} फिर देखने हैं`)), dBack: null, mBack: { href: "/menu" }, add: props.viewer.canWrite };
  }
  if (open && screen !== "add") {
    top = { ...top, mTitle: tx(noteSubject(open.note)), mSub: `${open.note.classLabel} · ${tx(p(`note from ${open.note.writtenByName}`, `${open.note.writtenByName} का नोट`))}`, mBack: { href: home } };
  }

  /* ---------------------------------------------------------- the screens */
  const board = (
    <div className="nx-c" style={{ gap: 16, animation: "xIn .32s var(--ease) both" }}>
      {/* On the phone, a plain button at the top: the floating one sat over the
          second filter box and that filter could not be tapped (UX review 6 Nov 2026). */}
      {props.viewer.canWrite ? (
        <button type="button" className="tap btn pri only-m" onClick={openAdd} style={{ width: "100%", height: 52, fontSize: 16 }}>
          <Ic n="mic" size={22} />
          {tx(p("Add a note", "नोट लिखें"))}
        </button>
      ) : null}
      <div className="g4" style={{ display: "grid", gridTemplateColumns: `repeat(${open ? 2 : 4},minmax(0,1fr))`, gap: 12 }}>
        <KpiTile label={tx(p("Needs action", "कार्रवाई ज़रूरी"))} value={kpis.needsAction} sub={tx(p("Due now, or nobody has picked them up", "समय हो गया, या किसी ने नहीं उठाए"))} icon="flag" bg="var(--warns)" fg="var(--warnfg)" tone={kpis.needsAction ? "var(--warnfg)" : "var(--fg)"} on={tab === "action"} onPick={() => setTab("action")} delay={0} />
        {/* The tile counts what its tab lists (smoke 20 Oct: 7 on one, 4 on the other). */}
        <KpiTile label={tx(p("Follow-ups open", "फिर देखने वाले नोट"))} value={counts.followups} sub={tx(p(`${kpis.dueThisWeek} due this week · ${rangeLabel(props.today, weekEndOf(props.today))}`, `इस हफ़्ते ${kpis.dueThisWeek} · ${rangeLabel(props.today, weekEndOf(props.today))}`))} icon="calendar" bg="var(--infos)" fg="var(--info)" tone="var(--fg)" on={tab === "followups"} onPick={() => setTab("followups")} delay={28} />
        <KpiTile label={tx(p("Support plans running", "चल रही सहायता योजनाएँ"))} value={kpis.plansRunning} sub={tx(p("Steps with owners and dates", "कदम, व्यक्ति और तारीख़ के साथ"))} icon="layers" bg="var(--oks)" fg="var(--ok)" tone="var(--fg)" on={tab === "plans"} onPick={() => setTab("plans")} delay={56} />
        <KpiTile label={tx(p("Notes this month", "इस महीने के नोट्स"))} value={kpis.thisMonth} sub={tx(p(`${stats.thisWeek} this week · by ${stats.teachers} ${stats.teachers === 1 ? "teacher" : "teachers"}`, `इस हफ़्ते ${stats.thisWeek} · ${stats.teachers} ${stats.teachers === 1 ? "अध्यापक" : "अध्यापकों"} से`))} icon="notePen" bg="var(--s3)" fg="var(--pri)" tone="var(--fg)" on={tab === "all"} onPick={() => setTab("all")} delay={84} />
      </div>

      {/* Desk only: on a phone it pushed the notes themselves below the fold (UX review 6 Nov 2026). */}
      {mixTotal ? (
        <div className="card nx-f hide-m" style={{ padding: "12px 16px", gap: 14, flexWrap: "wrap", background: "var(--accs)", borderColor: "transparent" }}>
          <span className="nx-ib" style={{ background: "var(--card)", color: "var(--acc)" }}>
            <Ic n="zap" size={18} />
          </span>
          <span className="nx-c" style={{ flex: 1, minWidth: 220, gap: 6 }}>
            {insight && insight.tag ? (
              <span className="nx-b" style={{ color: "var(--accfg)" }}>
                {tx(p("Most notes this month", "इस महीने सबसे ज़्यादा नोट"))}: <b>{tx(TAG_TEXT[insight.tag])}</b>
                {insight.classId ? (
                  <>
                    {" · "}
                    <button type="button" className="tap" onClick={() => { setClassId(insight.classId!); setTab("all"); }} style={{ border: 0, padding: 0, background: "transparent", color: "var(--accfg)", font: "inherit", fontWeight: 700, textDecoration: "underline" }}>
                      {tx(p(`${insight.classLabel} has ${insight.classCount} ${insight.classCount === 1 ? "note" : "notes"}`, `${insight.classLabel} में ${insight.classCount} नोट`))}
                    </button>
                  </>
                ) : null}
              </span>
            ) : (
              <span className="nx-b" style={{ color: "var(--accfg)" }}>{tx(p("What the notes are about", "नोट्स किस बारे में हैं"))}</span>
            )}
            <span style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--card)" }}>
              {NOTE_TAGS.map((t, i) => {
                const n = mixAll.find((m) => m.tag === t)?.count ?? 0;
                return n ? <span key={t} className="nx-insight" title={`${TAG_TEXT[t].en} · ${n}`} style={{ width: `${((n / mixTotal) * 100).toFixed(1)}%`, background: MIX_COLOR[t], animationDelay: `${i * 60}ms` }} /> : null;
              })}
            </span>
            <span className="nx-f" style={{ flexWrap: "wrap", gap: "4px 12px" }}>
              {/* These counts are every note on the board, not this month's: said so, because "Notes this month: 2" beside "Studies 18" read as a contradiction (UX review 6 Nov 2026). */}
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accfg)" }}>{tx(p("All notes so far:", "अब तक के सभी नोट:"))}</span>
              {NOTE_TAGS.map((t) => (
                <span key={t} className="nx-f" style={{ gap: 5, fontSize: 11, color: "var(--accfg)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: MIX_COLOR[t] }} />
                  {tx(TAG_TEXT[t])} <b className="num">{mixAll.find((m) => m.tag === t)?.count ?? 0}</b>
                </span>
              ))}
            </span>
          </span>
        </div>
      ) : null}

      <div className="nx-f" style={{ gap: 10, flexWrap: "wrap" }}>
        <Seg<BoardTab>
          label="Board"
          className="mfull"
          style={{ width: 520, maxWidth: "100%" }}
          value={tab}
          onChange={setTab}
          options={(
            [
              ["action", p("Needs action", "कार्रवाई")],
              ["followups", p("Follow-ups", "फिर देखना")],
              ["plans", p("Support plans", "योजनाएँ")],
              ["all", p("All", "सभी")],
            ] as [BoardTab, Pair][]
          ).map(([v, l]) => ({
            value: v,
            label: (
              <>
                {tx(l)} <span className="num hide-m" style={{ fontWeight: 600, color: "var(--sub)" }}>{counts[v]}</span>
              </>
            ),
          }))}
        />
        <span className="hide-m" style={{ flex: 1 }} />
        <div className="nx-f mfull" style={{ gap: 8 }}>
          <label className="field" style={{ flex: 1 }}>
            <span className="sr">Class</span>
            <select className="inp" value={classId} onChange={(e) => setClassId(e.target.value)} style={{ height: 40, fontSize: 14, minWidth: 140 }}>
              <option value="">{tx(p("All classes", "सभी कक्षाएँ"))}</option>
              {props.classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="sr">Teacher</span>
            <select className="inp" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ height: 40, fontSize: 14, minWidth: 150 }}>
              <option value="">{tx(p("All teachers", "सभी अध्यापक"))}</option>
              {props.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div role="group" aria-label="Tag" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: -4 }}>
        {([null, ...NOTE_TAGS] as (NoteTag | null)[]).map((t) => (
          <button key={t ?? "all"} type="button" className={`tap chip${tag === t ? " on" : ""}`} aria-pressed={tag === t} onClick={() => setTag(t)}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: t ? BOARD_TAG[t].fg : "var(--bds)" }} />
            {t ? tx(TAG_TEXT[t]) : tx(p("All tags", "सभी"))}
          </button>
        ))}
      </div>

      {classId ? (
        <ClassDigest
          key={classId}
          classLabel={props.classes.find((c) => c.id === classId)?.label ?? ""}
          notes={props.notes.filter((n) => n.classId === classId)}
          today={props.today}
          onOpen={(id) => router.push(`${base}?student=${id}`)}
        />
      ) : null}

      {shown.length || orphanPlans.length ? (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: open ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 12, alignItems: "start" }}>
          {shown.map((n, i) => (
            <BoardCard key={n.id} viewerId={props.viewer.id} note={n} plan={planOf(n)} today={props.today} href={at(`note=${n.id}`)} selected={open?.note.id === n.id} delay={Math.min(i, 14) * 28} />
          ))}
          {orphanPlans.map((pl) => <PlanCard key={pl.id} plan={pl} href={at(`plan=${pl.id}`)} />)}
        </div>
      ) : (
        <div className="card nx-c" style={{ padding: "34px 24px", alignItems: "center", gap: 10, textAlign: "center", animation: "xIn .32s var(--ease) both" }}>
          <span className="nx-ib" style={{ width: 56, height: 56, borderRadius: 28, background: "var(--oks)", color: "var(--ok)", animation: "xPopIn .5s var(--spring) both" }}>
            <Ic n="check" size={26} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{filtered ? tx(p("No notes match", "कोई नोट नहीं मिला")) : tab === "action" ? tx(p("Nothing needs action", "कुछ भी बाकी नहीं")) : tx(p("No notes here", "यहाँ कोई नोट नहीं"))}</span>
          <span className="nx-m" style={{ fontSize: 13 }}>{filtered ? tx(p("Try another class, teacher or tag.", "कोई और कक्षा, अध्यापक या टैग चुनें।")) : tx(p("Every open note has someone working on it.", "हर खुले नोट पर कोई काम कर रहा है।"))}</span>
          <button type="button" className="tap btn sec" onClick={() => (filtered ? (setClassId(""), setTeacherId(""), setTag(null)) : setTab("all"))}>
            {filtered ? tx(p("Clear filters", "फ़िल्टर हटाएँ")) : tx(p("See all notes", "सभी नोट देखें"))}
          </button>
        </div>
      )}
      <span className="nx-m nx-f" style={{ padding: "0 4px", gap: 6 }}>
        <Ic n="lock" size={16} />
        {tx(p("Notes a teacher marks “Only me” stay private and are not shown here.", "जिन नोट्स को अध्यापक “सिर्फ़ मैं” रखते हैं, वे यहाँ नहीं दिखते।"))}
      </span>
    </div>
  );

  let body: React.ReactNode = board;
  if (screen === "add") {
    body = (
      <NoteCards
        board
        flow={flow}
        c={composer}
        kids={props.kids}
        notes={props.notes}
        viewer={props.viewer}
        people={people}
        today={props.today}
        school={props.school}
        base={base}
        initialClass={props.initialClass}
        savedId={saved?.id ?? null}
        onSaved={onSaved}
        undoing={undoing}
        onUndo={() => {
          if (!saved) return;
          undo(saved.id, () => {
            setSaved(null);
            flow.go("check");
            replaceParams({ saved: null });
          });
        }}
        onPlan={() => {
          if (!saved) return;
          const s = saved;
          setAdding(false);
          setSaved(null);
          composer.reset(false);
          router.push(`${base}?student=${s.child.id}&note=${s.id}&view=plan`, { scroll: false });
        }}
        onDone={doneSaved}
        onOpenAction={(href) => {
          setAdding(false);
          composer.reset(false);
          router.push(href, { scroll: false });
        }}
      />
    );
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    body = <BoardPlan plan={focus.kind === "plan" ? focus.plan : null} sourceBody={focus.kind === "plan" && focus.plan.noteId ? (props.notes.find((n) => n.id === focus.plan.noteId)?.body ?? null) : null} draftFor={focus.kind === "new-plan" ? focus.note : null} viewer={props.viewer} people={people} today={props.today} school={props.school} base={base} />;
  } else if (screen === "student" && scope) {
    body = <StudentPage scope={scope} notes={kidNotes} plans={props.plans.filter((pl) => pl.studentId === scope.studentId)} today={props.today} people={people} canWrite={props.viewer.canWrite} openId={open?.note.id ?? null} savedId={props.savedId ?? null} kidTag={kidTag} setKidTag={setKidTag} onAdd={openAdd} base={base} viewerId={props.viewer.id} />;
  }

  return (
    <VxPage label="Notes on children" className="nx">
      <NotesTop
        crumb={top.crumb}
        title={top.title}
        mTitle={top.mTitle}
        mSub={top.mSub}
        dBack={top.dBack}
        mBack={top.mBack}
        onHelp={() => setHelp(true)}
        add={top.add ? (
          <button type="button" className="tap btn pri" onClick={openAdd}>
            <Ic n="plus" size={18} />
            {tx(p("Add a note", "नोट लिखें"))}
          </button>
        ) : undefined}
      />
      <main>
        {screen === "add" ? body : (
        <div className="stack" style={{ display: "grid", gridTemplateColumns: open ? "minmax(0,1fr) 440px" : "minmax(0,1fr)", alignItems: "start" }}>
          <section className={`pad${open ? " hide-m" : ""}`} style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {body}
          </section>
          {open ? (
            <aside className="nx-aside" aria-label={tx(p("The note", "नोट"))}>
              <BoardNoteAside
                note={open.note}
                replies={open.replies}
                plan={planOf(open.note)}
                viewer={props.viewer}
                people={people}
                today={props.today}
                school={props.school}
                base={base}
                onClose={() => router.push(home, { scroll: false })}
                childHref={open.note.studentId && open.note.studentId !== studentId ? `${base}?student=${open.note.studentId}` : null}
              />
            </aside>
          ) : null}
        </div>
        )}
      </main>
      <Sheet
        open={help}
        onClose={() => setHelp(false)}
        title={tx(p("How this screen works", "यह स्क्रीन कैसे काम करती है"))}
        sub={tx(p("3 simple steps", "3 आसान कदम"))}
        footer={
          <>
            <button type="button" className="tap btn sec" onClick={() => setHelp(false)} style={{ flex: 1, height: 48 }}>{tx(p("Close", "बंद करें"))}</button>
            <button type="button" className="tap btn pri" onClick={() => setHelp(false)} style={{ flex: 1.6, height: 48 }}>
              <Ic n="check" size={18} />
              {both(p("Got it", "समझ गया"))}
            </button>
          </>
        }
      >
        <div className="nx">
          <HelpSteps steps={screen === "add" ? NOTE_CARD_HELP[flow.card] : HELP[screen]} />
        </div>
      </Sheet>
    </VxPage>
  );
}

/* ------------------------------------------------------------ one child */

function StudentPage({
  scope,
  notes,
  plans,
  today,
  people,
  canWrite,
  openId,
  savedId,
  kidTag,
  setKidTag,
  onAdd,
  base,
  viewerId,
}: {
  scope: NonNullable<NotesProps["scope"]>;
  notes: BoardNote[];
  plans: SupportPlan[];
  today: string;
  people: NonNullable<NotesProps["people"]>;
  canWrite: boolean;
  openId: string | null;
  savedId: string | null;
  kidTag: NoteTag | null;
  setKidTag: (t: NoteTag | null) => void;
  onAdd: () => void;
  base: string;
  viewerId: string;
}) {
  const { tx } = useVx();
  const words = useNoteWords(viewerId);
  const name = scope.name ?? tx(p("This child", "यह बच्चा"));
  const ct = scope.classId ? (people.classTeachers[scope.classId] ?? null) : null;
  const authors = new Set(notes.map((n) => n.writtenBy)).size;
  const openCount = notes.filter((n) => noteStage(n) === "open").length;
  const shown = notes.filter((n) => (kidTag ? n.tags.includes(kidTag) : true));
  const tagCounts = NOTE_TAGS.map((t) => [t, notes.filter((n) => n.tags.includes(t)).length] as const).filter(([, c]) => c > 0);
  const runningPlans = plans.filter((pl) => pl.status === "active" || pl.status === "draft");
  const savedNote = savedId ? notes.find((n) => n.id === savedId) : null;
  const line = [scope.classLabel, scope.sr ? `SR ${scope.sr}` : null, ct ? `${tx(p("class teacher", "कक्षा अध्यापक"))} ${ct}` : null, scope.father ? `${tx(p("father", "पिता"))} ${scope.father}` : null].filter(Boolean).join(" · ");
  const facts: { label: string; bg: string; fg: string }[] = [
    // "1 note from 1 teacher", never "1 notes from 1 teachers" (smoke 20 Oct).
    { label: tx(p(`${notes.length} ${notes.length === 1 ? "note" : "notes"} from ${authors} ${authors === 1 ? "teacher" : "teachers"}`, `${authors} ${authors === 1 ? "अध्यापक" : "अध्यापकों"} के ${notes.length} नोट`)), bg: "var(--s2)", fg: "var(--fg)" },
    ...(openCount ? [{ label: tx(p(`${openCount} open`, `${openCount} खुले`)), bg: "var(--warns)", fg: "var(--warnfg)" }] : []),
  ];
  const sideCol = openId ? "1" : "2";
  return (
    <div className="nx-c" style={{ gap: 16, animation: "xPush .36s var(--ease) both" }}>
      <div className="card nx-f" style={{ padding: "16px 18px", gap: 16, flexWrap: "wrap" }}>
        <span className="nx-ib" style={{ width: 60, height: 60, borderRadius: 30, fontSize: 20, background: "var(--accs)", color: "var(--accfg)" }}>{ini(name)}</span>
        <span className="nx-c" style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{name}</span>
          {line ? <span className="nx-m" style={{ fontSize: 13 }}>{line}</span> : null}
          <span className="nx-f" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {facts.map((f) => (
              <span key={f.label} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: f.bg, color: f.fg }}>{f.label}</span>
            ))}
          </span>
        </span>
        <span className="nx-f mfull" style={{ gap: 8, flexWrap: "wrap" }}>
          {scope.profile ? (
            <>
              <Link href={`/students/${scope.studentId}`} className="tap btn sec only-d">
                <Ic n="user" size={18} />
                Student 360
              </Link>
              <Link href={`/students/${scope.studentId}`} className="tap btn sec only-m" style={{ flex: 1 }}>
                <Ic n="user" size={18} />
                Student 360
              </Link>
            </>
          ) : null}
          {canWrite ? (
            <button type="button" className="tap btn pri" onClick={onAdd} style={{ flex: 1.3 }}>
              <Ic n="mic" size={18} />
              {tx(p("Add a note", "नोट लिखें"))}
            </button>
          ) : null}
        </span>
      </div>

      {savedNote ? (
        <div className="card nx-f" style={{ padding: "14px 16px", gap: 14, background: "var(--oks)", borderColor: "var(--okm)", animation: "xIn .4s var(--ease) both" }}>
          <svg width="48" height="48" viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
            <circle cx="48" cy="48" r="44" style={{ fill: "var(--card)" }} />
            <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 5, ["--len" as string]: 276.5, strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
            <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 60, strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
          </svg>
          <span className="nx-c">
            <span className="nx-v" style={{ color: "var(--ok)" }}>{tx(p("Saved.", "सहेजा गया।"))}</span>
            <span style={{ fontSize: 13, color: "var(--ok)" }}>
              {savedNote.visibility !== "team"
                ? tx(p("Only you can see it.", "सिर्फ़ आप देख सकते हैं।"))
                : isSensitiveNote(savedNote)
                  ? tx(p("The admin and the class teacher can see it now.", "प्रशासक और कक्षा अध्यापक अब देख सकते हैं।"))
                  : tx(p(`${ct ?? "The class teacher"} (class teacher) and the office can see it now.`, `${ct ?? "कक्षा अध्यापक"} (कक्षा अध्यापक) और कार्यालय अब देख सकते हैं।`))}
            </span>
          </span>
        </div>
      ) : null}

      <div className="stack nx-sg" style={{ display: "grid", gridTemplateColumns: openId ? "minmax(0,1fr)" : "minmax(0,1fr) 320px", gap: 16, alignItems: "start" }}>
        <div className="nx-c" style={{ gap: 12, gridColumn: sideCol, gridRow: 1 }}>
          <div className="card nx-c" style={{ padding: "14px 16px", gap: 10 }}>
            <span className="sech">{tx(p("Notes by tag", "टैग के अनुसार"))}</span>
            <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
              <button type="button" className={`tap chip${kidTag === null ? " on" : ""}`} aria-pressed={kidTag === null} onClick={() => setKidTag(null)}>
                <Ic n="list" size={14} style={{ color: kidTag === null ? undefined : "var(--mut)" }} />
                {tx(p("All", "सभी"))} <b className="num">{notes.length}</b>
              </button>
              {tagCounts.map(([t, c]) => (
                <button key={t} type="button" className={`tap chip${kidTag === t ? " on" : ""}`} aria-pressed={kidTag === t} onClick={() => setKidTag(t)}>
                  <Ic n={BOARD_TAG[t].icon} size={14} style={{ color: kidTag === t ? undefined : BOARD_TAG[t].fg }} />
                  {tx(TAG_TEXT[t])} <b className="num">{c}</b>
                </button>
              ))}
            </div>
          </div>
          {runningPlans.map((pl) => {
            const prog = planProgress(pl.steps);
            const next = pl.steps.find((s) => !s.done);
            return (
              <Link key={pl.id} href={`${base}?plan=${pl.id}`} scroll={false} className="tap card nx-c" style={{ padding: "14px 16px", gap: 8, textAlign: "left", color: "var(--fg)", width: "100%" }}>
                <span className="nx-f" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span className="sech">{tx(p("Support plan", "सहायता योजना"))}</span>
                  <span className="pill" style={{ background: "var(--oks)", color: "var(--ok)" }}>{tx(p("Running", "चल रही है"))}</span>
                </span>
                <span className="nx-v">{pl.goal}</span>
                <span className="nx-m">
                  {pl.createdByName} · {next ? `${tx(p("next", "अगला"))}: ${tx(knownPair(next.body))}${next.whenLabel ? ` · ${next.whenLabel}` : ""}` : tx(p("all steps done", "सारे कदम पूरे"))}
                </span>
                <span style={{ display: "block", height: 8, borderRadius: 4, background: "var(--s3)", overflow: "hidden", width: "100%" }}>
                  <span style={{ display: "block", height: 8, borderRadius: 4, width: `${prog.total ? Math.round((prog.done / prog.total) * 100) : 0}%`, background: "var(--ok)", transformOrigin: "left", animation: "xGrowX .7s var(--ease) both" }} />
                </span>
                <span className="nx-f nx-m" style={{ justifyContent: "space-between", width: "100%" }}>
                  <span className="num">{tx(p(`${prog.done} of ${prog.total} steps done`, `${prog.total} में से ${prog.done} कदम पूरे`))}</span>
                  <span className="nx-f" style={{ gap: 2, color: "var(--acc)", fontWeight: 700 }}>
                    {tx(p("Open plan", "योजना खोलें"))}
                    <Ic n="chevRight" size={16} />
                  </span>
                </span>
              </Link>
            );
          })}
          <span className="nx-m hide-m" style={{ lineHeight: 1.5, padding: "0 4px" }}>
            {tx(p("A subject teacher’s note reaches the class teacher by itself. Health and family notes stay with the admin and the class teacher; “Only me” notes stay with whoever wrote them.", "विषय अध्यापक का नोट कक्षा अध्यापक तक अपने-आप पहुँचता है। स्वास्थ्य और परिवार के नोट प्रशासक और कक्षा अध्यापक तक रहते हैं; “सिर्फ़ मैं” नोट लिखने वाले तक।"))}
          </span>
        </div>

        <div className="nx-c" style={{ gap: 10, gridColumn: "1", gridRow: 1 }}>
          <span className="sech" style={{ padding: "0 4px" }}>{tx(p(`${shown.length} ${shown.length === 1 ? "note" : "notes"} · newest first`, `${shown.length} नोट · नए पहले`))}</span>
          {shown.length ? (
            <div className="nx-tlw">
              {shown.map((n, i) => {
                const look = BOARD_TAG[n.tags[0] ?? "studies"];
                const rel = relationText(n.authorRelation);
                const stage = noteStage(n);
                const who = words.who(n);
                const sel = n.id === openId;
                return (
                  <div key={n.id} className="nx-tli" style={{ animation: n.id === savedId ? "xRise .5s var(--ease) both" : "xIn .32s var(--ease) both", animationDelay: `${Math.min(i, 14) * 28}ms` }}>
                    <span className="nx-ib" style={{ width: 36, height: 36, borderRadius: 18, background: look.bg, color: look.fg, boxShadow: "0 0 0 4px var(--bg)" }}>
                      <Ic n={look.icon} size={16} />
                    </span>
                    <Link href={`${base}?student=${scope.studentId}&note=${n.id}`} scroll={false} className="tap card nx-nc" aria-current={sel ? "true" : undefined} style={{ borderColor: sel ? "var(--acc)" : n.id === savedId ? "var(--okm)" : "var(--bd)", background: sel ? "var(--accs)" : "var(--card)", animation: "none" }}>
                      <span className="nx-f" style={{ justifyContent: "space-between", width: "100%", gap: 10 }}>
                        <span className="nx-c">
                          <span className="nx-b">{n.writtenByName}{rel ? ` · ${tx(rel)}` : ""}</span>
                          <span className="nx-m num">{tx(noteWhen(n.createdAt, today))}</span>
                        </span>
                        <StagePill stage={stage} />
                      </span>
                      <span style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{n.body}</span>
                      <span className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                        {n.tags.map((t) => (
                          <span key={t} className="pill" style={{ background: BOARD_TAG[t].bg, color: BOARD_TAG[t].fg }}>
                            <Ic n={BOARD_TAG[t].icon} size={12} />
                            {tx(TAG_TEXT[t])}
                          </span>
                        ))}
                        {n.needsFollowUp && n.followUpOn && stage !== "done" && stage !== "noting" ? (
                          <span className="pill" style={{ background: "var(--s2)", color: followSoon(n, today) ? "var(--bad)" : "var(--mut)" }}>
                            {tx(p(day(n.followUpOn), shortDayHi(n.followUpOn)))}
                            {who ? ` · ${who}` : ""}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card nx-c" style={{ padding: "34px 24px", alignItems: "center", gap: 10, textAlign: "center" }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("No notes on this child yet", "इस बच्चे पर अभी कोई नोट नहीं"))}</span>
              <span className="nx-m" style={{ fontSize: 13 }}>{tx(p("Notes from every teacher of this child appear here, newest first.", "इस बच्चे के हर अध्यापक के नोट यहाँ दिखते हैं, नए पहले।"))}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
