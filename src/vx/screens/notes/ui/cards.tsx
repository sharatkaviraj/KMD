"use client";

import "./cards.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import type { AssistProblem } from "@/modules/assist/domain/features";
import { translateTarget } from "@/modules/assist/domain/text";
import { askAssist, DRAFT_NOTE, PRIVACY_NOTE, PROBLEM_TEXT, reportDecision } from "@/vx/assist/client";
import { useAssistOffers } from "@/vx/assist/context";
import { agoP, dayMonth, dayMonthHi, shortDayHi } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { reducedMotion, slideIn, slideOut } from "@/vx/screens/collect/motion";
import { p, type Pair } from "@/vx/text";
import { appendSpoken, useHeardText } from "@/vx/ui/voice";

import type { ChildChoice, NotesPeople } from "../data";
import { chipNames, localSort, mergeSort, nameWordsIn, otherChildNamed, sameTags, searchKids, tidyWorthOffering, type AiSort, type NoteSort } from "../domain/cards";
import {
  excerpt,
  FOLLOW_ON_MAX_DAYS,
  followOwnerAllowed,
  followUpDate,
  isSensitiveNote,
  NOTE_TAGS,
  parentNoteMessage,
  pickerStartClass,
  TAG_TEXT,
  type BoardNote,
  type FollowOwner,
  type FollowWhen,
  type NoteTag,
} from "../domain/notes";
import { COST, readersLine, SaveBarLine, type Composer } from "./compose";
import { useFrame } from "./frame";
import { BOARD_TAG, day, ini, nameTone, TEACH_TAG, useBoth, WaBubble, type HelpStep, type TagLook } from "./look";
import type { ClientViewer } from "./parts";

/*
 * A note, card by card (D-486, 7 Nov 2026), as Collect takes a payment: one
 * card on the screen at a time, each the size of the space between the top
 * bar and the tab bar, and nothing on any of them behind a scroll. Pick the
 * child (Hindi or English, or a tap on a first name); write or speak; check
 * what the words and the AI made of it (D-487); saved. Every list is cut to
 * the card, and a cut list says how to reach the rest.
 */

export type NoteCardName = "child" | "write" | "check" | "saved";
type Sub = "who" | "kinds" | "follow" | "readers" | "parents" | "tidy" | "translate";

const ORDER: readonly NoteCardName[] = ["child", "write", "check", "saved"];

/** The phone's top bar for each card. */
export function noteCardTop(card: NoteCardName, child: ChildChoice | null): { title: Pair; sub: Pair | null } {
  const name = child ? `${child.name} · ${child.classLabel}` : "";
  switch (card) {
    case "child":
      return { title: p("New note", "नया नोट"), sub: p("Step 1 of 3 · pick the child", "कदम 1/3 · बच्चा चुनें") };
    case "write":
      return { title: p("New note", "नया नोट"), sub: child ? p(`Step 2 of 3 · ${name}`, `कदम 2/3 · ${name}`) : null };
    case "check":
      return { title: p("Check and save", "जाँचें और सहेजें"), sub: child ? p(`Step 3 of 3 · ${name}`, `कदम 3/3 · ${name}`) : null };
    default:
      return { title: p("Note saved", "नोट सहेजा गया"), sub: child ? p(name, name) : null };
  }
}

/** The "?" sheet, one set of three steps per card. */
export const NOTE_CARD_HELP: Record<NoteCardName, HelpStep[]> = {
  child: [
    { icon: "search", title: p("Type a name", "नाम लिखें"), body: p("In Hindi or English, or the roll number. Two letters are enough.", "हिंदी या अंग्रेज़ी में, या रोल नंबर। दो अक्षर काफ़ी हैं।") },
    { icon: "user", title: p("Or tap the name", "या नाम दबाएँ"), body: p("Your class comes first. The arrow at the bottom shows more names.", "आपकी कक्षा पहले आती है। नीचे का तीर और नाम दिखाता है।") },
    { icon: "check", title: p("See the full name", "पूरा नाम देखें"), body: p("The next card shows the child’s full name in big letters.", "अगले कार्ड पर बच्चे का पूरा नाम बड़े अक्षरों में दिखता है।") },
  ],
  write: [
    { icon: "edit", title: p("Just write it", "बस लिख दें"), body: p("A line or two, in Hindi or English, as you would say it.", "एक-दो लाइन, हिंदी या अंग्रेज़ी में, जैसे आप बोलते हैं।") },
    { icon: "mic", title: p("Or speak", "या बोलें"), body: p("Tap Speak and talk. Tap Done when you finish.", "बोलें दबाकर बोलिए। पूरा होने पर हो गया दबाएँ।") },
    { icon: "arrowRight", title: p("Tap Next", "आगे दबाएँ"), body: p("The app works out what kind of note it is. You check it on the next card.", "ऐप खुद समझ लेता है कि नोट किस बारे में है। अगले कार्ड पर आप जाँच लें।") },
  ],
  check: [
    { icon: "sparkle", title: p("Already sorted", "पहले से छँटा हुआ"), body: p("The kind of note and the follow-up are filled in from your words.", "नोट किस बारे में है और फिर कब देखना है, आपके शब्दों से भरा गया है।") },
    { icon: "edit", title: p("Change anything", "कुछ भी बदलें"), body: p("Tap a line to change it. Nothing is saved until you tap Save note.", "बदलने के लिए लाइन दबाएँ। नोट सहेजें दबाने तक कुछ नहीं सहेजा जाता।") },
    { icon: "lock", title: p("Who reads it", "कौन पढ़ेगा"), body: p("Health and family notes stay with the admin and the class teacher.", "स्वास्थ्य और परिवार के नोट सिर्फ़ प्रशासक और कक्षा अध्यापक तक रहते हैं।") },
  ],
  saved: [
    { icon: "check", title: p("Saved", "सहेजा गया"), body: p("The note is on the child’s record. It says who can read it.", "नोट बच्चे के रिकॉर्ड में है। कौन पढ़ सकता है, लिखा है।") },
    { icon: "users", title: p("Same note, another child", "यही नोट, दूसरा बच्चा"), body: p("For “homework not done” for three children: one tap each.", "तीन बच्चों का “गृहकार्य नहीं किया” हो तो: हर बच्चे के लिए एक टैप।") },
    { icon: "undo", title: p("Changed your mind?", "मन बदला?"), body: p("Undo takes the note back.", "वापस लें से नोट हट जाता है।") },
  ],
};

/* --------------------------------------------------------------- the flow */

/** How the last change of card looks: a slide forward or back, or none. */
type Move = { dir: 1 | -1; slide: boolean };

/**
 * Which card is on the screen, kept by the screen that owns the composer so
 * its top bar can name the card. A draft put back opens on its words.
 */
export function useNoteCards(c: Composer, initial: NoteCardName) {
  const [card, setCard] = useState<NoteCardName>(initial);
  const [sub, setSub] = useState<Sub | null>(null);
  const [move, setMove] = useState<Move>({ dir: 1, slide: false });
  const [tick, setTick] = useState(c.restoreTick);
  if (tick !== c.restoreTick) {
    setTick(c.restoreTick);
    setSub(null);
    setMove({ dir: 1, slide: false });
    setCard(c.child ? "write" : "child");
  }

  const stepFor = (to: NoteCardName) => (to === "check" ? "review" : to === "saved" ? "saved" : "add");

  /** Slide to another card, opening one of its own views when asked. */
  const go = (to: NoteCardName, then: Sub | null = null) => {
    setSub(then);
    if (to === card) return;
    setMove({ dir: ORDER.indexOf(to) >= ORDER.indexOf(card) ? 1 : -1, slide: true });
    setCard(to);
    if (c.step !== "listening" || to !== "write") c.setStep(stepFor(to));
  };

  /** Open the composer on a card, with no slide. */
  const start = (to: NoteCardName) => {
    setMove({ dir: 1, slide: false });
    setSub(null);
    setCard(to);
  };

  /** A card's inside swapping for one of its own views (the follow-up, who reads it). */
  const openSub = (next: Sub | null) => setSub(next);

  return { card, sub, move, go, start, openSub };
}

export type NoteFlow = ReturnType<typeof useNoteCards>;

/* ------------------------------------------------------------- the sort */

type AiState =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "done"; text: string; sort: AiSort; tidy: string; logId: string | null }
  | { kind: "problem"; text: string; problem: AssistProblem };

/**
 * What kind of note it is and whether it wants a follow-up (D-487): read from
 * the words the moment the teacher taps Next, then the AI's answer laid over
 * it when it comes. Anything the teacher changed stays as they left
 * it, and Save never waits for the AI.
 */
