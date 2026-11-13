import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import { dayLabel, weekdayLabel } from "@/platform/dates";

import { oneLine, type StaffLanguage } from "./helper-handoff";
import type { HelperButton, HelperMessage } from "./helper-messages";
import { staffButtonId } from "./staff-words";

/**
 * The teachers' own Veer Patta AI on WhatsApp (D-591). A member of staff who
 * linked their WhatsApp from VPPS One (D-582) writes one word to the school's
 * number, or taps one of its buttons, and gets their own school day back:
 *
 *  - *today*: their periods from the published timetable and the bells, the
 *    cover they are down for, their free periods, and their leave.
 *  - *questions*: the parents waiting for their answer. Each one comes again
 *    as its own message, which a swipe answers exactly as the first alert did.
 *  - *absent*: who is absent in the class they hold today, and which parents
 *    told the school on WhatsApp that their child would be away (D-588).
 *  - *staff*: the three, as buttons.
 *
 * Since D-607 these are three of a desk's asks: a linked number gets the
 * menu of its own role (`staff-desk.ts`), and anything typed is understood
 * against it. A member of staff who is also a parent writes to the school as
 * one after *as parent*, and comes back with *staff*.
 *
 * Pure: the words and the rules, no database and no clock of its own. The
 * reads, the checks and the sending are in `data/staff-helper.ts`, and the
 * helper's turn (`data/helper-turn.ts`) hands it every message first.
 */

// The words and taps that ask (D-591, widened by D-607) are read in
// `staff-words.ts`; these names are kept here for the code that knew them.
export { STAFF_COMMANDS, STAFF_TAP_PREFIX, commandText, staffButtonId, staffCommandIn, type StaffCommand } from "./staff-words";

/** At most this many waiting questions come again in one go, oldest first. */
export const QUESTIONS_AT_ONCE = 3;

/* ------------------------------------------------------------- the replies */

type Pair = { hi: string; en: string };

const say = (language: StaffLanguage, words: Pair): string => words[language];

/** Who the reply is for, and the words around every answer. */
export type StaffContext = {
  language: StaffLanguage;
  /** Their name as One shows it. */
  name: string;
  helperName: string;
  /** A test account: the replies are TEST-2026-27's practice records. */
  practice: boolean;
  sessionLabel: string;
  /** Where VPPS One lives, for the links: `https://one.vpps.co.in`. */
  origin: string;
};

/** The three asks of D-591, which every answer here offered; a desk's own buttons replace them (D-607). */
type FirstAsk = "today" | "questions" | "absent";

const BUTTON_WORDS: Record<FirstAsk, Pair> = {
  today: { hi: "📅 आज", en: "📅 Today" },
  questions: { hi: "📝 सवाल", en: "📝 Questions" },
  absent: { hi: "📋 अनुपस्थित", en: "📋 Absent" },
};

function staffButtons(commands: readonly FirstAsk[], language: StaffLanguage): HelperButton[] {
  return commands.map((command) => ({ id: staffButtonId(command), title: say(language, BUTTON_WORDS[command]) }));
}

function practiceLine(ctx: StaffContext): string | null {
  if (!ctx.practice) return null;
  return say(ctx.language, {
    hi: `🧪 अभ्यास: ${ctx.sessionLabel} के परीक्षण रिकॉर्ड`,
    en: `🧪 Practice: ${ctx.sessionLabel} test records`,
  });
}

function reply(lines: readonly (string | null)[], buttons: HelperButton[]): HelperMessage {
  const body = lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return buttons.length > 0 ? { kind: "buttons", body, buttons } : { kind: "text", text: body };
}

/** `Thursday, 12 November` / `गुरुवार, 12 नवंबर`. */
function dayWords(day: string, language: StaffLanguage): string {
  return `${weekdayLabel(day)[language]}, ${dayLabel(day)[language]}`;
}

