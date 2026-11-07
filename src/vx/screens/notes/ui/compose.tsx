"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";

import { useVx } from "@/vx/i18n";
import { shortDayHi } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";
import { SAVE_IDLE, SaveStatus, useSlowSave, type SaveState } from "@/vx/ui/save-status";
import { appendSpoken, useSpeech } from "@/vx/ui/voice";
import { COST_PER_MESSAGE } from "@/modules/whatsapp/vx/domain/reminders";

import { createNoteAction, undoNoteAction } from "../actions";
import type { ChildChoice, NotesPeople } from "../data";
import {
  FOLLOW_ON_MAX_DAYS,
  followUpDate,
  isSensitiveNote,
  nextOpenAction,
  NOTE_TAGS,
  pickedFollowOn,
  suggestTags,
  type BoardNote,
  type FollowOwner,
  type FollowWhen,
  type NoteTag,
  type Visibility,
} from "../domain/notes";
import { day, replaceParams } from "./look";
import type { AddStep, ClientViewer } from "./parts";

/*
 * Add a note (design Notes `add`/`listening`, TchNotes `add`/`listening`/
 * `review`/`saved`). One state for both layouts: the child, the words typed
 * or spoken, tags, the follow-up, who may read it and whether the parents are
 * told — queued for the office, never sent from here.
 */

export const COST = `₹${COST_PER_MESSAGE.toFixed(2)}`;

type Lang = "hi-IN" | "en-IN";

const DRAFT_KEY = (viewer: string) => `vx.notes.draft.${viewer}`;

/**
 * What a stored draft keeps. `requestId` is the draft's one id, sent with every
 * save of it, so saving a draft whose first save did land returns that note
 * instead of filing a twin (20261106123000). The follow-up and audience came
 * back as "Just noting" / team after a reload before (6 Nov school day); they
 * are optional so drafts stored before them still restore.
 */
