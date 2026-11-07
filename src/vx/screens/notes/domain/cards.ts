import { devanagariToLatin, hasDevanagari, matchesHindiName } from "@/modules/students/domain/hindi-name-search";

import { findKids, NOTE_TAGS, SENSITIVE_TAGS, suggestTags, type FollowWhen, type NoteTag } from "./notes";

/*
 * The card-by-card note (D-486, 7 Nov 2026): the rules behind it, with no
 * screen in them. Which children a search finds, in Hindi or English; whether
 * the words name a classmate instead of the child who was picked; what kind
 * of note it is and whether it wants a follow-up, read from the words before
 * any AI does; and how the AI's sort is laid over that without taking away
 * what the words themselves said.
 */

type Kid = { id: string; name: string; classId: string; rollNo?: string | null };

/* ------------------------------------------------------------- the search */

/**
 * Children by a typed name or roll number, this class first. Latin letters
 * go through `findKids`; a Devanagari query is matched by sound (D-466), so
 * "रिया" finds Riya.
 */
export function searchKids<K extends Kid>(kids: readonly K[], classId: string, query: string): { here: K[]; elsewhere: K[] } {
  const q = query.trim();
  if (!q || !hasDevanagari(q)) return findKids(kids, classId, q);
  const hit = (k: K) => matchesHindiName(q, [k.name]);
  return { here: kids.filter((k) => k.classId === classId && hit(k)), elsewhere: kids.filter((k) => k.classId !== classId && hit(k)) };
}

/**
 * The short name on a name chip: the first name, with the surname's first
 * letter only where another child of the same class shares the first name,
 * and the whole name where even that is shared.
 */
export function chipNames<K extends Kid>(kids: readonly K[]): Map<string, string> {
  const parts = (name: string) => name.replace(/\s+/g, " ").trim().split(" ");
  const first = (k: K) => (parts(k.name)[0] ?? k.name).toLowerCase();
  const out = new Map<string, string>();
  for (const k of kids) {
    const words = parts(k.name);
    const twins = kids.filter((o) => o.id !== k.id && o.classId === k.classId && first(o) === first(k));
    if (!twins.length || words.length < 2) {
      out.set(k.id, words[0] ?? k.name);
      continue;
    }
    const initial = (o: K) => (parts(o.name)[1]?.[0] ?? "").toLowerCase();
    const clash = twins.some((o) => initial(o) === initial(k));
    out.set(k.id, clash ? words.join(" ") : `${words[0]} ${words[1][0]}.`);
  }
  return out;
}

/* ------------------------------------------- a classmate named in the note */

/**
 * One word's loose spelling, vowels kept: lower case, letters only, long
 * vowels and doubled letters folded, and one final "a" dropped, so "Aarav",
 * "Arav" and "आरव" (read "aarava") all come to "arav". Stricter than the
 * search's sound key, which drops every "a": a note is full of short Hindi
 * words, and "से" must never read as "Sai".
 */
export function spellingKey(word: string): string {
  const latin = hasDevanagari(word) ? devanagariToLatin(word) : word;
  const folded = latin
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/w/g, "v")
    .replace(/ph/g, "f")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/(.)\1+/g, "$1");
  return folded.length > 3 && folded.endsWith("a") ? folded.slice(0, -1) : folded;
}

/**
 * Words that are names and everyday words at once. A note that says "दिया"
 * (gave) or "प्रगति" (progress) is not about Diya or Pragati; one that says
 * "happy" is not about Happy. Kept short on purpose: a word left off costs one
 * extra question, never a wrong save.
 */
const NOT_A_NAME = new Set(
  [
    "दिया", "आशा", "पूजा", "सोना", "किरण", "ज्योति", "दीपक", "सूरज", "प्रेम", "राजा", "रानी", "खुशी", "ख़ुशी", "शांति", "माया",
    "लता", "कला", "नीति", "दिन", "समय", "सीमा", "विजय", "जय", "लक्ष्य", "आदर्श", "प्रगति", "आकाश", "सागर", "कविता", "गीत",
    "संगीत", "आरती", "आनंद", "शिक्षा", "विद्या", "भारत", "मुस्कान", "धैर्य", "वीर", "तारा", "उमंग", "चेतना", "सफल",
    "lucky", "sunny", "honey", "happy", "sweety", "sweet", "pinky", "prince", "rose", "joy", "hope", "angel", "star", "golden",
    "smart", "bunny", "baby", "king", "queen", "may", "june", "april", "summer", "sky", "grace", "faith", "harsh", "veer", "rich",
  ].map((w) => w.normalize("NFC")),
);

/** A first name too short to tell from a common word ("Om", "Sai" as "से"). */
const MIN_KEY = 3;

/** The note's words, in either script, as they were written. */
function wordsOf(text: string): string[] {
  return text.normalize("NFC").split(/[^\p{L}\p{M}]+/u).filter(Boolean);
}

/** The keys a child is called by: the first name, and the whole name run together. */
function firstKey(name: string): string {
  return spellingKey(name.replace(/\s+/g, " ").trim().split(" ")[0] ?? "");
}

/** Every child of `kids` named in the text by first name, with the word that named them. */
export function childrenNamedIn<K extends Kid>(text: string, kids: readonly K[]): { kid: K; word: string }[] {
  const words = wordsOf(text).filter((w) => !NOT_A_NAME.has(w.toLowerCase()) && [...w].length >= 3);
  if (!words.length) return [];
  const keyed = words.map((word) => ({ word, key: spellingKey(word) }));
  const out: { kid: K; word: string }[] = [];
  for (const kid of kids) {
    const key = firstKey(kid.name);
    if (key.length < MIN_KEY) continue;
    const hit = keyed.find((w) => w.key === key);
    if (hit) out.push({ kid, word: hit.word });
  }
  return out;
}

