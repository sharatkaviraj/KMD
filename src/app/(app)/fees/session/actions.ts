"use server";

import { revalidateTag } from "next/cache";

import { parseAcademicSessionLabel } from "@/platform/config/fee-rules";
import type { AvailableSessionRow } from "@/modules/fees/platform/session-context/available-sessions";
import { setViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import { assertStaff } from "@/platform/auth/current-staff";
import { currentSessionViewer } from "@/platform/auth/test-session-access";
import { canAccessSession, canSwitchSessions } from "@/platform/auth/test-session-policy";

export async function listAvailableSessionsAction(): Promise<AvailableSessionRow[]> {
  // Any staff member with the pill, not only fee readers: the two
  // coordinators switch sessions too (plan §3.3). Who may switch, and to what,
  // is decided below and in getSessionSwitcherData.
  await assertStaff();

  // Filtered for the signed-in viewer inside getSessionSwitcherData.
  return (await getSessionSwitcherData()).availableSessions;
}

export async function setViewSessionAction(label: string) {
  // Any staff member with the pill, not only fee readers: the two
  // coordinators switch sessions too (plan §3.3). Who may switch, and to what,
  // is decided below and in getSessionSwitcherData.
  await assertStaff();
  const sessionLabel = parseAcademicSessionLabel(label).normalizedLabel;

  // Only a session this person may open, and only if they may switch at all
  // (Phase 3, plan §3.4 point 2). A refusal leaves the cookie as it was; the
  // pill reports `success: false` as "could not switch".
  const viewer = await currentSessionViewer();
  if (!viewer || !canSwitchSessions(viewer) || !canAccessSession(viewer, sessionLabel)) {
    return {
      success: false,
      sessionLabel,
    };
  }

  await setViewSessionCookie(sessionLabel);

  // Keep session switches scoped to the session being switched TO. A full
  // protected path bust makes every office page cold at once.
  //
  // The session being left used to be busted here as well. Nothing about its
  // data changed by walking away from it, and throwing its cache away made
  // switching back cost exactly as much as switching away — the round trip a
  // clerk comparing two years makes constantly.
  revalidateTag(`session:${sessionLabel}`, "max");

  // getSessionSwitcherData() is deliberately NOT awaited here. It only
  // refreshes dropdown rows the client already holds as `initialSessions`, and
  // on a cold instance it is two sequential 1,200ms Promise.race timeouts —
  // up to ~2.4s of the clerk's wait, spent after the cookie is already
  // written. The pill refreshes its own list via listAvailableSessionsAction.
  return {
    success: true,
    sessionLabel,
  };
}
