import { redirect } from "next/navigation";

import { requirePermission } from "@/platform/auth/current-staff";

export const runtime = "nodejs";
export const metadata = { title: "AI helper" };

/**
 * The old Built-in AI page. Its usage, keys and daily limit are now part of
 * the one AI page (D-501): Settings → AI helper → Cost and Switches. Kept as
 * a redirect so a saved link still lands somewhere useful.
 */
export default async function BuiltinAiSettings() {
  await requirePermission("settings:manage", "/settings/builtin-ai");
  redirect("/settings?s=ai&v=cost");
}
