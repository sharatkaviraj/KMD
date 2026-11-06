"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { agoP, dayMonth, dayMonthHi, shortDayHi } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { SAVE_IDLE, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";
import { appendSpoken, useHeardText, useSpeech } from "@/vx/ui/voice";
import { NoteAssist } from "@/vx/assist/note-assist";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";

import { createNoteAction, undoNoteAction } from "../actions";
import type { ChildChoice, NotesPeople } from "../data";
import {
  excerpt,
  findKids,
  FOLLOW_ON_MAX_DAYS,
  followUpDate,
  followUpLabel,
  followUpWho,
  followOwnerAllowed,
  isSensitiveNote,
  nextOpenAction,
  noteStage,
  NOTE_TAGS,
  parentNoteMessage,
  pickedFollowOn,
  pickerStartClass,
  suggestTags,
  TAG_TEXT,
  type BoardNote,
  type FollowOwner,
  type FollowWhen,
  type NoteTag,
  type Visibility,
} from "../domain/notes";
import { BOARD_TAG, day, ini, nameTone, replaceParams, Seg, StagePill, TEACH_TAG, toneAt, useBoth, useNoteWords, WaBubble } from "./look";
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

/**
 * What a stored draft keeps. `requestId` is the draft's one id, sent with every
 * save of it, so saving a draft whose first save did land returns that note
 * instead of filing a twin (20261106123000). The follow-up and audience came
 * back as "Just noting" / team after a reload before (6 Nov school day); they
 * are optional so drafts stored before them still restore.
 */
type Draft = {
  studentId: string;
  body: string;
  tags: NoteTag[];
  voice: boolean;
  at: number;
  requestId?: string;
  follow?: boolean;
  when?: FollowChoice;
  followOn?: string;
  owner?: FollowOwner | null;
  visibility?: Visibility;
};

/** A fresh id for one draft; empty where the browser has no crypto (the save then runs without one). */
function newRequestId(): string {
  try {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
  } catch {
    return "";
  }
}

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
  /** Tags already picked when the composer opens (the board starts on Studies, as its design does). */
  tags?: NoteTag[];
  /** The school's today, for a follow-up date picked by hand. */
  today: string;
  /** A TEST session: the saving line says so. */
  testSession?: boolean;
};

/** A lost answer is not a failure we can retry: the note may be saved already (U01). */
const NOTE_UNCERTAIN = p("We could not tell whether the note was saved. Your note is still here. Check your connection and the notes list before starting another note.", "पता नहीं चल सका कि नोट सहेजा गया या नहीं। आपका नोट यहीं है। नया नोट शुरू करने से पहले इंटरनेट और नोटों की सूची देखें।");
const NOTE_SAVE_UNSURE = { failed: p("Not confirmed", "पक्का पता नहीं चला") };
const NOTE_KEPT = p("Your note, child and choices are still here.", "आपका नोट, बच्चा और चुनी गई बातें यहीं हैं।");

/** A follow-up choice: one of the three ready days, or a date picked by hand. */
export type FollowChoice = FollowWhen | "pick";

