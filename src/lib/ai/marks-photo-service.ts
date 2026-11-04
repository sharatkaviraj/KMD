import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { AiPilotConfig } from "@/lib/ai/config";
import { aiJson as json, aiProblem, makeAiUpload, readOrParseAiJob } from "@/lib/ai/feature-jobs";
import { ownedAiJob, updateAiJob } from "@/lib/ai/jobs";
import { loadPhotoRoster, type MarksPhotoContext } from "@/lib/ai/marks-context";
import { finalPhotoEntries, MARKS_PHOTO_ACTION, photoRoster, reviewMarksPhoto, type PhotoChoice } from "@/lib/ai/marks-review";
import { marksPhoto } from "@/lib/ai/photo-schema";
import { loadPhotoPrompt } from "@/lib/ai/read-prompt";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { commitMarks } from "@/vx/screens/exams/marks-save";

export { aiProblem } from "@/lib/ai/feature-jobs";

const draftTimeout = 24 * 60 * 60_000;

const ownerOf = (staff: CurrentStaff, ctx: MarksPhotoContext) => ({
  staffId: staff.id, action: MARKS_PHOTO_ACTION, session: ctx.session, targetId: ctx.paper.id,
});
const scopeOf = (staff: CurrentStaff, ctx: MarksPhotoContext) => ({
  ...ownerOf(staff, ctx), revision: ctx.paper.entry_revision,
});

export async function makeMarksPhotoUpload(staff: CurrentStaff, ctx: MarksPhotoContext, config: AiPilotConfig, pages: number) {
  return makeAiUpload(scopeOf(staff, ctx), config, { kind: "photo", pages });
}

export async function parseMarksPhoto(staff: CurrentStaff, ctx: MarksPhotoContext, config: AiPilotConfig, id: string) {
  const roster = await loadPhotoRoster(ctx);
  if (!roster) return aiProblem("roster", 409);
  const result = await readOrParseAiJob(scopeOf(staff, ctx), config, id, {
    task: "image",
    instructions: await loadPhotoPrompt(MARKS_PHOTO_ACTION),
    context: {
      classLabel: ctx.paper.class_label, subject: ctx.paper.subject_code, maxMarks: ctx.rule.max,
      roster: photoRoster(roster.students),
    },
    stamp: roster.stamp,
    ...marksPhoto,
  });
  if (!result.ok) return result.response;
  if (result.job.status !== "draft" || result.job.reviewed_data || result.job.target_revision !== ctx.paper.entry_revision) return aiProblem("stale", 409);
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
    final_applied_data: { ...summary, ...data }, edited: data.edited, status: "applied", applied_at: new Date().toISOString(),
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