/** `08:00` → `8:00`; anything else as it is. */
function clock(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  return match ? `${Number(match[1])}:${match[2]}` : hhmm.trim();
}

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** `8:00–8:40`, or nothing when the bells do not say. */
function span(starts: string, ends: string): string {
  if (!starts) return "";
  return ends ? `${clock(starts)}–${clock(ends)}` : clock(starts);
}

/** 1, 2, 3, 5 → `1–3, 5`. */
function periodList(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${sorted[i]}–${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j;
  }
  return parts.join(", ");
}

/** `period 6` / `periods 1–3, 5` in English; Hindi says पीरियड either way. */
function periodsWords(numbers: readonly number[]): Pair {
  const list = periodList(numbers);
  return { hi: `पीरियड ${list}`, en: `${new Set(numbers).size === 1 ? "period" : "periods"} ${list}` };
}

/* ------------------------------------------------------------------ today */

/** A subject's name in both languages, as One shows it. */
export type SubjectName = { en: string; hi: string };
export type CalendarName = { en: string | null; hi: string | null };

export type DayLesson = { number: number; starts: string; ends: string; subject: SubjectName; classes: string[] };
export type DayCover = DayLesson & { forNames: string[]; seen: boolean };

export type DayFacts = {
  day: string;
  /** The school calendar's own entry for the day, when it has one. */
  calendar: { kind: CalendarDayKind; name: CalendarName | null } | null;
  open: boolean;
  /** The timetable's periods run (a teaching day, not an exam or event day). */
  runs: boolean;
  /** A timetable is published for the year. */
  published: boolean;
  lessons: DayLesson[];
  /** Null when the cover duties could not be read. */
  covers: DayCover[] | null;
  /** Bell periods with no lesson and no cover, once there is any lesson. */
  freePeriods: number[];
  leave: { state: "approved" | "waiting"; periods: number[]; fullDay: boolean } | null;
  /** Minutes since midnight on the school's clock, to point at the period on now. */
  nowMinutes: number;
};

function calendarName(name: CalendarName | null | undefined, language: StaffLanguage): string {
  const words = (language === "hi" ? (name?.hi ?? name?.en) : (name?.en ?? name?.hi))?.trim();
  return words ? ` (${oneLine(words, 60)})` : "";
}

function lessonLine(lesson: DayLesson, language: StaffLanguage, nowMinutes: number): string {
  const from = minutesOf(lesson.starts);
  const to = minutesOf(lesson.ends);
  const now = from !== null && to !== null && nowMinutes >= from && nowMinutes < to;
  const subject = language === "hi" ? lesson.subject.hi || lesson.subject.en : lesson.subject.en || lesson.subject.hi;
  const parts = [`P${lesson.number}`, span(lesson.starts, lesson.ends), subject, lesson.classes.join(", ")].filter(Boolean);
  const line = parts.join(" · ");
  return now ? `👉 ${line} ${say(language, { hi: "(अभी)", en: "(now)" })}` : `• ${line}`;
}

function leaveLine(leave: NonNullable<DayFacts["leave"]>, language: StaffLanguage): string {
  const some = leave.periods.length > 0 ? periodsWords(leave.periods) : null;
  if (leave.state === "approved") {
    return leave.fullDay || !some
      ? say(language, { hi: "🌴 आज आपकी छुट्टी मंज़ूर है।", en: "🌴 You are on leave today (approved)." })
      : say(language, { hi: `🌴 आज ${some.hi} की आपकी छुट्टी मंज़ूर है।`, en: `🌴 Your leave for ${some.en} today is approved.` });
  }
  return leave.fullDay || !some
    ? say(language, { hi: "⏳ आज की आपकी छुट्टी ऑफ़िस के जवाब का इंतज़ार कर रही है।", en: "⏳ Your leave for today is waiting for the office." })
    : say(language, {
        hi: `⏳ आज ${some.hi} की आपकी छुट्टी ऑफ़िस के जवाब का इंतज़ार कर रही है।`,
        en: `⏳ Your leave for ${some.en} today is waiting for the office.`,
      });
}

