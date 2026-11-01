import "server-only";
import { createHash } from "node:crypto";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import type { StaffPermission } from "@/platform/auth/permissions";
import { createClient } from "@/platform/supabase/server";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { adapterSchema, type GovernmentAdapter, type GovernmentBatch, type ReturnStudent } from "../domain/exchange";

export const OFFICE_BUCKET = "vppsone-school-office";
export const hashBytes = (input: Uint8Array | string) => createHash("sha256").update(input).digest("hex");
export type AdapterRow = { id: string; adapter: GovernmentAdapter; version: number };
export type BatchEvent = { id: string; kind: string; detail: Record<string, unknown>; created_at: string };

export async function schoolOfficeRoster(sessionLabel: string, permission: StaffPermission = "government:view"): Promise<ReturnStudent[]> {
  const staff = await assertPermission(permission); await assertSessionVisible(staff, sessionLabel);
  const { data, error } = await createAdminClient().rpc("school_office_roster", { p_actor: staff.id, p_session: sessionLabel, p_permission: permission, p_confined: isConfinedDeployment() });
  if (error || !Array.isArray(data)) throw new Error("School roster unavailable");
  return data as ReturnStudent[];
}
export async function returnBatchForViewer(id: string): Promise<GovernmentBatch | null> {
  const staff = await assertPermission("government:view");
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const { data, error } = await (await createClient()).from("school_return_batches").select("*").eq("id", id).maybeSingle<GovernmentBatch>();
  if (error) throw new Error("Return batch unavailable");
  if (data) await assertSessionVisible(staff, data.session_label);
  return data;
}
export async function returnWorkspace(sessionLabel: string) {
  const staff = await assertPermission("government:view"); await assertSessionVisible(staff, sessionLabel);
  const db = await createClient();
  const [batches, adapters] = await Promise.all([
    db.from("school_return_batches").select("*").eq("session_label", sessionLabel).order("created_at", { ascending: false }).limit(50),
    db.from("school_return_adapters").select("id,adapter,version").eq("session_label", sessionLabel).order("version", { ascending: false }).limit(50),
  ]);
  if (batches.error || adapters.error) throw new Error("Return workspace unavailable");
  return { batches: (batches.data ?? []) as GovernmentBatch[], adapters: (adapters.data ?? []) as AdapterRow[] };
}
export async function adapterForViewer(id: string, sessionLabel: string): Promise<GovernmentAdapter> {
  const staff = await assertPermission("government:view"); await assertSessionVisible(staff, sessionLabel);
  const { data, error } = await (await createClient()).from("school_return_adapters").select("adapter").eq("id", id).eq("session_label", sessionLabel).single();
  if (error || !data) throw new Error("Verified adapter unavailable");
  return adapterSchema.parse(data.adapter);
}
export async function rosterForAdapter(sessionLabel: string, adapter: GovernmentAdapter, permission: StaffPermission): Promise<ReturnStudent[]> {
  const [roster, links] = await Promise.all([
    schoolOfficeRoster(sessionLabel, permission),
    (await createClient()).from("school_external_records").select("student_id,external_id,registration_status,revision").eq("session_label", sessionLabel).eq("portal", adapter.portal).eq("module", adapter.module).eq("school_code", adapter.schoolCode),
  ]);
  if (links.error) throw new Error("External identifiers unavailable");
  const byId = new Map((links.data ?? []).map((row) => [row.student_id, row]));
  return roster.map((row) => { const held = byId.get(row.studentId); return { ...row, schoolCode: adapter.schoolCode, externalId: held?.external_id ?? "", registrationStatus: held?.registration_status ?? "", externalRevision: held?.revision ?? 0 }; });
}
export async function returnEvents(batchId: string): Promise<BatchEvent[]> {
  if (!(await returnBatchForViewer(batchId))) return [];
  const { data, error } = await (await createClient()).from("school_return_events").select("id,kind,detail,created_at").eq("batch_id", batchId).order("created_at");
  if (error) throw new Error("Return history unavailable");
  return (data ?? []) as BatchEvent[];
}
export async function readOfficeArtifact(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(OFFICE_BUCKET).download(path);
  if (error) {
    if (/not.?found/i.test(error.message)) return null;
    throw new Error("School file storage unavailable");
  }
  return new Uint8Array(await data.arrayBuffer());
}
export async function storeOfficeArtifact(path: string, bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  const { error } = await createAdminClient().storage.from(OFFICE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "0" });
  if (!error) return bytes;
  const existing = await readOfficeArtifact(path);
  if (!existing || hashBytes(existing) !== hashBytes(bytes)) throw new Error("School file could not be stored immutably");
  return existing;
}
