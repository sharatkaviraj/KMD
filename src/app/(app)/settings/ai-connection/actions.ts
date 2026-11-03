"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotTestAccount } from "@/platform/auth/test-session-access";
import { aiConnectionOwner, revokeAiConnection, setAiConnectionSwitch } from "@/modules/mcp/data/connections";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Settings → AI assistant connection: the school's switch and Disconnect for
 * any connection (owner decision D9). Every action: `settings:manage`, an
 * admin by role, not previewing another role, and never a test account —
 * the switch and other people's connections are the whole school's, and on a
 * Preview or local build (every account a test account) they are production's.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function assertSchoolAdmin() {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (actor.role !== "admin") throw new Error("Permission denied: admin");
  await assertNotTestAccount(actor);
  return actor;
}

export async function setAiConnectionSwitchAction(formData: FormData): Promise<void> {
  const actor = await assertSchoolAdmin();
  const value = String(formData.get("enabled") ?? "");
  if (value !== "true" && value !== "false") return;
  await setAiConnectionSwitch(value === "true", actor.id);
  revalidatePath("/settings/ai-connection");
}

export async function disconnectAiConnectionAction(formData: FormData): Promise<void> {
  const actor = await assertSchoolAdmin();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!UUID.test(connectionId)) return;
  const owner = await aiConnectionOwner(connectionId);
  if (!owner) return;
  await revokeAiConnection(connectionId, owner === actor.id ? "disconnected_by_self" : "disconnected_by_admin", actor.id);
  revalidatePath("/settings/ai-connection");
  revalidatePath("/preferences");
}
