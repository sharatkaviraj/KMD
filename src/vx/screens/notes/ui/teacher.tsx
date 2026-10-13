"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";
import { VxPage } from "@/vx/ui/page";

import type { ChildChoice } from "../data";
import { followUpDate, myCounts, noteStage, NOTE_TAGS, planProgress, TAG_TEXT, type BoardNote, type NoteTag } from "../domain/notes";
import { followDates, TeachCompose, TeachListening, TeachSaved, useComposer, useUndo } from "./compose";
import { TeachNoteDetail } from "./detail";
import { HelpSteps, ini, nameTone, NotesTop, ownerRoleText, replaceParams, Seg, StagePill, TEACH_TAG, useBoth, type HelpStep } from "./look";
import { TeachPlan } from "./plan";
import type { NotesProps } from "./workspace";

/*
 * The teacher's notes (design `TchNotes`): her notes in three groups —
 * follow-ups due, open, the rest — and, each on a page of its own, a new
 * note (speak or type), listening, saved, one note, and a support plan.
 */

type Screen = "list" | "add" | "listening" | "saved" | "detail" | "plan";

const HELP: Record<Screen, HelpStep[]> = {
  list: [
    { icon: "bell", title: p("Follow-ups first", "पहले फ़ॉलो-अप"), body: p("Notes you must act on soon are on top. Then open notes, then the rest.", "जिन पर जल्द काम करना है वे ऊपर हैं। फिर खुले नोट, फिर बाकी।") },
    { icon: "filter", title: p("Filter", "छाँटें"), body: p("Tap a tag or a class to see only those notes.", "सिर्फ़ वही नोट देखने के लिए टैग या कक्षा दबाएँ।") },
    { icon: "mic", title: p("Speak a note", "बोलकर नोट"), body: p("Tap the big “Speak a note” button and just talk.", "बड़ा “बोलकर लिखें” बटन दबाएँ और बोलें।") },
  ],
  add: [
    { icon: "user", title: p("Pick the child", "बच्चा चुनें"), body: p("Tap a recent name, or pick the class and search.", "हाल का नाम दबाएँ, या कक्षा चुनकर खोजें।") },
    { icon: "mic", title: p("Speak or type", "बोलें या लिखें"), body: p("Tap the mic and talk in Hindi or English. Or tap “Type instead”.", "माइक दबाकर हिंदी या अंग्रेज़ी में बोलें। या “लिखकर” दबाएँ।") },
    { icon: "check", title: p("Choose and save", "चुनें और सहेजें"), body: p("Tags, follow-up day and who can see it are already filled. Change anything, then Save.", "टैग, फ़ॉलो-अप और कौन देखेगा पहले से भरे हैं। कुछ भी बदलें, फिर सहेजें।") },
  ],
  listening: [
    { icon: "mic", title: p("Just talk", "बस बोलें"), body: p("Speak normally. Your words appear as you speak.", "सामान्य बोलें। शब्द साथ-साथ दिखते हैं।") },
    { icon: "globe", title: p("Change language", "भाषा बदलें"), body: p("Tap हिंदी or English.", "हिंदी या English दबाएँ।") },
    { icon: "check", title: p("Tap Done", "हो गया दबाएँ"), body: p("You can fix any word before saving.", "सहेजने से पहले कोई भी शब्द ठीक कर सकते हैं।") },
  ],
  saved: [
    { icon: "check", title: p("Saved", "सहेजा गया"), body: p("Your note is safe. You can see who can read it.", "आपका नोट सुरक्षित है। कौन पढ़ सकता है, दिखता है।") },
    { icon: "undo", title: p("Changed your mind?", "मन बदला?"), body: p("Tap Undo to take it back.", "वापस लेने के लिए वापस लें दबाएँ।") },
    { icon: "layers", title: p("Make a plan", "योजना बनाएँ"), body: p("A support plan turns the note into small steps.", "सहायता योजना नोट को छोटे कदमों में बदलती है।") },
  ],
  detail: [
    { icon: "activity", title: p("Update the status", "स्थिति बदलें"), body: p("Tap Open, Working on it or Done.", "खुला, काम चल रहा या पूरा दबाएँ।") },
    { icon: "message", title: p("Reply", "जवाब दें"), body: p("Type or speak a reply. Everyone on this note sees it.", "जवाब लिखें या बोलें। इस नोट वाले सब देखते हैं।") },
    { icon: "layers", title: p("Support plan", "सहायता योजना"), body: p("Small steps, each with a person and a date.", "छोटे कदम, हर एक के साथ व्यक्ति और तारीख़।") },
  ],
  plan: [
    { icon: "plus", title: p("Add steps", "कदम जोड़ें"), body: p("Tap a suggestion or write your own. 3 to 5 steps work best.", "सुझाव दबाएँ या अपना लिखें। 3 से 5 कदम ठीक रहते हैं।") },
    { icon: "user", title: p("Who and when", "कौन और कब"), body: p("Tap the person or the date on a new step to change it.", "नए कदम पर व्यक्ति या तारीख़ दबाकर बदलें।") },
    { icon: "message", title: p("Tell parents", "माता-पिता को बताएँ"), body: p("Turn it on to queue the plan in Hindi and English.", "योजना हिंदी और अंग्रेज़ी में भेजने के लिए चालू करें।") },
  ],
};

