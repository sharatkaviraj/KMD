import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { builtinAiPilot, type AiPilotConfig } from "@/lib/ai/config";
import {
  aiJson, aiProblem, makeAiUpload, readOrParseAiJob, type AiOperation, type AiScope,
} from "@/lib/ai/feature-jobs";
import { reviewCoverPhoto } from "@/lib/ai/cover-photo-review";
import { COVER_PHOTO_ACTION, COVER_PHOTO_UNDO_MS, type CoverPhotoResult } from "@/lib/ai/cover-photo-types";
import { ownedAiJob, updateAiJob, type AiJob } from "@/lib/ai/jobs";
import { AI_MAX_PAGES } from "@/lib/ai/media-limits";
import { substitutionPhoto } from "@/lib/ai/photo-schema";
import { loadPhotoPrompt } from "@/lib/ai/read-prompt";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { profilesFor, readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { exclusionsFrom } from "@/modules/substitutions/data/cover-repo";
import { approvedLeaveOn } from "@/modules/substitutions/data/guided";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { TEST_SESSION_LABEL } from "@/platform/auth/test-session-policy";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

const dayInput = { day: z.iso.date() };
const jobInput = { ...dayInput, jobId: z.uuid() };
const inputs = {
  upload: z.strictObject({ ...dayInput, pages: z.number().int().min(1).max(AI_MAX_PAGES) }),
  parse: z.strictObject(jobInput),
  apply: z.strictObject({ ...jobInput, mode: z.literal("undo") }),
  discard: z.strictObject(jobInput),
};

export function coverPhotoEnabled(staff: CurrentStaff, session: string | null) {
  return Boolean(staff.isTestAccount && can(staff, "substitutions:manage") &&
    session === TEST_SESSION_LABEL && builtinAiPilot());
}

// AI jobs use a UUID target. Date digits alone identify a cover day inside
// its action/session namespace and allow ownership checks even after changes.
function scopeFor(staff: CurrentStaff, day: string, revision = 0): AiScope {
  return {
    staffId: staff.id, action: COVER_PHOTO_ACTION, session: TEST_SESSION_LABEL,
    targetId: "00000000-0000-4000-8000-0000" + day.replaceAll("-", ""), revision,
  };
}

export async function recentCoverPhoto(staff: CurrentStaff, day: string): Promise<CoverPhotoResult | null> {
  const scope = scopeFor(staff, day);
  const { data, error } = await createAdminClient().from("ai_jobs").select("id, final_applied_data")
    .eq("staff_profile_id", scope.staffId).eq("action", scope.action).eq("session_label", scope.session)
    .eq("target_id", scope.targetId).eq("status", "applied").is("purged_at", null)
    .gt("applied_at", new Date(Date.now() - COVER_PHOTO_UNDO_MS).toISOString())
    .order("applied_at", { ascending: false }).limit(1).maybeSingle<{ id: string; final_applied_data: CoverPhotoResult }>();
  if (error || !data?.final_applied_data || data.final_applied_data.undone) return null;
  return { ...data.final_applied_data, jobId: data.id };
}

function changedCover() {
  revalidatePath("/substitutions");
  revalidatePath("/substitutions/arrange");
  revalidatePath("/teach");
}

type Receipt = { ok: true; result: CoverPhotoResult } | { ok: false; reason: string };

function replay(job: AiJob | null) {
  if (job?.status !== "applied" || !job.final_applied_data) return null;
  changedCover();
  return aiJson({ ok: true, ...(job.final_applied_data as CoverPhotoResult) });
}

export async function runCoverPhotoRoute(staff: CurrentStaff, config: AiPilotConfig, operation: AiOperation, body: unknown): Promise<Response> {
  if (!staff.isTestAccount || !can(staff, "substitutions:manage") ||
      await resolveSessionLabel() !== TEST_SESSION_LABEL) return aiProblem("not_found", 404);
  try {
    await assertNotPreviewing();
  } catch {
    return aiProblem("denied", 403);
  }

  if (operation === "upload") {
    const input = inputs.upload.safeParse(body);
    if (!input.success) return aiProblem("invalid", 400);
    const { day, pages } = input.data;
    const cover = await readCoverDay(TEST_SESSION_LABEL, day);
    if (!cover.versionId || !cover.header || !cover.slots.length) return aiProblem("timetable", 409);
    return makeAiUpload(scopeFor(staff, day, cover.dayRevision), config, { kind: "photo", pages });
  }

  const input = inputs[operation].safeParse(body);
  if (!input.success) return aiProblem("invalid", 400);
  const { day, jobId } = input.data;
  const scope = scopeFor(staff, day);
  const owner = { ...scope, id: jobId };
  const job = await ownedAiJob(owner);
  if (!job || job.purged_at) return aiProblem("not_found", 404);

  if (operation === "discard") {
    const discarded = await updateAiJob(owner, { status: "discarded" }, "discard");
    return discarded ? aiJson({ ok: true }) : aiProblem("stale", 409);
  }

  if (operation === "apply") {
    const { data, error } = await createAdminClient().rpc("undo_ai_cover_photo", {
      p_job: jobId, p_actor: staff.id, p_day: day,
    });
    if (error) return aiProblem("retry_save", 503);
    const receipt = data as Receipt;
    if (!receipt.ok) return aiProblem(receipt.reason === "expired" ? "expired" : "stale", 409);
    changedCover();
    return aiJson({ ok: true, ...receipt.result });
  }

  const previous = replay(job);
  if (previous) return previous;

  const cover = await readCoverDay(TEST_SESSION_LABEL, day);
  if (!cover.versionId || !cover.header || !cover.slots.length) return aiProblem("timetable", 409);
  if (cover.dayRevision !== job.target_revision) return replay(await ownedAiJob(owner)) ?? aiProblem("stale", 409);
  const extraction = await readOrParseAiJob({ ...scope, revision: cover.dayRevision }, config, jobId, {
    task: "image", instructions: await loadPhotoPrompt(COVER_PHOTO_ACTION),
    // The provider transcribes a synthetic register. Match staff and slots
    // against the real app locally, without sending names, rosters or IDs.
    context: { date: day, periods: [...new Set(cover.slots.map((slot) => slot.period + 1))].sort((a, b) => a - b) },
    responseSchema: substitutionPhoto.responseSchema, validate: substitutionPhoto.validate,
    stamp: cover.versionId + ":" + cover.bells.revision,
  });
  if (!extraction.ok) {
    return replay(await ownedAiJob(owner)) ?? extraction.response;
  }

  const now = new Date();
  const current = await readCoverDay(TEST_SESSION_LABEL, day, now);
  const [profiles, leave] = await Promise.all([profilesFor(current), approvedLeaveOn(TEST_SESSION_LABEL, day)]);
  const { review, assignments } = reviewCoverPhoto({
    photo: extraction.value, day: current, ...profiles, leave, excluded: exclusionsFrom(current.duties), now,
  });
  const draft: CoverPhotoResult = { jobId, review, applied: [], undoUntil: null };
  if (current.dayRevision !== cover.dayRevision || current.versionId !== cover.versionId ||
      current.bells.revision !== cover.bells.revision || current.header !== cover.header) {
    return replay(await ownedAiJob(owner)) ?? aiJson({ ok: true, ...draft, applyBlocked: "stale" });
  }
  if (!assignments.length) return aiJson({ ok: true, ...draft });
  if (process.env.VPPSONE_BUILTIN_AI_COVER_AUTO_TEST !== "1") {
    return aiJson({ ok: true, ...draft, applyBlocked: "review_only" });
  }
  const { data, error } = await createAdminClient().rpc("apply_ai_cover_photo", {
    p_job: jobId, p_actor: staff.id, p_day: day, p_timetable_day: current.header,
    p_version: current.versionId, p_bells: current.bells.revision,
    p_assignments: assignments, p_review: review,
  });
  if (error) return aiProblem("retry_save", 503);
  const receipt = data as Receipt;
  if (!receipt.ok) return aiJson({ ok: true, ...draft, applyBlocked: "stale" });
  changedCover();
  return aiJson({ ok: true, ...receipt.result });
}