function useNoteSort(c: Composer, kids: readonly ChildChoice[]) {
  const { language } = useVx();
  const offered = useAssistOffers("note");
  const [ai, setAi] = useState<AiState>({ kind: "idle" });
  const [touched, setTouched] = useState({ tags: false, follow: false });
  // What the sort put there, so the check card can mark it and the AI's draft is counted honestly.
  const [placed, setPlaced] = useState<{ tags: "words" | "ai" | null; follow: "words" | "ai" | null }>({ tags: null, follow: null });
  const ticket = useRef(0);
  const live = useRef({ touched, body: c.body, owner: c.owner });
  useEffect(() => {
    live.current = { touched, body: c.body, owner: c.owner };
  });

  const putTags = (tags: NoteTag[]) => {
    c.setTags(tags);
    // A health or family note is followed up by the admin or the class teacher only (D-264).
    if (!followOwnerAllowed(live.current.owner, { tags })) c.setOwner(null);
  };
  const putFollow = (f: FollowWhen | null) => {
    c.setFollow(f !== null);
    if (f) c.setWhen(f);
  };
  const place = (s: NoteSort, by: "words" | "ai", skip: { tags: boolean; follow: boolean }) => {
    if (!skip.tags) putTags(s.tags);
    if (!skip.follow) putFollow(s.follow);
    setPlaced((cur) => ({ tags: skip.tags ? cur.tags : by, follow: skip.follow ? cur.follow : by }));
  };

  /** Sort the words now; ask the AI too when it is on for this person. */
  const sort = () => {
    const text = c.body.trim();
    if (!text) return;
    const mine = localSort(text);
    place(mine, "words", touched);
    if (!offered || text.length < 8) {
      ticket.current += 1;
      setAi({ kind: "idle" });
      return;
    }
    if ((ai.kind === "working" || ai.kind === "done") && ai.text === text) {
      if (ai.kind === "done") place(mergeSort(mine, ai.sort), "ai", touched);
      return;
    }
    const id = ++ticket.current;
    setAi({ kind: "working", text });
    void askAssist("note.sort", {
      text,
      tags: NOTE_TAGS.map((code) => ({ code, label: TAG_TEXT[code].en })),
      childName: c.child?.name ?? null,
      // Every child's name the words carry, in either script, is masked too (D-326).
      names: nameWordsIn(text, kids).slice(0, 12),
      language,
    }).then((answer) => {
      if (id !== ticket.current) return;
      if (!answer.ok) {
        setAi({ kind: "problem", text, problem: answer.problem });
        return;
      }
      const value = { tags: answer.value.tags, followUp: answer.value.followUp };
      setAi({ kind: "done", text, sort: value, tidy: answer.value.tidy, logId: answer.logId });
      // The words changed while the AI was reading: its sort is for other words.
      if (live.current.body.trim() !== text) return;
      place(mergeSort(mine, value), "ai", live.current.touched);
    });
  };

  const touch = (what: "tags" | "follow") => setTouched((cur) => ({ ...cur, [what]: true }));

  /** A new note: nothing of the last one's sort carries over. */
  const reset = () => {
    ticket.current += 1;
    setAi({ kind: "idle" });
    setTouched({ tags: false, follow: false });
    setPlaced({ tags: null, follow: null });
  };

  /** At Save: was the AI's sort kept as it was, or changed? Counted once (D-324). */
  const report = () => {
    if (ai.kind !== "done" || !ai.logId) return;
    const aiFollow = mergeSort({ tags: [], follow: null }, ai.sort).follow;
    const followNow = c.follow ? (c.when === "pick" ? "pick" : c.when) : null;
    const kept = (placed.tags !== "ai" || sameTags(c.tags, mergeSort({ tags: [], follow: null }, ai.sort).tags)) && (placed.follow !== "ai" || followNow === aiFollow);
    reportDecision(ai.logId, kept ? "kept" : "edited");
  };

  /** The AI's clearer wording, or a translation, put in place of the words: the sort still stands for them. */
  const adopt = (words: string) => {
    if (ai.kind === "done") setAi({ ...ai, text: words.trim() });
  };

  const tidy = ai.kind === "done" && ai.text === c.body.trim() && tidyWorthOffering(c.body, ai.tidy) ? ai.tidy : null;
  return { ai, tidy, placed, sort, touch, reset, report, putTags, putFollow, adopt, offered };
}

type TranslateState =
  | { kind: "idle" }
  | { kind: "working"; text: string; to: "hi" | "en" }
  | { kind: "done"; text: string; to: "hi" | "en"; value: string; logId: string | null }
  | { kind: "problem"; text: string; to: "hi" | "en"; problem: AssistProblem };

/**
 * "In English" / "In Hindi" (D-324, kept from the old form): the note's words
 * translated, offered beside them, never put in their place without a tap.
 * The children's names are masked first.
 */
function useTranslate(c: Composer, kids: readonly ChildChoice[]) {
  const offered = useAssistOffers("translate");
  const [state, setState] = useState<TranslateState>({ kind: "idle" });
  const ticket = useRef(0);
  const run = () => {
    const text = c.body.trim();
    if (text.length < 8) return;
    if (state.kind !== "idle" && state.kind !== "problem" && state.text === text) return;
    const to = translateTarget(text);
    const id = ++ticket.current;
    setState({ kind: "working", text, to });
    const names = [...new Set([...(c.child ? [c.child.name] : []), ...nameWordsIn(text, kids)])].slice(0, 8);
    void askAssist("text.translate", { text, to, names }).then((answer) => {
      if (id !== ticket.current) return;
      setState(answer.ok ? { kind: "done", text, to, value: answer.value.text, logId: answer.logId } : { kind: "problem", text, to, problem: answer.problem });
    });
  };
  const reset = () => {
    ticket.current += 1;
    setState({ kind: "idle" });
  };
  return { offered, state, run, reset };
}

/* ------------------------------------------------------------ the motion */

/** A card's inside arriving from just above, as Collect's sub-cards do. */
function dropIn(el: HTMLElement) {
  if (reducedMotion()) return;
  el.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" });
}

/**
 * Collect's card motion: the card leaving slides out over the one arriving.
 * The leaving card is copied the moment React takes it off the page, which
 * is when React 19 runs a ref's cleanup, while the node is still there.
 */
function useCardMotion(flow: NoteFlow) {
  const ghosts = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLElement | null>(null);
  const leaving = useRef<{ from: HTMLElement; ghost: HTMLElement } | null>(null);
  const last = useRef({ card: flow.card, sub: flow.sub });

  const hold = useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    // The same card straight back is React's development double run, not a card leaving.
    if (leaving.current?.from === el) {
      leaving.current.ghost.remove();
      leaving.current = null;
    }
    shown.current = el;
    return () => {
      if (shown.current === el) shown.current = null;
      const box = ghosts.current;
      if (!box || !el.isConnected) return;
      leaving.current?.ghost.remove();
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add("leaving");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      box.appendChild(ghost);
      leaving.current = { from: el, ghost };
    };
  }, []);

  const { card, sub, move } = flow;
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { card, sub };
    const out = leaving.current;
    leaving.current = null;
    const el = shown.current;
    if (card !== before.card && move.slide && el) {
      if (out) slideOut(out.ghost, move.dir).onfinish = () => out.ghost.remove();
      slideIn(el, move.dir, Boolean(out));
      return;
    }
    out?.ghost.remove();
    if (card === before.card && sub !== before.sub) {
      const body = el?.querySelector<HTMLElement>(".nc-body");
      if (body) dropIn(body);
    }
  }, [card, sub, move]);

  return { ghosts, hold };
}

/**
 * Hide the items of a box that do not fit it: nothing scrolls. The items stay
 * in the page, so a taller screen shows them again; a cut item is invisible
 * and out of the accessibility tree. The box must be positioned. Returns how
 * many are cut.
 */
function useFit(box: RefObject<HTMLElement | null>, selector: string, deps: readonly unknown[]): number {
  const [cut, setCut] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      const items = [...el.querySelectorAll<HTMLElement>(selector)];
      items.forEach((r) => {
        r.removeAttribute("data-cut");
        r.removeAttribute("aria-hidden");
      });
      const limit = el.clientHeight + 1;
      let n = 0;
      items.forEach((r) => {
        if (r.offsetTop + r.offsetHeight > limit) {
          r.setAttribute("data-cut", "");
          r.setAttribute("aria-hidden", "true");
          n += 1;
        }
      });
      setCut(n);
    };
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measured when the caller's content changes
  }, deps);
  return cut;
}

/* ---------------------------------------------------------- small parts */

function Two({ t }: { t: Pair }) {
  const { tx, sub } = useVx();
  const second = sub(t);
  return (
    <>
      {tx(t)}
      {second ? <span className="nc-hi">{second}</span> : null}
    </>
  );
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const [bg, fg] = nameTone(name);
  return (
    <span className="nc-av" style={{ width: size, height: size, fontSize: Math.round(size / 3), background: bg, color: fg }} aria-hidden="true">
      {ini(name)}
    </span>
  );
}