/** "Due tomorrow · Fri 9 Oct", "Due Monday · Mon 12 Oct", "2 days late". */
function dueBig(on: string, today: string): Pair {
  const diff = Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff < 0) return p(`${-diff} ${diff === -1 ? "day" : "days"} late · ${shortDay(on)}`, `${-diff} दिन देर · ${shortDay(on)}`);
  if (diff === 0) return p(`Due today · ${shortDay(on)}`, `आज · ${shortDay(on)}`);
  if (diff === 1) return p(`Due tomorrow · ${shortDay(on)}`, `कल · ${shortDay(on)}`);
  if (on === followUpDate("next_monday", today)) return p(`Due Monday · ${shortDay(on)}`, `सोमवार · ${shortDay(on)}`);
  return p(`Due ${shortDay(on)}`, shortDay(on));
}

function TeachCard({ note, viewerId, today, href, due, ct, delay }: { note: BoardNote; viewerId: string; today: string; href: string; due: boolean; ct: string | null; delay: number }) {
  const { tx } = useVx();
  const look = TEACH_TAG[note.tags[0] ?? "studies"];
  const [abg, afg] = nameTone(note.studentName);
  const stage = noteStage(note);
  const mine = note.writtenBy === viewerId;
  const open = stage === "open" || stage === "working";
  const role = ownerRoleText(note.followUpOwner);
  const sub = [
    note.classLabel,
    mine ? tx(p("you", "आप")) : `${note.writtenByName}${note.authorRelation === "subject_teacher" ? `, ${tx(p("subject teacher", "विषय अध्यापक"))}` : note.authorRelation === "class_teacher" ? `, ${tx(p("class teacher", "कक्षा अध्यापक"))}` : ""}`,
    shortDay(note.createdAt),
    mine && note.authorRelation === "subject_teacher" && ct && note.visibility === "team" ? tx(p(`sent to ${ct}`, `${ct} को भेजा`)) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={href} scroll={false} className="tap card lift nx-c nt-ani" style={{ width: "100%", padding: "14px 16px", gap: 10, textAlign: "left", color: "var(--fg)", borderLeft: `4px solid ${look.fg}`, background: "var(--card)", animationDelay: `${delay}ms` }}>
      {due && note.followUpOn ? (
        <span className="nx-f" style={{ gap: 6, fontSize: 13, fontWeight: 700, color: "var(--warnfg)" }}>
          <Ic n="bell" size={16} />
          {tx(dueBig(note.followUpOn, today))}
        </span>
      ) : null}
      <span className="nx-f" style={{ gap: 10, width: "100%" }}>
        <span className="nt-av" style={{ width: 40, height: 40, fontSize: 13, background: abg, color: afg }}>{ini(note.studentName)}</span>
        <span className="nx-c" style={{ flex: 1 }}>
          <span className="nx-e nt-f15" style={{ fontSize: 15, fontWeight: 700 }}>{note.studentName}</span>
          <span className="nx-e" style={{ fontSize: 12, color: "var(--mut)" }}>{sub}</span>
        </span>
        <StagePill stage={stage} style={stage === "noting" ? { background: "var(--s3)" } : undefined} />
      </span>
      <span className="nt-f14" style={{ fontSize: 14, lineHeight: 1.5 }}>{note.body}</span>
      <span className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
        {note.tags.map((t) => (
          <span key={t} className="pill" style={{ background: TEACH_TAG[t].bg, color: TEACH_TAG[t].fg }}>
            <Ic n={TEACH_TAG[t].icon} size={12} />
            {tx(TAG_TEXT[t])}
          </span>
        ))}
        {note.needsFollowUp && note.followUpOn && open && !due ? (
          <span className="pill" style={{ background: "var(--s2)", color: "var(--mut)" }}>
            <Ic n="calendar" size={12} />
            {tx(p(`Follow up ${shortDay(note.followUpOn)}`, `फ़ॉलो-अप ${shortDay(note.followUpOn)}`))}
            {role ? ` · ${tx(role)}` : ""}
          </span>
        ) : null}
        {note.visibility === "private" ? (
          <span className="pill" style={{ background: "var(--s2)", color: "var(--mut)" }}>
            <Ic n="eyeOff" size={12} />
            {tx(p("Only me", "सिर्फ़ मैं"))}
          </span>
        ) : null}
        {note.replies ? (
          <span className="pill" style={{ background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="message" size={12} />
            {tx(p(`${note.replies} ${note.replies === 1 ? "reply" : "replies"}`, `${note.replies} जवाब`))}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** TchNotes: the notes I wrote or must follow up, in three groups. */
export function TeachNotes(props: NotesProps) {
  const { tx, sub } = useVx();
  const both = useBoth();
  const router = useRouter();
  const base = "/teach/notes";
  const people = props.people ?? { classTeachers: {}, coordinator: null, admin: null };
  const [adding, setAdding] = useState(props.initialSheet === "add");
  const [savedId, setSavedId] = useState<string | null>(props.initialSheet === "add" && props.initialStep === "saved" ? (props.savedId ?? null) : null);
  const [help, setHelp] = useState(false);
  const [ftag, setFtag] = useState<NoteTag | "all">("all");
  const [fcls, setFcls] = useState<string>("all");
  const focus = props.focus;

  const composer = useComposer({
    kids: props.kids,
    notes: props.notes,
    viewer: props.viewer,
    initialStudent: props.initialStudent,
    initialStep: props.initialStep,
    lang: "hi-IN",
    ownerFor: (child: ChildChoice | null) => (!child || props.viewer.heldClassIds.includes(child.classId) ? "me" : "class_teacher"),
  });
  const { undo, pending: undoing } = useUndo();

  const screen: Screen = adding ? (savedId ? "saved" : composer.step === "listening" ? "listening" : "add") : focus?.kind === "note" ? "detail" : focus?.kind === "plan" || focus?.kind === "new-plan" ? "plan" : "list";

  const openAdd = () => {
    composer.reset(false);
    setSavedId(null);
    setAdding(true);
    replaceParams({ sheet: "add", step: null, saved: null });
  };
  const closeAdd = () => {
    if (composer.speech.listening) composer.speech.stop();
    setAdding(false);
    setSavedId(null);
    composer.reset(false);
    replaceParams({ sheet: null, step: null, saved: null, student: null });
  };
  const onSaved = (id: string) => {
    setSavedId(id);
    replaceParams({ step: "saved", saved: id });
    router.refresh();
  };

  const mine = props.notes.filter((n) => n.writtenBy === props.viewer.id || n.followUpStaffId === props.viewer.id);
  const counts = myCounts(mine, props.today);
  const isDue = (n: BoardNote) => n.status !== "done" && n.needsFollowUp && (n.followUpStaffId === props.viewer.id || (n.followUpOwner === "me" && n.writtenBy === props.viewer.id));
  const shownN = mine.filter((n) => (ftag === "all" || n.tags.includes(ftag)) && (fcls === "all" || n.classId === fcls));
  const due = shownN.filter(isDue).sort((a, b) => (a.followUpOn ?? "9").localeCompare(b.followUpOn ?? "9"));
  const opn = shownN.filter((n) => !isDue(n) && (noteStage(n) === "open" || noteStage(n) === "working"));
  const rest = shownN.filter((n) => noteStage(n) === "done" || noteStage(n) === "noting");
  const classes = [...new Map([...props.kids.map((k) => [k.classId, k.classLabel] as const), ...mine.filter((n) => n.classId).map((n) => [n.classId!, n.classLabel] as const)]).entries()];
  const secs: { key: string; title: Pair; icon: IconName; c: string; notes: BoardNote[] }[] = [
    { key: "due", title: p("Follow-ups due", "ध्यान देना है"), icon: "bell" as IconName, c: "var(--warnfg)", notes: due },
    { key: "open", title: p("Open notes", "खुले नोट्स"), icon: "notePen" as IconName, c: "var(--mut)", notes: opn },
    { key: "rest", title: p("All my notes", "बाकी नोट्स"), icon: "archive" as IconName, c: "var(--mut)", notes: rest },
  ].filter((g) => g.notes.length);

  /* ---------------------------------------------------------- the header */
  const kidLine = composer.child ? `${composer.child.name} · ${composer.child.classLabel}` : tx(p("Pick a child", "बच्चा चुनें"));
  let top: { crumb: string; title: string; mTitle: string; mSub?: string; back: { href: string } | { onClick: () => void } | null };
  const savedNote = savedId ? (props.notes.find((n) => n.id === savedId) ?? null) : null;
  if (screen === "add") {
    const rev = composer.voice && composer.body.trim().length > 0;
    const t = rev ? tx(p("Check and save", "जाँचें और सहेजें")) : tx(p("New note", "नया नोट"));
    top = { crumb: tx(p("Notes › New note", "नोट्स › नया नोट")), title: t, mTitle: t, mSub: kidLine, back: { onClick: closeAdd } };
  } else if (screen === "listening") {
    top = { crumb: tx(p("Notes › New note", "नोट्स › नया नोट")), title: tx(p("Listening…", "सुन रहे हैं…")), mTitle: tx(p("Listening…", "सुन रहे हैं…")), mSub: both(p("Speak now", "बोलिए")), back: { onClick: () => composer.cancelListening(composer.body ? "review" : "add") } };
  } else if (screen === "saved") {
    top = { crumb: tx(p("Notes › Saved", "नोट्स › सहेजा")), title: tx(p("Note saved", "नोट सहेजा गया")), mTitle: tx(p("Note saved", "नोट सहेजा गया")), mSub: composer.child?.name ?? savedNote?.studentName, back: { onClick: closeAdd } };
  } else if (screen === "detail" && focus?.kind === "note") {
    const n = focus.note;
    top = { crumb: `${tx(p("Notes", "नोट्स"))} › ${n.studentName}`, title: `${n.studentName} · ${tx(p("note", "नोट"))}`, mTitle: n.studentName, mSub: `${n.classLabel} · ${tx({ open: p("Open", "खुला"), working: p("Working on it", "काम चल रहा"), done: p("Done", "पूरा"), noting: p("Just noting", "सिर्फ़ नोट") }[noteStage(n)])}`, back: { href: base } };
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    const name = focus.kind === "plan" ? focus.plan.studentName : focus.note.studentName;
    const prog = focus.kind === "plan" ? planProgress(focus.plan.steps) : { done: 0, total: 0 };
    const noteId = focus.kind === "plan" ? focus.plan.noteId : focus.note.id;
    top = { crumb: `${tx(p("Notes", "नोट्स"))} › ${name} › ${tx(p("Support plan", "सहायता योजना"))}`, title: `${tx(p("Support plan", "सहायता योजना"))} · ${name}`, mTitle: tx(p("Support plan", "सहायता योजना")), mSub: `${name} · ${tx(p(`${prog.done} of ${prog.total} done`, `${prog.total} में से ${prog.done} पूरे`))}`, back: { href: noteId ? `${base}?note=${noteId}` : base } };
  } else {
    top = { crumb: tx(p("Teacher · notes on children", "अध्यापक · बच्चों के नोट्स")), title: tx(p("Notes on children", "बच्चों के नोट्स")), mTitle: tx(p("Notes on children", "बच्चों के नोट्स")), mSub: tx(p(`${mine.length} notes · ${counts.dueSoon} due soon`, `${mine.length} नोट · ${counts.dueSoon} जल्द`)), back: null };
  }

  /* ---------------------------------------------------------- the screens */
  let body: React.ReactNode;
  if (screen === "add") {
    body = <TeachCompose c={composer} kids={props.kids} notes={props.notes} viewer={props.viewer} people={people} today={props.today} school={props.school} base={base} onSaved={(id) => onSaved(id)} />;
  } else if (screen === "listening") {
    body = <TeachListening c={composer} />;
  } else if (screen === "saved" && savedId) {
    const c = composer.child;
    const date = followDates(props.today).find((d) => d.key === composer.when)?.date ?? null;
    const note: BoardNote = savedNote ?? {
      id: savedId,
      studentId: c?.id ?? null,
      studentName: c?.name ?? "—",
      classId: c?.classId ?? null,
      classLabel: c?.classLabel ?? "—",
      body: composer.body,
      tags: composer.tags,
      source: composer.voice ? "voice" : "typed",
      status: "open",
      visibility: composer.visibility,
      needsFollowUp: composer.follow,
      followUpOn: composer.follow ? date : null,
      followUpOwner: composer.follow ? composer.owner : null,
      followUpStaffId: null,
      followUpName: null,
      tellParents: composer.tellParents && composer.visibility === "team",
      writtenBy: props.viewer.id,
      writtenByName: props.viewer.name,
      authorRelation: null,
      subjectCode: null,
      createdAt: new Date().toISOString(),
      replies: 0,
      planId: null,
    };
    const timeline = savedNote ? props.notes : [note, ...props.notes];
    body = (
      <TeachSaved
        note={note}
        notes={timeline}
        viewer={props.viewer}
        people={people}
        pending={undoing}
        onUndo={() =>
          undo(savedId, () => {
            setSavedId(null);
            composer.setStep("review");
            replaceParams({ saved: null });
          })
        }
        onPlan={() => {
          setAdding(false);
          setSavedId(null);
          composer.reset(false);
          router.push(`${base}?note=${savedId}&view=plan`, { scroll: false });
        }}
        onDone={closeAdd}
        onAnother={openAdd}
      />
    );
  } else if (screen === "detail" && focus?.kind === "note") {
    const n = focus.note;
    const kid = n.studentId ? props.kids.find((k) => k.id === n.studentId) : null;
    body = <TeachNoteDetail note={n} replies={focus.replies} plan={n.planId ? (props.plans.find((pl) => pl.id === n.planId) ?? null) : null} viewer={props.viewer} people={people} today={props.today} base={base} childHref={kid ? `/teach/class?student=${kid.id}` : null} />;
  } else if (screen === "plan" && focus && (focus.kind === "plan" || focus.kind === "new-plan")) {
    const plan = focus.kind === "plan" ? focus.plan : null;
    const note = focus.kind === "new-plan" ? focus.note : plan?.noteId ? (props.notes.find((n) => n.id === plan.noteId) ?? null) : null;
    body = <TeachPlan plan={plan} note={note} viewer={props.viewer} people={people} today={props.today} school={props.school} base={base} />;
  } else {
    body = (
      <div className="pad nx-c" style={{ padding: "18px 28px 120px", gap: 18, animation: "xIn .32s var(--ease) both" }}>
        <div className="card rise nx-f" style={{ padding: "16px 18px", gap: 14, flexWrap: "wrap", background: "var(--accs)", borderColor: "transparent" }}>
          <span className="nt-ic" style={{ width: 48, height: 48, background: "var(--card)", color: "var(--accfg)" }}>
            <Ic n="notePen" size={24} />
          </span>
          <span className="nx-c" style={{ flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--accfg)" }}>{tx(p("Notes on children", "बच्चों के नोट्स"))}</span>
            <span style={{ fontSize: 13, color: "var(--accfg)" }}>
              {sub(p("Notes on children", "बच्चों के नोट्स")) ? `${sub(p("Notes on children", "बच्चों के नोट्स"))} · ` : ""}
              {tx(p("Speak or type. It gets noted and followed up.", "बोलें या लिखें। नोट होगा और आगे देखा जाएगा।"))}
            </span>
          </span>
          <span className="nx-f" style={{ gap: 8 }}>
            {[
              { n: counts.dueSoon, l: p("due soon", "जल्द"), c: "var(--warnfg)" },
              { n: counts.open, l: p("open", "खुले"), c: "var(--fg)" },
              { n: counts.done, l: p("done", "पूरे"), c: "var(--ok)" },
            ].map((k) => (
              <span key={k.l.en} className="nx-c" style={{ alignItems: "center", minWidth: 64, padding: "6px 10px", borderRadius: 12, background: "var(--card)" }}>
                <span className="num" style={{ fontSize: 20, fontWeight: 700, color: k.c }}>{k.n}</span>
                <span className="nx-m" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{tx(k.l)}</span>
              </span>
            ))}
          </span>
        </div>
        <div className="nx-c" style={{ gap: 10 }}>
          <div className="hs" role="group" aria-label="Tag" style={{ display: "flex", gap: 8 }}>
            {(["all", ...NOTE_TAGS] as (NoteTag | "all")[]).map((t) => (
              <button key={t} type="button" className={`tap chip${ftag === t ? " on" : ""}`} aria-pressed={ftag === t} onClick={() => setFtag(t)}>
                <Ic n={t === "all" ? "notePen" : TEACH_TAG[t].icon} size={15} />
                {t === "all" ? tx(p("All", "सभी")) : tx(TAG_TEXT[t])}
              </button>
            ))}
          </div>
          {classes.length > 1 && classes.length <= 3 ? (
            <Seg label="Class" style={{ maxWidth: 460 }} value={fcls} onChange={setFcls} options={[{ value: "all", label: tx(p("All classes", "सभी कक्षाएँ")) }, ...classes.map(([id, label]) => ({ value: id, label }))]} />
          ) : classes.length > 3 ? (
            <select className="inp" aria-label="Class" value={fcls} onChange={(e) => setFcls(e.target.value)} style={{ height: 40, maxWidth: 260 }}>
              <option value="all">{tx(p("All classes", "सभी कक्षाएँ"))}</option>
              {classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          ) : null}
        </div>
        {secs.map((g) => (
          <div key={g.key} className="nx-c" style={{ gap: 10 }}>
            <div className="nx-f" style={{ gap: 8 }}>
              <Ic n={g.icon} size={16} style={{ color: g.c }} />
              <span className="sech" style={{ color: g.c }}>{tx(g.title)}</span>
              {sub(g.title) ? <span className="nt-hn">· {sub(g.title)}</span> : null}
              <span className="pill num" style={{ background: "var(--s3)", color: "var(--mut)" }}>{g.notes.length}</span>
            </div>
            <div className="g2" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
              {g.notes.map((n, i) => (
                <TeachCard key={n.id} note={n} viewerId={props.viewer.id} today={props.today} href={`${base}?note=${n.id}`} due={g.key === "due"} ct={n.classId ? (people.classTeachers[n.classId] ?? null) : null} delay={Math.min(i, 12) * 40} />
              ))}
            </div>
          </div>
        ))}
        {secs.length === 0 ? (
          <div className="card nt-ani nx-c" style={{ padding: "40px 24px", alignItems: "center", gap: 10, textAlign: "center" }}>
            <span className="nt-av" style={{ width: 64, height: 64, background: "var(--s2)", color: "var(--mut)" }}>
              <Ic n="notePen" size={28} />
            </span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("No notes here yet", "यहाँ अभी कोई नोट नहीं"))}</span>
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Try another tag or class — or speak a new note.", "कोई और टैग या कक्षा चुनें — या नया नोट बोलें।"))}</span>
            {ftag !== "all" || fcls !== "all" ? (
              <button type="button" className="tap btn sec nt-big" onClick={() => { setFtag("all"); setFcls("all"); }}>{tx(p("Show all notes", "सभी नोट दिखाएँ"))}</button>
            ) : null}
          </div>
        ) : null}
        {props.viewer.canWrite ? (
          <div className="nt-fabrow">
            <button type="button" className="tap btn pri nt-fab" onClick={openAdd}>
              <Ic n="mic" size={24} />
              <span className="nx-c" style={{ alignItems: "flex-start", lineHeight: 1.1 }}>
                {tx(p("Speak a note", "बोलकर नोट"))}
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>बोलकर लिखें</span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <VxPage label="Notes on children" className="nx">
      <NotesTop teacher crumb={top.crumb} title={top.title} mTitle={top.mTitle} mSub={top.mSub} dBack={top.back} mBack={top.back ?? { href: "/teach/more" }} onHelp={() => setHelp(true)} />
      <main>{body}</main>
      <Sheet
        open={help}
        onClose={() => setHelp(false)}
        title={tx(p("How this page works", "यह पेज कैसे काम करता है"))}
        sub={tx(p("3 quick steps", "3 आसान कदम"))}
        footer={
          <button type="button" className="tap btn pri nt-big" onClick={() => setHelp(false)} style={{ flex: 1, height: 52 }}>
            {both(p("Got it", "ठीक है"))}
          </button>
        }
      >
        <div className="nx">
          <HelpSteps steps={HELP[screen]} />
        </div>
      </Sheet>
    </VxPage>
  );
}
