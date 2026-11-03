import "server-only";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import { manualReferenceAdapter, portals, preflightReturn, previewReturnImport, type GovernmentBatch } from "../domain/exchange";
import { MAX_RETURN_FILE_BYTES, parseReturnFile, renderReturnFile } from "./files";
import { adapterForViewer, hashBytes, readOfficeArtifact, returnBatchForViewer, rosterForAdapter, storeOfficeArtifact } from "./repo";

export const returnRequestSchema = z.object({ portal: z.enum(portals), module: z.string().trim().min(2).max(80), sessionLabel: z.string().regex(/^(?:TEST-)?\d{4}-\d{2}$/), schoolCode: z.string().trim().max(50).default(""), classIds: z.array(z.uuid()).max(100).default([]), adapterId: z.uuid().optional(), commandId: z.uuid(), expectedSource: z.string().max(200).optional(), excludeBlocked: z.boolean().default(false) }).strict();
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

export async function checkReturn(input: unknown) {
  await assertPermission("government:export");
  const value = returnRequestSchema.parse(input);
  const adapter = value.adapterId ? await adapterForViewer(value.adapterId, value.sessionLabel) : manualReferenceAdapter(value.portal, value.module, value.sessionLabel, value.schoolCode);
  if (adapter.portal !== value.portal || adapter.module !== value.module) throw new Error("Wrong destination adapter");
  const all = await rosterForAdapter(value.sessionLabel, adapter, "government:export");
  const rows = value.classIds.length ? all.filter((row) => value.classIds.includes(row.classId)) : all;
  const preflight = preflightReturn(rows, adapter);
  return { value, adapter, rows, preflight, sourceRevision: all[0]?.sourceRevision ?? "" };
}

async function finishExport(batch: GovernmentBatch, actor: string) {
  if (batch.file_path) return;
  const file = renderReturnFile(batch.payload.rows ?? [], batch.adapter);
  const path = `batches/${batch.id}/export.${batch.adapter.format}`;
  const existing = await readOfficeArtifact(path);
  const bytes = existing ?? await storeOfficeArtifact(path, file.bytes, file.contentType);
  const { error } = await createAdminClient().rpc("school_return_finish", { p_actor: actor, p_id: batch.id, p_path: path, p_hash: hashBytes(bytes), p_name: file.fileName, p_type: file.contentType, p_confined: isConfinedDeployment() });
  if (error) throw new Error("Return file completion unavailable");
}

export async function prepareReturn(input: unknown): Promise<string> {
  const staff = await assertPermission("government:export"); await assertNotPreviewing();
  const value = returnRequestSchema.parse(input); await assertSessionWritable(staff, value.sessionLabel);
  const requestHash = hashBytes(JSON.stringify({ ...value, expectedSource: undefined }));
  const db = createAdminClient();
  const prior = await db.from("school_return_batches").select("*").eq("id", value.commandId).maybeSingle<GovernmentBatch & { actor_id: string; request_hash: string }>();
  if (prior.error) throw new Error("Return register unavailable");
  if (prior.data) {
    if (prior.data.actor_id !== staff.id || prior.data.request_hash !== requestHash) throw new Error("Return request already used");
    await finishExport(prior.data, staff.id); return prior.data.id;
  }
  const check = await checkReturn(value);
  if (!value.expectedSource || value.expectedSource !== check.sourceRevision) throw new Error("School records changed. Check details again.");
  const blocked = check.preflight.filter((row) => row.state === "blocked").map((row) => row.studentId);
  if (blocked.length && (!value.excludeBlocked || check.adapter.mode !== "manual_reference")) throw new Error("Resolve blocked records before preparing this file");
  const rows = check.rows.filter((row) => !blocked.includes(row.studentId));
  if (!rows.length) throw new Error("No ready rows selected");
  const { data, error } = await db.rpc("school_return_reserve", { p_actor: staff.id, p_id: value.commandId, p_request_hash: requestHash, p_adapter: check.adapter,
    p_payload: { rows, counts: { selected: check.rows.length, ready: rows.length, excluded: blocked.length }, sourceRevision: check.sourceRevision, excluded: blocked }, p_direction: "export", p_confined: isConfinedDeployment() });
  if (error || !data) throw new Error("School records changed or the return could not be reserved. Check details again.");
  await finishExport(data as GovernmentBatch, staff.id); return value.commandId;
}