/** The composer's state and its two writes (save, undo). */
export function useComposer(init: ComposerInit) {
  const { tx } = useVx();
  const toast = useToast();
  const first = init.initialStep === "saved" ? "add" : init.initialStep;
  const [step, setStepState] = useState<AddStep>(first);
  const [studentId, setStudentId] = useState<string>(init.initialStudent && init.kids.some((k) => k.id === init.initialStudent) ? init.initialStudent : "");
  const [tags, setTags] = useState<NoteTag[]>(init.tags ?? []);
  const [body, setBody] = useState("");
  const [voice, setVoice] = useState(false);
  const [mode, setMode] = useState<"voice" | "type">("voice");
  const [lang, setLang] = useState<Lang>(init.lang);
  // A plain note is just a note; a follow-up is chosen, not assumed (BUG-11).
  const [follow, setFollow] = useState(false);
  const [when, setWhen] = useState<FollowChoice>("next_monday");
  // A date picked by hand (smoke 20 Oct: "only three fixed days", the PTM was in two weeks).
  const [followOn, setFollowOn] = useState("");
  const [owner, setOwner] = useState<FollowOwner | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("team");
  const [tellParents, setTellParents] = useState(false);
  const [errField, setErrField] = useState<"kid" | "text" | null>(null);
  const [error, setError] = useState<Pair | null>(null);
  const [saveUncertain, setSaveUncertain] = useState(false);
  // The server's refusal of the last save, kept apart from "pick a child" and the like (U01).
  const [refused, setRefused] = useState<Pair | null>(null);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  // One id per draft, kept across every save of it (see Draft).
  const [requestId, setRequestId] = useState<string>("");
  const [heard, setHeard] = useState("");
  const [append, setAppend] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [pending, start] = useTransition();

  const child = init.kids.find((k) => k.id === studentId) ?? null;
  const ownerKey: FollowOwner = owner ?? init.ownerFor(child);
  /** The follow-up day this note would get, or null for a picked date that is not one yet. */
  const followOnDate = when === "pick" ? pickedFollowOn(followOn, init.today) : followUpDate(when, init.today);

  const speech = useSpeech((text) => setHeard((cur) => appendSpoken(cur, text)));

  // A draft from this reader's last visit comes back, so a dropped connection
  // or a closed tab does not lose what was written (RULES G).
  const restored = useRef(false);
  /** Put this reader's stored draft back into the composer; false when there is none for this child. */
  const restoreDraft = (onlyFor: string | null): boolean => {
    const d = readDraft(init.viewer.id);
    if (!d || !d.body) return false;
    if (onlyFor && d.studentId !== onlyFor) return false;
    if (!init.kids.some((k) => k.id === d.studentId)) return false;
    setStudentId(d.studentId);
    setBody(d.body);
    setTags(d.tags.filter((t) => (NOTE_TAGS as readonly string[]).includes(t)));
    setVoice(d.voice);
    setMode("type");
    setDraftAt(d.at);
    if (d.requestId) setRequestId(d.requestId);
    if (typeof d.follow === "boolean") setFollow(d.follow);
    if (d.when) setWhen(d.when);
    if (typeof d.followOn === "string") setFollowOn(d.followOn);
    if (d.owner !== undefined) setOwner(d.owner);
    if (d.visibility === "team" || d.visibility === "private") setVisibility(d.visibility);
    return true;
  };
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    // Restoring a stored draft once, after mount: localStorage is not readable during render.
    restoreDraft(init.initialStudent);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    if (!restored.current || step === "saved") return undefined;
    const t = window.setTimeout(() => {
      if (!body.trim() || !studentId) return;
      const at = Date.now();
      const id = requestId || newRequestId();
      if (id !== requestId) setRequestId(id);
      writeDraft(init.viewer.id, { studentId, body, tags, voice, at, requestId: id || undefined, follow, when, followOn, owner, visibility });
      setDraftAt(at);
    }, 600);
    return () => window.clearTimeout(t);
  }, [body, studentId, tags, voice, step, init.viewer.id, requestId, follow, when, followOn, owner, visibility]);

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
    setStartedAt(t);
    setNow(t);
    speech.start(lang);
  }, [child, init.initialStep, lang, speech]);

  /** Everything heard so far, read at the moment of a tap (the live words never re-render the composer). */
  const liveNow = () => appendSpoken(heard, speech.heard.get()).trim();
  const seconds = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  const doneListening = (back: AddStep) => {
    // Read the words before stop() hands them over and clears the live store.
    const words = liveNow();
    if (speech.listening) speech.stop();
    if (!words) {
      setStep(back === "review" ? "add" : back);
      toast.show({ text: tx(p("Did not catch anything — tap the mic and try again", "कुछ सुनाई नहीं दिया — माइक दबाकर फिर बोलें")) });
      return;
    }
    const text = append && body.trim() ? appendSpoken(body.trim(), words) : words;
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
    setTags(init.tags ?? []);
    setBody("");
    setVoice(false);
    setMode("voice");
    setFollow(false);
    setWhen("next_monday");
    setFollowOn("");
    setOwner(null);
    setVisibility("team");
    setTellParents(false);
    setError(null);
    setErrField(null);
    setSaveUncertain(false);
    setRefused(null);
    setDraftAt(null);
    setRequestId("");
  };

  // What is checked here is checked before the transition starts, so "Saving…" only ever
  // means the note is on its way to the server.
  const save = (onSaved: (id: string, child: ChildChoice) => void) => {
    if (saveUncertain || pending) return;
    setError(null);
    setRefused(null);
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
    if (follow && when === "pick" && !followOnDate) {
      setError(p(`Pick the day to look at this again: after today, within ${FOLLOW_ON_MAX_DAYS} days.`, `फिर से देखने का दिन चुनें: आज के बाद, ${FOLLOW_ON_MAX_DAYS} दिन के अंदर।`));
      return;
    }
    if (!navigator.onLine) {
      setError(p("You are offline. This note has not been saved. Reconnect and tap Save note.", "आप ऑफलाइन हैं। यह नोट सेव नहीं हुआ है। इंटरनेट आने पर नोट सेव करें दबाएँ।"));
      return;
    }
    // The draft's id, made now if the draft was never stored (a quick save).
    const id = requestId || newRequestId();
    if (id !== requestId) setRequestId(id);
    start(async () => {
      try {
        const res = await createNoteAction({
          requestId: id || null,
          studentId: child.id,
          body,
          tags,
          source: voice ? "voice" : "typed",
          needsFollowUp: follow,
          followWhen: follow && when !== "pick" ? when : null,
          followOn: follow && when === "pick" ? followOnDate : null,
          followOwner: follow ? ownerKey : null,
          visibility,
          tellParents: tellParents && visibility === "team" && init.viewer.parentNotes !== false,
        });
        if (res.ok && res.id) {
          writeDraft(init.viewer.id, null);
          setDraftAt(null);
          onSaved(res.id, child);
        } else if (!res.ok) setRefused(res.error);
      } catch {
        // A rejected response may follow a committed save. Keep the text and
        // block another submission in this composer until the history is checked.
        setSaveUncertain(true);
      }
    });
  };

  // The save bar's one saving line (U01). Never "Saved": a confirmed note opens its own saved screen.
  const slow = useSlowSave(pending);
  const saveLine: SaveState = pending
    ? { kind: "saving", slow }
    : saveUncertain
      ? { kind: "failed", message: NOTE_UNCERTAIN }
      : refused
        ? { kind: "failed", message: refused, next: NOTE_KEPT }
        : SAVE_IDLE;
  const saveWords = saveUncertain ? NOTE_SAVE_UNSURE : undefined;

  // A child with an action already open is shown it first: an update on it
  // beats a second note that says the same thing (D-266). Writing a new one
  // is still allowed — it may be about something else.
  const openAction = child ? nextOpenAction(init.notes.filter((n) => n.studentId === child.id)) : null;

  return {
    step, setStep, child, studentId, pickChild, tags, toggleTag, setTags, body, setBody, voice, mode, setMode, lang, switchLang,
    follow, setFollow, when, setWhen, followOn, setFollowOn, followOnDate, owner: ownerKey, setOwner, visibility, pickVisibility, tellParents, toggleTell,
    errField, setErrField, error, saveUncertain, pending, draftAt, listen, doneListening, cancelListening, heard, timer,
    speech, addPhrase, reset, save, openAction, setError, restoreDraft,
    saveLine, saveWords, refused, testSession: init.testSession ?? false,
  };
}

