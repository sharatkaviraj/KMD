"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { rebuildEnrolments } from "@/modules/enrolments/data/enrolments-repo";

/**
 * Build or rebuild the academic record from the fee app.
 *
 * Deliberately something somebody presses rather than something that happens
 * on a schedule: it resolves differences by taking the fee app's word for
 * them, and the office should be the one deciding that is what they want
 * today. A child moved between classes yesterday is a different decision from
 * a child moved by mistake.
 */
export async function rebuildEnrolmentsAction() {
  const actor = await assertPermission("academics:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return;

  await rebuildEnrolments(sessionLabel, actor.userId);
  revalidatePath("/enrolments");
}