export async function stageReturnImport(input: { batchId: string; commandId: string; bytes: Uint8Array; fileName: string }): Promise<string> {
  const staff = await assertPermission("government:import"); await assertNotPreviewing();
  const parent = await returnBatchForViewer(z.uuid().parse(input.batchId));
  if (!parent || parent.direction !== "export" || parent.adapter.mode !== "verified_upload") throw new Error("A verified supported export is required before importing a returned file");
  await assertSessionWritable(staff, parent.session_label);
  const command = z.uuid().parse(input.commandId);
  if (!input.fileName.toLowerCase().endsWith(`.${parent.adapter.format}`) || !input.bytes.byteLength || input.bytes.byteLength > MAX_RETURN_FILE_BYTES) throw new Error("The file type or size does not match this adapter");
  const sourceHash = hashBytes(input.bytes);
  const requestHash = hashBytes(JSON.stringify({ parent: parent.id, sourceHash }));
  const db = createAdminClient();
  const old = await db.from("school_return_batches").select("*").eq("id", command).maybeSingle<GovernmentBatch & { request_hash: string; actor_id: string }>();
  if (old.error) throw new Error("Import register unavailable");
  let batch: GovernmentBatch | null = old.data;
  if (old.data && (old.data.actor_id !== staff.id || old.data.request_hash !== requestHash)) throw new Error("Import command already used");
  if (!batch) {
    const rows = parseReturnFile(input.bytes, input.fileName, parent.adapter);
    const roster = await rosterForAdapter(parent.session_label, parent.adapter, "government:import");
    const preview = previewReturnImport(rows, parent.adapter, roster);
    const counts = Object.fromEntries(["ready", "unchanged", "conflict", "unmatched"].map((state) => [state, preview.filter((row) => row.state === state).length]));
    const { data, error } = await db.rpc("school_return_reserve", { p_actor: staff.id, p_id: command, p_request_hash: requestHash, p_adapter: parent.adapter, p_payload: { preview, counts, sourceRevision: roster[0]?.sourceRevision ?? "" }, p_direction: "import", p_source_hash: sourceHash, p_parent: parent.id, p_confined: isConfinedDeployment() });
    if (error || !data) throw new Error("Import could not be staged");
    batch = data as GovernmentBatch;
  }
  if (!batch.file_path) {
    if (input.bytes.byteLength > MAX_RETURN_FILE_BYTES || sourceHash !== batch.source_hash) throw new Error("The uploaded file differs from the staged import");
    const path = `batches/${batch.id}/source.${batch.adapter.format}`;
    const contentType = batch.adapter.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    await storeOfficeArtifact(path, input.bytes, contentType);
    const { error } = await db.rpc("school_return_finish", { p_actor: staff.id, p_id: batch.id, p_path: path, p_hash: sourceHash, p_name: input.fileName.slice(0, 150), p_type: contentType, p_confined: isConfinedDeployment() });
    if (error) throw new Error("Import file could not be recorded");
  }
  return batch.id;
}

export async function applyReturnImport(input: { batchId: string; commandId: string; revision: number }) {
  const staff = await assertPermission("government:import"); await assertNotPreviewing();
  const batch = await returnBatchForViewer(z.uuid().parse(input.batchId));
  if (!batch) throw new Error("Import unavailable");
  await assertSessionWritable(staff, batch.session_label);
  const { data, error } = await createAdminClient().rpc("school_return_apply", { p_actor: staff.id, p_batch: batch.id, p_command: z.uuid().parse(input.commandId), p_expected_revision: z.number().int().positive().parse(input.revision), p_confined: isConfinedDeployment() });
  if (error) throw new Error("The preview is stale or has unresolved conflicts. Upload a fresh returned file and review again.");
  return data as { applied: number; unchanged: number };
}

export async function resumeReturnExport(batchId: string) {
  const staff = await assertPermission("government:export"); await assertNotPreviewing();
  const batch = await returnBatchForViewer(z.uuid().parse(batchId));
  if (!batch || batch.direction !== "export") throw new Error("Export unavailable");
  await assertSessionWritable(staff, batch.session_label); await finishExport(batch, staff.id);
  return batch.id;
}
