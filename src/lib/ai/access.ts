import "server-only";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { canAccessSession, isTestSessionLabel } from "@/platform/auth/test-session-policy";

import { builtinAiMode, builtinAiPilot } from "@/lib/ai/config";

/**
 * The session a built-in AI action works in, or null when this person may not
 * use built-in AI here. It is the session the person is already working in
 * (`resolveSessionLabel`), so a teacher's photo or voice command reads and
 * writes the same registers, papers and cover days as the screen it came from.
 * In `test` mode only TEST sessions qualify. Callers check that a provider is
 * configured (`builtinAiPilot`) and each action checks its own permission.
 */
export async function builtinAiSession(staff: CurrentStaff): Promise<string | null> {
  const mode = builtinAiMode();
  if (mode === "off") return null;
  const session = await resolveSessionLabel();
  if (!session) return null;
  if (mode === "test" && !isTestSessionLabel(session)) return null;
  return canAccessSession({ role: staff.role, isTestAccount: staff.isTestAccount === true }, session) ? session : null;
}

/** May this person use the substitution photo, given the page's own resolved session? */
export function coverPhotoEnabled(staff: CurrentStaff, session: string | null) {
  const mode = builtinAiMode();
  return Boolean(session && mode !== "off" && builtinAiPilot() && can(staff, "substitutions:manage") &&
    (mode === "live" || isTestSessionLabel(session)) &&
    canAccessSession({ role: staff.role, isTestAccount: staff.isTestAccount === true }, session));
}
