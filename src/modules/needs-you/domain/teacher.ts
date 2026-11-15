import { addDays } from "@/platform/dates";
import { classWord } from "@/vx/screens/teach/domain/today";
import { p, type Pair } from "@/vx/text";

import { clockP, dayP, istIso, minutesOf } from "./format";
import type { DoneItem, NeedItem, NeedLane } from "./types";
import { NW } from "./words";

/**
 * A teacher's jobs (D-630), read from what her Today already loads: the
 * register, covers, marks papers, the office's tasks, notes to follow up,
 * notices, birthdays and her leave. Every button opens the screen that owns
 * the job; nothing here marks anything done.
 */

export type TeacherCover = {
  id: string;
  day: string;
  number: number;
  starts: string;
  ends: string;
  classLabels: string;
  subjectName: string;
  subjectHi?: string;
  forName: string;
  acknowledged: boolean;
};

export type TeacherFacts = {
  today: string;
  nowMinutes: number;
  schoolOpen: boolean;
  canMark: boolean;
  myClasses: readonly { classId: string; classLabel: string; total: number; saved: boolean; savedAt: string | null }[];
  lastOpen: { day: string; unmarked: readonly { classId: string; classLabel: string }[] } | null;
  bells: readonly { starts: string; ends: string }[];
  covers: readonly TeacherCover[];
  upcomingCovers: readonly TeacherCover[];
  notices: readonly { id: string; title: string; seen: boolean }[];
  links: readonly { paperId: string; classLabel: string; subjectCode: string; exam: string; examHi?: string; entered: number; total: number; submitted: boolean; examId: string }[];
  subjects: readonly { code: string | null; name: string; nameHi: string }[];
  tasks: readonly { id: string; title: string; href: string; dueDate: string | null }[];
  reviews: readonly { id: string; subject: Pair; followUpOn: string }[];
  birthdays: readonly { id: string; name: string; inDays: number; wished: boolean }[];
  birthdayWishes: boolean;
  leave: readonly { id: string; from_day: string; to_day: string; status: string }[];
};

export type TeacherExtras = {
  /** The exam office's "marks due" day per exam, when one is set. */
  marksDue?: Readonly<Record<string, string | null>>;
  /** Report-card remarks still to write; null when it could not be read. */
  remarksLeft?: number | null;
};

/** No bells set: a register is counted late from 10 in the morning. */
const REGISTER_FALLBACK = 10 * 60;
/** A day's work is due by the end of the school office's day. */
const DAY_ENDS = 17 * 60;

function dayLane(due: string | null, today: string, fallback: NeedLane): NeedLane {
  if (!due) return fallback;
  if (due < today) return "now";
  if (due <= addDays(today, 1)) return "today";
  return "later";
}

/** Minutes since a day's end, for work that was due on it. */
function lateSince(due: string | null, today: string, nowMinutes: number): number {
  if (!due || due > today) return 0;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, days * 24 * 60 + nowMinutes - DAY_ENDS);
}

const base = (item: Omit<NeedItem, "lateMinutes" | "startsInMinutes" | "peopleWaiting" | "count" | "canSnooze"> & Partial<NeedItem>): NeedItem => ({
  lateMinutes: 0,
  startsInMinutes: null,
  peopleWaiting: 0,
  count: 1,
  canSnooze: item.lane !== "waiting",
  ...item,
});

