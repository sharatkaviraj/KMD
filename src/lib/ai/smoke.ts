import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { Type, type Schema } from "@google/genai";
import sharp from "sharp";
import { z } from "zod";

import { aiModel, CLAUDE_IMAGE_MODEL, DEFAULT_CLAUDE_VOICE_MODEL, DEFAULT_MODEL, GEMINI_MODELS, OPENAI_TRANSCRIPTION_MODEL, type AiModel } from "@/lib/ai/config";
import { geminiClient, geminiRequest } from "@/lib/ai/gemini";
import { failureOf, KEY_TYPE, PROVIDER_TIMEOUT_MS, type AiKey, type FailureProblem, type KeyType } from "@/lib/ai/router";
import { tierModels } from "@/modules/assist/domain/routes";

/**
 * One tiny request per key and model, to show which keys and models answer
 * before real work depends on them (`npm run ai:smoke`, and Settings →
 * Built-in AI → Check keys on the server, where the production keys live).
 * Probes use the same request builders as real jobs. Results carry fixed
 * categories only: never a key, never a provider's message.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type SmokeProbe = "text" | "image" | "audio";
export type SmokeResult = {
  key: AiKey;
  keyType: KeyType;
  model: string;
  probe: SmokeProbe;
  ok: boolean;
  ms: number;
  httpStatus?: number;
  problem?: FailureProblem;
  /** A fixed note, e.g. "counted 3 of 3". */
  note?: string;
};
export type SmokeReport = {
  at: string;
  configuredModel: string;
  /** The best Flash model that answered both probes on the free key, in GEMINI_MODELS order. */
  recommended: string | null;
  results: SmokeResult[];
  missing: AiKey[];
};

const OK_SCHEMA: Schema = { type: Type.OBJECT, required: ["ok"], properties: { ok: { type: Type.BOOLEAN } } };
const COUNT_SCHEMA: Schema = { type: Type.OBJECT, required: ["count"], properties: { count: { type: Type.INTEGER } } };

let circles: Buffer | null = null;
/** A small JPEG of three black circles: no fonts needed, so it renders on any server. */
async function circlesJpeg() {
  circles ??= await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="96"><rect width="240" height="96" fill="white"/>' +
    '<circle cx="48" cy="48" r="26" fill="black"/><circle cx="120" cy="48" r="26" fill="black"/><circle cx="192" cy="48" r="26" fill="black"/></svg>',
  )).jpeg({ quality: 85 }).toBuffer();
  return circles;
}

/** One second of a quiet 440 Hz tone, 16 kHz mono PCM. */
function toneWav() {
  const rate = 16_000;
  const samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return buffer;
}

async function timed(key: AiKey, model: string, probe: SmokeProbe, run: (signal: AbortSignal) => Promise<string | undefined>): Promise<SmokeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  const base = { key, keyType: KEY_TYPE[key], model, probe };
  try {
    const note = await run(controller.signal);
    return { ...base, ok: true, ms: Math.round(performance.now() - started), ...(note ? { note } : {}) };
  } catch (error) {
    const { httpStatus, problem } = controller.signal.aborted ? { httpStatus: undefined, problem: "timeout" as const } : failureOf(error);
    return { ...base, ok: false, ms: Math.round(performance.now() - started), ...(httpStatus ? { httpStatus } : {}), problem };
  } finally {
    clearTimeout(timer);
  }
}

function geminiProbe(key: AiKey, apiKey: string, model: AiModel, probe: "text" | "image") {
  return timed(key, model, probe, async (signal) => {
    const generate = geminiClient(apiKey);
    const image = probe === "image" ? await circlesJpeg() : null;
    const response = await generate(geminiRequest({
      config: { thinkingBudget: 0, thinkingLevel: "minimal" }, model, timeout: PROVIDER_TIMEOUT_MS, signal,
      instructions: probe === "text" ? "Answer with JSON only." : "Count the filled black circles in the image. Answer with JSON only.",
      parts: image ? [{ text: "How many black circles?" }, { inlineData: { mimeType: "image/jpeg", data: image.toString("base64") } }]
        : [{ text: 'Return {"ok": true}.' }],
      responseSchema: probe === "text" ? OK_SCHEMA : COUNT_SCHEMA,
    }));
    const parsed = JSON.parse(response.text ?? "") as { ok?: unknown; count?: unknown };
    if (probe === "text") {
      if (parsed.ok !== true) throw new SyntaxError("Unexpected answer");
      return undefined;
    }
    if (typeof parsed.count !== "number") throw new SyntaxError("Unexpected answer");
    return `counted ${parsed.count} of 3`;
  });
}

function claudeProbe(apiKey: string, model: string) {
  return timed("anthropic", model, "text", async (signal) => {
    const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", maxRetries: 0, logLevel: "off" });
    const format = zodOutputFormat(z.object({ ok: z.boolean() }));
    const response = await client.messages.create({
      // Opus 5.5 always thinks; leave room for it before the one-line answer.
      model, max_tokens: 512,
      output_config: { effort: "low", format: { type: format.type, schema: format.schema } },
      messages: [{ role: "user", content: 'Return {"ok": true}.' }],
    }, { timeout: PROVIDER_TIMEOUT_MS, signal });
    const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    if ((JSON.parse(text) as { ok?: unknown }).ok !== true) throw new SyntaxError("Unexpected answer");
    return undefined;
  });
}

