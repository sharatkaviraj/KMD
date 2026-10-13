"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { agoP, dayMonth, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { useSpeech } from "@/vx/ui/voice";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";

import { createNoteAction, undoNoteAction } from "../actions";
import type { ChildChoice, NotesPeople } from "../data";
import {
  excerpt,
  followUpDate,
  followUpLabel,
  followUpOwnerText,
  isSensitiveNote,
  nextOpenAction,
  noteStage,
  NOTE_TAGS,
  parentNoteMessage,
  suggestTags,
  TAG_TEXT,
  type BoardNote,
  type FollowOwner,
  type FollowWhen,
  type NoteTag,
  type Visibility,
} from "../domain/notes";
import { BOARD_TAG, ini, nameTone, replaceParams, Seg, StagePill, TEACH_TAG, toneAt, useBoth, WaBubble } from "./look";
import type { AddStep, ClientViewer } from "./parts";

/*
 * Add a note (design Notes `add`/`listening`, TchNotes `add`/`listening`/
 * `review`/`saved`). One state for both layouts: the child, the words typed
 * or spoken, tags, the follow-up, who may read it and whether the parents are
 * told — queued for the office, never sent from here.
 */

export const COST = `₹${COST_PER_MESSAGE.toFixed(2)}`;

type Lang = "hi-IN" | "en-IN";

/** "Tap and speak · बोलकर लिखें". */
const SPEAK = p("Tap and speak", "बोलकर लिखें");
const DRAFT_KEY = (viewer: string) => `vx.notes.draft.${viewer}`;

type Draft = { studentId: string; body: string; tags: NoteTag[]; voice: boolean; at: number };

function readDraft(viewer: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(viewer));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(viewer: string, d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(DRAFT_KEY(viewer), JSON.stringify(d));
    else window.localStorage.removeItem(DRAFT_KEY(viewer));
  } catch {
    // Storage blocked: the note is still on screen; only the draft is not kept.
  }
}

export type ComposerInit = {
  kids: ChildChoice[];
  notes: readonly BoardNote[];
  viewer: ClientViewer;
  initialStudent: string | null;
  initialStep: AddStep;
  /** The language the mic starts in. */
  lang: Lang;
  /** Who a new follow-up goes to when the reader holds the child's class, and when she does not. */
  ownerFor: (child: ChildChoice | null) => FollowOwner;
};

/** The composer's state and its two writes (save, undo). */
export function useComposer(init: ComposerInit) {
  const { tx } = useVx();
  const toast = useToast();
  const first = init.initialStep === "saved" ? "add" : init.initialStep;
  const [step, setStepState] = useState<AddStep>(first);
  const [studentId, setStudentId] = useState<string>(init.initialStudent && init.kids.some((k) => k.id === init.initialStudent) ? init.initialStudent : "");
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [body, setBody] = useState("");
  const [voice, setVoice] = useState(false);
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [lang, setLang] = useState<Lang>(init.lang);
  const [follow, setFollow] = useState(true);
  const [when, setWhen] = useState<FollowWhen>("next_monday");
  const [owner, setOwner] = useState<FollowOwner | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("team");
  const [tellParents, setTellParents] = useState(false);
  const [errField, setErrField] = useState<"kid" | "text" | null>(null);
  const [error, setError] = useState<Pair | null>(null);
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [heard, setHeard] = useState("");
  const [append, setAppend] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [pending, start] = useTransition();

  const child = init.kids.find((k) => k.id === studentId) ?? null;
  const ownerKey: FollowOwner = owner ?? init.ownerFor(child);

  const speech = useSpeech((text) => setHeard((cur) => (cur ? `${cur} ${text}` : text)));

  // A draft from this reader's last visit comes back, so a dropped connection
  // or a closed tab does not lose what was written (RULES G).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const d = readDraft(init.viewer.id);
    if (!d || !d.body) return;
    if (init.initialStudent && d.studentId !== init.initialStudent) return;
    if (!init.kids.some((k) => k.id === d.studentId)) return;
    /* eslint-disable react-hooks/set-state-in-effect -- restoring a stored draft once, after mount (localStorage is not readable during render). */
    setStudentId(d.studentId);
    setBody(d.body);
    setTags(d.tags.filter((t) => (NOTE_TAGS as readonly string[]).includes(t)));
    setVoice(d.voice);
    setMode("type");
    setDraftAt(d.at);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [init.viewer.id, init.initialStudent, init.kids]);

  useEffect(() => {
    if (!restored.current || step === "saved") return undefined;
    const t = window.setTimeout(() => {
      if (!body.trim() || !studentId) return;
      const at = Date.now();
      writeDraft(init.viewer.id, { studentId, body, tags, voice, at });
      setDraftAt(at);
    }, 600);
    return () => window.clearTimeout(t);
  }, [body, studentId, tags, voice, step, init.viewer.id]);

  // The listening clock.
  useEffect(() => {
    if (step !== "listening") return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [step]);

  const setStep = (next: AddStep) => {
    setStepState(next);
    replaceParams({ step: next === "add" ? null : next });
  };

  const pickChild = (id: string) => {
    setStudentId(id);
    setOwner(null);
    setErrField(null);
    setError(null);
  };

  const listen = (more: boolean, target: AddStep = "listening") => {
    if (!child) {
      setErrField("kid");
      toast.show({ text: tx(p("First pick the child", "पहले बच्चा चुनें")), tone: "bad" });
      return;
    }
    setHeard("");
    setAppend(more);
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setStep(target);
    speech.start(lang);
  };

  // Opened straight on "listening" (a link, a reload): the mic starts as if tapped.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || init.initialStep !== "listening" || !child) return;
    autoStarted.current = true;
    const t = Date.now();
    /* eslint-disable react-hooks/set-state-in-effect -- the listening clock starts with the mic, once. */
    setStartedAt(t);
    setNow(t);
    /* eslint-enable react-hooks/set-state-in-effect */
    speech.start(lang);
  }, [child, init.initialStep, lang, speech]);

  const live = `${heard}${heard && speech.interim ? " " : ""}${speech.interim}`.trim();
  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  const doneListening = (back: AddStep) => {
    if (speech.listening) speech.stop();
    const words = live;
    if (!words) {
      setStep(back === "review" ? "add" : back);
      toast.show({ text: tx(p("Did not catch anything — tap the mic and try again", "कुछ सुनाई नहीं दिया — माइक दबाकर फिर बोलें")) });
      return;
    }
    const text = append && body.trim() ? `${body.trim()} ${words}` : words;
    setBody(text);
    setVoice(true);
    setMode("voice");
    setTags((cur) => [...new Set([...cur, ...suggestTags(text)])]);
    setErrField(null);
    setHeard("");
    setStep(back);
  };

  const cancelListening = (back: AddStep) => {
    if (speech.listening) speech.stop();
    setHeard("");
    setStep(back);
    toast.show({ text: tx(p("Nothing was saved", "कुछ नहीं सहेजा गया")) });
  };

  const switchLang = (l: Lang) => {
    setLang(l);
    if (step === "listening") {
      speech.stop();
      setHeard("");
      speech.start(l);
    }
  };

  const toggleTag = (t: NoteTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const addPhrase = (phrase: string) => {
    const t = body.trim();
    setBody(t ? `${t}${/[.!?।]$/.test(t) ? " " : ". "}${phrase}` : phrase);
    setMode("type");
    setErrField(null);
  };

  const pickVisibility = (v: Visibility) => {
    setVisibility(v);
    if (v === "private") setTellParents(false);
  };

  const toggleTell = () => {
    if (visibility === "private") {
      toast.show({ text: tx(p("An “Only me” note is not sent to parents", "“सिर्फ़ मैं” नोट माता-पिता को नहीं भेजा जाता")) });
      return;
    }
    setTellParents((v) => !v);
  };

  const reset = (keepChild: boolean) => {
    if (speech.listening) speech.stop();
    setStepState("add");
    replaceParams({ step: null, saved: null });
    if (!keepChild) setStudentId("");
    setTags([]);
    setBody("");
    setVoice(false);
    setMode("voice");
    setFollow(true);
    setWhen("next_monday");
    setOwner(null);
    setVisibility("team");
    setTellParents(false);
    setError(null);
    setErrField(null);
    setSaveUncertain(false);
    setDraftAt(null);
  };

  const save = (onSaved: (id: string, child: ChildChoice) => void) =>
    start(async () => {
      if (saveUncertain) return;
      setError(null);
      if (!child) {
        setErrField("kid");
        setError(p("First pick the child.", "पहले बच्चा चुनें।"));
        return;
      }
      if (!body.trim()) {
        setErrField("text");
        setError(p("Speak or type the note first.", "पहले नोट बोलें या लिखें।"));
        return;
      }
      if (!navigator.onLine) {
        setError(p("You are offline. This note has not been saved. Reconnect and tap Save note.", "आप ऑफलाइन हैं। यह नोट सेव नहीं हुआ है। इंटरनेट आने पर नोट सेव करें दबाएँ।"));
        return;
      }
      try {
        const res = await createNoteAction({
          studentId: child.id,
          body,
          tags,
          source: voice ? "voice" : "typed",
          needsFollowUp: follow,
          followWhen: follow ? when : null,
          followOwner: follow ? ownerKey : null,
          visibility,
          tellParents: tellParents && visibility === "team",
        });
        if (res.ok && res.id) {
          writeDraft(init.viewer.id, null);
          setDraftAt(null);
          onSaved(res.id, child);
        } else if (!res.ok) setError(res.error);
      } catch {
        // A rejected response may follow a committed save. Keep the text and
        // block another submission in this composer until the history is checked.
        setSaveUncertain(true);
        setError(p("The save could not be confirmed. Your note is still here. Check your connection and the notes list before starting another note.", "सेव की पुष्टि नहीं हो सकी। आपका नोट यहाँ है। नया नोट शुरू करने से पहले इंटरनेट और नोटों की सूची जाँचें।"));
      }
    });

  // A child with an action already open is shown it first: an update on it
  // beats a second note that says the same thing (D-266). Writing a new one
  // is still allowed — it may be about something else.
  const openAction = child ? nextOpenAction(init.notes.filter((n) => n.studentId === child.id)) : null;

  return {
    step, setStep, child, studentId, pickChild, tags, toggleTag, setTags, body, setBody, voice, mode, setMode, lang, switchLang,
    follow, setFollow, when, setWhen, owner: ownerKey, setOwner, visibility, pickVisibility, tellParents, toggleTell,
    errField, setErrField, error, saveUncertain, pending, draftAt, listen, doneListening, cancelListening, live, timer,
    speech, addPhrase, reset, save, openAction, setError,
  };
}

