import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import { attendanceStatuses } from "@/modules/attendance/domain/attendance";

export const VOICE_ACTION = "voice";
const intents = ["unsupported", "attendance_query", "free_periods", "who_is_free", "attendance_mark", "single_mark", "student_note", "substitution", "teacher_absence"] as const;
/** How much of the day a teacher is away: the whole day unless the speaker said a half. */
export const absenceSpans = ["whole", "first_half", "second_half"] as const;
const spoken = z.string().trim().min(1).max(160);
const fields = {
  day: spoken, classLabel: spoken, studentName: spoken, roll: spoken, exam: spoken, subject: spoken,
  mark: spoken, noteKind: spoken, teacher: spoken, substitute: spoken, reason: spoken,
};
const optionalFields = Object.fromEntries(Object.keys(fields).map((key) => [key, { type: Type.STRING }]));
const attendanceStatus = { type: Type.STRING, enum: [...attendanceStatuses] };
const exception = z.strictObject({
  studentName: spoken.optional(), roll: spoken.optional(), status: z.enum(attendanceStatuses),
});

export const voiceSpec = {
  validate: z.strictObject({
    transcript: z.string().trim().max(4_000), intent: z.enum(intents), unclear: z.boolean(),
    day: fields.day.optional(), classLabel: fields.classLabel.optional(), studentName: fields.studentName.optional(),
    roll: fields.roll.optional(), exam: fields.exam.optional(), subject: fields.subject.optional(),
    mark: fields.mark.optional(), noteKind: fields.noteKind.optional(), note: z.string().trim().min(3).max(1_000).optional(),
    teacher: fields.teacher.optional(), substitute: fields.substitute.optional(), reason: fields.reason.optional(),
    period: z.number().int().min(1).max(8).optional(), attendanceStatus: z.enum(attendanceStatuses).optional(),
    periods: z.array(z.number().int().min(1).max(8)).min(1).max(8).optional(), span: z.enum(absenceSpans).optional(),
    allPresent: z.boolean().optional(), exceptions: z.array(exception).max(25).optional(),
  }),
  responseSchema: {
    type: Type.OBJECT,
    required: ["transcript", "intent", "unclear"],
    properties: {
      ...optionalFields,
      transcript: { type: Type.STRING }, intent: { type: Type.STRING, enum: [...intents] }, unclear: { type: Type.BOOLEAN },
      note: { type: Type.STRING }, period: { type: Type.INTEGER, minimum: 1, maximum: 8 }, attendanceStatus,
      periods: { type: Type.ARRAY, maxItems: "8", items: { type: Type.INTEGER, minimum: 1, maximum: 8 } },
      span: { type: Type.STRING, enum: [...absenceSpans] },
      allPresent: { type: Type.BOOLEAN },
      exceptions: { type: Type.ARRAY, maxItems: "25", items: {
        type: Type.OBJECT, required: ["status"], properties: {
          studentName: { type: Type.STRING }, roll: { type: Type.STRING }, status: attendanceStatus,
        },
      } },
    },
  } satisfies Schema,
};

export type VoiceExtraction = z.infer<typeof voiceSpec.validate>;

const said = z.string().max(1_000);
const ALWAYS = new Set(["transcript", "intent", "unclear"]);
const spokenAt = (field: unknown) => !(typeof field === "string" ? !field.trim() : Array.isArray(field) && !field.length);

/** Claude's answer with every "not said" value removed, ready for `voiceSpec.validate`. */
export function fromClaudeVoice(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    const keep = ALWAYS.has(key) || (key === "period" ? field !== 0 : key === "allPresent" ? field !== false : spokenAt(field));
    if (!keep) continue;
    out[key] = key === "exceptions" && Array.isArray(field)
      ? field.map((row: unknown) => row && typeof row === "object"
        ? Object.fromEntries(Object.entries(row).filter(([, part]) => spokenAt(part))) : row)
      : field;
  }
  return out;
}

/**
 * How Claude answers a voice command (D-414). Anthropic compiles each output
 * schema into a grammar, and every optional field roughly doubles it:
 * `voiceSpec.validate` has 20, and compiling it outlasted Claude's 18 seconds
 * on every request, so Gemini answered every voice command. Here every field
 * is required and an empty value means "not said"; `read` drops those before
 * `voiceSpec.validate` checks the answer, so nothing downstream changes.
 */
export const claudeVoiceOutput = {
  format: z.strictObject({
    transcript: z.string().max(4_000), intent: z.enum(intents), unclear: z.boolean(),
    day: said, classLabel: said, studentName: said, roll: said, exam: said, subject: said,
    mark: said, noteKind: said, note: said, teacher: said, substitute: said, reason: said,
    period: z.number().int(), attendanceStatus: z.enum([...attendanceStatuses, ""] as const),
    periods: z.array(z.number().int()), span: z.enum([...absenceSpans, ""] as const),
    allPresent: z.boolean(),
    exceptions: z.array(z.strictObject({ studentName: said, roll: said, status: z.enum(attendanceStatuses) })),
  }),
  read: fromClaudeVoice,
  note: "The output format lists every field. Where these instructions say to omit a field or leave it unset, give an empty string, 0, false or an empty list instead.",
};
export type VoiceIntent = Exclude<VoiceExtraction["intent"], "unsupported">;
