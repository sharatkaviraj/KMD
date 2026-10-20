"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { createRun, endRun, revokePass, setFindingStatus, type CreatedRun } from "@/modules/smoke/data/smoke-repo";
import { FINDING_STATUSES } from "@/modules/smoke/domain/smoke";
import { isSmokeEmail } from "@/modules/smoke/domain/pool";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Smoke Lab writes. Admin only, test database only, and never while an admin
 * is previewing another role. The run's passes are returned once, here, to
 * the admin who opened it, and are not stored anywhere readable.
 */

async function smokeAdmin(staff: CurrentStaff) {
  // A smoke account never runs the lab, or `smoke.admin` could issue itself
  // fresh passes and outlive its run.
  if (staff.role !== "admin" || staff.smokeLab || isSmokeEmail(staff.email) || !smokeLabEnabled()) throw new Error("Not available.");
  await assertNotPreviewing();
  return staff;
}

const runSchema = z.object({
  title: z.string().trim().min(3).max(120),
  scenario: z.enum(["school_day", "free_explore"]),
  schoolDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  clockStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  hours: z.number().int().min(1).max(24),
  seats: z.array(z.object({ email: z.string().email(), persona: z.string().trim().max(120).nullable() })).min(1).max(30),
});

export type OpenRunResult = { ok: true; run: CreatedRun } | { ok: false; error: string };

export async function openSmokeRunAction(input: z.input<typeof runSchema>): Promise<OpenRunResult> {
  const staff = await smokeAdmin(await assertStaff());
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the title, hours and chosen accounts." };
  try {
    const run = await createRun({ ...parsed.data, createdBy: staff.id });
    revalidatePath("/smoke");
    return { ok: true, run };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not open the run." };
  }
}

export async function endSmokeRunAction(runId: string, how: "closed" | "revoked"): Promise<{ ok: boolean }> {
  const staff = await smokeAdmin(await assertStaff());
  if (!z.uuid().safeParse(runId).success || (how !== "closed" && how !== "revoked")) return { ok: false };
  const ok = await endRun(runId, how, staff.id);
  revalidatePath("/smoke");
  return { ok };
}

export async function revokeSmokePassAction(passId: string): Promise<{ ok: boolean }> {
  await smokeAdmin(await assertStaff());
  if (!z.uuid().safeParse(passId).success) return { ok: false };
  const ok = await revokePass(passId);
  revalidatePath("/smoke");
  return { ok };
}

export async function setSmokeFindingStatusAction(findingId: string, status: string, note: string | null): Promise<{ ok: boolean }> {
  const staff = await smokeAdmin(await assertStaff());
  const parsed = z.object({ id: z.uuid(), status: z.enum(FINDING_STATUSES), note: z.string().trim().max(1000).nullable() }).safeParse({ id: findingId, status, note });
  if (!parsed.success) return { ok: false };
  const ok = await setFindingStatus(parsed.data.id, parsed.data.status, parsed.data.note || null, staff.id);
  revalidatePath("/smoke");
  return { ok };
}