/** The reply to *today*. */
export function todayReply(facts: DayFacts, ctx: StaffContext): HelperMessage {
  const { language } = ctx;
  const lines: (string | null)[] = [
    say(language, { hi: `📅 *आपका दिन · ${dayWords(facts.day, language)}*`, en: `📅 *Your day · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
    "",
  ];
  const buttons = staffButtons(["questions", "absent"], language);

  if (!facts.open) {
    const name = calendarName(facts.calendar?.name, language);
    lines.push(say(language, { hi: `🏠 आज स्कूल बंद है${name}। आज कोई पीरियड नहीं है।`, en: `🏠 School is closed today${name}. There are no periods today.` }));
    return reply(lines, staffButtons(["questions"], language));
  }

  if (facts.leave) lines.push(leaveLine(facts.leave, language), "");

  if (!facts.runs) {
    const name = calendarName(facts.calendar?.name, language);
    lines.push(
      facts.calendar?.kind === "exam"
        ? say(language, { hi: `📝 आज परीक्षा का दिन है${name}, इसलिए रोज़ के पीरियड नहीं हैं।`, en: `📝 Today is an exam day${name}, so the usual periods do not run.` })
        : say(language, { hi: `🎉 आज कार्यक्रम का दिन है${name}, इसलिए रोज़ के पीरियड नहीं हैं।`, en: `🎉 Today is an event day${name}, so the usual periods do not run.` }),
    );
  } else if (!facts.published) {
    lines.push(say(language, { hi: "🗓️ इस साल की समय सारणी अभी One में नहीं छपी है, इसलिए पीरियड नहीं दिखा सकते।", en: "🗓️ This year's timetable is not published in One yet, so there are no periods to show." }));
  } else if (facts.lessons.length === 0) {
    lines.push(say(language, { hi: "☕ आज समय सारणी में आपका कोई पीरियड नहीं है।", en: "☕ You have no periods in the timetable today." }));
  } else {
    lines.push(say(language, { hi: `*आपके पीरियड (${facts.lessons.length})*`, en: `*Your periods (${facts.lessons.length})*` }));
    for (const lesson of facts.lessons) lines.push(lessonLine(lesson, language, facts.nowMinutes));
    if (facts.freePeriods.length > 0) {
      const free = periodsWords(facts.freePeriods);
      lines.push(say(language, { hi: `खाली: ${free.hi}`, en: `Free: ${free.en}` }));
    }
  }

  if (facts.covers === null) {
    lines.push("", say(language, { hi: "⚠️ आज की सबस्टिट्यूशन अभी पढ़ी नहीं जा सकी। One में Today देखें।", en: "⚠️ Today's cover could not be read just now. Please check Today in One." }));
  } else if (facts.covers.length > 0) {
    lines.push("", say(language, { hi: `*आपकी सबस्टिट्यूशन (${facts.covers.length})*`, en: `*Cover you are taking (${facts.covers.length})*` }));
    for (const cover of facts.covers) {
      const forWhom = cover.forNames.length > 0 ? say(language, { hi: ` (${cover.forNames.join(", ")} की जगह)`, en: ` (for ${cover.forNames.join(", ")})` }) : "";
      lines.push(`${lessonLine(cover, language, facts.nowMinutes).replace(/^• /, "🔁 ")}${forWhom}`);
    }
    if (facts.covers.some((cover) => !cover.seen)) {
      lines.push(say(language, { hi: "One में Today खोलकर 'देख लिया' दबाएँ, ताकि ऑफ़िस को पता चले।", en: "Open Today in One and tap Seen, so the office knows." }));
    }
  }

  lines.push("", `${say(language, { hi: "पूरा दिन One में:", en: "Your whole day in One:" })} ${ctx.origin}/teach`);
  return reply(lines, buttons);
}

/* -------------------------------------------------------------- questions */

export type QuestionsFacts = {
  /** Open hand-offs that are theirs to answer. */
  count: number;
  /** How many come again now, as their own messages (at most QUESTIONS_AT_ONCE). */
  shown: number;
  /** When the oldest of them came in. */
  oldestAt: string | null;
  now: Date;
  /** They may open Messages in One (`messages:send`); a teacher answers on WhatsApp only. */
  canOpenMessages: boolean;
};

/** `2 hours`, `1 day`, `25 minutes`. */
export function waitedWords(fromIso: string | null, now: Date, language: StaffLanguage): string | null {
  const from = fromIso ? Date.parse(fromIso) : Number.NaN;
  if (!Number.isFinite(from)) return null;
  const minutes = Math.max(1, Math.floor((now.getTime() - from) / 60_000));
  if (minutes < 60) return say(language, { hi: `${minutes} मिनट`, en: `${minutes} minute${minutes === 1 ? "" : "s"}` });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return say(language, { hi: `${hours} घंटे`, en: `${hours} hour${hours === 1 ? "" : "s"}` });
  const days = Math.floor(hours / 24);
  return say(language, { hi: `${days} दिन`, en: `${days} day${days === 1 ? "" : "s"}` });
}

/** The reply to *questions*: how many wait, before each comes again as its own message. */
export function questionsReply(facts: QuestionsFacts, ctx: StaffContext): HelperMessage {
  const { language } = ctx;
  const buttons = staffButtons(["today", "absent"], language);
  if (facts.count === 0) {
    return reply(
      [
        say(language, { hi: "✅ *कोई अभिभावक आपके जवाब की राह नहीं देख रहे।*", en: "✅ *No parent is waiting for your answer.*" }),
        practiceLine(ctx),
        "",
        say(language, {
          hi: `जब किसी अभिभावक का संदेश आपके लिए होगा, ${ctx.helperName} उसे यहीं भेजेगा, सुबह 6 से रात 9 बजे के बीच।`,
          en: `When a parent's message is for you, ${ctx.helperName} sends it to you here, between 6 am and 9 pm.`,
        }),
      ],
      buttons,
    );
  }
  const waited = waitedWords(facts.oldestAt, facts.now, language);
  const lines: (string | null)[] = [
    facts.count === 1
      ? say(language, { hi: "📝 *1 अभिभावक आपके जवाब की राह देख रहे हैं*", en: "📝 *1 parent is waiting for your answer*" })
      : say(language, { hi: `📝 *${facts.count} अभिभावक आपके जवाब की राह देख रहे हैं*`, en: `📝 *${facts.count} parents are waiting for your answer*` }),
    practiceLine(ctx),
    waited
      ? facts.count === 1
        ? say(language, { hi: `${waited} से इंतज़ार है।`, en: `Waiting for ${waited}.` })
        : say(language, { hi: `सबसे पुराना ${waited} से इंतज़ार में है।`, en: `The oldest has waited ${waited}.` })
      : null,
    "",
    facts.shown >= facts.count
      ? say(language, {
          hi: facts.count === 1 ? "यह अगले संदेश में आ रहा है।" : "हर एक अगले संदेशों में अलग-अलग आ रहा है।",
          en: facts.count === 1 ? "It comes next, as its own message." : "Each one comes next, as its own message.",
        })
      : say(language, { hi: `सबसे पुराने ${facts.shown} अगले संदेशों में अलग-अलग आ रहे हैं।`, en: `The oldest ${facts.shown} come next, each as its own message.` }),
    say(language, {
      hi: `↩️ जिसका जवाब देना है, उस संदेश को दाईं ओर स्वाइप करें और लिखें। ${ctx.helperName} उसे स्कूल के नंबर से अभिभावक को भेज देगा।`,
      en: `↩️ Swipe right on one and type your answer. ${ctx.helperName} sends it to the parent from the school's number.`,
    }),
  ];
  if (facts.count > facts.shown) {
    lines.push(
      "",
      facts.canOpenMessages
        ? say(language, { hi: `बाक़ी One के Messages में हैं: ${ctx.origin}/messages?view=replies`, en: `The rest are in Messages in One: ${ctx.origin}/messages?view=replies` })
        : say(language, { hi: "इनके जवाब देने के बाद अगले सवालों के लिए फिर *सवाल* लिखें।", en: "When you have answered these, write *questions* again for the next ones." }),
    );
  }
  return reply(lines, buttons);
}

