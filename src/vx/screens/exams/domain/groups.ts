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
