import "server-only";

import { Buffer } from "node:buffer";

import type { Schema } from "@google/genai";
import sharp from "sharp";
import type { ZodType } from "zod";

import { configForSession, type AiPilotConfig } from "@/lib/ai/config";
import type { AiMedia } from "@/lib/ai/gemini";
import { type AiJob, inputBucket, ownedAiJob, reserveAiJob, updateAiJob } from "@/lib/ai/jobs";
import { AI_IMAGE_LONG_EDGE, AI_MAX_FILE_BYTES, AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { freeKeyBlocked, recordAttempts } from "@/lib/ai/provider-status";
import { extractWithProviders } from "@/lib/ai/providers";

export type AiOperation = "upload" | "parse" | "apply" | "discard";
export type AiScope = { staffId: string; action: string; session: string; targetId: string; revision: number };
export type AudioMime = "audio/webm" | "audio/mp4" | "audio/wav";
type Files = { kind: "photo"; pages: number } | { kind: "voice"; mimeType: AudioMime };
const extensions = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/wav": "wav" } as const;

export const aiJson = (value: Record<string, unknown>, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const aiProblem = (code: string, status: number) => aiJson({ ok: false, code }, status);

export async function makeAiUpload(scope: AiScope, config: AiPilotConfig, files: Files) {
  const pages = files.kind === "photo" ? files.pages : 1;
  if (!Number.isInteger(pages) || pages < 1 || pages > AI_MAX_PAGES) return aiProblem("invalid", 400);
  const job = await reserveAiJob({
    ...scope, pages, model: files.kind === "photo" ? config.vision : config.model,
    audioExtension: files.kind === "voice" ? extensions[files.mimeType] : undefined,
  });
  if (!job) return aiProblem("quota", 429);
  try {
    const bucket = inputBucket();
    const uploads = await Promise.all(job.input_paths.map(async (path) => {
      const result = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (result.error || !result.data) throw new Error("Upload authorization failed");
      return { path, token: result.data.token };
    }));
    return aiJson({ ok: true, jobId: job.id, uploads });
  } catch {
    await updateAiJob({ ...scope, id: job.id }, { status: "failed", error: "upload_token" }, "discard");
    return aiProblem("upload", 503);
  }
}

function checkedAudio(path: string, bytes: Buffer): AudioMime {
  if (bytes.length < 16) throw new Error("Bad audio");
  if (path.endsWith(".webm") && bytes.readUInt32BE(0) === 0x1a45dfa3 && bytes.subarray(0, 256).includes("webm")) return "audio/webm";
  if (path.endsWith(".m4a") && bytes.subarray(4, 8).toString() === "ftyp" &&
      bytes.includes("soun") && !bytes.includes("vide")) return "audio/mp4";
  if (path.endsWith(".wav") && bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WAVE") return "audio/wav";
  throw new Error("Bad audio");
}

export async function readAiInput(id: string, path: string, index: number, task: "image" | "voice"): Promise<AiMedia> {
  const validPath = task === "image" ? path === id + "/" + (index + 1) + ".jpg"
    : index === 0 && Object.values(extensions).some((ext) => path === id + "/1." + ext);
  if (!validPath) throw new Error("Unexpected AI path");
  const { data, error } = await inputBucket().download(path);
  if (error || !data || data.size < 4 || data.size > AI_MAX_FILE_BYTES) throw new Error("Input unavailable");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (task === "voice") return { mimeType: checkedAudio(path, bytes), data: bytes };
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Not a JPEG");
  const clean = await sharp(bytes, { limitInputPixels: 16_000_000, failOn: "error" })
    .rotate().resize(AI_IMAGE_LONG_EDGE, AI_IMAGE_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer();
  if (clean.length > AI_MAX_FILE_BYTES) throw new Error("Photo too large");
  return { mimeType: "image/jpeg", data: clean };
}

type Spec<T> = {
  task: "image" | "voice"; instructions: string; context: unknown; responseSchema: Schema;
  validate: ZodType<T>; stamp?: string; claudeFormat?: ZodType;
};

export async function readOrParseAiJob<T>(
  scope: AiScope, config: AiPilotConfig, id: string, spec: Spec<T>,
): Promise<{ ok: true; value: T; job: AiJob } | { ok: false; response: Response }> {
  const refuse = (code: string, status: number) => ({ ok: false as const, response: aiProblem(code, status) });
  const owner = { ...scope, id };
  const job = await ownedAiJob(owner);
  if (!job || job.purged_at || !["draft", "applied"].includes(job.status)) return refuse("not_found", 404);
  if (job.parsed_at) {
    const saved = spec.validate.safeParse(job.raw_output);
    if (!saved.success || (spec.stamp ?? null) !== job.roster_stamp ||
        Date.now() - Date.parse(job.parsed_at) > 24 * 60 * 60_000) return refuse("stale", 409);
    return { ok: true, value: saved.data, job };
  }
  if (job.target_revision !== scope.revision || job.parse_started_at ||
      Date.now() - Date.parse(job.created_at) > 15 * 60_000) return refuse("stale", 409);
  if (!await updateAiJob(owner, { parse_started_at: new Date().toISOString() }, "claim")) return refuse("stale", 409);
  let media: AiMedia[];
  try {
    media = await Promise.all(job.input_paths.map((path, i) => readAiInput(id, path, i, spec.task)));
  } catch {
    await updateAiJob(owner, { status: "failed", error: "bad_media" }, "complete-parse");
    return refuse("upload", 400);
  }
  let route = configForSession(config, scope.session);
  // A free key that hit its daily quota (or was refused) is skipped until it can answer again.
  if (route.freeApiKey && await freeKeyBlocked()) route = { ...route, freeApiKey: undefined };
  const workflow = scope.action === "marks-photo" || scope.action === "substitution-photo" ? scope.action : undefined;
  const result = await extractWithProviders({ ...spec, config: route, media, workflow });
  const attempts = result.attempts;
  await recordAttempts(attempts);
  const last = attempts.at(-1);
  const usage = {
    model: last?.model ?? job.model, provider: last?.provider ?? null, model_version: last?.modelVersion ?? null,
    key_type: result.ok ? last?.keyType ?? null : null,
    input_tokens: attempts.reduce((n, a) => n + a.input, 0),
    output_tokens: attempts.reduce((n, a) => n + a.output, 0),
    thinking_tokens: attempts.reduce((n, a) => n + a.thinking, 0),
    estimated_cost_inr: attempts.reduce((n, a) => n + a.costInr, 0),
    attempts,
  };
  if (!result.ok) {
    await updateAiJob(owner, { ...usage, status: "failed", error: result.error }, "complete-parse");
    return refuse("parse", 502);
  }
  const complete = await updateAiJob(owner, {
    ...usage, raw_output: result.value, roster_stamp: spec.stamp ?? null, parsed_at: new Date().toISOString(),
  }, "complete-parse");
  if (!complete) return refuse("stale", 409);
  return { ok: true, value: result.value, job: complete };
}
