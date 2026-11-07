import "server-only";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentStaff } from "@/platform/auth/current-staff";

import { builtinAiPilot } from "@/lib/ai/config";
import { marksPhotoContext } from "@/lib/ai/marks-context";
import { aiProblem, type AiOperation } from "@/lib/ai/feature-jobs";
import { applyMarksPhoto, discardMarksPhoto, makeMarksPhotoUpload, parseMarksPhoto } from "@/lib/ai/marks-photo-service";
import { MARKS_PHOTO_ACTION, photoChoice } from "@/lib/ai/marks-review";
import { AI_MAX_PAGES } from "@/lib/ai/media-limits";

const paperId = z.uuid();
const upload = z.strictObject({ paperId, pages: z.number().int().min(1).max(AI_MAX_PAGES) });
const parse = z.strictObject({ paperId, jobId: z.uuid() });
const apply = z.strictObject({ paperId, jobId: z.uuid(), choices: z.array(photoChoice).min(1).max(120) });

export async function runAiRoute(request: NextRequest, action: string, operation: AiOperation) {
  const config = builtinAiPilot();
  if (!config || ![MARKS_PHOTO_ACTION, "substitution-photo", "voice"].includes(action)) return aiProblem("not_found", 404);
  if (request.headers.get("origin") !== request.nextUrl.origin ||
      request.headers.get("sec-fetch-site") === "cross-site" ||
      !/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return aiProblem("denied", 403);
  }
  try {
    const staff = await getCurrentStaff();
    if (!staff) return aiProblem("denied", 401);
    // Nothing is read or applied as somebody an administrator is looking at (D-544).
    if (staff.viewedBy) return aiProblem("denied", 403);
    if (Number(request.headers.get("content-length")) > 65_536) return aiProblem("invalid", 413);
    const payload = await request.text();
    if (payload.length > 65_536) return aiProblem("invalid", 413);
    let body: unknown;
    try { body = JSON.parse(payload); } catch { return aiProblem("invalid", 400); }
    if (action === "substitution-photo") {
      const { runCoverPhotoRoute } = await import("@/lib/ai/cover-photo-service");
      return await runCoverPhotoRoute(staff, config, operation, body);
    }
    if (action === "voice") {
      const { runVoiceRoute } = await import("@/lib/ai/voice-service");
      return await runVoiceRoute(staff, config, operation, body);
    }
    if (operation === "upload") {
      const input = upload.safeParse(body);
      if (!input.success) return aiProblem("invalid", 400);
      const ctx = await marksPhotoContext(staff, input.data.paperId);
      return ctx ? await makeMarksPhotoUpload(staff, ctx, config, input.data.pages) : aiProblem("not_found", 404);
    }
    if (operation === "apply") {
      const input = apply.safeParse(body);
      if (!input.success) return aiProblem("invalid", 400);
      const ctx = await marksPhotoContext(staff, input.data.paperId);
      return ctx ? await applyMarksPhoto(staff, ctx, input.data.jobId, input.data.choices) : aiProblem("not_found", 404);
    }
    const input = parse.safeParse(body);
    if (!input.success) return aiProblem("invalid", 400);
    const ctx = await marksPhotoContext(staff, input.data.paperId);
    if (!ctx) return aiProblem("not_found", 404);
    return operation === "parse"
      ? await parseMarksPhoto(staff, ctx, config, input.data.jobId)
      : await discardMarksPhoto(staff, ctx, input.data.jobId);
  } catch {
    // Never put provider errors, school data or signed upload tokens in logs or HTTP responses.
    return aiProblem(operation === "apply" ? "retry_save" : "unavailable", 503);
  }
}
