import "server-only";

import { notFound } from "next/navigation";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { FEE_SCHEMA } from "@/platform/env";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";

import {
  canAccessSession,
  canSeeTestSessions as canSeeTestSessionsFor,
  defaultSessionFor,
  isRealAdmin,
  isSessionAccessDenied,
  SessionAccessDenied,
  type SessionViewer,
} from "./test-session-policy";

/**
 * The app half of the test-session fence (Phase 3, plan §3.4 points 4–5;
 * critique0 #15, critique1 B10, C2). The rule lives in `test-session-policy.ts`;
 * this file applies it to the things a request names:
 *
 *  - a session label it wants to read or write (`assertSessionVisible`,
 *    `assertSessionWritable`) — every server action that takes a session label
 *    calls the second, and `tests/architecture.test.ts` holds them to it;
 *  - a student, receipt or family it names by id or number, which carries no
 *    session of its own (`assertStudentVisible` and friends): student → class →
 *    `classes.session_label`.
 *
 * Why the app has to do this at all: One's writes are service role (D-179),
 * which bypasses the `test_session_fence` policies, and the fee tables in
 * `public` keep the fees app's permission-only RLS while mirror mode runs.
 * So for everything the app reads with the admin client, this IS the fence.
 *
 * Every function takes the viewer explicitly or, given `null`, reads the
 * signed-in person (per-request cached). Nobody signed in is refused.
 */

type ViewerArg = SessionViewer | null | undefined;

async function viewerOf(staff: ViewerArg): Promise<SessionViewer> {
  if (staff) return staff;
  const current = await getCurrentStaff();
  if (!current) throw new SessionAccessDenied("Not signed in.");
  return current;
}

/** The signed-in person as a session viewer, or null when nobody is. */
export async function currentSessionViewer(): Promise<(SessionViewer & { feeReader: boolean }) | null> {
  const staff = await getCurrentStaff();
  return staff ? { role: staff.role, isTestAccount: staff.isTestAccount === true, feeReader: can(staff, "fees:view") } : null;
}

export async function canSeeTestSessions(staff: ViewerArg): Promise<boolean> {
  return canSeeTestSessionsFor(await viewerOf(staff));
}

/** Refuse a session this viewer may not read. */
export async function assertSessionVisible(staff: ViewerArg, sessionLabel: string | null | undefined): Promise<void> {
  const viewer = await viewerOf(staff);
  if (!canAccessSession(viewer, sessionLabel)) {
    throw new SessionAccessDenied(
      viewer.isTestAccount
        ? "A test account works in the test session only."
        : "That is the test session. Only a test account or an administrator can open it.",
    );
  }
}

/**
 * Refuse a write into a session this viewer may not write — the same fence as
 * reading (USING = WITH CHECK). Call it in every action that is handed a
 * session label, before anything is written, whatever the permission check
 * already said.
 */
export async function assertSessionWritable(
  staff: ViewerArg,
  sessionLabel: string | null | undefined,
  options: { orActive?: boolean } = {},
): Promise<void> {
  const named = typeof sessionLabel === "string" ? sessionLabel.trim() : "";
  if (named) return assertSessionVisible(staff, named);
  // Some writers take the session as optional and fall back to the school's
  // active session server-side. Then the active session is what gets
  // written, so that is what is checked — a test account is refused.
  if (options.orActive) return assertSessionVisible(staff, await readActiveSessionLabel());
  throw new SessionAccessDenied("No session was named for this change.");
}

/**
 * For a tool that only ever works on "the" session (bulk update, its
 * template): the active session for real staff, TEST-2026-27 for a test
 * account — the same default the session pill lands on — checked.
 */
export async function workingSessionFor(staff: ViewerArg, activeSessionLabel: string): Promise<string> {
  const viewer = await viewerOf(staff);
  const label = defaultSessionFor(viewer, activeSessionLabel);
  await assertSessionVisible(viewer, label);
  return label;
}

/** `app_settings.active_session_label` — what an unnamed write defaults to. Fail closed. */
async function readActiveSessionLabel(): Promise<string> {
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("app_settings")
    .select("value")
    .eq("key", "active_session_label")
    .maybeSingle<{ value: string | null }>();
  if (error || !data?.value) throw new SessionAccessDenied("Could not read the active session.");
  return data.value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StudentSessionRow = { id: string; class: { session_label: string | null } | null };

/** student id -> its class's session label (null: no class). Chunked (rule 3b). */
async function sessionsOfStudents(studentIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(studentIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, string | null>();
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_FILTER_CHUNK_SIZE);
    const { data, error } = await admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select("id, class:classes!students_class_id_fkey(session_label)")
      .in("id", chunk)
      .returns<StudentSessionRow[]>();
    // Fail closed: a read we could not make is not permission to show the row.
    if (error) throw new SessionAccessDenied("Could not check which session this student is in.");
    for (const row of data ?? []) out.set(row.id, row.class?.session_label ?? null);
  }
  return out;
}

