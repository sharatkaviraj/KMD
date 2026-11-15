/**
 * The time in a to-do, as a person says or types it (D-632): "kal subah 9
 * baje", "शाम 5 बजे", "tomorrow 10am", "in 2 hours", "आधे घंटे बाद",
 * "somvar ko", "17 Nov". Hindi, Hinglish and English, in Devanagari or
 * Latin letters, with Devanagari digits too.
 *
 * What it reads is shown back before anything is saved ("I'll remind you:
 * Tomorrow, 9:00 am"), so a wrong guess is seen and changed, never acted on.
 * The rules it keeps for a school day:
 *
 *  - a bare hour with no am/pm is the school's: 7 to 11 is morning, 12 is
 *    noon, 1 to 6 is afternoon ("3 baje" is 3 pm);
 *  - a time that has already gone today means tomorrow;
 *  - a day with no time means 8 in the morning;
 *  - "kal" is tomorrow, because nobody sets a reminder for yesterday.
 *
 * Short words that are also everyday Hindi are left out on purpose: "sun"
 * (listen) is never Sunday and "sat" never Saturday.
 *
 * Pure: the caller passes the clock. The school's time zone is IST, which
 * has no summer time, so every instant is built at +05:30.
 */

import { addDays, schoolToday, weekdayIndex } from "@/platform/dates";

export type ParsedWhen = {
  /** The instant, ISO. */
  at: string;
  /** The words the time was read from, as written. */
  heard: string;
  /** The to-do without its time words: "kal 9 baje Ramesh ke papa ko phone" → "Ramesh ke papa ko phone". */
  rest: string;
};

type Span = { start: number; end: number };

const L = "[\\p{L}\\p{M}\\p{N}]";

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Lower case, Devanagari digits as ASCII, the same length so spans line up with the original. */
function normalise(text: string): string {
  let out = "";
  for (const ch of text) {
    const d = DEVANAGARI_DIGITS.indexOf(ch);
    const next = d >= 0 ? String(d) : ch.toLowerCase();
    // Keep the length: a character whose lower case is longer stays as it was.
    out += next.length === ch.length ? next : ch;
  }
  return out;
}

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, एक: 1, do: 2, दो: 2, teen: 3, tin: 3, तीन: 3, char: 4, chaar: 4, चार: 4,
  paanch: 5, panch: 5, पाँच: 5, पांच: 5, chhah: 6, chhe: 6, छह: 6, "छः": 6, छे: 6,
  saat: 7, सात: 7, aath: 8, आठ: 8, nau: 9, नौ: 9, das: 10, दस: 10,
  gyarah: 11, gyara: 11, ग्यारह: 11, barah: 12, bara: 12, बारह: 12,
};
const NUM = `\\d{1,2}|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")}`;
const toNumber = (raw: string): number => (/^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? NaN));

/** "kal ko", "somvar tak", "17 Nov se pehle", "9 baje tak", "shaam ko": the little word after belongs to the time. */
const SUFFIX = "(?:\\s+(?:ko|को|tak|तक|se pehle|se pahle|से पहले))?";
const AT_PREFIX = "(?:(?:at|on|by|around|@)\\s+)?";
const DAY_PREFIX = "(?:(?:on|by)\\s+)?";

const WEEKDAYS: [string, number][] = [
  ["sunday|ravivar|raviwar|itwar|itvar|etwar|रविवार|इतवार", 0],
  ["monday|mon|somvar|somwar|सोमवार", 1],
  ["tuesday|tues|mangalvar|mangalwar|मंगलवार", 2],
  ["wednesday|wed|budhvar|budhwar|बुधवार", 3],
  ["thursday|thurs|guruvar|guruwar|brihaspativar|veervar|गुरुवार|बृहस्पतिवार|वीरवार", 4],
  ["friday|fri|shukravar|shukrawar|शुक्रवार", 5],
  ["saturday|shanivar|shaniwar|शनिवार", 6],
];

