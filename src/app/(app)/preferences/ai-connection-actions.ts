"use server";

import { revalidatePath } from "next/cache";

import { assertStaff } from "@/platform/auth/current-staff";
import { aiConnectionOwner, revokeAiConnection } from "@/modules/mcp/data/connections";
import { assertNotPreviewing } from "@/vx/view-as";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Disconnect one of your own AI connections (owner decision D9: users may
 * disconnect their own). The id comes from the form, so it is checked to be
 * the signed-in person's before anything is ended; another person's id does
 * nothing.
 */
export async function disconnectMyAiConnectionAction(formData: FormData): Promise<void> {
  const staff = await assertStaff();
  await assertNotPreviewing();
  const connectionId = String(formData.get("connectionId") ?? "");
  if (!UUID.test(connectionId)) return;
  if ((await aiConnectionOwner(connectionId)) !== staff.id) return;
  await revokeAiConnection(connectionId, "disconnected_by_self", staff.id);
  revalidatePath("/preferences");
}