/**
 * Refuse a student this viewer may not see: student → class → session. A
 * student that does not exist is not refused here — the page's own lookup
 * says "not found", which is the truthful answer.
 */
export async function assertStudentVisible(staff: ViewerArg, studentId: string): Promise<void> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer)) return;
  const sessions = await sessionsOfStudents([studentId]);
  if (!sessions.has(studentId)) return;
  await assertSessionVisible(viewer, sessions.get(studentId));
}

/** The ids, out of these, this viewer may see. Order kept. For search and lists. */
export async function filterVisibleStudentIds(staff: ViewerArg, studentIds: readonly string[]): Promise<string[]> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer)) return [...studentIds];
  const sessions = await sessionsOfStudents(studentIds);
  return studentIds.filter((id) => !sessions.has(id) || canAccessSession(viewer, sessions.get(id)));
}

/**
 * Refuse a test account outright. For writes that have no session of their
 * own and that the whole school shares — which session is live, transport
 * routes, fee heads, payment modes, real staff profiles. A test account
 * (and, on a confined deployment, everybody) may not make them.
 */
export async function assertNotTestAccount(staff: ViewerArg): Promise<void> {
  const viewer = await viewerOf(staff);
  if (viewer.isTestAccount === true) {
    throw new SessionAccessDenied("A test account cannot change what the whole school shares.");
  }
}

/** Every one of these students, or a refusal. For bulk and family actions. */
export async function assertStudentsVisible(staff: ViewerArg, studentIds: readonly string[]): Promise<void> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer)) return;
  const ids = [...new Set(studentIds)];
  const visible = await filterVisibleStudentIds(viewer, ids);
  if (visible.length !== ids.length) throw new SessionAccessDenied();
}

/** A class by id → its own `session_label`. A class that does not exist is not refused here. */
export async function assertClassVisible(staff: ViewerArg, classId: string): Promise<void> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer) || !UUID.test(classId)) return;
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("classes")
    .select("session_label")
    .eq("id", classId)
    .maybeSingle<{ session_label: string | null }>();
  if (error) throw new SessionAccessDenied("Could not check which session this class is in.");
  if (data) await assertSessionVisible(viewer, data.session_label);
}

/** A receipt by id or by number → its student → the student's session. */
export async function assertReceiptVisible(
  staff: ViewerArg,
  receipt: { id: string } | { receiptNumber: string },
): Promise<void> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer)) return;
  const query = createAdminClient().schema(FEE_SCHEMA).from("receipts").select("student_id");
  const { data, error } = await ("id" in receipt
    ? UUID.test(receipt.id)
      ? query.eq("id", receipt.id).maybeSingle<{ student_id: string | null }>()
      : Promise.resolve({ data: null, error: null })
    : query.eq("receipt_number", receipt.receiptNumber).maybeSingle<{ student_id: string | null }>());
  if (error) throw new SessionAccessDenied("Could not check which session this receipt is in.");
  if (data?.student_id) await assertStudentVisible(viewer, data.student_id);
}

/** A family is visible only if every child in it is (fail closed on a mixed family). */
export async function assertFamilyVisible(staff: ViewerArg, familyGroupId: string): Promise<void> {
  const viewer = await viewerOf(staff);
  if (isRealAdmin(viewer) || !UUID.test(familyGroupId)) return;
  const { data, error } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("student_family_members")
    .select("student_id")
    .eq("family_group_id", familyGroupId)
    .returns<{ student_id: string }[]>();
  if (error) throw new SessionAccessDenied("Could not check which session this family is in.");
  const ids = (data ?? []).map((row) => row.student_id);
  const visible = await filterVisibleStudentIds(viewer, ids);
  if (visible.length !== ids.length) throw new SessionAccessDenied();
}

/**
 * For a page: a record in a session the viewer cannot open is "not found" —
 * the same answer as a record that does not exist, so a test account cannot
 * tell a real child's id is valid by the error it gets.
 */
export async function notFoundUnlessVisible(check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (error) {
    if (isSessionAccessDenied(error)) notFound();
    throw error;
  }
}

/** For a route handler: 404 for a refusal, null when it may proceed. */
export async function refusalResponse(check: () => Promise<void>): Promise<Response | null> {
  try {
    await check();
    return null;
  } catch (error) {
    if (isSessionAccessDenied(error)) return new Response("Not found", { status: 404 });
    throw error;
  }
}

export { isSessionAccessDenied, SessionAccessDenied };
export type { SessionViewer };
