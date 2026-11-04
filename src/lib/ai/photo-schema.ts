import { Type, type Schema } from "@google/genai";
import { z } from "zod";

const text = z.string().max(160);
const marksRow = z.strictObject({ roll: text, name: text, marks: text, rosterRef: text, unclear: z.boolean() });
const substitutionRow = z.strictObject({ absentTeacher: text, period: text, classLabel: text, substitute: text, unclear: z.boolean() });

export const PHOTO_ACTIONS = ["marks-photo", "substitution-photo"] as const;
export type PhotoAction = (typeof PHOTO_ACTIONS)[number];

function rows(fields: string[], max: number): Schema {
  return {
    type: Type.OBJECT, required: ["rows"], properties: {
      rows: { type: Type.ARRAY, maxItems: String(max), items: {
        type: Type.OBJECT, required: [...fields, "unclear"], properties: {
          ...Object.fromEntries(fields.map((key) => [key, { type: Type.STRING }])),
          unclear: { type: Type.BOOLEAN },
        },
      } },
    },
  };
}

export const marksPhoto = {
  validate: z.strictObject({ rows: z.array(marksRow).max(120) }),
  responseSchema: rows(["roll", "name", "marks", "rosterRef"], 120),
};
export type MarksPhoto = z.infer<typeof marksPhoto.validate>;

export const substitutionPhoto = {
  validate: z.strictObject({ rows: z.array(substitutionRow).max(60) }),
  responseSchema: rows(["absentTeacher", "period", "classLabel", "substitute"], 60),
};
