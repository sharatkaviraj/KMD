"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import { undoNoteAction } from "../actions";
import type { SupportPlan } from "../data";
import {
  boardKpis,
  filterBoard,
  isSensitiveNote,
  monthInsight,
  monthStats,
  noteStage,
  NOTE_TAGS,
  planProgress,
  TAG_TEXT,
  tagMix,
  weekEndOf,
  type BoardNote,
  type BoardTab,
  type NoteTag,
} from "../domain/notes";
import { BoardCompose, useComposer } from "./compose";
import { BoardNoteAside } from "./detail";
import { BOARD_TAG, followSoon, HelpSteps, ini, MIX_COLOR, NotesTop, noteWhen, ownerRoleText, relationText, replaceParams, Seg, StagePill, useBoth, type HelpStep } from "./look";
import { BoardPlan } from "./plan";
import type { NotesProps } from "./workspace";

/*
 * The notes board for the office and the coordinator (design `Notes`, and
 * `AD-Notes` for the academic menu): what needs action, follow-ups, support
 * plans, every note; one note beside the board; one child's page; adding a
 * note; a support plan. Every state is a URL.
 */

const HELP: Record<"board" | "student" | "add" | "plan", HelpStep[]> = {
  board: [
    { icon: "list", title: p("Pick a note", "नोट चुनें"), body: p("Read it and the replies.", "उसे और जवाब पढ़ें।") },
    { icon: "users", title: p("Give it to someone", "किसी को सौंपें"), body: p("Change the status or who follows up.", "स्थिति या फ़ॉलो-अप करने वाले को बदलें।") },
    { icon: "layers", title: p("Make a plan", "योजना बनाएँ"), body: p("Steps with owners and dates.", "कदम, हर एक के साथ व्यक्ति और तारीख़।") },
  ],
  student: [
    { icon: "clock", title: p("Whole story", "पूरी कहानी"), body: p("All teachers’ notes, newest first.", "सब अध्यापकों के नोट, नए पहले।") },
    { icon: "tag", title: p("Filter", "छाँटें"), body: p("Tap a tag to see only those.", "सिर्फ़ वही देखने के लिए टैग दबाएँ।") },
    { icon: "mic", title: p("Add a note", "नोट लिखें"), body: p("The class teacher sees it too.", "कक्षा अध्यापक भी देखेंगे।") },
  ],
  add: [
    { icon: "mic", title: p("Tap and speak", "बोलकर लिखें"), body: p("Hindi or English, words appear live.", "हिंदी या अंग्रेज़ी, शब्द साथ-साथ दिखते हैं।") },
    { icon: "edit", title: p("Check the words", "शब्द जाँचें"), body: p("Add tags and a follow-up.", "टैग और फ़ॉलो-अप जोड़ें।") },
    { icon: "check", title: p("Save", "सहेजें"), body: p("Teacher and office see it at once.", "अध्यापक और कार्यालय तुरंत देखते हैं।") },
  ],
  plan: [
    { icon: "check", title: p("Tick steps", "कदम पूरे करें"), body: p("The ring moves by itself.", "घेरा अपने-आप बढ़ता है।") },
    { icon: "plus", title: p("Add a step", "कदम जोड़ें"), body: p("It gets an owner and a date.", "हर कदम को व्यक्ति और तारीख़ मिलती है।") },
    { icon: "send", title: p("Tell parents", "अभिभावक को बताएँ"), body: p("Hindi first, cost shown first.", "पहले हिंदी, पहले लागत।") },
  ],
};

