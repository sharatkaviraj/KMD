"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import { issueCertificate } from "@/modules/certificates/data/issue";
import { certificateForViewer } from "@/modules/certificates/data/repo";
import { IDENTITY_KEY } from "@/modules/certificates/data/identity";
import { certificateKinds, templateSchema } from "@/modules/certificates/domain/certificate";
import { certificateIdentitySchema, cleanIdentity, stampIdentity } from "@/modules/certificates/domain/identity";

export async function generateCertificateAction(input: unknown) {
  await assertPermission("certificates:issue");
  await assertNotPreviewing();
  try {
    const result = await issueCertificate(input);
    if (result.ok) revalidatePath("/school-office");
    return result;
  } catch { return { ok: false as const, code: "unavailable" as const }; }
}

/** Kept so an open tab from before the second pass keeps working. */
export async function generateStudyCertificateAction(input: unknown) {
  await assertPermission("certificates:issue");
  await assertNotPreviewing();
  return generateCertificateAction(input);
}

const eventSchema = z.object({ issueId: z.uuid(), kind: z.enum(["handed_over", "cancelled", "download_requested", "print_requested"]), reason: z.string().trim().max(500).optional(), commandId: z.uuid() }).strict();

async function recordEvent(value: z.infer<typeof eventSchema>) {
  const staff = await assertPermission(value.kind === "cancelled" ? "certificates:manage" : value.kind === "handed_over" ? "certificates:issue" : "certificates:view");
  const issue = await certificateForViewer(value.issueId);
  if (!issue) return false;
  await assertSessionWritable(staff, issue.session_label);
  const { error } = await createAdminClient().rpc("school_certificate_event", { p_actor: staff.id, p_issue: issue.id, p_kind: value.kind, p_reason: value.reason ?? null, p_command: value.commandId, p_confined: isConfinedDeployment() });
  return !error;
}

export async function certificateEventAction(input: unknown) {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  await assertPermission(parsed.data.kind === "cancelled" ? "certificates:manage" : parsed.data.kind === "handed_over" ? "certificates:issue" : "certificates:view");
  await assertNotPreviewing();
  try {
    if (!(await recordEvent(parsed.data))) return { ok: false };
    revalidatePath("/school-office");
    revalidatePath(`/school-office/certificates/${parsed.data.issueId}`);
    return { ok: true };
  } catch { return { ok: false }; }
}

/**
 * The signing tray: one handover per document, each its own idempotent event,
 * so a retry after a dropped response never records anything twice.
 */
export async function handOverManyAction(input: unknown) {
  const parsed = z.object({ items: z.array(z.object({ issueId: z.uuid(), commandId: z.uuid() })).min(1).max(60), collectedBy: z.string().trim().min(2).max(60) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, done: [] as string[] };
  await assertPermission("certificates:issue");
  await assertNotPreviewing();
  const done: string[] = [];
  for (const item of parsed.data.items) {
    try {
      if (await recordEvent({ issueId: item.issueId, kind: "handed_over", reason: `Collected by: ${parsed.data.collectedBy}`, commandId: item.commandId })) done.push(item.issueId);
    } catch { /* reported as not done; the tray keeps it */ }
  }
  revalidatePath("/school-office");
  return { ok: done.length === parsed.data.items.length, done };
}

export async function saveCertificateTemplateAction(input: unknown) {
  const staff = await assertPermission("certificates:manage");
  await assertNotPreviewing();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success || staff.isTestAccount || isConfinedDeployment()) return { ok: false };
  const kind = parsed.data.kind ?? "study";
  if (!(certificateKinds as readonly string[]).includes(kind)) return { ok: false };
  const { data, error } = await createAdminClient().rpc("school_certificate_save_template_v2", { p_actor: staff.id, p_kind: kind, p_template: { ...parsed.data, kind }, p_expected_version: parsed.data.version, p_confined: isConfinedDeployment() });
  if (error) return { ok: false };
  revalidatePath("/school-office");
  revalidatePath("/school-office/template");
  return { ok: true, version: data as number, receipt: randomUUID() };
}

export async function saveCertificateIdentityAction(input: unknown) {
  const staff = await assertPermission("certificates:manage");
  await assertNotPreviewing();
  const parsed = certificateIdentitySchema.safeParse(input);
  if (!parsed.success || staff.isTestAccount || isConfinedDeployment()) return { ok: false };
  const admin = createAdminClient();
  const { data: row, error: readError } = await admin.from("school_settings").select("value").eq("key", IDENTITY_KEY).maybeSingle<{ value: unknown }>();
  if (readError) return { ok: false };
  const before = cleanIdentity(row?.value);
  const after = stampIdentity(before, parsed.data, staff.id, new Date().toISOString());
  const { error } = await admin.from("school_settings").upsert({ key: IDENTITY_KEY, value: after, updated_by: staff.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false };
  await admin.from("school_settings_history").insert({ key: IDENTITY_KEY, before: row ? before : null, after, changed_by: staff.id });
  revalidatePath("/school-office");
  revalidatePath("/school-office/template");
  return { ok: true };
}
