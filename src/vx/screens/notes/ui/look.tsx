"use client";

import { type CSSProperties, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { initials, shortDay } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { LanguageControl } from "@/vx/ui/language";

import { FOLLOW_OWNER, followUpWho, noteSchoolDay, noteSubject, type BoardNote, type FollowOwner, type NoteStage, type NoteTag } from "../domain/notes";

import "./notes.css";

/*
 * How the notes screens look: the design's tag and status colours, its
 * header, its segmented control and small parts both modules share. The two
 * design modules colour three tags differently (Notes vs TchNotes); each
 * screen follows its own frame.
 */

const V = (x: string) => `var(--${x})`;

export type TagLook = { icon: IconName; bg: string; fg: string };

/** The board's tags (design `Notes` TAG). */
export const BOARD_TAG: Record<NoteTag, TagLook> = {
  studies: { icon: "book", bg: V("infos"), fg: V("info") },
  behaviour: { icon: "smile", bg: V("warns"), fg: V("warnfg") },
  health: { icon: "heart", bg: V("bads"), fg: V("bad") },
  family: { icon: "home", bg: V("accs"), fg: V("accfg") },
  talent: { icon: "star", bg: V("oks"), fg: V("ok") },
  attendance: { icon: "calCheck", bg: V("s3"), fg: V("pri") },
};

/** The teacher's tags (design `TchNotes` TAG). */
export const TEACH_TAG: Record<NoteTag, TagLook> = {
  studies: { icon: "book", bg: V("infos"), fg: V("info") },
  behaviour: { icon: "smile", bg: V("accs"), fg: V("accfg") },
  health: { icon: "heart", bg: V("bads"), fg: V("bad") },
  family: { icon: "home", bg: V("warns"), fg: V("warnfg") },
  talent: { icon: "star", bg: V("oks"), fg: V("ok") },
  attendance: { icon: "calCheck", bg: V("s3"), fg: V("fg") },
};

/** The tag-mix bar's colours, in NOTE_TAGS order (design `ins.parts`). */
export const MIX_COLOR: Record<NoteTag, string> = {
  studies: V("c1"),
  behaviour: V("c3"),
  health: V("bad"),
  family: V("c2"),
  talent: V("ok"),
  attendance: V("c4"),
};

export const STAGE_TEXT: Record<NoteStage, Pair> = {
  open: p("Open", "खुला"),
  working: p("Working on it", "काम जारी"),
  done: p("Done", "पूरा"),
  noting: p("Just noting", "सिर्फ़ जानकारी"),
};

export const STAGE_LOOK: Record<NoteStage, { bg: string; fg: string }> = {
  open: { bg: V("warns"), fg: V("warnfg") },
  working: { bg: V("infos"), fg: V("info") },
  done: { bg: V("oks"), fg: V("ok") },
  noting: { bg: V("s2"), fg: V("mut") },
};

/** A key label as one line: "Save note · नोट सहेजें" when the reader reads both. */
export function useBoth() {
  const { tx, sub } = useVx();
  return (pair: Pair) => {
    const second = sub(pair);
    return second ? `${tx(pair)} · ${second}` : tx(pair);
  };
}

/** Who wrote a note, in words: "Class teacher", "Subject teacher", "Admin". */
export function relationText(relation: string | null): Pair | null {
  switch (relation) {
    case "class_teacher":
      return p("Class teacher", "कक्षा अध्यापक");
    case "subject_teacher":
      return p("Subject teacher", "विषय अध्यापक");
    case "admin":
      return p("Admin", "प्रशासक");
    case "academic_coordinator":
      return p("Coordinator", "समन्वयक");
    case "office":
      return p("Office", "कार्यालय");
    default:
      return null;
  }
}

/**
 * Who a note is about and who follows it up, in the reader's words: the
 * child (or "Whole class"), with SR and father under a shared name; "You"
 * only for the reader's own follow-up, never another teacher's "Me".
 */
export function useNoteWords(viewerId: string) {
  const { tx } = useVx();
  return {
    name: (note: Pick<BoardNote, "studentId" | "studentName">) => tx(noteSubject(note)),
    /** A whole-class note shows the class number ("8"), a missing child "?". */
    initials: (note: Pick<BoardNote, "studentId" | "studentName" | "classLabel">) =>
      note.studentId ? (note.studentName.trim() ? initials(note.studentName) : "?") : (/\d+/.exec(note.classLabel)?.[0] ?? initials(note.classLabel)),
    hint: (note: Pick<BoardNote, "studentHint">) => (note.studentHint ? tx(note.studentHint) : null),
    who: (note: Pick<BoardNote, "followUpOwner" | "followUpName" | "followUpStaffId" | "writtenBy" | "writtenByName">) => {
      const w = followUpWho(note, viewerId);
      return w ? tx(w) : null;
    },
  };
}

/** The short role a follow-up went to: "Class teacher", "Coordinator", "Admin", "Me". */
export function ownerRoleText(owner: FollowOwner | null): Pair | null {
  if (owner === "admin") return p("Admin", "प्रशासक");
  return FOLLOW_OWNER.find((o) => o.key === owner)?.text ?? null;
}

/** "Thu 8 Oct", as the design writes a day (no comma). */
export function day(value: string | Date): string {
  return shortDay(value).replace(/,/g, "").replace(/\bSept\b/, "Sep");
}

/** "9:52 am". */
export function time(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(typeof value === "string" ? new Date(value) : value).toLowerCase();
}

/** "Thu 8 Oct · 9:52 am" for a note written in the last two days, else "Tue 6 Oct". */
export function noteWhen(createdAt: string, today: string): string {
  const d = noteSchoolDay(createdAt);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  return diff <= 1 ? `${day(createdAt)} · ${time(createdAt)}` : day(createdAt);
}

/** A follow-up date is close when it is today, tomorrow or late. */
export function followSoon(note: Pick<BoardNote, "followUpOn">, today: string): boolean {
  if (!note.followUpOn) return false;
  const diff = Math.round((Date.parse(`${note.followUpOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff <= 1;
}

export function ini(name: string): string {
  return initials(name);
}

/** The design's TchNotes avatar tones, picked by the name's length. */
const TONES: [string, string][] = [
  [V("accs"), V("accfg")],
  [V("infos"), V("info")],
  [V("oks"), V("ok")],
  [V("warns"), V("warnfg")],
  [V("s3"), V("fg")],
];

export function nameTone(name: string): [string, string] {
  return TONES[name.length % TONES.length]!;
}

export function toneAt(i: number): [string, string] {
  return TONES[i % TONES.length]!;
}

/* ------------------------------------------------------------------ pills */

export function TagPill({ tag, look, big, both }: { tag: NoteTag; look: Record<NoteTag, TagLook>; big?: boolean; both?: Pair }) {
  const { tx } = useVx();
  const l = look[tag];
  return (
    <span className="pill" style={{ background: l.bg, color: l.fg, ...(big ? { height: 26, padding: "0 10px", fontSize: 12 } : null) }}>
      <Ic n={l.icon} size={big ? 13 : 12} />
      {both ? tx(both) : null}
    </span>
  );
}

export function StagePill({ stage, style }: { stage: NoteStage; style?: CSSProperties }) {
  const { tx } = useVx();
  const l = STAGE_LOOK[stage];
  return (
    <span className="pill" style={{ background: l.bg, color: l.fg, ...style }}>
      {tx(STAGE_TEXT[stage])}
    </span>
  );
}

/* ------------------------------------------------------------------- seg */

/** The design's segmented control (`.seg` + `.thumb`) with `aria-pressed` buttons. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
  className = "",
  buttonStyle,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  style?: CSSProperties;
  className?: string;
  buttonStyle?: CSSProperties;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`seg ${className}`} role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length},minmax(0,1fr))`, ...style }}>
      <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)`, opacity: value === null ? 0 : 1 }} />
      {options.map((o) => (
        <button key={o.value} type="button" className={`tap${o.value === value ? " on" : ""}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)} style={buttonStyle}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- header */

