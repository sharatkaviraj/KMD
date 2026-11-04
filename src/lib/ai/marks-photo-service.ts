import "server-only";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { commitMarks } from "@/vx/screens/exams/marks-save";

import type { GeminiConfig } from "@/lib/ai/config";
import { extractWithGemini, type AiMedia } from "@/lib/ai/gemini";
import { inputBucket, ownedAiJob, reserveAiJob, updateAiJob } from "@/lib/ai/jobs";
import { loadPhotoRoster, type MarksPhotoContext } from "@/lib/ai/marks-context";
import { finalPhotoEntries, MARKS_PHOTO_ACTION, photoRoster, reviewMarksPhoto, type PhotoChoice } from "@/lib/ai/marks-review";
import { AI_IMAGE_LONG_EDGE, AI_MAX_FILE_BYTES } from "@/lib/ai/media-limits";
import { marksPhoto } from "@/lib/ai/photo-schema";
import { loadPhotoPrompt } from "@/lib/ai/read-prompt";

const uploadTimeout = 15 * 60_000;
const draftTimeout = 24 * 60 * 60_000;

const json = (value: Record<string, unknown>, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const aiProblem = (code: string, status: number) => json({ ok: false, code }, status);
const ownerOf = (staff: CurrentStaff, ctx: MarksPhotoContext) => ({
  staffId: staff.id, action: MARKS_PHOTO_ACTION, session: ctx.session, targetId: ctx.paper.id,
});

export async function makeMarksPhotoUpload(staff: CurrentStaff, ctx: MarksPhotoContext, config: GeminiConfig, pages: number) {
  const scope = ownerOf(staff, ctx);
  const job = await reserveAiJob({ ...scope, revision: ctx.paper.entry_revision, pages, model: config.vision });
  if (!job) return aiProblem("quota", 429);
  try {
    const bucket = inputBucket();
    const uploads = await Promise.all(job.input_paths.map(async (path) => {
      const result = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (result.error || !result.data) throw new Error("Could not authorise AI upload");
      return { path, token: result.data.token };
    }));
    return json({ ok: true, jobId: job.id, uploads });
  } catch {
    await updateAiJob({ ...scope, id: job.id }, { status: "failed", error: "upload_token" }, "discard");
    return aiProblem("upload", 503);
  }
}

async function readPhoto(jobId: string, path: string, page: number): Promise<AiMedia> {
  if (path !== jobId + "/" + (page + 1) + ".jpg") throw new Error("Unexpected AI path");
  const { data, error } = await inputBucket().download(path);
  if (error || !data || data.size < 4 || data.size > AI_MAX_FILE_BYTES) throw new Error("Photo unavailable");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Photo is not a JPEG");
  // Decode to verify it is actually a JPEG, strip metadata, and enforce the size
  // regardless of what the phone or a hand-crafted client uploaded.
  const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "error" });
  const clean = await image.rotate().resize(AI_IMAGE_LONG_EDGE, AI_IMAGE_LONG_EDGE, {
    fit: "inside", withoutEnlargement: true,
  }).jpeg({ quality: 88 }).toBuffer();
  if (clean.length > AI_MAX_FILE_BYTES) throw new Error("Photo too large");
  return { mimeType: "image/jpeg", data: clean };
}

export async function parseMarksPhoto(staff: CurrentStaff, ctx: MarksPhotoContext, config: GeminiConfig, id: string) {
  const owner = { ...ownerOf(staff, ctx), id };
  const job = await ownedAiJob(owner);
  if (!job || job.status !== "draft" || job.purged_at) return aiProblem("not_found", 404);
  if (job.target_revision !== ctx.paper.entry_revision) return aiProblem("stale", 409);
  const roster = await loadPhotoRoster(ctx);
  if (!roster) return aiProblem("roster", 409);
  const existing = marksPhoto.validate.safeParse(job.raw_output);
  if (job.parsed_at && existing.success && !job.reviewed_data) {
    if (job.roster_stamp !== roster.stamp || Date.now() - Date.parse(job.parsed_at) > draftTimeout) return aiProblem("stale", 409);
    return json({ ok: true, jobId: id, review: reviewMarksPhoto(existing.data, roster.students, ctx.rule) });
  }
  if (job.parse_started_at || Date.now() - Date.parse(job.created_at) > uploadTimeout) return aiProblem("stale", 409);
  const claimed = await updateAiJob(owner, { parse_started_at: new Date().toISOString() }, "claim");
  if (!claimed) return aiProblem("stale", 409);

  let media: AiMedia[];
  try {
    media = await Promise.all(job.input_paths.map((path, i) => readPhoto(id, path, i)));
  } catch {
    await updateAiJob(owner, { status: "failed", error: "bad_media" }, "complete-parse");
    return aiProblem("upload", 400);
  }
  const result = await extractWithGemini({
    config, primary: config.vision, useFallback: true, media,
    instructions: await loadPhotoPrompt(MARKS_PHOTO_ACTION),
    context: {
      classLabel: ctx.paper.class_label, subject: ctx.paper.subject_code, maxMarks: ctx.rule.max,
      roster: photoRoster(roster.students),
    },
    ...marksPhoto,
  });
  const attempts = result.attempts;
  const last = attempts.at(-1);
  const usage = {
    model: last?.model ?? config.vision,
    model_version: last?.modelVersion,
    input_tokens: attempts.reduce((n, a) => n + a.input, 0),
    output_tokens: attempts.reduce((n, a) => n + a.output, 0),
    thinking_tokens: attempts.reduce((n, a) => n + a.thinking, 0),
    estimated_cost_inr: attempts.reduce((n, a) => n + a.costInr, 0),
    attempts,
  };
  if (!result.ok) {
    await updateAiJob(owner, { ...usage, status: "failed", error: result.error }, "complete-parse");
    return aiProblem("parse", 502);
  }
  const complete = await updateAiJob(owner, {
    ...usage, raw_output: result.value, roster_stamp: roster.stamp, parsed_at: new Date().toISOString(),
  }, "complete-parse");
  if (!complete) return aiProblem("stale", 409);
  return json({ ok: true, jobId: id, review: reviewMarksPhoto(result.value, roster.students, ctx.rule) });
}

