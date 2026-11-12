import type { ChildFacts } from "./helper-facts";

/**
 * Teach it once (D-589). When Veer Patta AI cannot answer a general question
 * about the school, the parent goes to the office as before, and the question
 * goes onto a list in One in Claude's own general wording: one short line any
 * parent could ask, with no names and nothing about the family. An admin
 * writes the school's answer once, and from the next message the helper
 * answers it itself, in the parent's language. Or the admin says a person
 * always answers it, and it stops coming back to the list. Pure.
 *
 * What reaches Claude for every family is only what an admin has seen: the
 * answers the school wrote, and the questions it leaves to people. A question
 * still waiting came from one parent's message and has not been looked at, so
 * it never goes into another family's facts. Waiting questions find each
 * other by their fingerprint instead.
 *
 * The practice family's questions and real families' are two lists
 * (`practice`): an answer taught in practice is used in practice chats only.
 */

export const LESSON_STATUSES = ["waiting", "answered", "by_people"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export function isLessonStatus(value: unknown): value is LessonStatus {
  return typeof value === "string" && (LESSON_STATUSES as readonly string[]).includes(value);
}

/** A question is one short line; an answer a few sentences. The database holds the same bounds. */
export const QUESTION_CHARS = { min: 6, max: 160 } as const;
export const ANSWER_CHARS = { min: 2, max: 600 } as const;
/** At most this many of each go into one answer's facts, the most asked first. */
export const KNOWLEDGE_CAPS = { answers: 30, byPeople: 15 } as const;

export type Lesson = {
  id: string;
  practice: boolean;
  question: string;
  answer: string | null;
  status: LessonStatus;
  topic: string | null;
  askedCount: number;
  firstAskedAt: string;
  lastAskedAt: string;
  usedCount: number;
  lastUsedAt: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  closedAt: string | null;
};

/** What the helper knows from the school, keyed for this one answer (A1…, P1…). */
export type SchoolKnowledge = {
  answers: Array<{ key: string; id: string; question: string; answer: string }>;
  byPeople: Array<{ key: string; id: string; question: string }>;
};

export const NO_KNOWLEDGE: SchoolKnowledge = { answers: [], byPeople: [] };

function demand(lesson: Lesson): number {
  return lesson.askedCount + lesson.usedCount;
}

function byDemand(a: Lesson, b: Lesson): number {
  return demand(b) - demand(a) || Date.parse(b.lastAskedAt) - Date.parse(a.lastAskedAt) || a.id.localeCompare(b.id);
}

export function schoolKnowledge(lessons: readonly Lesson[]): SchoolKnowledge {
  const answered = lessons.filter((lesson) => lesson.status === "answered" && lesson.answer).sort(byDemand).slice(0, KNOWLEDGE_CAPS.answers);
  const people = lessons.filter((lesson) => lesson.status === "by_people").sort(byDemand).slice(0, KNOWLEDGE_CAPS.byPeople);
  return {
    answers: answered.map((lesson, index) => ({ key: `A${index + 1}`, id: lesson.id, question: lesson.question, answer: lesson.answer ?? "" })),
    byPeople: people.map((lesson, index) => ({ key: `P${index + 1}`, id: lesson.id, question: lesson.question })),
  };
}

/** Text from the school, on one line, without the marks that fence a parent's message. */
function oneLine(text: string): string {
  return text
    .replace(/[«»]/g, '"')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");
}

/** The school's part of FACTS. */
export function knowledgeLines(knowledge: SchoolKnowledge): string[] {
  const lines: string[] = [];
  if (knowledge.answers.length === 0) lines.push("SCHOOL ANSWERS: none yet.");
  else {
    lines.push("SCHOOL ANSWERS, written by the school (key: question -> answer):");
    for (const entry of knowledge.answers) lines.push(`- ${entry.key}: ${oneLine(entry.question)} -> ${oneLine(entry.answer)}`);
  }
  if (knowledge.byPeople.length > 0) {
    lines.push("QUESTIONS A PERSON AT THE SCHOOL ALWAYS ANSWERS (key: question):");
    for (const entry of knowledge.byPeople) lines.push(`- ${entry.key}: ${oneLine(entry.question)}`);
  }
  return lines;
}

/** "A3" or " p2 " → the lesson it names in this answer's facts; anything else → null. */
export function knowledgeEntry(knowledge: SchoolKnowledge, key: string | null | undefined): { role: "answer" | "people"; id: string } | null {
  const match = /^\s*([AaPp])\s*(\d{1,3})\s*$/.exec(key ?? "");
  if (!match) return null;
  const index = Number(match[2]) - 1;
  if (match[1].toUpperCase() === "A") {
    const entry = knowledge.answers[index];
    return entry ? { role: "answer", id: entry.id } : null;
  }
  const entry = knowledge.byPeople[index];
  return entry ? { role: "people", id: entry.id } : null;
}

/** The words of a text, folded: lower case, letters, marks and digits only. Hindi's vowel signs are marks. */
function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/** The question folded for matching: the same words give the same fingerprint, however punctuated. */
export function questionFingerprint(question: string): string {
  return words(question).join(" ").slice(0, QUESTION_CHARS.max);
}

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "sir", "madam", "dr", "shri", "smt", "ji"]);
/**
 * Words a practice or role account's name holds that are not a person's name
 * ("TEST Teacher One", "QA Accountant"): without this, a practice family could
 * never ask "When is the parent-teacher meeting?".
 */
