"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { mayChangeBuiltinAiLimit, setBuiltinAiDailyLimit } from "@/lib/ai/admin";
import { builtinAiPilot } from "@/lib/ai/config";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";

export async function changeBuiltinAiLimit(form: FormData) {
  const staff = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (!mayChangeBuiltinAiLimit(staff) || !builtinAiPilot()) return;
  const limit = form.get("limit");
  const ok = typeof limit === "string" && /^\d{1,3}$/.test(limit)
    && await setBuiltinAiDailyLimit(staff.id, Number(limit)).catch(() => false);
  if (ok) revalidatePath("/settings/builtin-ai");
  redirect("/settings/builtin-ai?result=" + (ok ? "saved" : "failed"));
}