/* ----------------------------------------------------------------- absent */

export type AwayStatus = "absent" | "leave" | "half_day" | "late";

export type ParentNote = "sick" | "other";

export type AwayChild = { name: string; rollNo: string | null; status: AwayStatus; parentNote: ParentNote | null };

export type ClassDay = {
  classLabel: string;
  classId: string;
  /** Today's register was saved. */
  marked: boolean;
  /** Children marked present (late ones are present and counted here too). */
  present: number;
  /** Marks on the register. */
  total: number;
  /** Everyone not simply present, when it was marked. */
  away: AwayChild[];
  /** Before it is marked: the children whose parent told the school they would be away today. */
  told: Array<{ name: string; rollNo: string | null; reason: ParentNote }>;
};

export type AbsentFacts =
  | { kind: "no_class" }
  | { kind: "not_allowed" }
  | { kind: "closed"; day: string; calendar: { kind: CalendarDayKind; name: CalendarName | null } | null }
  | { kind: "classes"; day: string; classes: ClassDay[] };

const AWAY_ORDER: readonly AwayStatus[] = ["absent", "leave", "half_day", "late"];

const AWAY_WORDS: Record<AwayStatus, { icon: string; words: Pair }> = {
  absent: { icon: "❌", words: { hi: "अनुपस्थित", en: "Absent" } },
  leave: { icon: "🌴", words: { hi: "छुट्टी पर", en: "On leave" } },
  half_day: { icon: "🌗", words: { hi: "आधा दिन", en: "Half day" } },
  late: { icon: "⏰", words: { hi: "देर से आए", en: "Late" } },
};