export type StoredDraft = {
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

function readDraft(viewer: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY(viewer));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(viewer: string, d: StoredDraft | null) {
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
  // One id per draft, kept across every save of it (see StoredDraft).
  const [requestId, setRequestId] = useState<string>("");
  // Counts the drafts put back, so the cards can open on the words that came back.
  const [restoreTick, setRestoreTick] = useState(0);
  // A note left unsaved, offered with "Continue" rather than poured into the new note (7 Nov 2026).
  const [offer, setOffer] = useState<StoredDraft | null>(null);
  // The words the last save sent: the AI's clear note, a translation or the teacher's own (D-500).
  // The box keeps the teacher's own words, so Undo brings the check card back as it was.
  const [saved, setSaved] = useState<string | null>(null);
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

  // A draft from this reader's last visit is kept, so a dropped connection or a
  // closed tab does not lose what was written (RULES G). It is offered, never
  // poured into a new note: a teacher opening "New note" found last week's words
  // already in it and did not know where they came from (owner, 7 Nov 2026).
  const restored = useRef(false);
  /** Look for this reader's stored draft and offer it (`offer`); nothing in the note changes. */
  const checkDraft = () => {
    const d = readDraft(init.viewer.id);
    if (!d || !d.body.trim() || !init.kids.some((k) => k.id === d.studentId)) {
      setOffer(null);
      return;
    }
    // The page was refreshed while a save was on its way and the note did
    // reach the server (smoke 6 Nov, teacher 16): it is on the list, so the
    // kept copy goes instead of coming back as a second note to save.
    if (init.notes.some((n) => n.writtenBy === init.viewer.id && n.studentId === d.studentId && n.body.trim() === d.body.trim())) {
      writeDraft(init.viewer.id, null);
      setOffer(null);
      toast.show({ text: tx(p("Your last note was saved.", "आपका पिछला नोट सहेज लिया गया था।")), tone: "ok" });
      return;
    }
    setOffer(d);
  };
  /** "Continue this note": the offered draft back in the composer, child, words and choices. */
  const continueDraft = () => {
    const d = offer;
    if (!d) return;
    setOffer(null);
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
    setRestoreTick((n) => n + 1);
  };
  /** "Delete it": the offered draft goes from this phone. Returned, so a toast's Undo can put it back. */
  const dropDraft = (): StoredDraft | null => {
    const d = offer;
    writeDraft(init.viewer.id, null);
    setOffer(null);
    return d;
  };
  /** Undo of a delete: the draft kept and offered again. */
  const keepDraft = (d: StoredDraft) => {
    writeDraft(init.viewer.id, d);
    setOffer(d);
  };
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    // Once, after mount: localStorage is not readable during render.
    checkDraft();
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
      // This note now holds the one kept place: an older note offered there is gone.
      setOffer(null);
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
    setOffer(null);
    setSaved(null);
  };

  /**
   * The same words and choices for another child (D-486: "homework not done"
   * for three children is three notes). It is a new note: a new request id,
   * no child, the follow-up owner and "Tell parents" back to their defaults.
   */
  const again = () => {
    if (speech.listening) speech.stop();
    setStepState("add");
    replaceParams({ step: null, saved: null });
    setStudentId("");
    // The same note: the words that were saved, whichever of the choices they were.
    if (saved) setBody(saved);
    setOwner(null);
    setTellParents(false);
    setError(null);
    setErrField(null);
    setSaveUncertain(false);
    setRefused(null);
    setDraftAt(null);
    setRequestId("");
  };

  // What is checked here is checked before the transition starts, so "Saving…" only ever
  // means the note is on its way to the server. `words` are the words the teacher
  // ticked on the check card (the AI's clear note, a translation, or their own);
  // without them, the words in the box.
  const save = (onSaved: (id: string, child: ChildChoice) => void, words?: string) => {
    if (saveUncertain || pending) return;
    const text = words ?? body;
    setError(null);
    setRefused(null);
    if (!child) {
      setErrField("kid");
      setError(p("First pick the child.", "पहले बच्चा चुनें।"));
      return;
    }
    if (!text.trim()) {
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
    // Kept before it leaves, not 600 ms later: a refresh during a quick save
    // brings the note back with the same id, so saving it again files it once.
    writeDraft(init.viewer.id, { studentId: child.id, body: text, tags, voice, at: Date.now(), requestId: id, follow, when, followOn, owner, visibility });
    start(async () => {
      try {
        const res = await createNoteAction({
          requestId: id || null,
          studentId: child.id,
          body: text,
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
          // The saved card shows the words that were saved. The box keeps the teacher's own words,
          // so Undo returns to the check card as it was: the AI's note still ticked beside them.
          setSaved(text);
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
    speech, addPhrase, reset, again, save, saved, openAction, setError, checkDraft, continueDraft, dropDraft, keepDraft, offer, restoreTick,
    saveLine, saveWords, refused, testSession: init.testSession ?? false,
  };
}

/**
 * The save bar's line: the saving line while a save is out or after it failed,
 * otherwise the problem to fix or who will read the note. The saving line is
 * always mounted, so its change is announced; Try again keeps the child, the
 * words and every choice, and is offered only for a refusal, never for an
 * answer that was lost (that note may be saved already). `retry` is the
 * screen's own Save, where it chose the words.
 */
export function SaveBarLine({ c, onSaved, idle, style, retry }: { c: Composer; onSaved: (id: string, child: ChildChoice) => void; idle: string; style?: CSSProperties; retry?: () => void }) {
  const { tx } = useVx();
  const busy = c.saveLine.kind !== "idle";
  return (
    <span className="nx-c" style={{ gap: 0, ...style }}>
      <SaveStatus state={c.saveLine} words={c.saveWords} test={c.testSession} onRetry={c.refused ? (retry ?? (() => c.save(onSaved))) : undefined} reserve={false} />
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