export type Composer = ReturnType<typeof useComposer>;

/* --------------------------------------------------------- shared pieces */

/** The follow-up dates the server can set (FOLLOW_WHEN), with their real days. */
export function followDates(today: string): { key: FollowWhen; label: Pair; date: string }[] {
  const t = followUpDate("tomorrow", today);
  const m = followUpDate("next_monday", today);
  const w = followUpDate("one_week", today);
  return [
    { key: "tomorrow", label: p(`Tomorrow · ${shortDay(t)}`, `कल · ${shortDay(t)}`), date: t },
    { key: "next_monday", label: p(`Next Monday · ${dayMonth(m)}`, `अगला सोमवार · ${dayMonth(m)}`), date: m },
    { key: "one_week", label: p(shortDay(w)), date: w },
  ];
}

/** The child's open action, offered before a second note (D-266). */
export function OpenActionNotice({ c, base, today, onUpdate }: { c: Composer; base: string; today: string; onUpdate: (href: string) => void }) {
  const { tx } = useVx();
  const a = c.openAction;
  if (!a || !c.child) return null;
  const who = followUpOwnerText(a);
  const due = followUpLabel(a.followUpOn, today, dayMonth);
  return (
    <div role="status" className="nx-in" style={{ flexDirection: "column", gap: 8, background: "var(--s2)" }}>
      <strong style={{ fontSize: 14 }}>{tx(p(`${c.child.name} already has an open action`, `${c.child.name} की एक कार्रवाई पहले से खुली है`))}</strong>
      <span style={{ fontSize: 14 }}>{excerpt(a.body, 140)}</span>
      {who || due ? (
        <span className="nx-m">
          {[who ? tx(who) : null, due ? tx(due.text) : null].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <span className="nx-f" style={{ flexWrap: "wrap" }}>
        <button type="button" className="tap btn soft nx-s" onClick={() => onUpdate(`${base}?student=${c.child!.id}&note=${a.id}`)}>
          <Ic n="message" size={16} />
          {tx(p("Add update", "अपडेट जोड़ें"))}
        </button>
        <span className="nx-m">{tx(p("Or write a new note if it is about something else.", "अगर बात कुछ और है तो नया नोट लिखें।"))}</span>
      </span>
    </div>
  );
}

/** Pick the child: recent names, a class, a search, the class list (design TchNotes `cp.picking`). */
export function KidPicker({ kids, notes, viewerId, onPick, teacher }: { kids: ChildChoice[]; notes: readonly BoardNote[]; viewerId: string; onPick: (id: string) => void; teacher?: boolean }) {
  const { tx } = useVx();
  const classes = [...new Map(kids.map((k) => [k.classId, k.classLabel])).entries()];
  const [cls, setCls] = useState(classes[0]?.[0] ?? "");
  const [q, setQ] = useState("");
  const recent: ChildChoice[] = [];
  for (const n of notes) {
    if (n.writtenBy !== viewerId || !n.studentId) continue;
    const k = kids.find((x) => x.id === n.studentId);
    if (k && !recent.includes(k)) recent.push(k);
    if (recent.length >= 5) break;
  }
  const needle = q.trim().toLowerCase();
  const pool = needle ? kids.filter((k) => k.name.toLowerCase().includes(needle)) : kids.filter((k) => k.classId === cls);
  const shown = pool.slice(0, 8);
  return (
    <>
      {recent.length ? (
        <>
          <span className="sech">{tx(p("Recent", "हाल के"))}</span>
          <div className="hs" style={{ display: "flex", gap: 8 }}>
            {recent.map((r) => {
              const [bg, fg] = nameTone(r.name);
              return (
                <button key={r.id} type="button" className="tap chip" onClick={() => onPick(r.id)} style={{ height: 46, padding: "0 14px 0 6px" }}>
                  <span className="nt-av" style={{ width: 34, height: 34, fontSize: 12, background: bg, color: fg }}>{ini(r.name)}</span>
                  <span className="nx-c" style={{ lineHeight: 1.15, textAlign: "left" }}>
                    {r.name}
                    <span className="nt-hn">{r.classLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {classes.length > 1 && classes.length <= 4 ? (
        <Seg label="Class" options={classes.map(([id, label]) => ({ value: id, label }))} value={needle ? null : cls} onChange={(v) => { setCls(v); setQ(""); }} />
      ) : classes.length > 4 ? (
        <select className="inp" aria-label="Class" value={cls} onChange={(e) => { setCls(e.target.value); setQ(""); }} style={{ height: 44 }}>
          {classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      ) : null}
      <label className="nt-srch">
        <Ic n="search" size={18} />
        <span className="sr">Find a child</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(p("Type a name", "नाम लिखें"))} />
      </label>
      <div className="nx-c">
        {shown.map((k, i) => {
          const [bg, fg] = nameTone(k.name);
          return (
            <button key={k.id} type="button" className="tap row nx-f nt-ani" onClick={() => onPick(k.id)} style={{ width: "100%", gap: 12, minHeight: 52, padding: "6px 8px", border: 0, borderRadius: 12, background: "transparent", color: "var(--fg)", textAlign: "left", animationDelay: `${Math.min(i, 12) * 40}ms`, font: "inherit" }}>
              <span className="num nx-m" style={{ width: 22, textAlign: "center", fontWeight: 700, fontSize: 12 }}>{k.rollNo ?? ""}</span>
              <span className="nt-av" style={{ width: 34, height: 34, fontSize: 12, background: bg, color: fg }}>{ini(k.name)}</span>
              <span className="nx-e" style={{ flex: 1, fontSize: teacher ? 15 : 14, fontWeight: 600 }}>{k.name}</span>
              <span className="nx-m">{k.classLabel}</span>
            </button>
          );
        })}
      </div>
      <span className="nx-m">
        {pool.length > 8
          ? tx(p(`${pool.length - 8} more in this list — type a name to find them`, `इस सूची में ${pool.length - 8} और — नाम लिखकर खोजें`))
          : pool.length === 0
            ? tx(p("No child with that name. Check the spelling.", "इस नाम का कोई बच्चा नहीं। वर्तनी जाँचें।"))
            : ""}
      </span>
    </>
  );
}

/** The voice bars (design `.bars` / `.wv`). */
function Bars({ heights, delays, width = 5, gap = 4, height = 34, className = "nx-bars", opacity }: { heights: number[]; delays: number[]; width?: number; gap?: number; height?: number; className?: string; opacity?: number }) {
  return (
    <div className={className === "nx-bars" ? "nx-bars" : undefined} aria-hidden="true" style={{ display: "flex", alignItems: "center", gap, height }}>
      {heights.map((h, i) => (
        <i key={i} className={className === "nx-bars" ? undefined : className} style={{ display: "block", width, height: h, borderRadius: 3, animationDelay: `${delays[i]}s`, opacity }} />
      ))}
    </div>
  );
}

const BAR_H = [18, 30, 24, 34, 22, 28, 16];
const BAR_D = [0, 0.12, 0.24, 0.36, 0.18, 0.06, 0.3];

/** The live words, with a caret. */
function LiveWords({ text, empty }: { text: string; empty?: string }) {
  return (
    <>
      {text ? text : empty ? <span style={{ color: "var(--mut)" }}>{empty}</span> : null}
      <span className="nx-caret" />
    </>
  );
}

function speechNote(c: Composer): Pair {
  if (c.speech.error) return p(c.speech.error);
  return c.speech.supported ? p("Uses your phone’s own voice typing.", "फ़ोन की अपनी आवाज़ से लिखाई इस्तेमाल होती है।") : p("Speaking is not available here. Use the mic on your keyboard.", "यहाँ बोलना उपलब्ध नहीं। कीबोर्ड का माइक इस्तेमाल करें।");
}

/** Who will read a note, in one line (design `ad.reach`, `cp.route`). */
export function readersLine(input: { child: ChildChoice | null; visibility: Visibility; tags: readonly NoteTag[]; viewer: ClientViewer; people: NotesPeople; followOn?: string | null }): Pair {
  const { child, visibility, tags, viewer, people, followOn } = input;
  if (!child) return p("Then speak or type what you noticed.", "फिर बोलें या लिखें कि आपने क्या देखा।");
  if (visibility === "private") return p("Only you can see this note.", "यह नोट सिर्फ़ आप देख सकते हैं।");
  const ct = people.classTeachers[child.classId] ?? null;
  const mine = viewer.heldClassIds.includes(child.classId);
  const follow = followOn ? ` · follow-up ${shortDay(followOn)}` : "";
  const followHi = followOn ? ` · फ़ॉलो-अप ${shortDay(followOn)}` : "";
  if (isSensitiveNote({ tags })) {
    return mine
      ? p(`You are the class teacher. Only you and the admin can see a health or family note${follow}.`, `आप कक्षा अध्यापक हैं। स्वास्थ्य या परिवार का नोट सिर्फ़ आप और प्रशासक देख सकते हैं${followHi}।`)
      : p(`Only the admin and the class teacher${ct ? ` ${ct}` : ""} can see a health or family note${follow}.`, `स्वास्थ्य या परिवार का नोट सिर्फ़ प्रशासक और कक्षा अध्यापक${ct ? ` ${ct}` : ""} देख सकते हैं${followHi}।`);
  }
  if (mine) {
    const coord = people.coordinator ? `${people.coordinator} (coordinator)` : "The coordinator";
    return p(`You are the class teacher. ${coord} and the office can see it${follow}.`, `आप कक्षा अध्यापक हैं। समन्वयक और कार्यालय इसे देख सकते हैं${followHi}।`);
  }
  return ct
    ? p(`${ct} (class teacher) will see it too${follow}.`, `${ct} (कक्षा अध्यापक) भी इसे देखेंगे${followHi}।`)
    : p(`The class teacher will see it too${follow}.`, `कक्षा अध्यापक भी इसे देखेंगे${followHi}।`);
}

/* --------------------------------------------------------- board layout */

const BOARD_PHRASES: Pair[] = [
  p("Did not bring homework", "गृहकार्य नहीं लाया"),
  p("Needs extra practice", "अधिक अभ्यास चाहिए"),
  p("Very good effort today", "आज बहुत अच्छी मेहनत"),
  p("Was absent, parents called", "अनुपस्थित था, माता-पिता को फ़ोन किया"),
  p("Please talk to the parents", "कृपया माता-पिता से बात करें"),
];

/**
 * The board's "Add a note" (design Notes `add`, `listening`): the child, a
 * voice card that listens in place, the words, phrases; on the right tags,
 * what should happen, who can see it, tell parents; a sticky save bar.
 */
export function BoardCompose({ c, kids, notes, viewer, people, today, school, base, onSaved }: { c: Composer; kids: ChildChoice[]; notes: readonly BoardNote[]; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string; onSaved: (id: string, child: ChildChoice) => void }) {
  const { tx } = useVx();
  const both = useBoth();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const child = c.child;
  const ct = child ? (people.classTeachers[child.classId] ?? null) : null;
  const on = c.step === "listening";
  const dates = followDates(today);
  const followOn = c.follow ? (dates.find((d) => d.key === c.when)?.date ?? null) : null;
  const me = viewer.isCoordinator ? "coordinator" : viewer.isAdmin ? "admin" : null;
  const whos: { key: FollowOwner; label: string }[] = (
    [
      { key: "me", label: tx(p(`Me (${viewer.name.split(" ")[0]})`, `मैं (${viewer.name.split(" ")[0]})`)) },
      { key: "class_teacher", label: `${tx(p("Class teacher", "कक्षा अध्यापक"))}${ct ? ` · ${ct}` : ""}` },
      { key: "coordinator", label: tx(p("Coordinator", "समन्वयक")) },
      { key: "admin", label: tx(p("Admin", "प्रशासक")) },
    ] as { key: FollowOwner; label: string }[]
  ).filter((w) => w.key !== me);
  const msg = child ? parentNoteMessage({ childName: child.name, teacher: viewer.name, body: c.body.trim() || "…", school }) : null;
  const sensitive = isSensitiveNote({ tags: c.tags });

  return (
    <div className="nx-c" style={{ gap: 16, animation: "xPush .36s var(--ease) both" }}>
      <div className="stack" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
        <div className="nx-c" style={{ gap: 14 }}>
          <button type="button" className="tap card nx-f" onClick={() => setPicking(true)} style={{ padding: "12px 14px", gap: 12, textAlign: "left", color: "var(--fg)", width: "100%", font: "inherit", borderColor: c.errField === "kid" ? "var(--bad)" : undefined }}>
            <span className="nx-ib" style={{ borderRadius: 19, background: "var(--accs)", color: "var(--accfg)" }}>{child ? ini(child.name) : <Ic n="user" size={18} />}</span>
            <span className="nx-c" style={{ flex: 1 }}>
              <span className="nx-v">{child ? child.name : tx(p("Which child?", "कौन सा बच्चा?"))}</span>
              <span className="nx-m">{child ? `${child.classLabel}${ct ? ` · ${tx(p("class teacher", "कक्षा अध्यापक"))} ${ct}` : ""}` : tx(p("Tap to choose the child", "बच्चा चुनने के लिए दबाएँ"))}</span>
            </span>
            <span className="nx-m" style={{ color: "var(--acc)", fontWeight: 700 }}>{child ? tx(p("Change", "बदलें")) : tx(p("Choose", "चुनें"))}</span>
          </button>
          <OpenActionNotice c={c} base={base} today={today} onUpdate={(href) => router.push(href, { scroll: false })} />

          <div className="card nx-c" style={{ padding: "20px 18px", gap: 12, alignItems: "center", textAlign: "center" }}>
            {!on ? (
              <>
                <button type="button" className="tap nx-mic" aria-label="Tap and speak" onClick={() => c.listen(false)}>
                  <Ic n="mic" size={28} />
                </button>
                <span className="nx-v">{tx(SPEAK)} · {SPEAK.hi}</span>
              </>
            ) : (
              <div className="nx-f" style={{ gap: 18, justifyContent: "center" }}>
                <div className="nx-micw">
                  <i />
                  <i />
                  <button type="button" className="tap nx-mic" aria-label="Done speaking" onClick={() => c.doneListening("add")}>
                    <Ic n="mic" size={28} />
                  </button>
                </div>
                <div className="nx-c" style={{ alignItems: "flex-start", gap: 4 }}>
                  <Bars heights={BAR_H} delays={BAR_D} />
                  <span className="num nx-b" style={{ color: "var(--bad)" }}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: "var(--bad)", marginRight: 6, animation: "xPulse 1.6s ease infinite" }} />
                    {c.timer} · {c.speech.listening || !c.speech.error ? tx(p("Listening…", "सुन रहे हैं…")) : tx(p("Stopped", "रुका"))}
                  </span>
                </div>
              </div>
            )}
            <div className="nx-f" style={{ gap: 6 }}>
              {(["hi-IN", "en-IN"] as const).map((l) => (
                <button key={l} type="button" className={`tap chip${c.lang === l ? " on" : ""}`} aria-pressed={c.lang === l} onClick={() => c.switchLang(l)}>
                  {l === "hi-IN" ? "हिंदी" : "English"}
                </button>
              ))}
            </div>
            {on ? (
              <>
                <div className="nx-tr" aria-live="polite">
                  <LiveWords text={c.live} />
                </div>
                <div className="nx-f" style={{ gap: 8, width: "100%" }}>
                  <button type="button" className="tap btn sec" onClick={() => c.cancelListening("add")} style={{ flex: 1, height: 52 }}>{tx(p("Cancel", "रद्द करें"))}</button>
                  <button type="button" className="tap btn pri" onClick={() => c.doneListening("add")} style={{ flex: 2, height: 52, fontSize: 16 }}>
                    <Ic n="check" size={18} />
                    {tx(p("Done", "हो गया"))}
                  </button>
                </div>
              </>
            ) : c.voice && c.body ? (
              <div className="nx-f" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <button type="button" className="tap btn sec nx-s" onClick={() => { c.setBody(""); c.listen(false); }}>
                  <Ic n="refresh" size={16} />
                  {tx(p("Speak again", "फिर बोलें"))}
                </button>
                <button type="button" className="tap btn soft nx-s" onClick={() => c.listen(true)}>
                  <Ic n="plus" size={16} />
                  {tx(p("Add more", "और जोड़ें"))}
                </button>
              </div>
            ) : null}
            <span className="nx-m" role={c.speech.error ? "alert" : undefined}>{tx(speechNote(c))}</span>
          </div>

          <label className="field">
            <span>{tx(p("The note · you can change any word", "नोट · कोई भी शब्द बदल सकते हैं"))}</span>
            <textarea
              className={`inp${c.errField === "text" ? " err" : ""}`}
              aria-label="Note"
              value={c.body}
              maxLength={2000}
              onChange={(e) => { c.setBody(e.target.value); c.setErrField(null); }}
              placeholder={tx(p("Or type here…", "या यहाँ लिखें…"))}
              style={{ minHeight: 110, fontSize: 16 }}
            />
          </label>
          {c.errField === "text" ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)", marginTop: -8, animation: "xIn .3s var(--ease) both" }}>{tx(p("Speak or type the note first.", "पहले नोट बोलें या लिखें।"))}</span> : null}
          <span className="nx-m nx-f" style={{ marginTop: -6, gap: 6 }}>
            <Ic n="cloud" size={16} />
            {c.draftAt && c.body.trim() ? tx(p(`Saved as draft · ${agoP(new Date(c.draftAt)).en}`, `ड्राफ़्ट सहेजा · ${agoP(new Date(c.draftAt)).hi}`)) : tx(p("Drafts save by themselves", "ड्राफ़्ट अपने-आप सहेजे जाते हैं"))}
          </span>
          <span className="sech">{tx(p("Ready-made phrases", "तैयार वाक्य"))}</span>
          <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
            {BOARD_PHRASES.map((ph) => (
              <button key={ph.en} type="button" className="tap chip" onClick={() => c.addPhrase(tx(ph))}>
                <Ic n="plus" size={14} />
                {tx(ph)}
              </button>
            ))}
          </div>
        </div>

        <div className="nx-c" style={{ gap: 14 }}>
          <span className="sech">{tx(p("Tags", "विषय"))}</span>
          <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
            {NOTE_TAGS.map((t) => {
              const sel = c.tags.includes(t);
              const l = BOARD_TAG[t];
              return (
                <button key={t} type="button" className="tap chip" aria-pressed={sel} onClick={() => c.toggleTag(t)} style={{ background: sel ? l.bg : "var(--card)", color: sel ? l.fg : "var(--fg)", borderColor: sel ? l.fg : "var(--bd)", height: 40 }}>
                  <Ic n={l.icon} size={15} />
                  {tx(TAG_TEXT[t])}
                </button>
              );
            })}
          </div>
          <span className="sech" style={{ marginTop: 4 }}>{tx(p("What should happen?", "आगे क्या हो?"))}</span>
          <Seg
            label="What should happen"
            className="nx-bigseg"
            value={c.follow ? "yes" : "no"}
            onChange={(v) => c.setFollow(v === "yes")}
            options={[
              { value: "no", label: tx(p("Just noting", "सिर्फ़ जानकारी")) },
              { value: "yes", label: tx(p("Needs follow-up", "फ़ॉलो-अप चाहिए")) },
            ]}
          />
          {c.follow ? (
            <div className="nx-c" style={{ gap: 8, animation: "xIn .3s var(--ease) both" }}>
              <span className="nx-m" style={{ fontWeight: 700 }}>{tx(p("Follow up on", "फ़ॉलो-अप कब"))}</span>
              <div className="hs" style={{ display: "flex", gap: 6 }}>
                {dates.map((d) => (
                  <button key={d.key} type="button" className={`tap chip${c.when === d.key ? " on" : ""}`} aria-pressed={c.when === d.key} onClick={() => c.setWhen(d.key)}>
                    {tx(d.label)}
                  </button>
                ))}
              </div>
              <span className="nx-m" style={{ fontWeight: 700 }}>{tx(p("Who follows up", "कौन देखेगा"))}</span>
              <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                {whos.map((w) => (
                  <button key={w.key} type="button" className={`tap chip${c.owner === w.key ? " on" : ""}`} aria-pressed={c.owner === w.key} onClick={() => c.setOwner(w.key)}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <span className="sech" style={{ marginTop: 4 }}>{tx(p("Who can see it", "कौन देख सकता है"))}</span>
          <Seg
            label="Who can see it"
            className="nx-bigseg"
            value={c.visibility}
            onChange={c.pickVisibility}
            options={[
              // Health and family notes reach only the admin and the class teacher (D-264).
              { value: "team", label: tx(sensitive ? p("Admin & class teacher", "प्रशासक व कक्षा अध्यापक") : p("Teachers & office", "शिक्षक व कार्यालय")) },
              { value: "private", label: tx(p("Only me", "सिर्फ़ मैं")) },
            ]}
          />
          <button type="button" className="tap card nx-sw" role="switch" aria-checked={c.tellParents} onClick={c.toggleTell}>
            <Ic n="message" size={18} />
            <span className="nx-c" style={{ flex: 1 }}>
              <span className="nx-b">{tx(p("Tell parents", "अभिभावक को बताएँ"))}</span>
              <span className="nx-m">{c.tellParents ? tx(p(`1 family · 1 WhatsApp message · about ${COST}`, `1 परिवार · 1 व्हाट्सऐप संदेश · लगभग ${COST}`)) : tx(p("Off · parents are not told", "बंद · अभिभावक को नहीं बताया जाएगा"))}</span>
            </span>
            <span className={`sw${c.tellParents ? " on" : ""}`}><span /></span>
          </button>
          {c.tellParents && msg ? <WaBubble hi={msg.hi} en={msg.en} foot={tx(p("queued for the office when you save", "सहेजने पर कार्यालय की कतार में"))} /> : null}
        </div>
      </div>
      <div className="glass nx-f nx-msave">
        <span className="nx-m" role={c.error ? "alert" : undefined} style={{ flex: 1, minWidth: 200, color: c.error ? "var(--bad)" : undefined, fontWeight: c.error ? 600 : undefined }}>
          {c.error ? tx(c.error) : tx(readersLine({ child, visibility: c.visibility, tags: c.tags, viewer, people, followOn }))}
        </span>
        <button type="button" className="tap btn pri mfull" disabled={c.pending || c.saveUncertain} onClick={() => c.save(onSaved)} style={{ height: 52, fontSize: 16, minWidth: 260 }}>
          {c.pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
          {both(p("Save note", "नोट सहेजें"))}
        </button>
      </div>
      <Sheet open={picking} onClose={() => setPicking(false)} icon="user" title={tx(p("Which child?", "कौन सा बच्चा?"))} sub={tx(p("The class teacher of that class sees the note too", "उस कक्षा के अध्यापक भी नोट देखेंगे"))}>
        <div className="nx nx-c" style={{ gap: 10 }}>
          <KidPicker kids={kids} notes={notes} viewerId={viewer.id} onPick={(id) => { c.pickChild(id); setPicking(false); }} />
        </div>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------- teacher layout */

const TEACH_PHRASES: Pair[] = [
  p("Needs extra practice", "अधिक अभ्यास चाहिए"),
  p("Did very well today", "आज बहुत अच्छा किया"),
  p("Homework not done", "गृहकार्य नहीं किया"),
  p("Seems unwell", "तबीयत ठीक नहीं लगती"),
  p("Talk to parents", "माता-पिता से बात करें"),
  p("Quiet and alone", "चुप-चुप और अकेला"),
];

function StepCard({ n, title, children, style, right }: { n: number; title: Pair; children?: React.ReactNode; style?: CSSProperties; right?: React.ReactNode }) {
  const { tx, sub } = useVx();
  return (
    <div className="card nx-c nt-cd" style={style}>
      <div className="nt-hd">
        <span className="nt-st">{n}</span>
        <span className="nx-c" style={{ flex: 1 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(title)}</span>
          {sub(title) ? <span className="nt-hn">{sub(title)}</span> : null}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** A two-line segment label: the lead line and the other language under it. */
function SegLabel({ t }: { t: Pair }) {
  const { tx, sub } = useVx();
  return (
    <span className="nx-c" style={{ alignItems: "center", lineHeight: 1.15 }}>
      {tx(t)}
      {sub(t) ? <span className="nt-hn">{sub(t)}</span> : null}
    </span>
  );
}

/**
 * The teacher's "New note" (design TchNotes `add`, `review`): six numbered
 * cards — the child, what you noticed (speak or type), tags, follow-up, who
 * can see it, tell parents — and a sticky save bar.
 */
export function TeachCompose({ c, kids, notes, viewer, people, today, school, base, onSaved }: { c: Composer; kids: ChildChoice[]; notes: readonly BoardNote[]; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string; onSaved: (id: string, child: ChildChoice) => void }) {
  const { tx, sub } = useVx();
  const both = useBoth();
  const router = useRouter();
  const [picking, setPicking] = useState(!c.child);
  const child = c.child;
  const mine = child ? viewer.heldClassIds.includes(child.classId) : false;
  const ct = child ? (people.classTeachers[child.classId] ?? null) : null;
  const dates = followDates(today);
  const followOn = c.follow ? (dates.find((d) => d.key === c.when)?.date ?? null) : null;
  const sugg = suggestTags(c.body);
  const fromVoice = c.voice && c.body.trim().length > 0;
  const voiceIdle = !c.body && c.mode === "voice";
  const editing = Boolean(c.body) || c.mode === "type";
  const firstName = child ? child.name.split(" ")[0] : "";
  const sensitive = isSensitiveNote({ tags: c.tags });
  const msg = child ? parentNoteMessage({ childName: child.name, teacher: viewer.name, body: c.body.trim() || "…", school }) : null;
  const ready = Boolean(child) && c.body.trim().length > 0;
  const whos: { key: FollowOwner; label: string }[] = [
    { key: "me", label: tx(p("Me", "मैं")) },
    { key: "class_teacher", label: `${tx(p("Class teacher", "कक्षा अध्यापक"))}${!mine && ct ? ` · ${ct}` : ""}` },
    { key: "coordinator", label: tx(p("Coordinator", "समन्वयक")) },
    { key: "admin", label: tx(p("Admin", "प्रशासक")) },
  ];
  const pick = (id: string) => {
    c.pickChild(id);
    setPicking(false);
  };

  return (
    <div className="nx-c" style={{ minHeight: "calc(100dvh - 64px)", animation: "xPush .36s var(--ease) both" }}>
      <div className="pad stack" style={{ flex: 1, padding: "18px 28px 24px", display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="nx-c" style={{ gap: 16 }}>
          <StepCard n={1} title={p("Which child?", "कौन सा बच्चा?")} style={{ borderColor: c.errField === "kid" ? "var(--bad)" : undefined }}>
            {child && !picking ? (
              <div className="nx-f nt-ani" style={{ gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--s2)" }}>
                <span className="nt-av" style={{ width: 46, height: 46, fontSize: 14, background: nameTone(child.name)[0], color: nameTone(child.name)[1] }}>{ini(child.name)}</span>
                <span className="nx-c" style={{ flex: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{child.name}</span>
                  <span className="nx-m" style={{ fontSize: 12 }}>
                    {child.classLabel} · {mine ? tx(p("you are the class teacher", "आप कक्षा अध्यापक हैं")) : `${tx(p("you teach here", "आप यहाँ पढ़ाते हैं"))}${ct ? ` · ${tx(p("class teacher", "कक्षा अध्यापक"))} ${ct}` : ""}`}
                  </span>
                </span>
                <button type="button" className="tap btn sec" onClick={() => setPicking(true)}>{tx(p("Change", "बदलें"))}</button>
              </div>
            ) : (
              <KidPicker kids={kids} notes={notes} viewerId={viewer.id} onPick={pick} teacher />
            )}
            <OpenActionNotice c={c} base={base} today={today} onUpdate={(href) => router.push(href, { scroll: false })} />
          </StepCard>

          <StepCard
            n={2}
            title={p("What did you notice?", "आपने क्या देखा?")}
            style={{ borderColor: c.errField === "text" ? "var(--bad)" : undefined }}
            right={c.draftAt && c.body.trim() ? (
              <span className="pill nt-ani" style={{ background: "var(--oks)", color: "var(--ok)" }}>
                <Ic n="cloud" size={12} />
                {tx(p(`Saved as draft · ${agoP(new Date(c.draftAt)).en}`, `ड्राफ़्ट सहेजा · ${agoP(new Date(c.draftAt)).hi}`))}
              </span>
            ) : undefined}
          >
            {voiceIdle ? (
              <div className="nx-c nt-ani" style={{ alignItems: "center", gap: 12, padding: "16px 8px 8px", textAlign: "center" }}>
                <button type="button" className="tap nx-c" onClick={() => c.listen(false)} aria-label="Tap and speak" style={{ alignItems: "center", gap: 10, border: 0, background: "transparent", color: "var(--fg)", font: "inherit" }}>
                  <span className="nt-micbig"><Ic n="mic" size={30} /></span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(SPEAK)} · {SPEAK.hi}</span>
                </button>
                <div className="nx-f" style={{ gap: 6 }}>
                  {(["hi-IN", "en-IN"] as const).map((l) => (
                    <button key={l} type="button" className={`tap chip${c.lang === l ? " on" : ""}`} aria-pressed={c.lang === l} onClick={() => c.switchLang(l)}>
                      {l === "hi-IN" ? "हिंदी" : "English"}
                    </button>
                  ))}
                </div>
                <button type="button" className="tap btn ghost" onClick={() => c.setMode("type")} style={{ color: "var(--acc)" }}>
                  <Ic n="keyboard" size={18} />
                  {both(p("Type instead", "लिखकर"))}
                </button>
              </div>
            ) : null}
            {editing ? (
              <>
                {fromVoice ? (
                  <div className="nt-nt nt-ani" style={{ background: "var(--infos)", color: "var(--info)" }}>
                    <Ic n="mic" size={18} style={{ marginTop: 1 }} />
                    <span>
                      <b>{tx(p("Written from your voice.", "आवाज़ से लिखा गया।"))}</b> {tx(p("Check the words — tap the text to fix anything.", "शब्द जाँचें — कुछ ठीक करना हो तो टेक्स्ट पर टैप करें।"))}
                      {sub(p("Written from your voice", "आवाज़ से लिखा")) ? ` · ${sub(p("Written from your voice", "आवाज़ से लिखा"))}` : ""}
                    </span>
                  </div>
                ) : null}
                <label className="field">
                  <span className="sr">Your note</span>
                  <textarea
                    className={`inp${c.errField === "text" ? " err" : ""}`}
                    aria-label="Note"
                    value={c.body}
                    maxLength={2000}
                    onChange={(e) => { c.setBody(e.target.value); c.setErrField(null); }}
                    placeholder={tx(p("What did you notice? For example: Finds fractions hard", "आपने क्या देखा? जैसे: भिन्न में दिक्कत"))}
                    style={{ minHeight: 120, fontSize: 16 }}
                  />
                </label>
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 8 }}>
                  <button type="button" className="tap btn soft" onClick={() => (fromVoice ? (c.setBody(""), c.listen(false)) : c.listen(Boolean(c.body.trim())))}>
                    <Ic n="mic" size={18} />
                    {!c.body ? tx(p("Speak instead", "बोलकर लिखें")) : fromVoice ? tx(p("Speak again", "फिर बोलें")) : tx(p("Add by speaking", "बोलकर जोड़ें"))}
                  </button>
                  {fromVoice ? (
                    <button type="button" className="tap btn ghost" onClick={() => c.listen(true)}>
                      <Ic n="plus" size={18} />
                      {tx(p("Add more", "और जोड़ें"))}
                    </button>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span className="nx-m" style={{ fontSize: 12 }}>{tx(speechNote(c))}</span>
                </div>
              </>
            ) : null}
            {!(fromVoice && c.body) ? (
              <>
                <span className="sech" style={{ marginTop: 4 }}>{both(p("Quick phrases", "झटपट वाक्य"))}</span>
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  {TEACH_PHRASES.map((ph) => (
                    <button key={ph.en} type="button" className="tap nt-qp" onClick={() => c.addPhrase(c.lang === "hi-IN" ? ph.hi! : ph.en)}>
                      {tx(ph)}
                      {sub(ph) ? <span className="nt-hn">{sub(ph)}</span> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </StepCard>
        </div>

        <div className="nx-c" style={{ gap: 16 }}>
          <StepCard n={3} title={p("Tags", "विषय चुनें")}>
            <div className="nx-f" style={{ flexWrap: "wrap", gap: 8 }}>
              {NOTE_TAGS.map((t) => {
                const sel = c.tags.includes(t);
                const sg = !sel && sugg.includes(t);
                const l = TEACH_TAG[t];
                const line = sg ? tx(p("✦ Suggested", "✦ सुझाया गया")) : sel && fromVoice && sugg.includes(t) ? tx(p("✦ From your words", "✦ आपके शब्दों से")) : sub(TAG_TEXT[t]);
                return (
                  <button key={t} type="button" className="tap chip" aria-pressed={sel} onClick={() => c.toggleTag(t)} style={{ height: 44, padding: "0 14px", background: sel ? l.fg : sg ? l.bg : "var(--card)", color: sel ? "var(--onsolid)" : sg ? l.fg : "var(--fg)", border: sel ? "1px solid transparent" : sg ? `1.5px dashed ${l.fg}` : "1px solid var(--bd)" }}>
                    <Ic n={l.icon} size={16} />
                    <span className="nx-c" style={{ lineHeight: 1.1, textAlign: "left" }}>
                      {tx(TAG_TEXT[t])}
                      {line ? <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.8 }}>{line}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </StepCard>

          <StepCard n={4} title={p("Follow-up", "आगे क्या करना है")}>
            <Seg
              label="Follow-up"
              className="nt-sg"
              value={c.follow ? "yes" : "no"}
              onChange={(v) => c.setFollow(v === "yes")}
              options={[
                { value: "no", label: <SegLabel t={p("Just noting", "सिर्फ़ नोट")} /> },
                { value: "yes", label: <SegLabel t={p("Needs follow-up", "ध्यान देना है")} /> },
              ]}
            />
            {c.follow ? (
              <div className="nx-c nt-ani" style={{ gap: 10 }}>
                <span className="sech">{tx(p("When", "कब"))}</span>
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  {dates.map((d) => (
                    <button key={d.key} type="button" className={`tap chip${c.when === d.key ? " on" : ""}`} aria-pressed={c.when === d.key} onClick={() => c.setWhen(d.key)}>
                      {tx(d.label)}
                    </button>
                  ))}
                </div>
                <span className="sech">{tx(p("Who follows up", "कौन देखेगा"))}</span>
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  {whos.map((w) => (
                    <button key={w.key} type="button" className={`tap chip${c.owner === w.key ? " on" : ""}`} aria-pressed={c.owner === w.key} onClick={() => c.setOwner(w.key)}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <span className="nx-m nt-ani" style={{ fontSize: 12 }}>{tx(p("Just noting — it is kept on the child’s record. No reminder.", "सिर्फ़ नोट — बच्चे के रिकॉर्ड में रहेगा। कोई याद नहीं दिलाया जाएगा।"))}</span>
            )}
          </StepCard>

          <StepCard n={5} title={p("Who can see it", "कौन देख सकता है")}>
            <Seg
              label="Who can see it"
              className="nt-sg"
              value={c.visibility}
              onChange={c.pickVisibility}
              options={[
                { value: "team", label: <SegLabel t={sensitive ? p("Admin & class teacher", "प्रशासक व कक्षा अध्यापक") : p("Teachers & office", "शिक्षक व ऑफिस")} /> },
                { value: "private", label: <SegLabel t={p("Only me", "सिर्फ़ मैं")} /> },
              ]}
            />
            <span className="nx-m" style={{ fontSize: 12 }}>
              {c.visibility === "private"
                ? tx(p("Only you will see this note. Good for private thoughts.", "यह नोट सिर्फ़ आप देखेंगे। निजी बातों के लिए ठीक।"))
                : sensitive
                  ? tx(p(`A health or family note: only the admin and ${firstName ? `${firstName}’s` : "the"} class teacher can see it. Parents never see notes.`, "स्वास्थ्य या परिवार का नोट: सिर्फ़ प्रशासक और कक्षा अध्यापक देख सकते हैं। माता-पिता नोट कभी नहीं देखते।"))
                  : tx(p(`Teachers of ${firstName || "the child"}, the coordinator and the office can see it. Parents never see notes.`, `${firstName || "बच्चे"} के शिक्षक, समन्वयक और कार्यालय इसे देख सकते हैं। माता-पिता नोट कभी नहीं देखते।`))}
            </span>
          </StepCard>

          <div className="card nx-c nt-cd">
            <button type="button" className="tap nx-f" role="switch" aria-checked={c.tellParents && c.visibility === "team"} onClick={c.toggleTell} style={{ gap: 12, width: "100%", padding: 0, border: 0, background: "transparent", color: "var(--fg)", textAlign: "left", opacity: c.visibility === "private" ? 0.5 : 1, font: "inherit" }}>
              <span className="nt-st">6</span>
              <span className="nx-c" style={{ flex: 1 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(p("Tell parents", "माता-पिता को बताएँ"))}</span>
                <span className="nt-hn">{sub(p("Tell parents", "माता-पिता को बताएँ")) ? `${sub(p("Tell parents", "माता-पिता को बताएँ"))} · ` : ""}{tx(p("optional", "वैकल्पिक"))}</span>
              </span>
              <span className={`sw${c.tellParents && c.visibility === "team" ? " on" : ""}`}><span /></span>
            </button>
            {c.tellParents && c.visibility === "team" && msg ? (
              <>
                <div className="nt-wa nt-ani">
                  <div>
                    <span lang="hi">{msg.hi}</span>
                    <span style={{ marginTop: 6, opacity: 0.8 }}>{msg.en}</span>
                    <span style={{ fontSize: 11, textAlign: "right", opacity: 0.6 }}>{tx(p("queued after you save", "सहेजने के बाद कतार में"))}</span>
                  </div>
                </div>
                <span className="nx-m" style={{ fontSize: 12 }}>{tx(p(`Queued for the office to send · 1 WhatsApp from the school’s number · about ${COST}`, `कार्यालय भेजेगा · स्कूल के नंबर से 1 व्हाट्सऐप · लगभग ${COST}`))}</span>
              </>
            ) : (
              <span className="nx-m" style={{ fontSize: 12 }}>{c.visibility === "private" ? tx(p("Not for “Only me” notes.", "“सिर्फ़ मैं” नोट के लिए नहीं।")) : tx(p("Off · parents are not told. Turn on to queue a WhatsApp after saving.", "बंद · माता-पिता को नहीं बताया जाएगा। सहेजने के बाद व्हाट्सऐप के लिए चालू करें।"))}</span>
            )}
          </div>
        </div>
      </div>
      <div className="glass nt-sbar">
        <span className="nx-c nt-rt" style={{ flex: 1 }}>
          <span className="nt-f14" style={{ fontSize: 14, fontWeight: 700 }}>{child ? tx(p(`Note about ${child.name}`, `${child.name} के बारे में नोट`)) : tx(p("Pick a child first", "पहले बच्चा चुनें"))}</span>
          <span className="nx-m" role={c.error ? "alert" : undefined} style={{ fontSize: 12, color: c.error ? "var(--bad)" : undefined, fontWeight: c.error ? 600 : undefined }}>
            {c.error ? tx(c.error) : tx(readersLine({ child, visibility: c.visibility, tags: c.tags, viewer, people, followOn: null }))}
          </span>
        </span>
        <button type="button" className="tap btn pri nt-big mfull" disabled={c.pending || c.saveUncertain} onClick={() => c.save(onSaved)} style={{ opacity: ready ? 1 : 0.6 }}>
          {c.pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
          {both(p("Save note", "नोट सहेजें"))}
        </button>
      </div>
    </div>
  );
}

/** The teacher's full-screen listening (design TchNotes `listening`). */
export function TeachListening({ c }: { c: Composer }) {
  const { tx } = useVx();
  const both = useBoth();
  const kid = c.child?.name ?? "";
  const got = !c.speech.listening && Boolean(c.live);
  return (
    <div className="nx-c" style={{ minHeight: "calc(100dvh - 64px)", alignItems: "center", justifyContent: "center", padding: "24px 20px 32px", gap: 18, textAlign: "center", animation: "xPush .36s var(--ease) both" }}>
      <span className="pill" style={{ height: 32, padding: "0 12px 0 4px", fontSize: 13, background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)" }}>
        <span className="nt-av" style={{ width: 24, height: 24, fontSize: 10, background: "var(--accs)", color: "var(--accfg)" }}>{ini(kid)}</span>
        {tx(p(`Note about ${kid}`, `${kid} के बारे में नोट`))}
      </span>
      <span style={{ position: "relative", width: 96, height: 96, margin: "34px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="nt-rip" style={{ opacity: 0.35 }} />
        <span className="nt-rip" style={{ opacity: 0.35, animationDelay: ".8s" }} />
        <button type="button" className="tap nt-micbig" aria-label={c.speech.listening ? "Stop listening" : "Speak"} onClick={() => (c.speech.listening ? c.speech.stop() : c.speech.start(c.lang))} style={{ position: "relative", width: 96, height: 96, borderRadius: 48, border: 0 }}>
          <Ic n="mic" size={40} />
        </button>
      </span>
      <span className="nx-f" style={{ gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <span className="serif" style={{ fontSize: 26, fontWeight: 600 }}>{got ? both(p("Got it", "तैयार")) : both(p("Listening…", "सुन रहे हैं"))}</span>
        <span className="pill num" style={{ height: 28, padding: "0 10px", fontSize: 13, background: "var(--bads)", color: "var(--bad)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--bad)", animation: "xCaret 1s steps(1) infinite" }} />
          {c.timer}
        </span>
      </span>
      <div className="nx-f" style={{ gap: 6, height: 52 }} aria-hidden="true">
        {[0.5, 0.8, 1, 0.7, 0.9, 0.6, 0.4].map((h, i) => (
          <span key={i} className="nt-wv" style={{ height: Math.round(h * 48), animationDelay: `${i * 110}ms`, opacity: got ? 0.35 : 1 }} />
        ))}
      </div>
      <div className="nx-f" style={{ gap: 6 }}>
        {(["hi-IN", "en-IN"] as const).map((l) => (
          <button key={l} type="button" className={`tap chip${c.lang === l ? " on" : ""}`} aria-pressed={c.lang === l} onClick={() => c.switchLang(l)}>
            {l === "hi-IN" ? "हिंदी" : "English"}
          </button>
        ))}
      </div>
      <div className="card" aria-live="polite" style={{ width: "100%", maxWidth: 640, minHeight: 132, padding: "20px 22px", textAlign: "left", fontSize: 20, lineHeight: 1.6 }}>
        {c.live ? c.live.split(" ").map((w, i) => <span key={i} className="nt-wd">{w} </span>) : <span style={{ color: "var(--mut)" }}>{both(p("Start speaking…", "बोलना शुरू करें…"))}</span>}
        <span className="nt-caret" />
      </div>
      <div className="nx-f" style={{ gap: 10, width: "100%", maxWidth: 640 }}>
        <button type="button" className="tap btn sec nt-big" onClick={() => c.cancelListening(c.body ? "review" : "add")} style={{ flex: 1 }}>
          <Ic n="x" size={18} />
          {both(p("Cancel", "रद्द"))}
        </button>
        <button type="button" className="tap btn pri nt-big" onClick={() => c.doneListening("review")} style={{ flex: 1.5 }}>
          <Ic n="check" size={18} />
          {both(p("Done", "हो गया"))}
        </button>
      </div>
      <span className="nx-m" role={c.speech.error ? "alert" : undefined} style={{ fontSize: 12 }}>{tx(speechNote(c))}</span>
    </div>
  );
}

/** Who can read a saved note, as names (design TchNotes `sv.who`). */
function savedReaders(note: BoardNote, viewer: ClientViewer, people: NotesPeople, tx: (p: Pair) => string): { label: string; initials: string }[] {
  const out = [{ label: `${viewer.name} (${tx(p("you", "आप"))})`, initials: ini(viewer.name) }];
  if (note.visibility !== "team") return out;
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const mine = note.classId ? viewer.heldClassIds.includes(note.classId) : false;
  if (!mine) out.push({ label: `${ct ?? tx(p("The class teacher", "कक्षा अध्यापक"))} · ${tx(p("class teacher", "कक्षा अध्यापक"))}`, initials: ct ? ini(ct) : "CT" });
  if (isSensitiveNote(note)) {
    out.push({ label: `${people.admin ?? tx(p("Admin", "प्रशासक"))} · ${tx(p("admin", "प्रशासक"))}`, initials: people.admin ? ini(people.admin) : "AD" });
    return out;
  }
  out.push({ label: `${people.coordinator ?? tx(p("Coordinator", "समन्वयक"))} · ${tx(p("coordinator", "समन्वयक"))}`, initials: people.coordinator ? ini(people.coordinator) : "CO" });
  out.push({ label: tx(p("Office", "कार्यालय")), initials: "OF" });
  return out;
}

/** The teacher's "Saved" screen (design TchNotes `saved`): the tick, who can see it, the child's timeline, Undo. */
export function TeachSaved({ note, notes, viewer, people, onUndo, onPlan, onDone, onAnother, pending }: { note: BoardNote; notes: readonly BoardNote[]; viewer: ClientViewer; people: NotesPeople; onUndo: () => void; onPlan: () => void; onDone: () => void; onAnother: () => void; pending: boolean }) {
  const { tx } = useVx();
  const both = useBoth();
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const mine = note.classId ? viewer.heldClassIds.includes(note.classId) : false;
  const line: string[] = [];
  if (note.visibility !== "team") line.push(tx(p("Only you can see this note.", "यह नोट सिर्फ़ आप देख सकते हैं।")));
  else if (isSensitiveNote(note)) line.push(tx(p("Only the admin and the class teacher can see it now.", "अब सिर्फ़ प्रशासक और कक्षा अध्यापक इसे देख सकते हैं।")));
  else if (mine) line.push(tx(p(`${people.coordinator ? `${people.coordinator} (coordinator)` : "The coordinator"} and the office can see it now.`, "समन्वयक और कार्यालय अब इसे देख सकते हैं।")));
  else line.push(tx(p(`${ct ?? "The class teacher"} (class teacher) and the coordinator can see this.`, `${ct ?? "कक्षा अध्यापक"} (कक्षा अध्यापक) और समन्वयक इसे देख सकते हैं।`)));
  if (note.tellParents) line.push(tx(p("A WhatsApp to the parents is queued for the office.", "माता-पिता के लिए व्हाट्सऐप कार्यालय की कतार में है।")));
  if (note.needsFollowUp && note.followUpOn) line.push(tx(p(`Reminder on ${shortDay(note.followUpOn)}.`, `${shortDay(note.followUpOn)} को याद दिलाया जाएगा।`)));
  const timeline = notes.filter((n) => n.studentId === note.studentId);
  const who = savedReaders(note, viewer, people, tx);
  return (
    <div className="pad nx-c" style={{ padding: "26px 28px 40px", gap: 18, maxWidth: 780, margin: "0 auto", width: "100%", animation: "xPush .36s var(--ease) both" }}>
      <div className="nx-c" style={{ alignItems: "center", gap: 10, textAlign: "center" }}>
        <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true" style={{ animation: "xPopIn .5s var(--spring) both" }}>
          <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
          <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: 276.5, strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
          <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 60, strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
        </svg>
        <h2 className="serif" style={{ margin: 0, fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{both(p("Saved", "सहेजा गया"))}</h2>
        <span className="nt-f15" style={{ fontSize: 15, color: "var(--mut)", maxWidth: 520 }}>{line.join(" ")}</span>
        <div className="nx-f" style={{ flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {who.map((w, i) => (
            <span key={w.label} className="pill nt-ani" style={{ height: 30, padding: "0 12px 0 4px", fontSize: 12, background: "var(--card)", color: "var(--fg)", border: "1px solid var(--bd)", animationDelay: `${300 + i * 90}ms` }}>
              <span className="nt-av" style={{ width: 22, height: 22, fontSize: 10, background: toneAt(i)[0], color: toneAt(i)[1] }}>{w.initials}</span>
              {w.label}
            </span>
          ))}
        </div>
      </div>
      <div className="nx-c" style={{ gap: 10 }}>
        <span className="sech">{tx(p(`${note.studentName}’s notes · timeline`, `${note.studentName} के नोट्स · समय-रेखा`))}</span>
        {timeline.map((n) => {
          const me = n.id === note.id;
          const stage = noteStage(n);
          return (
            <div key={n.id} style={{ display: "grid", gridTemplateColumns: "22px minmax(0,1fr)", gap: 10 }}>
              <span style={{ position: "relative", display: "flex", justifyContent: "center" }}>
                <span style={{ position: "absolute", top: 0, bottom: -10, width: 2, background: "var(--bd)" }} />
                <span style={{ position: "relative", marginTop: 18, width: 14, height: 14, borderRadius: 7, background: me ? "var(--acc)" : "var(--bds)", boxShadow: "0 0 0 3px var(--bg)" }} />
              </span>
              <div className="card nx-c" style={{ padding: "14px 16px", gap: 8, border: me ? "2px solid var(--acc)" : "1px solid var(--bd)", opacity: me ? 1 : 0.75, animation: me ? "xRise .6s .35s var(--ease) both" : "xIn .3s var(--ease) both" }}>
                <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: me ? "var(--acc)" : "var(--mut)" }}>{me ? tx(p("Just now", "अभी")) : shortDay(n.createdAt)}</span>
                  <span style={{ flex: 1 }} />
                  {n.tags.map((t) => (
                    <span key={t} className="pill" style={{ background: TEACH_TAG[t].bg, color: TEACH_TAG[t].fg }}>{tx(TAG_TEXT[t])}</span>
                  ))}
                  <StagePill stage={stage} />
                </div>
                <span style={{ fontSize: 15 }}>{n.body}</span>
                <span className="nx-m" style={{ fontSize: 12 }}>
                  {n.writtenBy === viewer.id ? `${viewer.name} (${tx(p("you", "आप"))})` : n.writtenByName}
                  {n.needsFollowUp && n.followUpOn ? ` · ${tx(p("follow up", "फ़ॉलो-अप"))} ${shortDay(n.followUpOn)}` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="nx-f" style={{ flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        <button type="button" className="tap btn sec nt-big" disabled={pending} onClick={onUndo}>
          <Ic n="undo" size={18} />
          {tx(p("Undo", "वापस लें"))}
        </button>
        {note.studentId ? (
          <button type="button" className="tap btn soft nt-big" onClick={onPlan}>
            <Ic n="layers" size={18} />
            {tx(p("Make a support plan", "सहायता योजना बनाएँ"))}
          </button>
        ) : null}
        <button type="button" className="tap btn pri nt-big" onClick={onDone}>
          <Ic n="check" size={18} />
          {tx(p("Done · all notes", "हो गया · सभी नोट्स"))}
        </button>
      </div>
      <button type="button" className="tap btn ghost" onClick={onAnother} style={{ alignSelf: "center", color: "var(--acc)" }}>
        <Ic n="mic" size={18} />
        {tx(p("Speak another note", "एक और नोट बोलें"))}
      </button>
    </div>
  );
}

/** Undo straight after saving, and say so. */
export function useUndo() {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const undo = (noteId: string, after: () => void) =>
    start(async () => {
      const res = await undoNoteAction(noteId);
      if (res.ok) {
        toast.show({ text: tx(p("Note taken back — nothing was saved", "नोट वापस लिया — कुछ नहीं सहेजा गया")) });
        after();
        router.refresh();
      } else toast.show({ text: tx(res.error), tone: "bad" });
    });
  return { undo, pending };
}