const savedSummary = z.object({ revision: z.number().int(), changed: z.number().int() });

export async function applyMarksPhoto(staff: CurrentStaff, ctx: MarksPhotoContext, id: string, choices: PhotoChoice[]) {
  const owner = { ...ownerOf(staff, ctx), id };
  let job = await ownedAiJob(owner);
  if (!job || job.purged_at) return aiProblem("not_found", 404);
  if (job.status === "applied") {
    const saved = savedSummary.safeParse(job.final_applied_data);
    return saved.success ? json({ ok: true, ...saved.data }) : aiProblem("stale", 409);
  }
  if (job.status !== "draft" || !job.parsed_at || Date.now() - Date.parse(job.parsed_at) > draftTimeout) {
    return aiProblem("stale", 409);
  }
  const [roster, raw] = [await loadPhotoRoster(ctx), marksPhoto.validate.safeParse(job.raw_output)];
  if (!roster || roster.stamp !== job.roster_stamp || !raw.success) return aiProblem("stale", 409);
  const review = reviewMarksPhoto(raw.data, roster.students, ctx.rule);
  const data = finalPhotoEntries(review, choices, ctx.rule);
  if (!data) return aiProblem("review", 422);
  if (!job.reviewed_data) {
    if (ctx.paper.entry_revision !== job.target_revision) return aiProblem("stale", 409);
    job = await updateAiJob(owner, { reviewed_data: data }, "seal") ?? await ownedAiJob(owner);
  }
  if (!job) return aiProblem("not_found", 404);
  // jsonb may reorder object keys; compare canonical field sequences.
  const reviewKey = (value: typeof data) => JSON.stringify([value.edited, value.entries.map((e) => [e.studentId, e.state, e.value])]);
  const sealed = job.reviewed_data as typeof data | null;
  if (!sealed || reviewKey(sealed) !== reviewKey(data)) return aiProblem("sealed", 409);

  // If audit recording fails after the marks commit, the same job UUID and
  // immutable payload replay the ordinary marks command, without writing twice.
  const result = await commitMarks(staff.id, {
    commandId: id, paperId: ctx.paper.id, kind: "draft", expectedRevision: job.target_revision,
    reason: null, entries: data.entries,
  });
  if (!result.ok) {
    // A transport failure can arrive after the command committed. Keep the
    // sealed payload replayable until we receive an authoritative outcome.
    if (result.reason === "failed") return aiProblem("retry_save", 503);
    await updateAiJob(owner, { status: "failed", error: result.reason }, "record-apply");
    return aiProblem(result.reason === "stale" ? "stale" : "save", 409);
  }
  const summary = { changed: result.changed, revision: result.revision };
  const recorded = await updateAiJob(owner, {
    final_applied_data: { ...summary, ...data }, status: "applied", applied_at: new Date().toISOString(),
  }, "record-apply");
  if (!recorded && (await ownedAiJob(owner))?.status !== "applied") return aiProblem("retry_save", 503);
  revalidatePath("/teach/marks");
  return json({ ok: true, ...summary });
}

export async function discardMarksPhoto(staff: CurrentStaff, ctx: MarksPhotoContext, id: string) {
  const owner = { ...ownerOf(staff, ctx), id };
  const job = await updateAiJob(owner, { status: "discarded" }, "discard");
  return job ? json({ ok: true }) : aiProblem("stale", 409);
}
