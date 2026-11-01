"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import { schoolToday } from "@/vx/format";
import { applyReturnImport, checkReturn, prepareReturn, resumeReturnExport, stageReturnImport } from "@/modules/government-records/data/commands";
import { hashBytes, returnBatchForViewer, storeOfficeArtifact } from "@/modules/government-records/data/repo";
import { inspectReturnSpecimen, MAX_RETURN_FILE_BYTES } from "@/modules/government-records/data/files";
import { returnAcceptance } from "@/modules/government-records/domain/acceptance";
import { adapterSchema } from "@/modules/government-records/domain/exchange";

export async function checkReturnAction(input: unknown) {
  await assertPermission("government:export");
  try {
    const checked = await checkReturn(input);
    return { ok: true as const, sourceRevision: checked.sourceRevision, mode: checked.adapter.mode, rows: checked.preflight.map((row) => ({ ...row, name: checked.rows.find(s => s.studentId === row.studentId)?.studentName ?? "" })) };
  } catch { return { ok: false as const }; }
}
export async function prepareReturnAction(input: unknown) {
  await assertPermission("government:export"); await assertNotPreviewing();
  try { const id = await prepareReturn(input); revalidatePath("/school-office/returns"); return { ok: true as const, id }; } catch { return { ok: false as const }; }
}
export async function resumeReturnAction(id: string) {
  await assertPermission("government:export"); await assertNotPreviewing();
  try { await resumeReturnExport(id); revalidatePath(`/school-office/returns/${id}`); return { ok: true }; } catch { return { ok: false }; }
}
export async function stageReturnAction(form: FormData) {
  await assertPermission("government:import"); await assertNotPreviewing();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_RETURN_FILE_BYTES) return { ok: false as const };
  try {
    const id = await stageReturnImport({ batchId: String(form.get("batchId")), commandId: String(form.get("commandId")), bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    revalidatePath("/school-office/returns"); return { ok: true as const, id };
  } catch { return { ok: false as const }; }
}
export async function applyReturnAction(input: { batchId: string; commandId: string; revision: number }) {
  await assertPermission("government:import"); await assertNotPreviewing();
  try { const receipt = await applyReturnImport(input); revalidatePath(`/school-office/returns/${input.batchId}`); return { ok: true as const, receipt }; } catch { return { ok: false as const }; }
}

export async function recordReturnOutcomeAction(form: FormData) {
  const staff = await assertPermission("government:export"); await assertNotPreviewing();
  try {
    const value = z.object({ batchId: z.uuid(), revision: z.coerce.number().int().positive(), state: z.enum(["submitted", "accepted", "partially_accepted", "rejected"]), acknowledgement: z.string().trim().min(3).max(500) }).parse(Object.fromEntries(form));
    const batch = await returnBatchForViewer(value.batchId); if (!batch) return { ok: false };
    await assertSessionWritable(staff, batch.session_label);
    const outcomes = returnAcceptance(batch.payload.rows ?? [], value.state, String(form.get("acceptedAdmissionNumbers") ?? ""));
    let evidence: { path: string; hash: string; name: string; type: string } | null = null;
    const file = form.get("evidence");
    if (value.state !== "submitted") {
      if (!(file instanceof File) || !file.size || file.size > MAX_RETURN_FILE_BYTES) return { ok: false };
      const bytes = new Uint8Array(await file.arrayBuffer());
      const type = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" ? "application/pdf" : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? "image/png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : null;
      if (!type) return { ok: false };
      const extension = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
      const path = `evidence/${batch.id}/${randomUUID()}.${extension}`;
      await storeOfficeArtifact(path, bytes, type); evidence = { path, hash: hashBytes(bytes), name: file.name.slice(0, 150), type };
    }
    const { error } = await createAdminClient().rpc("school_return_outcome", { p_actor: staff.id, p_batch: batch.id, p_expected_revision: value.revision, p_state: value.state, p_ack: value.acknowledgement, p_rows: outcomes, p_evidence: evidence?.path ?? null, p_evidence_hash: evidence?.hash ?? null, p_evidence_name: evidence?.name ?? null, p_evidence_type: evidence?.type ?? null, p_confined: isConfinedDeployment() });
    if (error) return { ok: false };
    revalidatePath(`/school-office/returns/${batch.id}`); return { ok: true };
  } catch { return { ok: false }; }
}

export async function inspectReturnSpecimenAction(form: FormData) {
  const staff = await assertPermission("settings:manage"); await assertNotPreviewing();
  if (staff.isTestAccount || isConfinedDeployment()) return { ok: false as const };
  const file = form.get("file"), format = form.get("format");
  if (!(file instanceof File) || !file.size || file.size > MAX_RETURN_FILE_BYTES || (format !== "csv" && format !== "xlsx")) return { ok: false as const };
  try { return { ok: true as const, headers: inspectReturnSpecimen(new Uint8Array(await file.arrayBuffer()), file.name, format, String(form.get("sheetName") ?? "Sheet1")) }; } catch { return { ok: false as const }; }
}

export async function saveReturnAdapterAction(form: FormData) {
  const staff = await assertPermission("settings:manage"); await assertNotPreviewing();
  if (staff.isTestAccount || isConfinedDeployment()) return { ok: false };
  try {
    if (form.get("confirmed") !== "yes") return { ok: false };
    const file = form.get("file"); if (!(file instanceof File) || !file.size || file.size > MAX_RETURN_FILE_BYTES) return { ok: false };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const raw = JSON.parse(String(form.get("adapter")));
    const adapter = adapterSchema.parse({ ...raw, mode: "verified_upload", specimenSha256: hashBytes(bytes), verifiedOn: schoolToday() });
    const headers = inspectReturnSpecimen(bytes, file.name, adapter.format, adapter.sheetName);
    if (JSON.stringify(headers) !== JSON.stringify(adapter.columns.map((column) => column.header))) return { ok: false };
    await storeOfficeArtifact(`adapters/${hashBytes(bytes)}/specimen.${adapter.format}`, bytes, adapter.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const { error } = await createAdminClient().rpc("school_return_save_adapter", { p_actor: staff.id, p_adapter: adapter, p_expected_version: adapter.version - 1, p_confined: isConfinedDeployment() });
    if (error) return { ok: false };
    revalidatePath("/school-office/returns"); return { ok: true };
  } catch { return { ok: false }; }
}