/**
 * The save bar's line: the saving line while a save is out or after it failed,
 * otherwise the problem to fix or who will read the note. The saving line is
 * always mounted, so its change is announced; Try again keeps the child, the
 * words and every choice, and is offered only for a refusal, never for an
 * answer that was lost (that note may be saved already).
 */
export function SaveBarLine({ c, onSaved, idle, style }: { c: Composer; onSaved: (id: string, child: ChildChoice) => void; idle: string; style?: CSSProperties }) {
  const { tx } = useVx();
  const busy = c.saveLine.kind !== "idle";
  return (
    <span className="nx-c" style={{ gap: 0, ...style }}>
      <SaveStatus state={c.saveLine} words={c.saveWords} test={c.testSession} onRetry={c.refused ? () => c.save(onSaved) : undefined} reserve={false} />
      {busy ? null : (
        <span className="nx-m" role={c.error ? "alert" : undefined} style={{ fontSize: style?.fontSize, color: c.error ? "var(--bad)" : undefined, fontWeight: c.error ? 600 : undefined }}>
          {c.error ? tx(c.error) : idle}
        </span>
      )}
    </span>
  );
}

export type Composer = ReturnType<typeof useComposer>;

/* --------------------------------------------------------- shared pieces */

export const BOARD_DATES = "board";

/**
 * The follow-up dates the server can set (FOLLOW_WHEN), with their real days:
 * "Tomorrow · Fri 9 Oct" on the teacher's screen, "Mon 12 Oct · next Monday"
 * on the board's (each as its design writes it). A date picked by hand is
 * the fourth choice, drawn by `FollowDatePick`.
 */
export function followDates(today: string, style?: typeof BOARD_DATES): { key: FollowWhen; label: Pair; date: string }[] {
  const t = followUpDate("tomorrow", today);
  const m = followUpDate("next_monday", today);
  const w = followUpDate("one_week", today);
  if (style === BOARD_DATES) {
    return [
      { key: "tomorrow", label: p(day(t), shortDayHi(t)), date: t },
      { key: "next_monday", label: p(`${day(m)} · next Monday`, `${shortDayHi(m)} · अगला सोमवार`), date: m },
      { key: "one_week", label: p(day(w), shortDayHi(w)), date: w },
    ];
  }
  return [
    { key: "tomorrow", label: p(`Tomorrow · ${day(t)}`, `कल · ${shortDayHi(t)}`), date: t },
    { key: "next_monday", label: p(`Next Monday · ${dayMonth(m)}`, `अगला सोमवार · ${dayMonthHi(m)}`), date: m },
    { key: "one_week", label: p(day(w), shortDayHi(w)), date: w },
  ];
}

/** The three ready days and "Pick a date", which opens a date box (smoke 20 Oct). */
export function FollowDatePick({ c, today, board }: { c: Composer; today: string; board?: boolean }) {
  const { tx } = useVx();
  const dates = followDates(today, board ? BOARD_DATES : undefined);
  const min = followUpDate("tomorrow", today);
  const max = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + FOLLOW_ON_MAX_DAYS);
    return d.toISOString().slice(0, 10);
  })();
  const picked = c.when === "pick" && c.followOnDate;
  return (
    <>
      <div className="nx-f" style={{ flexWrap: "wrap", gap: 6 }}>
        {dates.map((d) => (
          <button key={d.key} type="button" className={`tap chip${c.when === d.key ? " on" : ""}`} aria-pressed={c.when === d.key} onClick={() => c.setWhen(d.key)}>
            {tx(d.label)}
          </button>
        ))}
        <button type="button" className={`tap chip${c.when === "pick" ? " on" : ""}`} aria-pressed={c.when === "pick"} onClick={() => c.setWhen("pick")}>
          <Ic n="calendar" size={14} />
          {picked ? tx(p(day(picked), shortDayHi(picked))) : tx(p("Pick a date", "तारीख़ चुनें"))}
        </button>
      </div>
      {c.when === "pick" ? (
        <label className="field nt-ani" style={{ maxWidth: 260 }}>
          <span>{tx(p("Which day?", "कौन सा दिन?"))}</span>
          <input className="inp" type="date" min={min} max={max} value={c.followOn} onChange={(e) => c.setFollowOn(e.target.value)} style={{ height: 44 }} />
        </label>
      ) : null}
    </>
  );
}

/** The child's open action, offered before a second note (D-266): one line, and "Add update". */
export function OpenActionNotice({ c, base, today, viewerId, onUpdate }: { c: Composer; base: string; today: string; viewerId: string; onUpdate: (href: string) => void }) {
  const { tx } = useVx();
  const a = c.openAction;
  if (!a || !c.child) return null;
  const who = followUpWho(a, viewerId);
  const due = followUpLabel(a.followUpOn, today, dayMonth);
  const meta = [who ? tx(who) : null, due ? tx(due.text) : null].filter(Boolean).join(" · ");
  return (
    <div role="status" className="nx-in" style={{ alignItems: "center", padding: "8px 8px 8px 12px", background: "var(--warns)", color: "var(--warnfg)" }}>
      <Ic n="flag" size={16} />
      <span className="nx-c" style={{ flex: 1, gap: 1 }}>
        <span style={{ fontWeight: 700 }}>{tx(p(`${c.child.name.split(" ")[0]} already has an open action`, `${c.child.name.split(" ")[0]} की एक कार्रवाई पहले से खुली है`))}</span>
        <span className="nx-e" style={{ fontSize: 12 }}>
          {excerpt(a.body, 80)}
          {meta ? ` · ${meta}` : ""}
        </span>
      </span>
      <button type="button" className="tap btn sec nx-s" onClick={() => onUpdate(`${base}?student=${c.child!.id}&note=${a.id}`)} style={{ flex: "none" }}>
        {tx(p("Add update", "अपडेट जोड़ें"))}
      </button>
    </div>
  );
}

