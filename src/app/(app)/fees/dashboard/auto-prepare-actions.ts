"use server";

import { requireStaffPermission } from "@/modules/fees/platform/session";
import {
  prepareDuesForStudentsAutomatically,
  revalidateSessionFinance,
} from "@/modules/system-sync/domain/finance-sync";
import { assertSessionWritable, filterVisibleStudentIds } from "@/platform/auth/test-session-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The whole school is ~600 children; anything longer is not this page asking. */
const MAX_STUDENTS = 700;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const lastTried = new Map<string, number>();

/**
 * Prepare dues for the students the dashboard found without any (7 Nov 2026).
 *
 * This used to run in `after()` from the page render. In One that never
 * worked: every fee read goes through the roster projection fetch, which asks
 * the cookie who is reading, and Next refuses `cookies()` inside `after()`
 * while rendering. So each visit logged "Unable to load school defaults" and
 * the "Dues update started" notice promised work that never happened. A
 * server action has the request's cookies, so the page's client calls this
 * once it has loaded, and refreshes when something was prepared.
 *
 * The ids come from the page's own health check; they are still filtered to
 * the ones this viewer may see, in the session they may write.
 */
export async function prepareDashboardDuesAction(
  sessionLabel: string,
  studentIds: readonly string[],
): Promise<{ prepared: number }> {
  await requireStaffPermission("fees:write");
  await assertSessionWritable(null, sessionLabel);

  const requested = [...new Set((Array.isArray(studentIds) ? studentIds : []).filter((id) => typeof id === "string" && UUID.test(id)))].slice(0, MAX_STUDENTS);
  const visible = await filterVisibleStudentIds(null, requested);

  // Two people opening the dashboard together, or a refresh after this very
  // call, must not run the same preparation again.
  const now = Date.now();
  const due = visible.filter((id) => {
    const last = lastTried.get(id);
    return !last || now - last > FIVE_MINUTES_MS;
  });
  if (due.length === 0) return { prepared: 0 };
  for (const id of due) lastTried.set(id, now);

  const result = await prepareDuesForStudentsAutomatically({
    studentIds: due,
    sessionLabel,
    reason: "Dashboard auto-prepare",
  });
  revalidateSessionFinance(sessionLabel, due);
  return { prepared: result.preparedStudentIds.length };
}