/** More names than this in one group are counted, not listed: the message stays readable. */
const NAMES_PER_GROUP = 25;

function childWords(child: { name: string; rollNo: string | null }): string {
  const name = oneLine(child.name, 40);
  return child.rollNo ? `${child.rollNo}. ${name}` : name;
}

function noteWords(note: ParentNote, language: StaffLanguage): string {
  return note === "sick" ? say(language, { hi: "बीमार", en: "unwell" }) : say(language, { hi: "बताकर", en: "told us" });
}

function classBlock(cls: ClassDay, ctx: StaffContext, day: string): string[] {
  const { language } = ctx;
  const head = `📋 *${oneLine(cls.classLabel, 40)}*`;
  if (!cls.marked) {
    const lines = [
      `${head} · ${say(language, { hi: "आज की हाज़िरी अभी नहीं लगी।", en: "today's register is not marked yet." })}`,
    ];
    if (cls.told.length > 0) {
      lines.push(say(language, { hi: "📱 इन अभिभावकों ने बताया है कि बच्चा आज नहीं आएगा:", en: "📱 These parents told the school their child is away today:" }));
      for (const child of cls.told.slice(0, NAMES_PER_GROUP)) lines.push(`• ${childWords(child)} (${noteWords(child.reason, language)})`);
    }
    lines.push(`${say(language, { hi: "हाज़िरी लगाएँ:", en: "Mark it:" })} ${ctx.origin}/teach/attendance?class=${cls.classId}&day=${day}`);
    return lines;
  }
  const lines = [
    `${head} · ${say(language, { hi: `${cls.total} में से ${cls.present} उपस्थित`, en: `${cls.present} of ${cls.total} present` })}`,
  ];
  if (cls.away.length === 0) {
    lines.push(say(language, { hi: "🎉 आज सब आए हैं।", en: "🎉 Everyone is here today." }));
  }
  for (const status of AWAY_ORDER) {
    const group = cls.away.filter((child) => child.status === status);
    if (group.length === 0) continue;
    const { icon, words } = AWAY_WORDS[status];
    lines.push(`${icon} ${say(language, words)} (${group.length}):`);
    for (const child of group.slice(0, NAMES_PER_GROUP)) {
      lines.push(`• ${childWords(child)}${child.parentNote ? ` 📱 ${noteWords(child.parentNote, language)}` : ""}`);
    }
    if (group.length > NAMES_PER_GROUP) {
      lines.push(say(language, { hi: `…और ${group.length - NAMES_PER_GROUP}`, en: `…and ${group.length - NAMES_PER_GROUP} more` }));
    }
  }
  if (cls.away.some((child) => child.parentNote)) {
    lines.push(say(language, { hi: "📱 = अभिभावक ने WhatsApp पर पहले बता दिया था", en: "📱 = the parent told the school on WhatsApp" }));
  }
  return lines;
}

