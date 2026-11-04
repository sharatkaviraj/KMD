import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { AI_INPUT_BUCKET } from "@/lib/ai/media-limits";
import type { AiModel } from "@/lib/ai/config";

const db = createAdminClient;
const JOB_COLUMNS = "id, staff_profile_id, action, session_label, target_id, target_revision, roster_stamp, input_paths, model, status, raw_output, reviewed_data, final_applied_data, parse_started_at, parsed_at, created_at, purged_at";

export type AiJob = {
  id: string;
  staff_profile_id: string;
  action: string;
  session_label: string;
  target_id: string;
  target_revision: number;
  roster_stamp: string | null;
  input_paths: string[];
  model: string;
  status: "draft" | "applied" | "discarded" | "failed";
  raw_output: unknown;
  reviewed_data: unknown;
  final_applied_data: unknown;
  parse_started_at: string | null;
  parsed_at: string | null;
  created_at: string;
  purged_at: string | null;
};

type Owner = { id: string; staffId: string; action: string; session: string; targetId: string };

function owned(owner: Owner) {
  return db().from("ai_jobs")
    .select(JOB_COLUMNS)
    .eq("id", owner.id)
    .eq("staff_profile_id", owner.staffId)
    .eq("action", owner.action)
    .eq("session_label", owner.session)
    .eq("target_id", owner.targetId);
}

export async function ownedAiJob(owner: Owner): Promise<AiJob | null> {
  const { data, error } = await owned(owner).maybeSingle<AiJob>();
  if (error) throw new Error("Could not read AI job");
  return data;
}

export async function reserveAiJob(input: Omit<Owner, "id"> & { revision: number; pages: number; model: AiModel }) {
  if (input.session !== "TEST-2026-27") throw new Error("Outside AI pilot");
  const { data, error } = await db().rpc("reserve_ai_job", {
    p_staff: input.staffId, p_action: input.action, p_target: input.targetId,
    p_revision: input.revision, p_pages: input.pages, p_model: input.model,
  });
  if (error) throw new Error("Could not reserve AI job");
  return typeof data === "string" ? ownedAiJob({ ...input, id: data }) : null;
}

export async function updateAiJob(
  owner: Owner,
  changes: Record<string, unknown>,
  step: "claim" | "complete-parse" | "seal" | "record-apply" | "discard",
): Promise<AiJob | null> {
  let query = db().from("ai_jobs").update(changes)
    .eq("id", owner.id).eq("staff_profile_id", owner.staffId).eq("action", owner.action)
    .eq("session_label", owner.session).eq("target_id", owner.targetId)
    .eq("status", "draft").is("purged_at", null);
  if (step === "claim") query = query.is("parse_started_at", null);
  if (step === "complete-parse") query = query.not("parse_started_at", "is", null).is("parsed_at", null);
  if (step === "seal") query = query.not("parsed_at", "is", null).is("reviewed_data", null);
  if (step === "record-apply") query = query.not("reviewed_data", "is", null);
  if (step === "discard") query = query.is("reviewed_data", null).or("parse_started_at.is.null,parsed_at.not.is.null");
  const { data, error } = await query.select(JOB_COLUMNS).maybeSingle<AiJob>();
  if (error) throw new Error("Could not update AI job");
  return data;
}

export function inputBucket() {
  return db().storage.from(AI_INPUT_BUCKET);
}

/** Storage API, not a direct DELETE from storage.objects: delete the bytes first. */
export async function purgeBuiltinAiInputs(now = new Date()) {
  const cutoff = new Date(now.valueOf() - 90 * 86_400_000).toISOString();
  const { data, error } = await db().from("ai_jobs")
    .select("id, input_paths, status").is("purged_at", null).lt("created_at", cutoff)
    .order("created_at").limit(250)
    .returns<Pick<AiJob, "id" | "input_paths" | "status">[]>();
  if (error) throw new Error("Could not list expired AI jobs");
  if (!data.length) return { jobs: 0, paths: 0 };
  const paths = data.flatMap((job) => job.input_paths.filter((path) =>
    [1, 2, 3, 4].some((i) => path === job.id + "/" + i + ".jpg"),
  ));
  if (paths.length) {
    const { error: removalError } = await inputBucket().remove(paths);
    if (removalError) throw new Error("Could not remove expired AI inputs");
  }
  const erased = { raw_output: null, reviewed_data: null, final_applied_data: null, purged_at: now.toISOString() };
  for (const draft of [true, false]) {
    const ids = data.filter((job) => (job.status === "draft") === draft).map((job) => job.id);
    if (!ids.length) continue;
    const result = await db().from("ai_jobs")
      .update(draft ? { ...erased, status: "discarded", error: "expired" } : erased)
      .in("id", ids).is("purged_at", null);
    if (result.error) throw new Error("Could not redact expired AI jobs");
  }
  return { jobs: data.length, paths: paths.length };
}