const MONTHS: [string, number][] = [
  ["january|jan|जनवरी", 1],
  ["february|feb|फ़रवरी|फरवरी", 2],
  ["march|mar|मार्च", 3],
  ["april|apr|अप्रैल|अप्रेल", 4],
  ["may|मई", 5],
  ["june|jun|जून", 6],
  ["july|jul|जुलाई", 7],
  ["august|aug|अगस्त", 8],
  ["september|sept|sep|सितंबर|सितम्बर", 9],
  ["october|oct|अक्टूबर|अक्तूबर", 10],
  ["november|nov|नवंबर|नवम्बर", 11],
  ["december|dec|दिसंबर|दिसम्बर", 12],
];
const MONTH_ANY = MONTHS.map(([src]) => src).join("|");
const monthNumber = (raw: string): number =>
  MONTHS.find(([src]) => new RegExp(`^(?:${src})$`, "iu").test(raw))?.[1] ?? NaN;

/** A part of the day on its own, and the hour it stands for. */
const PARTS: { src: string; hour: number; minute: number; pm: boolean | null; tonight?: boolean }[] = [
  {
    src: "after school|school ke baad|school ke bad|chhutti ke baad|chutti ke baad|chhutti ke bad|छुट्टी के बाद|स्कूल के बाद",
    hour: 15,
    minute: 0,
    pm: true,
  },
  { src: "after lunch|lunch ke baad|lunch ke bad|लंच के बाद", hour: 13, minute: 30, pm: true },
  { src: "tonight", hour: 20, minute: 0, pm: true, tonight: true },
  { src: "in the morning|morning|subah|subha|savere|sawere|सुबह|सवेरे", hour: 8, minute: 0, pm: false },
  { src: "noon|midday", hour: 12, minute: 0, pm: null },
  { src: "in the afternoon|afternoon|dopahar|dopehar|dophar|दोपहर", hour: 13, minute: 0, pm: true },
  { src: "in the evening|evening|shaam|sham|शाम", hour: 17, minute: 0, pm: true },
  { src: "at night|night|raat|रात", hour: 20, minute: 0, pm: true },
];

/** IST "YYYY-MM-DD" and hour:minute as an instant. */
function istInstant(day: string, hour: number, minute: number): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
}

function validDay(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso;
}

function overlaps(spans: Span[], s: Span): boolean {
  return spans.some((x) => s.start < x.end && x.start < s.end);
}