/** "Thu 8 – Sun 11 Oct". */
function rangeLabel(from: string, to: string): string {
  const a = shortDay(from).replace(/,/g, "").split(" ");
  const b = shortDay(to).replace(/,/g, "");
  return from.slice(0, 7) === to.slice(0, 7) && a.length === 3 ? `${a[0]} ${a[1]} – ${b}` : `${shortDay(from)} – ${b}`;
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
function BoardCard({ note, plan, today, href, selected, delay }: { note: BoardNote; plan: SupportPlan | null; today: string; href: string; selected: boolean; delay: number }) {
  const { tx } = useVx();
  const look = BOARD_TAG[note.tags[0] ?? "studies"];
  const stage = noteStage(note);
  const rel = relationText(note.authorRelation);
  const hasFollow = note.needsFollowUp && note.followUpOn && stage !== "done" && stage !== "noting";
  const role = ownerRoleText(note.followUpOwner);
  const prog = plan ? planProgress(plan.steps) : null;
  return (
    <Link href={href} scroll={false} className="tap card nx-nc" aria-current={selected ? "true" : undefined} style={{ borderColor: selected ? "var(--acc)" : "var(--bd)", background: selected ? "var(--accs)" : "var(--card)", animationDelay: `${delay}ms` }}>
      <span className="nx-f" style={{ gap: 10, width: "100%" }}>
        <span className="nx-ib" style={{ borderRadius: 19, background: look.bg, color: look.fg }}>{ini(note.studentName)}</span>
        <span className="nx-c" style={{ flex: 1 }}>
          <span className="nx-b nx-e" style={{ fontSize: 15 }}>{note.studentName}</span>
          <span className="nx-m nx-e">{[note.classLabel, note.writtenByName, rel ? tx(rel) : null].filter(Boolean).join(" · ")}</span>
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
            {shortDay(note.followUpOn!)}
            {role ? ` · ${tx(role)}` : ""}
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
        <span className="nx-m num">{noteWhen(note.createdAt, today)}</span>
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
  const { tx } = useVx();
  const both = useBoth();
  const router = useRouter();
  const toast = useToast();
  const base = "/notes";
  const people = props.people ?? { classTeachers: {}, coordinator: null, admin: null };
  const scope = props.scope ?? null;
  const studentId = scope?.studentId ?? null;
  const home = studentId ? `${base}?student=${studentId}` : base;
  const at = (param: string) => (studentId ? `${base}?student=${studentId}&${param}` : `${base}?${param}`);
  const [adding, setAdding] = useState(props.initialSheet === "add");
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
    lang: "en-IN",
    ownerFor: (child) => (child && props.viewer.heldClassIds.includes(child.classId) ? "me" : "class_teacher"),
  });

  const openAdd = () => {
    if (scope && props.kids.some((k) => k.id === scope.studentId)) composer.pickChild(scope.studentId);
    else if (open?.note.studentId && props.kids.some((k) => k.id === open.note.studentId)) composer.pickChild(open.note.studentId);
    setAdding(true);
    replaceParams({ sheet: "add" });
  };
  const closeAdd = () => {
    if (composer.speech.listening) composer.speech.stop();
    setAdding(false);
    replaceParams({ sheet: null, step: null });
  };
  const setTab = (t: BoardTab) => {
    setTabState(t);
    replaceParams({ tab: t === "action" ? null : t, note: null });
    if (open) router.push(t === "action" ? base : `${base}?tab=${t}`, { scroll: false });
  };

  const saved = (id: string, child: { id: string; name: string }) => {
    setAdding(false);
    composer.reset(false);
    router.push(`${base}?student=${child.id}&saved=${id}`, { scroll: false });
    toast.show({
      text: tx(p(`Note saved for ${child.name.split(" ")[0]}`, `${child.name.split(" ")[0]} के लिए नोट सहेजा`)),
      undo: async () => {
        const res = await undoNoteAction(id);
        if (res.ok) {
          toast.show({ text: tx(p("Note taken back — nothing was saved", "नोट वापस लिया — कुछ नहीं सहेजा गया")) });
          router.push(`${base}?student=${child.id}`, { scroll: false });
          router.refresh();
        } else toast.show({ text: tx(res.error), tone: "bad" });
      },
    });
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
    const c = composer.child;
    top = { crumb: boardTitle, title: tx(p("Add a note", "नोट लिखें")), mTitle: tx(p("Add a note", "नोट लिखें")), mSub: c ? `${c.name} · ${c.classLabel}` : undefined, dBack: { onClick: closeAdd }, mBack: { onClick: closeAdd }, add: false };
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    const name = focus.kind === "plan" ? focus.plan.studentName : focus.note.studentName;
    const goal = focus.kind === "plan" ? focus.plan.goal : tx(p("New support plan", "नई सहायता योजना"));
    const prog = focus.kind === "plan" ? planProgress(focus.plan.steps) : { done: 0, total: 0 };
    const back = focus.kind === "plan" ? (focus.plan.noteId ? at(`note=${focus.plan.noteId}`) : home) : at(`note=${focus.note.id}`);
    top = { crumb: `${boardTitle} · ${tx(p("support plan", "सहायता योजना"))}`, title: `${goal} · ${name.split(" ")[0]}`, mTitle: tx(p("Support plan", "सहायता योजना")), mSub: `${name} · ${tx(p(`${prog.done} of ${prog.total} done`, `${prog.total} में से ${prog.done} पूरे`))}`, dBack: { href: back }, mBack: { href: back }, add: false };
  } else if (screen === "student") {
    top = { crumb: `${boardTitle} · ${tx(p("one child", "एक बच्चा"))}`, title: kidName, mTitle: kidName, mSub: `${scope?.classLabel ?? ""} · ${tx(p(`${kidNotes.length} notes`, `${kidNotes.length} नोट्स`))}`, dBack: { href: base }, mBack: { href: base }, add: props.viewer.canWrite };
  } else {
    top = { crumb: `${tx(p("Academics", "शैक्षणिक"))} · ${me ?? shortDay(props.today)}`, title: boardTitle, mTitle: boardTitle, mSub: tx(p(`${kpis.needsAction} need action · ${kpis.dueThisWeek} follow-ups this week`, `${kpis.needsAction} पर कार्रवाई · इस हफ़्ते ${kpis.dueThisWeek} फ़ॉलो-अप`)), dBack: null, mBack: { href: "/menu" }, add: props.viewer.canWrite };
  }
  if (open && screen !== "add") {
    top = { ...top, mTitle: open.note.studentName, mSub: `${open.note.classLabel} · ${tx(p(`note from ${open.note.writtenByName}`, `${open.note.writtenByName} का नोट`))}`, mBack: { href: home } };
  }

  /* ---------------------------------------------------------- the screens */
  const board = (
    <div className="nx-c" style={{ gap: 16, animation: "xIn .32s var(--ease) both" }}>
      <div className="g4" style={{ display: "grid", gridTemplateColumns: `repeat(${open ? 2 : 4},minmax(0,1fr))`, gap: 12 }}>
        <KpiTile label={tx(p("Needs action", "कार्रवाई ज़रूरी"))} value={kpis.needsAction} sub={tx(p("Open, nobody has picked them up", "खुले, किसी ने नहीं उठाए"))} icon="flag" bg="var(--warns)" fg="var(--warnfg)" tone={kpis.needsAction ? "var(--warnfg)" : "var(--fg)"} on={tab === "action"} onPick={() => setTab("action")} delay={0} />
        <KpiTile label={tx(p("Follow-ups due this week", "इस हफ़्ते फ़ॉलो-अप"))} value={kpis.dueThisWeek} sub={rangeLabel(props.today, weekEndOf(props.today))} icon="calendar" bg="var(--infos)" fg="var(--info)" tone="var(--fg)" on={tab === "followups"} onPick={() => setTab("followups")} delay={28} />
        <KpiTile label={tx(p("Support plans running", "चल रही सहायता योजनाएँ"))} value={kpis.plansRunning} sub={tx(p("Steps with owners and dates", "कदम, व्यक्ति और तारीख़ के साथ"))} icon="layers" bg="var(--oks)" fg="var(--ok)" tone="var(--fg)" on={tab === "plans"} onPick={() => setTab("plans")} delay={56} />
        <KpiTile label={tx(p("Notes this month", "इस महीने के नोट्स"))} value={kpis.thisMonth} sub={tx(p(`${stats.thisWeek} this week · by ${stats.teachers} teachers`, `इस हफ़्ते ${stats.thisWeek} · ${stats.teachers} अध्यापकों से`))} icon="notePen" bg="var(--s3)" fg="var(--pri)" tone="var(--fg)" on={tab === "all"} onPick={() => setTab("all")} delay={84} />
      </div>

      {mixTotal ? (
        <div className="card nx-f" style={{ padding: "12px 16px", gap: 14, flexWrap: "wrap", background: "var(--accs)", borderColor: "transparent" }}>
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
                      {tx(p(`${insight.classLabel} has ${insight.classCount} notes`, `${insight.classLabel} में ${insight.classCount} नोट`))}
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
              ["followups", p("Follow-ups", "फ़ॉलो-अप")],
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
      <div className="hs" role="group" aria-label="Tag" style={{ display: "flex", gap: 6, marginTop: -4 }}>
        {([null, ...NOTE_TAGS] as (NoteTag | null)[]).map((t) => (
          <button key={t ?? "all"} type="button" className={`tap chip${tag === t ? " on" : ""}`} aria-pressed={tag === t} onClick={() => setTag(t)}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: t ? BOARD_TAG[t].fg : "var(--bds)" }} />
            {t ? tx(TAG_TEXT[t]) : tx(p("All tags", "सभी"))}
          </button>
        ))}
      </div>

      {shown.length || orphanPlans.length ? (
        <div className="g2" style={{ display: "grid", gridTemplateColumns: open ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 12, alignItems: "start" }}>
          {shown.map((n, i) => (
            <BoardCard key={n.id} note={n} plan={planOf(n)} today={props.today} href={at(`note=${n.id}`)} selected={open?.note.id === n.id} delay={Math.min(i, 14) * 28} />
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
      {props.viewer.canWrite ? (
        <div className="only-m nx-fabrow">
          <button type="button" className="tap btn pri nx-fab" onClick={openAdd}>
            <Ic n="mic" size={22} />
            {tx(p("Add a note", "नोट लिखें"))}
          </button>
        </div>
      ) : null}
    </div>
  );

  let body: React.ReactNode = board;
  if (screen === "add") {
    body = <BoardCompose c={composer} kids={props.kids} notes={props.notes} viewer={props.viewer} people={people} today={props.today} school={props.school} base={base} onSaved={saved} />;
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    body = <BoardPlan plan={focus.kind === "plan" ? focus.plan : null} draftFor={focus.kind === "new-plan" ? focus.note : null} viewer={props.viewer} people={people} today={props.today} school={props.school} base={base} />;
  } else if (screen === "student" && scope) {
    body = <StudentPage scope={scope} notes={kidNotes} plans={props.plans.filter((pl) => pl.studentId === scope.studentId)} today={props.today} people={people} canWrite={props.viewer.canWrite} openId={open?.note.id ?? null} savedId={props.savedId ?? null} kidTag={kidTag} setKidTag={setKidTag} onAdd={openAdd} base={base} />;
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
        <div className="stack" style={{ display: "grid", gridTemplateColumns: open && screen !== "add" ? "minmax(0,1fr) 440px" : "minmax(0,1fr)", alignItems: "start" }}>
          <section className={`pad${open && screen !== "add" ? " hide-m" : ""}`} style={{ padding: "22px 28px 40px", display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {body}
          </section>
          {open && screen !== "add" ? (
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
          <HelpSteps steps={HELP[screen]} />
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
}) {
  const { tx } = useVx();
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
    { label: tx(p(`${notes.length} notes from ${authors} teachers`, `${authors} अध्यापकों के ${notes.length} नोट`)), bg: "var(--s2)", fg: "var(--fg)" },
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
                  {pl.createdByName} · {next ? tx(p(`next: ${next.body.charAt(0).toLowerCase()}${next.body.slice(1)}${next.whenLabel ? ` · ${next.whenLabel}` : ""}`, `अगला: ${next.body}`)) : tx(p("all steps done", "सारे कदम पूरे"))}
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
                const role = ownerRoleText(n.followUpOwner);
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
                          <span className="nx-m num">{noteWhen(n.createdAt, today)}</span>
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
                            {shortDay(n.followUpOn)}
                            {role ? ` · ${tx(role)}` : ""}
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
