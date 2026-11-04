import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";

import { claudeVoiceOutput, fromClaudeVoice, voiceSpec } from "@/lib/ai/voice-schema";

type JsonSchema = { properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; anyOf?: unknown[] };

/** Anthropic's limits count optional and union fields across the whole schema (D-414). */
function costly(schema: JsonSchema): { optional: number; unions: number } {
  const total = { optional: 0, unions: schema.anyOf ? 1 : 0 };
  const required = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!required.has(key)) total.optional += 1;
    const inner = costly(child);
    total.optional += inner.optional;
    total.unions += inner.unions;
  }
  if (schema.items) {
    const inner = costly(schema.items);
    total.optional += inner.optional;
    total.unions += inner.unions;
  }
  return total;
}

/** A Claude answer in its own format: every field present, empty where nothing was said. */
const dense = (fields: Record<string, unknown>) => ({
  transcript: "", intent: "unsupported", unclear: false,
  day: "", classLabel: "", studentName: "", roll: "", exam: "", subject: "", mark: "", noteKind: "", note: "",
  teacher: "", substitute: "", reason: "", period: 0, attendanceStatus: "", periods: [], span: "", allPresent: false,
  exceptions: [], ...fields,
});

describe("Claude's voice format", () => {
  it("has no optional or union fields, so Anthropic compiles it quickly, and covers every voice field", () => {
    const schema = zodOutputFormat(claudeVoiceOutput.format).schema as JsonSchema;
    expect(costly(schema)).toEqual({ optional: 0, unions: 0 });
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(voiceSpec.validate.shape).sort());
  });

  it("reads a teacher absence back into the extraction the resolver expects", () => {
    const transcript = "Maya test madam will be absent tomorrow. Please arrange her substitute.";
    const answer = dense({ transcript, intent: "teacher_absence", teacher: "Maya test", day: "tomorrow" });
    expect(claudeVoiceOutput.format.safeParse(answer).success).toBe(true);
    expect(voiceSpec.validate.parse(fromClaudeVoice(answer))).toEqual({
      transcript, intent: "teacher_absence", unclear: false, teacher: "Maya test", day: "tomorrow",
    });
  });

  it("keeps a whole register's exceptions and drops their empty parts", () => {
    const answer = dense({
      transcript: "7B mein sab present hain, sirf roll 3 absent hai", intent: "attendance_mark", classLabel: "7B",
      allPresent: true, exceptions: [{ studentName: "", roll: "3", status: "absent" }],
    });
    expect(voiceSpec.validate.parse(fromClaudeVoice(answer))).toMatchObject({
      intent: "attendance_mark", classLabel: "7B", allPresent: true, exceptions: [{ roll: "3", status: "absent" }],
    });
  });

  it("treats 0, false, blank text and empty lists as not said, and keeps spoken values", () => {
    expect(fromClaudeVoice(dense({ intent: "who_is_free", period: 3, teacher: "  ", periods: [2, 4] }))).toEqual({
      transcript: "", intent: "who_is_free", unclear: false, period: 3, periods: [2, 4],
    });
    expect(fromClaudeVoice("not an object")).toBe("not an object");
  });
});
