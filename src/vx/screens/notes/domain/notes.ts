/**
 * Notes on children (design TchNotes, Notes board): tags, follow-ups, who
 * may see a note, the board's tabs and counts. Pure; unit-tested in
 * `tests/vx-notes.test.ts`.
 */

import { toSchoolDay } from "@/platform/dates";
import { p, type Pair } from "@/vx/text";

export const NOTE_TAGS = ["studies", "behaviour", "health", "family", "talent", "attendance"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export const TAG_TEXT: Record<NoteTag, Pair> = {
  studies: p("Studies", "पढ़ाई"),
  behaviour: p("Behaviour", "व्यवहार"),
  health: p("Health", "स्वास्थ्य"),
  family: p("Family", "परिवार"),
  talent: p("Talent", "प्रतिभा"),
  attendance: p("Attendance", "हाज़िरी"),
};

export const TAG_TONE: Record<NoteTag, "info" | "warn" | "bad" | "acc" | "ok" | "mut"> = {
  studies: "info",
  behaviour: "warn",
  health: "bad",
  family: "acc",
  talent: "ok",
  attendance: "mut",
};

/** Colours for the tag-mix bar, one per tag. */
export const TAG_COLOR: Record<NoteTag, string> = {
  studies: "var(--info)",
  behaviour: "var(--warn)",
  health: "var(--bad)",
  family: "var(--acc)",
  talent: "var(--ok)",
  attendance: "var(--c4)",
};

export function isTag(value: unknown): value is NoteTag {
  return typeof value === "string" && (NOTE_TAGS as readonly string[]).includes(value);
}

/** The old note kinds, as tags, for a note written before tags existed. */
export function tagsFromKind(code: string | null | undefined): NoteTag[] {
  switch (code) {
    case "behaviour":
      return ["behaviour"];
    case "praise":
      return ["talent"];
    case "homework":
      return ["studies"];
    case "health":
      return ["health"];
    case "parent":
      return ["family"];
    default:
      return [];
  }
}

/**
 * The note kind a new note is filed under. `notes.kind_id` is still required
 * and the coordinator's attention view reads its tone, so the first tag picks
 * the closest kind.
 */
export function kindForTags(tags: readonly NoteTag[]): string {
  const first = tags[0];
  switch (first) {
    case "behaviour":
      return "behaviour";
    case "talent":
      return "praise";
    case "studies":
      return "homework";
    case "health":
      return "health";
    case "family":
      return "parent";
    default:
      return "other";
  }
}

export const QUICK_PHRASES: Pair[] = [
  p("Did not bring homework", "गृहकार्य नहीं लाया"),
  p("Very good in class today", "आज कक्षा में बहुत अच्छा"),
  p("Looked unwell", "तबीयत ठीक नहीं लगी"),
  p("Not paying attention", "ध्यान नहीं दे रहा"),
  p("Fought with a classmate", "सहपाठी से झगड़ा"),
  p("Needs help with reading", "पढ़ने में मदद चाहिए"),
];

/**
 * Tags a note's words suggest (design TchNotes `KW`): the composer marks them
 * "✦ Suggested", and words that came from the voice pick them. Hindi and
 * English. Only a suggestion: the writer still chooses.
 */
const TAG_WORDS: Record<NoteTag, RegExp> = {
  studies: /भिन्न|सवाल|गणित|पढ़|गृहकार्य|अभ्यास|fraction|math|homework|practice|marks|read|lab/i,
  behaviour: /झगड़|चुप|शरारत|quiet|fight|rude|alone|talks/i,
  health: /तबीयत|बुखार|सिर|दर्द|unwell|fever|headache|sick/i,
  family: /घर|पिता|माता|दादी|परिवार|father|mother|family|grand/i,
  talent: /चित्र|गाना|खेल|drawing|sing|sport|quiz|talent|excellent|very good/i,
  attendance: /अनुपस्थित|छुट्टी|नहीं आ|absent|late|leave/i,
};

export function suggestTags(text: string): NoteTag[] {
  const t = text.trim();
  if (!t) return [];
  return NOTE_TAGS.filter((tag) => TAG_WORDS[tag].test(t));
}

/* -------------------------------------------------------------- follow-up */

export type FollowWhen = "tomorrow" | "next_monday" | "one_week";
export type FollowOwner = "me" | "class_teacher" | "coordinator" | "admin";
export type NoteStatus = "open" | "working" | "done";
export type Visibility = "team" | "private";

export const FOLLOW_WHEN: { key: FollowWhen; text: Pair }[] = [
  { key: "tomorrow", text: p("Tomorrow", "कल") },
  { key: "next_monday", text: p("Next Monday", "अगला सोमवार") },
  { key: "one_week", text: p("In a week", "एक हफ़्ते में") },
];

export const FOLLOW_OWNER: { key: FollowOwner; text: Pair }[] = [
  { key: "me", text: p("Me", "मैं") },
  { key: "class_teacher", text: p("Class teacher", "कक्षा अध्यापक") },
  { key: "coordinator", text: p("Coordinator", "समन्वयक") },
  { key: "admin", text: p("Principal / admin", "प्रधानाचार्य") },
];

export const STATUS_TEXT: Record<NoteStatus, Pair> = {
  open: p("Open", "खुला"),
  working: p("Working on it", "काम चल रहा है"),
  done: p("Done", "पूरा"),
};

export const STATUS_ORDER: NoteStatus[] = ["open", "working", "done"];

/**
 * The school day a note was written on. `createdAt` is a UTC instant, so
 * slicing it files a note written between midnight and 05:30 IST under the
 * day before — a Monday-morning note fell out of "this week" (B09).
 */
export function noteSchoolDay(createdAt: string): string {
  const instant = new Date(createdAt);
  return Number.isNaN(instant.getTime()) ? createdAt.slice(0, 10) : toSchoolDay(instant);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * The follow-up date for a choice. School does not open on Sunday, so
 * "tomorrow" from a Saturday is Monday; "next Monday" is always a Monday
 * after today; "in a week" lands on a school day too.
 */
export function followUpDate(when: FollowWhen, today: string): string {
  if (when === "tomorrow") {
    const next = addDays(today, 1);
    return weekday(next) === 0 ? addDays(next, 1) : next;
  }
  if (when === "next_monday") {
    const wd = weekday(today);
    const ahead = ((8 - wd) % 7) || 7;
    return addDays(today, ahead);
  }
  const week = addDays(today, 7);
  return weekday(week) === 0 ? addDays(week, 1) : week;
}

/** How far ahead a follow-up may be put by picking a date (a term, roughly). */
export const FOLLOW_ON_MAX_DAYS = 120;

/**
 * A follow-up date the writer picked herself (smoke 20 Oct: "only three
 * fixed days", when the PTM is in two weeks). Tomorrow at the earliest and
 * at most FOLLOW_ON_MAX_DAYS ahead; a Sunday moves to the Monday. Null when
 * the date is not one.
 */
export function pickedFollowOn(value: string | null | undefined, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
  if (value <= today || value > addDays(today, FOLLOW_ON_MAX_DAYS)) return null;
  return weekday(value) === 0 ? addDays(value, 1) : value;
}

/** "Today", "Tomorrow", "2 days late", or a date. */
export function followUpLabel(on: string | null, today: string, fmt: (d: string) => string): { text: Pair; tone: "bad" | "warn" | "mut" } | null {
  if (!on) return null;
  const diff = Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff < 0) {
    const n = -diff;
    return { text: p(`${n} ${n === 1 ? "day" : "days"} late`, `${n} दिन देर`), tone: "bad" };
  }
  if (diff === 0) return { text: p("Today", "आज"), tone: "warn" };
  if (diff === 1) return { text: p("Tomorrow", "कल"), tone: "warn" };
  return { text: p(fmt(on)), tone: "mut" };
}

/* ------------------------------------------------------------- the notes */

export type BoardNote = {
  id: string;
  studentId: string | null;
  /** Empty for a whole-class note or a missing child; show it through `noteSubject()`. */
  studentName: string;
  /** "SR 1234 · father …" when another child of the class with notes shares the name. */
  studentHint?: Pair | null;
  classId: string | null;
  classLabel: string;
  body: string;
  tags: NoteTag[];
  source: "typed" | "voice";
  status: NoteStatus;
  visibility: Visibility;
  needsFollowUp: boolean;
  followUpOn: string | null;
  followUpOwner: FollowOwner | null;
  followUpStaffId: string | null;
  followUpName: string | null;
  tellParents: boolean;
  writtenBy: string;
  writtenByName: string;
  authorRelation: string | null;
  subjectCode: string | null;
  createdAt: string;
  replies: number;
  planId: string | null;
};

/**
 * Health and family notes (D-264). The 11 October notes' §9: keep "sensitive
 * health/family notes out of general badges and unrestricted timelines".
 * A note before tags existed reads its old kind through `tagsFromKind`.
 */
export const SENSITIVE_TAGS: readonly NoteTag[] = ["health", "family"];

export function isSensitiveNote(note: { tags: readonly NoteTag[] }): boolean {
  return note.tags.some((t) => SENSITIVE_TAGS.includes(t));
}

/**
 * Who may be asked to follow a note up. Following a note up lets that person
 * read it (`canSeeNote`), so a health or family note may not go to the
 * coordinator: only the admin and the class teacher read those (D-264). The
 * teacher replay on 6 Nov 2026 found the coordinator offered, which widened
 * the note's audience by one tap.
 */
export function followOwnerAllowed(owner: FollowOwner, note: { tags: readonly NoteTag[] }): boolean {
  return !(owner === "coordinator" && isSensitiveNote(note));
}

export type NoteReader = {
  id: string;
  /** `role === "admin"`: the only school-wide role that reads health and family notes. */
  isAdmin: boolean;
  readsEveryClass: boolean;
  correctsAttendance: boolean;
  /** Every class she holds or teaches. */
  classIds: ReadonlySet<string>;
  /** The classes she is the class teacher of. */
  heldClassIds: ReadonlySet<string>;
};

/**
 * Who reads a note. The same rule as the `notes_select_scoped` policy, for
 * reads made with the service role.
 *
 *  - "Only me" is only the author.
 *  - A support note (anything not health or family) is read by the child's
 *    teachers, the person asked to follow it up, and the school-wide roles.
 *  - A health or family note is read by its author, the person asked to
 *    follow it up, the administrator and the child's class teacher — not by
 *    every subject teacher, the office or the coordinators (D-264).
 */
export function canSeeNote(
  note: { visibility: Visibility; writtenBy: string; followUpStaffId: string | null; classId: string | null; tags?: readonly NoteTag[] },
  viewer: NoteReader,
): boolean {
  if (note.writtenBy === viewer.id) return true;
  if (note.visibility !== "team") return false;
  if (note.followUpStaffId === viewer.id) return true;
  if (isSensitiveNote({ tags: note.tags ?? [] })) {
    return viewer.isAdmin || (note.classId !== null && viewer.heldClassIds.has(note.classId));
  }
  if (viewer.correctsAttendance || viewer.readsEveryClass) return true;
  return note.classId !== null && viewer.classIds.has(note.classId);
}

/** Who may move a note along (status, owner): its author, the person following it up, and the school-wide roles. */
export function canWorkOnNote(
  note: { writtenBy: string; followUpStaffId: string | null; classId: string | null },
  viewer: { id: string; readsEveryClass: boolean; correctsAttendance: boolean; heldClassIds: ReadonlySet<string> },
): boolean {
  if (note.writtenBy === viewer.id || note.followUpStaffId === viewer.id) return true;
  if (viewer.readsEveryClass || viewer.correctsAttendance) return true;
  return note.classId !== null && viewer.heldClassIds.has(note.classId);
}

/** Open and owed: a follow-up dated today or earlier. */
export function isDue(note: Pick<BoardNote, "status" | "needsFollowUp" | "followUpOn">, today: string): boolean {
  return note.status !== "done" && note.needsFollowUp && note.followUpOn !== null && note.followUpOn <= today;
}

/**
 * Needs action: a follow-up that is due, or an open note about health or
 * family that nobody has picked up yet.
 */
export function needsAction(note: BoardNote, today: string): boolean {
  if (note.status === "done") return false;
  if (isDue(note, today)) return true;
  return note.status === "open" && !note.needsFollowUp && note.tags.some((t) => t === "health" || t === "family");
}

/**
 * The one "notes needing action" count, for every screen that shows it: the
 * board's tile, the coordinator's Today card and the principal's report
 * (smoke 20 Oct: Today said 7 and the board 4, because Today counted every
 * open follow-up). `due` is the follow-ups alone; `oldestDue` is the
 * earliest of their dates, so "since Sat 10 Oct" names a real one.
 */
export function noteAttention(notes: readonly Pick<BoardNote, "status" | "needsFollowUp" | "followUpOn" | "tags">[], today: string): { needsAction: number; due: number; oldestDue: string | null } {
  let count = 0;
  let due = 0;
  let oldestDue: string | null = null;
  for (const n of notes) {
    if (needsAction(n as BoardNote, today)) count += 1;
    if (isDue(n, today)) {
      due += 1;
      if (oldestDue === null || n.followUpOn! < oldestDue) oldestDue = n.followUpOn;
    }
  }
  return { needsAction: count, due, oldestDue };
}

export type BoardTab = "action" | "followups" | "plans" | "all";

/**
 * `studentId` narrows the board to one child (`/notes?student=`). It only
 * narrows: the notes it filters are the ones this reader may already see.
 */
export type BoardFilter = { tab: BoardTab; classId?: string | null; teacherId?: string | null; tag?: NoteTag | null; studentId?: string | null };

export function filterBoard(notes: readonly BoardNote[], filter: BoardFilter, today: string): BoardNote[] {
  return notes
    .filter((n) => (filter.studentId ? n.studentId === filter.studentId : true))
    .filter((n) => (filter.classId ? n.classId === filter.classId : true))
    .filter((n) => (filter.teacherId ? n.writtenBy === filter.teacherId || n.followUpStaffId === filter.teacherId : true))
    .filter((n) => (filter.tag ? n.tags.includes(filter.tag) : true))
    .filter((n) => {
      if (filter.tab === "action") return needsAction(n, today);
      if (filter.tab === "followups") return n.needsFollowUp && n.status !== "done";
      if (filter.tab === "plans") return n.planId !== null;
      return true;
    })
    .sort((a, b) => {
      if (filter.tab === "followups") return (a.followUpOn ?? "9").localeCompare(b.followUpOn ?? "9");
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export function boardKpis(
  notes: readonly BoardNote[],
  plansRunning: number,
  today: string,
): { needsAction: number; dueThisWeek: number; plansRunning: number; thisMonth: number } {
  const weekEnd = weekEndOf(today);
  const month = today.slice(0, 7);
  return {
    needsAction: notes.filter((n) => needsAction(n, today)).length,
    dueThisWeek: notes.filter((n) => n.status !== "done" && n.needsFollowUp && n.followUpOn !== null && n.followUpOn <= weekEnd).length,
    plansRunning,
    thisMonth: notes.filter((n) => noteSchoolDay(n.createdAt).slice(0, 7) === month).length,
  };
}

/** The Sunday that ends this school week: "follow-ups due this week" run from today to it. */
export function weekEndOf(today: string): string {
  return addDays(today, 6 - ((weekday(today) + 6) % 7));
}

/** The Monday that starts this school week. */
export function weekStartOf(today: string): string {
  return addDays(today, -((weekday(today) + 6) % 7));
}

/**
 * Where a note stands, as the cards say it: done, being worked on, open
 * (someone must act: a follow-up was asked, or it is an unclaimed health or
 * family note), or "just noting" — kept on the record with nothing asked.
 */
export type NoteStage = NoteStatus | "noting";

export function noteStage(note: Pick<BoardNote, "status" | "needsFollowUp" | "tags">): NoteStage {
  if (note.status !== "open") return note.status;
  return note.needsFollowUp || isSensitiveNote(note) ? "open" : "noting";
}

/** The board's "Notes this month" line: how many this week, and by how many teachers this month. */
export function monthStats(notes: readonly Pick<BoardNote, "createdAt" | "writtenBy">[], today: string): { thisWeek: number; teachers: number } {
  const month = today.slice(0, 7);
  const monday = weekStartOf(today);
  const mine = notes.filter((n) => noteSchoolDay(n.createdAt).slice(0, 7) === month);
  return {
    thisWeek: notes.filter((n) => {
      const d = noteSchoolDay(n.createdAt);
      return d >= monday && d <= today;
    }).length,
    teachers: new Set(mine.map((n) => n.writtenBy)).size,
  };
}

/**
 * The board's insight line: the tag most notes this month carry, and the
 * class with the most notes this month. Null when nothing was written.
 */
export function monthInsight(notes: readonly Pick<BoardNote, "createdAt" | "tags" | "classId" | "classLabel">[], today: string): { tag: NoteTag | null; classId: string | null; classLabel: string | null; classCount: number } | null {
  const month = today.slice(0, 7);
  const mine = notes.filter((n) => noteSchoolDay(n.createdAt).slice(0, 7) === month);
  if (mine.length === 0) return null;
  let tag: NoteTag | null = null;
  let tagCount = 0;
  for (const t of NOTE_TAGS) {
    const c = mine.filter((n) => n.tags.includes(t)).length;
    if (c > tagCount) {
      tag = t;
      tagCount = c;
    }
  }
  const byClass = new Map<string, { label: string; count: number }>();
  for (const n of mine) {
    if (!n.classId) continue;
    const cur = byClass.get(n.classId) ?? { label: n.classLabel, count: 0 };
    cur.count += 1;
    byClass.set(n.classId, cur);
  }
  let best: [string, { label: string; count: number }] | null = null;
  for (const entry of byClass) if (!best || entry[1].count > best[1].count) best = entry;
  return { tag, classId: best?.[0] ?? null, classLabel: best?.[1].label ?? null, classCount: best?.[1].count ?? 0 };
}

export function tagMix(notes: readonly BoardNote[]): { tag: NoteTag; count: number }[] {
  return NOTE_TAGS.map((tag) => ({ tag, count: notes.filter((n) => n.tags.includes(tag)).length })).filter((x) => x.count > 0);
}

/* ------------------------------------------------- one child, at a glance */

type GlanceNote = Pick<BoardNote, "tags" | "createdAt">;

/**
 * The child's latest strength (Student 360 overview): the newest note tagged
 * talent — an old "praise" note reads as talent through `tagsFromKind`. A note
 * that is also about health or family is never shown there: it is not a
 * strength to put on the first screen. Null means nobody has written one,
 * which says nothing about the child.
 */
export function latestStrength<N extends GlanceNote>(notes: readonly N[]): N | null {
  let best: N | null = null;
  for (const n of notes) {
    if (!n.tags.includes("talent")) continue;
    if (n.tags.includes("health") || n.tags.includes("family")) continue;
    if (!best || n.createdAt > best.createdAt) best = n;
  }
  return best;
}

/**
 * The child's next open action: a note still open or being worked on that
 * asks for a follow-up. The earliest review date comes first (the most
 * overdue), and among equals the newest note.
 */
export function nextOpenAction<N extends GlanceNote & Pick<BoardNote, "status" | "needsFollowUp" | "followUpOn">>(notes: readonly N[]): N | null {
  const open = notes.filter((n) => n.status !== "done" && n.needsFollowUp);
  open.sort((a, b) => (a.followUpOn ?? "9999").localeCompare(b.followUpOn ?? "9999") || b.createdAt.localeCompare(a.createdAt));
  return open[0] ?? null;
}

/**
 * Every open support action for one child, in the order `nextOpenAction`
 * picks from: soonest review first, undated last. Student 360 lists them all
 * so a second action for the same child is seen before anyone adds a third.
 */
export function openSupportActions<N extends GlanceNote & Pick<BoardNote, "status" | "needsFollowUp" | "followUpOn">>(notes: readonly N[]): N[] {
  const open = notes.filter((n) => n.status !== "done" && n.needsFollowUp);
  return open.sort((a, b) => (a.followUpOn ?? "9999").localeCompare(b.followUpOn ?? "9999") || b.createdAt.localeCompare(a.createdAt));
}

/** Who follows a note up, in words: the person named, else the role asked. */
export function followUpOwnerText(note: Pick<BoardNote, "followUpOwner" | "followUpName" | "writtenByName">): Pair | null {
  if (note.followUpName) return p(note.followUpName);
  if (note.followUpOwner === "me") return p(note.writtenByName);
  const owner = FOLLOW_OWNER.find((o) => o.key === note.followUpOwner);
  return owner ? owner.text : null;
}

/**
 * Who follows a note up, as this reader should read it: "You" only when it
 * is hers. A coordinator read "Me" on another teacher's follow-up as herself
 * (smoke 20 Oct); "me" was the writer's word, not the reader's.
 */
export function followUpWho(note: Pick<BoardNote, "followUpOwner" | "followUpName" | "followUpStaffId" | "writtenBy" | "writtenByName">, viewerId: string): Pair | null {
  if (note.followUpStaffId) {
    if (note.followUpStaffId === viewerId) return p("You", "आप");
  } else if (note.followUpOwner === "me" && note.writtenBy === viewerId) return p("You", "आप");
  return followUpOwnerText(note);
}

/**
 * Who a note is about. A class note has no child (the schema allows a note
 * about a whole class), and a child whose record is gone has no name: both
 * read "— —" on the board before (smoke 20 Oct).
 */
export function noteSubject(note: Pick<BoardNote, "studentId" | "studentName">): Pair {
  if (!note.studentId) return p("Whole class", "पूरी कक्षा");
  const name = note.studentName.trim();
  return name && name !== "—" ? p(name) : p("Child not found", "बच्चा नहीं मिला");
}

/** "1 note", "2 notes" / "2 नोट": a count with its noun, never "1 notes". */
export function countP(n: number, one: string, many: string, hi: string): Pair {
  return p(`${n} ${n === 1 ? one : many}`, `${n} ${hi}`);
}

/**
 * A follow-up that is this teacher's to do: given to her by name, or one she
 * kept for herself when no one was named.
 */
export function isMyFollowUp(note: Pick<BoardNote, "status" | "needsFollowUp" | "followUpStaffId" | "followUpOwner" | "writtenBy">, viewerId: string): boolean {
  if (note.status === "done" || !note.needsFollowUp) return false;
  return note.followUpStaffId === viewerId || (note.followUpStaffId === null && note.followUpOwner === "me" && note.writtenBy === viewerId);
}

/**
 * The teacher's notes page, counted once so its header, its tiles and its
 * sections agree (smoke 20 Oct: the header said "1 due soon" over a section
 * of 2). `followUp` is every open follow-up that is hers, whatever its date.
 */
export function teacherCounts(notes: readonly BoardNote[], viewerId: string): { total: number; followUp: number; open: number; done: number } {
  const followUp = notes.filter((n) => isMyFollowUp(n, viewerId)).length;
  return {
    total: notes.length,
    followUp,
    open: notes.filter((n) => n.status !== "done" && !isMyFollowUp(n, viewerId) && (noteStage(n) === "open" || noteStage(n) === "working")).length,
    done: notes.filter((n) => n.status === "done").length,
  };
}

/** How long after writing a note its author may still change the words. */
export const EDIT_DAYS = 14;

/**
 * Whether this reader may change a note's words: its author, while it is not
 * done, within EDIT_DAYS school days of writing it. Older notes are part of
 * the child's record; a correction is a reply.
 */
export function canEditNote(note: Pick<BoardNote, "writtenBy" | "status" | "createdAt">, viewerId: string, today: string): boolean {
  if (note.writtenBy !== viewerId || note.status === "done") return false;
  return noteSchoolDay(note.createdAt) >= addDays(today, -EDIT_DAYS);
}

/* --------------------------------------------------------- picking a child */

/**
 * The class the child picker opens on: the class it was opened from, else
 * the reader's own class (she is its class teacher), else the first class
 * she may write about. It opened on the first class in the school (smoke
 * 20 Oct: a Class 12 teacher scrolled from Class 3).
 */
export function pickerStartClass(classIds: readonly string[], prefer: { initial?: string | null; held: readonly string[] }): string {
  if (prefer.initial && classIds.includes(prefer.initial)) return prefer.initial;
  return classIds.find((id) => prefer.held.includes(id)) ?? classIds[0] ?? "";
}

/**
 * A search in the picker: the picked class first, then the same name in
 * the reader's other classes. It searched the whole school and hid the
 * picked class's child (smoke 20 Oct).
 */
export function findKids<K extends { classId: string; name: string; rollNo?: string | null }>(kids: readonly K[], classId: string, query: string): { here: K[]; elsewhere: K[] } {
  const q = query.trim().toLowerCase();
  const matches = (k: K) => {
    if (!q) return true;
    if ((k.rollNo ?? "").toLowerCase() === q) return true;
    const name = k.name.toLowerCase();
    return q.split(/\s+/).every((w) => name.includes(w));
  };
  return {
    here: kids.filter((k) => k.classId === classId && matches(k)),
    elsewhere: q ? kids.filter((k) => k.classId !== classId && matches(k)) : [],
  };
}

/** The teacher's header: due soon (within two days), open, done. */
export function myCounts(notes: readonly BoardNote[], today: string): { dueSoon: number; open: number; done: number } {
  const soon = addDays(today, 2);
  return {
    dueSoon: notes.filter((n) => n.status !== "done" && n.needsFollowUp && n.followUpOn !== null && n.followUpOn <= soon).length,
    open: notes.filter((n) => n.status !== "done").length,
    done: notes.filter((n) => n.status === "done").length,
  };
}

/** The one-line summary of a note, as on a card. */
export function excerpt(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/* ----------------------------------------------------------- support plans */

/**
 * Whether a plan goal carries a note's own words: the opening of the note,
 * spaces folded and case ignored. Short notes (under 12 letters) are too
 * common a phrase to call a copy.
 */
export function copiesNoteWords(goal: string, body: string): boolean {
  const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const words = fold(body);
  if (words.length < 12) return false;
  return fold(goal).includes(words.slice(0, Math.min(40, words.length)));
}

export type PlanSourceRefusal = "missing" | "other_child" | "not_yours" | "private_to_parents" | "private_words";

/**
 * Whether a support plan may be made from this note (R01). A plan is read by
 * the child's whole team, so an "Only me" note may start one only for its own
 * author, never goes to the parents, and lends the plan its words only when
 * the author chose to share them — the note itself stays private. `note` is
 * the note as this author may read it, or null when she cannot.
 */
export function planSourceRefusal(
  note: Pick<BoardNote, "studentId" | "visibility" | "writtenBy" | "body"> | null,
  input: { viewerId: string; studentId: string; goal: string; tellParents: boolean; shareExcerpt: boolean },
): PlanSourceRefusal | null {
  if (!note) return "missing";
  if (note.studentId !== input.studentId) return "other_child";
  if (note.visibility !== "private") return null;
  if (note.writtenBy !== input.viewerId) return "not_yours";
  if (input.tellParents) return "private_to_parents";
  if (!input.shareExcerpt && copiesNoteWords(input.goal, note.body)) return "private_words";
  return null;
}

/**
 * Who reads a plan made from this note, as the plan screens say it before it
 * starts. A support note's plan is read by every teacher of the class — its
 * subject teachers too — so the class teacher is named as one of them, not
 * as if she were all of them (smoke 20 Oct).
 */
export function planReaders(note: Pick<BoardNote, "tags"> & { visibility?: Visibility }, names: { classTeacher: string | null; admin: string | null }): Pair {
  // An Only me health or family note's plan is its author's alone (visiblePlans).
  if (note.visibility === "private" && isSensitiveNote(note)) return p("Only you", "सिर्फ़ आप");
  if (isSensitiveNote(note)) {
    const ct = names.classTeacher ? ` (${names.classTeacher})` : "";
    return p(`You, the class teacher${ct} and the admin`, `आप, कक्षा अध्यापक${ct} और प्रशासक`);
  }
  const en = names.classTeacher ? ` (class teacher ${names.classTeacher})` : "";
  const hi = names.classTeacher ? ` (कक्षा अध्यापक ${names.classTeacher})` : "";
  return p(`You, all the class's teachers${en}, the coordinators, the office and the admin`, `आप, कक्षा के सभी अध्यापक${hi}, समन्वयक, कार्यालय और प्रशासक`);
}

export type PlanStatus = "draft" | "active" | "done" | "closed";

export type PlanStep = {
  id: string;
  body: string;
  ownerRole: string | null;
  ownerName: string | null;
  /** Compared with the viewer's id to say "Me": two staff can share a name. */
  ownerStaffId?: string | null;
  whenLabel: string | null;
  done: boolean;
  sortOrder: number;
};

/**
 * The steps a tag suggests when the note's words say nothing more exact.
 * "Studies" used to offer reading practice, the homework diary and the front
 * bench to every child (smoke 20 Oct: a Class 12 Physics practicals note got
 * them); the words now come first, and studies depends on the class.
 */
export const SUGGESTED_STEPS: Record<NoteTag, Pair[]> = {
  studies: [p("Short extra practice on the topic the child finds hard", "कठिन लगने वाले विषय पर थोड़ा अतिरिक्त अभ्यास"), p("Check the child’s classwork this week", "इस हफ़्ते बच्चे का कक्षा-कार्य जाँचें"), p("Ask the child what feels hard", "बच्चे से पूछें कि क्या कठिन लगता है")],
  behaviour: [p("Talk with the child after class", "कक्षा के बाद बच्चे से बात करें"), p("Give a classroom job", "कक्षा में कोई ज़िम्मेदारी दें"), p("Call the parents this week", "इस हफ़्ते माता-पिता को फ़ोन करें")],
  health: [p("Tell the parents today", "आज माता-पिता को बताएँ"), p("Let the office know", "ऑफ़िस को बताएँ"), p("Check again tomorrow", "कल फिर देखें")],
  family: [p("Meet the parents", "माता-पिता से मिलें"), p("Keep a gentle eye this week", "इस हफ़्ते ध्यान रखें"), p("Tell the coordinator", "समन्वयक को बताएँ")],
  talent: [p("Praise in front of the class", "कक्षा में सराहना करें"), p("Put forward for the school event", "स्कूल कार्यक्रम के लिए नाम दें")],
  attendance: [p("Call home when absent", "अनुपस्थित होने पर घर फ़ोन करें"), p("Check attendance every Friday", "हर शुक्रवार उपस्थिति देखें")],
};

/** Studies steps for the youngest (Nursery to Class 3) and the oldest (Class 9 to 12). */
const YOUNG_STUDIES: Pair[] = [p("Extra reading practice 10 minutes a day", "रोज़ 10 मिनट पढ़ने का अभ्यास"), p("Check the homework diary every day", "रोज़ गृहकार्य डायरी जाँचें")];
const SENIOR_STUDIES: Pair[] = [p("A doubt-clearing session with the subject teacher", "विषय अध्यापक के साथ शंका दूर करने का समय"), p("Revise the chapter before the next test", "अगली परीक्षा से पहले अध्याय दोहराएँ")];

/** Steps the note's own words call for, Hindi or English. */
const WORD_STEPS: { when: RegExp; steps: Pair[] }[] = [
  { when: /practical|\blab\b|प्रायोगिक|प्रैक्टिकल/i, steps: [p("A catch-up practical session this week", "इस हफ़्ते छूटे प्रायोगिक कार्य का समय"), p("Check the practical record book is complete", "प्रायोगिक फ़ाइल पूरी है, जाँचें")] },
  { when: /absent|absence|\bmissed\b|अनुपस्थित|नहीं आ|छुट्टी/i, steps: [p("Call home to ask why the child was away", "घर फ़ोन करके न आने का कारण पूछें"), p("Give the classwork the child missed", "छूटा हुआ कक्षा-कार्य दें")] },
  { when: /\bmaths?\b|fraction|गणित|भिन्न|सवाल/i, steps: [p("A practice sheet on the weak topic", "कमज़ोर विषय पर अभ्यास पत्र दें")] },
  { when: /\bread(s|ing)?\b|पढ़ने|पढ़ना/i, steps: [p("Extra reading practice 10 minutes a day", "रोज़ 10 मिनट पढ़ने का अभ्यास")] },
  { when: /homework|गृहकार्य|होमवर्क/i, steps: [p("Check the homework diary every day", "रोज़ गृहकार्य डायरी जाँचें")] },
  { when: /\btests?\b|\bexams?\b|\bmarks\b|परीक्षा|अंक/i, steps: [p("Revise the chapter before the next test", "अगली परीक्षा से पहले अध्याय दोहराएँ")] },
  { when: /\beyes?\b|\bboard\b|आँख|बोर्ड/i, steps: [p("Sit near the front in class", "कक्षा में आगे बैठाएँ"), p("Ask the parents to have the eyes checked", "माता-पिता से आँखों की जाँच करवाने को कहें")] },
  { when: /attention|distract|ध्यान नहीं/i, steps: [p("Sit near the front in class", "कक्षा में आगे बैठाएँ")] },
  { when: /\bquiet\b|\balone\b|\bshy\b|चुप|अकेला/i, steps: [p("Talk with the child after class", "कक्षा के बाद बच्चे से बात करें"), p("Pair the child with a kind classmate", "बच्चे को किसी अच्छे सहपाठी के साथ बैठाएँ")] },
];

/** 0 for Nursery to UKG, the class number for "Class 7", null when unknown. */
export function classLevel(label: string | null | undefined): number | null {
  if (!label) return null;
  if (/nursery|\bnur\b|lkg|ukg|\bkg\b|prep/i.test(label)) return 0;
  const m = /(\d{1,2})/.exec(label);
  return m ? Number(m[1]) : null;
}

/**
 * Steps to suggest for a plan: what the note's words call for first, then
 * the tags' own, at most five and none twice. With no words and no tags it
 * suggests for studies.
 */
export function suggestedSteps(tags: readonly NoteTag[], context: { text?: string | null; classLabel?: string | null } = {}): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  const add = (s: Pair) => {
    if (!seen.has(s.en)) {
      seen.add(s.en);
      out.push(s);
    }
  };
  const text = context.text ?? "";
  for (const rule of WORD_STEPS) if (rule.when.test(text)) rule.steps.forEach(add);
  const level = classLevel(context.classLabel);
  for (const tag of tags.length ? tags : (["studies"] as NoteTag[])) {
    if (tag === "studies" && level !== null && level <= 3) YOUNG_STUDIES.forEach(add);
    if (tag === "studies" && level !== null && level >= 9) SENIOR_STUDIES.forEach(add);
    SUGGESTED_STEPS[tag].forEach(add);
  }
  return out.slice(0, 5);
}

/** Short goals to start from (smoke 20 Oct: the goal was the note's text cut mid-word). */
const TAG_GOALS: Record<NoteTag, Pair> = {
  studies: p("Catch up in studies", "पढ़ाई में बराबरी पर आए"),
  behaviour: p("Settle well in class", "कक्षा में अच्छे से घुल-मिल जाए"),
  health: p("Stay well and safe at school", "स्कूल में स्वस्थ और सुरक्षित रहे"),
  family: p("Feel supported at home and at school", "घर और स्कूल में सहारा महसूस करे"),
  talent: p("Grow the child’s talent", "बच्चे की प्रतिभा आगे बढ़े"),
  attendance: p("Come to school every day", "रोज़ स्कूल आए"),
};
const WORD_GOALS: { when: RegExp; goal: Pair }[] = [
  { when: /practical|\blab\b|प्रायोगिक|प्रैक्टिकल/i, goal: p("Finish the missed practicals", "छूटे प्रायोगिक कार्य पूरे करे") },
  { when: /absent|absence|अनुपस्थित|नहीं आ/i, goal: p("Come to school every day", "रोज़ स्कूल आए") },
  { when: /\bread(s|ing)?\b|पढ़ने|पढ़ना/i, goal: p("Read with confidence", "आत्मविश्वास से पढ़े") },
  { when: /homework|गृहकार्य|होमवर्क/i, goal: p("Do the homework every day", "रोज़ गृहकार्य करे") },
];

/** Up to three short goals the note suggests, its words first. */
export function suggestedGoals(tags: readonly NoteTag[], text: string | null | undefined): Pair[] {
  const out: Pair[] = [];
  const add = (g: Pair) => {
    if (!out.some((x) => x.en === g.en)) out.push(g);
  };
  for (const r of WORD_GOALS) if (r.when.test(text ?? "")) add(r.goal);
  for (const t of tags.length ? tags : (["studies"] as NoteTag[])) add(TAG_GOALS[t]);
  return out.slice(0, 3);
}

/** Every suggested step and goal, for finding a stored one's other language. */
const KNOWN: Pair[] = [
  ...Object.values(SUGGESTED_STEPS).flat(),
  ...YOUNG_STUDIES,
  ...SENIOR_STUDIES,
  ...WORD_STEPS.flatMap((r) => r.steps),
  ...Object.values(TAG_GOALS),
  ...WORD_GOALS.map((r) => r.goal),
  // Suggestions offered before 21 Oct, so plans made with them read in both languages.
  p("Extra reading practice 10 minutes a day", "रोज़ 10 मिनट पढ़ने का अभ्यास"),
  p("Check the homework diary every day", "रोज़ गृहकार्य डायरी जाँचें"),
  p("Sit near the front in class", "कक्षा में आगे बैठाएँ"),
];

/**
 * A stored step or goal as a pair. A suggestion is stored in the words of
 * whoever added it; read back, it is shown in the reader's language and goes
 * to the parents in both (smoke 20 Oct: Hindi steps inside the English
 * message). A step somebody wrote herself stays as she wrote it.
 */
export function knownPair(text: string): Pair {
  const t = text.trim();
  return KNOWN.find((k) => k.en === t || k.hi === t) ?? p(t);
}

const HI_DAY_WORDS: Record<string, string> = {
  Mon: "सोम", Tue: "मंगल", Wed: "बुध", Thu: "गुरु", Fri: "शुक्र", Sat: "शनि", Sun: "रवि",
  Jan: "जनवरी", Feb: "फ़रवरी", Mar: "मार्च", Apr: "अप्रैल", May: "मई", Jun: "जून", Jul: "जुलाई", Aug: "अगस्त", Sep: "सितंबर", Oct: "अक्टूबर", Nov: "नवंबर", Dec: "दिसंबर",
};
const HI_WHEN: Record<string, string> = { "Every Friday": "हर शुक्रवार", "Every day": "रोज़", "This week": "इस हफ़्ते", "Next week": "अगले हफ़्ते" };

/**
 * A plan step's "when", stored in English words ("From Wed 21 Oct", "Every
 * Friday"), as a pair the reader's language picks from. Anything else is
 * shown as written.
 */
export function whenPair(label: string): Pair {
  const t = label.trim();
  if (HI_WHEN[t]) return p(t, HI_WHEN[t]);
  const day = (s: string) => s.replace(/\b[A-Z][a-z]{2}\b/g, (w) => HI_DAY_WORDS[w] ?? w);
  const from = /^From (.+)$/.exec(t);
  if (from) return p(t, `${day(from[1]!)} से`);
  const by = /^By (.+)$/.exec(t);
  if (by) return p(t, `${day(by[1]!)} तक`);
  return /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(t) ? p(t, day(t)) : p(t);
}

export function planProgress(steps: readonly PlanStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/* --------------------------------------------------- telling the parents */

/** What the parents would read about a note (RULES H: Hindi first, then English). */
export function parentNoteMessage(input: { childName: string; teacher: string; body: string; school: string }): { hi: string; en: string } {
  return {
    hi: `नमस्ते, ${input.childName} के बारे में ${input.teacher} जी का संदेश: "${excerpt(input.body, 300)}" — ${input.school}`,
    en: `Hello, a message from ${input.teacher} about ${input.childName}: "${excerpt(input.body, 300)}" — ${input.school}`,
  };
}

/**
 * The plan goal as the parents may read it, or null. A goal that repeats the
 * note's words, or is a cut-off excerpt ("…"), is staff wording: it is left
 * out of the parents' message (smoke 20 Oct) and the steps speak for the plan.
 */
export function goalForParents(goal: string, noteBody?: string | null): string | null {
  const g = goal.trim();
  if (!g || g.endsWith("…")) return null;
  if (noteBody && copiesNoteWords(g, noteBody)) return null;
  return g;
}

export function parentPlanMessage(input: { childName: string; goal: string; steps: readonly (string | Pair)[]; school: string; noteBody?: string | null }): { hi: string; en: string } {
  const steps = input.steps.slice(0, 4).map((s) => (typeof s === "string" ? knownPair(s) : s));
  const goal = goalForParents(input.goal, input.noteBody);
  const goalPair = goal ? knownPair(goal) : null;
  const list = (lang: "en" | "hi") => steps.map((s, i) => `${i + 1}. ${lang === "hi" ? (s.hi ?? s.en) : s.en}`).join("\n");
  return {
    hi: `नमस्ते, ${input.childName} की मदद के लिए हमारी योजना${goalPair ? `: ${goalPair.hi ?? goalPair.en}` : ":"}\n${list("hi")}\nआपका साथ ज़रूरी है। — ${input.school}`,
    en: `Hello, our plan to help ${input.childName}${goalPair ? `: ${goalPair.en}` : ":"}\n${list("en")}\nYour support matters. — ${input.school}`,
  };
}
