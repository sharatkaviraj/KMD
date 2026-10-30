import "server-only";

import {
  FALLBACK_OFFICE_SESSION_LABEL,
  mergeRequiredOfficeSessions,
  type AvailableSessionRow,
} from "@/modules/fees/platform/session-context/available-sessions";
import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { createClient } from "@/modules/fees/platform/supabase/server";
import { currentSessionViewer } from "@/platform/auth/test-session-access";
import { filterSessionsForViewer, UNREADABLE_VIEWER, type SessionViewer } from "@/platform/auth/test-session-policy";

export type SessionSwitcherData = {
  activeSessionLabel: string;
  availableSessions: AvailableSessionRow[];
};

const SESSION_SWITCHER_TIMEOUT_MS = 1200;
const SESSION_SWITCHER_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSessionSwitcherData:
  | {
      expiresAt: number;
      data: SessionSwitcherData;
    }
  | null = null;

/**
 * Drop the in-process switcher cache.
 *
 * The cache holds `activeSessionLabel` and the per-row `is_current` flags for
 * five minutes, in module scope — so it survives every request that instance
 * serves. Changing the active session revalidates the `app-settings` Next tag,
 * but that does nothing to this, and for up to five minutes afterwards the
 * switcher would keep showing the OLD session as live to everyone on that
 * instance. `setActiveSession` calls this so the two invalidations stay in step.
 */
export function clearSessionSwitcherCache() {
  cachedSessionSwitcherData = null;
}

function timeoutAfter<T>(fallback: T, timeoutMs = SESSION_SWITCHER_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(fallback), timeoutMs);
  });
}

/**
 * The sessions THIS viewer may switch to (Phase 3, D-340; critique1 B14).
 *
 * The cache below holds every session, for everybody — it is module scope and
 * outlives the request, so it must never hold one person's view. The filter
 * runs after it, per call: a real member of staff is never offered
 * TEST-2026-27, a test account is offered nothing else, and a coming year
 * (2027-28) only to fee readers. `viewer` is for the admin's "see the app as"
 * preview, which lists the previewed role's sessions; by default it is the
 * signed-in person, and nobody signed in gets the real sessions only.
 */
export async function getSessionSwitcherData(
  viewer?: (SessionViewer & { feeReader: boolean }) | null,
): Promise<SessionSwitcherData> {
  const [all, who] = await Promise.all([
    getUnfilteredSessionSwitcherData(),
    // Unreadable fails closed (TEST only), as in resolveViewSession.
    viewer === undefined ? currentSessionViewer().catch(() => UNREADABLE_VIEWER) : Promise.resolve(viewer),
  ]);
  const forViewer = who ?? { role: "view_only" as const, isTestAccount: false, feeReader: false };
  return {
    activeSessionLabel: all.activeSessionLabel,
    availableSessions: filterSessionsForViewer(all.availableSessions, forViewer, all.activeSessionLabel),
  };
}

async function getUnfilteredSessionSwitcherData(): Promise<SessionSwitcherData> {
  const now = Date.now();

  if (cachedSessionSwitcherData && cachedSessionSwitcherData.expiresAt > now) {
    return cachedSessionSwitcherData.data;
  }

  const fallbackActiveSessionLabel = FALLBACK_OFFICE_SESSION_LABEL;
  const activeSessionLabel = await Promise.race([
    getActiveSessionLabel().catch(() => fallbackActiveSessionLabel),
    timeoutAfter(fallbackActiveSessionLabel),
  ]);

  let rows: Omit<AvailableSessionRow, "is_current">[] = [];

  try {
    const supabase = await createClient();
    const response = await Promise.race([
      supabase
        .from("academic_sessions")
        .select("id, session_label, status")
        .order("session_label", { ascending: false }),
      timeoutAfter(null),
    ] as const);

    if (response?.error) {
      rows = [];
    } else {
      rows = (response?.data ?? []) as Omit<AvailableSessionRow, "is_current">[];
    }
  } catch {
    rows = [];
  }

  const data =
    rows.length === 0
      ? {
          activeSessionLabel,
          availableSessions: mergeRequiredOfficeSessions([], activeSessionLabel),
        }
      : {
          activeSessionLabel,
          availableSessions: mergeRequiredOfficeSessions(rows, activeSessionLabel),
        };

  cachedSessionSwitcherData = {
    expiresAt: now + SESSION_SWITCHER_CACHE_TTL_MS,
    data,
  };

  return data;
}
