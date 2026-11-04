import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { saveAttendanceAction } from "@/app/(app)/teach/actions";
import { saveTeacherMarksAction } from "@/app/(app)/teach/marks/actions";
import { findMarksCommand } from "@/modules/assessments/data/assessments-repo";
import { classRoll } from "@/modules/attendance/data/attendance-repo";
import { idleAttendanceState } from "@/modules/attendance/domain/attendance-receipt";
import { listNoteKinds, writeNote } from "@/modules/notes/data/notes-repo";
import { arrangeDay } from "@/modules/substitutions/data/arrange-day";
import { approvedLeaveOn } from "@/modules/substitutions/data/guided";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { assertSessionWritable, filterVisibleStudentIds } from "@/platform/auth/test-session-access";
import { schoolToday } from "@/platform/dates";
import { previewRefusal } from "@/vx/screens/exams/guards";

import { builtinAiSession } from "./access";
import type { AiPilotConfig } from "./config";
import { aiJson, aiProblem, makeAiUpload, readOrParseAiJob, type AiOperation, type AiScope } from "./feature-jobs";
import { ownedAiJob, updateAiJob } from "./jobs";
import { marksPhotoContext } from "./marks-context";
import { loadVoiceTools, primaryVoiceClass, resolveVoice, voiceVocabulary, type VoiceCommand } from "./voice-context";
import type { VoiceReview } from "./voice-review";
import { claudeVoiceOutput, VOICE_ACTION, voiceSpec } from "./voice-schema";

const uploadInput = z.strictObject({ mimeType: z.enum(["audio/webm", "audio/mp4", "audio/wav"]) });
const jobInput = z.strictObject({ jobId: z.uuid() });
const confirmationInput = z.strictObject({ jobId: z.uuid(), confirmation: z.string().regex(/^[a-f\d]{64}$/u) });
const draftTimeout = 60 * 60 * 1_000;

function confirmationFor(id: string, command: VoiceCommand, result: VoiceReview["result"]) {
  return createHash("sha256").update(JSON.stringify([id, command, result])).digest("hex");
}

async function parseVoice(staff: CurrentStaff, scope: AiScope, config: AiPilotConfig, id: string) {
  const [instructions, actions, vocabulary] = await Promise.all([
    readFile(path.join(process.cwd(), "src/lib/ai/prompts/voice.md"), "utf8"), loadVoiceTools(staff, scope.session),
    // Spelling help for the listener; a failed read only costs accuracy.
    voiceVocabulary(staff, scope.session, schoolToday()).catch(() => ({ classes: [] })),
  ]);
  const permitted = ["unsupported", ...actions.map(({ name }) => name)] as const;
  const validate = voiceSpec.validate.extend({ intent: z.enum(permitted) });
  const responseSchema = {
    ...voiceSpec.responseSchema,
    properties: {
      ...voiceSpec.responseSchema.properties,
      intent: { ...voiceSpec.responseSchema.properties.intent, enum: [...permitted] },
    },
  };
  const parsed = await readOrParseAiJob(scope, config, id, { task: "voice", instructions, context: { actions, vocabulary }, responseSchema, validate,
    // One fixed format for Claude with no optional fields (D-414); this person's allowed actions are checked by `validate`.
    claude: claudeVoiceOutput });
  if (!parsed.ok) return parsed.response;
  const { transcript } = parsed.value;
  const { result, command } = await resolveVoice(staff, scope.session, parsed.value, parsed.job.created_at);
  const review: VoiceReview = { jobId: id, transcript, result, confirmation: command ? confirmationFor(id, command, result) : null };
  return aiJson({ ok: true, ...review });
}

type Applied = "saved" | "stale" | "refused" | "unknown";

