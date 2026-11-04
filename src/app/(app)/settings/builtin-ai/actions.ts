"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { checkBuiltinAiKeys, mayChangeBuiltinAiLimit, mayCheckBuiltinAiKeys, setBuiltinAiDailyLimit } from "@/lib/ai/admin";
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

/** Settings → Built-in AI → Check keys: one tiny request per key and model, on the server. */
export async function checkBuiltinAiKeysAction() {
  const staff = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (!mayCheckBuiltinAiKeys(staff)) return;
  const ok = await checkBuiltinAiKeys(staff.id).then(() => true, () => false);
  revalidatePath("/settings/builtin-ai");
  redirect("/settings/builtin-ai?keys=" + (ok ? "checked" : "failed"));
}