/** The reply to *absent*. */
export function absentReply(facts: AbsentFacts, ctx: StaffContext): HelperMessage {
  const { language } = ctx;
  const buttons = staffButtons(["today", "questions"], language);
  if (facts.kind === "no_class" || facts.kind === "not_allowed") {
    return reply(
      [
        say(language, {
          hi: "📋 *अनुपस्थित* उन शिक्षकों के लिए है जो किसी कक्षा के कक्षा अध्यापक हैं: इससे आज आपकी कक्षा में कौन नहीं आया, यह दिखता है।",
          en: "📋 *Absent* is for class teachers: it shows who is absent in your class today.",
        }),
        practiceLine(ctx),
        "",
        facts.kind === "no_class"
          ? say(language, {
              hi: "One में इस साल आप किसी कक्षा के कक्षा अध्यापक नहीं हैं। यह ग़लत हो तो ऑफ़िस को बताएँ।",
              en: "In One you are not a class teacher this year. If that is wrong, please tell the office.",
            })
          : say(language, {
              hi: "One में आपकी भूमिका में हाज़िरी देखना शामिल नहीं है। ज़रूरत हो तो ऑफ़िस से कहें।",
              en: "Your role in One does not include seeing attendance. If you need it, please ask the office.",
            }),
      ],
      buttons,
    );
  }
  if (facts.kind === "closed") {
    const name = calendarName(facts.calendar?.name, language);
    return reply(
      [
        `📋 *${dayWords(facts.day, language)}*`,
        practiceLine(ctx),
        "",
        say(language, { hi: `🏠 आज स्कूल बंद है${name}, इसलिए आज हाज़िरी नहीं है।`, en: `🏠 School is closed today${name}, so there is no register today.` }),
      ],
      staffButtons(["questions"], language),
    );
  }
  const lines: (string | null)[] = [
    say(language, { hi: `📋 *आज की हाज़िरी · ${dayWords(facts.day, language)}*`, en: `📋 *Today's register · ${dayWords(facts.day, language)}*` }),
    practiceLine(ctx),
  ];
  for (const cls of facts.classes) lines.push("", ...classBlock(cls, ctx, facts.day));
  return reply(lines, buttons);
}

/* ------------------------------------------------------------ the others */

/** The reply to *staff*: what they can ask, as buttons. */
export function staffMenuReply(ctx: StaffContext): HelperMessage {
  const { language } = ctx;
  const who = oneLine(ctx.name, 40);
  return reply(
    [
      say(language, {
        hi: `👋 *नमस्ते${who !== "-" ? ` ${who} जी` : ""}!* मैं ${ctx.helperName} हूँ, स्टाफ़ के लिए भी।`,
        en: `👋 *Namaste${who !== "-" ? `, ${who}` : ""}!* I am ${ctx.helperName}, here for staff too.`,
      }),
      practiceLine(ctx),
      "",
      say(language, { hi: "बटन दबाएँ, या शब्द लिखें:", en: "Tap a button, or type the word:" }),
      say(language, { hi: "📅 *आज*: आज के आपके पीरियड और सबस्टिट्यूशन", en: "📅 *Today*: your periods and cover for the day" }),
      say(language, { hi: "📝 *सवाल*: जो अभिभावक आपके जवाब की राह देख रहे हैं", en: "📝 *Questions*: parents waiting for your answer" }),
      say(language, { hi: "📋 *अनुपस्थित*: आज आपकी कक्षा में कौन नहीं आया", en: "📋 *Absent*: who is absent in your class today" }),
      "",
      say(language, {
        hi: "अभिभावक के रूप में स्कूल को लिखना हो तो अपना संदेश पूरा लिखें।",
        en: "To write to the school as a parent, write your message in full.",
      }),
    ],
    staffButtons(["today", "questions", "absent"], language),
  );
}

