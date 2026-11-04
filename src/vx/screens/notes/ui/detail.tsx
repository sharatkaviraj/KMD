"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { appendSpoken, useSpeech } from "@/vx/ui/voice";

import { editNoteAction, replyToNoteAction, setFollowUpAction, setNoteStatusAction, tellParentsAboutNoteAction } from "../actions";
import type { NoteReply, NotesPeople, SupportPlan } from "../data";
import { shortDayHi } from "@/vx/format";

import { canEditNote, EDIT_DAYS, followUpDate, knownPair, noteStage, parentNoteMessage, planProgress, STATUS_ORDER, TAG_TEXT, type BoardNote, type FollowOwner, type NoteStatus } from "../domain/notes";
import { COST } from "./compose";
import { BOARD_TAG, day, nameTone, noteWhen, time, relationText, TEACH_TAG, useBoth, useNoteWords, WaBubble } from "./look";
import { canWork, type ClientViewer } from "./parts";

/*
 * One note (design Notes `detail` — the pane beside the board — and TchNotes
 * `detail`, a page of its own). Status, who follows it up, replies (typed or
 * spoken), the support plan and telling the parents. Every change is the
 * notes actions' own, and only for someone `canWorkOnNote` allows.
 */

type Run = (fn: () => Promise<{ ok: boolean; error?: Pair }>, done: Pair) => void;

function useRun(): [Run, boolean] {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run: Run = (fn, done) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.show({ text: tx(done) });
        router.refresh();
      } else if (res.error) toast.show({ text: tx(res.error), tone: "bad" });
    });
  return [run, pending];
}

/** A reply typed or spoken (design `vr`, `rp`). */
function useReply(note: BoardNote) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [spoken, setSpoken] = useState(false);
  const [pending, start] = useTransition();
  const speech = useSpeech((t) => setHeard((cur) => appendSpoken(cur, t)));
  const live = appendSpoken(heard, speech.interim).trim();
  const listening = speech.listening;
  const mic = (lang: "hi-IN" | "en-IN") => {
    if (listening) {
      speech.stop();
      if (live) {
        setText((cur) => appendSpoken(cur, live));
        setSpoken(true);
      }
      setHeard("");
    } else {
      setHeard("");
      speech.start(lang);
    }
  };
  const cancel = () => {
    speech.stop();
    setHeard("");
  };
  const done = () => {
    speech.stop();
    if (live) {
      setText((cur) => appendSpoken(cur, live));
      setSpoken(true);
    }
    setHeard("");
  };
  const send = () =>
    start(async () => {
      const body = (listening && live ? appendSpoken(text, live) : text).trim();
      if (listening) speech.stop();
      if (!body) {
        toast.show({ text: tx(p("Write or speak the reply first", "पहले जवाब लिखें या बोलें")) });
        return;
      }
      const res = await replyToNoteAction(note.id, body, spoken ? "voice" : "typed");
      if (res.ok) {
        setText("");
        setHeard("");
        setSpoken(false);
        toast.show({ text: tx(p("Reply sent · everyone on this note can see it", "जवाब भेजा · इस नोट वाले सब देख सकते हैं")) });
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });
  return { text, setText, live, listening, mic, cancel, done, send, pending, error: speech.errorP };
}

function Bubble({ who, when, text, mine, teacher }: { who: string; when: string; text: string; mine: boolean; teacher?: boolean }) {
  if (teacher) {
    return (
      <div className="nx-c" style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 3 }}>
        <span className="nx-m" style={{ fontSize: 12 }}>{who}</span>
        <span style={{ fontSize: 14, maxWidth: "88%", padding: "10px 14px", borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px", background: mine ? "var(--pri)" : "var(--s2)", color: mine ? "var(--prifg)" : "var(--fg)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{text}</span>
        <span className="nx-m" style={{ fontSize: 11 }}>{when}</span>
      </div>
    );
  }
  return (
    <div className="nx-c" style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 2 }}>
      <span className="nx-m" style={{ fontSize: 11 }}>{who} · {when}</span>
      <span className="nx-bub" style={{ background: mine ? "var(--accs)" : "var(--s2)", color: mine ? "var(--accfg)" : "var(--fg)" }}>{text}</span>
    </div>
  );
}

/** A reply's time, always with the clock: "Tue 6 Oct · 4:10 pm". */
function replyWhen(createdAt: string): string {
  return `${day(createdAt)} · ${time(createdAt)}`;
}

const STEP_OWNER: Record<string, Pair> = {
  me: p("Me", "मैं"),
  class_teacher: p("Class teacher", "कक्षा अध्यापक"),
  subject_teacher: p("Subject teacher", "विषय अध्यापक"),
  coordinator: p("Coordinator", "समन्वयक"),
  admin: p("Admin", "प्रशासक"),
  parents: p("Parents", "माता-पिता"),
};

