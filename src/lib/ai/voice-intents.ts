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
  substitution: { mode: "review", description: "Prepare cover for one class and period, with explicitly named teachers." },
} as const satisfies Record<VoiceIntent, { mode: "read" | "review"; description: string }>;

export function voiceTools(staff: CurrentStaff, hasClass: boolean) {
  const names: VoiceIntent[] = [];
  if (can(staff, "attendance:view")) names.push("attendance_query");
  if (staff.isTeaching && can(staff, "timetable:view")) names.push("free_periods");
  if ((hasClass && can(staff, "attendance:mark")) || can(staff, "attendance:mark_on_behalf") || can(staff, "attendance:correct")) names.push("attendance_mark");
  if (can(staff, "marks:write")) names.push("single_mark");
  if (hasClass && can(staff, "notes:write")) names.push("student_note");
  if (can(staff, "substitutions:view") && can(staff, "substitutions:manage")) names.push("who_is_free", "substitution");
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

function rollKey(value: string) {
  const normalized = key(value);
  return /^\d+$/u.test(normalized) ? normalized.replace(/^0+(?=\d)/u, "") : normalized;
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

export function supportedSpeech(extraction: VoiceExtraction) {
  if (!extraction.transcript || extraction.unclear || extraction.intent === "unsupported") return false;
  if (!extraction.day && ["yesterday", "tomorrow", "कल", "परसों"].some((day) => hasSpokenText(extraction.transcript, day))) return false;
  const fields = [extraction.classLabel, extraction.studentName, extraction.roll, extraction.exam, extraction.subject,
    extraction.noteKind, extraction.teacher, extraction.substitute, extraction.note, extraction.reason, extraction.day,
    extraction.period?.toString(), ...extraction.exceptions?.flatMap(({ studentName, roll }) => [studentName, roll]) ?? []];
  if (extraction.mark && /^\d+(?:\.\d+)?$/u.test(key(extraction.mark))) fields.push(extraction.mark);
  return fields.every((value) => !value || hasSpokenText(extraction.transcript, value));
}

export function voiceDay(spoken: string | undefined, today: string) {
  if (!spoken) return today;
  const value = key(spoken);
  if (value === "today" || value === "आज") return today;
  if (value === "yesterday" || value === "बीता कल") return addDays(today, -1);
  return isIsoDay(value) ? value : null;
}

export function explicitWholeRegister(transcript: string) {
  const text = key(transcript);
  if (/\bnot (?:all|everyone|everybody)\b|(?:उपस्थित|हाज़िर|हाजिर) नहीं/u.test(text)) return false;
  return /\b(?:everyone|everybody|all(?: (?:the )?(?:students|children|pupils))?)(?: (?:is|are))? present\b/u.test(text) ||
    /(?:^|\s)(?:सभी|सब)(?: (?:बच्चे|विद्यार्थी|छात्र))? (?:उपस्थित|हाज़िर|हाजिर)(?=\s|[।,]|$)/u.test(text);
}

export function asksForAbsentNames(extraction: VoiceExtraction) {
  const transcript = key(extraction.transcript);
  return extraction.intent === "attendance_query" && extraction.attendanceStatus === "absent" && !extraction.studentName && !extraction.roll &&
    !/\b(?:how many|count|number of)\b|कितने|कितनी|संख्या/u.test(transcript) &&
    /\b(?:who|which|names?|list|absentees)\b|कौन|नाम/u.test(transcript);
}