/** A number on a staff record that has not linked itself from its own phone. */
export function linkFirstReply(language: StaffLanguage, helperName: string): HelperMessage {
  return {
    kind: "text",
    text: say(language, {
      hi: [
        `🔗 स्टाफ़ के रूप में WhatsApp पर ${helperName} से पूछने के लिए पहले यह नंबर अपने फ़ोन से जोड़ें:`,
        "VPPS One में 'मेरी प्रोफ़ाइल' (या 'पसंद') खोलें → *मेरा WhatsApp जोड़ें* दबाएँ → जो संदेश खुले, उसे भेज दें।",
        "",
        "इसमें एक मिनट लगता है। फिर *आज*, *सवाल* या *अनुपस्थित* लिखें।",
      ].join("\n"),
      en: [
        `🔗 To ask ${helperName} on WhatsApp as staff, first link this number from your own phone:`,
        "In VPPS One open My profile (or Preferences) → tap *Link my WhatsApp* → send the message it opens.",
        "",
        "It takes a minute. Then write *today*, *questions* or *absent*.",
      ].join("\n"),
    }),
  };
}

/** A linked number whose person turned WhatsApp from VPPS One off. */
export function stoppedReply(language: StaffLanguage): HelperMessage {
  return {
    kind: "text",
    text: say(language, {
      hi: "🔕 आपने VPPS One के WhatsApp संदेश बंद किए हुए हैं, इसलिए यहाँ जवाब नहीं दे सकते। फिर से चालू करने के लिए VPPS One में 'मेरी प्रोफ़ाइल' (या 'पसंद') खोलें और *फिर से चालू करें* दबाएँ।",
      en: "🔕 You turned WhatsApp messages from VPPS One off, so I cannot answer here. To turn them back on, open My profile (or Preferences) in VPPS One and tap *Turn on again*.",
    }),
  };
}

/** Something could not be read: say so, and where to look instead. */
export function staffSorryReply(language: StaffLanguage, origin: string): HelperMessage {
  return {
    kind: "text",
    text: say(language, {
      hi: `⚠️ माफ़ कीजिए, अभी यह पढ़ा नहीं जा सका। थोड़ी देर बाद फिर लिखें, या One में देखें: ${origin}/teach`,
      en: `⚠️ Sorry, that could not be read just now. Please write again in a little while, or look in One: ${origin}/teach`,
    }),
  };
}

/** The ledger's word for each reply (`parent_helper_turns.intent`); none of them is a parent's question. */
export const STAFF_INTENTS = {
  today: "staff_today",
  questions: "staff_questions",
  absent: "staff_absent",
  menu: "staff_menu",
  linkFirst: "staff_link_first",
  stopped: "staff_stopped",
  // A desk's other asks (D-607).
  needs_you: "staff_needs_you",
  school: "staff_school",
  staff_away: "staff_away",
  cover: "staff_cover",
  leave: "staff_leave",
  collection: "staff_collection",
  dues: "staff_dues",
  roles: "staff_roles",
  /** A role switched (the owner's number), or a member of staff writing as a parent or back as staff. */
  hat: "staff_hat",
  /** Typed words that were not one of the desk's asks: the menu, with a line saying so. */
  unclear: "staff_unclear",
  /** Typed words the hub kept before they were read (a turn One did not answer). */
  text: "staff_text",
} as const;
