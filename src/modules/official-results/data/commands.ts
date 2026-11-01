import "server-only";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import { hashBytes, storeOfficeArtifact } from "@/modules/government-records/data/repo";
import { cycleSchema, candidateSchema, readinessSchema, resultSchema, boardMutationStudent } from "../domain/board";
import { boardCycle, boardSource, boardCandidate, boardCommandReceipt } from "./repo";

export const MAX_BOARD_EVIDENCE_BYTES = 750 * 1024;
export function boardEvidenceType(bytes: Uint8Array) {
 if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
 if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
 if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
 return null;
}
const source = { expectedSource: z.string().min(1).max(200) };
const cycleCommand = z.object({ config: cycleSchema, expectedRevision: z.number().int().min(0) }).strict();
const schemas = { cycle: cycleCommand, candidate: candidateSchema.extend(source), readiness: readinessSchema.safeExtend(source), result: resultSchema.safeExtend(source) };
const envelope = z.object({ cycleId: z.uuid(), commandId: z.uuid(), payload: z.unknown() }).strict();
export async function executeBoardCommand(kind: keyof typeof schemas, input: unknown, file?: File) {
 const staff = await assertPermission("outcomes:manage"); await assertNotPreviewing();
 const command = envelope.parse(input), payload = schemas[kind].parse(command.payload);
 const held = kind === "cycle" ? null : await boardCycle(command.cycleId);
 const session = "config" in payload ? payload.config.sessionLabel : held?.session_label;
 if (!session) throw new Error("Board cycle unavailable");
 await assertSessionWritable(staff, session);
 let evidence = null, evidenceBytes: Uint8Array | null = null;
 if (file?.size) {
  if (kind !== "result" || file.size > MAX_BOARD_EVIDENCE_BYTES) throw new Error("Unsupported evidence");
  const bytes = new Uint8Array(await file.arrayBuffer()), type = boardEvidenceType(bytes);
  if (!type) throw new Error("Unsupported evidence");
  const hash = hashBytes(bytes), extension = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
  const path = `board/${command.cycleId}/${command.commandId}/${hash}.${extension}`;
  evidenceBytes = bytes; evidence = { path, hash, type };
 }
 const body = kind === "result" ? { ...payload, evidence } : payload;
 const requestHash = hashBytes(JSON.stringify({ kind, cycleId: command.cycleId, body }));
 const prior = await boardCommandReceipt(command.commandId);
 if (prior) {
  if (prior.actor_id !== staff.id || prior.cycle_id !== command.cycleId || prior.kind !== kind || prior.request_hash !== requestHash) throw new Error("Board command was reused for a different request");
  return prior.receipt;
 }
 if (kind !== "cycle" && held && "studentId" in payload) {
  const [source, candidate] = await Promise.all([boardSource(session, "outcomes:manage"), boardCandidate(held.id, payload.studentId)]);
  if (source.sourceRevision !== payload.expectedSource) throw new Error("Board source changed");
  boardMutationStudent(held.config, payload.studentId, kind, source.roster, candidate);
  if (kind === "result" && "subjectCode" in payload && (!candidate?.verified || !candidate.subjects.includes(payload.subjectCode) || !held.config.subjects.some(subject => subject.code === payload.subjectCode))) throw new Error("Subject is outside the verified registration");
 }
 if ("config" in payload) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  if (payload.config.verifiedOn > today || (payload.config.deadline && payload.config.deadline.verifiedOn > today)) throw new Error("Verification date is in the future");
 }
 if (evidence && evidenceBytes) await storeOfficeArtifact(evidence.path, evidenceBytes, evidence.type);
 const { data, error } = await createAdminClient().rpc("school_board_command", { p_actor: staff.id, p_command: command.commandId, p_cycle: command.cycleId, p_kind: kind, p_payload: body, p_hash: requestHash, p_confined: isConfinedDeployment() });
 if (error || !data) throw new Error("Board record was not saved; refresh and check current versions");
 return data as Record<string, unknown>;
}
