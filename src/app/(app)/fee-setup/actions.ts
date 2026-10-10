"use server";

import { revalidatePath } from "next/cache";

import { saveWorkbookFeeSetupAction } from "@/app/(app)/fees/fee-setup/actions";
import type { FeeSetupActionState } from "@/modules/fees/domain/types";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

/**
 * Review and publish from the redesigned Fee setup. Admin only (`fees:manage`)
 * here, then the existing fee-setup action does exactly what it did before —
 * its own `fees:write` check, the impact preview batch, apply, discount
 * policies, dues sync and cache busts.
 */
export async function publishFeeSetupAction(previous: FeeSetupActionState, formData: FormData): Promise<FeeSetupActionState> {
  try {
    await assertPermission("fees:manage");
    await assertNotPreviewing();
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Not allowed.", changeBatchId: null, preview: null };
  }
  const intent = String(formData.get("_intent") ?? "");
  if (intent !== "preview" && intent !== "apply") {
    return { status: "error", message: "Review the changes before publishing.", changeBatchId: null, preview: null };
  }
  const result = await saveWorkbookFeeSetupAction(previous, formData);
  if (result.status === "success") revalidatePath("/fee-setup");
  return result;
}

/** The accountant reads Fee setup; to change a fee they ask the admin. */
export async function askAdminFeeChangeAction(input: { what: string; why: string }): Promise<{ ok: boolean; message: string }> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    const what = input.what.trim().slice(0, 180);
    const why = input.why.trim().slice(0, 1000);
    if (what.length < 3) throw new Error("Say which fee should change.");
    if (why.length < 3) throw new Error("Say why.");
    const db = createAdminClient();
    const { error } = await db.from("acc_requests").insert({ kind: "fee_change", title: what, reason: why, requested_by: staff.id });
    if (error) throw new Error(error.message);
    revalidatePath("/accounts");
    revalidatePath("/accounts/books");
    return { ok: true, message: "Sent to the admin · see it in My requests" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not send." };
  }
}