export type Back = { href: string } | { onClick: () => void } | null;

function BackButton({ back, size }: { back: NonNullable<Back>; size: number }) {
  const { tx } = useVx();
  const icon = <Ic n="chevLeft" size={size === 44 ? 24 : 22} />;
  const style: CSSProperties = { width: size, height: size, padding: 0, borderRadius: size / 2, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" };
  if ("href" in back) {
    return (
      <BackLink href={back.href} className="tap btn ghost" style={style}>
        {icon}
      </BackLink>
    );
  }
  return (
    <button type="button" className="tap btn ghost" aria-label={tx(p("Back", "वापस"))} onClick={back.onClick} style={style}>
      {icon}
    </button>
  );
}

/**
 * The notes screens' top bar, as the two designs draw it: on a desk a 64px
 * glass bar with an optional back arrow, the crumb and a serif title, then
 * the language switch, help and (on the board) "Add a note"; on a phone a
 * 58px bar with back, a bold title and a sub-line.
 */
export function NotesTop({
  crumb,
  title,
  mTitle,
  mSub,
  dBack,
  mBack,
  onHelp,
  add,
  teacher,
}: {
  crumb: string;
  title: string;
  mTitle: string;
  mSub?: string;
  dBack?: Back;
  mBack: Back;
  onHelp: () => void;
  add?: ReactNode;
  teacher?: boolean;
}) {
  const { tx } = useVx();
  const help = (size: number) => (
    <button type="button" className="tap btn ghost" aria-label={tx(p("Help for this screen", "इस स्क्रीन की मदद"))} onClick={onHelp} style={{ width: size, height: size, padding: 0, borderRadius: teacher ? size / 2 : undefined }}>
      <Ic n="help" size={22} />
    </button>
  );
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: teacher ? 6 : 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {dBack ? <BackButton back={dBack} size={teacher ? 44 : 40} /> : null}
        <div className="nx-c" style={{ flex: 1, paddingLeft: teacher ? 2 : 0 }}>
          <span className="nx-m" style={{ fontSize: 12 }}>{crumb}</span>
          <h1 className="serif nx-e" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
        </div>
        {/* All three languages (smoke 20 Oct): the old switch wrote only hi or both and lost en. */}
        <LanguageControl />
        {help(teacher ? 44 : 40)}
        {add}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: teacher ? 6 : 2, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        {mBack ? <BackButton back={mBack} size={44} /> : <span style={{ width: 8 }} />}
        <span className="nx-c" style={{ flex: 1, paddingLeft: 2 }}>
          <span className="nx-e" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle}</span>
          {mSub ? <span className="nx-e" style={{ fontSize: 12, color: "var(--mut)" }}>{mSub}</span> : null}
        </span>
        <LanguageControl pill />
        {help(44)}
      </header>
    </>
  );
}