export function teacherNeeds(f: TeacherFacts, extras: TeacherExtras = {}): { items: NeedItem[]; done: DoneItem[] } {
  const items: NeedItem[] = [];
  const done: DoneItem[] = [];
  const { today, nowMinutes } = f;

  /* ----------------------------------------------------- the register */
  if (f.canMark && f.schoolOpen) {
    const firstEnds = f.bells.map((b) => minutesOf(b.ends)).filter((m): m is number => m !== null).sort((a, b) => a - b)[0];
    const deadline = firstEnds ?? REGISTER_FALLBACK;
    for (const c of f.myClasses) {
      const cls = classWord(c.classLabel);
      if (c.saved) {
        done.push({ key: `att:${c.classId}:${today}`, kind: "attendance", title: p(`Attendance · ${cls.en}`, `हाज़िरी · ${cls.hi ?? cls.en}`), at: c.savedAt });
        continue;
      }
      const late = Math.max(0, nowMinutes - deadline);
      items.push(
        base({
          key: `att:${c.classId}:${today}`,
          kind: "attendance",
          title: p(`Mark attendance · ${cls.en}`, `हाज़िरी लगाएँ · ${cls.hi ?? cls.en}`),
          why: c.total ? p(`${c.total} children`, `${c.total} बच्चे`) : null,
          lane: late > 0 ? "now" : "today",
          dueAt: istIso(today, deadline),
          lateMinutes: late,
          count: Math.max(1, c.total),
          effort: "medium",
          href: `/teach/attendance?class=${c.classId}&day=${today}`,
          act: p("Mark attendance", "हाज़िरी लगाएँ"),
        }),
      );
    }
  }
  // School is shut today and the last open day's register was never saved.
  if (f.canMark && !f.schoolOpen && f.lastOpen) {
    for (const c of f.lastOpen.unmarked) {
      const cls = classWord(c.classLabel);
      const day = dayP(f.lastOpen.day);
      items.push(
        base({
          key: `att:${c.classId}:${f.lastOpen.day}`,
          kind: "attendance",
          title: p(`Finish attendance · ${cls.en}`, `हाज़िरी पूरी करें · ${cls.hi ?? cls.en}`),
          why: p(`Not saved for ${day.en}`, `${day.hi ?? day.en} की हाज़िरी नहीं सहेजी`),
          lane: "now",
          dueAt: istIso(f.lastOpen.day, REGISTER_FALLBACK),
          lateMinutes: lateSince(f.lastOpen.day, today, nowMinutes) || 1,
          effort: "medium",
          href: `/teach/attendance?class=${c.classId}&day=${f.lastOpen.day}`,
          act: p("Finish attendance", "हाज़िरी पूरी करें"),
        }),
      );
    }
  }

  /* ----------------------------------------------------------- covers */
  const coverTitle = (c: TeacherCover) => {
    const cls = c.classLabels.split(",").map((x) => classWord(x.trim()));
    return p(`Cover period ${c.number} · ${cls.map((x) => x.en).join(", ")}`, `पीरियड ${c.number} लेना है · ${cls.map((x) => x.hi ?? x.en).join(", ")}`);
  };
  for (const c of f.covers) {
    const starts = minutesOf(c.starts);
    const ends = minutesOf(c.ends);
    if (c.day === today && ends !== null && nowMinutes >= ends) continue;
    if (c.acknowledged) {
      done.push({ key: `cover:${c.id}`, kind: "cover", title: p(`${coverTitle(c).en} · you said yes`, `${coverTitle(c).hi} · आपने हाँ कहा`), at: null });
      continue;
    }
    const startsIn = starts === null ? null : Math.max(0, starts - nowMinutes);
    const clock = starts === null ? null : clockP(istIso(c.day, starts));
    items.push(
      base({
        key: `cover:${c.id}`,
        kind: "cover",
        title: coverTitle(c),
        why: p(
          `For ${c.forName}${c.subjectName ? ` · ${c.subjectName}` : ""}${clock ? ` · ${clock.en}` : ""}`,
          `${c.forName} की जगह${c.subjectHi || c.subjectName ? ` · ${c.subjectHi || c.subjectName}` : ""}${clock ? ` · ${clock.hi}` : ""}`,
        ),
        lane: startsIn !== null && startsIn <= 60 ? "now" : "today",
        dueAt: starts === null ? null : istIso(c.day, starts),
        startsInMinutes: startsIn,
        effort: "quick",
        href: "/teach?sheet=subs",
        act: p("I'll take it", "ठीक है, ले लेंगे"),
        quick: "cover-yes",
      }),
    );
  }
  for (const c of f.upcomingCovers) {
    if (c.acknowledged || c.day <= today) continue;
    const starts = minutesOf(c.starts);
    const day = dayP(c.day);
    items.push(
      base({
        key: `cover:${c.id}`,
        kind: "cover",
        title: coverTitle(c),
        why: p(`${day.en} · for ${c.forName}`, `${day.hi ?? day.en} · ${c.forName} की जगह`),
        lane: "later",
        dueAt: istIso(c.day, starts ?? REGISTER_FALLBACK),
        effort: "quick",
        href: "/teach?sheet=subs",
        act: p("I'll take it", "ठीक है, ले लेंगे"),
        quick: "cover-yes",
      }),
    );
  }

  /* ------------------------------------------------------------ marks */
  const subjectOf = (code: string) => {
    const s = f.subjects.find((x) => x.code === code);
    return s ? p(s.name, s.nameHi) : p(code);
  };
  for (const l of f.links) {
    if (l.submitted) continue;
    const left = Math.max(0, l.total - l.entered);
    const due = extras.marksDue?.[l.examId] ?? null;
    const subj = subjectOf(l.subjectCode);
    const cls = classWord(l.classLabel);
    const late = lateSince(due, today, nowMinutes);
    const lane: NeedLane = late > 0 ? "now" : left === 0 ? "today" : dayLane(due, today, "later");
    items.push(
      base({
        key: `marks:${l.paperId}`,
        kind: "marks",
        title:
          left === 0
            ? p(`Send ${subj.en} marks · ${cls.en}`, `${subj.hi ?? subj.en} के अंक भेजें · ${cls.hi ?? cls.en}`)
            : p(`${subj.en} marks · ${cls.en}`, `${subj.hi ?? subj.en} के अंक · ${cls.hi ?? cls.en}`),
        why: p(
          `${l.entered} of ${l.total} entered · ${l.exam}${due ? ` · due ${dayP(due).en}` : ""}`,
          `${l.total} में से ${l.entered} भरे · ${l.examHi || l.exam}${due ? ` · ${dayP(due).hi} तक` : ""}`,
        ),
        lane,
        dueAt: due ? istIso(due, DAY_ENDS) : null,
        lateMinutes: late,
        count: Math.max(1, left),
        effort: left === 0 ? "quick" : left > 20 ? "long" : "medium",
        href: `/teach/marks?paper=${l.paperId}`,
        act: left === 0 ? p("Send marks", "अंक भेजें") : p("Enter marks", "अंक भरें"),
      }),
    );
  }
  if (extras.remarksLeft && extras.remarksLeft > 0) {
    const n = extras.remarksLeft;
    items.push(
      base({
        key: "remarks",
        kind: "remarks",
        title: p(n === 1 ? "Write 1 report-card remark" : `Write ${n} report-card remarks`, `${n} रिपोर्ट कार्ड टिप्पणी लिखें`),
        why: p("For your class's report cards", "आपकी कक्षा के रिपोर्ट कार्ड के लिए"),
        lane: "later",
        dueAt: null,
        count: n,
        effort: n > 10 ? "long" : "medium",
        href: "/teach/marks",
        act: p("Write remarks", "टिप्पणी लिखें"),
      }),
    );
  }

  /* --------------------------------------------- the office's tasks */
  for (const t of f.tasks) {
    const late = lateSince(t.dueDate, today, nowMinutes);
    items.push(
      base({
        key: `task:${t.id}`,
        kind: "task",
        title: p(t.title),
        why: t.dueDate ? p(`The office asked · by ${dayP(t.dueDate).en}`, `कार्यालय ने माँगा · ${dayP(t.dueDate).hi} तक`) : p("The office asked for this", "कार्यालय ने माँगा है"),
        lane: late > 0 ? "now" : dayLane(t.dueDate, today, "today"),
        dueAt: t.dueDate ? istIso(t.dueDate, DAY_ENDS) : null,
        lateMinutes: late,
        effort: "medium",
        href: t.href,
        act: p("Open", "खोलें"),
      }),
    );
  }

  /* ---------------------------------------------- notes to follow up */
  for (const r of f.reviews) {
    const late = r.followUpOn < today ? lateSince(r.followUpOn, today, nowMinutes) || 1 : 0;
    items.push(
      base({
        key: `review:${r.id}`,
        kind: "followup",
        title: p(`Follow up: ${r.subject.en}`, `फ़ॉलो-अप: ${r.subject.hi ?? r.subject.en}`),
        why: p(`Your note · ${dayP(r.followUpOn).en}`, `आपका नोट · ${dayP(r.followUpOn).hi}`),
        lane: late > 0 ? "now" : dayLane(r.followUpOn, today, "today") === "later" ? "later" : "today",
        dueAt: istIso(r.followUpOn, DAY_ENDS),
        lateMinutes: late,
        effort: "medium",
        href: `/teach/notes?note=${r.id}`,
        act: p("Open note", "नोट खोलें"),
      }),
    );
  }

  /* ---------------------------------------------------------- notices */
  const unread = f.notices.filter((n) => !n.seen);
  if (unread.length) {
    const n = unread.length;
    items.push(
      base({
        key: "notices",
        kind: "notice",
        title: p(n === 1 ? "Read 1 new notice" : `Read ${n} new notices`, `${n} नई सूचना पढ़ें`),
        why: p(`“${unread[0].title}”`),
        lane: "today",
        dueAt: null,
        count: n,
        effort: "quick",
        href: "/teach/more?view=news",
        act: p("Read", "पढ़ें"),
      }),
    );
  }

  /* -------------------------------------------------------- birthdays */
  for (const b of f.birthdays) {
    if (b.inDays !== 0) continue;
    if (b.wished) {
      done.push({ key: `wish:${b.id}:${today}`, kind: "wish", title: p(`Birthday wishes · ${b.name}`, `जन्मदिन की शुभकामना · ${b.name}`), at: null });
      continue;
    }
    if (!f.birthdayWishes) continue;
    items.push(
      base({
        key: `wish:${b.id}:${today}`,
        kind: "wish",
        title: p(`Birthday wishes · ${b.name}`, `जन्मदिन की शुभकामना · ${b.name}`),
        why: p("Their birthday is today", "आज जन्मदिन है"),
        lane: "today",
        dueAt: null,
        effort: "quick",
        href: "/teach?sheet=wish",
        act: p("Send wishes", "शुभकामना भेजें"),
      }),
    );
  }

  /* ------------------------------------------------------------ leave */
  for (const l of f.leave) {
    if (l.status !== "asked") continue;
    const from = dayP(l.from_day);
    const to = dayP(l.to_day);
    const span = l.from_day === l.to_day ? from : p(`${from.en} – ${to.en}`, `${from.hi} – ${to.hi}`);
    items.push(
      base({
        key: `leave:${l.id}`,
        kind: "leave",
        title: p(`Your leave · ${span.en}`, `आपकी छुट्टी · ${span.hi ?? span.en}`),
        why: p("Waiting for the office to answer", "कार्यालय के जवाब का इंतज़ार"),
        lane: "waiting",
        dueAt: istIso(l.from_day, 8 * 60),
        effort: "quick",
        href: "/teach/more?view=leave",
        act: p("See", "देखें"),
        waitingOn: NW.office,
      }),
    );
  }

  return { items, done };
}
