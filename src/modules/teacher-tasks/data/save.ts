import "server-only";
import { createHash } from "node:crypto";
import { saveMarksSchema } from "@/modules/assessments/domain/marks-command";
import { saveRegisterSchema } from "@/modules/attendance/domain/attendance";
import { createAdminClient } from "@/platform/supabase/admin";

export type TaskCredential = { id: string; staffId?: string; token?: string };
export type TaskSaveResult = { ok: boolean; reason?: string; revision?: number; replayed?: boolean; saved_at?: string };
/** Both entry routes use this translator; SQL checks scope and calls the existing writer. */
export async function saveTaskAcademicWork(auth: TaskCredential, work: { kind: "marks" | "attendance"; session?: string; payload: unknown }): Promise<TaskSaveResult> {
  let p: Record<string, unknown>;
  if (work.kind === "marks") {
    const parsed = saveMarksSchema.safeParse(work.payload);
    if (!parsed.success || parsed.data.kind === "reopen") return { ok: false, reason: "bad_request" };
    const x = parsed.data;
    p = { command_id: x.commandId, paper_id: x.paperId, kind: x.kind, expected_revision: x.expectedRevision, reason: x.reason, entries: [...x.entries].sort((a,b) => a.studentId.localeCompare(b.studentId)).map(e => ({ student_id: e.studentId, state: e.state, value: e.state === "value" ? e.value : null })) };
  } else {
    const parsed = saveRegisterSchema.safeParse(work.payload);
    if (!parsed.success || !work.session) return { ok: false, reason: "bad_request" };
    const x = parsed.data;
    p = { command_id: x.commandId, session_label: work.session, class_id: x.classId, day: x.day, kind: x.kind, expected_revision: x.expectedRevision, reason: x.reason, marks: [...x.marks].sort((a,b) => a.studentId.localeCompare(b.studentId)).map(m => ({ student_id: m.studentId, status: m.status })) };
  }
  const { command_id: commandId, ...contents } = p;
  const payloadHash = createHash("sha256").update(JSON.stringify(contents)).digest("hex");
  const { data, error } = await createAdminClient().rpc("save_teacher_task", { p_id: auth.id, p_staff: auth.staffId ?? null, p_token: auth.token ?? null, p: { ...contents, command_id: commandId, payload_hash: payloadHash } });
  if (error) {
    // An explicit PostgreSQL exception rolls the transaction back. A lost
    // response has no such evidence and must retain the original retry id.
    const refusal = error.code === "P0001"
      ? error.message.match(/^(?:marks|attendance|tasks):([a-z_]+)(?::|$)/)?.[1]
      : undefined;
    return { ok: false, reason: refusal ?? "unknown" };
  }
  return data as TaskSaveResult;
}