/** The child the note is about, as the write and check cards head with it. */
function KidHead({ kid, ct, mine, big, onChange }: { kid: ChildChoice; ct: string | null; mine: boolean; big?: boolean; onChange: () => void }) {
  const { tx } = useVx();
  const meta = [kid.classLabel, kid.rollNo ? tx(p(`roll ${kid.rollNo}`, `रोल ${kid.rollNo}`)) : null, kid.hint ? tx(kid.hint) : null, mine ? tx(p("your class", "आपकी कक्षा")) : ct ? tx(p(`class teacher ${ct}`, `कक्षा अध्यापक ${ct}`)) : null].filter(Boolean).join(" · ");
  return (
    <div className="nc-ch nc-kidhead">
      <Avatar name={kid.name} size={big ? 46 : 38} />
      <span className="nc-c" style={{ flex: 1, minWidth: 0 }}>
        <span className={`nc-name${big ? " big" : ""}`} data-title>{kid.name}</span>
        <span className="nc-meta">{meta}</span>
      </span>
      <button type="button" className="tap nc-chg" onClick={onChange}>
        {tx(p("Change", "बदलें"))}
      </button>
    </div>
  );
}

function Head({ step, title }: { step?: number; title: Pair }) {
  const { tx, sub } = useVx();
  const second = sub(title);
  return (
    <div className="nc-ch">
      <span className="nc-c" style={{ minWidth: 0 }}>
        {step ? <span className="nc-eb">{tx(p(`Step ${step} of 3`, `कदम ${step} / 3`))}</span> : null}
        <h2 className="nc-h2" data-title>
          {tx(title)}
          {second ? <span className="nc-h2s">{second}</span> : null}
        </h2>
      </span>
    </div>
  );
}

/** A follow-up day in the reader's words: "Tomorrow · Fri 9 Oct". */
function whenText(when: FollowWhen, today: string): { main: Pair; date: Pair } {
  const d = followUpDate(when, today);
  const date = p(day(d), shortDayHi(d));
  if (when === "tomorrow") return { main: p("Tomorrow", "कल"), date };
  if (when === "next_monday") return { main: p("Next Monday", "अगले सोमवार"), date: p(dayMonth(d), dayMonthHi(d)) };
  return { main: p("In a week", "एक हफ़्ते में"), date };
}

const TAG_LOOK = (board: boolean): Record<NoteTag, TagLook> => (board ? BOARD_TAG : TEACH_TAG);

/* -------------------------------------------------------------- the cards */

type CardsProps = {
  flow: NoteFlow;
  c: Composer;
  kids: ChildChoice[];
  notes: readonly BoardNote[];
  viewer: ClientViewer;
  people: NotesPeople;
  today: string;
  school: string;
  base: string;
  /** The office and coordinator's board draws its tags in the board's colours. */
  board?: boolean;
  initialClass?: string | null;
  savedId: string | null;
  onSaved: (id: string, child: ChildChoice) => void;
  onUndo: () => void;
  undoing: boolean;
  /** A support plan for the saved note, where this screen offers one. */
  onPlan?: () => void;
  /** Leave: back to the notes. */
  onDone: () => void;
  /** Open an action already on the child (D-266). */
  onOpenAction: (href: string) => void;
};

export function NoteCards(props: CardsProps) {
  const { flow, c, kids, viewer, people } = props;
  const { tx } = useVx();
  const sorter = useNoteSort(c, kids);
  const translator = useTranslate(c, kids);
  const rootRef = useRef<HTMLDivElement>(null);
  const keyboard = useFrame(rootRef, flow.card);
  const { ghosts, hold } = useCardMotion(flow);
  const child = c.child;
  const ct = child ? (people.classTeachers[child.classId] ?? null) : null;
  const mine = child ? viewer.heldClassIds.includes(child.classId) : false;
  // The child the wrong-child question was answered for, with those words (D-486).
  const [whoDone, setWhoDone] = useState<string | null>(null);

  const pick = (id: string) => {
    c.pickChild(id);
    flow.go("write");
  };

  /** Next on the write card: sort the words, and ask about a classmate the words name instead. */
  const next = () => {
    const text = c.body.trim();
    if (!child) {
      flow.go("child");
      return;
    }
    if (!text) {
      c.setErrField("text");
      return;
    }
    if (c.speech.listening) c.doneListening("add");
    sorter.sort();
    const named = otherChildNamed(text, child, kids);
    const key = `${child.id}|${text}`;
    flow.go("check", named.length && whoDone !== key ? "who" : null);
  };

  const save = () => {
    sorter.report();
    c.save(props.onSaved);
  };

  const fresh = () => {
    c.reset(false);
    sorter.reset();
    translator.reset();
    setWhoDone(null);
    flow.go("child");
  };

  const again = () => {
    c.again();
    setWhoDone(null);
    flow.go("child");
  };

  let body: ReactNode;
  if (flow.card === "child" || !child) {
    body = <ChildCard {...props} onPick={pick} />;
  } else if (flow.card === "write") {
    body = <WriteCard {...props} ct={ct} mine={mine} keyboard={keyboard} onNext={next} />;
  } else if (flow.card === "check") {
    body = (
      <CheckCard
        {...props}
        ct={ct}
        mine={mine}
        sorter={sorter}
        translator={translator}
        onSave={save}
        onKeep={() => {
          setWhoDone(`${child.id}|${c.body.trim()}`);
          flow.openSub(null);
        }}
        onMove={(id) => {
          c.pickChild(id);
          setWhoDone(`${id}|${c.body.trim()}`);
          flow.openSub(null);
        }}
      />
    );
  } else {
    body = <SavedCard {...props} onAgain={again} onNew={fresh} />;
  }

  return (
    <div className="nc" ref={rootRef} data-card={flow.card} data-sub={flow.sub ?? undefined}>
      <Rail {...props} onNext={next} />
      <div className="nc-stage">
        <div className="nc-ghosts" ref={ghosts} />
        <section className="nc-card" ref={hold} key={flow.card} data-step={flow.card} aria-label={tx(noteCardTop(flow.card, child).title)}>
          {body}
        </section>
      </div>
      <Context {...props} />
    </div>
  );
}

/* ----------------------------------------------------------- 1 the child */