/* ------------------------------------------------------------------ help */

export type HelpStep = { icon: IconName; title: Pair; body: Pair };

/** The "?" sheet's steps, drawn inline by the screen's own Sheet. */
export function HelpSteps({ steps }: { steps: HelpStep[] }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {steps.map((h, i) => (
        <div key={h.title.en} className="nx-f" style={{ gap: 14, padding: "10px 0", borderTop: i ? "1px solid var(--bd)" : 0, animation: `xIn .32s var(--ease) ${i * 80}ms both` }}>
          <span className="nx-ib" style={{ width: 56, height: 56, borderRadius: 18, background: "var(--accs)", color: "var(--accfg)" }}>
            <Ic n={h.icon} size={26} />
          </span>
          <span className="nx-c">
            <span className="nx-b" style={{ fontWeight: 700 }}>{i + 1}. {tx(h.title)}</span>
            <span className="nx-m" style={{ fontSize: 13 }}>{tx(h.body)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** A WhatsApp bubble: Hindi first, a rule, then English (RULES H). */
export function WaBubble({ hi, en, foot }: { hi: string; en: string; foot: string }) {
  return (
    <div className="nx-wa">
      <div className="nx-wb">
        <p lang="hi">{hi}</p>
        <hr />
        <p>{en}</p>
        <small>{foot}</small>
      </div>
    </div>
  );
}

/** Set or drop URL params without a navigation. */
export function replaceParams(changes: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.replaceState(window.history.state, "", url.toString());
}
