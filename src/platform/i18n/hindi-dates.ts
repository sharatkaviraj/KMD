/**
 * English dates inside Hindi text, said in Hindi (7 Nov 2026).
 *
 * A Hindi-only reader saw "Sat 7 Nov · पीरियड 4 चल रहा है", "सबसे पुराना 10 Oct"
 * and "Thu 15 Oct, 1:40 am" on the office's own screens. About three hundred
 * places build a date with an English-only helper (`shortDay`, `dayMonth`,
 * `dateLabel`, `Intl…("en-IN")`) and put it into the Hindi half of a pair, or
 * pass it into a pair-builder that does. Each screen can be — and the busiest
 * ones are — moved to the pair forms in `vx/format.ts` (`shortDayP`, `tx()`),
 * but a rule that holds only where somebody remembered it does not hold.
 *
 * So the place a Hindi line is chosen also says its dates in Hindi:
 * `lead()`/`under()` in `vx/text.ts` and `primary()` in `./language.ts` pass
 * the Hindi line through this. It rewrites only date-shaped English — a day
 * number beside a month, a weekday before a day number, a long month name, a
 * clock time with am/pm — and nothing else, so a name, a class or an English
 * word a teacher typed is left as it was. Figures stay Latin, as everywhere in
 * the app.
 *
 * Pure: no React, no database.
 */

export const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"] as const;
export const HI_WEEKDAYS = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"] as const;
export const HI_WEEKDAYS_SHORT = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"] as const;

const EN_MONTHS_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const EN_WEEKDAYS_LONG = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "Oct", "October", "Sept" → 0-based month, or -1. */
function monthIndex(word: string): number {
  const w = word.toLowerCase();
  const long = EN_MONTHS_LONG.indexOf(w);
  if (long >= 0) return long;
  if (w === "sept") return 8;
  return EN_MONTHS_LONG.findIndex((m) => m.slice(0, 3) === w);
}

/** "Thu", "Thursday", "Tues", "Thurs" → 0-based weekday (0 = Sunday), or -1. */
function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  const long = EN_WEEKDAYS_LONG.indexOf(w);
  if (long >= 0) return long;
  return EN_WEEKDAYS_LONG.findIndex((d) => d.slice(0, 3) === w.slice(0, 3));
}

/** The part of the day a Hindi speaker puts before the time. */
export function dayPeriodHi(hour24: number): string {
  if (hour24 < 4) return "रात";
  if (hour24 < 12) return "सुबह";
  if (hour24 < 16) return "दोपहर";
  if (hour24 < 20) return "शाम";
  return "रात";
}

const MONTH = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)";
const WEEKDAY_LONG = "(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)";
const WEEKDAY_SHORT = "(Sun|Mon|Tues|Tue|Wed|Thurs|Thu|Fri|Sat)";

// "7 Nov", "7 Nov 2026", "13–17 Aug", "7th November". The day may carry an
// English ordinal, which Hindi does not use.
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? ${MONTH}\\b`, "g");
// "Thursday, 8 …" / "Thu 8 …" / "Wed 7 – …": a weekday only when a day follows.
const WEEKDAY_LONG_BEFORE_DAY = new RegExp(`\\b${WEEKDAY_LONG},? (?=\\d)`, "g");
const WEEKDAY_SHORT_BEFORE_DAY = new RegExp(`\\b${WEEKDAY_SHORT}\\b,? (?=\\d)`, "g");
// "October 2026" and a lone "October": a long month name is never a Hindi word.
// "May" is left alone on its own, because it is also an English word.
const MONTH_LONG_ALONE = /\b(January|February|March|April|June|July|August|September|October|November|December)\b/g;
// "Mar 2027": a short month beside a year, for an exam not dated yet.
const MONTH_SHORT_YEAR = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) (\d{4})\b/g;
// "10:38 am", "3:18 PM", "1:40 a.m."
const CLOCK_12 = /\b(\d{1,2}):(\d{2})\s?(am|pm|a\.m\.|p\.m\.)(?![A-Za-z])/gi;

/**
 * The Hindi line, with any English date or time in it said in Hindi.
 *
 * Idempotent: Hindi in, the same Hindi out.
 */
export function hindiDates(text: string): string {
  if (!text || !/[A-Za-z]/.test(text)) return text;
  return text
    .replace(CLOCK_12, (_m, h: string, m: string, ap: string) => {
      const hour = Number(h) % 12 + (ap.toLowerCase().startsWith("p") ? 12 : 0);
      return `${dayPeriodHi(hour)} ${Number(h)}:${m}`;
    })
    .replace(WEEKDAY_LONG_BEFORE_DAY, (_m, d: string) => `${HI_WEEKDAYS[weekdayIndex(d)]}, `)
    .replace(WEEKDAY_SHORT_BEFORE_DAY, (_m, d: string) => `${HI_WEEKDAYS_SHORT[weekdayIndex(d)]} `)
    .replace(DAY_MONTH, (m, day: string, mon: string) => {
      const i = monthIndex(mon);
      return i < 0 ? m : `${Number(day)} ${HI_MONTHS[i]}`;
    })
    .replace(MONTH_SHORT_YEAR, (m, mon: string, year: string) => {
      const i = monthIndex(mon);
      return i < 0 ? m : `${HI_MONTHS[i]} ${year}`;
    })
    .replace(MONTH_LONG_ALONE, (m, mon: string) => {
      const i = monthIndex(mon);
      return i < 0 ? m : HI_MONTHS[i];
    });
}
