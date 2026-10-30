import "server-only";

import { cookies } from "next/headers";

import {
  isTestAcademicSessionLabel,
  parseAcademicSessionLabel,
} from "@/platform/config/fee-rules";
import { currentSessionViewer } from "@/platform/auth/test-session-access";
import {
  canAccessSession,
  canSwitchSessions,
  defaultSessionFor,
  type SessionViewer,
} from "@/platform/auth/test-session-policy";
import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { VIEW_SESSION_COOKIE_NAME } from "@/modules/fees/platform/session-context/cookie";

export type ResolvedViewSession = {
  sessionLabel: string;
  source: "url" | "cookie" | "default";
  isTest: boolean;
  isProduction: boolean;
  isEditable: boolean;
  isCollectable: boolean;
};

/**
 * A search param is `string | string[]`, and this used to assume `string`.
 *
 * `?session=A&session=B` — or the same value twice, which is what a re-shared
 * link produces — makes Next hand the page an array, and `(value ?? "").trim()`
 * threw `trim is not a function` straight out of a Server Component. In
 * production that renders as a blank error page with the message redacted, so
 * the Dashboard and Transactions both went down for a URL shape a staff member
 * can produce by copying a link twice (SCHOOLFEES-D, SCHOOLFEES-F).
 *
 * Taking the first value matches every other switcher in the app —
 * `resolveDashboardView` and `resolveOfficeWorkbookView` both read `value[0]`.
 * Fixed here rather than at the 25 call sites so a new page cannot reintroduce
 * it by forgetting to unwrap.
 */
function firstValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? (value[0] ?? null) : null;
  return value ?? null;
}

function normalizeValidSessionLabel(value: string | string[] | null | undefined) {
  const label = (firstValue(value) ?? "").trim();

  if (!label) {
    return null;
  }

  try {
    return parseAcademicSessionLabel(label).normalizedLabel;
  } catch {
    return null;
  }
}

function buildResolvedSession(
  sessionLabel: string,
  source: ResolvedViewSession["source"],
): ResolvedViewSession {
  const isTest = isTestAcademicSessionLabel(sessionLabel);

  return {
    sessionLabel,
    source,
    isTest,
    isProduction: !isTest,
    isEditable: true,
    isCollectable: true,
  };
}

/**
 * Drop a cookie naming a session this viewer may not open. Only a Server
 * Action or a Route Handler may change cookies; a Server Component (the
 * common caller) throws, and there the label is merely ignored — the pill's
 * own sync replaces the cookie on the next switch.
 */
async function forgetForbiddenCookie() {
  try {
    (await cookies()).delete(VIEW_SESSION_COOKIE_NAME);
  } catch {
    // Rendering: cookies are read-only here. Ignoring the label is enough.
  }
}

/**
 * Which session this request shows.
 *
 * `?session=` wins over the cookie, the cookie over the default — the fees
 * app's order — but only among sessions the viewer may open (Phase 3, D-340;
 * plan §3.4 point 3). A forbidden URL or cookie label (a real member of staff
 * handed `?session=TEST-2026-27`, or a test account with a 2026-27 cookie
 * left from before it was marked) falls back to the viewer's default and the
 * cookie is deleted where that is allowed. A test account's default is
 * TEST-2026-27; everybody else's is the active session. A viewer who may not
 * switch at all (a teacher) always gets the default.
 *
 * `viewer` is for callers that already hold the person (and for tests); by
 * default it is the signed-in staff member.
 */
export async function resolveViewSession({
  searchParamSession,
  cookieSession,
  viewer,
}: {
  /** Accepts the raw search param, array form included — see firstValue above. */
  searchParamSession?: string | string[] | null;
  cookieSession?: string | null;
  viewer?: (SessionViewer & { feeReader: boolean }) | null;
}): Promise<ResolvedViewSession> {
  const who =
    (viewer === undefined ? await currentSessionViewer().catch(() => null) : viewer) ??
    { role: "view_only" as const, isTestAccount: false, feeReader: false };
  const mayChoose = canSwitchSessions(who);

  const urlSession = mayChoose ? normalizeValidSessionLabel(searchParamSession) : null;
  if (urlSession && canAccessSession(who, urlSession)) {
    return buildResolvedSession(urlSession, "url");
  }

  const storedSession = normalizeValidSessionLabel(cookieSession);
  if (storedSession && mayChoose && canAccessSession(who, storedSession)) {
    return buildResolvedSession(storedSession, "cookie");
  }
  if (storedSession && !canAccessSession(who, storedSession)) {
    await forgetForbiddenCookie();
  }

  const activeSessionLabel = await getActiveSessionLabel();
  const policySession =
    normalizeValidSessionLabel(activeSessionLabel) ?? activeSessionLabel;

  return buildResolvedSession(defaultSessionFor(who, policySession), "default");
}