async function commitVoice(staff: CurrentStaff, session: string, id: string, command: VoiceCommand): Promise<Applied> {
  if (!(await loadVoiceTools(staff, session)).some(({ name }) => name === command.kind)) return "refused";
  switch (command.kind) {
    case "attendance_mark": {
      const ids = command.payload.marks.map(({ studentId }) => studentId);
      if ((await filterVisibleStudentIds(staff, ids)).length !== ids.length) return "refused";
      const form = new FormData();
      form.set("payload", JSON.stringify({ ...command.payload, commandId: id }));
      const result = await saveAttendanceAction(idleAttendanceState, form);
      if (result.status === "saved") return "saved";
      if (result.status === "error") return "unknown";
      return result.status === "stale" || result.status === "roster_changed" ? "stale" : "refused";
    }
    case "single_mark": {
      if (await findMarksCommand(id, staff.id)) return "saved";
      const ctx = await marksPhotoContext(staff, command.payload.paperId);
      if (!ctx || ctx.session !== session) return "refused";
      const ids = command.payload.entries.map(({ studentId }) => studentId);
      if ((await filterVisibleStudentIds(staff, ids)).length !== ids.length) return "refused";
      const result = await saveTeacherMarksAction({ ...command.payload, commandId: id });
      if (result.ok) return "saved";
      if (result.reason === "failed") return "unknown";
      return result.reason === "stale" || result.reason === "roster_changed" ? "stale" : "refused";
    }
    case "student_note": {
      const [primary, roll, kinds, visible] = await Promise.all([
        primaryVoiceClass(staff, session, command.classId), classRoll({ classId: command.classId, sessionLabel: session }),
        listNoteKinds(), filterVisibleStudentIds(staff, [command.payload.studentId]),
      ]);
      if (!primary || !visible.length || !roll.some((row) => row.studentId === command.payload.studentId) ||
          !kinds.some((row) => row.id === command.payload.kindId && row.isActive)) return "refused";
      await writeNote(command.payload, session, staff.id, id);
      revalidatePath(`/teach/student/${command.payload.studentId}`);
      revalidatePath("/teach");
      return "saved";
    }
    case "substitution":
    case "teacher_absence": {
      const cover = command.payload;
      const onLeave = await approvedLeaveOn(session, cover.day);
      delete onLeave[cover.staffId];
      const result = await arrangeDay({ actorStaffId: staff.id, sessionLabel: session, commandId: id,
        day: cover.day, expectedDayRevision: cover.dayRevision, expectedPlan: cover.fingerprint, onLeave,
        intent: { kind: "absence", staffProfileId: cover.staffId, periods: cover.periods, choices: cover.choices } });
      if (!result.ok) {
        if (result.reason === "failed") return "unknown";
        return ["stale", "plan_changed", "invalid"].includes(result.reason) ? "stale" : "refused";
      }
      revalidatePath("/substitutions");
      revalidatePath("/timetable");
      revalidatePath("/teach");
      return "saved";
    }
  }
}

async function applyVoice(staff: CurrentStaff, scope: AiScope, id: string, confirmation: string) {
  const owner = { ...scope, id };
  let job = await ownedAiJob(owner);
  if (!job || job.purged_at) return aiProblem("not_found", 404);
  if (job.status === "applied") {
    const saved = job.reviewed_data as { confirmation?: string } | null;
    return saved?.confirmation === confirmation ? aiJson({ ok: true, saved: true }) : aiProblem("stale", 409);
  }
  if (job.status !== "draft" || !job.parsed_at || (!job.reviewed_data && Date.now() - Date.parse(job.parsed_at) > draftTimeout)) {
    return aiProblem("stale", 409);
  }
  if (!job.reviewed_data) {
    const raw = voiceSpec.validate.safeParse(job.raw_output);
    if (!raw.success) return aiProblem("stale", 409);
    const { result, command } = await resolveVoice(staff, scope.session, raw.data, job.created_at);
    if (!command || confirmationFor(id, command, result) !== confirmation) return aiProblem("stale", 409);
    job = await updateAiJob(owner, { reviewed_data: { confirmation, command } }, "seal") ?? await ownedAiJob(owner);
  }
  const sealed = job?.reviewed_data as { confirmation: string; command: VoiceCommand } | null;
  if (!job || !sealed || sealed.confirmation !== confirmation) return aiProblem("stale", 409);
  if (job.status === "applied") return aiJson({ ok: true, saved: true });
  if (job.status !== "draft") return aiProblem("stale", 409);

  const outcome = await commitVoice(staff, scope.session, id, sealed.command);
  if (outcome === "unknown") return aiProblem("retry_save", 503);
  if (outcome !== "saved") {
    await updateAiJob(owner, { status: "failed", error: outcome }, "record-apply");
    return aiProblem(outcome === "stale" ? "stale" : "save", 409);
  }
  const recorded = await updateAiJob(owner, { status: "applied", applied_at: new Date().toISOString(),
    final_applied_data: { intent: sealed.command.kind, commandId: id } }, "record-apply");
  if (!recorded && (await ownedAiJob(owner))?.status !== "applied") return aiProblem("retry_save", 503);
  return aiJson({ ok: true, saved: true });
}

export async function runVoiceRoute(staff: CurrentStaff, config: AiPilotConfig, operation: AiOperation, body: unknown): Promise<Response> {
  const mayUseVoice = can(staff, "attendance:view") || (can(staff, "substitutions:view") && can(staff, "substitutions:manage"));
  const session = mayUseVoice ? await builtinAiSession(staff) : null;
  if (!session || await previewRefusal()) return aiProblem("not_found", 404);
  const scope = { staffId: staff.id, action: VOICE_ACTION, session, targetId: staff.id, revision: 0 };
  if (operation === "upload") {
    const input = uploadInput.safeParse(body);
    return input.success ? makeAiUpload(scope, config, { kind: "voice", mimeType: input.data.mimeType }) : aiProblem("invalid", 400);
  }
  if (operation === "apply") {
    const input = confirmationInput.safeParse(body);
    if (!input.success) return aiProblem("invalid", 400);
    await assertSessionWritable(staff, session);
    return applyVoice(staff, scope, input.data.jobId, input.data.confirmation);
  }
  const input = jobInput.safeParse(body);
  if (!input.success) return aiProblem("invalid", 400);
  if (operation === "parse") return parseVoice(staff, scope, config, input.data.jobId);
  const job = await updateAiJob({ ...scope, id: input.data.jobId }, { status: "discarded" }, "discard");
  return job ? aiJson({ ok: true }) : aiProblem("stale", 409);
}
