"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import { issueStudyCertificate } from "@/modules/certificates/data/issue";
import { certificateForViewer } from "@/modules/certificates/data/repo";
import { templateSchema } from "@/modules/certificates/domain/certificate";

export async function generateStudyCertificateAction(input: unknown) {
  await assertPermission("certificates:issue");
  await assertNotPreviewing();
  try {
    const result = await issueStudyCertificate(input);
    if (result.ok) revalidatePath("/school-office");
    return result;
  } catch { return { ok: false as const, code: "unavailable" as const }; }
}

export async function certificateEventAction(input: unknown) {
  const parsed = z.object({ issueId: z.uuid(), kind: z.enum(["handed_over", "cancelled", "download_requested", "print_requested"]), reason: z.string().trim().max(500).optional(), commandId: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false };
  const value = parsed.data;
  const staff = await assertPermission(value.kind === "cancelled" ? "certificates:manage" : value.kind === "handed_over" ? "certificates:issue" : "certificates:view");
  await assertNotPreviewing();
  try {
    const issue = await certificateForViewer(value.issueId);
    if (!issue) return { ok: false };
    await assertSessionWritable(staff, issue.session_label);
    const { error } = await createAdminClient().rpc("school_certificate_event", { p_actor: staff.id, p_issue: issue.id, p_kind: value.kind, p_reason: value.reason ?? null, p_command: value.commandId, p_confined: isConfinedDeployment() });
    if (error) return { ok: false };
    revalidatePath("/school-office");
    revalidatePath(`/school-office/certificates/${issue.id}`);
    return { ok: true };
  } catch { return { ok: false }; }
}

export async function saveCertificateTemplateAction(input: unknown) {
  const staff = await assertPermission("certificates:manage");
  await assertNotPreviewing();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success || staff.isTestAccount || isConfinedDeployment()) return { ok: false };
  const { data, error } = await createAdminClient().rpc("school_certificate_save_template", { p_actor: staff.id, p_template: parsed.data, p_expected_version: parsed.data.version, p_confined: isConfinedDeployment() });
  if (error) return { ok: false };
  revalidatePath("/school-office");
  return { ok: true, version: data as number, receipt: randomUUID() };
}