/** A child's name, with her SR number and father under it when another child of the class shares the name. */
export function KidName({ kid, size = 15 }: { kid: ChildChoice; size?: number }) {
  const { tx } = useVx();
  return (
    <span className="nx-c" style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
      <span className="nx-e" style={{ fontSize: size, fontWeight: 600 }}>{kid.name}</span>
      {kid.hint ? <span className="nt-hn">{tx(kid.hint)}</span> : null}
    </span>
  );
}

function KidRow({ k, i, teacher, onPick }: { k: ChildChoice; i: number; teacher?: boolean; onPick: (id: string) => void }) {
  const [bg, fg] = nameTone(k.name);
  return (
    <button type="button" className="tap row nx-f nt-ani" onClick={() => onPick(k.id)} style={{ width: "100%", gap: 12, minHeight: 52, padding: "6px 8px", border: 0, borderRadius: 12, background: "transparent", color: "var(--fg)", textAlign: "left", animationDelay: `${Math.min(i, 12) * 40}ms`, font: "inherit" }}>
      <span className="num nx-m" style={{ width: 22, textAlign: "center", fontWeight: 700, fontSize: 12 }}>{k.rollNo ?? ""}</span>
      <span className="nt-av" style={{ width: 34, height: 34, fontSize: 12, background: bg, color: fg }}>{ini(k.name)}</span>
      <KidName kid={k} size={teacher ? 15 : 14} />
      <span className="nx-m">{k.classLabel}</span>
    </button>
  );
}

/**
 * Pick the child (design TchNotes `cp.picking`): recent names, a class, a
 * search, the class list. It opens on the reader's own class and searches
 * that class first, then her other classes (smoke 20 Oct, dev.groups[11]);
 * a reader with no class is told so, not to check the spelling.
 */