/** The status lines the actions write into a note's history, in the reader's language. */
const SYSTEM_WORDS: Record<string, Pair> = {
  "Opened again": p("Opened again", "फिर खोला"),
  "Working on it": p("Working on it", "काम चल रहा है"),
  "Marked done": p("Marked done", "पूरा किया"),
  "Note changed": p("The note’s words were changed", "नोट के शब्द बदले गए"),
};

/**
 * Change a saved note's words (smoke 20 Oct: only Undo, which deleted the
 * whole note). For its author, within EDIT_DAYS and before it is done; the
 * history says it was changed.
 */
function EditNote({ note, onClose }: { note: BoardNote; onClose: () => void }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [text, setText] = useState(note.body);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const res = await editNoteAction(note.id, text);
      if (res.ok) {
        toast.show({ text: tx(p("Note changed", "नोट बदला गया")) });
        onClose();
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });
  return (
    <div className="nx-c" style={{ gap: 8 }}>
      <label className="field">
        <span>{tx(p("Change the words", "शब्द बदलें"))}</span>
        <textarea className="inp" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} style={{ minHeight: 120, fontSize: 16 }} />
      </label>
      {note.tellParents ? <span className="nx-m">{tx(p("The message already queued for the parents stays as it was.", "माता-पिता के लिए कतार में रखा संदेश जैसा था वैसा ही रहेगा।"))}</span> : null}
      <span className="nx-f" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="tap btn pri" disabled={pending || !text.trim()} onClick={save} style={{ height: 44 }}>
          <Ic n="check" size={18} />
          {tx(p("Save the change", "बदलाव सहेजें"))}
        </button>
        <button type="button" className="tap btn ghost" disabled={pending} onClick={onClose} style={{ height: 44 }}>
          {tx(p("Cancel", "रद्द करें"))}
        </button>
      </span>
    </div>
  );
}

/** The "Change the words" button, for the note's author while she may. */
function EditButton({ onClick }: { onClick: () => void }) {
  const { tx } = useVx();
  return (
    <button type="button" className="tap btn ghost nx-s" onClick={onClick} style={{ alignSelf: "flex-start", color: "var(--acc)", minHeight: 44 }} title={tx(p(`You can change your note for ${EDIT_DAYS} days`, `आप अपना नोट ${EDIT_DAYS} दिन तक बदल सकते हैं`))}>
      <Ic n="edit" size={16} />
      {tx(p("Change the words", "शब्द बदलें"))}
    </button>
  );
}

/** The note's history (design `dt.hist`): written, reached the class teacher, parents, plan, every status change. */
function historyOf(note: BoardNote, replies: NoteReply[], plan: SupportPlan | null, people: NotesPeople, today: string): { text: Pair; when: string; dot: string }[] {
  const rel = relationText(note.authorRelation);
  const out: { text: Pair; when: string; dot: string }[] = [
    { text: p(`Written by ${note.writtenByName}${rel ? ` · ${rel.en}` : ""}`, `${note.writtenByName} ने लिखा${rel?.hi ? ` · ${rel.hi}` : ""}`), when: noteWhen(note.createdAt, today), dot: "var(--acc)" },
  ];
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  if (note.authorRelation === "subject_teacher" && note.visibility === "team") {
    out.push({ text: p(`Reached the class teacher${ct ? ` ${ct}` : ""} by itself`, `कक्षा अध्यापक${ct ? ` ${ct}` : ""} तक अपने-आप पहुँचा`), when: noteWhen(note.createdAt, today), dot: "var(--info)" });
  }
  if (note.tellParents) out.push({ text: p("Parents’ WhatsApp queued for the office", "अभिभावक का व्हाट्सऐप कार्यालय की कतार में"), when: "", dot: "var(--ok)" });
  if (plan) out.push({ text: p(`Support plan “${plan.goal}” started`, `सहायता योजना “${plan.goal}” शुरू`), when: noteWhen(plan.createdAt, today), dot: "var(--ok)" });
  for (const r of replies) {
    if (r.source !== "system") continue;
    const w = SYSTEM_WORDS[r.body] ?? p(r.body);
    out.push({ text: p(`${w.en} · ${r.writtenByName}`, `${w.hi ?? w.en} · ${r.writtenByName}`), when: noteWhen(r.createdAt, today), dot: "var(--pri)" });
  }
  return out;
}

