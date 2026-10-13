/**
 * Notes on children (design TchNotes, Notes board): tags, follow-ups, who
 * may see a note, the board's tabs and counts. Pure; unit-tested in
 * `tests/vx-notes.test.ts`.
 */

import { p, type Pair } from "@/vx/text";

export const NOTE_TAGS = ["studies", "behaviour", "health", "family", "talent", "attendance"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

export const TAG_TEXT: Record<NoteTag, Pair> = {
  studies: p("Studies", "पढ़ाई"),
  behaviour: p("Behaviour", "व्यवहार"),
  health: p("Health", "स्वास्थ्य"),
  family: p("Family", "परिवार"),
  talent: p("Talent", "प्रतिभा"),
  attendance: p("Attendance", "उपस्थिति"),
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
  studentName: string;
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
    thisMonth: notes.filter((n) => n.createdAt.slice(0, 7) === month).length,
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
  const mine = notes.filter((n) => n.createdAt.slice(0, 7) === month);
  return {
    thisWeek: notes.filter((n) => n.createdAt.slice(0, 10) >= monday && n.createdAt.slice(0, 10) <= today).length,
    teachers: new Set(mine.map((n) => n.writtenBy)).size,
  };
}

/**
 * The board's insight line: the tag most notes this month carry, and the
 * class with the most notes this month. Null when nothing was written.
 */
export function monthInsight(notes: readonly Pick<BoardNote, "createdAt" | "tags" | "classId" | "classLabel">[], today: string): { tag: NoteTag | null; classId: string | null; classLabel: string | null; classCount: number } | null {
  const month = today.slice(0, 7);
  const mine = notes.filter((n) => n.createdAt.slice(0, 7) === month);
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

export type PlanStatus = "draft" | "active" | "done" | "closed";

export type PlanStep = {
  id: string;
  body: string;
  ownerRole: string | null;
  ownerName: string | null;
  whenLabel: string | null;
  done: boolean;
  sortOrder: number;
};

export const SUGGESTED_STEPS: Record<NoteTag, Pair[]> = {
  studies: [p("Extra reading practice 10 minutes a day", "रोज़ 10 मिनट पढ़ने का अभ्यास"), p("Check the homework diary every day", "रोज़ गृहकार्य डायरी जाँचें"), p("Sit near the front in class", "कक्षा में आगे बैठाएँ")],
  behaviour: [p("Talk with the child after class", "कक्षा के बाद बच्चे से बात करें"), p("Give a classroom job", "कक्षा में कोई ज़िम्मेदारी दें"), p("Call the parents this week", "इस हफ़्ते माता-पिता को फ़ोन करें")],
  health: [p("Tell the parents today", "आज माता-पिता को बताएँ"), p("Let the office know", "ऑफ़िस को बताएँ"), p("Check again tomorrow", "कल फिर देखें")],
  family: [p("Meet the parents", "माता-पिता से मिलें"), p("Keep a gentle eye this week", "इस हफ़्ते ध्यान रखें"), p("Tell the coordinator", "समन्वयक को बताएँ")],
  talent: [p("Praise in front of the class", "कक्षा में सराहना करें"), p("Put forward for the school event", "स्कूल कार्यक्रम के लिए नाम दें")],
  attendance: [p("Call home when absent", "अनुपस्थित होने पर घर फ़ोन करें"), p("Check attendance every Friday", "हर शुक्रवार उपस्थिति देखें")],
};

export function suggestedSteps(tags: readonly NoteTag[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const tag of tags.length ? tags : (["studies"] as NoteTag[])) {
    for (const s of SUGGESTED_STEPS[tag]) {
      if (!seen.has(s.en)) {
        seen.add(s.en);
        out.push(s);
      }
    }
  }
  return out.slice(0, 5);
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

export function parentPlanMessage(input: { childName: string; goal: string; steps: readonly string[]; school: string }): { hi: string; en: string } {
  const list = input.steps.slice(0, 4).map((s, i) => `${i + 1}. ${s}`).join("\n");
  return {
    hi: `नमस्ते, ${input.childName} की मदद के लिए हमारी योजना: ${input.goal}\n${list}\nआपका साथ ज़रूरी है। — ${input.school}`,
    en: `Hello, our plan to help ${input.childName}: ${input.goal}\n${list}\nYour support matters. — ${input.school}`,
  };
}
