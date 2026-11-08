import "server-only";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { loadFamilyBook } from "@/modules/students-fees/vx/families";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { getBridgeFamilies } from "@/platform/fees-bridge/client";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";

import type { FamiliesData } from "./logic";

/*
 * What /families and /families/[groupId] draw (owner, 8 Nov 2026). Real staff
 * on a real year read Fees itself through the bridge, like Dues & calls; test
 * accounts and TEST years read One's copy, in the same shape. When Fees does
 * not answer for a live read the page says so, and never draws One's copy in
 * its place.
 */

type Search = Record<string, string | string[] | undefined>;

export class FamiliesFeesUnavailable extends Error {
  constructor(readonly sessionLabel: string) {
    super("Fees could not be read for Families.");
  }
}

export function familiesReadFees(staff: CurrentStaff, sessionLabel: string): boolean {
  return /^\d{4}-\d{2}$/.test(sessionLabel) && usesCanonicalFees(staff, sessionLabel);
}

export async function loadFamilies(staff: CurrentStaff, search: Search, groupId: string | null = null): Promise<FamiliesData> {
  const viewSession = await resolveViewSession({ searchParamSession: search.session ?? null, cookieSession: await getViewSessionCookie() });
  const sessionLabel = viewSession.sessionLabel;
  const live = familiesReadFees(staff, sessionLabel);
  const read = live
    ? await getBridgeFamilies(sessionLabel, groupId).then(
        (r) => ({ families: r.families, asOf: r.asOf as string | null }),
        () => {
          throw new FamiliesFeesUnavailable(sessionLabel);
        },
      )
    : { families: await loadFamilyBook(sessionLabel, groupId), asOf: null };
  return {
    sessionLabel,
    asOf: read.asOf,
    test: isTestSessionLabel(sessionLabel),
    families: read.families,
    canCollect: can(staff, "fees:collect"),
    canOpenChildren: can(staff, "students:view"),
    canChange: !live && can(staff, "fees:manage"),
  };
}
