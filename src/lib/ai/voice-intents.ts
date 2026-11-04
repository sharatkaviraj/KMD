import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { addDays, isIsoDay } from "@/platform/dates";

import type { VoiceExtraction, VoiceIntent } from "./voice-schema";

const declarations = {
  attendance_query: { mode: "read", description: "Read saved attendance totals, the names marked absent, or one student's status." },
  free_periods: { mode: "read", description: "Read the signed-in teacher's free periods, optionally for one period." },
  who_is_free: { mode: "read", description: "List teachers available in one named period on the TEST timetable." },
  attendance_mark: { mode: "review", description: "Prepare a class register or a correction for the teacher to review." },
  single_mark: { mode: "review", description: "Prepare one student's mark as a draft in a named paper." },
  student_note: { mode: "review", description: "Prepare a private student note for a class teacher to review." },
  substitution: { mode: "review", description: "Prepare cover for one spoken period of an absent teacher; the class and the substitute may be left out when not spoken." },
  teacher_absence: { mode: "review", description: "Mark a named teacher away (the whole day, a half, or spoken periods) and prepare cover for each of their lessons, using a named substitute or the timetable's best free teacher." },
} as const satisfies Record<VoiceIntent, { mode: "read" | "review"; description: string }>;

export function voiceTools(staff: CurrentStaff, hasClass: boolean) {
  const names: VoiceIntent[] = [];
  if (can(staff, "attendance:view")) names.push("attendance_query");
  if (staff.isTeaching && can(staff, "timetable:view")) names.push("free_periods");
  if ((hasClass && can(staff, "attendance:mark")) || can(staff, "attendance:mark_on_behalf") || can(staff, "attendance:correct")) names.push("attendance_mark");
  if (can(staff, "marks:write")) names.push("single_mark");
  if (hasClass && can(staff, "notes:write")) names.push("student_note");
  if (can(staff, "substitutions:view") && can(staff, "substitutions:manage")) names.push("who_is_free", "substitution", "teacher_absence");
  return names.map((name) => ({ name, ...declarations[name] }));
}

function key(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[०-९]/gu, (digit) => String(digit.codePointAt(0)! - 0x0966))
    .replace(/\s+/gu, " ").trim();
}

export function voiceClassLabel(value: string) {
  return key(value).replace(/^(?:class|कक्षा)\s+/u, "")
    .replace(/^(\d{1,2})(?:st|nd|rd|th)?\s*-?\s*([a-z])$/u, "$1$2");
}

/** A fallback for an explicit numbered class and section in an attendance transcript. */
export function spokenAttendanceClass(transcript: string) {
  const labels = new Set(Array.from(key(transcript).matchAll(
    /(?:^|[^\p{L}\p{M}\p{N}])(?:class|कक्षा)\s+(\d{1,2})\s*-?\s*([a-z])(?=$|[^\p{L}\p{M}\p{N}-])/gu,
  ), ([, grade, section]) => grade + section));
  return labels.size === 1 ? [...labels][0] : undefined;
}

function rollKey(value: string) {
  const normalized = key(value);
  return /^\d+$/u.test(normalized) ? normalized.replace(/^0+(?=\d)/u, "") : normalized;
}

/**
 * Forms of address said with a teacher's name and ignored when matching it
 * ("Maya test mam", "Sharma ji", "Verma sir", "मीना मैडम").
 */
const HONORIFICS = new Set([
  "mam", "maam", "madam", "madame", "mem", "miss", "ms", "mrs", "mr", "sir", "ji", "jee", "teacher", "sahab", "saheb", "sahib",
  "didi", "bhaiya", "guruji", "shri", "shrimati", "smt", "मैम", "मैडम", "मिस", "सर", "जी", "श्री", "श्रीमती", "टीचर", "दीदी",
]);