function ChildCard({ flow, kids, notes, viewer, initialClass, onPick, onDone }: CardsProps & { onPick: (id: string) => void }) {
  const { tx } = useVx();
  const classes = [...new Map(kids.map((k) => [k.classId, k.classLabel])).entries()];
  const [cls, setCls] = useState(() => pickerStartClass(classes.map(([id]) => id), { initial: initialClass, held: viewer.heldClassIds }));
  const [q, setQ] = useState("");
  // Where each page of names starts: "›" pushes the next start, "‹" pops it.
  const [pages, setPages] = useState<number[]>([0]);
  const gridRef = useRef<HTMLDivElement>(null);
  const searching = q.trim().length > 0;
  const { here, elsewhere } = searchKids(kids, cls, q);
  const short = chipNames(kids.filter((k) => k.classId === cls || elsewhere.includes(k)));
  const recent: ChildChoice[] = [];
  if (!searching) {
    for (const n of notes) {
      if (n.writtenBy !== viewer.id || !n.studentId) continue;
      const k = kids.find((x) => x.id === n.studentId);
      if (k && !recent.includes(k)) recent.push(k);
      if (recent.length >= 3) break;
    }
  }
  const list: { kid: ChildChoice; other: boolean; recent: boolean }[] = searching
    ? [...here.map((kid) => ({ kid, other: false, recent: false })), ...elsewhere.map((kid) => ({ kid, other: true, recent: false }))]
    : [...recent.map((kid) => ({ kid, other: kid.classId !== cls, recent: true })), ...here.filter((k) => !recent.includes(k)).map((kid) => ({ kid, other: false, recent: false }))];
  const from = pages[pages.length - 1] ?? 0;
  const shown = list.slice(from);
  const cut = useFit(gridRef, ".nc-kid", [from, q, cls, list.length, flow.card]);
  const fits = shown.length - cut;
  const clsLabel = classes.find(([id]) => id === cls)?.[1] ?? "";

  const setClass = (id: string) => {
    setCls(id);
    setPages([0]);
  };
  const type = (value: string) => {
    setQ(value);
    setPages([0]);
  };
  // Enter opens the first match, as on Collect's search.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searching && list[0]) onPick(list[0].kid.id);
  };

  if (kids.length === 0) {
    return (
      <>
        <Head step={1} title={p("Which child is it about?", "किस बच्चे के बारे में?")} />
        <div className="nc-body">
          <div className="nc-note warn" role="status">
            <Ic n="info" size={18} />
            <span>{tx(p("You have no class yet, so there is no child to pick. Ask the office to give you a class.", "आपको अभी कोई कक्षा नहीं मिली, इसलिए कोई बच्चा नहीं दिखेगा। ऑफ़िस से कक्षा दिलवाएँ।"))}</span>
          </div>
        </div>
        <div className="nc-foot">
          <button type="button" className="tap btn sec nt-big" onClick={onDone} style={{ flex: 1 }}>
            {tx(p("Back to notes", "नोट्स पर वापस"))}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Head step={1} title={p("Which child is it about?", "किस बच्चे के बारे में?")} />
      <div className="nc-body">
        <label className="nc-search">
          <Ic n="search" size={20} />
          <span className="sr">{tx(p("Find a child", "बच्चा खोजें"))}</span>
          <input
            type="search"
            value={q}
            onChange={(e) => type(e.target.value)}
            onKeyDown={onKey}
            enterKeyHint="go"
            autoComplete="off"
            placeholder={tx(p("Name or roll number · नाम", "नाम या रोल नंबर"))}
          />
          {q ? (
            <button type="button" className="tap nc-x" aria-label={tx(p("Clear", "साफ़ करें"))} onClick={() => type("")}>
              <Ic n="x" size={18} />
            </button>
          ) : null}
        </label>
        {classes.length > 1 && !searching ? (
          classes.length <= 4 ? (
            <div className="nc-cls" role="group" aria-label={tx(p("Class", "कक्षा"))}>
              {classes.map(([id, label]) => (
                <button key={id} type="button" className={`tap chip${cls === id ? " on" : ""}`} aria-pressed={cls === id} onClick={() => setClass(id)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <select className="inp nc-sel" aria-label={tx(p("Class", "कक्षा"))} value={cls} onChange={(e) => setClass(e.target.value)}>
              {classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          )
        ) : null}
        <div className="nc-grid" ref={gridRef} role="list" aria-label={tx(searching ? p("Children found", "मिले बच्चे") : p(`Children of ${clsLabel}`, `${clsLabel} के बच्चे`))}>
          {shown.map(({ kid, other, recent: r }) => (
            <button key={`${r ? "r" : "k"}-${kid.id}`} type="button" role="listitem" className={`tap nc-kid${r ? " recent" : ""}`} onClick={() => onPick(kid.id)} title={kid.name} aria-label={`${kid.name}, ${kid.classLabel}${kid.rollNo ? `, roll ${kid.rollNo}` : ""}`}>
              <span className="nc-kt">
                {r ? <Ic n="clock" size={13} /> : kid.rollNo ? <span className="r">{kid.rollNo}</span> : null}
                <span className="n">{short.get(kid.id) ?? kid.name}</span>
              </span>
              {other || kid.hint ? <span className="c">{[other ? kid.classLabel : null, kid.hint ? tx(kid.hint) : null].filter(Boolean).join(" · ")}</span> : null}
            </button>
          ))}
          {searching && list.length === 0 ? (
            <p className="nc-empty" role="status">
              {tx(p(`No child by that name in ${clsLabel} or your other classes. Try the first name only.`, `${clsLabel} या आपकी दूसरी कक्षाओं में इस नाम का कोई बच्चा नहीं। सिर्फ़ पहला नाम लिखकर देखें।`))}
            </p>
          ) : null}
        </div>
      </div>
      <div className="nc-foot">
        {pages.length > 1 ? (
          <button type="button" className="tap btn sec nt-big nc-ib" aria-label={tx(p("Earlier names", "पिछले नाम"))} onClick={() => setPages((cur) => cur.slice(0, -1))}>
            <Ic n="chevLeft" size={22} />
          </button>
        ) : null}
        <span className="nc-pg" aria-live="polite">
          {list.length === 0
            ? ""
            : cut > 0 || pages.length > 1
              ? tx(p(`${from + 1}–${from + Math.max(fits, 1)} of ${list.length} · or type a name`, `${list.length} में से ${from + 1}–${from + Math.max(fits, 1)} · या नाम लिखें`))
              : tx(p("Tap the child’s name", "बच्चे का नाम दबाएँ"))}
        </span>
        {cut > 0 && fits > 0 ? (
          <button type="button" className="tap btn pri nt-big nc-more" onClick={() => setPages((cur) => [...cur, from + fits])}>
            {tx(p("More names", "और नाम"))}
            <Ic n="chevRight" size={20} />
          </button>
        ) : null}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- 2 the words */

const PHRASES: Pair[] = [
  p("Homework not done", "गृहकार्य नहीं किया"),
  p("Did very well today", "आज बहुत अच्छा किया"),
  p("Needs extra practice", "अधिक अभ्यास चाहिए"),
  p("Seems unwell", "तबीयत ठीक नहीं लगती"),
  p("Talk to the parents", "माता-पिता से बात करें"),
  p("Quiet and alone", "चुप-चुप और अकेला"),
];

/** What the composer keeps on this device: kept, not saved, and it says so. */
function keptLine(at: number): Pair {
  const ago = agoP(new Date(at));
  return p(`Kept on this device · ${ago.en} · not saved yet`, `इसी डिवाइस पर रखा है · ${ago.hi} · अभी सहेजा नहीं`);
}

function WriteCard({ flow, c, ct, mine, keyboard, onNext, onOpenAction, base }: CardsProps & { ct: string | null; mine: boolean; keyboard: boolean; onNext: () => void }) {
  const { tx } = useVx();
  const both = useBoth();
  const kid = c.child!;
  const phrasesRef = useRef<HTMLDivElement>(null);
  useFit(phrasesRef, ".nc-qp", [c.body.length > 0, keyboard]);
  const listening = c.step === "listening";
  const full = c.body.length >= 2000;
  const speakLabel = c.body.trim() ? tx(p("Add by speaking", "बोलकर जोड़ें")) : tx(p("Speak", "बोलें"));
  const phrase = (ph: Pair) => c.addPhrase(c.lang === "hi-IN" ? (ph.hi ?? ph.en) : ph.en);
  const action = c.openAction;

  if (listening) return <ListenCard c={c} />;

  return (
    <>
      <KidHead kid={kid} ct={ct} mine={mine} big onChange={() => flow.go("child")} />
      <div className="nc-body">
        {action ? (
          <div className="nc-note warn nc-act1" role="status">
            <Ic n="flag" size={16} />
            <span className="nc-c" style={{ flex: 1, minWidth: 0 }}>
              <b>{tx(p(`${kid.name.split(" ")[0]} already has an open action`, `${kid.name.split(" ")[0]} की एक कार्रवाई पहले से खुली है`))}</b>
              <span className="nc-e">{excerpt(action.body, 70)}{action.followUpOn ? ` · ${tx(day(action.followUpOn))}` : ""}</span>
            </span>
            <button type="button" className="tap nc-chg" onClick={() => onOpenAction(`${base}?student=${kid.id}&note=${action.id}`)}>
              {tx(p("Add update", "अपडेट जोड़ें"))}
            </button>
          </div>
        ) : null}
        <label className="nc-tbox">
          <span className="sr">Note</span>
          <textarea
            className={`nc-text${c.errField === "text" ? " err" : ""}`}
            aria-label="Note"
            value={c.body}
            maxLength={2000}
            enterKeyHint="next"
            onChange={(e) => {
              c.setBody(e.target.value);
              c.setMode("type");
              c.setErrField(null);
            }}
            placeholder={tx(p("What did you notice? Type or speak, in Hindi or English. For example: Finds fractions hard", "आपने क्या देखा? हिंदी या अंग्रेज़ी में लिखें या बोलें। जैसे: भिन्न में दिक्कत आती है"))}
          />
        </label>
        {c.errField === "text" ? (
          <span className="nc-err" role="alert">{tx(p("Write or speak the note first.", "पहले नोट लिखें या बोलें।"))}</span>
        ) : null}
        <div className="nc-phr" ref={phrasesRef} role="group" aria-label={tx(p("Quick words", "झटपट शब्द"))}>
          {PHRASES.map((ph) => (
            <button key={ph.en} type="button" className="tap nc-qp" onClick={() => phrase(ph)}>
              <Ic n="plus" size={14} />
              {tx(ph)}
            </button>
          ))}
        </div>
        <span className={`nc-kept${full ? " full" : ""}`} role={full ? "status" : undefined}>
          <Ic n={full ? "alert" : "cloud"} size={14} />
          {full
            ? tx(p("The note is full (2,000 characters). Save it and write the rest as a second note.", "नोट भर गया (2,000 अक्षर)। इसे सहेजें और बाकी दूसरे नोट में लिखें।"))
            : c.draftAt && c.body.trim()
            ? tx(keptLine(c.draftAt))
            : c.body.length > 1700
              ? tx(p(`${2000 - c.body.length} characters left`, `${2000 - c.body.length} अक्षर बाकी`))
              : c.speech.supported
                ? tx(p("What you write is kept here until you save", "सहेजने तक आपका लिखा यहीं रखा रहता है"))
                : tx(p("To speak, use the mic on your keyboard", "बोलने के लिए कीबोर्ड का माइक इस्तेमाल करें"))}
        </span>
      </div>
      <div className="nc-foot">
        <button type="button" className="tap btn sec nt-big nc-ib" aria-label={tx(p("Previous step", "पिछला कदम"))} onClick={() => flow.go("child")}>
          <Ic n="chevLeft" size={22} />
        </button>
        {c.speech.supported ? (
          <button type="button" className={`tap btn soft nt-big nc-speak${c.body.trim() ? " more" : ""}`} aria-label={speakLabel} onClick={() => c.listen(Boolean(c.body.trim()))}>
            <Ic n="mic" size={20} />
            <span className="nc-sl">{speakLabel}</span>
          </button>
        ) : null}
        <button type="button" className="tap btn pri nt-big nc-next" onClick={onNext} aria-disabled={!c.body.trim()}>
          {both(p("Next", "आगे"))}
          <Ic n="chevRight" size={20} />
        </button>
      </div>
    </>
  );
}

/** Listening, inside the write card (design TchNotes `listening`). */
function ListenCard({ c }: { c: Composer }) {
  const { tx } = useVx();
  const both = useBoth();
  const live = appendSpoken(c.heard, useHeardText(c.speech.heard)).trim();
  const kid = c.child!;
  return (
    <>
      <div className="nc-ch nc-kidhead">
        <Avatar name={kid.name} size={38} />
        <span className="nc-c" style={{ flex: 1, minWidth: 0 }}>
          <span className="nc-name">{kid.name}</span>
          <span className="nc-meta">{kid.classLabel}</span>
        </span>
      </div>
      <div className="nc-body nc-listen">
        <div className="nc-lrow">
          <div className="nc-micw">
            <i />
            <i />
            <button type="button" className="tap nc-mic" aria-label={tx(p("Done speaking", "बोलना पूरा"))} onClick={() => c.doneListening("add")}>
              <Ic n="mic" size={30} />
            </button>
          </div>
          <span className="nc-c" style={{ gap: 4 }}>
            <span className="nc-lt">{c.speech.listening ? both(p("Listening…", "सुन रहे हैं…")) : both(p("Stopped", "रुका"))}</span>
            <span className="nc-timer num">
              <i />
              {c.timer}
            </span>
          </span>
          <span style={{ flex: 1 }} />
          <span className="nc-lang" role="group" aria-label={tx(p("Language", "भाषा"))}>
            {(["hi-IN", "en-IN"] as const).map((l) => (
              <button key={l} type="button" className={`tap${c.lang === l ? " on" : ""}`} aria-pressed={c.lang === l} onClick={() => c.switchLang(l)}>
                {l === "hi-IN" ? "हिंदी" : "English"}
              </button>
            ))}
          </span>
        </div>
        <div className="nc-live" aria-live="polite">
          <p>
            {c.body.trim() ? <span className="nc-was">{c.body.trim()} </span> : null}
            {live ? live : <span className="nc-mut">{both(p("Start speaking…", "बोलना शुरू करें…"))}</span>}
            <span className="nt-caret" />
          </p>
        </div>
        {c.speech.errorP ? (
          <span className="nc-err" role="alert">{tx(c.speech.errorP)}</span>
        ) : (
          <span className="nc-kept">
            <Ic n="info" size={14} />
            {tx(p("Uses your phone’s own voice typing. You can fix any word after.", "फ़ोन की अपनी आवाज़ से लिखाई। बाद में कोई भी शब्द ठीक कर सकते हैं।"))}
          </span>
        )}
      </div>
      <div className="nc-foot">
        <button type="button" className="tap btn sec nt-big" onClick={() => c.cancelListening("add")} style={{ flex: 1 }}>
          <Ic n="x" size={18} />
          {tx(p("Cancel", "रद्द करें"))}
        </button>
        <button type="button" className="tap btn pri nt-big" onClick={() => c.doneListening("add")} style={{ flex: 1.6 }}>
          <Ic n="check" size={18} />
          {both(p("Done", "हो गया"))}
        </button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- 3 the check */

type Sorter = ReturnType<typeof useNoteSort>;
type Translator = ReturnType<typeof useTranslate>;

function CheckCard(props: CardsProps & { ct: string | null; mine: boolean; sorter: Sorter; translator: Translator; onSave: () => void; onKeep: () => void; onMove: (id: string) => void }) {
  const { flow, c, ct, mine, sorter, translator, kids, viewer, people, today, school, board } = props;
  const { tx } = useVx();
  const both = useBoth();
  const kid = c.child!;
  const text = c.body.trim();
  const sub = flow.sub;
  const look = TAG_LOOK(Boolean(board));
  const sensitive = isSensitiveNote({ tags: c.tags });
  const followOn = c.follow ? c.followOnDate : null;
  const named = sub === "who" ? otherChildNamed(text, kid, kids) : [];

  /* the rows' values */
  const kindVal = c.tags.length ? c.tags.map((t) => tx(TAG_TEXT[t])).join(" · ") : tx(p("Not sorted · tap to choose", "नहीं चुना · चुनने के लिए दबाएँ"));
  const ownerName = (o: FollowOwner): string =>
    o === "me" ? tx(p("me", "मैं")) : o === "class_teacher" ? (ct ?? tx(p("class teacher", "कक्षा अध्यापक"))) : o === "coordinator" ? (people.coordinator ?? tx(p("coordinator", "समन्वयक"))) : (people.admin ?? tx(p("admin", "प्रशासक")));
  const followVal = !c.follow
    ? tx(p("Just noting · no reminder", "सिर्फ़ जानकारी · कोई याद नहीं"))
    : followOn
      ? tx(p(`Look again ${day(followOn)} · ${ownerName(c.owner)}`, `${shortDayHi(followOn)} को · ${ownerName(c.owner)}`))
      : tx(p("Pick the day", "दिन चुनें"));
  const readVal = c.visibility === "private" ? tx(p("Only me", "सिर्फ़ मैं")) : sensitive ? tx(p("Admin and class teacher only", "सिर्फ़ प्रशासक और कक्षा अध्यापक")) : tx(p("Teachers and office", "अध्यापक और कार्यालय"));
  const parentsOn = c.tellParents && c.visibility === "team";
  const parentVal = parentsOn ? tx(p(`On · 1 WhatsApp · about ${COST}`, `चालू · 1 व्हाट्सऐप · लगभग ${COST}`)) : tx(p("Off · parents are not told", "बंद · माता-पिता को नहीं बताया जाएगा"));

  const canTranslate = translator.offered && text.length >= 8;
  const ai = sorter.ai;
  const aiLine: { icon: IconName; text: Pair; tone: "ai" | "mut" } =
    ai.kind === "working" && ai.text === text
      ? { icon: "sparkle", text: p("The AI is reading your note…", "AI आपका नोट पढ़ रहा है…"), tone: "ai" }
      : (sorter.placed.tags === "ai" || sorter.placed.follow === "ai") && ai.kind === "done" && ai.text === text
        ? { icon: "sparkle", text: p("Sorted by the AI from your words. Tap a line to change it.", "AI ने आपके शब्दों से छाँटा। बदलने के लिए लाइन दबाएँ।"), tone: "ai" }
        : ai.kind === "problem" && ai.text === text && ai.problem !== "off" && ai.problem !== "denied"
          ? { icon: "info", text: p(`Sorted from your words. ${PROBLEM_TEXT[ai.problem].en}`, `आपके शब्दों से छाँटा। ${PROBLEM_TEXT[ai.problem].hi ?? PROBLEM_TEXT[ai.problem].en}`), tone: "mut" }
          : { icon: "check", text: p("Sorted from your words. Tap a line to change it.", "आपके शब्दों से छाँटा। बदलने के लिए लाइन दबाएँ।"), tone: "mut" };
  const mark = (what: "tags" | "follow") => (sorter.placed[what] === "ai" && ai.kind === "done" && ai.text === text ? <Ic n="sparkle" size={13} className="nc-aim" /> : null);

  const row = (key: Sub, icon: IconName, tone: [string, string], label: Pair, value: string, extra?: ReactNode) => (
    <button type="button" className="tap nc-row" onClick={() => flow.openSub(key)} aria-label={`${tx(label)}: ${value}`}>
      <span className="ic" style={{ background: tone[0], color: tone[1] }}>
        <Ic n={icon} size={18} />
      </span>
      <span className="nc-c" style={{ minWidth: 0 }}>
        <span className="lab">
          {tx(label)}
          {extra}
        </span>
        <span className="val">{value}</span>
      </span>
      <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
    </button>
  );

  const done = (
    <div className="nc-foot">
      <button type="button" className="tap btn pri nt-big" onClick={() => flow.openSub(null)} style={{ flex: 1 }}>
        <Ic n="check" size={18} />
        {both(p("Done", "हो गया"))}
      </button>
    </div>
  );

  /* -- the wrong child (D-486) -- */
  if (sub === "who" && named.length) {
    return (
      <>
        <KidHead kid={kid} ct={ct} mine={mine} onChange={() => flow.go("child")} />
        <div className="nc-body">
          <div className="nc-note warn nc-who" role="alert">
            <Ic n="alert" size={20} />
            <span className="nc-c" style={{ gap: 2 }}>
              <b>{tx(p(`The note names ${named.map((n) => n.name.split(" ")[0]).join(", ")}, not ${kid.name.split(" ")[0]}.`, `नोट में ${named.map((n) => n.name.split(" ")[0]).join(", ")} का नाम है, ${kid.name.split(" ")[0]} का नहीं।`))}</b>
              <span>{tx(p("Who is this note about?", "यह नोट किसके बारे में है?"))}</span>
            </span>
          </div>
          <p className="nc-quote"><span>“{excerpt(text, 120)}”</span></p>
          {named.map((n) => (
            <button key={n.id} type="button" className="tap nc-pickrow" onClick={() => props.onMove(n.id)}>
              <Avatar name={n.name} size={36} />
              <span className="nc-c" style={{ flex: 1, minWidth: 0 }}>
                <b className="nc-pn">{n.name}</b>
                <span className="nc-meta">{n.classLabel}{n.rollNo ? ` · ${tx(p(`roll ${n.rollNo}`, `रोल ${n.rollNo}`))}` : ""}</span>
              </span>
              <span className="nc-pk">{tx(p("Save for this child", "इस बच्चे के लिए"))}</span>
            </button>
          ))}
          <button type="button" className="tap nc-pickrow keep" onClick={props.onKeep}>
            <Avatar name={kid.name} size={36} />
            <span className="nc-c" style={{ flex: 1, minWidth: 0 }}>
              <b className="nc-pn">{kid.name}</b>
              <span className="nc-meta">{tx(p("Keep it on this child", "इसी बच्चे पर रखें"))}</span>
            </span>
            <Ic n="check" size={18} />
          </button>
        </div>
        <div className="nc-foot">
          <button type="button" className="tap btn sec nt-big" onClick={() => flow.go("write")} style={{ flex: 1 }}>
            <Ic n="edit" size={18} />
            {tx(p("Change the words", "शब्द बदलें"))}
          </button>
        </div>
      </>
    );
  }

  /* -- what kind of note -- */
  if (sub === "kinds") {
    return (
      <>
        <Head title={p("What is the note about?", "नोट किस बारे में है?")} />
        <div className="nc-body">
          <span className="nc-hint">{tx(p("Pick one or two. Tap again to remove.", "एक या दो चुनें। हटाने के लिए फिर दबाएँ।"))}</span>
          <div className="nc-tags">
            {NOTE_TAGS.map((t) => {
              const on = c.tags.includes(t);
              const l = look[t];
              return (
                <button
                  key={t}
                  type="button"
                  className="tap nc-tag"
                  aria-pressed={on}
                  onClick={() => {
                    sorter.touch("tags");
                    sorter.putTags(on ? c.tags.filter((x) => x !== t) : [...c.tags, t]);
                  }}
                  style={on ? { background: l.bg, color: l.fg, borderColor: l.fg } : undefined}
                >
                  <span className="ti" style={{ background: on ? "var(--card)" : l.bg, color: l.fg }}>
                    <Ic n={l.icon} size={18} />
                  </span>
                  <span className="nc-c" style={{ minWidth: 0 }}>
                    <Two t={TAG_TEXT[t]} />
                  </span>
                  {on ? <Ic n="check" size={18} style={{ marginLeft: "auto" }} /> : null}
                </button>
              );
            })}
          </div>
          {sensitive ? (
            <span className="nc-hint lock">
              <Ic n="lock" size={14} />
              {tx(p("A health or family note is read only by the admin and the class teacher.", "स्वास्थ्य या परिवार का नोट सिर्फ़ प्रशासक और कक्षा अध्यापक पढ़ते हैं।"))}
            </span>
          ) : null}
        </div>
        {done}
      </>
    );
  }

  /* -- the follow-up -- */
  if (sub === "follow") {
    const owners = (
      [
        { key: "me", label: mine ? p("Me (class teacher)", "मैं (कक्षा अध्यापक)") : p("Me", "मैं") },
        { key: "class_teacher", label: p(`Class teacher${ct ? ` · ${ct}` : ""}`, `कक्षा अध्यापक${ct ? ` · ${ct}` : ""}`) },
        { key: "coordinator", label: p(`Coordinator${people.coordinator ? ` · ${people.coordinator}` : ""}`, `समन्वयक${people.coordinator ? ` · ${people.coordinator}` : ""}`) },
        { key: "admin", label: p("Admin", "प्रशासक") },
      ] satisfies { key: FollowOwner; label: Pair }[]
    )
      // One person, one choice: the class teacher writing about their own class, the coordinator, the admin (smoke 20 Oct).
      .filter((o) => !(o.key === "class_teacher" && mine) && !(o.key === "coordinator" && viewer.isCoordinator) && !(o.key === "admin" && viewer.isAdmin))
      // A health or family note is followed up by the admin or the class teacher only (D-264).
      .filter((o) => followOwnerAllowed(o.key, { tags: c.tags }));
    const min = followUpDate("tomorrow", today);
    const max = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + FOLLOW_ON_MAX_DAYS);
      return d.toISOString().slice(0, 10);
    })();
    const set = (f: FollowWhen | "pick" | null) => {
      sorter.touch("follow");
      if (f === null) c.setFollow(false);
      else {
        c.setFollow(true);
        c.setWhen(f);
      }
    };
    const picked = c.follow && c.when === "pick";
    return (
      <>
        <Head title={p("Look at it again?", "फिर से देखना है?")} />
        <div className="nc-body">
          <div className="nc-opts" role="group" aria-label={tx(p("When", "कब"))}>
            <button type="button" className="tap nc-opt" aria-pressed={!c.follow} onClick={() => set(null)}>
              {tx(p("Just noting", "सिर्फ़ जानकारी"))}
              <small>{tx(p("no reminder", "कोई याद नहीं"))}</small>
            </button>
            {(["tomorrow", "next_monday", "one_week"] as const).map((w) => {
              const t = whenText(w, today);
              return (
                <button key={w} type="button" className="tap nc-opt" aria-pressed={c.follow && c.when === w} onClick={() => set(w)}>
                  {tx(t.main)}
                  <small>{tx(t.date)}</small>
                </button>
              );
            })}
            <button type="button" className="tap nc-opt wide" aria-pressed={picked} onClick={() => set("pick")}>
              <span className="nc-f" style={{ gap: 8 }}>
                <Ic n="calendar" size={16} />
                {picked && c.followOnDate ? tx(p(day(c.followOnDate), shortDayHi(c.followOnDate))) : tx(p("Pick a date", "तारीख़ चुनें"))}
              </span>
            </button>
          </div>
          {picked ? (
            <input className="inp nc-date" type="date" aria-label={tx(p("Which day?", "कौन सा दिन?"))} min={min} max={max} value={c.followOn} onChange={(e) => c.setFollowOn(e.target.value)} />
          ) : null}
          {c.follow ? (
            <>
              <span className="nc-hint">{tx(p("Who looks at it again?", "फिर कौन देखेगा?"))}</span>
              <div className="nc-chips" role="group" aria-label={tx(p("Who follows up", "कौन देखेगा"))}>
                {owners.map((o) => (
                  <button key={o.key} type="button" className={`tap chip${c.owner === o.key ? " on" : ""}`} aria-pressed={c.owner === o.key} onClick={() => c.setOwner(o.key)}>
                    {tx(o.label)}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
        {done}
      </>
    );
  }

  /* -- who can read it -- */
  if (sub === "readers") {
    const team = readersLine({ child: kid, visibility: "team", tags: c.tags, viewer, people, followOn });
    return (
      <>
        <Head title={p("Who can read it?", "कौन पढ़ सकता है?")} />
        <div className="nc-body">
          {(
            [
              { v: "team", icon: "users", title: sensitive ? p("Admin and class teacher", "प्रशासक और कक्षा अध्यापक") : p("Teachers and office", "अध्यापक और कार्यालय"), line: team },
              { v: "private", icon: "lock", title: p("Only me", "सिर्फ़ मैं"), line: p("Only you can see this note. Good for a private thought.", "यह नोट सिर्फ़ आप देख सकते हैं। निजी बात के लिए ठीक।") },
            ] as const
          ).map((o) => (
            <button key={o.v} type="button" className="tap nc-radio" role="radio" aria-checked={c.visibility === o.v} onClick={() => c.pickVisibility(o.v)}>
              <span className="dot" aria-hidden="true">{c.visibility === o.v ? <b /> : null}</span>
              <span className="nc-c" style={{ gap: 3, minWidth: 0 }}>
                <span className="nc-f" style={{ gap: 6, fontWeight: 700, fontSize: 15 }}>
                  <Ic n={o.icon} size={16} />
                  {tx(o.title)}
                </span>
                <span className="nc-meta wrap">{tx(o.line)}</span>
              </span>
            </button>
          ))}
          <span className="nc-hint">{tx(p("Parents never see notes.", "माता-पिता नोट कभी नहीं देखते।"))}</span>
        </div>
        {done}
      </>
    );
  }

  /* -- tell parents -- */
  if (sub === "parents") {
    const msg = parentNoteMessage({ childName: kid.name, teacher: viewer.name, body: text || "…", school });
    return (
      <>
        <Head title={p("Tell the parents?", "माता-पिता को बताएँ?")} />
        <div className="nc-body">
          <button type="button" className="tap nc-radio nc-swrow" role="switch" aria-checked={parentsOn} onClick={c.toggleTell} disabled={c.visibility === "private"}>
            <Ic n="message" size={20} />
            <span className="nc-c" style={{ gap: 2, minWidth: 0 }}>
              <b>{tx(p("Tell parents", "माता-पिता को बताएँ"))}</b>
              <span className="nc-meta wrap">
                {c.visibility === "private" ? tx(p("Not for an “Only me” note.", "“सिर्फ़ मैं” नोट के लिए नहीं।")) : parentsOn ? tx(p(`1 WhatsApp from the school’s number · about ${COST}`, `स्कूल के नंबर से 1 व्हाट्सऐप · लगभग ${COST}`)) : tx(p("Off · parents are not told", "बंद · माता-पिता को नहीं बताया जाएगा"))}
              </span>
            </span>
            <span className={`sw${parentsOn ? " on" : ""}`}><span /></span>
          </button>
          {parentsOn ? (
            <div className="nc-wa">
              <WaBubble hi={msg.hi} en={msg.en} foot={tx(p("queued for the office when you save", "सहेजने पर कार्यालय की कतार में"))} />
            </div>
          ) : (
            <span className="nc-hint">{tx(p("When it is on, the office sends the parents a WhatsApp after you save. Nothing goes out from here.", "चालू होने पर, सहेजने के बाद कार्यालय माता-पिता को व्हाट्सऐप भेजता है। यहाँ से कुछ नहीं जाता।"))}</span>
          )}
        </div>
        {done}
      </>
    );
  }

  /* -- clearer wording (D-487) -- */
  if (sub === "tidy" && sorter.tidy) {
    const tidy = sorter.tidy;
    return (
      <>
        <Head title={p("Clearer wording", "साफ़ शब्दों में")} />
        <div className="nc-body">
          <span className="nc-hint">{tx(p("Your words", "आपके शब्द"))}</span>
          <p className="nc-quote"><span>{excerpt(text, 400)}</span></p>
          <span className="nc-hint ai">
            <Ic n="sparkle" size={14} />
            {tx(p("Written clearly by the AI", "AI ने साफ़ लिखा"))}
          </span>
          <p className="nc-quote ai"><span>{excerpt(tidy, 400)}</span></p>
          <span className="nc-meta wrap">{tx(DRAFT_NOTE)} {tx(PRIVACY_NOTE)}</span>
        </div>
        <div className="nc-foot">
          {/* One decision per AI answer (D-324): this wording came with the sort, which is counted at Save. */}
          <button type="button" className="tap btn sec nt-big" style={{ flex: 1 }} onClick={() => flow.openSub(null)}>
            {tx(p("Keep mine", "मेरे शब्द रखें"))}
          </button>
          <button
            type="button"
            className="tap btn pri nt-big"
            style={{ flex: 1.4 }}
            onClick={() => {
              c.setBody(tidy);
              c.setMode("type");
              sorter.adopt(tidy);
              flow.openSub(null);
            }}
          >
            <Ic n="check" size={18} />
            {tx(p("Use this", "यही रखें"))}
          </button>
        </div>
      </>
    );
  }

  /* -- in the other language (D-324) -- */
  if (sub === "translate") {
    const t = translator.state;
    const to = t.kind === "idle" ? translateTarget(text) : t.to;
    const ready = t.kind === "done" && t.text === text ? t : null;
    return (
      <>
        <Head title={to === "en" ? p("In English", "अंग्रेज़ी में") : p("In Hindi", "हिंदी में")} />
        <div className="nc-body">
          <span className="nc-hint">{tx(p("Your words", "आपके शब्द"))}</span>
          <p className="nc-quote"><span>{excerpt(text, 400)}</span></p>
          <span className="nc-hint ai">
            <Ic n="sparkle" size={14} />
            {tx(p("Translated by the AI", "AI ने अनुवाद किया"))}
          </span>
          {ready ? (
            <p className="nc-quote ai"><span>{excerpt(ready.value, 400)}</span></p>
          ) : t.kind === "problem" && t.text === text ? (
            <span className="nc-note" role="status">
              <Ic n="info" size={16} />
              {tx(PROBLEM_TEXT[t.problem])}
            </span>
          ) : (
            <p className="nc-quote ai nc-pulse" role="status"><span>{tx(p("Translating…", "अनुवाद हो रहा है…"))}</span></p>
          )}
          <span className="nc-meta wrap">{tx(DRAFT_NOTE)} {tx(PRIVACY_NOTE)}</span>
        </div>
        <div className="nc-foot">
          <button
            type="button"
            className="tap btn sec nt-big"
            style={{ flex: 1 }}
            onClick={() => {
              if (ready) reportDecision(ready.logId, "discarded");
              translator.reset();
              flow.openSub(null);
            }}
          >
            {tx(p("Keep mine", "मेरे शब्द रखें"))}
          </button>
          <button
            type="button"
            className="tap btn pri nt-big"
            style={{ flex: 1.4 }}
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              reportDecision(ready.logId, "kept");
              c.setBody(ready.value);
              c.setMode("type");
              sorter.adopt(ready.value);
              translator.reset();
              flow.openSub(null);
            }}
          >
            <Ic n="check" size={18} />
            {tx(p("Use this", "यही रखें"))}
          </button>
        </div>
      </>
    );
  }

  /* -- the check itself -- */
  return (
    <>
      <KidHead kid={kid} ct={ct} mine={mine} onChange={() => flow.go("child")} />
      <div className="nc-body">
        {/* The words and the AI's offers: side by side when the card is squeezed (useFrame). */}
        <div className="nc-wtop">
          {/* The words themselves are the way back to them: one tap anywhere on them. */}
          <button type="button" className="tap nc-words" onClick={() => flow.go("write")}>
            <span className="nc-wt">{text}</span>
            <span className="nc-wedit">
              <Ic n="edit" size={15} />
              {tx(p("Edit", "बदलें"))}
            </span>
          </button>
          {sorter.tidy || canTranslate ? (
            <div className="nc-wacts">
              {sorter.tidy ? (
                <button type="button" className="tap nc-tidy" aria-label={tx(p("Clearer wording is ready · See", "साफ़ शब्दों में तैयार है · देखें"))} onClick={() => flow.openSub("tidy")}>
                  <Ic n="sparkle" size={16} />
                  <span className="nc-e" style={{ flex: 1 }}>{tx(p("Clearer wording is ready", "साफ़ शब्दों में तैयार है"))}</span>
                  <b>{tx(p("See", "देखें"))}</b>
                </button>
              ) : null}
              {canTranslate ? (
                <button
                  type="button"
                  className="tap nc-tr"
                  aria-label={tx(translateTarget(text) === "en" ? p("In English", "अंग्रेज़ी में") : p("In Hindi", "हिंदी में"))}
                  onClick={() => {
                    translator.run();
                    flow.openSub("translate");
                  }}
                >
                  <Ic n="globe" size={16} />
                  <span>{tx(translateTarget(text) === "en" ? p("In English", "अंग्रेज़ी में") : p("In Hindi", "हिंदी में"))}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {row("kinds", c.tags[0] ? look[c.tags[0]].icon : "tag", c.tags[0] ? [look[c.tags[0]].bg, look[c.tags[0]].fg] : ["var(--s2)", "var(--mut)"], p("About", "किस बारे में"), kindVal, mark("tags"))}
        {row("follow", "calendar", c.follow ? ["var(--warns)", "var(--warnfg)"] : ["var(--s2)", "var(--mut)"], p("Follow-up", "फिर देखना"), followVal, mark("follow"))}
        {row("readers", c.visibility === "private" ? "lock" : "users", ["var(--infos)", "var(--info)"], p("Who can read it", "कौन पढ़ सकता है"), readVal)}
        {viewer.parentNotes === false ? null : row("parents", "message", parentsOn ? ["var(--oks)", "var(--ok)"] : ["var(--s2)", "var(--mut)"], p("Tell parents", "माता-पिता को बताएँ"), parentVal)}
        <span className={`nc-ai ${aiLine.tone}${ai.kind === "working" && ai.text === text ? " busy" : ""}`} role="status">
          <Ic n={aiLine.icon} size={14} className={ai.kind === "working" && ai.text === text ? "nc-pulse" : undefined} />
          {tx(aiLine.text)}
        </span>
      </div>
      <div className="nc-foot nc-savefoot">
        <SaveBarLine c={c} onSaved={props.onSaved} idle="" style={{ fontSize: 12.5 }} />
        <div className="nc-f" style={{ gap: 10, width: "100%" }}>
          <button type="button" className="tap btn sec nt-big nc-ib" aria-label={tx(p("Previous step", "पिछला कदम"))} onClick={() => flow.go("write")}>
            <Ic n="chevLeft" size={22} />
          </button>
          <button type="button" className="tap btn pri nt-big" disabled={c.pending || c.saveUncertain} onClick={props.onSave} style={{ flex: 1 }}>
            {c.pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="check" size={18} />}
            {both(p("Save note", "नोट सहेजें"))}
          </button>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- 4 saved */

function savedNoteOf(props: CardsProps): BoardNote | null {
  const { c, savedId, notes, viewer, today } = props;
  if (!savedId) return null;
  const found = notes.find((n) => n.id === savedId);
  if (found) return found;
  const k = c.child;
  return {
    id: savedId,
    studentId: k?.id ?? null,
    studentName: k?.name ?? "",
    classId: k?.classId ?? null,
    classLabel: k?.classLabel ?? "—",
    body: c.body,
    tags: c.tags,
    source: c.voice ? "voice" : "typed",
    status: "open",
    visibility: c.visibility,
    needsFollowUp: c.follow,
    followUpOn: c.follow ? c.followOnDate : null,
    followUpOwner: c.follow ? c.owner : null,
    followUpStaffId: null,
    followUpName: null,
    tellParents: c.tellParents && c.visibility === "team" && viewer.parentNotes !== false,
    writtenBy: viewer.id,
    writtenByName: viewer.name,
    authorRelation: null,
    subjectCode: null,
    createdAt: today,
    replies: 0,
    planId: null,
  };
}

function SavedCard(props: CardsProps & { onAgain: () => void; onNew: () => void }) {
  const { viewer, people, board, undoing } = props;
  const { tx } = useVx();
  const both = useBoth();
  const note = savedNoteOf(props);
  const look = TAG_LOOK(Boolean(board));
  if (!note) return null;
  const ct = note.classId ? (people.classTeachers[note.classId] ?? null) : null;
  const mine = note.classId ? viewer.heldClassIds.includes(note.classId) : false;
  const who =
    note.visibility !== "team"
      ? p("Only you can see this note.", "यह नोट सिर्फ़ आप देख सकते हैं।")
      : isSensitiveNote(note)
        ? p("Only the admin and the class teacher can see it.", "सिर्फ़ प्रशासक और कक्षा अध्यापक इसे देख सकते हैं।")
        : mine
          ? p("The class’s subject teachers, the coordinator and the office can see it now.", "कक्षा के विषय अध्यापक, समन्वयक और कार्यालय अब इसे देख सकते हैं।")
          : p(`${ct ?? "The class teacher"} (class teacher), the class’s other teachers, the coordinator and the office can see it.`, `${ct ?? "कक्षा अध्यापक"} (कक्षा अध्यापक), कक्षा के दूसरे अध्यापक, समन्वयक और कार्यालय इसे देख सकते हैं।`);
  return (
    <>
      <div className="nc-ch nc-saved">
        <svg width="52" height="52" viewBox="0 0 96 96" aria-hidden="true" className="nc-tick">
          <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
          <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 5, ["--len" as string]: 276.5, strokeDasharray: 276.5, animation: "xDraw .7s .1s var(--ease) both" }} />
          <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 7, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: 60, strokeDasharray: 60, animation: "xDraw .45s .5s var(--ease) both" }} />
        </svg>
        <span className="nc-c" style={{ minWidth: 0 }}>
          <h2 className="nc-h2" data-title>{both(p("Saved", "सहेजा गया"))}</h2>
          <span className="nc-meta">{note.studentName ? `${note.studentName} · ${note.classLabel}` : note.classLabel}</span>
        </span>
      </div>
      <div className="nc-body">
        <p className="nc-quote"><span>{excerpt(note.body, 160)}</span></p>
        <div className="nc-chips">
          {note.tags.map((t) => (
            <span key={t} className="pill" style={{ background: look[t].bg, color: look[t].fg }}>
              <Ic n={look[t].icon} size={12} />
              {tx(TAG_TEXT[t])}
            </span>
          ))}
        </div>
        <span className="nc-line">
          <Ic n={note.visibility === "team" ? "users" : "lock"} size={16} />
          {tx(who)}
        </span>
        {note.needsFollowUp && note.followUpOn ? (
          <span className="nc-line">
            <Ic n="bell" size={16} />
            {tx(p(`Reminder on ${day(note.followUpOn)}.`, `${shortDayHi(note.followUpOn)} को याद दिलाया जाएगा।`))}
          </span>
        ) : null}
        {note.tellParents ? (
          <span className="nc-line">
            <Ic n="message" size={16} />
            {tx(p("A WhatsApp to the parents is queued for the office.", "माता-पिता के लिए व्हाट्सऐप कार्यालय की कतार में है।"))}
          </span>
        ) : null}
        <div className="nc-acts">
          <button type="button" className="tap nc-act" onClick={props.onAgain}>
            <Ic n="users" size={18} />
            {tx(p("Same note, another child", "यही नोट, दूसरा बच्चा"))}
          </button>
          <button type="button" className="tap nc-act" onClick={props.onNew}>
            <Ic n="plus" size={18} />
            {tx(p("New note", "नया नोट"))}
          </button>
          <button type="button" className="tap nc-act" disabled={undoing} onClick={props.onUndo}>
            <Ic n="undo" size={18} />
            {tx(p("Undo", "वापस लें"))}
          </button>
          {props.onPlan && note.studentId ? (
            <button type="button" className="tap nc-act" onClick={props.onPlan}>
              <Ic n="layers" size={18} />
              {tx(p("Support plan", "सहायता योजना"))}
            </button>
          ) : null}
        </div>
      </div>
      <div className="nc-foot">
        <button type="button" className="tap btn pri nt-big" onClick={props.onDone} style={{ flex: 1 }}>
          <Ic n="check" size={18} />
          {both(p("Done · all notes", "हो गया · सभी नोट्स"))}
        </button>
      </div>
    </>
  );
}

/* --------------------------------------------- the desk's rail and panel */

function Rail({ flow, c, savedId, onNext }: CardsProps & { onNext: () => void }) {
  const { tx } = useVx();
  const child = c.child;
  const text = c.body.trim();
  const items: { key: NoteCardName; label: Pair; value: string; done: boolean; can: boolean }[] = [
    { key: "child", label: p("The child", "बच्चा"), value: child ? `${child.name} · ${child.classLabel}` : "", done: Boolean(child), can: !savedId },
    { key: "write", label: p("The note", "नोट"), value: text ? excerpt(text, 44) : "", done: Boolean(text) && flow.card !== "write", can: Boolean(child) && !savedId },
    { key: "check", label: p("Check and save", "जाँचें और सहेजें"), value: savedId ? tx(p("Saved", "सहेजा गया")) : flow.card === "check" ? c.tags.map((t) => tx(TAG_TEXT[t])).join(" · ") : "", done: Boolean(savedId), can: Boolean(child && text) && !savedId },
  ];
  return (
    <nav className="nc-rail" aria-label={tx(p("Steps", "कदम"))}>
      <h3>{tx(p("New note", "नया नोट"))}</h3>
      {items.map((it, i) => (
        <button key={it.key} type="button" className={`nc-ri${it.done ? " done" : ""}${flow.card === it.key ? " cur" : ""}`} disabled={!it.can || flow.card === it.key} onClick={() => (it.key === "check" ? onNext() : flow.go(it.key))}>
          <span className="dot">{it.done ? <Ic n="check" size={14} /> : i + 1}</span>
          <span className="nc-c" style={{ minWidth: 0 }}>
            <span className="lab">{tx(it.label)}</span>
            <span className={`val${it.value ? "" : " empty"}`}>{it.value || "—"}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}

function Context({ c, notes, people, viewer, board }: CardsProps) {
  const { tx } = useVx();
  const child = c.child;
  const look = TAG_LOOK(Boolean(board));
  if (!child) {
    return (
      <aside className="nc-ctx">
        <div className="nc-cbox">
          <h4>{tx(p("How it works", "कैसे काम करता है"))}</h4>
          {[p("Pick the child", "बच्चा चुनें"), p("Write or speak a line or two", "एक-दो लाइन लिखें या बोलें"), p("Check what the app sorted, and save", "ऐप ने जो छाँटा, जाँचें और सहेजें")].map((s, i) => (
            <span key={s.en} className="nc-line">
              <b className="nc-n">{i + 1}</b>
              {tx(s)}
            </span>
          ))}
        </div>
      </aside>
    );
  }
  const theirs = notes.filter((n) => n.studentId === child.id).slice(0, 3);
  const ct = people.classTeachers[child.classId] ?? null;
  return (
    <aside className="nc-ctx">
      <div className="nc-cbox">
        <h4>{tx(p("This child", "यह बच्चा"))}</h4>
        <div className="nc-f" style={{ gap: 10 }}>
          <Avatar name={child.name} size={40} />
          <span className="nc-c" style={{ minWidth: 0 }}>
            <b className="nc-e">{child.name}</b>
            <span className="nc-meta">{[child.classLabel, ct ? tx(p(`class teacher ${ct}`, `कक्षा अध्यापक ${ct}`)) : null].filter(Boolean).join(" · ")}</span>
          </span>
        </div>
      </div>
      <div className="nc-cbox">
        <h4>{tx(p("Recent notes", "हाल के नोट"))}</h4>
        {theirs.length ? (
          theirs.map((n) => (
            <div key={n.id} className="nc-cn">
              <span className="nc-meta">{tx(day(n.createdAt))} · {n.writtenBy === viewer.id ? tx(p("you", "आप")) : n.writtenByName}</span>
              <span className="nc-cnb">{excerpt(n.body, 90)}</span>
              <span className="nc-f" style={{ gap: 4, flexWrap: "wrap" }}>
                {n.tags.map((t) => (
                  <span key={t} className="pill" style={{ background: look[t].bg, color: look[t].fg }}>{tx(TAG_TEXT[t])}</span>
                ))}
              </span>
            </div>
          ))
        ) : (
          <span className="nc-meta wrap">{tx(p("No notes on this child yet.", "इस बच्चे पर अभी कोई नोट नहीं।"))}</span>
        )}
      </div>
    </aside>
  );
}
