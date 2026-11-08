import { parseAcademicSessionLabel } from "@/platform/config/fee-rules";
import type { StaffRole } from "@/platform/auth/permissions";

/**
 * Who may see — and write — which academic session (Phase 3, D-340;
 * critique0 #13, #14, #15). Pure: no database, no request. The server half,
 * which reads the signed-in person and the student's class, is
 * `test-session-access.ts`; the SQL half is `vppsone.is_real_admin()` and the
 * `test_session_fence` policies (migration 20261030155339). All three say the
 * same thing:
 *
 *   A test account sees and writes only test sessions. Everybody else sees
 *   and writes only real ones. A REAL admin — role admin AND not a test
 *   account — sees and writes both.
 *
 * "Real admin" is the ROLE, not a permission, on both sides (critique0 #14):
 * the permission matrix is editable, and a predicate keyed on
 * `settings:manage` here and on role there would drift apart the first time
 * somebody granted an office account `settings:manage`.
 *
 * On a confined deployment (`isConfinedDeployment()`, every Preview and local
 * `next dev`) `readCurrentStaff` marks every user as a test account, so the
 * same functions fence an admin there too.
 */

/** The rehearsal session test accounts land in (the fees app's own, D-187). */
export const TEST_SESSION_LABEL = "TEST-2026-27";

export type SessionViewer = {
  role: StaffRole;
  /** `staff_profiles.is_test_account`, or true on a confined deployment. Absent = false. */
  isTestAccount?: boolean;
};

const TEST_PREFIXES = new Set(["TEST", "UAT", "DEMO"]);

/**
 * A rehearsal label (TEST-/UAT-/DEMO-YYYY-YY). Unlike
 * `isTestAcademicSessionLabel` this never throws: a malformed label is "not a
 * test session", the same as `vppsone.is_test_session_label`.
 */
export function isTestSessionLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  try {
    return TEST_PREFIXES.has(parseAcademicSessionLabel(label).prefix);
  } catch {
    return false;
  }
}

export function isRealAdmin(viewer: SessionViewer): boolean {
  return viewer.role === "admin" && viewer.isTestAccount !== true;
}

/** May this viewer see test sessions at all? */
export function canSeeTestSessions(viewer: SessionViewer): boolean {
  return isRealAdmin(viewer) || viewer.isTestAccount === true;
}

/**
 * May this viewer open — read or write — this session? One answer for both:
 * the fence is the same in USING and WITH CHECK. Whether the viewer may write
 * anything at all is the permission check's business, not this one's.
 */
export function canAccessSession(viewer: SessionViewer, label: string | null | undefined): boolean {
  if (isRealAdmin(viewer)) return true;
  return isTestSessionLabel(label) === (viewer.isTestAccount === true);
}

/**
 * Who a request is treated as when reading the signed-in person FAILED (not
 * "nobody signed in"): a test account with no permissions, so the fence fails
 * closed — TEST-2026-27, no real session listed or shown.
 */
export const UNREADABLE_VIEWER: SessionViewer & { feeReader: boolean } = Object.freeze({
  role: "view_only",
  isTestAccount: true,
  feeReader: false,
});

/**
 * Which staff accounts a session shows (owner, 8 Nov 2026: "the test accounts
 * and QA accounts should be in the test session only … the real live data
 * will only have the genuine accounts"). A test session lists test accounts
 * and nobody else; every real session lists real staff and nobody else —
 * whoever is looking, a real admin included. Staff lists, pickers, counts,
 * "who follows this up" and every fan-out ask this one question; the
 * database's half is `vppsone.staff_matches_session()` and the
 * `staff_session_match` triggers (migration 20261108170533).
 */
export function staffBelongsToSession(
  isTestAccount: boolean | null | undefined,
  sessionLabel: string | null | undefined,
): boolean {
  return (isTestAccount === true) === isTestSessionLabel(sessionLabel);
}

/**
 * Does this viewer, looking at this session, see test accounts in a staff
 * list? A test account always works in a test session (so yes); everybody
 * else only while the session they are looking at is a test one.
 */
export function listsTestStaff(viewer: SessionViewer, sessionLabel: string | null | undefined): boolean {
  return viewer.isTestAccount === true || isTestSessionLabel(sessionLabel);
}

/** The session a viewer lands on when they have not chosen one. */
export function defaultSessionFor(viewer: SessionViewer, activeSessionLabel: string): string {
  return viewer.isTestAccount === true ? TEST_SESSION_LABEL : activeSessionLabel;
}

/**
 * Who gets the session pill (plan §3.3, critique1 B14). Fee readers,
 * the two coordinators (they read every class), the admin and every test
 * account. A teacher stays on the active session — or, as a test account, on
 * TEST-2026-27 — with no pill.
 */
export function canSwitchSessions(viewer: SessionViewer & { feeReader: boolean }): boolean {
  if (viewer.isTestAccount === true) return true;
  if (viewer.feeReader) return true;
  return viewer.role === "admin" || viewer.role === "academic_coordinator" || viewer.role === "exam_coordinator";
}

type SessionRow = { session_label: string };

function startYearOf(label: string): number | null {
  try {
    return parseAcademicSessionLabel(label).startYear;
  } catch {
    return null;
  }
}

/**
 * The switcher's list for one viewer: sessions they may open, and a coming
 * year (2027-28) only for fee readers, as in the fees app — the office sets up
 * next year's fees before anybody teaches in it.
 */
export function filterSessionsForViewer<T extends SessionRow>(
  rows: readonly T[],
  viewer: SessionViewer & { feeReader: boolean },
  activeSessionLabel: string,
): T[] {
  const activeYear = startYearOf(activeSessionLabel);
  return rows.filter((row) => {
    if (!canAccessSession(viewer, row.session_label)) return false;
    if (viewer.feeReader || activeYear === null) return true;
    const year = startYearOf(row.session_label);
    return year === null || year <= activeYear;
  });
}

/**
 * The session a request resolves to, given what it asked for. A label the
 * viewer may not open is ignored (never an error page: a stale cookie or a
 * shared link must land somewhere), and `forbidden` says so, so the caller
 * can drop the cookie.
 */
export function chooseVisibleSession({
  viewer,
  requested,
  activeSessionLabel,
}: {
  viewer: SessionViewer;
  requested: string | null | undefined;
  activeSessionLabel: string;
}): { sessionLabel: string; forbidden: boolean } {
  const wanted = requested?.trim() || null;
  if (wanted && canAccessSession(viewer, wanted)) return { sessionLabel: wanted, forbidden: false };
  return { sessionLabel: defaultSessionFor(viewer, activeSessionLabel), forbidden: Boolean(wanted) };
}

/** The error every refusal throws, so a route can turn it into a 404/403. */
export class SessionAccessDenied extends Error {
  readonly code = "session_access_denied";
  constructor(message = "This record belongs to a session you cannot open.") {
    super(message);
    this.name = "SessionAccessDenied";
  }
}

export function isSessionAccessDenied(error: unknown): error is SessionAccessDenied {
  return error instanceof SessionAccessDenied || (error as { code?: unknown } | null)?.code === "session_access_denied";
}
