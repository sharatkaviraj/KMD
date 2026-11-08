import "server-only";

import { cache } from "react";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import {
  canAccessSession,
  canSwitchSessions,
  listsTestStaff,
} from "@/platform/auth/test-session-policy";

/**
 * Is the signed-in person looking at a test session right now — the question
 * every staff list asks before it decides whose names to show
 * (`staffBelongsToSession`, owner 8 Nov 2026)?
 *
 * The same inputs `resolveSessionLabel()` and `resolveViewSession()` read: a
 * test account (every account on a confined deployment) is always in a test
 * session; anybody else only when they may switch sessions and the session
 * pill's cookie names a test session they may open. A teacher has no pill and
 * is always in the school's real year. Per request; a read that fails answers
 * "the real year", which shows real staff only — the same as a teacher.
 */
export const viewingTestSession = cache(async (): Promise<boolean> => {
  const staff = await getCurrentStaff().catch(() => null);
  if (!staff) return false;
  if (staff.isTestAccount === true) return true;
  const viewer = { role: staff.role, isTestAccount: false, feeReader: can(staff, "fees:view") };
  if (!canSwitchSessions(viewer)) return false;
  const cookie = await getViewSessionCookie().catch(() => null);
  if (!cookie || !canAccessSession(viewer, cookie)) return false;
  return listsTestStaff(viewer, cookie);
});