/**
 * The classmates a note names when it does not name the child who was picked
 * (D-486): "Aarav pushed Kabir" saved under Riya. Only the picked child's own
 * class is read, and a child who shares the picked child's first name is not
 * "another" child. Empty when the picked child is named, or nobody is.
 */
export function otherChildNamed<K extends Kid>(text: string, picked: K, kids: readonly K[]): K[] {
  const mine = firstKey(picked.name);
  const classmates = kids.filter((k) => k.classId === picked.classId);
  const named = childrenNamedIn(text, classmates);
  if (named.some((n) => n.kid.id === picked.id || firstKey(n.kid.name) === mine)) return [];
  return named.map((n) => n.kid).slice(0, 3);
}

/**
 * The words of the text that are children's names, as written: what the AI
 * must not see (D-326). Masking matches spelling exactly, so "Aarav" does not
 * hide "आरव": every word that spells a child's first name is sent, both
 * scripts and everyday words included. A verb masked by mistake costs the AI
 * one word; a name let through is a child's name outside the school.
 */
export function nameWordsIn<K extends Kid>(text: string, kids: readonly K[]): string[] {
  const keys = new Set(kids.map((k) => firstKey(k.name)).filter((key) => key.length >= MIN_KEY));
  return [...new Set(wordsOf(text).filter((w) => [...w].length >= 3 && keys.has(spellingKey(w))))];
}

/* ------------------------------------------------------ sorting the words */

/**
 * Whether the words ask for someone to come back to the note, and when.
 * Conservative on purpose: only words that ask for an action ("call the
 * parents", "बात करें", "keep an eye") turn a note into a follow-up, and
 * "कल" never does — it is yesterday as often as tomorrow.
 */
const FOLLOW_WORDS: { when: FollowWhen; en: RegExp; hi: readonly string[] }[] = [
  { when: "tomorrow", en: /\b(tomorrow|urgent(ly)?|first thing)\b/i, hi: ["तुरंत", "तुरन्त", "आज ही"] },
  {
    when: "next_monday",
    en: /\b(call|phone|ring|talk to|speak (to|with)|meet|remind|inform|check (again|on|with)|follow[\s-]?up|follow her up|follow him up|look into|ask (the )?(parents?|mother|father))\b/i,
    hi: ["बात करें", "बात करनी", "बात करना", "बात कर लें", "फ़ोन करें", "फोन करें", "फ़ोन करना", "फोन करना", "मिलें", "मिलना है", "बुलाएँ", "बुलाएं", "बुलाना", "दोबारा देख", "फिर से देख", "सूचित करें", "बताना है"],
  },
  { when: "one_week", en: /\b(watch (her|him|them|over)|keep an eye|over the (coming )?week|next few days)\b/i, hi: ["नज़र रख", "नजर रख", "निगरानी", "ध्यान रखें", "ध्यान रखना"] },
];

export function suggestFollow(text: string): FollowWhen | null {
  const t = text.normalize("NFC");
  if (!t.trim()) return null;
  for (const f of FOLLOW_WORDS) {
    if (f.en.test(t) || f.hi.some((w) => t.includes(w.normalize("NFC")))) return f.when;
  }
  return null;
}

/** What kind of note it is, and whether it wants a follow-up. */
export type NoteSort = { tags: NoteTag[]; follow: FollowWhen | null };

/** The sort the words give on their own, before (or without) any AI. */
export function localSort(text: string): NoteSort {
  return { tags: suggestTags(text), follow: suggestFollow(text) };
}

/** The AI's answer as the screen receives it. */
export type AiSort = { tags: readonly string[]; followUp: string };

const FOLLOW_KEYS: readonly string[] = ["tomorrow", "next_monday", "one_week"];

/**
 * The AI's sort laid over the words' own (D-487). The AI's tags win, at most
 * two and only known ones; an answer with no known tag keeps the words'
 * tags. A health or family tag the words found always stays: it keeps the
 * note to the admin and the class teacher, and a model reading it otherwise
 * must not widen who can read it. The follow-up is the AI's.
 */
export function mergeSort(local: NoteSort, ai: AiSort | null): NoteSort {
  if (!ai) return local;
  const known = [...new Set(ai.tags.filter((t): t is NoteTag => (NOTE_TAGS as readonly string[]).includes(t)))].slice(0, 2);
  const floor = local.tags.filter((t) => SENSITIVE_TAGS.includes(t));
  const tags = known.length ? [...new Set([...known, ...floor])] : local.tags;
  const follow = FOLLOW_KEYS.includes(ai.followUp) ? (ai.followUp as FollowWhen) : null;
  return { tags, follow };
}

/** Whether the AI's clearer wording says something different enough to offer. */
export function tidyWorthOffering(original: string, tidy: string): boolean {
  const fold = (s: string) => s.normalize("NFC").replace(/[\s.,!?।;:'"“”‘’-]+/g, " ").trim().toLowerCase();
  const a = fold(original);
  const b = fold(tidy);
  return b.length > 0 && a !== b;
}

/** Two tag lists with the same tags, in any order. */
export function sameTags(a: readonly NoteTag[], b: readonly NoteTag[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}