function nameTokens(value: string) {
  return key(value).replace(/ma['’]am/gu, "maam").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").split(" ").filter((token) => token && !HONORIFICS.has(token));
}

/**
 * One teacher from a spoken name. Honorifics are dropped; then a teacher
 * whose name is exactly the spoken words wins, otherwise the one teacher
 * whose names contain every spoken word. Two candidates is no answer.
 */
export function voiceTeacher<T>(rows: readonly T[], spoken: string | undefined, labels: (row: T) => readonly string[]) {
  const want = spoken ? nameTokens(spoken) : [];
  if (!want.length) return null;
  const sorted = [...want].sort().join(" ");
  const exact = rows.filter((row) => labels(row).some((label) => [...nameTokens(label)].sort().join(" ") === sorted));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const contained = rows.filter((row) => {
    const have = new Set(labels(row).flatMap(nameTokens));
    return want.every((token) => have.has(token));
  });
  return contained.length === 1 ? contained[0] : null;
}

/**
 * The one listed teacher named in a transcript, for when the extractor left
 * `teacher` out. Every word of a name (honorifics dropped) must be spoken;
 * names made only of one- or two-letter initials are ignored, and two
 * teachers named in one sentence is no answer.
 */
export function teacherInTranscript<T>(rows: readonly T[], transcript: string, labels: (row: T) => readonly string[], except?: T | null) {
  const spoken = new Set(nameTokens(transcript));
  const named = rows.filter((row) => row !== except && labels(row).some((label) => {
    const tokens = nameTokens(label);
    return tokens.some((token) => token.length > 2) && tokens.every((token) => spoken.has(token));
  }));
  return named.length === 1 ? named[0] : null;
}

/** Only case, digit script and whitespace are normalized; never fuzzy match a target. */
export function voiceMatch<T>(rows: readonly T[], spoken: string | undefined, labels: (row: T) => readonly string[]) {
  if (!spoken) return null;
  const target = key(spoken);
  const matches = rows.filter((row) => labels(row).some((label) => key(label) === target));
  return matches.length === 1 ? matches[0] : null;
}

export function voiceStudent<T>(rows: readonly T[], reference: { studentName?: string; roll?: string }, identify: (row: T) => { name: string; roll: string | null }) {
  const { studentName, roll } = reference;
  if (!studentName && !roll) return null;
  const byName = studentName ? voiceMatch(rows, studentName, (row) => [identify(row).name]) : null;
  const byRoll = roll ? voiceMatch(rows, rollKey(roll), (row) => [rollKey(identify(row).roll ?? "")]) : null;
  if (studentName && roll) return byName && byName === byRoll ? byName : null;
  return byName ?? byRoll;
}

/** Check the extractor copied a whole spoken reference, including its section. */
export function hasSpokenText(transcript: string, value: string) {
  const haystack = ` ${key(transcript).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim()} `;
  const needle = key(value).replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

/** Relative days the extractor may return, and the spoken words each must come from. */
const SPOKEN_DAY: Record<string, string[]> = {
  today: [], aaj: [], "आज": [],
  tomorrow: ["tomorrow", "kal", "कल"],
  yesterday: ["yesterday", "kal", "कल"], "बीता कल": ["बीता कल"],
};

/**
 * Fill in a day the extractor left out when the transcript says it without
 * doubt: "today"/"aaj", "tomorrow" or "yesterday". "kal" stays unresolved.
 */
export function withSpokenDay(extraction: VoiceExtraction): VoiceExtraction {
  if (extraction.day || !extraction.transcript) return extraction;
  if (["kal", "कल", "parso", "परसों"].some((word) => hasSpokenText(extraction.transcript, word))) return extraction;
  const said = (["today", "tomorrow", "yesterday"] as const).filter((word) => hasSpokenText(extraction.transcript, word) ||
    (word === "today" && ["aaj", "आज"].some((hindi) => hasSpokenText(extraction.transcript, hindi))));
  return said.length === 1 ? { ...extraction, day: said[0] } : extraction;
}

export function supportedSpeech(extraction: VoiceExtraction) {
  if (!extraction.transcript || extraction.unclear || extraction.intent === "unsupported") return false;
  if (!extraction.day && ["yesterday", "tomorrow", "kal", "कल", "parso", "परसों"].some((day) => hasSpokenText(extraction.transcript, day))) return false;
  // A relative day is checked against the words that say it: "today" needs none (it is
  // also what an unspoken day means); "tomorrow" and "yesterday" need "kal" or the word.
  const relative = extraction.day ? SPOKEN_DAY[key(extraction.day)] : undefined;
  if (relative?.length && !relative.some((word) => hasSpokenText(extraction.transcript, word))) return false;
  const fields = [extraction.classLabel, extraction.studentName, extraction.roll, extraction.exam, extraction.subject,
    extraction.noteKind, extraction.teacher, extraction.substitute, extraction.note, extraction.reason, relative ? undefined : extraction.day,
    extraction.period?.toString(), ...extraction.exceptions?.flatMap(({ studentName, roll }) => [studentName, roll]) ?? []];
  if (extraction.mark && /^\d+(?:\.\d+)?$/u.test(key(extraction.mark))) fields.push(extraction.mark);
  return fields.every((value) => !value || hasSpokenText(extraction.transcript, value));
}

export function voiceDay(spoken: string | undefined, today: string) {
  if (!spoken) return today;
  const value = key(spoken);
  if (value === "today" || value === "आज" || value === "aaj") return today;
  if (value === "yesterday" || value === "बीता कल") return addDays(today, -1);
  if (value === "tomorrow") return addDays(today, 1);
  return isIsoDay(value) ? value : null;
}

export function explicitWholeRegister(transcript: string) {
  const text = key(transcript);
  if (/\bnot (?:all|everyone|everybody)\b|(?:उपस्थित|हाज़िर|हाजिर) नहीं/u.test(text)) return false;
  return /\b(?:everyone|everybody|all(?: (?:the )?(?:students|children|pupils))?)(?: (?:is|are))? present\b/u.test(text) ||
    /(?:^|\s)(?:सभी|सब)(?: (?:बच्चे|विद्यार्थी|छात्र))? (?:उपस्थित|हाज़िर|हाजिर)(?=\s|[।,]|$)/u.test(text);
}

export function wholeRegisterStatusAgrees(extraction: VoiceExtraction) {
  if (!extraction.attendanceStatus) return true;
  return extraction.exceptions?.length
    ? extraction.exceptions.every(({ status }) => status === extraction.attendanceStatus)
    : extraction.attendanceStatus === "present";
}

export function asksForAbsentNames(extraction: VoiceExtraction) {
  const transcript = key(extraction.transcript);
  return extraction.intent === "attendance_query" && extraction.attendanceStatus === "absent" && !extraction.studentName && !extraction.roll &&
    !/\b(?:how many|count|number of)\b|कितने|कितनी|संख्या/u.test(transcript) &&
    /\b(?:who|which|names?|list|absentees)\b|कौन|नाम/u.test(transcript);
}
