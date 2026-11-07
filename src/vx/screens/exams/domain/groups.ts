import { subjectName } from "@/vx/screens/academics/domain";
import { p, type Pair } from "@/vx/text";

/*
 * The bands a date sheet is drawn in. A school runs one sitting per band, not
 * per class: every class from 6 to 8 sits Science on the same morning.
 */

export const GROUP_KEYS = ["pre", "c1_5", "c6_8", "c9_10", "c11_12"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export const GROUP_LABELS: Record<GroupKey, Pair> = {
  pre: p("Pre-primary", "पूर्व-प्राथमिक"),
  c1_5: p("Classes 1–5", "कक्षा 1–5"),
  c6_8: p("Classes 6–8", "कक्षा 6–8"),
  c9_10: p("Classes 9–10", "कक्षा 9–10"),
  c11_12: p("Classes 11–12", "कक्षा 11–12"),
};

/** How long a sitting usually is, per band, for a new slot. */
export const GROUP_DEFAULT_MINUTES: Record<GroupKey, number> = {
  pre: 45,
  c1_5: 60,
  c6_8: 90,
  c9_10: 90,
  c11_12: 90,
};

const PRE_PRIMARY = /^(nursery|lkg|ukg|jkg|skg|kg|pre|play)/i;

/**
 * Which band a class sits in, from its name: "Nursery", "Class 7",
 * "11 Science". A name with no number and no pre-primary word belongs to no
 * band and is left off the date sheet rather than guessed.
 */
export function groupOf(className: string): GroupKey | null {
  const name = className.trim();
  if (PRE_PRIMARY.test(name)) return "pre";
  const n = Number(name.match(/(\d{1,2})/)?.[1] ?? NaN);
  if (!Number.isFinite(n)) return null;
  if (n >= 1 && n <= 5) return "c1_5";
  if (n >= 6 && n <= 8) return "c6_8";
  if (n >= 9 && n <= 10) return "c9_10";
  if (n >= 11 && n <= 12) return "c11_12";
  return null;
}

export function isGroupKey(value: unknown): value is GroupKey {
  return typeof value === "string" && (GROUP_KEYS as readonly string[]).includes(value);
}

/** Subjects the school marks but does not sit as a written paper. */
export const NOT_A_PAPER = new Set(["NoteBook Checking", "Self Study", "Robotics", "CCS", "Sports"]);

const SUBJECT_HI: Record<string, string> = {
  english: "अंग्रेज़ी",
  "eng lit": "अंग्रेज़ी साहित्य",
  hindi: "हिंदी",
  "hindi lit": "हिंदी साहित्य",
  maths: "गणित",
  mathematics: "गणित",
  science: "विज्ञान",
  evs: "पर्यावरण",
  sst: "सामाजिक विज्ञान",
  "social sci.": "सामाजिक विज्ञान",
  sanskrit: "संस्कृत",
  computer: "कंप्यूटर",
  drawing: "चित्रकला",
  physics: "भौतिकी",
  chemistry: "रसायन",
  biology: "जीव विज्ञान",
  accountancy: "लेखाशास्त्र",
  "business studies": "व्यवसाय अध्ययन",
  economics: "अर्थशास्त्र",
  geography: "भूगोल",
  history: "इतिहास",
  "political science": "राजनीति विज्ञान",
  "general studies": "सामान्य अध्ययन",
  elga: "अंग्रेज़ी भाषा",
  sports: "खेल",
  games: "खेल",
  pe: "शारीरिक शिक्षा",
  "physical education": "शारीरिक शिक्षा",
  "notebook checking": "कॉपी जाँच",
  "self study": "स्व-अध्ययन",
  robotics: "रोबोटिक्स",
  ccs: "सह-शैक्षिक गतिविधियाँ",
};

/** A subject's name in both languages, as far as the school's list knows it. */
export function subjectPair(code: string): Pair {
  const hi = SUBJECT_HI[code.trim().toLowerCase()];
  // "MATHS" is the timetable's code; a person reads "Maths" (coordinators U6).
  const en = subjectName(code);
  return hi ? { en, hi } : { en };
}

/** Written in Hindi: a name somebody typed in Devanagari, not English copied across. */
const DEVANAGARI = /[ऀ-ॿ]/;

/** What the school typed on a subject's record, when anything was typed. */
export type TypedSubject = { en?: string | null; hi?: string | null };

/**
 * A subject's one name in both languages, the same on every screen a teacher
 * opens (D-524): "Maths" / "गणित", "ELGA" / "अंग्रेज़ी भाषा", "Social Sci." /
 * "सामाजिक विज्ञान".
 *
 * The subject list carries an English copy as most subjects' Hindi name, and
 * Today read it while the marks cards read the word list, so one lesson was
 * "कक्षा 1 · ELGA" on Today and "कक्षा 1 · अंग्रेज़ी भाषा" on its marks card,
 * and Today said "Mathematics" where Marks said "Maths". So: English is the
 * code as a person says it (`subjectName`), what the marks, exam and report
 * screens say; a name typed on the record is used only when that rule has
 * nothing better than the code itself (a subject the rule was never told
 * about). Hindi is the word list's, then a name typed in Hindi, then the
 * English; for a subject named by what was typed, its typed Hindi comes first.
 */
export function subjectWords(code: string, typed?: TypedSubject | null): { en: string; hi: string } {
  const c = code.trim();
  const ruled = subjectName(c);
  const typedEn = typed?.en?.trim() ?? "";
  const own = ruled === c && typedEn !== "" && typedEn.toLowerCase() !== c.toLowerCase() ? typedEn : null;
  const en = own ?? ruled;
  const typedHi = typed?.hi?.trim() ?? "";
  const hindi = DEVANAGARI.test(typedHi) ? typedHi : null;
  const listed = (word: string) => SUBJECT_HI[word.trim().toLowerCase()] ?? null;
  const hi = own ? (listed(own) ?? hindi ?? listed(c) ?? en) : (listed(c) ?? hindi ?? en);
  return { en, hi };
}

/**
 * `subjectWords` for any code, read against the subject list. Codes match
 * without case, so the timetable's "Maths" finds the list's "MATHS" and is
 * named exactly as the marks screens name it.
 */
export function subjectNamer(
  list: readonly { code: string; nameEn?: string | null; nameHi?: string | null }[],
): (code: string) => { en: string; hi: string } {
  const byCode = new Map(list.map((s) => [s.code.trim().toLowerCase(), s]));
  return (code) => {
    const s = byCode.get(code.trim().toLowerCase());
    return subjectWords(s?.code ?? code, s ? { en: s.nameEn, hi: s.nameHi } : null);
  };
}
