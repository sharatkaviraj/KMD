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
export type VoiceIntent = Exclude<VoiceExtraction["intent"], "unsupported">;