const ROLE_WORDS = new Set([
  "test", "qa", "demo", "uat", "teacher", "class", "staff", "admin", "office", "accountant", "principal", "clerk",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
]);
/** Words a WhatsApp profile name often holds that are not a name. */
const PROFILE_WORDS = new Set([
  "parent", "parents", "papa", "mummy", "mama", "mother", "father", "home", "family", "school", "vpps", "india", "jio", "airtel",
  "office", "student", "guardian", "whatsapp", "business", "mobile", "phone", "personal", "official",
]);

/**
 * The words a general question may never hold: the names of the family that
 * wrote (each child's first name, the parent's WhatsApp name) and of the
 * children's class teachers. Short words and honorifics are left out, so
 * "Is school open on Saturday?" is never refused for a name like "Om".
 */
export function familyWords(children: readonly Pick<ChildFacts, "firstName" | "classTeacher">[], fromName: string | null | undefined): string[] {
  const found = new Set<string>();
  const name = (word: string) => !HONORIFICS.has(word) && !ROLE_WORDS.has(word);
  for (const child of children) {
    for (const word of words(child.firstName)) if (word.length >= 2 && !ROLE_WORDS.has(word)) found.add(word);
    for (const word of words(child.classTeacher?.name ?? "")) if (word.length >= 3 && name(word)) found.add(word);
  }
  for (const word of words(fromName ?? "")) if (word.length >= 4 && name(word) && !PROFILE_WORDS.has(word)) found.add(word);
  return [...found];
}

/** Cut on a word, with an ellipsis, so a long question still reads. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

/**
 * Claude's general wording of a question, made safe to keep, or null when it
 * should not be kept at all: when it names anyone in the family that wrote or
 * their class teacher, or carries a long number (a phone, a receipt), an
 * address or a link. Then the parent still reaches the office; only the list
 * goes without it.
 */
export function cleanQuestion(raw: string | null | undefined, avoid: readonly string[]): string | null {
  if (!raw) return null;
  const flat = raw.normalize("NFKC").replace(/[«»"“”]/g, "").replace(/\s+/g, " ").trim();
  if (flat.length < QUESTION_CHARS.min) return null;
  if (/\d{5,}/.test(flat) || /(?:\d[\s-]?){8,}/.test(flat)) return null;
  if (/@|https?:|www\./i.test(flat)) return null;
  const present = new Set(words(flat));
  if (avoid.some((word) => present.has(word))) return null;
  const question = shorten(flat, QUESTION_CHARS.max);
  return questionFingerprint(question).length >= 3 ? question : null;
}

/** The school's answer as an admin wrote it, tidied: no control characters, at most two blank lines, within the bounds. */
export function cleanAnswer(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const tidy = raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{C}\n]/gu, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (tidy.length < ANSWER_CHARS.min || tidy.length > ANSWER_CHARS.max) return null;
  return tidy;
}

/** An admin's rewording of a question when teaching it: the same bounds as Claude's, no names check (an admin wrote it). */
export function cleanTaughtQuestion(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.normalize("NFKC").replace(/[«»]/g, '"').replace(/\s+/g, " ").trim();
  if (flat.length < QUESTION_CHARS.min || flat.length > QUESTION_CHARS.max) return null;
  return questionFingerprint(flat).length >= 3 ? flat : null;
}

/** What Claude said about the school's answers in one answer (`helperAnswerSchema`). */
export type LessonSignal = {
  school_answer: string | null;
  unanswered: { question: string; same_as: string | null } | null;
  handoff: string;
};

export type LessonNote =
  | { role: "used"; lessonId: string }
  | { role: "asked"; lessonId: string | null; question: string | null; fingerprint: string | null };

/**
 * What one answer writes to the list: an answer given from a school answer
 * (only when nobody else had to answer), or a question the school has not
 * answered — counted on the question a person always answers when Claude
 * names one, else listed by its own words. Null when there is nothing to keep.
 */
export function lessonNoteFor(signal: LessonSignal, knowledge: SchoolKnowledge, avoid: readonly string[]): LessonNote | null {
  if (signal.unanswered) {
    const named = knowledgeEntry(knowledge, signal.unanswered.same_as);
    const people = named?.role === "people" ? named.id : null;
    const question = cleanQuestion(signal.unanswered.question, avoid);
    if (!people && !question) return null;
    return { role: "asked", lessonId: people, question, fingerprint: question ? questionFingerprint(question) : null };
  }
  if (signal.school_answer && signal.handoff === "none") {
    const named = knowledgeEntry(knowledge, signal.school_answer);
    if (named?.role === "answer") return { role: "used", lessonId: named.id };
  }
  return null;
}