export function KidPicker({ kids, notes, viewerId, held, onPick, teacher, initialClass }: { kids: ChildChoice[]; notes: readonly BoardNote[]; viewerId: string; held: readonly string[]; onPick: (id: string) => void; teacher?: boolean; initialClass?: string | null }) {
  const { tx } = useVx();
  const classes = [...new Map(kids.map((k) => [k.classId, k.classLabel])).entries()];
  const [cls, setCls] = useState(() => pickerStartClass(classes.map(([id]) => id), { initial: initialClass, held }));
  const [q, setQ] = useState("");
  if (kids.length === 0) {
    return (
      <div className="nt-nt" role="status" style={{ background: "var(--warns)", color: "var(--warnfg)" }}>
        <Ic n="info" size={18} style={{ marginTop: 1 }} />
        <span>
          {teacher
            ? tx(p("You have no class yet, so there is no child to pick. Ask the office to give you a class.", "आपको अभी कोई कक्षा नहीं मिली, इसलिए कोई बच्चा नहीं दिखेगा। ऑफ़िस से कक्षा दिलवाएँ।"))
            : tx(p("No children are in any class this session yet. The office adds them on admission.", "इस सत्र में अभी किसी कक्षा में बच्चे नहीं हैं। ऑफ़िस प्रवेश पर उन्हें जोड़ता है।"))}
        </span>
      </div>
    );
  }
  const recent: ChildChoice[] = [];
  for (const n of notes) {
    if (n.writtenBy !== viewerId || !n.studentId) continue;
    const k = kids.find((x) => x.id === n.studentId);
    if (k && !recent.includes(k)) recent.push(k);
    if (recent.length >= 5) break;
  }
  const searching = q.trim().length > 0;
  const { here, elsewhere } = findKids(kids, cls, q);
  const limit = searching ? 20 : 80;
  const shown = here.slice(0, limit);
  const others = elsewhere.slice(0, 8);
  const clsLabel = classes.find(([id]) => id === cls)?.[1] ?? "";
  const pickClass = (v: string) => setCls(v);
  return (
    <>
      {recent.length ? (
        <>
          <span className="sech">{tx(p("Recent", "हाल के"))}</span>
          <div className="hs" style={{ display: "flex", gap: 8 }}>
            {recent.map((r) => {
              const [bg, fg] = nameTone(r.name);
              return (
                <button key={r.id} type="button" className="tap chip" onClick={() => onPick(r.id)} style={{ minHeight: 46, height: "auto", padding: "4px 14px 4px 6px" }}>
                  <span className="nt-av" style={{ width: 34, height: 34, fontSize: 12, background: bg, color: fg }}>{ini(r.name)}</span>
                  <span className="nx-c" style={{ lineHeight: 1.15, textAlign: "left" }}>
                    {r.name}
                    <span className="nt-hn">{r.hint ? `${r.classLabel} · ${tx(r.hint)}` : r.classLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      {classes.length > 1 && classes.length <= 4 ? (
        <Seg label="Class" options={classes.map(([id, label]) => ({ value: id, label }))} value={cls} onChange={pickClass} />
      ) : classes.length > 4 ? (
        <select className="inp" aria-label="Class" value={cls} onChange={(e) => pickClass(e.target.value)} style={{ height: 44 }}>
          {classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      ) : null}
      <label className="nt-srch">
        <Ic n="search" size={18} />
        <span className="sr">Find a child</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx(p(`Type a name in ${clsLabel}`, `${clsLabel} में नाम लिखें`))} />
      </label>
      <div className="nx-c">
        {shown.map((k, i) => <KidRow key={k.id} k={k} i={i} teacher={teacher} onPick={onPick} />)}
      </div>
      {here.length > limit ? (
        <span className="nx-m">{tx(p(`${here.length - limit} more in ${clsLabel} — type a name to find them`, `${clsLabel} में ${here.length - limit} और — नाम लिखकर खोजें`))}</span>
      ) : null}
      {searching && others.length ? (
        <>
          <span className="sech">{here.length ? tx(p("Also in your other classes", "आपकी दूसरी कक्षाओं में भी")) : tx(p(`Not in ${clsLabel} — found in your other classes`, `${clsLabel} में नहीं — आपकी दूसरी कक्षाओं में मिले`))}</span>
          <div className="nx-c">
            {others.map((k, i) => <KidRow key={k.id} k={k} i={i} teacher={teacher} onPick={onPick} />)}
          </div>
        </>
      ) : null}
      {searching && here.length === 0 && others.length === 0 ? (
        <span className="nx-m" role="status">{tx(p(`No child by that name in ${clsLabel} or your other classes. Try the first name only.`, `${clsLabel} या आपकी दूसरी कक्षाओं में इस नाम का कोई बच्चा नहीं। सिर्फ़ पहला नाम लिखकर देखें।`))}</span>
      ) : null}
    </>
  );
}

/** The voice bars (design `.bars` / `.wv`). */
function Bars({ heights, delays }: { heights: number[]; delays: number[] }) {
  return (
    <div className="nx-bars" aria-hidden="true">
      {heights.map((h, i) => (
        <i key={i} style={{ height: h, animationDelay: `${delays[i]}s` }} />
      ))}
    </div>
  );
}

const BAR_H = [18, 30, 24, 34, 22, 28, 16];
const BAR_D = [0, 0.12, 0.24, 0.36, 0.18, 0.06, 0.3];

/** Words heard so far, re-rendered on their own as each partial result arrives. */
function useLiveWords(c: Composer) {
  return appendSpoken(c.heard, useHeardText(c.speech.heard)).trim();
}

function ComposerLiveWords({ c }: { c: Composer }) {
  return <LiveWords text={useLiveWords(c)} />;
}

/** The live words, with a caret. */
function LiveWords({ text, empty }: { text: string; empty?: string }) {
  return (
    <>
      {text ? text : empty ? <span style={{ color: "var(--mut)" }}>{empty}</span> : null}
      <span className="nx-caret" />
    </>
  );
}

/**
 * What the composer keeps on this device while the teacher writes. It said
 * "Saved as draft" / "ड्राफ़्ट सहेजा", which read as saved (smoke 20 Oct); it
 * is kept, not saved, and says so.
 */
function keptLine(at: number): Pair {
  const ago = agoP(new Date(at));
  return p(`Kept on this device · ${ago.en} · not saved yet`, `अपने आप रखा गया · ${ago.hi} · अभी सहेजा नहीं`);
}

function speechNote(c: Composer): Pair {
  if (c.speech.errorP) return c.speech.errorP;
  return c.speech.supported ? p("Uses your phone’s own voice typing.", "फ़ोन की अपनी आवाज़ से लिखाई इस्तेमाल होती है।") : p("Speaking is not available here. Use the mic on your keyboard.", "यहाँ बोलना उपलब्ध नहीं। कीबोर्ड का माइक इस्तेमाल करें।");
}

/**
 * Who will read a note, in one line (design `ad.reach`, `cp.route`). A team
 * note is read by every teacher of the class — subject teachers too, by
 * `canSeeNote` — so the line says so (smoke 20 Oct: it named only the
 * coordinator and the office, and a teacher asked whether subject teachers
 * would see her question).
 */
export function readersLine(input: { child: ChildChoice | null; visibility: Visibility; tags: readonly NoteTag[]; viewer: ClientViewer; people: NotesPeople; followOn?: string | null }): Pair {
  const { child, visibility, tags, viewer, people, followOn } = input;
  if (!child) return p("Then speak or type what you noticed.", "फिर बोलें या लिखें कि आपने क्या देखा।");
  if (visibility === "private") return p("Only you can see this note.", "यह नोट सिर्फ़ आप देख सकते हैं।");
  const ct = people.classTeachers[child.classId] ?? null;
  const mine = viewer.heldClassIds.includes(child.classId);
  const follow = followOn ? ` · look again ${day(followOn)}` : "";
  const followHi = followOn ? ` · फिर देखना ${shortDayHi(followOn)}` : "";
  if (isSensitiveNote({ tags })) {
    return mine
      ? p(`You are the class teacher. Only you and the admin can see a health or family note${follow}.`, `आप कक्षा अध्यापक हैं। स्वास्थ्य या परिवार का नोट सिर्फ़ आप और प्रशासक देख सकते हैं${followHi}।`)
      : p(`Only the admin and the class teacher${ct ? ` ${ct}` : ""} can see a health or family note${follow}.`, `स्वास्थ्य या परिवार का नोट सिर्फ़ प्रशासक और कक्षा अध्यापक${ct ? ` ${ct}` : ""} देख सकते हैं${followHi}।`);
  }
  if (mine) {
    const coord = people.coordinator ? `${people.coordinator} (coordinator)` : "the coordinator";
    return p(`You are the class teacher. The class's subject teachers, ${coord} and the office can see it${follow}.`, `आप कक्षा अध्यापक हैं। कक्षा के विषय अध्यापक, समन्वयक और कार्यालय इसे देख सकते हैं${followHi}।`);
  }
  return ct
    ? p(`${ct} (class teacher), the class's other teachers, the coordinator and the office will see it${follow}.`, `${ct} (कक्षा अध्यापक), कक्षा के दूसरे अध्यापक, समन्वयक और कार्यालय इसे देखेंगे${followHi}।`)
    : p(`The class's teachers, the coordinator and the office will see it${follow}.`, `कक्षा के अध्यापक, समन्वयक और कार्यालय इसे देखेंगे${followHi}।`);
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
export function BoardCompose({ c, kids, notes, viewer, people, today, school, base, onSaved, initialClass }: { c: Composer; kids: ChildChoice[]; notes: readonly BoardNote[]; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string; onSaved: (id: string, child: ChildChoice) => void; initialClass?: string | null }) {
  const { tx } = useVx();
  const both = useBoth();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const child = c.child;
  const ct = child ? (people.classTeachers[child.classId] ?? null) : null;
  const on = c.step === "listening";
  const followOn = c.follow ? c.followOnDate : null;
  // "Me" and the role the reader holds are one person: offer one choice (smoke 20 Oct).
  const holds = child ? viewer.heldClassIds.includes(child.classId) : false;
  const me = viewer.isCoordinator ? "coordinator" : viewer.isAdmin ? "admin" : holds ? "class_teacher" : null;
  const whos: { key: FollowOwner; label: string }[] = (
    [
      { key: "me", label: tx(p(`Me (${viewer.name.split(" ")[0]})`, `मैं (${viewer.name.split(" ")[0]})`)) },
      { key: "class_teacher", label: `${tx(p("Class teacher", "कक्षा अध्यापक"))}${ct ? ` · ${ct}` : ""}` },
      { key: "coordinator", label: tx(p("Coordinator", "समन्वयक")) },
      { key: "admin", label: tx(p("Admin", "प्रशासक")) },
    ] as { key: FollowOwner; label: string }[]
  )
    .filter((w) => w.key !== me)
    // A health or family note is for the admin and the class teacher only.
    .filter((w) => followOwnerAllowed(w.key, { tags: c.tags }));
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
              <span className="nx-m">{child ? `${child.classLabel}${child.hint ? ` · ${tx(child.hint)}` : ""}${ct ? ` · ${tx(p("class teacher", "कक्षा अध्यापक"))} ${ct}` : ""}` : tx(p("Tap to choose the child", "बच्चा चुनने के लिए दबाएँ"))}</span>
            </span>
            <span className="nx-m" style={{ color: "var(--acc)", fontWeight: 700 }}>{child ? tx(p("Change", "बदलें")) : tx(p("Choose", "चुनें"))}</span>
          </button>
          <OpenActionNotice c={c} base={base} today={today} viewerId={viewer.id} onUpdate={(href) => router.push(href, { scroll: false })} />

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
                  <ComposerLiveWords c={c} />
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
          <BodyRoom length={c.body.length} />
          {c.errField === "text" ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bad)", marginTop: -8, animation: "xIn .3s var(--ease) both" }}>{tx(p("Speak or type the note first.", "पहले नोट बोलें या लिखें।"))}</span> : null}
          <NoteAssist body={c.body} childName={c.child?.name ?? null} autoTidy={c.voice && !c.speech.listening} onApply={(text, tags) => { c.setBody(text); c.setMode("type"); c.setErrField(null); if (tags?.length) c.setTags(tags); }} />
          <span className="nx-m nx-f" style={{ marginTop: -6, gap: 6 }}>
            <Ic n="cloud" size={16} />
            {c.draftAt && c.body.trim() ? tx(keptLine(c.draftAt)) : tx(p("What you write is kept here until you save", "सहेजने तक आपका लिखा यहीं रखा रहता है"))}
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
              { value: "yes", label: tx(p("Needs follow-up", "फिर से देखना है")) },
            ]}
          />
          {c.follow ? (
            <div className="nx-c" style={{ gap: 8, animation: "xIn .3s var(--ease) both" }}>
              <span className="nx-m" style={{ fontWeight: 700 }}>{tx(p("Follow up on", "फिर कब देखें"))}</span>
              <FollowDatePick c={c} today={today} board />
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
          {viewer.parentNotes === false ? null : (<>
          <button type="button" className="tap card nx-sw" role="switch" aria-checked={c.tellParents} onClick={c.toggleTell}>
            <Ic n="message" size={18} />
            <span className="nx-c" style={{ flex: 1 }}>
              <span className="nx-b">{tx(p("Tell parents", "अभिभावक को बताएँ"))}</span>
              <span className="nx-m">{c.tellParents ? tx(p(`1 family · 1 WhatsApp message · about ${COST}`, `1 परिवार · 1 व्हाट्सऐप संदेश · लगभग ${COST}`)) : tx(p("Off · parents are not told", "बंद · अभिभावक को नहीं बताया जाएगा"))}</span>
            </span>
            <span className={`sw${c.tellParents ? " on" : ""}`}><span /></span>
          </button>
          {c.tellParents && msg ? <WaBubble hi={msg.hi} en={msg.en} foot={tx(p("queued for the office when you save", "सहेजने पर कार्यालय की कतार में"))} /> : null}
          </>)}
        </div>
      </div>
      <div className="glass nx-f nx-msave">
        <SaveBarLine c={c} onSaved={onSaved} idle={tx(readersLine({ child, visibility: c.visibility, tags: c.tags, viewer, people, followOn }))} style={{ flex: 1, minWidth: 200 }} />
        <button type="button" className="tap btn pri mfull" disabled={c.pending || c.saveUncertain} onClick={() => c.save(onSaved)} style={{ height: 52, fontSize: 16, minWidth: 260 }}>
          {c.pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
          {both(p("Save note", "नोट सहेजें"))}
        </button>
      </div>
      <Sheet open={picking} onClose={() => setPicking(false)} icon="user" title={tx(p("Which child?", "कौन सा बच्चा?"))} sub={tx(p("The class teacher of that class sees the note too", "उस कक्षा के अध्यापक भी नोट देखेंगे"))}>
        <div className="nx nx-c" style={{ gap: 10 }}>
          <KidPicker kids={kids} notes={notes} viewerId={viewer.id} held={viewer.heldClassIds} initialClass={initialClass} onPick={(id) => { c.pickChild(id); setPicking(false); }} />
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
export function TeachCompose({ c, kids, notes, viewer, people, today, school, base, onSaved, initialClass }: { c: Composer; kids: ChildChoice[]; notes: readonly BoardNote[]; viewer: ClientViewer; people: NotesPeople; today: string; school: string; base: string; onSaved: (id: string, child: ChildChoice) => void; initialClass?: string | null }) {
  const { tx, sub } = useVx();
  const both = useBoth();
  const router = useRouter();
  const [picking, setPicking] = useState(!c.child);
  const child = c.child;
  const mine = child ? viewer.heldClassIds.includes(child.classId) : false;
  const ct = child ? (people.classTeachers[child.classId] ?? null) : null;
  const sugg = suggestTags(c.body);
  const fromVoice = c.voice && c.body.trim().length > 0;
  const voiceIdle = !c.body && c.mode === "voice";
  const editing = Boolean(c.body) || c.mode === "type";
  const firstName = child ? child.name.split(" ")[0] : "";
  const sensitive = isSensitiveNote({ tags: c.tags });
  const msg = child ? parentNoteMessage({ childName: child.name, teacher: viewer.name, body: c.body.trim() || "…", school }) : null;
  const ready = Boolean(child) && c.body.trim().length > 0;
  // The class teacher writing about her own class is "Me (class teacher)":
  // one person, one choice (smoke 20 Oct offered both).
  const whos: { key: FollowOwner; label: string }[] = ([
    { key: "me", label: mine ? tx(p("Me (class teacher)", "मैं (कक्षा अध्यापक)")) : tx(p("Me", "मैं")) },
    ...(mine ? [] : [{ key: "class_teacher" as const, label: `${tx(p("Class teacher", "कक्षा अध्यापक"))}${ct ? ` · ${ct}` : ""}` }]),
    { key: "coordinator", label: `${tx(p("Coordinator", "समन्वयक"))}${people.coordinator ? ` · ${people.coordinator}` : ""}` },
    { key: "admin", label: tx(p("Admin", "प्रशासक")) },
  ] satisfies { key: FollowOwner; label: string }[]).filter((w) => followOwnerAllowed(w.key, { tags: c.tags }));
  const pick = (id: string) => {
    c.pickChild(id);
    setPicking(false);
  };

  return (
    <div className="nx-c nt-full" style={{ animation: "xPush .36s var(--ease) both" }}>
      <div className="pad stack" style={{ flex: 1, padding: "18px 28px 24px", display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
        <div className="nx-c" style={{ gap: 16 }}>
          <StepCard n={1} title={p("Which child?", "कौन सा बच्चा?")} style={{ borderColor: c.errField === "kid" ? "var(--bad)" : undefined }}>
            {child && !picking ? (
              <div className="nx-f nt-ani" style={{ gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--s2)" }}>
                <span className="nt-av" style={{ width: 46, height: 46, fontSize: 14, background: nameTone(child.name)[0], color: nameTone(child.name)[1] }}>{ini(child.name)}</span>
                <span className="nx-c" style={{ flex: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{child.name}</span>
                  {child.hint ? <span className="nt-hn">{tx(child.hint)}</span> : null}
                  <span className="nx-m" style={{ fontSize: 12 }}>
                    {child.classLabel} · {mine ? tx(p("you are the class teacher", "आप कक्षा अध्यापक हैं")) : `${tx(p("you teach here", "आप यहाँ पढ़ाते हैं"))}${ct ? ` · ${tx(p("class teacher", "कक्षा अध्यापक"))} ${ct}` : ""}`}
                  </span>
                </span>
                <button type="button" className="tap btn sec" onClick={() => setPicking(true)}>{tx(p("Change", "बदलें"))}</button>
              </div>
            ) : (
              <KidPicker kids={kids} notes={notes} viewerId={viewer.id} held={viewer.heldClassIds} initialClass={initialClass} onPick={pick} teacher />
            )}
            <OpenActionNotice c={c} base={base} today={today} viewerId={viewer.id} onUpdate={(href) => router.push(href, { scroll: false })} />
          </StepCard>

          <StepCard
            n={2}
            title={p("What did you notice?", "आपने क्या देखा?")}
            style={{ borderColor: c.errField === "text" ? "var(--bad)" : undefined }}
            right={c.draftAt && c.body.trim() ? (
              // Grey, not green: kept on this device is not saved.
              <span className="pill nt-ani" style={{ background: "var(--s2)", color: "var(--mut)" }}>
                <Ic n="cloud" size={12} />
                {tx(keptLine(c.draftAt))}
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
                <BodyRoom length={c.body.length} />
                <NoteAssist body={c.body} childName={c.child?.name ?? null} autoTidy={c.voice && !c.speech.listening} onApply={(text, tags) => { c.setBody(text); c.setMode("type"); c.setErrField(null); if (tags?.length) c.setTags(tags); }} />
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
                { value: "yes", label: <SegLabel t={p("Needs follow-up", "फिर से देखना है")} /> },
              ]}
            />
            {c.follow ? (
              <div className="nx-c nt-ani" style={{ gap: 10 }}>
                <span className="sech">{tx(p("When", "कब"))}</span>
                <FollowDatePick c={c} today={today} />
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
                  : tx(p(`All of ${firstName || "the child"}’s teachers (class teacher and subject teachers), the coordinator and the office can see it. Parents never see notes.`, `${firstName || "बच्चे"} के सभी अध्यापक (कक्षा अध्यापक और विषय अध्यापक), समन्वयक और कार्यालय इसे देख सकते हैं। माता-पिता नोट कभी नहीं देखते।`))}
            </span>
          </StepCard>

          {viewer.parentNotes === false ? null : (
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
              <span className="nx-m" style={{ fontSize: 12 }}>{c.visibility === "private" ? tx(p("Not for “Only me” notes.", "“सिर्फ़ मैं” नोट के लिए नहीं।")) : tx(p("Off · parents are not told. Turn it on and, when you save, the office sends the parents a WhatsApp.", "बंद · माता-पिता को नहीं बताया जाएगा। चालू करेंगे तो सहेजने पर ऑफ़िस माता-पिता को व्हाट्सऐप भेजेगा।"))}</span>
            )}
          </div>
          )}
        </div>
      </div>
      <div className="glass nt-sbar">
        <span className="nx-c nt-rt" style={{ flex: 1 }}>
          <span className="nt-f14" style={{ fontSize: 14, fontWeight: 700 }}>{child ? tx(p(`Note about ${child.name}`, `${child.name} के बारे में नोट`)) : tx(p("Pick a child first", "पहले बच्चा चुनें"))}</span>
          <SaveBarLine c={c} onSaved={onSaved} idle={tx(readersLine({ child, visibility: c.visibility, tags: c.tags, viewer, people, followOn: c.follow ? c.followOnDate : null }))} style={{ fontSize: 12 }} />
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
  const live = useLiveWords(c);
  const got = !c.speech.listening && Boolean(live);
  return (
    <div className="nx-c nt-full" style={{ alignItems: "center", justifyContent: "center", padding: "24px 20px 32px", gap: 18, textAlign: "center", animation: "xPush .36s var(--ease) both" }}>
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
        {/* Words appear as they are heard: no per-word fade, which read as lag. */}
        {live ? live : <span style={{ color: "var(--mut)" }}>{both(p("Start speaking…", "बोलना शुरू करें…"))}</span>}
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
  // The author first, and "you" only when the author is the viewer: a saved
  // note someone else opens is not theirs (B09).
  const authored = note.writtenBy === viewer.id;
  const out = [{ label: authored ? `${viewer.name} (${tx(p("you", "आप"))})` : note.writtenByName, initials: ini(authored ? viewer.name : note.writtenByName) }];
  if (note.visibility !== "team") return out;
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const mine = note.classId ? viewer.heldClassIds.includes(note.classId) : false;
  if (!mine) out.push({ label: `${ct ?? tx(p("The class teacher", "कक्षा अध्यापक"))} · ${tx(p("class teacher", "कक्षा अध्यापक"))}`, initials: ct ? ini(ct) : "CT" });
  if (isSensitiveNote(note)) {
    out.push({ label: `${people.admin ?? tx(p("Admin", "प्रशासक"))} · ${tx(p("admin", "प्रशासक"))}`, initials: people.admin ? ini(people.admin) : "AD" });
    return out;
  }
  // Every teacher of the class reads a team note (canSeeNote); the chips left
  // the subject teachers out (smoke 20 Oct).
  out.push({ label: tx(p(`${note.classLabel} · subject teachers`, `${note.classLabel} · विषय अध्यापक`)), initials: "ST" });
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
  else if (mine) line.push(tx(p(`The class's subject teachers, ${people.coordinator ? `${people.coordinator} (coordinator)` : "the coordinator"} and the office can see it now.`, "कक्षा के विषय अध्यापक, समन्वयक और कार्यालय अब इसे देख सकते हैं।")));
  else line.push(tx(p(`${ct ?? "The class teacher"} (class teacher), the class's other teachers, the coordinator and the office can see it.`, `${ct ?? "कक्षा अध्यापक"} (कक्षा अध्यापक), कक्षा के दूसरे अध्यापक, समन्वयक और कार्यालय इसे देख सकते हैं।`)));
  if (note.tellParents) line.push(tx(p("A WhatsApp to the parents is queued for the office.", "माता-पिता के लिए व्हाट्सऐप कार्यालय की कतार में है।")));
  if (note.needsFollowUp && note.followUpOn) line.push(tx(p(`Reminder on ${day(note.followUpOn)}.`, `${shortDayHi(note.followUpOn)} को याद दिलाया जाएगा।`)));
  const timeline = notes.filter((n) => n.studentId === note.studentId);
  const who = savedReaders(note, viewer, people, tx);
  const words = useNoteWords(viewer.id);
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
        <span className="sech">{tx(p(`${words.name(note)}’s notes · timeline`, `${words.name(note)} के नोट्स · समय-रेखा`))}</span>
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
                  <span style={{ fontSize: 13, fontWeight: 700, color: me ? "var(--acc)" : "var(--mut)" }}>{me ? tx(p("Just now", "अभी")) : day(n.createdAt)}</span>
                  <span style={{ flex: 1 }} />
                  {n.tags.map((t) => (
                    <span key={t} className="pill" style={{ background: TEACH_TAG[t].bg, color: TEACH_TAG[t].fg }}>{tx(TAG_TEXT[t])}</span>
                  ))}
                  <StagePill stage={stage} />
                </div>
                <span style={{ fontSize: 15 }}>{n.body}</span>
                <span className="nx-m" style={{ fontSize: 12 }}>
                  {n.writtenBy === viewer.id ? `${viewer.name} (${tx(p("you", "आप"))})` : n.writtenByName}
                  {n.needsFollowUp && n.followUpOn ? ` · ${tx(p(`follow up ${day(n.followUpOn)}`, `फिर देखना ${shortDayHi(n.followUpOn)}`))}${words.who(n) ? ` · ${words.who(n)}` : ""}` : ""}
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

/** The longest note the server keeps (`createSchema.body`). */
const NOTE_MAX = 2000;

/**
 * How much room is left, shown only near the end. The box stopped at 2,000
 * characters with no sign of it, and a long dictated note simply lost its
 * last words (teacher replay, 6 Nov 2026).
 */
function BodyRoom({ length }: { length: number }) {
  const { tx } = useVx();
  if (length < NOTE_MAX - 300) return null;
  const left = Math.max(0, NOTE_MAX - length);
  return (
    <span className="nx-m" aria-live="polite" style={{ marginTop: -6, color: left === 0 ? "var(--bad)" : undefined, fontWeight: left === 0 ? 700 : undefined }}>
      {left === 0
        ? tx(p("The note is full (2,000 characters). Save it and write the rest as a second note.", "नोट भर गया (2,000 अक्षर)। इसे सहेजें और बाकी दूसरे नोट में लिखें।"))
        : tx(p(`${left} characters left`, `${left} अक्षर बाकी`))}
    </span>
  );
}