function History({ items }: { items: { text: Pair; when: string; dot: string }[] }) {
  const { tx } = useVx();
  return (
    <div className="card nx-c" style={{ padding: "14px 16px" }}>
      <span className="sech" style={{ marginBottom: 6 }}>{tx(p("History", "इतिहास"))}</span>
      {items.map((l, i) => (
        <div key={i} className="nx-hr" style={{ animationDelay: `${i * 50}ms` }}>
          <span className="nx-hd" style={{ background: l.dot }} />
          <span className="nx-c">
            <span style={{ fontSize: 13 }}>{tx(l.text)}</span>
            {l.when ? <span className="num nx-m">{l.when}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ask before queueing the parents' message: Hindi first, the cost shown first (RULES H). */
function TellSheet({ open, onClose, note, school, onQueue, pending }: { open: boolean; onClose: () => void; note: BoardNote; school: string; onQueue: () => void; pending: boolean }) {
  const { tx } = useVx();
  const msg = parentNoteMessage({ childName: note.studentName, teacher: note.writtenByName, body: note.body, school });
  const first = note.studentName.split(" ")[0] ?? "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      icon="message"
      title={tx(p(`Tell parents · ${first}`, `अभिभावक को बताएँ · ${first}`))}
      sub={tx(p("Hindi first · queued for the office to send", "पहले हिंदी · कार्यालय भेजेगा"))}
      footer={
        <>
          <button type="button" className="tap btn sec" onClick={onClose} style={{ flex: 1, height: 48 }}>{tx(p("Cancel", "रद्द करें"))}</button>
          <button type="button" className="tap btn pri" disabled={pending} onClick={onQueue} style={{ flex: 1.6, height: 48 }}>
            <Ic n="send" size={18} />
            {tx(p(`Queue · ${COST}`, `कतार में डालें · ${COST}`))}
          </button>
        </>
      }
    >
      <div className="nx nx-c" style={{ gap: 10 }}>
        <WaBubble hi={msg.hi} en={msg.en} foot={tx(p("now", "अभी"))} />
        <span className="nx-m nx-f" style={{ gap: 6, fontSize: 13 }}>
          <Ic n="info" size={16} />
          {tx(p(`1 family · 1 WhatsApp message · about ${COST}`, `1 परिवार · 1 व्हाट्सऐप संदेश · लगभग ${COST}`))}
        </span>
      </div>
    </Sheet>
  );
}

const STEP_ICON: Record<NoteStatus, IconName> = { open: "flag", working: "clock", done: "check" };
const STEP_TEXT: Record<NoteStatus, Pair> = { open: p("Open", "खुला"), working: p("Working on it", "काम जारी"), done: p("Done", "पूरा") };

/**
 * The note beside the board (design Notes `dt`): the child, the note, status,
 * who follows up, plan and parents, replies and history.
 */
export function BoardNoteAside({
  note,
  replies,
  plan,
  viewer,
  people,
  today,
  school,
  base,
  onClose,
  childHref,
}: {
  note: BoardNote;
  replies: NoteReply[];
  plan: SupportPlan | null;
  viewer: ClientViewer;
  people: NotesPeople;
  today: string;
  school: string;
  base: string;
  onClose: () => void;
  childHref: string | null;
}) {
  const { tx, language } = useVx();
  const [run, pending] = useRun();
  const [tell, setTell] = useState(false);
  const [editing, setEditing] = useState(false);
  // The reply mic starts in the reader's language.
  const lang = language === "en" ? ("en-IN" as const) : ("hi-IN" as const);
  const reply = useReply(note);
  const words = useNoteWords(viewer.id);
  const mayEdit = canEditNote(note, viewer.id, today);
  const work = canWork(note, viewer);
  const look = BOARD_TAG[note.tags[0] ?? "studies"];
  const rel = relationText(note.authorRelation);
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const first = note.studentId && note.studentName ? note.studentName.split(" ")[0] : words.name(note);
  const who = words.who(note);
  const cur = note.needsFollowUp || note.status !== "open" ? STATUS_ORDER.indexOf(note.status) : -1;
  const fill = cur <= 0 ? "0%" : cur === 1 ? "50%" : "100%";
  const owner: FollowOwner | null = note.followUpOwner === "me" ? (note.authorRelation === "class_teacher" ? "class_teacher" : note.writtenBy === viewer.id && viewer.isAdmin ? "admin" : note.writtenBy === viewer.id && viewer.isCoordinator ? "coordinator" : null) : note.followUpOwner;
  const prog = plan ? planProgress(plan.steps) : null;
  const mayPlan = Boolean(plan) || (work && viewer.canWrite && Boolean(note.studentId));
  const mayTell = work && note.visibility === "team" && Boolean(note.studentId);
  const conversation = replies.filter((r) => r.source !== "system");
  const nextMonday = day(followUpDate("next_monday", today));
  // "you" compares the viewer's id with whoever holds (or would get) the
  // follow-up, never the viewer's role: with two admins, the one who did not
  // get the note is not "you" (B09).
  const isYou = (key: FollowOwner, fallbackId: string | null | undefined) => (owner === key && note.followUpStaffId ? note.followUpStaffId === viewer.id : Boolean(fallbackId) && fallbackId === viewer.id);
  const assign: { key: FollowOwner; label: Pair; sub: string | null; you: boolean }[] = [
    { key: "class_teacher", label: p("Class teacher", "कक्षा अध्यापक"), sub: ct, you: note.classId !== null && viewer.heldClassIds.includes(note.classId) },
    { key: "coordinator", label: p("Coordinator", "समन्वयक"), sub: owner === "coordinator" && note.followUpName ? note.followUpName : people.coordinator, you: isYou("coordinator", people.coordinatorId) },
    { key: "admin", label: p("Admin", "प्रशासक"), sub: owner === "admin" && note.followUpName ? note.followUpName : people.admin, you: isYou("admin", people.adminId) },
  ];

  return (
    <div className="nx-c" style={{ padding: "18px 20px 28px", gap: 14 }}>
      <div className="nx-f" style={{ gap: 12 }}>
        <span className="nx-ib" style={{ width: 48, height: 48, borderRadius: 24, fontSize: 16, background: look.bg, color: look.fg }}>{words.initials(note)}</span>
        <span className="nx-c" style={{ flex: 1 }}>
          <span className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>{words.name(note)}</span>
          {words.hint(note) ? <span className="nt-hn">{words.hint(note)}</span> : null}
          {childHref ? (
            <Link href={childHref} scroll={false} style={{ color: "var(--acc)", fontSize: 13, fontWeight: 700 }}>
              {note.classLabel} · {tx(p(`all notes on ${first}`, `${first} के सब नोट्स`))} ›
            </Link>
          ) : (
            <span className="nx-m" style={{ fontSize: 13 }}>{note.classLabel}</span>
          )}
        </span>
        <button type="button" className="tap btn ghost only-d" aria-label="Close note" onClick={onClose} style={{ width: 36, height: 36, padding: 0 }}>
          <Ic n="x" size={18} />
        </button>
      </div>

      <div className="card nx-c" style={{ padding: 16, gap: 10 }}>
        {editing ? (
          <EditNote note={note} onClose={() => setEditing(false)} />
        ) : (
          <span style={{ fontSize: 16, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {note.source === "voice" ? <Ic n="mic" size={15} style={{ marginRight: 6, verticalAlign: "-2px", color: "var(--mut)" }} /> : null}
            {note.body}
          </span>
        )}
        {mayEdit && !editing ? <EditButton onClick={() => setEditing(true)} /> : null}
        <span className="nx-m">{[note.writtenByName, rel ? tx(rel) : null, noteWhen(note.createdAt, today)].filter(Boolean).join(" · ")}</span>
        <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
          {note.tags.map((t) => (
            <span key={t} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: BOARD_TAG[t].bg, color: BOARD_TAG[t].fg }}>
              <Ic n={BOARD_TAG[t].icon} size={13} />
              {tx(TAG_TEXT[t])}
            </span>
          ))}
          <span className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: "var(--s2)", color: "var(--mut)" }}>
            <Ic n={note.visibility === "private" ? "lock" : "eye"} size={13} />
            {note.visibility === "private" ? tx(p("Only me", "सिर्फ़ मैं")) : tx(p("Teachers & office", "शिक्षक व कार्यालय"))}
          </span>
        </div>
        {note.authorRelation === "subject_teacher" && note.visibility === "team" ? (
          <div className="nx-in" style={{ padding: "8px 12px", background: "var(--infos)", color: "var(--info)" }}>
            <Ic n="send" size={16} style={{ marginTop: 2 }} />
            <span>{tx(p(`A subject teacher’s note — it reached the class teacher${ct ? ` ${ct}` : ""} by itself.`, `विषय अध्यापक का नोट — यह कक्षा अध्यापक${ct ? ` ${ct}` : ""} तक अपने-आप पहुँचा।`))}</span>
          </div>
        ) : null}
      </div>

      <div className="card nx-c" style={{ padding: "14px 16px", gap: 10 }}>
        <span className="sech">{tx(p("Status", "स्थिति"))}</span>
        <div className="nx-tl" role="radiogroup" aria-label="Status">
          <i>
            <b style={{ width: fill }} />
          </i>
          {STATUS_ORDER.map((s, i) => {
            const done = i <= cur;
            const c = i === 2 ? "var(--ok)" : i === 1 ? "var(--info)" : "var(--warnfg)";
            return (
              <button
                key={s}
                type="button"
                className="tap"
                role="radio"
                aria-checked={i === cur}
                disabled={!work || pending || note.status === s && cur === i}
                onClick={() => run(() => setNoteStatusAction(note.id, s), p(`${first}’s note · ${STEP_TEXT[s].en.toLowerCase()}`, `${first} का नोट · ${STEP_TEXT[s].hi}`))}
                style={{ alignItems: ["flex-start", "center", "flex-end"][i], textAlign: (["left", "center", "right"] as const)[i] }}
              >
                <span style={{ borderColor: done ? c : "var(--bds)", background: done ? c : "var(--card)", color: done ? "var(--onsolid)" : "var(--sub)", animation: i === cur ? "xPopIn .4s var(--spring) both" : "none" }}>
                  <Ic n={STEP_ICON[s]} size={14} stroke={3} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: done ? c : "var(--mut)" }}>{tx(STEP_TEXT[s])}</span>
              </button>
            );
          })}
        </div>
        {cur < 0 ? <span className="nx-m">{tx(p("Just noting — no follow-up asked. Tap a step to start one.", "सिर्फ़ जानकारी — फिर से देखने को नहीं कहा गया। शुरू करने के लिए कोई कदम दबाएँ।"))}</span> : null}
        <span className="sech" style={{ marginTop: 4 }}>{tx(p("Who follows up", "कौन देखेगा"))}</span>
        {assign.map((r) => {
          const on = owner === r.key;
          return (
            <button
              key={r.key}
              type="button"
              className="tap nx-rc"
              role="radio"
              aria-checked={on}
              disabled={!work || pending}
              onClick={() => run(() => setFollowUpAction(note.id, r.key, null), p(`Given to ${r.sub ?? r.label.en} to follow up`, `अब ${r.sub ?? r.label.hi} फिर से देखेंगे`))}
              style={{ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}
            >
              <i style={{ borderColor: on ? "var(--acc)" : "var(--bds)" }}>
                <b style={{ transform: `scale(${on ? 1 : 0})` }} />
              </i>
              <span className="nx-c" style={{ flex: 1 }}>
                <span className="nx-b">{tx(r.label)}{r.you ? ` · ${tx(p("you", "आप"))}` : ""}</span>
                {r.sub ? <span className="nx-m">{r.sub}</span> : null}
              </span>
            </button>
          );
        })}
        <span className="nx-m nx-f" style={{ gap: 6 }}>
          <Ic n="calendar" size={16} />
          {note.needsFollowUp && note.followUpOn
            ? tx(p(`Follow up on ${day(note.followUpOn)}${who ? ` · ${who}` : ""}`, `${shortDayHi(note.followUpOn)} को फिर देखना${who ? ` · ${who}` : ""}`))
            : tx(p(`No follow-up date yet. Picking a person sets ${nextMonday}.`, `अभी फिर देखने की तारीख़ नहीं। किसी को चुनने पर ${nextMonday} तय होगी।`))}
        </span>
      </div>

      {mayPlan || mayTell ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
          {plan ? (
            <Link href={`${base}?plan=${plan.id}`} scroll={false} className="tap btn soft" style={{ height: 48, whiteSpace: "normal", lineHeight: 1.2 }}>
              <Ic n="layers" size={18} />
              {tx(p(`Support plan · ${prog!.done} of ${prog!.total}`, `सहायता योजना · ${prog!.total} में से ${prog!.done}`))}
            </Link>
          ) : mayPlan ? (
            <Link href={`${base}?note=${note.id}&view=plan`} scroll={false} className="tap btn pri" style={{ height: 48, whiteSpace: "normal", lineHeight: 1.2 }}>
              <Ic n="layers" size={18} />
              {tx(p("Make a support plan", "सहायता योजना बनाएँ"))}
            </Link>
          ) : (
            <span />
          )}
          {mayTell ? (
            <button type="button" className="tap btn sec" onClick={() => setTell(true)} style={{ height: 48 }}>
              <Ic n="message" size={18} />
              {note.tellParents ? tx(p("Parents told ✓", "अभिभावक को बताया ✓")) : tx(p("Tell parents", "अभिभावक को बताएँ"))}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="card nx-c" style={{ padding: "14px 16px", gap: 10 }}>
        <span className="sech">{tx(p("Replies", "जवाब"))} · {conversation.length}</span>
        {conversation.map((r) => (
          <Bubble key={r.id} who={r.writtenByName} when={replyWhen(r.createdAt)} text={r.body} mine={r.writtenBy === viewer.id} />
        ))}
        {conversation.length === 0 ? <span className="nx-m">{tx(p("No replies yet. Ask the teacher a question or say what you did.", "अभी कोई जवाब नहीं। अध्यापक से पूछें या बताएँ कि आपने क्या किया।"))}</span> : null}
        {reply.listening ? (
          <div className="nx-c" style={{ gap: 8, padding: "10px 12px", borderRadius: 14, background: "var(--s2)", animation: "xIn .3s var(--ease) both" }}>
            <div className="nx-f" style={{ gap: 10 }}>
              <div className="nx-bars" aria-hidden="true" style={{ height: 24 }}>
                {[10, 20, 16, 22, 14, 18, 10].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${[0, 0.12, 0.24, 0.36, 0.18, 0.06, 0.3][i]}s` }} />)}
              </div>
              <span className="num nx-m" style={{ color: "var(--bad)", fontWeight: 700 }}>{tx(p("Listening…", "सुन रहे हैं…"))}</span>
            </div>
            <span style={{ fontSize: 14, lineHeight: 1.5 }}>
              {reply.live}
              <span className="nx-caret" />
            </span>
            <div className="nx-f" style={{ gap: 6, justifyContent: "flex-end" }}>
              <button type="button" className="tap btn ghost nx-s" onClick={reply.cancel}>{tx(p("Cancel", "रद्द करें"))}</button>
              <button type="button" className="tap btn pri nx-s" onClick={reply.done}>{tx(p("Done", "हो गया"))}</button>
            </div>
          </div>
        ) : null}
        {work ? (
          <div className="nx-f" style={{ gap: 6 }}>
            <button type="button" className="tap btn soft" aria-label="Speak a reply" onClick={() => reply.mic(lang)} style={{ width: 44, height: 44, padding: 0, borderRadius: 22, flex: "none" }}>
              <Ic n="mic" size={18} />
            </button>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span className="sr">Reply</span>
              <input className="inp" value={reply.text} maxLength={1000} onChange={(e) => reply.setText(e.target.value)} placeholder={tx(p("Write or speak a reply", "जवाब लिखें या बोलें"))} style={{ height: 44, borderRadius: 22 }} />
            </label>
            <button type="button" className="tap btn pri" aria-label="Send reply" disabled={reply.pending} onClick={reply.send} style={{ width: 44, height: 44, padding: 0, borderRadius: 22, flex: "none" }}>
              <Ic n="send" size={18} />
            </button>
          </div>
        ) : null}
        {reply.error ? <span role="alert" className="nx-m" style={{ color: "var(--warnfg)" }}>{tx(reply.error)}</span> : null}
      </div>

      <History items={historyOf(note, replies, plan, people, today)} />

      {mayTell ? (
        <TellSheet
          open={tell}
          onClose={() => setTell(false)}
          note={note}
          school={school}
          pending={pending}
          onQueue={() => {
            setTell(false);
            run(() => tellParentsAboutNoteAction(note.id), p("Queued for the parents · the office sends it", "अभिभावक के लिए कतार में · कार्यालय भेजेगा"));
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The teacher's note page (design TchNotes `detail`): the note, "Where is
 * this?", the support plan, and replies.
 */
export function TeachNoteDetail({
  note,
  replies,
  plan,
  viewer,
  people,
  base,
  childHref,
  today,
}: {
  note: BoardNote;
  replies: NoteReply[];
  plan: SupportPlan | null;
  viewer: ClientViewer;
  people: NotesPeople;
  base: string;
  childHref: string | null;
  today: string;
}) {
  const { tx, sub, language } = useVx();
  const both = useBoth();
  const [run, pending] = useRun();
  const reply = useReply(note);
  const words = useNoteWords(viewer.id);
  const [editing, setEditing] = useState(false);
  const mayEdit = canEditNote(note, viewer.id, today);
  const who = words.who(note);
  const work = canWork(note, viewer);
  const look = TEACH_TAG[note.tags[0] ?? "studies"];
  const [abg, afg] = nameTone(note.studentName);
  const mine = note.writtenBy === viewer.id;
  const rel = relationText(note.authorRelation);
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const first = note.studentId && note.studentName ? note.studentName.split(" ")[0] : words.name(note);
  const stage = noteStage(note);
  const idx = stage === "noting" ? -1 : STATUS_ORDER.indexOf(note.status);
  const prog = plan ? planProgress(plan.steps) : null;
  const next = plan?.steps.find((s) => !s.done) ?? null;
  const conversation = replies.filter((r) => r.source !== "system");
  const facts: { icon: IconName; t: Pair }[] = [
    note.needsFollowUp && note.followUpOn
      ? { icon: "calendar", t: p(`Follow up ${day(note.followUpOn)}${who ? ` · ${who}` : ""}`, `फिर देखना ${shortDayHi(note.followUpOn)}${who ? ` · ${who}` : ""}`) }
      : { icon: "notePen", t: p("Just noting · no reminder", "सिर्फ़ नोट · कोई याद नहीं") },
    note.visibility === "private" ? { icon: "eyeOff", t: p("Only you can see this", "सिर्फ़ आप देख सकते हैं") } : { icon: "eye", t: p("Teachers & office can see this", "शिक्षक व कार्यालय देख सकते हैं") },
  ];
  if (note.authorRelation === "subject_teacher" && note.visibility === "team") {
    const held = note.classId !== null && viewer.heldClassIds.includes(note.classId);
    facts.push({ icon: "send", t: held ? p("Reached you as class teacher", "कक्षा अध्यापक के रूप में आप तक पहुँचा") : p(`Reached ${ct ?? "the class teacher"} (class teacher) automatically`, `${ct ?? "कक्षा अध्यापक"} तक अपने-आप पहुँचा`) });
  }
  const STEPS: { s: NoteStatus; icon: IconName; t: Pair }[] = [
    { s: "open", icon: "flag", t: p("Open", "खुला") },
    { s: "working", icon: "activity", t: p("Working on it", "काम चल रहा") },
    { s: "done", icon: "check", t: p("Done", "पूरा") },
  ];

  return (
    <div className="pad stack" style={{ padding: "18px 28px 40px", display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 16, alignItems: "start", animation: "xPush .36s var(--ease) both" }}>
      <div className="nx-c" style={{ gap: 16 }}>
        <div className="card rise nx-c" style={{ padding: "18px 20px", gap: 12, borderLeft: `4px solid ${look.fg}` }}>
          <div className="nx-f" style={{ gap: 12 }}>
            <span className="nt-av" style={{ width: 52, height: 52, fontSize: 16, background: abg, color: afg }}>{words.initials(note)}</span>
            <span className="nx-c" style={{ flex: 1 }}>
              <span className="serif" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.15 }}>{words.name(note)}</span>
              {words.hint(note) ? <span className="nt-hn">{words.hint(note)}</span> : null}
              <span className="nx-m" style={{ fontSize: 12 }}>
                {note.classLabel} · {mine ? tx(p(`written by you${rel ? ` (${rel.en.toLowerCase()})` : ""}`, "आपने लिखा")) : `${tx(p("from", "से"))} ${note.writtenByName}${rel ? ` (${tx(rel).toLowerCase()})` : ""}`} · {day(note.createdAt)}
              </span>
            </span>
            {childHref ? (
              <>
                <Link href={childHref} className="only-d tap btn sec">{tx(p(`Open ${first}’s page`, `${first} का पेज खोलें`))}</Link>
                <Link href={childHref} className="only-m tap btn sec" style={{ padding: "0 12px" }}>{tx(p(`${first}’s page`, `${first} का पेज`))}</Link>
              </>
            ) : null}
          </div>
          <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
            {note.tags.map((t) => (
              <span key={t} className="pill" style={{ height: 26, padding: "0 10px", fontSize: 12, background: TEACH_TAG[t].bg, color: TEACH_TAG[t].fg }}>
                <Ic n={TEACH_TAG[t].icon} size={13} />
                {both(TAG_TEXT[t])}
              </span>
            ))}
          </div>
          {editing ? <EditNote note={note} onClose={() => setEditing(false)} /> : <span style={{ fontSize: 18, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{note.body}</span>}
          {mayEdit && !editing ? <EditButton onClick={() => setEditing(true)} /> : null}
          {facts.map((f) => (
            <span key={f.t.en} className="nx-f" style={{ gap: 8, fontSize: 13, color: "var(--mut)" }}>
              <Ic n={f.icon} size={16} />
              {tx(f.t)}
            </span>
          ))}
        </div>

        <div className="card rise nx-c nt-cd" style={{ animationDelay: "60ms" }}>
          <span className="nx-f" style={{ gap: 8 }}>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>
              {tx(p("Where is this?", "स्थिति"))} {sub(p("Where is this?", "स्थिति")) ? <span className="nt-hn">· {sub(p("Where is this?", "स्थिति"))}</span> : null}
            </span>
            {work ? <span className="nx-m" style={{ fontSize: 12 }}>{tx(p("Tap to change", "बदलने के लिए दबाएँ"))}</span> : null}
          </span>
          <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }} role="radiogroup" aria-label="Status">
            <span style={{ position: "absolute", left: "16.6%", right: "16.6%", top: 21, height: 4, borderRadius: 2, background: "var(--s3)" }} />
            <span style={{ position: "absolute", left: "16.6%", top: 21, height: 4, width: idx <= 0 ? "0%" : idx === 1 ? "33.4%" : "66.8%", borderRadius: 2, background: "var(--ok)", transition: "width .5s var(--ease)" }} />
            {STEPS.map((x, i) => {
              const on = i === idx;
              const past = i < idx;
              return (
                <button key={x.s} type="button" className="tap nx-c" role="radio" aria-checked={on} disabled={!work || pending} onClick={() => run(() => setNoteStatusAction(note.id, x.s), p(`Status: ${x.t.en}`, `स्थिति: ${x.t.hi}`))} style={{ position: "relative", alignItems: "center", gap: 6, padding: "0 0 4px", border: 0, background: "transparent", color: "var(--fg)", font: "inherit" }}>
                  <span style={{ width: 46, height: 46, borderRadius: 23, display: "flex", alignItems: "center", justifyContent: "center", background: on ? (i === 2 ? "var(--ok)" : "var(--pri)") : past ? "var(--okm)" : "var(--card)", color: on ? "var(--onsolid)" : past ? "var(--ok)" : "var(--mut)", border: on || past ? "2px solid transparent" : "2px solid var(--bds)", transform: `scale(${on ? 1.12 : 1})`, transition: "transform .32s var(--spring),background-color .25s ease" }}>
                    <Ic n={x.icon} size={20} />
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: on ? "var(--fg)" : "var(--mut)" }}>{tx(x.t)}</span>
                  {sub(x.t) ? <span className="nt-hn">{sub(x.t)}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="card rise nx-c nt-cd" style={{ animationDelay: "120ms" }}>
          <div className="nt-hd">
            <span className="nt-ic" style={{ background: "var(--accs)", color: "var(--accfg)" }}><Ic n="layers" size={18} /></span>
            <span className="nx-c" style={{ flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Support plan", "सहायता योजना"))}</span>
              {sub(p("Support plan", "सहायता योजना")) ? <span className="nt-hn">{sub(p("Support plan", "सहायता योजना"))}</span> : null}
            </span>
            <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>{prog ? tx(p(`${prog.done} of ${prog.total}`, `${prog.total} में से ${prog.done}`)) : "—"}</span>
          </div>
          {plan && prog ? (
            <>
              <div className="nt-bar"><span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%`, background: "var(--ok)" }} /></div>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>
                {next
                  ? [`${tx(p("Next", "अगला"))}: ${tx(knownPair(next.body))}`, next.ownerStaffId === viewer.id ? tx(p("you", "आप")) : (next.ownerName ?? (STEP_OWNER[next.ownerRole ?? ""] ? tx(STEP_OWNER[next.ownerRole ?? ""]) : null)), next.whenLabel].filter(Boolean).join(" · ")
                  : tx(p("All steps done. Well done!", "सारे कदम पूरे। शाबाश!"))}
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("Turn this note into 3–5 small steps — each with a person and a date.", "इस नोट को 3–5 छोटे कदमों में बदलें — हर कदम के साथ एक व्यक्ति और तारीख़।"))}</span>
          )}
          {plan ? (
            // Opens at the top of the plan (smoke 20 Oct: it reopened scrolled to the bottom).
            <Link href={`${base}?plan=${plan.id}`} className="tap btn soft nt-big">
              {tx(p("Open support plan", "सहायता योजना खोलें"))}
              <Ic n="arrowRight" size={18} />
            </Link>
          ) : work && viewer.canWrite && note.studentId ? (
            <Link href={`${base}?note=${note.id}&view=plan`} className="tap btn soft nt-big">
              {tx(p("Make a support plan", "सहायता योजना बनाएँ"))}
              <Ic n="arrowRight" size={18} />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="nx-c" style={{ gap: 16 }}>
        <div className="card rise nx-c nt-cd" style={{ animationDelay: "80ms" }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {tx(p("Replies", "जवाब"))} {sub(p("Replies", "जवाब")) ? <span className="nt-hn">· {sub(p("Replies", "जवाब"))}</span> : null}
          </span>
          {conversation.map((r) => (
            <Bubble key={r.id} teacher who={r.writtenBy === viewer.id ? `${r.writtenByName} (${tx(p("you", "आप"))})` : r.writtenByName} when={replyWhen(r.createdAt)} text={r.body} mine={r.writtenBy === viewer.id} />
          ))}
          {conversation.length === 0 ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(p("No replies yet. The coordinator and class teacher can reply here.", "अभी कोई जवाब नहीं। समन्वयक और कक्षा अध्यापक यहाँ जवाब दे सकते हैं।"))}</span> : null}
          {reply.listening ? (
            <div className="nx-f nt-ani" style={{ gap: 5, height: 28, padding: "0 4px" }}>
              {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => <span key={i} className="nt-wv" style={{ height: Math.round(h * 26), animationDelay: `${i * 120}ms` }} />)}
              <span style={{ marginLeft: 6, fontSize: 13, fontWeight: 700, color: "var(--acc)" }}>{tx(p("Listening… tap the mic to stop", "सुन रहे हैं… रोकने के लिए माइक दबाएँ"))}</span>
            </div>
          ) : null}
          {work ? (
            <div className="nx-f" style={{ gap: 8 }}>
              {/* minWidth 0 lets the box shrink, so Send stays inside a 390px card (ST-18). */}
              <label className="nt-srch" style={{ flex: 1, minWidth: 0, height: 52, borderRadius: 26 }}>
                <span className="sr">{tx(p("Your reply", "आपका जवाब"))}</span>
                <input type="text" style={{ minWidth: 0, width: "100%" }} value={reply.listening ? `${reply.text}${reply.text && reply.live ? " " : ""}${reply.live}` : reply.text} maxLength={1000} onChange={(e) => reply.setText(e.target.value)} placeholder={both(p("Write a reply", "जवाब लिखें"))} />
              </label>
              <button type="button" className="tap" aria-label={reply.listening ? "Stop listening" : "Speak a reply"} onClick={() => reply.mic(language === "en" ? "en-IN" : "hi-IN")} style={{ width: 52, height: 52, borderRadius: 26, border: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: reply.listening ? "var(--bad)" : "var(--accs)", color: reply.listening ? "var(--onsolid)" : "var(--accfg)" }}>
                <Ic n={reply.listening ? "x" : "mic"} size={22} />
              </button>
              <button type="button" className="tap btn pri" aria-label={tx(p("Send reply", "जवाब भेजें"))} disabled={reply.pending} onClick={reply.send} style={{ height: 52, minWidth: 52, flex: "none", borderRadius: 26 }}>
                <Ic n="send" size={18} />
                <span className="hide-m">{tx(p("Send", "भेजें"))}</span>
              </button>
            </div>
          ) : null}
          {reply.error ? <span role="alert" className="nx-m" style={{ color: "var(--warnfg)" }}>{tx(reply.error)}</span> : null}
        </div>
      </div>
    </div>
  );
}