function openAiProbe(apiKey: string) {
  return timed("openai", OPENAI_TRANSCRIPTION_MODEL, "audio", async (signal) => {
    const form = new FormData();
    form.set("model", OPENAI_TRANSCRIPTION_MODEL);
    form.set("response_format", "json");
    form.set("file", new Blob([new Uint8Array(toneWav())], { type: "audio/wav" }), "tone.wav");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", body: form, headers: { Authorization: `Bearer ${apiKey}` }, signal, redirect: "error",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
      const code = [body?.error?.code, body?.error?.type].find((value) => typeof value === "string" && /^[a-z_]{1,48}$/u.test(value)) ?? "";
      throw Object.assign(new Error(`Transcription unavailable ${code}`.trim()), { status: response.status });
    }
    return undefined;
  });
}

/** The AI helper's OpenAI drafting models (D-416): one JSON answer through the Responses API. */
function openAiTextProbe(apiKey: string, model: string) {
  return timed("openai", model, "text", async (signal) => {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, store: false, max_output_tokens: 256,
        input: 'Return {"ok": true}.',
        text: { format: { type: "json_schema", name: "probe", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } },
      }),
      signal, redirect: "error",
    });
    const body = await response.json().catch(() => null) as { error?: { code?: unknown; type?: unknown }; output?: { type?: string; content?: { type?: string; text?: string }[] }[] } | null;
    if (!response.ok) {
      const code = [body?.error?.code, body?.error?.type].find((value) => typeof value === "string" && /^[a-z_]{1,48}$/u.test(value)) ?? "";
      throw Object.assign(new Error(`Draft unavailable ${code}`.trim()), { status: response.status });
    }
    const text = (body?.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
    if ((JSON.parse(text) as { ok?: unknown }).ok !== true) throw new SyntaxError("Unexpected answer");
    return undefined;
  });
}

/** Run every probe at once (each stops at 25 seconds). Free-key probes cost nothing; the others cost a fraction of a rupee. */
export async function runAiSmoke(env: Env = process.env): Promise<SmokeReport> {
  const free = env.GEMINI_API_KEY_FREE?.trim();
  const paid = env.GEMINI_API_KEY_PAID?.trim() || env.GEMINI_API_KEY?.trim();
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  const openai = env.OPEN_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  let configured: AiModel = DEFAULT_MODEL;
  try {
    configured = aiModel(env.GEMINI_MODEL?.trim() || DEFAULT_MODEL);
  } catch {
    // An unsupported GEMINI_MODEL is reported as the default; the router refuses it too.
  }
  const paidModel = (() => {
    try { return aiModel(env.GEMINI_MODEL_PAID?.trim() || configured); } catch { return configured; }
  })();
  const probes: Promise<SmokeResult>[] = [];
  if (free) for (const model of GEMINI_MODELS) probes.push(geminiProbe("gemini-free", free, model, "text"), geminiProbe("gemini-free", free, model, "image"));
  if (paid) probes.push(geminiProbe("gemini-paid", paid, paidModel, "text"), geminiProbe("gemini-paid", paid, paidModel, "image"));
  if (anthropic) {
    const image = env.VPPSONE_CLAUDE_IMAGE_MODEL?.trim() || CLAUDE_IMAGE_MODEL;
    const voice = env.VPPSONE_CLAUDE_VOICE_MODEL?.trim() || DEFAULT_CLAUDE_VOICE_MODEL;
    // The AI helper's tiers too (D-416): whichever Claude models are not already probed above.
    const assist = Object.values(tierModels(env)).map((m) => m.claude);
    const claude = [...new Set([image, voice, ...assist])];
    probes.push(...claude.map((model) => claudeProbe(anthropic, model)));
  }
  // Transcription first: the key's status on the admin page follows the first OpenAI probe.
  if (openai) probes.push(openAiProbe(openai), ...[...new Set(Object.values(tierModels(env)).map((m) => m.openai))].map((model) => openAiTextProbe(openai, model)));
  const results = await Promise.all(probes);
  const works = (model: string) => results.filter((r) => r.key === "gemini-free" && r.model === model).every((r) => r.ok) &&
    results.some((r) => r.key === "gemini-free" && r.model === model);
  const missing = ([["gemini-free", free], ["gemini-paid", paid], ["anthropic", anthropic], ["openai", openai]] as const)
    .filter(([, value]) => !value).map(([key]) => key);
  return {
    at: new Date().toISOString(), configuredModel: configured,
    recommended: GEMINI_MODELS.find((model) => works(model)) ?? null, results, missing,
  };
}

/** The status each key earns from a smoke report: the configured model's text probe for Gemini, the first probe otherwise. */
export function smokeStatuses(report: SmokeReport) {
  const pick = (key: AiKey) => report.results.find((r) => r.key === key && (key.startsWith("gemini") ? r.model === (key === "gemini-free" ? report.configuredModel : r.model) && r.probe === "text" : true));
  return (["gemini-free", "gemini-paid", "anthropic", "openai"] as const).flatMap((key) => {
    const result = pick(key) ?? report.results.find((r) => r.key === key);
    return result ? [{ key, result }] : [];
  });
}