export function parseWhen(text: string, now: Date): ParsedWhen | null {
  const raw = text.slice(0, 400);
  const t = normalise(raw);
  const spans: Span[] = [];
  const take = (m: RegExpExecArray | null): boolean => {
    if (!m || m[0].length === 0) return false;
    const s = { start: m.index, end: m.index + m[0].length };
    if (overlaps(spans, s)) return false;
    spans.push(s);
    return true;
  };
  const today = schoolToday(now);

  /* ------------------------------------------- "in 2 hours", "आधे घंटे बाद" */
  const inEnglish = new RegExp(
    `(?<!${L})(?:in|after)\\s+(an?|one|half an?|\\d{1,3})\\s+(hours?|hrs?|minutes?|mins?)(?!${L})`,
    "iu",
  );
  const inHindi = new RegExp(
    `(?<!${L})(aadhe|aadha|adhe|adha|आधे|आधा|${NUM}|\\d{1,3})\\s*(ghante|ghanta|घंटे|घंटा|minute|minat|mins?|मिनट)\\s*(baad|bad|mein|me|में|बाद)(?!${L})`,
    "iu",
  );
  for (const re of [inEnglish, inHindi]) {
    const m = re.exec(t);
    if (!m) continue;
    const amount = /^(an?|one)$/.test(m[1])
      ? 1
      : /^(half an?|aadhe|aadha|adhe|adha|आधे|आधा)$/.test(m[1])
        ? 0.5
        : toNumber(m[1]);
    const hours = /^(hours?|hrs?|ghante|ghanta|घंटे|घंटा)$/.test(m[2]);
    const minutes = hours ? amount * 60 : amount;
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60 && take(m)) {
      return finish(raw, spans, new Date(now.getTime() + Math.round(minutes) * 60_000));
    }
  }

  /* ------------------------------------------------------------ the day */
  let day: string | null = null;
  let dayIsToday = false;
  const dayWords: [string, number][] = [
    ["day after tomorrow|parson|parso|parsoon|परसों|परसो", 2],
    ["tomorrow|tmrw|tmr|kal|कल", 1],
    ["today|aaj|आज", 0],
  ];
  for (const [src, offset] of dayWords) {
    if (take(new RegExp(`${DAY_PREFIX}(?<!${L})(?:${src})${SUFFIX}(?!${L})`, "iu").exec(t))) {
      day = addDays(today, offset);
      dayIsToday = offset === 0;
      break;
    }
  }
  if (!day) {
    for (const [src, index] of WEEKDAYS) {
      const m = new RegExp(
        `(?:(?:on|next|this|agle|agla|अगले)\\s+)?(?<!${L})(?:${src})${SUFFIX}(?!${L})`,
        "iu",
      ).exec(t);
      if (take(m)) {
        const ahead = (index - weekdayIndex(today) + 7) % 7 || 7;
        day = addDays(today, ahead);
        break;
      }
    }
  }
  if (!day) {
    const named = new RegExp(
      `${DAY_PREFIX}(?<!${L})(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTH_ANY})(?:\\s+(\\d{4}))?${SUFFIX}(?!${L})`,
      "iu",
    ).exec(t);
    const numeric = new RegExp(
      `${DAY_PREFIX}(?<![\\d/:.])(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?(?![\\d/:.])${SUFFIX}`,
      "iu",
    ).exec(t);
    const tarikh = new RegExp(`(?<!${L})(\\d{1,2})\\s*(?:tarikh|tareekh|तारीख़|तारीख)${SUFFIX}(?!${L})`, "iu").exec(t);
    const pick = named ?? numeric ?? tarikh;
    if (pick) {
      const date = Number(pick[1]);
      const month =
        pick === named ? monthNumber(pick[2]) : pick === numeric ? Number(pick[2]) : Number(today.slice(5, 7));
      const yearRaw = pick === tarikh ? undefined : pick[3];
      const year = yearRaw ? Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : Number(today.slice(0, 4));
      if (date >= 1 && date <= 31 && month >= 1 && month <= 12) {
        let iso = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
        // "17 Nov" said in December is next year's; "20 tarikh" after the 20th is next month's.
        if (!yearRaw && iso < today) {
          if (pick === tarikh) {
            const next = new Date(`${today.slice(0, 8)}01T12:00:00Z`);
            next.setUTCMonth(next.getUTCMonth() + 1);
            iso = `${next.toISOString().slice(0, 8)}${String(date).padStart(2, "0")}`;
          } else {
            iso = `${year + 1}${iso.slice(4)}`;
          }
        }
        // A date the calendar does not have (31 Nov) is not a date.
        if (validDay(iso) && take(pick)) day = iso;
      }
    }
  }

  /* ----------------------------------------------------------- the time */
  let hour: number | null = null;
  let minute = 0;
  let pmHint: boolean | null = null;
  let tonight = false;

  for (const part of PARTS) {
    if (take(new RegExp(`(?<!${L})(?:${part.src})${SUFFIX}(?!${L})`, "iu").exec(t))) {
      hour = part.hour;
      minute = part.minute;
      pmHint = part.pm;
      tonight = part.tonight === true;
      break;
    }
  }

  let clockFound = false;
  {
    // "saade 9", "sava 10", "paune 11", "dedh baje", "dhai baje": the way a time is said aloud.
    const said = new RegExp(
      `(?<!${L})(saade|saadhe|sade|साढ़े|साढे|sava|sawa|सवा|paune|pone|पौने)\\s*(${NUM})(?:\\s*(?:baje|bje|बजे))?${SUFFIX}(?!${L})` +
        `|(?<!${L})(dedh|dhai|dhaai|डेढ़|डेढ|ढाई)\\s*(?:baje|bje|बजे)${SUFFIX}(?!${L})`,
      "iu",
    ).exec(t);
    if (said) {
      let h: number;
      let mm: number;
      if (said[3]) {
        h = /^(dedh|डेढ़|डेढ)$/.test(said[3]) ? 1 : 2;
        mm = 30;
      } else {
        const n = toNumber(said[2]);
        if (/^(saade|saadhe|sade|साढ़े|साढे)$/.test(said[1])) {
          h = n;
          mm = 30;
        } else if (/^(sava|sawa|सवा)$/.test(said[1])) {
          h = n;
          mm = 15;
        } else {
          // "paune ek" is a quarter to one: 12:45.
          h = n - 1 <= 0 ? 12 : n - 1;
          mm = 45;
        }
      }
      if (h >= 1 && h <= 12 && take(said)) {
        hour = h;
        minute = mm;
        clockFound = true;
      }
    }
  }

  const clock = [
    // 9:30, 9.30 am, at 10:15pm, 9:30 baje
    new RegExp(
      `${AT_PREFIX}(?<![\\d.:])(\\d{1,2})[:.](\\d{2})\\s*(a\\.?m\\.?|p\\.?m\\.?)?(?:\\s*(?:baje|bje|बजे))?${SUFFIX}(?![\\d\\p{L}])`,
      "iu",
    ),
    // 10am, 4 pm
    new RegExp(`${AT_PREFIX}(?<![\\d.:])(\\d{1,2})()\\s*(a\\.?m\\.?|p\\.?m\\.?)${SUFFIX}(?!${L})`, "iu"),
    // 9 baje, नौ बजे, 9 o'clock
    new RegExp(`${AT_PREFIX}(?<!${L})(${NUM})()\\s*(?:baje|bje|बजे|o'?clock)()${SUFFIX}(?!${L})`, "iu"),
  ];
  for (const re of clockFound ? [] : clock) {
    const m = re.exec(t);
    if (!m) continue;
    const h = toNumber(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59 && take(m)) {
      hour = h;
      minute = mm;
      clockFound = true;
      const ampm = (m[3] ?? "").replace(/\./g, "");
      if (ampm === "am") pmHint = false;
      else if (ampm === "pm") pmHint = true;
    }
    break;
  }

  if (hour === null && day === null) return null;
  // "aaj" alone says nothing a reminder can use: a to-do is for today anyway.
  if (hour === null && dayIsToday) return null;

  if (hour !== null && clockFound) {
    // The school's day: 1 to 6 with no am/pm is the afternoon; "shaam 5" is 5 pm.
    if (pmHint === true && hour < 12) hour += 12;
    else if (pmHint === false && hour === 12) hour = 0;
    else if (pmHint === null && hour >= 1 && hour <= 6) hour += 12;
  }
  if (hour === null) {
    hour = 8;
    minute = 0;
  }

  let at = istInstant(day ?? today, hour, minute);
  if (at.getTime() <= now.getTime() && (!day || dayIsToday)) {
    // "tonight" said at 9 pm is later tonight; any other time that has gone today is tomorrow's.
    at = tonight && !day ? new Date(now.getTime() + 60 * 60_000) : istInstant(addDays(today, 1), hour, minute);
  }
  return finish(raw, spans, at);
}

function finish(raw: string, spans: Span[], at: Date): ParsedWhen {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const heard = sorted.map((s) => raw.slice(s.start, s.end).trim()).join(" ");
  let rest = "";
  let from = 0;
  for (const s of sorted) {
    rest += `${raw.slice(from, s.start)} `;
    from = s.end;
  }
  rest += raw.slice(from);
  rest = rest
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, "")
    .trim();
  return { at: at.toISOString(), heard, rest };
}
